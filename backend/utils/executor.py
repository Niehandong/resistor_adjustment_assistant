import os
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from langchain_openai.chat_models import ChatOpenAI

# 全局线程池配置：从环境变量中读取 MAX_WORKERS
max_workers = int(os.getenv("MAX_WORKERS", 2))
executor = ThreadPoolExecutor(max_workers=max_workers)

# 大模型请求的等待上限（秒）与失败重试次数。不设置时 OpenAI SDK 默认 600 秒、重试 2 次，
# 网关故障时用户要等数分钟才看到报错。流式输出时超时按「两次收到数据的间隔」计算，正常生成不受影响。
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", 90))
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", 1))


def create_llm(temperature: float = 0.7, timeout: Optional[float] = None, max_retries: Optional[int] = None) -> ChatOpenAI:
    """按 LLM_URL / LLM_MODEL / LLM_API_KEY 创建 ChatOpenAI；未指定超时与重试时使用全局配置"""
    # 优先使用具体的 LLM_URL/LLM_API_KEY，如果没有则回退到通用环境变量
    base_url = os.getenv("LLM_URL") or os.getenv("LLM_BASE_URL")
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        raise ValueError("未配置环境变量 LLM_API_KEY")
    return ChatOpenAI(
        base_url=base_url,
        api_key=api_key,
        model=os.getenv("LLM_MODEL"),
        temperature=temperature,
        timeout=LLM_TIMEOUT if timeout is None else timeout,
        max_retries=LLM_MAX_RETRIES if max_retries is None else max_retries,
    )


class LLMFactory:
    """
    LLM 实例工厂类，用于统一管理和获取 LLM 实例。
    """
    _instance = None
    _llm = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(LLMFactory, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_llm(cls, temperature: float = 0.7) -> ChatOpenAI:
        """
        获取一个配置好的 ChatOpenAI 实例。
        目前为了保持简单，内部维护一个单例。如果需要不同的 temperature，
        可以考虑根据参数缓存不同的实例。
        """
        if cls._llm is None:
            cls._llm = create_llm(temperature=temperature)
        return cls._llm

# 创建一个便捷的全局实例获取方法
def get_llm(temperature: float = 0.7) -> ChatOpenAI:
    return LLMFactory.get_llm(temperature=temperature)
