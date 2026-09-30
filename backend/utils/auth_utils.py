import bcrypt
from typing import Optional

# bcrypt 只处理前 72 字节，超出时 bcrypt 5.x 直接抛错
PASSWORD_MAX_BYTES = 72


def password_error(password: str) -> Optional[str]:
    """校验待设置的新密码，不合法时返回提示文案"""
    if not password:
        return "密码不能为空"
    if len(password.encode('utf-8')) > PASSWORD_MAX_BYTES:
        return f"密码过长：最多 {PASSWORD_MAX_BYTES} 字节（约 72 个英文字符或 24 个汉字）"
    return None

def hash_password(password: str) -> str:
    """
    使用 bcrypt 对明文密码进行哈希处理
    """
    # bcrypt 要求输入为 bytes
    password_bytes = password.encode('utf-8')
    # 生成盐并进行哈希
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    # 将结果转换为字符串保存
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    验证明文密码是否与哈希值匹配
    """
    # 空密码一律拒绝，避免空字符串在明文回退分支中相等
    if not plain_password or not hashed_password:
        return False
    try:
        # bcrypt 要求输入均为 bytes
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except Exception:
        # 如果哈希格式不正确（可能是明文），回退到直接比较
        return plain_password == hashed_password
