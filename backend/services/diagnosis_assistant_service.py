import os
import re
import asyncio
import logging
import time
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from pymilvus import connections, Collection, utility
from langchain_openai.chat_models import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from prompt.diagnosis_prompt import SYSTEM_PROMPT, REWRITE_PROMPT, build_user_message, build_rewrite_message

import uuid
from sqlalchemy import func
from models.models import Message, AgentTrace, KnowledgeFile, Conversation
from services.knowledge_service import COLLECTION_NAME, KnowledgeService
from utils.database import SessionLocal

import openai
from utils.executor import get_llm, create_llm
from utils.tracing import Tracer

logger = logging.getLogger(__name__)

# 配置加载
MILVUS_URI = os.getenv("MILVUS_URI")
MILVUS_USER = os.getenv("MILVUS_USER")
MILVUS_PASSWORD = os.getenv("MILVUS_PASSWORD")
MILVUS_DATABASE = os.getenv("MILVUS_DATABASE")
EMBEDDING_URL = os.getenv("EMBEDDING_URL")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL")
LLM_MODEL = os.getenv("LLM_MODEL")
# 相似度（COSINE）低于该值的命中视为不相关，不作为参考资料发给大模型
EMBEDDING_SCORE_THRESHOLD = float(os.getenv("EMBEDDING_SCORE_THRESHOLD", 0.6))
# 多轮对话中，改写检索问题时参考的最近轮数
REWRITE_HISTORY_ROUNDS = int(os.getenv("REWRITE_HISTORY_ROUNDS", 3))

llm = get_llm(temperature=0.7)
# 问题改写只为提高检索准确度，不是必需步骤：输出要稳定，等待要短，失败直接回退原问题，不重试
REWRITE_TIMEOUT = float(os.getenv("REWRITE_TIMEOUT", 15))
rewrite_llm = create_llm(temperature=0, timeout=REWRITE_TIMEOUT, max_retries=0)


class EmbeddingError(Exception):
    """查询向量化失败（区别于大模型生成失败，便于给用户不同的提示）"""


def _brief_error(e: Exception) -> str:
    """日志用的错误摘要：类型 + 状态码 + 压缩成一行的前 200 字（避免整段 HTML 刷屏）"""
    status = getattr(e, "status_code", None)
    text = re.sub(r"<[^>]+>", " ", str(e))
    text = re.sub(r"\s+", " ", text).strip()[:200]
    return f"{type(e).__name__}{f' (HTTP {status})' if status else ''}: {text}"


def _friendly_error(e: Exception) -> str:
    """把异常转换成给用户看的提示；完整原始错误保留在链路追踪的 error 字段中"""
    if isinstance(e, EmbeddingError):
        return "知识库检索服务暂时不可用，请稍后重试。"
    if isinstance(e, openai.RateLimitError):
        return "当前请求较多，大模型服务繁忙，请稍后重试。"
    if isinstance(e, openai.APITimeoutError):
        return "大模型服务响应超时，请稍后重试。"
    if isinstance(e, openai.APIConnectionError):
        return "无法连接大模型服务，请联系管理员检查网络或模型网关。"
    if isinstance(e, openai.APIStatusError):
        if e.status_code >= 500:
            return f"大模型服务暂时无响应（HTTP {e.status_code}），请稍后重试。"
        return f"大模型服务请求失败（HTTP {e.status_code}），请联系管理员检查模型配置。"
    return "系统处理出错，请稍后重试。"


# LangGraph 状态定义
class AgentState(Dict):
    query: str
    search_query: str  # 用于向量检索的问题（多轮时为改写后的完整问题）
    session_id: str
    user_id: Optional[int]
    user_name: Optional[str]
    vector: List[float]
    raw_results: List[Dict[str, Any]]
    final_results: List[Dict[str, Any]]
    model_results: str
    db: Session
    tracer: Tracer

# --- 节点函数 ---

async def _rewrite_query(state: AgentState, history: List[Dict[str, Any]]):
    """多轮对话时结合最近几轮历史，把依赖上下文的追问改写成可独立检索的完整问题；首轮不改写。
    改写只用于检索，回答仍基于用户原问题；改写失败时回退为原问题。"""
    state["search_query"] = state["query"]
    recent = history[-REWRITE_HISTORY_ROUNDS:]
    if not recent:
        return state
    try:
        with state["tracer"].step("rewrite", LLM_MODEL, {"original_query": state["query"], "history_rounds": len(recent)}) as step:
            result = await rewrite_llm.ainvoke([
                SystemMessage(content=REWRITE_PROMPT),
                HumanMessage(content=build_rewrite_message(recent, state["query"]))
            ])
            rewritten = (result.content or "").strip().strip('"“”')
            usage = getattr(result, "usage_metadata", None) or {}
            step["prompt_tokens"] = usage.get("input_tokens")
            step["completion_tokens"] = usage.get("output_tokens")
            step["total_tokens"] = usage.get("total_tokens")
            # 输出异常（空或明显过长）时不采用
            if rewritten and len(rewritten) <= 200:
                state["search_query"] = rewritten
            step["detail"]["search_query"] = state["search_query"]
            step["output_preview"] = rewritten[:500]
    except Exception as e:
        logger.warning(f"问题改写失败，使用原问题检索: {_brief_error(e)}")
    return state


async def _get_embedding(state: AgentState):
    """调用嵌入模型获取查询向量（复用知识库的批量接口，带限流重试）"""
    logger.info(f"正在调用嵌入模型: {EMBEDDING_URL}, 模型: {EMBEDDING_MODEL}")
    with state["tracer"].step("embedding", EMBEDDING_MODEL, {"query": state["search_query"]}) as step:
        try:
            state["vector"] = await KnowledgeService.get_embedding(state["search_query"])
        except Exception as e:
            raise EmbeddingError(f"嵌入模型调用失败: {str(e)}") from e
        step["detail"]["dimension"] = len(state["vector"])
    return state

async def _retrieve_milvus(state: AgentState):
    """从 Milvus 检索启用中的知识库文档切片：回查 SQL 的 is_active，并按相似度阈值过滤"""
    limit = int(os.getenv("EMBEDDING_LIMIT", 5))
    state["raw_results"] = []
    try:
        with state["tracer"].step("retrieval", COLLECTION_NAME, {"limit": limit, "score_threshold": EMBEDDING_SCORE_THRESHOLD}) as step:
            # 1. 获取所有启用的文档文件ID
            with SessionLocal() as db:
                active_file_ids = [f.id for f in db.query(KnowledgeFile.id).filter(KnowledgeFile.is_active == True).all()]
            step["detail"]["active_file_count"] = len(active_file_ids)

            if not active_file_ids:
                step["output_preview"] = "没有启用中的知识库文件，跳过检索"
                return state

            connections.connect(
                alias="default",
                uri=MILVUS_URI,
                user=MILVUS_USER,
                password=MILVUS_PASSWORD,
                db_name=MILVUS_DATABASE
            )

            if not utility.has_collection(COLLECTION_NAME):
                raise Exception(f"Milvus 集合 {COLLECTION_NAME} 不存在")

            # 2. 只检索本项目自己的集合，按启用中的文件 ID 过滤
            expr = f"metadata['file_id'] in [{','.join(map(str, active_file_ids))}]"
            step["detail"]["expr"] = expr
            collection = Collection(COLLECTION_NAME)
            collection.load()
            search_results = collection.search(
                data=[state["vector"]],
                anns_field="vector",
                param={"metric_type": "COSINE", "params": {"nprobe": 10}},
                limit=limit,
                output_fields=["id", "metadata", "page_content"],
                expr=expr
            )

            all_hits = []
            raw_hits = []  # Milvus 原始命中（含被拦截、低于阈值的），用于链路排查
            blocked = 0
            below_threshold = 0
            if search_results:
                # 3. 对命中结果回查 SQL 的 is_active，保证即使向量残留，下线也立即生效
                hit_file_ids = {(hit.entity.get("metadata") or {}).get("file_id") for hit in search_results[0]}
                with SessionLocal() as db_session:
                    still_active = {
                        f.id for f in db_session.query(KnowledgeFile.id)
                        .filter(KnowledgeFile.id.in_([i for i in hit_file_ids if i is not None]), KnowledgeFile.is_active == True)
                        .all()
                    }
                for rank, hit in enumerate(search_results[0], 1):
                    metadata = hit.entity.get("metadata") or {}
                    is_blocked = metadata.get("file_id") not in still_active
                    is_below = hit.score < EMBEDDING_SCORE_THRESHOLD
                    raw_hits.append({
                        "rank": rank,
                        "score": round(hit.score, 4),
                        "file_id": metadata.get("file_id"),
                        "chunk_id": metadata.get("chunk_id"),
                        "source": metadata.get("source"),
                        "blocked": is_blocked,
                        "below_threshold": is_below,
                        "content": (hit.entity.get("page_content") or "")[:500]
                    })
                    if is_blocked:
                        logger.info(f"安全拦截：文件 ID {metadata.get('file_id')} 已停用，跳过加载。")
                        blocked += 1
                        continue
                    if is_below:
                        below_threshold += 1
                        continue
                    all_hits.append({
                        "id": hit.id,
                        "collection": COLLECTION_NAME,
                        "distance": hit.distance,
                        "score": hit.score,
                        "metadata": metadata,
                        "page_content": hit.entity.get("page_content") or ""
                    })

            all_hits.sort(key=lambda x: x["score"], reverse=True)
            state["raw_results"] = all_hits[:10]
            step["detail"]["hit_count"] = len(state["raw_results"])
            step["detail"]["blocked_count"] = blocked
            step["detail"]["below_threshold_count"] = below_threshold
            step["detail"]["hits"] = raw_hits
            step["output_preview"] = "\n".join(
                f"[{h['score']:.4f}] {h['metadata'].get('source')} #切片{h['metadata'].get('chunk_id')}：{h['page_content'][:80]}"
                for h in state["raw_results"]
            ) or ("无命中" if not raw_hits else f"全部 {len(raw_hits)} 条命中低于相似度阈值 {EMBEDDING_SCORE_THRESHOLD}，未采用")
    except Exception as e:
        # 检索失败不中断问答，错误已记录在链路追踪中
        logger.error(f"Milvus 检索过程出错: {str(e)}")
        state["raw_results"] = []
    return state

async def _rerank_results(state: AgentState):
    """移除重排序逻辑，直接使用检索结果"""
    state["final_results"] = state["raw_results"]
    return state


def get_chat_history(conversation_id: str, user_id: Optional[int], db: Session) -> List[Dict[str, Any]]:
    """根据 conversation_id 和 user_id 获取对话历史，限制最近的 20 轮对话"""
    MAX_ROUNDS = 20  # 限制最近的 20 条消息
    try:
        if not conversation_id or user_id is None:
            return []
        
        # 先按时间倒序查最近的 N 条，然后再正序排列返回给前端
        all_history = db.query(Message).filter(
            Message.conversation_id == conversation_id,
            Message.user_id == user_id
        ).order_by(Message.created_at.desc()).limit(MAX_ROUNDS).all()
        
        # 翻转回正序
        all_history.reverse()
        
        def format_entry(h):
            return {
                "id": h.id,
                "conversation_id": h.conversation_id,
                "user_id": h.user_id,
                "user_name": h.user_name,
                "query_text": h.query_text,
                "answer": h.answer,
                "sources": h.sources or [],
                "is_error": bool(h.is_error),
                "feedback": h.feedback or 0,
                "created_at": h.created_at.isoformat() if h.created_at else ""
            }

        return [format_entry(h) for h in all_history]
    except Exception as e:
        logger.error(f"获取对话历史失败: {str(e)}")
        return []

def submit_feedback(message_id: str, feedback: int, db: Session):
    """提交用户反馈 (👍/👎) 并更新会话统计"""
    try:
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            return False
        
        old_feedback = msg.feedback or 0
        if old_feedback == feedback:
            return True # 无需变化
        
        # 更新消息反馈
        msg.feedback = feedback
        
        # 更新会话统计数据
        conv = db.query(Conversation).filter(Conversation.id == msg.conversation_id).first()
        if conv:
            # 减去旧的反馈计数
            if old_feedback == 1: conv.like_count = max(0, conv.like_count - 1)
            elif old_feedback == 2: conv.dislike_count = max(0, conv.dislike_count - 1)
            
            # 加上新的反馈计数
            if feedback == 1: conv.like_count += 1
            elif feedback == 2: conv.dislike_count += 1
            
            conv.update_time = func.now()
        
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"提交反馈失败: {str(e)}")
        return False

def update_conversation(conversation_id: str, user_id: int, db: Session, title: Optional[str] = None, status: Optional[int] = None):
    """编辑或软删除会话"""
    try:
        conv = db.query(Conversation).filter(
            Conversation.id == conversation_id,
            Conversation.user_id == user_id
        ).first()
        if not conv:
            return False
        
        if title is not None:
            conv.title = title
        if status is not None:
            conv.status = status
            
        conv.update_time = func.now()
        db.commit()
        return True
    except Exception as e:
        db.rollback()
        logger.error(f"更新会话失败: {str(e)}")
        return False

def get_user_sessions(user_id: int, db: Session, limit: int = 100) -> List[Dict[str, Any]]:
    """获取用户的会话列表，从 conversations 表获取"""
    try:
        sessions = db.query(Conversation).filter(
            Conversation.user_id == user_id,
            Conversation.status == 0
        ).order_by(Conversation.update_time.desc()).limit(limit).all()

        return [
            {
                "session_id": s.id,
                "title": s.title or "新会话",
                "created_at": s.create_time.isoformat() if s.create_time else "",
                "message_count": s.message_count,
                "like_count": s.like_count or 0,
                "dislike_count": s.dislike_count or 0
            }
            for s in sessions
        ]
    except Exception as e:
        logger.error(f"获取会话列表失败: {str(e)}")
        return []


# --- 对外暴露的服务方法 ---

def _compact_sources(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """把检索命中精简为落库/返回用的来源列表"""
    sources = []
    for r in results:
        metadata = r.get("metadata") or {}
        sources.append({
            "file_id": metadata.get("file_id"),
            "chunk_id": metadata.get("chunk_id"),
            "source": metadata.get("source"),
            "score": round(r.get("score") or 0, 4),
            "content": r.get("page_content", "")
        })
    return sources


async def run_diagnosis_stream(query_text: str, session_id: str, user_id: Optional[int], user_name: Optional[str], db: Session):
    """
    流式执行调阻机诊断助手流程；无论成功、失败还是被客户端中断，都会落库本轮问答及其链路追踪
    """
    state = {
        "query": query_text,
        "search_query": query_text,
        "session_id": session_id,
        "user_id": user_id,
        "user_name": user_name,
        "vector": [],
        "raw_results": [],
        "final_results": [],
        "model_results": "",
        "db": db,
        "tracer": Tracer()
    }
    full_content = ""
    saved = False

    try:
        # 失败的轮次不作为上下文
        history = [h for h in get_chat_history(state["session_id"], state["user_id"], state["db"]) if not h["is_error"]]

        # 1. 执行前置节点 (问题改写, 嵌入, 检索, 重排序)
        state = await _rewrite_query(state, history)
        state = await _get_embedding(state)
        state = await _retrieve_milvus(state)
        state = await _rerank_results(state)

        # 2. 准备流式对话
        query = build_user_message(state["query"], state["final_results"])

        messages = [SystemMessage(content=SYSTEM_PROMPT)]
        for h in history:
            messages.append(HumanMessage(content=h["query_text"]))
            messages.append(AIMessage(content=h["answer"]))
        messages.append(HumanMessage(content=query))

        # 3. 开始流式调用 LLM
        with state["tracer"].step("llm", LLM_MODEL, {
            "history_rounds": len(history),
            "reference_count": len(state["final_results"]),
            "user_message": query  # 实际发送给大模型的本轮内容（问题 + 参考资料）
        }) as step:
            start = time.perf_counter()
            aggregated = None
            async for chunk in llm.astream(messages, stream_usage=True):
                aggregated = chunk if aggregated is None else aggregated + chunk
                if chunk.content:
                    if not full_content:
                        step["detail"]["first_token_ms"] = int((time.perf_counter() - start) * 1000)
                    full_content += chunk.content
                    yield {"answer": chunk.content, "done": False}
            usage = getattr(aggregated, "usage_metadata", None) or {}
            step["prompt_tokens"] = usage.get("input_tokens")
            step["completion_tokens"] = usage.get("output_tokens")
            step["total_tokens"] = usage.get("total_tokens")
            step["output_preview"] = full_content[:2000]

        # 4. 完成后保存历史
        state["model_results"] = full_content
        msg_id = save_chat_history(state, db)
        saved = True
        yield {"answer": "", "done": True, "sources": _compact_sources(state["final_results"]), "message_id": msg_id}

    except (asyncio.CancelledError, GeneratorExit):
        # 客户端中断（停止生成 / 新建或切换会话）：保存已生成的部分后继续向上抛出
        if not saved:
            logger.info(f"会话 {session_id} 的生成被客户端中断，保存已生成的 {len(full_content)} 字")
            state["model_results"] = f"{full_content}\n\n（已停止生成）".strip()
            for st in state["tracer"].steps:
                if st["step_type"] == "llm" and st["output_preview"] is None:
                    st["output_preview"] = full_content[:2000]
            with SessionLocal() as save_db:
                save_chat_history(state, save_db)
        raise

    except Exception as e:
        logger.error(f"Streaming Error: {_brief_error(e)}")
        error_text = f"抱歉，{_friendly_error(e)}"
        state["model_results"] = f"{full_content}\n\n{error_text}".strip()
        msg_id = save_chat_history(state, db, is_error=True)
        yield {"answer": error_text, "done": True, "message_id": msg_id}


def save_chat_history(state: Dict[str, Any], db: Session, is_error: bool = False):
    """保存本轮问答及其链路追踪，并同步更新会话表"""
    try:
        conversation_id = state.get("session_id")
        user_id = state.get("user_id")
        query_text = state.get("query")

        # 1. 查找或创建会话记录
        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conv:
            conv = Conversation(
                id=conversation_id,
                user_id=user_id,
                title=(query_text[:30] + "...") if len(query_text) > 30 else query_text,
                message_count=1,
                last_message_at=func.now()
            )
            db.add(conv)
        else:
            conv.message_count += 1
            conv.last_message_at = func.now()
            conv.update_time = func.now()

        # 2. 保存消息记录：回答存纯文本，来源单独存 JSONB
        message_id = str(uuid.uuid4())
        db.add(Message(
            id=message_id,
            conversation_id=conversation_id,
            user_id=user_id,
            user_name=state.get("user_name"),
            query_text=query_text,
            answer=state.get("model_results", ""),
            sources=_compact_sources(state.get("final_results", [])),
            is_error=is_error
        ))

        # 3. 以 message_id 为追踪主键保存链路追踪各步骤
        for seq, st in enumerate(state["tracer"].steps):
            db.add(AgentTrace(message_id=message_id, seq=seq, **st))

        db.commit()
        return message_id
    except Exception as e:
        db.rollback()
        logger.error(f"保存对话历史失败: {str(e)}")
        return None


def get_message_trace(message_id: str, db: Session) -> List[Dict[str, Any]]:
    """按执行顺序列出某轮问答的链路追踪步骤"""
    traces = db.query(AgentTrace).filter(AgentTrace.message_id == message_id).order_by(AgentTrace.seq).all()
    return [
        {
            "seq": t.seq,
            "step_type": t.step_type,
            "name": t.name,
            "detail": t.detail,
            "output_preview": t.output_preview,
            "prompt_tokens": t.prompt_tokens,
            "completion_tokens": t.completion_tokens,
            "total_tokens": t.total_tokens,
            "duration_ms": t.duration_ms,
            "error": t.error,
            "created_at": t.created_at.isoformat() if t.created_at else ""
        }
        for t in traces
    ]
