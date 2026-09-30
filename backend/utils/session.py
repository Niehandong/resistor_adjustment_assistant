"""登录会话：Redis 保存，每次请求滑动续期，连续 SESSION_EXPIRE_SECONDS 无交互后过期。

键设计（DB 由 REDIS_DB 指定，统一前缀 resistor:）：
- resistor:session:{token}        -> 用户ID，TTL = SESSION_EXPIRE_SECONDS，每次请求重置
- resistor:user_sessions:{user_id} -> 该用户所有 token 的集合，用于退出其全部登录（改密码 / 删用户）
"""
import os
import secrets
from typing import Optional

import redis
from dotenv import load_dotenv

load_dotenv()

SESSION_COOKIE = "ra_session"
SESSION_EXPIRE_SECONDS = int(os.getenv("SESSION_EXPIRE_SECONDS", 7200))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "False").lower() == "true"

_PREFIX = "resistor:"

_redis = redis.Redis(
    host=os.getenv("REDIS_HOST", "127.0.0.1"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD") or None,
    db=int(os.getenv("REDIS_DB", 11)),
    decode_responses=True,
    socket_timeout=3,
    socket_connect_timeout=3,
)


def _session_key(token: str) -> str:
    return f"{_PREFIX}session:{token}"


def _user_key(user_id: int) -> str:
    return f"{_PREFIX}user_sessions:{user_id}"


def create_session(user_id: int) -> str:
    """登录成功后创建会话，返回写入 Cookie 的 token"""
    token = secrets.token_urlsafe(32)
    pipe = _redis.pipeline()
    pipe.set(_session_key(token), user_id, ex=SESSION_EXPIRE_SECONDS)
    pipe.sadd(_user_key(user_id), token)
    pipe.expire(_user_key(user_id), SESSION_EXPIRE_SECONDS)
    pipe.execute()
    return token


def touch_session(token: str) -> Optional[int]:
    """校验会话并续期：有效则把过期时间重置为 SESSION_EXPIRE_SECONDS，返回用户ID；无效返回 None"""
    if not token:
        return None
    user_id = _redis.getex(_session_key(token), ex=SESSION_EXPIRE_SECONDS)
    if user_id is None:
        return None
    _redis.expire(_user_key(int(user_id)), SESSION_EXPIRE_SECONDS)
    return int(user_id)


def delete_session(token: str) -> None:
    """退出当前登录"""
    user_id = _redis.get(_session_key(token))
    pipe = _redis.pipeline()
    pipe.delete(_session_key(token))
    if user_id is not None:
        pipe.srem(_user_key(int(user_id)), token)
    pipe.execute()


def delete_user_sessions(user_id: int, keep_token: Optional[str] = None) -> None:
    """退出某用户的全部登录（可保留当前这一个），用于修改密码、删除用户"""
    tokens = _redis.smembers(_user_key(user_id))
    pipe = _redis.pipeline()
    for t in tokens:
        if t != keep_token:
            pipe.delete(_session_key(t))
            pipe.srem(_user_key(user_id), t)
    pipe.execute()
