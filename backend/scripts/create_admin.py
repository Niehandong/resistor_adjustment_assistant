"""初始化管理员账号（已存在则跳过）。用法：cd backend && ../.venv/bin/python scripts/create_admin.py [邮箱] [密码]"""
import sys
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from utils.database import SessionLocal
from utils.auth_utils import hash_password
from models.models import User

email = sys.argv[1] if len(sys.argv) > 1 else "admin@jptoe.com"
password = sys.argv[2] if len(sys.argv) > 2 else "111111"

with SessionLocal() as db:
    if db.query(User).filter(User.email == email).first():
        print(f"用户 {email} 已存在，跳过")
    else:
        db.add(User(name="管理员", email=email, password=hash_password(password), role="admin"))
        db.commit()
        print(f"管理员 {email} 已创建")
