import logging
import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from models.models import Conversation, Message, User
from utils.database import get_db
from utils.deps import get_current_user, require_admin
from utils.response import make_response
from services import diagnosis_assistant_service

logger = logging.getLogger(__name__)

# 全部接口要求登录；用户身份一律取自登录会话，不信任请求中的 user_id
router = APIRouter(prefix="/diagnosis-assistant", tags=["Diagnosis Assistant"], dependencies=[Depends(get_current_user)])

# Pydantic 模型
class QueryRequest(BaseModel):
    session_id: str
    query_text: str

@router.post("/query/stream")
async def query_assistant_stream(
    request: QueryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    调阻机诊断助手流式查询接口
    """
    # 不允许向他人的会话追加提问
    owner = db.query(Conversation.user_id).filter(Conversation.id == request.session_id).scalar()
    if owner is not None and owner != user.id:
        return make_response(msg="会话不存在或无权操作", code=403)

    async def event_generator():
        # 获取流程生成器
        async for event in diagnosis_assistant_service.run_diagnosis_stream(
            query_text=request.query_text,
            session_id=request.session_id,
            user_id=user.id,
            user_name=user.name,
            db=db
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.get("/history/{conversation_id}")
async def get_history(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):

    """
    获取对话历史接口
    """
    history = diagnosis_assistant_service.get_chat_history(
        conversation_id=conversation_id,
        user_id=user.id,
        db=db
    )
    return make_response(data=history)

class UpdateConversationRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[int] = None

@router.put("/conversations/{conversation_id}")
async def update_conv(
    conversation_id: str,
    request: UpdateConversationRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    编辑会话标题或更新状态（如软删除）
    """
    success = diagnosis_assistant_service.update_conversation(
        conversation_id=conversation_id,
        user_id=user.id,
        title=request.title,
        status=request.status,
        db=db
    )
    if not success:
        return make_response(msg="会话不存在或无权操作", code=404)
    return make_response(msg="更新成功")

@router.delete("/conversations/{conversation_id}")
async def delete_conv(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    软删除会话 (status = 2)
    """
    success = diagnosis_assistant_service.update_conversation(
        conversation_id=conversation_id,
        user_id=user.id,
        status=2,
        db=db
    )
    if not success:
        return make_response(msg="会话不存在或无权操作", code=404)
    return make_response(msg="会话已删除")

@router.get("/sessions")
async def get_sessions(
    limit: int = 100,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    获取用户的会话列表
    """
    sessions = diagnosis_assistant_service.get_user_sessions(
        user_id=user.id,
        limit=limit,
        db=db
    )
    return make_response(data=sessions)

class FeedbackRequest(BaseModel):
    message_id: str
    feedback: int # 1: like, 2: dislike, 0: none

@router.post("/feedback")
async def submit_message_feedback(
    request: FeedbackRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    提交用户对消息的反馈（只能评价自己的问答）
    """
    owner = db.query(Message.user_id).filter(Message.id == request.message_id).scalar()
    if owner != user.id:
        return make_response(msg="消息不存在或无权操作", code=404)
    success = diagnosis_assistant_service.submit_feedback(
        message_id=request.message_id,
        feedback=request.feedback,
        db=db
    )
    if not success:
        return make_response(msg="消息不存在或更新失败", code=404)
    return make_response(msg="反馈已提交")

@router.get("/messages/{message_id}/trace")
async def get_message_trace(
    message_id: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    查看某轮问答的链路追踪（嵌入 → 检索 → 大模型 各步骤耗时 / token / 错误）
    """
    traces = diagnosis_assistant_service.get_message_trace(message_id=message_id, db=db)
    return make_response(data=traces)
