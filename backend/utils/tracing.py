import asyncio
import time
from contextlib import contextmanager
from typing import Any, Dict, List, Optional


class Tracer:
    """链路追踪：按执行顺序收集每轮问答的各步骤（耗时 / 详情 / 输出预览 / token / 错误）"""

    def __init__(self):
        self.steps: List[Dict[str, Any]] = []

    @contextmanager
    def step(self, step_type: str, name: Optional[str] = None, detail: Optional[Dict[str, Any]] = None):
        """记录一个步骤；调用方可在 with 块内补充 detail / output_preview / token 字段。
        块内抛出异常时记录错误信息后继续向上抛出。"""
        record: Dict[str, Any] = {
            "step_type": step_type,
            "name": name,
            "detail": dict(detail or {}),
            "output_preview": None,
            "prompt_tokens": None,
            "completion_tokens": None,
            "total_tokens": None,
            "duration_ms": None,
            "error": None,
        }
        start = time.perf_counter()
        try:
            yield record
        except (asyncio.CancelledError, GeneratorExit):
            # 客户端中断不算错误，只做标记
            record["detail"]["interrupted"] = True
            raise
        except Exception as e:
            record["error"] = str(e)[:2000]
            raise
        finally:
            record["duration_ms"] = int((time.perf_counter() - start) * 1000)
            self.steps.append(record)
