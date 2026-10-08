# 调阻机诊断助手

面向杰普特激光调阻机的故障诊断问答系统。用户描述故障现象、报警代码或异常表现，助手从知识库检索相关资料，给出可能原因和分步排查方法；管理员维护知识库，并可逐轮回看每个问题的检索过程来排查回答质量。

## 功能

| 模块 | 使用者 | 说明 |
|---|---|---|
| 诊断助手 | 所有用户 | 流式问答；回答严格依据知识库，不编造报警含义或参数；可停止生成、给回答点赞或点踩 |
| 知识库管理 | 管理员 | 上传 `.md` / `.txt` / `.docx` 文档，按分隔符预览、编辑切片后向量化；可随时停用某个文档 |
| 会话记录 | 管理员 | 会话列表 → 会话内逐轮问答 → 单轮检索过程（查询向量化、每条检索命中及得分、发送给大模型的内容、模型回答、耗时与 token） |
| 用户管理 | 管理员 | 新增、编辑、删除用户，分配管理员或普通用户角色 |

## 技术栈

- **后端**：Python 3.12、FastAPI、SQLAlchemy、LangChain（OpenAI 兼容接口）
- **前端**：React 19、Vite 6、TypeScript、Tailwind CSS 4
- **存储**：PostgreSQL（业务数据）、Milvus（向量）、MinIO（原始文档）、Redis（登录会话）
- **模型**：任意 OpenAI 兼容的对话模型与嵌入模型（默认 bge-m3，1024 维）

```
浏览器 ──/api/*──▶ Vite 或 nginx ──(去掉 /api 前缀)──▶ FastAPI :8121
                                                   ├─ PostgreSQL  用户、会话、问答、链路追踪、知识库元数据
                                                   ├─ Milvus      知识库切片向量
                                                   ├─ MinIO       上传的原始文档
                                                   ├─ Redis       登录会话
                                                   └─ 大模型 / 嵌入模型网关
```

## 目录结构

```
backend/
  main.py                 入口，监听 0.0.0.0:8121
  routers/                接口：auth、diagnosis_assistant、knowledge、conversation_records、users
  services/               问答流程（嵌入 → 检索 → 生成）、知识库切片与向量化
  prompt/                 系统提示词
  utils/                  数据库、MinIO、Redis 会话、鉴权依赖、链路追踪
  scripts/                初始化管理员、表结构迁移、重建 Milvus 集合
frontend/
  src/components/         诊断助手、侧边栏、管理页面（views/）
  src/services/           Axios 实例与接口封装
```

## 部署

### 1. 准备依赖服务

需要可访问的 PostgreSQL、Milvus（2.x）、MinIO、Redis，以及大模型与嵌入模型网关。以下两项**需要提前手动创建**，其余会在后端启动时自动创建（数据表、Milvus 集合、MinIO 桶）：

```bash
# PostgreSQL 数据库
psql -h <PG地址> -U <用户> -c "CREATE DATABASE resistor_adjustment;"

# Milvus 数据库（在仓库根目录执行，需先完成第 2 步安装依赖）
.venv/bin/python -c "
from pymilvus import connections, db
connections.connect(uri='http://<Milvus地址>:19530', user='<用户>', password='<密码>')
db.create_database('resistor_adjustment')"
```

### 2. 后端

```bash
python3.12 -m venv .venv                       # 虚拟环境放在仓库根目录
.venv/bin/pip install -r backend/requirements.txt

cd backend                                      # 以下命令都在 backend/ 下执行
cp .env.example .env                            # 按下方「配置说明」填写
../.venv/bin/python main.py                     # 前台启动，确认无报错后 Ctrl+C
../.venv/bin/python scripts/create_admin.py     # 创建初始管理员
./service.sh start                              # 后台运行：start | stop | restart | status | logs
```

`create_admin.py` 默认创建 `admin@jptoe.com / 111111`，也可以传参指定：`scripts/create_admin.py 邮箱 密码`。**首次登录后请立即修改密码。**

后端没有热重载，修改代码后需要执行 `./service.sh restart`。日志写在 `backend/logs/`。

### 3. 前端

```bash
cd frontend
npm install
cp .env.example .env         # 默认把 /api 转发到 http://127.0.0.1:8121
./service.sh start           # 以 Vite 开发服务器运行在 0.0.0.0:3224
```

浏览器访问 `http://<服务器IP>:3224`。

### 生产环境（nginx）

执行 `npm run build`，把 `frontend/dist/` 作为静态目录，并把 `/api/` 转发到后端、去掉前缀。问答接口是流式响应，需要关闭缓冲：

```nginx
location / {
    root /path/to/frontend/dist;
    try_files $uri /index.html;
}
location /api/ {
    proxy_pass http://127.0.0.1:8121/;   # 末尾的 / 用来去掉 /api 前缀
    proxy_buffering off;                 # 流式回答逐字返回
    proxy_read_timeout 300s;
}
```

通过 HTTPS 提供访问时，把后端配置中的 `COOKIE_SECURE` 改为 `True`。

## 配置说明

后端配置全部在 `backend/.env`（模板见 `backend/.env.example`）：

| 配置项 | 说明 |
|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `MILVUS_URI` / `MILVUS_USER` / `MILVUS_PASSWORD` | Milvus 连接信息 |
| `MILVUS_DATABASE` / `MILVUS_COLLECTION` | 向量库名与集合名，默认都是 `resistor_adjustment…` |
| `EMBEDDING_URL` / `EMBEDDING_MODEL` / `EMBEDDING_API_KEY` | 嵌入模型（OpenAI 兼容 `/v1/embeddings`） |
| `EMBEDDING_LIMIT` | 每次问答检索的切片数 |
| `REWRITE_HISTORY_ROUNDS` | 多轮追问时，结合最近几轮对话把追问改写成完整问题再检索（默认 3，首轮不改写） |
| `EMBEDDING_SCORE_THRESHOLD` | 检索相似度阈值（默认 0.60），低于该值的切片不作为参考资料；可结合「会话记录」中的检索得分调整 |
| `EMBEDDING_BATCH_SIZE` / `EMBEDDING_MAX_RETRIES` | 向量化时每次请求的切片数；遇到限流时的重试次数 |
| `LLM_URL` / `LLM_MODEL` / `LLM_API_KEY` | 对话模型（OpenAI 兼容） |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `MINIO_BUCKET` / `MINIO_SECURE` | MinIO 连接信息与桶名 |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB` | Redis 连接信息，默认 DB 11，键前缀 `resistor:` |
| `SESSION_EXPIRE_SECONDS` | 登录有效期（秒），默认 7200 |
| `COOKIE_SECURE` | 登录 Cookie 是否仅限 HTTPS，内网 http 访问保持 `False` |
| `MAX_WORKERS` | 后台线程池大小 |

`.env` 包含密码，已被 `.gitignore` 排除，不要提交到仓库。

## 登录与权限

- 登录后，后端在 Redis 中创建会话，并通过 HttpOnly Cookie 下发令牌。
- **每次操作都会把有效期延长到 `SESSION_EXPIRE_SECONDS`**，连续这么长时间没有操作才需要重新登录。
- 退出登录会立即作废当前会话。修改自己的密码后，该账号在所有设备（包括当前设备）上的登录都会失效，需要用新密码重新登录；管理员重置某人密码或删除用户，会让该用户的所有登录立即失效。
- 知识库、会话记录、用户管理接口仅限管理员；诊断助手接口要求登录，且只能访问自己的会话。

## 常用维护

| 操作 | 命令（在 `backend/` 下执行） |
|---|---|
| 新增管理员 | `../.venv/bin/python scripts/create_admin.py 邮箱 密码` |
| 表结构迁移（幂等，可重复执行） | `../.venv/bin/python scripts/migrate_db.py` |
| 重建 Milvus 集合（**会清空所有向量**，之后需要重新向量化全部文档） | `../.venv/bin/python scripts/recreate_milvus.py` |

更换嵌入模型时，需要同时修改 `services/knowledge_service.py` 和 `scripts/recreate_milvus.py` 中的 `DIMENSION`（bge-m3 为 1024），然后重建集合、重新向量化文档。

## 常见问题

**向量化时报「请求过于频繁」**：嵌入网关按请求次数限流。系统会自动分批并在限流时重试；如果仍然失败，可以调小 `EMBEDDING_BATCH_SIZE` 或调大 `EMBEDDING_MAX_RETRIES`，稍后在知识库页面重新向量化该文档。

**文档上传后切片内容不全或解析失败**：`.docx` 只提取正文段落，**表格中的内容不会被导入**，重要的参数表请转成文本段落后再上传；`.txt` / `.md` 需要是 UTF-8 编码。

**登录后立刻被退回登录页**：检查 Redis 是否可连通、`REDIS_*` 配置是否正确；后端日志里会有「Redis 不可用」的记录。

**回答说「暂时无法确认」**：到「会话记录」中打开该问题的检索过程，查看命中的切片和得分。如果得分都偏低或没有命中，说明知识库缺少相关内容，或者切片粒度需要调整。
