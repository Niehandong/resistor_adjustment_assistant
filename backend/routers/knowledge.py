from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
import uuid
import os
from datetime import datetime
from utils.database import get_db
from models.models import KnowledgeFile, KnowledgeChunk, User
from services.knowledge_service import KnowledgeService
from utils.minio_utils import minio_client
from utils.response import make_response
from pydantic import BaseModel

from utils.deps import require_admin

# 知识库管理仅限管理员；操作人取自登录会话
router = APIRouter(prefix="/knowledge", tags=["knowledge"], dependencies=[Depends(require_admin)])

class PreviewRequest(BaseModel):
    file_id: int
    separator: str

class EmbedRequest(BaseModel):
    file_id: int
    separator: str
    chunks: Optional[List[str]] = None

class ChunkUpdateRequest(BaseModel):
    content: str

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...), 
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    # 结合“日期文件夹”和“UUID唯一文件名”
    # 路径格式：file/年-月-日/UUID_文件名
    date_str = datetime.now().strftime("%Y-%m-%d")
    unique_id = uuid.uuid4()
    object_name = f"file/{date_str}/{unique_id}_{file.filename}"
    
    # Upload to MinIO
    content = await file.read()
    minio_client.upload_fileobj(object_name, content, len(content))
    
    # Save to SQL
    k_file = KnowledgeFile(
        filename=file.filename,
        minio_object_name=object_name,
        status='uploaded',
        uploader_id=admin.id
    )
    db.add(k_file)
    db.commit()
    db.refresh(k_file)
    
    return make_response({"id": k_file.id, "filename": k_file.filename})

@router.post("/preview")
async def preview_chunks(req: PreviewRequest, db: Session = Depends(get_db)):
    try:
        chunks = await KnowledgeService.preview_chunks(req.file_id, req.separator, db)
        return make_response({"chunks": chunks})
    except Exception as e:
        return make_response(msg=str(e), code=500)

@router.post("/embed")
async def embed_chunks(req: EmbedRequest, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        await KnowledgeService.embed_chunks(req.file_id, req.separator, req.chunks, db, admin.id)
        return make_response(msg="Embedding completed successfully")
    except Exception as e:
        return make_response(msg=str(e), code=500)

@router.get("/files")
async def list_files(
    keyword: Optional[str] = None, 
    page: int = 1, 
    size: int = 10, 
    db: Session = Depends(get_db)
):
    query = db.query(KnowledgeFile).options(joinedload(KnowledgeFile.uploader))
    if keyword:
        query = query.filter(KnowledgeFile.filename.ilike(f"%{keyword}%"))
    
    total = query.count()
    files = query.order_by(KnowledgeFile.created_at.desc()).offset((page - 1) * size).limit(size).all()
    
    # 手动构建返回列表，包含上传人姓名
    result = []
    for f in files:
        f_dict = {c.name: getattr(f, c.name) for c in f.__table__.columns}
        f_dict['uploader_name'] = f.uploader.name if f.uploader else '系统'
        result.append(f_dict)

    return make_response({
        "items": result,
        "total": total,
        "page": page,
        "size": size
    })

@router.get("/chunks/{file_id}")
async def get_chunks(file_id: int, db: Session = Depends(get_db)):
    chunks = db.query(KnowledgeChunk).options(
        joinedload(KnowledgeChunk.creator),
        joinedload(KnowledgeChunk.updater)
    ).filter(KnowledgeChunk.file_id == file_id).order_by(KnowledgeChunk.id.asc()).all()
    
    # 手动构建返回列表
    result = []
    for c in chunks:
        c_dict = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        c_dict['creator_name'] = c.creator.name if c.creator else '系统'
        c_dict['updater_name'] = c.updater.name if c.updater else (c_dict['creator_name'])
        result.append(c_dict)

    return make_response(result)

@router.put("/chunks/{chunk_id}")
async def update_chunk(chunk_id: int, req: ChunkUpdateRequest, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    try:
        await KnowledgeService.update_chunk(chunk_id, req.content, db, admin.id)
        return make_response(msg="Chunk updated successfully")
    except Exception as e:
        return make_response(msg=str(e), code=500)

@router.delete("/chunks/{chunk_id}")
async def delete_chunk(chunk_id: int, db: Session = Depends(get_db)):
    try:
        await KnowledgeService.delete_chunk(chunk_id, db)
        return make_response(msg="Chunk deleted successfully")
    except Exception as e:
        return make_response(msg=str(e), code=500)

@router.delete("/files/{file_id}")
async def delete_file(file_id: int, db: Session = Depends(get_db)):
    try:
        await KnowledgeService.delete_file(file_id, db)
        return make_response(msg="File and its knowledge deleted successfully")
    except Exception as e:
        return make_response(msg=str(e), code=500)

@router.put("/files/{file_id}/toggle")
async def toggle_file_active(file_id: int, db: Session = Depends(get_db)):
    k_file = db.query(KnowledgeFile).filter(KnowledgeFile.id == file_id).first()
    if not k_file:
        return make_response(msg="File not found", code=404)
    
    k_file.is_active = not k_file.is_active
    db.commit()
    db.refresh(k_file)
    
    status_str = "enabled" if k_file.is_active else "disabled"
    return make_response(data={"is_active": k_file.is_active}, msg=f"Document search {status_str}")
