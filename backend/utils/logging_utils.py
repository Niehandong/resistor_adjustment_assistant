import logging
import sys
import os
from typing import Optional
from logging.handlers import TimedRotatingFileHandler

class LogConfig:
    """
    通用日志配置类，支持跨项目复用。
    """
    @staticmethod
    def setup_logging(
        level: int = logging.INFO,
        log_format: Optional[str] = None,
        log_file_dir: str = "logs",
        log_file_name: str = "app.log"
    ):
        if log_format is None:
            log_format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

        # 确保日志目录存在
        if not os.path.exists(log_file_dir):
            try:
                os.makedirs(log_file_dir)
            except Exception as e:
                print(f"Failed to create log directory {log_file_dir}: {e}")

        log_file_path = os.path.join(log_file_dir, log_file_name)

        # 移除默认可能存在的 handlers，防止重复打印
        for handler in logging.root.handlers[:]:
            logging.root.removeHandler(handler)

        # 创建 Formatter
        formatter = logging.Formatter(log_format)

        # 创建 handlers
        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setFormatter(formatter)

        file_handler = TimedRotatingFileHandler(
            log_file_path,
            when="midnight",
            interval=1,
            backupCount=0,
            encoding="utf-8"
        )
        # 自定义日志滚动时的文件名格式: app-YYYY-MM-DD.log
        def custom_namer(default_name):
            # default_name 格式通常是: logs/app.log.2026-06-03
            if default_name.endswith(".log"): # 处理非滚动情况（虽然 namer 通常只在滚动时调用）
                return default_name
            
            # 提取路径、基础文件名和日期后缀
            # 假设 log_file_name 是 app.log
            base_dir = os.path.dirname(default_name)
            filename = os.path.basename(default_name)
            
            if "app.log." in filename:
                date_suffix = filename.split("app.log.")[1]
                new_filename = f"app-{date_suffix}.log"
                return os.path.join(base_dir, new_filename)
            
            return default_name

        file_handler.namer = custom_namer
        file_handler.setFormatter(formatter)

        handlers = [stdout_handler, file_handler]

        # 基础配置
        logging.basicConfig(
            level=level,
            format=log_format,
            handlers=handlers
        )
        
        # 强制配置 uvicorn 的日志，使其使用我们的 handlers
        # 移除它们自带的 handlers 并应用我们的
        for logger_name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
            logger = logging.getLogger(logger_name)
            logger.handlers.clear()
            for handler in handlers:
                logger.addHandler(handler)
            logger.propagate = False  # 防止重复打印到 root logger
            logger.setLevel(level)

        logger = logging.getLogger(__name__)
        logger.info(f"Logging initialized at level: {logging.getLevelName(level)}")
        logger.info(f"Logs will be saved to: {os.path.abspath(log_file_path)}")
        
        return {
            "handlers": handlers,
            "format": log_format,
            "level": level
        }
