import os
import asyncio
import httpx
import logging
import time
from docx import Document
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from pymilvus import connections, Collection, utility, FieldSchema, CollectionSchema, DataType
from models.models import KnowledgeFile, KnowledgeChunk
from utils.minio_utils import minio_client
import tempfile
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Config
EMBEDDING_URL = os.getenv("EMBEDDING_URL")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY")
MILVUS_URI = os.getenv("MILVUS_URI")
MILVUS_USER = os.getenv("MILVUS_USER")
MILVUS_PASSWORD = os.getenv("MILVUS_PASSWORD")
MILVUS_DATABASE = os.getenv("MILVUS_DATABASE")
COLLECTION_NAME = os.getenv("MILVUS_COLLECTION", "resistor_adjustment_knowledge")
DIMENSION = 1024
# 每次请求的切片数与限流重试次数（网关按请求次数限流）
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", 32))
EMBEDDING_MAX_RETRIES = int(os.getenv("EMBEDDING_MAX_RETRIES", 5))


def ensure_collection():
    """集合不存在时按固定 Schema 创建（非破坏性，已存在则跳过）"""
    connections.connect(
        alias="default",
        uri=MILVUS_URI,
        user=MILVUS_USER,
        password=MILVUS_PASSWORD,
        db_name=MILVUS_DATABASE
    )
    if utility.has_collection(COLLECTION_NAME):
        return False
    fields = [
        FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=100, is_primary=True, auto_id=False),
        FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION),
        FieldSchema(name="page_content", dtype=DataType.VARCHAR, max_length=65535),
        FieldSchema(name="metadata", dtype=DataType.JSON)
    ]
    schema = CollectionSchema(fields, description="调阻机诊断助手知识库文档切片 (手动ID模式)")
    collection = Collection(COLLECTION_NAME, schema)
    collection.create_index(
        field_name="vector",
        index_params={"metric_type": "COSINE", "index_type": "IVF_FLAT", "params": {"nlist": 1024}}
    )
    logger.info(f"已创建 Milvus 集合: {COLLECTION_NAME}")
    return True

class KnowledgeService:
    @staticmethod
    async def get_embeddings(texts: List[str]) -> List[List[float]]:
        """批量获取向量，按 EMBEDDING_BATCH_SIZE 分批请求；遇到限流（429）按退避时间重试"""
        headers = {
            "Authorization": f"Bearer {EMBEDDING_API_KEY}",
            "Content-Type": "application/json"
        }
        vectors: List[List[float]] = []
        async with httpx.AsyncClient(timeout=120.0) as client:
            for start in range(0, len(texts), EMBEDDING_BATCH_SIZE):
                batch = texts[start:start + EMBEDDING_BATCH_SIZE]
                payload = {"model": EMBEDDING_MODEL, "input": batch}
                for attempt in range(EMBEDDING_MAX_RETRIES + 1):
                    response = await client.post(EMBEDDING_URL, headers=headers, json=payload)
                    if response.status_code == 429 and attempt < EMBEDDING_MAX_RETRIES:
                        retry_after = response.headers.get("retry-after")
                        wait = float(retry_after) if retry_after and retry_after.isdigit() else min(5 * 2 ** attempt, 60)
                        logger.warning(f"嵌入接口限流，{wait} 秒后第 {attempt + 1} 次重试")
                        await asyncio.sleep(wait)
                        continue
                    if response.status_code != 200:
                        raise Exception(f"Embedding API error: {response.text}")
                    break
                data = response.json().get("data")
                # OpenAI 兼容格式：data 为列表，按 index 对齐输入顺序
                if not isinstance(data, list) or len(data) != len(batch) or any("embedding" not in d for d in data):
                    raise Exception(f"Failed to find embedding in response: {response.text[:500]}")
                data.sort(key=lambda d: d.get("index", 0))
                vectors.extend(d["embedding"] for d in data)
        return vectors

    @classmethod
    async def get_embedding(cls, text: str) -> List[float]:
        return (await cls.get_embeddings([text]))[0]

    @staticmethod
    def parse_file(file_path: str, filename: str) -> str:
        ext = os.path.splitext(filename)[1].lower()
        if ext == '.md' or ext == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        elif ext == '.docx':
            doc = Document(file_path)
            return "\n".join([para.text for para in doc.paragraphs])
        else:
            raise Exception(f"Unsupported file type: {ext}")

    @staticmethod
    def split_text(text: str, separator: str) -> List[str]:
        if not separator:
            return [text]
        # 处理特殊的转义字符
        sep = separator.replace('\\n', '\n').replace('\\t', '\t')
        chunks = text.split(sep)
        return [c.strip() for c in chunks if c.strip()]

    @classmethod
    async def preview_chunks(cls, file_id: int, separator: str, db: Session) -> List[str]:
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
        if not k_file:
            raise Exception("File not found")
        
        with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(k_file.filename)[1]) as tmp:
            minio_client.download_file(k_file.minio_object_name, tmp.name)
            text = cls.parse_file(tmp.name, k_file.filename)
            os.unlink(tmp.name)
            
        return cls.split_text(text, separator)

    @classmethod
    async def embed_chunks(cls, file_id: int, separator: str, manual_chunks: Optional[List[str]], db: Session, user_id: Optional[int] = None):
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
        if not k_file:
            raise Exception("File not found")

        # 1. Clear existing chunks for this file if re-embedding
        existing_chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.file_id == file_id).all()
        
        connections.connect(
            alias="default", 
            uri=MILVUS_URI, 
            user=MILVUS_USER, 
            password=MILVUS_PASSWORD,
            db_name=MILVUS_DATABASE
        )
        collection = Collection(COLLECTION_NAME)
        
        if existing_chunks:
            milvus_ids = [c.milvus_id for c in existing_chunks if c.milvus_id]
            if milvus_ids:
                milvus_str_ids = [f'"{m}"' for m in milvus_ids]
                expr = f"id in [{','.join(milvus_str_ids)}]"
                collection.delete(expr)
            
            for c in existing_chunks:
                db.delete(c)
            db.commit()

        k_file.status = 'embedding'
        k_file.separator = separator
        db.commit()

        inserted_ids: List[str] = []
        try:
            if manual_chunks is None:
                chunks_text = await cls.preview_chunks(file_id, separator, db)
            else:
                chunks_text = manual_chunks

            # 先完成全部向量化，失败时不会留下部分写入的切片
            start_time = time.time()
            vectors = await cls.get_embeddings(chunks_text)
            proc_time = round((time.time() - start_time) / max(len(chunks_text), 1), 3)

            collection.load()

            total_chars = 0
            for text, vector in zip(chunks_text, vectors):
                c_chars = len(text)
                total_chars += c_chars
                
                # Save to SQL first to get ID
                chunk = KnowledgeChunk(
                    file_id=file_id, 
                    content=text, 
                    char_count=c_chars,
                    embedding_time=proc_time,
                    creator_id=user_id,
                    updater_id=user_id
                )
                db.add(chunk)
                db.flush() # Get chunk.id

                # Insert to Milvus using the SQL chunk.id as primary key
                collection.insert([
                    [str(chunk.id)],
                    [vector],
                    [text],
                    [{"file_id": file_id, "chunk_id": chunk.id, "source": k_file.filename, "sender_name": ""}]
                ])
                inserted_ids.append(str(chunk.id))
                chunk.milvus_id = chunk.id
                
            k_file.status = 'embedded'
            k_file.char_count = total_chars
            k_file.segment_count = len(chunks_text)
            db.commit()
        except Exception as e:
            db.rollback()
            # 清理本次已写入 Milvus 的向量，与 SQL 回滚保持一致
            if inserted_ids:
                try:
                    ids_str = ",".join(f'"{i}"' for i in inserted_ids)
                    collection.delete(f"id in [{ids_str}]")
                except Exception as del_err:
                    logger.error(f"回滚 Milvus 向量失败: {del_err}")
            k_file.status = 'error'
            db.commit()
            logger.error(f"Embedding failed: {e}")
            raise e

    @classmethod
    async def update_chunk(cls, chunk_id: int, content: str, db: Session, user_id: Optional[int] = None):
        chunk = db.query(KnowledgeChunk).filter(KnowledgeChunk.id == chunk_id).first()
        if not chunk:
            raise Exception("Chunk not found")

        chunk.content = content
        chunk.updater_id = user_id
        
        vector = await cls.get_embedding(content)

        connections.connect(
            alias="default", 
            uri=MILVUS_URI, 
            user=MILVUS_USER, 
            password=MILVUS_PASSWORD,
            db_name=MILVUS_DATABASE
        )
        collection = Collection(COLLECTION_NAME)
        
        # Now that auto_id is False, we can use upsert directly with the SQL ID (formatted as string)
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == chunk.file_id).first()
        collection.upsert([
            [str(chunk.id)],
            [vector],
            [content],
            [{"file_id": chunk.file_id, "chunk_id": chunk.id, "source": k_file.filename if k_file else "未知", "sender_name": ""}]
        ])
        
        # Update parent file timestamp and char count
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == chunk.file_id).first()
        if k_file:
            from sqlalchemy import func
            k_file.updated_at = func.now()
            # Recalculate total character count
            k_file.char_count = db.query(func.sum(KnowledgeChunk.char_count)).filter(KnowledgeChunk.file_id == chunk.file_id).scalar() or 0

        db.commit()

    @classmethod
    async def delete_chunk(cls, chunk_id: int, db: Session):
        chunk = db.query(KnowledgeChunk).filter(KnowledgeChunk.id == chunk_id).first()
        if not chunk:
            return
        
        file_id = chunk.file_id # Save for later
        
        connections.connect(
            alias="default", 
            uri=MILVUS_URI, 
            user=MILVUS_USER, 
            password=MILVUS_PASSWORD,
            db_name=MILVUS_DATABASE
        )
        collection = Collection(COLLECTION_NAME)
        collection.delete(f"id == \"{chunk.milvus_id}\"")
        
        db.delete(chunk)
        
        # Update parent file timestamp, segment count, and char count
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
        if k_file:
            from sqlalchemy import func
            k_file.updated_at = func.now()
            k_file.segment_count = db.query(KnowledgeChunk).filter(KnowledgeChunk.file_id == file_id).count()
            # Recalculate total character count
            k_file.char_count = db.query(func.sum(KnowledgeChunk.char_count)).filter(KnowledgeChunk.file_id == file_id).scalar() or 0

        db.commit()

    @classmethod
    async def delete_file(cls, file_id: int, db: Session):
        k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
        if not k_file:
            return

        # Delete chunks first
        chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.file_id == file_id).all()

        connections.connect(
            alias="default", 
            uri=MILVUS_URI, 
            user=MILVUS_USER, 
            password=MILVUS_PASSWORD, 
            db_name=MILVUS_DATABASE
        )
        collection = Collection(COLLECTION_NAME)

        if chunks:
            milvus_ids = [c.milvus_id for c in chunks]
            milvus_str_ids = [f'"{m}"' for m in milvus_ids]
            expr = f"id in [{','.join(milvus_str_ids)}]"
            collection.delete(expr)

            for c in chunks:
                db.delete(c)
        
        object_name = k_file.minio_object_name
        db.delete(k_file)
        db.commit()

        # 删除 MinIO 中的原始文件，失败不影响删除结果
        try:
            minio_client.remove_object(object_name)
        except Exception as e:
            logger.error(f"MinIO 文件删除失败 {object_name}: {e}")
