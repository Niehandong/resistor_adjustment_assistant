from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import models
from utils.database import get_db
from utils import make_response
from utils.auth_utils import verify_password, hash_password, password_error
from utils.deps import get_current_user, set_session_cookie, clear_session_cookie
from utils.session import SESSION_COOKIE, create_session, delete_session, delete_user_sessions

router = APIRouter(tags=["Auth"])

class LoginRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    email: Optional[str] = None  # 兼容旧前端，已不使用：以当前登录用户为准
    old_password: str
    new_password: str


def _user_info(user: models.User) -> dict:
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


@router.post("/login")
def api_login(login_data: LoginRequest, db: Session = Depends(get_db)):
    """
    账号密码登录接口：成功后创建 Redis 会话并写入 HttpOnly Cookie
    """
    user = db.query(models.User).filter(models.User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.password):
        return make_response(code=401, msg="邮箱或密码错误")

    token = create_session(user.id)
    response = JSONResponse(make_response(data={"user": _user_info(user)}, msg="登录成功"))
    set_session_cookie(response, token)
    return response


@router.post("/logout")
def api_logout(request: Request):
    """
    退出登录：删除当前会话并清除 Cookie
    """
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        delete_session(token)
    response = JSONResponse(make_response(msg="已退出登录"))
    clear_session_cookie(response)
    return response


@router.get("/me")
def api_me(user: models.User = Depends(get_current_user)):
    """
    当前登录用户（同时完成一次会话续期）
    """
    return make_response(data={"user": _user_info(user)})


@router.post("/change-password")
def api_change_password(
    data: ChangePasswordRequest,
    request: Request,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    修改当前登录用户的密码；成功后退出该用户的全部登录（含当前设备），需用新密码重新登录
    """
    if not verify_password(data.old_password, user.password):
        return make_response(code=400, msg="旧密码错误")

    err = password_error(data.new_password)
    if err:
        return make_response(code=400, msg=err)
    user.password = hash_password(data.new_password)
    db.commit()
    delete_user_sessions(user.id)

    # 撤销本次请求的 Cookie 续期（否则 SessionCookieMiddleware 会把已作废的令牌重新写回浏览器）
    request.state.session_token = None
    response = JSONResponse(make_response(msg="密码修改成功，请使用新密码重新登录"))
    clear_session_cookie(response)
    return response
