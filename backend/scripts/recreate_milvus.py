import os
import logging
from pathlib import Path
from dotenv import load_dotenv
from pymilvus import (
    connections,
    utility,
    FieldSchema,
    CollectionSchema,
    DataType,
    Collection,
)

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# 加载环境变量
# .env 位于 backend/ 根目录 (本脚本在 backend/scripts/ 下), 相对脚本位置解析
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

MILVUS_URI = os.getenv("MILVUS_URI")
MILVUS_USER = os.getenv("MILVUS_USER")
MILVUS_PASSWORD = os.getenv("MILVUS_PASSWORD")
MILVUS_DATABASE = os.getenv("MILVUS_DATABASE", "default")

COLLECTION_NAME = os.getenv("MILVUS_COLLECTION", "resistor_adjustment_knowledge")
DIMENSION = 1024

def recreate_collection():
    """连接 Milvus 并重建集合（关闭 auto_id）"""
    try:
        connections.connect(
            alias="default",
            uri=MILVUS_URI,
            user=MILVUS_USER,
            password=MILVUS_PASSWORD,
            db_name=MILVUS_DATABASE
        )
        logger.info(f"成功连接到 Milvus: {MILVUS_URI}, DB: {MILVUS_DATABASE}")

        if utility.has_collection(COLLECTION_NAME):
            logger.info(f"正在删除旧集合: {COLLECTION_NAME}...")
            collection = Collection(COLLECTION_NAME)
            collection.drop()

        # 定义 Schema，设置 auto_id=False
        fields = [
            FieldSchema(name="id", dtype=DataType.VARCHAR, max_length=100, is_primary=True, auto_id=False),
            FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=DIMENSION),
            FieldSchema(name="page_content", dtype=DataType.VARCHAR, max_length=65535),
            FieldSchema(name="metadata", dtype=DataType.JSON)
        ]
        schema = CollectionSchema(fields, description="调阻机诊断助手知识库文档切片 (手动ID模式)")
        
        collection = Collection(COLLECTION_NAME, schema)
        logger.info(f"成功创建新集合: {COLLECTION_NAME} (auto_id=False)")

        # 创建索引
        index_params = {
            "metric_type": "COSINE",
            "index_type": "IVF_FLAT",
            "params": {"nlist": 1024}
        }
        collection.create_index(field_name="vector", index_params=index_params)
        logger.info("索引创建成功")
        
        return True
    except Exception as e:
        logger.error(f"Milvus 重建失败: {e}")
        return False

if __name__ == "__main__":
    recreate_collection()
