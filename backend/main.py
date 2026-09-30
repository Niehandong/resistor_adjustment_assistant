import uvicorn
import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

logger = logging.getLogger(__name__)


# 加载 .env 环境变量
load_dotenv()

from models import models
from utils.database import engine
from routers import auth, users, diagnosis_assistant, knowledge, conversation_records
from services.knowledge_service import ensure_collection
from utils import make_response, LogConfig
from utils.deps import AuthError, auth_error_handler, SessionCookieMiddleware




@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        # 数据库初始化
        models.Base.metadata.create_all(bind=engine)
        logger.info("Database initialized.")
    except Exception as e:
        logger.error(f"Startup error: {e}")
    try:
        # Milvus 集合初始化（不存在才创建）
        ensure_collection()
    except Exception as e:
        logger.error(f"Milvus 初始化失败: {e}")
    yield

app = FastAPI(title="Resistor Adjustment Assistant API", lifespan=lifespan)

app.add_exception_handler(AuthError, auth_error_handler)
# 会话 Cookie 滑动续期（每次通过鉴权的请求刷新有效期）
app.add_middleware(SessionCookieMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# 挂载模块化路由
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(diagnosis_assistant.router)
app.include_router(knowledge.router)
app.include_router(conversation_records.router)

@app.get("/")
def read_root():
    return make_response(msg="Resistor Adjustment Assistant API is running")

if __name__ == "__main__":
    # 初始化全局日志配置
    LogConfig.setup_logging()
    
    # 禁用 Uvicorn 默认的日志配置重写，使用我们在 setup_logging 中预先定义的 logging 配置
    uvicorn.run("main:app", host="0.0.0.0", port=8121, reload=False, log_config=None)
