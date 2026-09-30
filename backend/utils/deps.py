"""鉴权依赖与会话 Cookie 续期中间件"""
import logging

import redis
from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.datastructures import MutableHeaders
from starlette.responses import Response

from models.models import User
from utils.database import get_db
from utils.response import make_response
from utils.session import COOKIE_SECURE, SESSION_COOKIE, SESSION_EXPIRE_SECONDS, delete_session, touch_session

logger = logging.getLogger(__name__)


class AuthError(Exception):
    """鉴权失败：由全局异常处理器转成统一信封 {code, msg, data}（HTTP 200）"""

    def __init__(self, code: int, msg: str):
        self.code = code
        self.msg = msg


async def auth_error_handler(request: Request, exc: AuthError):
    return JSONResponse(make_response(code=exc.code, msg=exc.msg))


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """要求已登录：校验会话并续期，返回当前用户（每次从数据库读取，角色变更/删除立即生效）"""
    token = request.cookies.get(SESSION_COOKIE)
    try:
        user_id = touch_session(token)
    except redis.RedisError as e:
        logger.error(f"会话校验失败，Redis 不可用: {e}")
        raise AuthError(500, "登录服务暂不可用，请稍后重试")
    if not user_id:
        raise AuthError(401, "登录已过期，请重新登录")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        delete_session(token)
        raise AuthError(401, "账号不存在，请重新登录")

    # 交给 SessionCookieMiddleware 在响应中刷新 Cookie 有效期
    request.state.session_token = token
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    """要求管理员"""
    if user.role != "admin":
        raise AuthError(403, "需要管理员权限")
    return user


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_EXPIRE_SECONDS, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/"
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, httponly=True, samesite="lax", secure=COOKIE_SECURE, path="/")


class SessionCookieMiddleware:
    """会话校验通过的请求，在响应头中重新下发 Cookie，使浏览器端有效期与 Redis 同步滑动。

    使用纯 ASGI 实现（而非 BaseHTTPMiddleware），不影响流式响应对客户端断开的感知。
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                token = (scope.get("state") or {}).get("session_token")
                if token:
                    cookie = Response()
                    set_session_cookie(cookie, token)
                    headers = MutableHeaders(scope=message)
                    for key, value in cookie.raw_headers:
                        if key == b"set-cookie":
                            headers.append("set-cookie", value.decode("latin-1"))
            await send(message)

        await self.app(scope, receive, send_wrapper)
