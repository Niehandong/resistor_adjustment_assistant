from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from pydantic import BaseModel, field_validator
from datetime import datetime
import models
from utils.database import get_db
from utils import make_response
from sqlalchemy.exc import IntegrityError
from models.models import KnowledgeChunk, KnowledgeFile
from utils.auth_utils import hash_password, password_error

from utils.deps import require_admin
from utils.session import delete_user_sessions

# 用户管理仅限管理员
router = APIRouter(prefix="/users", tags=["Users"], dependencies=[Depends(require_admin)])

GENDERS = {"Male", "Female"}


class UserBase(BaseModel):
    name: str
    email: str
    gender: Optional[str] = None
    role: Optional[str] = 'user'

    @field_validator("gender", mode="before")
    @classmethod
    def normalize_gender(cls, v):
        # 未选择性别统一存为 NULL，只接受 Male / Female
        if v in (None, ""):
            return None
        if v not in GENDERS:
            raise ValueError("性别只能是 Male 或 Female")
        return v

class UserCreate(UserBase):
    password: Optional[str] = None

class UserUpdate(UserBase):
    password: Optional[str] = None

class UserOut(UserBase):
    id: int
    role: str
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True


@router.get("")
def api_get_users(db: Session = Depends(get_db), keyword: Optional[str] = None, page: int = 1, size: int = 10):
    query = db.query(models.User)
    if keyword:
        query = query.filter(or_(models.User.name.contains(keyword), models.User.email.contains(keyword)))
    total = query.count()
    items = query.offset((page - 1) * size).limit(size).all()
    # 手动转换为 dict 以符合 UserOut 结构
    data = {
        "items": [UserOut.from_orm(item).dict() for item in items],
        "total": total
    }
    return make_response(data=data)

@router.post("/create")
def api_create_user(user: UserCreate, db: Session = Depends(get_db)):
    user_dict = user.dict()
    if user_dict.get('password'):
        err = password_error(user_dict['password'])
        if err:
            return make_response(code=400, msg=err)
        user_dict['password'] = hash_password(user_dict['password'])
    else:
        user_dict['password'] = hash_password('111111')
    if db.query(models.User.id).filter(models.User.email == user_dict['email']).first():
        return make_response(code=400, msg="邮箱已被使用")

    db_user = models.User(**user_dict)
    db.add(db_user)
    try:
        db.commit()
        db.refresh(db_user)
        return make_response(msg="创建成功")
    except IntegrityError:
        db.rollback()
        return make_response(code=400, msg="邮箱已被使用")
    except Exception:
        db.rollback()
        return make_response(code=400, msg="操作失败")

@router.post("/update/{user_id}")
def api_update_user(user_id: int, user_update: UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user: return make_response(code=404, msg="未找到用户")
    
    update_data = user_update.dict(exclude_unset=True)
    # 密码留空表示不修改，不能把空字符串写进 password
    if update_data.get('password'):
        err = password_error(update_data['password'])
        if err:
            return make_response(code=400, msg=err)
        update_data['password'] = hash_password(update_data['password'])
    else:
        update_data.pop('password', None)
    if 'email' in update_data and db.query(models.User.id).filter(
        models.User.email == update_data['email'], models.User.id != user_id
    ).first():
        return make_response(code=400, msg="邮箱已被其他用户使用")

    for key, value in update_data.items():
        setattr(db_user, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return make_response(code=400, msg="邮箱已被其他用户使用")
    if 'password' in update_data:
        # 管理员重置了密码：该用户需要用新密码重新登录
        delete_user_sessions(user_id)
    db.refresh(db_user)
    return make_response(msg="更新成功")

@router.post("/delete/{user_id}")
def api_delete_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(models.User).filter(models.User.id == user_id).first()
    if not db_user: return make_response(code=404, msg="未找到用户")
    try:
        # 保留该用户上传/编辑过的知识库内容，只解除与用户的关联
        db.query(KnowledgeFile).filter(KnowledgeFile.uploader_id == user_id).update({KnowledgeFile.uploader_id: None}, synchronize_session=False)
        db.query(KnowledgeChunk).filter(KnowledgeChunk.creator_id == user_id).update({KnowledgeChunk.creator_id: None}, synchronize_session=False)
        db.query(KnowledgeChunk).filter(KnowledgeChunk.updater_id == user_id).update({KnowledgeChunk.updater_id: None}, synchronize_session=False)
        db.delete(db_user)
        db.commit()
        delete_user_sessions(user_id)
    except Exception as e:
        db.rollback()
        return make_response(code=400, msg=f"删除失败：{e}")
    return make_response(msg="删除成功")
