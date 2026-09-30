import os
from concurrent.futures import ThreadPoolExecutor
from langchain_openai.chat_models import ChatOpenAI

# 全局线程池配置：从环境变量中读取 MAX_WORKERS
max_workers = int(os.getenv("MAX_WORKERS", 2))
executor = ThreadPoolExecutor(max_workers=max_workers)

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
            # 优先使用具体的 LLM_URL/LLM_API_KEY，如果没有则回退到通用环境变量
            base_url = os.getenv("LLM_URL") or os.getenv("LLM_BASE_URL")
            api_key = os.getenv("LLM_API_KEY")
            model = os.getenv("LLM_MODEL")

            if not api_key:
                raise ValueError("未配置环境变量 LLM_API_KEY")

            cls._llm = ChatOpenAI(
                base_url=base_url,
                api_key=api_key,
                model=model,
                temperature=temperature
            )
        return cls._llm

# 创建一个便捷的全局实例获取方法
def get_llm(temperature: float = 0.7) -> ChatOpenAI:
    return LLMFactory.get_llm(temperature=temperature)
