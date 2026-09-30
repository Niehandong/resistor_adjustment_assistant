from datetime import date, datetime, time, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import Integer, cast, exists, func
from sqlalchemy.orm import Session

from models.models import AgentTrace, Conversation, Message, User
from services import diagnosis_assistant_service
from utils.database import get_db
from utils.deps import require_admin
from utils.response import make_response

# 会话记录审计仅限管理员
router = APIRouter(prefix="/conversation-records", tags=["Conversation Records"], dependencies=[Depends(require_admin)])


def _iso(value: Optional[datetime]) -> str:
    return value.isoformat() if value else ""


@router.get("/conversations")
async def list_conversations(
    keyword: Optional[str] = None,
    user_name: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    has_error: Optional[bool] = None,
    has_dislike: Optional[bool] = None,
    page: int = 1,
    size: int = 10,
    db: Session = Depends(get_db)
):
    """
    会话记录列表（含用户已删除的会话），按会话汇总消息数、失败数、点赞/点踩数
    """
    # 每个会话的消息统计
    msg_stats = db.query(
        Message.conversation_id.label("conversation_id"),
        func.count(Message.id).label("message_count"),
        func.sum(cast(Message.is_error, Integer)).label("error_count"),
        func.sum(cast(Message.feedback == 1, Integer)).label("like_count"),
        func.sum(cast(Message.feedback == 2, Integer)).label("dislike_count"),
        func.max(Message.created_at).label("last_message_at")
    ).group_by(Message.conversation_id).subquery()

    query = db.query(
        Conversation,
        User.name.label("user_name"),
        msg_stats.c.message_count,
        msg_stats.c.error_count,
        msg_stats.c.like_count,
        msg_stats.c.dislike_count,
        msg_stats.c.last_message_at
    ).outerjoin(User, User.id == Conversation.user_id) \
     .outerjoin(msg_stats, msg_stats.c.conversation_id == Conversation.id)

    if keyword:
        # 匹配会话标题、会话ID，或会话内任一提问
        like = f"%{keyword}%"
        query = query.filter(
            Conversation.title.ilike(like)
            | Conversation.id.ilike(like)
            | exists().where(Message.conversation_id == Conversation.id, Message.query_text.ilike(like))
        )
    if user_name:
        query = query.filter(User.name.ilike(f"%{user_name}%"))
    if start_date or end_date:
        # 按提问时间筛选：会话内任一提问落在区间内即命中（跨天持续的会话不会被漏掉）
        conds = [Message.conversation_id == Conversation.id]
        if start_date:
            conds.append(Message.created_at >= datetime.combine(start_date, time.min))
        if end_date:
            conds.append(Message.created_at < datetime.combine(end_date + timedelta(days=1), time.min))
        query = query.filter(exists().where(*conds))
    if has_error is not None:
        cond = func.coalesce(msg_stats.c.error_count, 0) > 0
        query = query.filter(cond if has_error else ~cond)
    if has_dislike is not None:
        cond = func.coalesce(msg_stats.c.dislike_count, 0) > 0
        query = query.filter(cond if has_dislike else ~cond)

    total = query.count()
    rows = query.order_by(func.coalesce(msg_stats.c.last_message_at, Conversation.create_time).desc()) \
        .offset((page - 1) * size).limit(size).all()

    items = [
        {
            "id": conv.id,
            "title": conv.title,
            "user_id": conv.user_id,
            "user_name": name,
            "status": conv.status or 0,
            "message_count": message_count or 0,
            "error_count": error_count or 0,
            "like_count": like_count or 0,
            "dislike_count": dislike_count or 0,
            "create_time": _iso(conv.create_time),
            "last_message_at": _iso(last_message_at or conv.last_message_at)
        }
        for conv, name, message_count, error_count, like_count, dislike_count, last_message_at in rows
    ]
    return make_response({"items": items, "total": total, "page": page, "size": size})


@router.get("/conversations/{conversation_id}/messages")
async def list_conversation_messages(conversation_id: str, db: Session = Depends(get_db)):
    """
    某个会话的全部问答（按时间正序），附每轮的引用数、最高分、耗时与 token
    """
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        return make_response(msg="会话不存在", code=404)

    trace_stats = db.query(
        AgentTrace.message_id.label("message_id"),
        func.sum(AgentTrace.duration_ms).label("total_duration_ms"),
        func.sum(AgentTrace.total_tokens).label("total_tokens")
    ).group_by(AgentTrace.message_id).subquery()

    rows = db.query(Message, trace_stats.c.total_duration_ms, trace_stats.c.total_tokens) \
        .outerjoin(trace_stats, trace_stats.c.message_id == Message.id) \
        .filter(Message.conversation_id == conversation_id) \
        .order_by(Message.created_at.asc()).all()

    messages = []
    for m, total_duration_ms, total_tokens in rows:
        sources = m.sources or []
        messages.append({
            "id": m.id,
            "user_name": m.user_name,
            "query_text": m.query_text,
            "answer": m.answer,
            "is_error": bool(m.is_error),
            "feedback": m.feedback or 0,
            "source_count": len(sources),
            "top_score": max((s.get("score") or 0 for s in sources), default=None),
            "total_duration_ms": int(total_duration_ms) if total_duration_ms is not None else None,
            "total_tokens": int(total_tokens) if total_tokens is not None else None,
            "has_trace": total_duration_ms is not None,
            "created_at": _iso(m.created_at)
        })

    return make_response({
        "conversation": {"id": conv.id, "title": conv.title, "status": conv.status or 0},
        "messages": messages
    })


@router.get("/messages/{message_id}")
async def get_message_detail(message_id: str, db: Session = Depends(get_db)):
    """
    单轮问答详情：问题、回答、引用来源，以及完整的链路追踪（检索过程）
    """
    m = db.query(Message).filter(Message.id == message_id).first()
    if not m:
        return make_response(msg="问答记录不存在", code=404)

    return make_response({
        "id": m.id,
        "conversation_id": m.conversation_id,
        "user_name": m.user_name,
        "query_text": m.query_text,
        "answer": m.answer,
        "sources": m.sources or [],
        "is_error": bool(m.is_error),
        "feedback": m.feedback or 0,
        "created_at": _iso(m.created_at),
        "traces": diagnosis_assistant_service.get_message_trace(message_id=m.id, db=db)
    })
