from typing import Any, Optional
from pydantic import BaseModel

class StandardResponse(BaseModel):
    code: int = 200
    msg: str = "success"
    data: Optional[Any] = None

def make_response(data: Any = None, msg: str = "success", code: int = 200):
    return {"code": code, "msg": msg, "data": data}
