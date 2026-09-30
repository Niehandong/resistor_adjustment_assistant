from sqlalchemy import Column, Integer, String, Text, Float, DateTime, Enum, BigInteger, Boolean, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from utils.database import Base

class User(Base):
    __tablename__ = "users"
    __table_args__ = {"comment": "用户信息表"}

    id = Column(Integer, primary_key=True, index=True, comment="用户ID（主键）")
    name = Column(String(100), nullable=False, comment="用户姓名")
    email = Column(String(255), unique=True, index=True, nullable=False, comment="邮箱地址（唯一）")
    gender = Column(String(50), comment="性别")
    password = Column(String(255), nullable=False, comment="密码（加密存储）")
    role = Column(String(20), nullable=False, server_default='user', comment="角色：admin, user")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = {"comment": "调阻机诊断助手详细对话记录表"}

    id = Column(String(64), primary_key=True, comment='记录唯一ID (UUID)')
    conversation_id = Column(String(64), ForeignKey('conversations.id'), nullable=False, index=True, comment='关联的会话ID (UUID)')
    user_id = Column(Integer, nullable=True, comment='发送提问的用户ID')
    user_name = Column(String(100), nullable=True, comment='用户姓名')
    query_text = Column(Text, nullable=False, comment='用户原始提问内容')
    answer = Column(Text, nullable=False, comment='AI回答内容（纯文本 Markdown）')
    sources = Column(JSONB, comment='该回答引用的知识库切片列表 (JSONB)：file_id/chunk_id/source/score/content')
    is_error = Column(Boolean, nullable=False, default=False, server_default='false', comment='本轮问答是否执行失败（原因见 agent_trace.error）')
    feedback = Column(Integer, server_default='0', comment='用户反馈：0-无反馈，1-点赞，2-点踩')
    created_at = Column(DateTime, nullable=False, server_default=func.now(), comment='消息创建时间')

    # 定义关联关系
    conversation = relationship("Conversation", back_populates="messages")
    traces = relationship("AgentTrace", back_populates="message", cascade="all, delete-orphan", order_by="AgentTrace.seq")


class AgentTrace(Base):
    __tablename__ = "agent_trace"
    __table_args__ = {"comment": "链路追踪表：每轮问答（messages）的分步执行记录"}

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment='追踪记录ID（主键自增）')
    message_id = Column(String(64), ForeignKey('messages.id', ondelete='CASCADE'), nullable=False, index=True, comment='追踪主键：关联 messages.id（该轮问答）')
    seq = Column(Integer, nullable=False, comment='步骤序号（执行顺序，从 0 开始）')
    step_type = Column(String(20), nullable=False, comment='步骤类型：embedding（查询向量化）/ retrieval（向量检索）/ llm（大模型生成）')
    name = Column(String(100), comment='模型名或集合名')
    detail = Column(JSONB, comment='步骤详情（JSONB）：入参与关键指标')
    output_preview = Column(Text, comment='步骤输出预览（截断）')
    prompt_tokens = Column(Integer, comment='提示 token 数（仅 llm 步骤有值）')
    completion_tokens = Column(Integer, comment='补全 token 数（仅 llm 步骤有值）')
    total_tokens = Column(Integer, comment='总 token 数（仅 llm 步骤有值）')
    duration_ms = Column(Integer, comment='该步耗时（毫秒）')
    error = Column(Text, comment='该步失败时的错误信息')
    created_at = Column(DateTime, nullable=False, server_default=func.now(), comment='创建时间')

    message = relationship("Message", back_populates="traces")

class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = {"comment": "会话表"}

    id = Column(String(64), primary_key=True, comment="会话唯一ID (UUID)")
    title = Column(String(500), comment="会话标题")
    user_id = Column(Integer, index=True, comment="所属用户ID")
    status = Column(Integer, server_default='0', comment="状态：0-正常，1-归档，2-删除")
    last_message_at = Column(DateTime, comment="最后消息时间")
    message_count = Column(Integer, server_default='0', comment="消息数量")
    like_count = Column(Integer, server_default='0', comment="点赞数量")
    dislike_count = Column(Integer, server_default='0', comment="点踩数量")
    metadata_json = Column(Text, name="metadata", comment="扩展字段")
    create_time = Column(DateTime, nullable=False, server_default=func.now(), comment="创建时间")
    update_time = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 定义反向关联
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class KnowledgeFile(Base):
    __tablename__ = "knowledge_files"
    __table_args__ = {"comment": "知识库文档管理表"}

    id = Column(Integer, primary_key=True, index=True, comment="文件ID")
    filename = Column(String(255), nullable=False, comment="原始文件名称")
    minio_object_name = Column(String(255), nullable=False, comment="MinIO存储对象名")
    separator = Column(String(100), comment="切片分隔符")
    status = Column(String(50), default="uploaded", comment="处理状态: uploaded, embedding, embedded, error")
    char_count = Column(Integer, default=0, comment="文件总字符数")
    segment_count = Column(Integer, default=0, comment="分段总数")
    is_active = Column(Boolean, default=True, comment="是否启用搜索")
    uploader_id = Column(Integer, ForeignKey("users.id"), comment="上传人ID")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="上传时间")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="最后更新时间")

    # 关联
    uploader = relationship("User")

class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = {"comment": "知识库切片内容表"}

    id = Column(Integer, primary_key=True, index=True, comment="切片唯一ID")
    file_id = Column(Integer, index=True, comment="关联的文件元数据ID")
    content = Column(Text, nullable=False, comment="切片文本详情")
    char_count = Column(Integer, comment="切片文本字符数")
    milvus_id = Column(BigInteger, comment="对应在Milvus向量库中的ID")
    embedding_time = Column(Float, comment="向量化处理耗时 (秒)")
    creator_id = Column(Integer, ForeignKey("users.id"), comment="创建人ID")
    updater_id = Column(Integer, ForeignKey("users.id"), comment="修改人ID")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), comment="创建时间")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), comment="更新时间")

    # 关联
    creator = relationship("User", foreign_keys=[creator_id])
    updater = relationship("User", foreign_keys=[updater_id])
