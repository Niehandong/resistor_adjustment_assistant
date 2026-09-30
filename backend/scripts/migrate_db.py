"""数据库结构迁移（幂等，可重复执行）。用法：cd backend && ../.venv/bin/python scripts/migrate_db.py

- messages：answer_content（JSON 字符串）拆分为 answer（纯文本）+ sources（JSONB），新增 is_error
- agent_trace：链路追踪表（不存在则创建）
"""
import json
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from sqlalchemy import inspect, text
from utils.database import engine
from models import models


def compact_sources(old_sources):
    """把旧格式的检索命中转换为新的精简来源列表"""
    result = []
    for r in old_sources or []:
        metadata = r.get("metadata") or {}
        result.append({
            "file_id": metadata.get("file_id"),
            "chunk_id": metadata.get("chunk_id"),
            "source": metadata.get("source"),
            "score": round(r.get("score") or 0, 4),
            "content": r.get("page_content", "")
        })
    return result


def migrate():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS answer TEXT"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS sources JSONB"))
        conn.execute(text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_error BOOLEAN NOT NULL DEFAULT false"))

        columns = {c["name"] for c in inspect(conn).get_columns("messages")}
        if "answer_content" in columns:
            rows = conn.execute(text("SELECT id, answer_content FROM messages WHERE answer IS NULL")).fetchall()
            for mid, raw in rows:
                answer, sources = raw, []
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        answer = data.get("answer", "")
                        sources = compact_sources(data.get("sources"))
                except (TypeError, ValueError):
                    pass
                conn.execute(
                    text("UPDATE messages SET answer = :answer, sources = CAST(:sources AS JSONB) WHERE id = :id"),
                    {"answer": answer, "sources": json.dumps(sources, ensure_ascii=False), "id": mid}
                )
            conn.execute(text("ALTER TABLE messages DROP COLUMN answer_content"))
            print(f"messages：已转换 {len(rows)} 条记录，删除 answer_content 列")

        conn.execute(text("UPDATE messages SET answer = '' WHERE answer IS NULL"))
        conn.execute(text("ALTER TABLE messages ALTER COLUMN answer SET NOT NULL"))
        conn.execute(text("COMMENT ON COLUMN messages.answer IS 'AI回答内容（纯文本 Markdown）'"))
        conn.execute(text("COMMENT ON COLUMN messages.sources IS '该回答引用的知识库切片列表 (JSONB)：file_id/chunk_id/source/score/content'"))
        conn.execute(text("COMMENT ON COLUMN messages.is_error IS '本轮问答是否执行失败（原因见 agent_trace.error）'"))

    # 新表（agent_trace）由 create_all 创建，已存在的表不受影响
    models.Base.metadata.create_all(bind=engine)
    print("迁移完成")


if __name__ == "__main__":
    migrate()
