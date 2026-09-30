# CLAUDE.md

## 沟通语言

与用户交流、撰写说明、提交信息一律使用**中文**。

## 项目是什么

调阻机诊断助手：从 `/home/AI/nhdspace/code/topsalesadmin` 裁剪出的独立项目，只保留**调阻机诊断助手（RAG 问答，原项目的"销售助手"）**、**知识库管理**、**会话记录**（链路排查）、**用户管理**和登录/修改密码。FastAPI 后端（`backend/`）+ React 单页应用（`frontend/`）。

与原项目的资源完全隔离：
- PostgreSQL 数据库 `resistor_adjustment`
- MinIO 桶 `resistor-adjustment`
- Milvus 库 `resistor_adjustment`（`MILVUS_DATABASE`）下的集合 `resistor_adjustment_knowledge`（`MILVUS_COLLECTION`）。检索**只查本集合**，不要改回遍历库内全部集合。
- 前端 cookie 名 `raUserInfo` / `ra_session`、localStorage 键 `ra_user`，避免与原项目同域部署时串登录态。

## 常用命令

没有测试套件。后端改动靠启动服务调接口验证；前端用 `npm run build` 和 `npm run lint` 验证（lint 有原项目遗留的 `no-explicit-any` 报错）。

```bash
cd backend                                   # 必须在此目录运行（扁平导入）
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python main.py                  # 0.0.0.0:8121
./service.sh {start|stop|restart|status|logs}
../.venv/bin/python scripts/create_admin.py [邮箱] [密码]   # 初始化管理员，默认 admin@jptoe.com / 111111
../.venv/bin/python scripts/migrate_db.py                   # 幂等的表结构迁移
../.venv/bin/python scripts/recreate_milvus.py              # 破坏性：删除并重建集合

cd frontend
npm install && npm run dev                   # 0.0.0.0:3224，/api/* 代理到 API_PROXY_TARGET（默认 8121）并去掉 /api
./service.sh {start|stop|restart|status|logs}
```

启动时 `create_all` 只创建缺失的表；Milvus 库需预先存在，集合不存在时由 `knowledge_service.ensure_collection()` 自动创建。MinIO 桶在导入 `minio_utils` 时自动创建。

## 架构约定

- 所有接口返回 `{"code", "msg", "data"}`（`utils.make_response`），HTTP 状态恒为 200；前端 Axios 拦截器在 `code === 200` 时解包 `data`。
- `users` 路由用 `POST /x/create|update/{id}|delete/{id}` 风格；`knowledge`、`diagnosis_assistant`（前缀 `/diagnosis-assistant`）用 PUT/DELETE。改哪个沿用哪个。
- 分页入参 `page`（从 1 开始）、`size`；出参 `{"items", "total"}`。
- **鉴权**：登录后后端在 Redis（`REDIS_DB=11`，键前缀 `resistor:`）创建会话，令牌写入 HttpOnly Cookie `ra_session`；每次通过鉴权的请求都会重置 Redis TTL 并由 `utils/deps.py` 的 `SessionCookieMiddleware`（纯 ASGI，勿改成 BaseHTTPMiddleware，会影响流式断开感知）重新下发 Cookie，连续 `SESSION_EXPIRE_SECONDS`（默认 7200）无交互才过期。路由用 `Depends(get_current_user)` / `Depends(require_admin)`，失败抛 `AuthError` → 统一信封 401/403。**用户身份一律取自会话，不要再从请求参数读 `user_id`。** 改密码、删除用户时调用 `utils.session.delete_user_sessions()` 使旧登录失效。
- 前端 `raUserInfo` Cookie 只是展示用缓存（会话级，无固定过期），`api.ts` 收到 401 时由 `services/authSession.ts` 清除并跳转登录页；流式接口鉴权失败返回 JSON 而非事件流，需单独判断。
- 配置全部来自 `backend/.env`（python-dotenv）。LLM 统一用 `utils.executor.get_llm()`。
- RAG 流程：`_get_embedding` → `_retrieve_milvus` → `_rerank_results`（透传占位）→ 流式 LLM。检索先按启用的 `knowledge_files.id` 过滤，再对命中回查 SQL `is_active`，保留这层双重校验。
- `DIMENSION = 1024` 写死在 `services/knowledge_service.py` 与 `scripts/recreate_milvus.py`，须与 `EMBEDDING_MODEL`（bge-m3）一致。
- 问答落库：`messages.answer` 存纯文本回答，`messages.sources`（JSONB）存引用切片，`messages.is_error` 标记失败轮次（失败轮次不作为后续上下文）。每轮的执行步骤按 `message_id` 写入 `agent_trace`（`embedding` / `retrieval` / `llm`，含耗时、token、输出预览、错误），由 `utils/tracing.py` 的 `Tracer.step()` 采集；新增步骤时用它包裹。查看：管理后台「会话记录」页（`frontend/src/components/views/ConversationRecords.tsx`：会话列表 → 会话内逐轮问答 → 单轮检索过程；接口在 `routers/conversation_records.py`，前缀 `/conversation-records`，含用户已软删除的会话），或 `GET /diagnosis-assistant/messages/{message_id}/trace`。`retrieval.detail.hits` 存 Milvus 原始命中（含被停用拦截的），`llm.detail.user_message` 存实际发给大模型的问题 + 参考资料。
- 已有表的结构变更写进 `scripts/migrate_db.py`（幂等）。
- 流式问答被客户端中断（停止生成 / 切换会话）时抛出的是 `CancelledError` / `GeneratorExit`（非 `Exception`），`run_diagnosis_stream` 单独捕获并用新 Session 保存已生成部分（回答末尾追加「（已停止生成）」，trace 标记 `detail.interrupted`）。
- 设置密码统一先过 `utils.auth_utils.password_error()`（非空、≤72 字节，bcrypt 5.x 超长会抛错）；编辑用户时密码留空表示不修改，绝不能写入空字符串。
- 系统提示词在 `backend/prompt/diagnosis_prompt.py`，面向调阻机故障诊断（非销售）。
- 代码注释、日志、接口文案、界面文字均为中文。
