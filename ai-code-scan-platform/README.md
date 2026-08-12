# AI 代码扫描平台

Go + MySQL 实现的代码扫描控制面，以及 React + TypeScript 实现的商业化 AI 代码安全扫描平台。当前版本提供 Remote Skill 注册、不可变版本管理、插件扫描任务生命周期、Git 仓库全量扫描任务 API，以及可交互的账号、计费、扫描与漏洞研判界面。

插件在本地构建受限代码上下文，并交给 VS Code Chat/Agent 窗口当前选择的模型。源码快照只保留代码、依赖清单、容器/IaC 和安全相关配置文件，文档、媒体、构建产物及二进制文件不会上传。扫描结束后，插件上传任务元数据、结构化报告和经过过滤的证据源码快照。

## 启动

要求 Go 1.26、Docker 和 Docker Compose。

```bash
cp .env.example .env
docker compose up --build -d
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

Compose 会启动 MySQL 8.4、执行 `migrations/` 中的迁移，然后启动 API 和 Web。浏览器访问 `http://localhost:5173`。首次启动使用 `.env` 中的 `BOOTSTRAP_ADMIN_EMAIL` 和 `BOOTSTRAP_ADMIN_PASSWORD` 登录；密码至少 12 个字符。引导变量只创建不存在的管理员，不会覆盖已有密码或重复发放 Credit。默认值仅适合本地开发，部署前必须修改所有 Token 和密码。

不使用容器运行 API：

```bash
export MYSQL_DSN='ai_code_scan:password@tcp(127.0.0.1:3306)/ai_code_scan?parseTime=true'
export ADMIN_TOKEN='replace-with-a-long-random-token'
export BOOTSTRAP_ADMIN_EMAIL='admin@example.com'
export BOOTSTRAP_ADMIN_PASSWORD='replace-with-at-least-12-characters'
export BOOTSTRAP_ADMIN_CREDITS='1000'
go run ./cmd/api
```

## Remote Skill

注册并设为插件默认 Skill：

```bash
curl -X POST http://localhost:8080/api/v1/admin/skills \
	-H 'Authorization: Bearer replace-with-a-long-random-token' \
	-H 'Content-Type: application/json' \
	-d '{
		"name": "security-baseline",
		"sourceUrl": "https://example.com/SKILL.md",
		"isDefault": true
	}'
```

刷新指定来源：

```bash
curl -X POST http://localhost:8080/api/v1/admin/skills/1/refresh \
	-H 'Authorization: Bearer replace-with-a-long-random-token'
```

插件解析默认 Skill：

```bash
curl -i http://localhost:8080/api/v1/plugin/skills/resolve
```

解析响应包含 `skillId`、`name`、`version`、`sha256`、`content` 和 `expiresAt`，并返回 `ETag`。插件可通过 `If-None-Match` 获取 `304 Not Modified`。

Remote Skill 下载仅接受 HTTPS，禁止 URL 凭据、私网/Loopback/Link-local 地址，最多跟随 5 次重定向，默认限制为 256 KiB。

## 插件扫描任务

插件开始审查时调用 `POST /api/v1/plugin/scans` 创建匿名免费任务，随后调用 `PATCH /api/v1/plugin/scans/{id}` 更新阶段、进度和状态，并调用 `PUT /api/v1/plugin/scans/{id}/report` 上传中文报告。Web 工作台每 2 秒读取 `GET /api/v1/plugin/scans`，实时展示插件任务。

每个用户在个人中心轮换自己的扫描接入密钥。服务端仅保存密钥哈希；VS Code 插件将密钥保存到 SecretStorage，并作为 `/api/v1/plugin/*` 的 Bearer 凭据。服务端按密钥识别用户、校验任务所有权并统计 Credit 消耗。可在命令面板运行 **PI Security Review: 配置扫描接入密钥** 更换或清除本地密钥。任务列表只返回元数据和 `hasReport`，不直接返回报告内容。

任务状态转换由服务端校验，进度不能倒退。当前阶段包括加载安全基线、收集变更上下文、安全风险初筛、AI 深度审计、漏洞去重与报告生成；完成和失败都会写回平台。

## 旧版插件审查网关

在“配置中心 → AI 模型”中新增并启用 OpenAI 兼容模型，选择 Chat Completions 或 Responses API 协议，并填写 API 地址、模型标识和 API 密钥。平台使用 AES-256-GCM 加密密钥后持久化，读取配置时仅返回是否已配置，不返回明文或密文。编辑已有模型时留空表示保留原密钥。

在“配置中心 → 消息投递”中可启用 RabbitMQ 或 Kafka 任务投递。RabbitMQ 可配置 Exchange、三级队列及路由键；Kafka 为每个扫描等级配置普通和加急 topic，加急 topic 默认使用 `.urgent` 后缀。配置保存后动态生效，Broker 地址加密持久化；尚未保存 UI 配置时仍兼容 `SCAN_QUEUE_*` 环境变量。

平台首次启动会在 `MODEL_KEY_PATH`（默认 `./data/model-key`）生成权限为 `0600` 的随机主密钥文件。Docker Compose 使用独立持久卷保存该文件；备份或迁移数据库时必须同时安全备份该主密钥，否则已有模型密钥无法解密。

管理员在“配置中心 → 消息投递”中配置飞书应用机器人的 App ID 和 App Secret，保存后动态生效。App Secret 使用平台主密钥加密且不会回显；尚未保存 UI 配置时仍兼容 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 环境变量。应用需拥有发送消息权限，用户在飞书中的邮箱需与平台账号邮箱一致，`FEISHU_API_BASE_URL` 默认使用 `https://open.feishu.cn`。

扫描进入完成、部分完成或失败状态后，平台按任务所属用户在个人中心启用的通道发送结果摘要。应用机器人与个人 Webhook 可独立启用；两者同时启用时各发送一份。Webhook 地址使用平台主密钥加密保存且不会回显。

模型编辑弹窗中的“测试连通性”会实时调用 `POST /api/v1/models/test-connection`，使用当前输入的新密钥或已保存密钥执行一次最多 8 tokens 的轻量请求，并显示响应耗时。

需要调用方身份的 OpenAI 兼容代理可在模型配置中填写代理用户工号、姓名和部门。平台分别发送 `x-user-no`、`x-user-name` 和 `x-user-dept-name` 请求头，并对姓名和部门进行 URI 编码。

`POST /api/v1/plugin/reviews` 保留用于旧版调用方。新版 VS Code 插件不再使用平台外部模型，而是使用 VS Code 当前模型。

网关默认限制为 2 MiB 请求体、120 秒上游超时和 4 个并发请求；可通过 `REVIEW_MAX_BYTES`、`REVIEW_TIMEOUT_SECONDS` 和 `REVIEW_MAX_CONCURRENT` 调整。并发已满时立即返回 HTTP 429，未配置可用模型时返回 HTTP 503。

## 全量扫描任务

先登录并保存 HttpOnly 会话 Cookie：

```bash
curl -c /tmp/secscan-cookie -X POST http://localhost:8080/api/v1/auth/login \
	-H 'Content-Type: application/json' \
	-d '{"email":"admin@example.com","password":"replace-with-at-least-12-characters"}'

curl -X POST http://localhost:8080/api/v1/scans \
	-b /tmp/secscan-cookie \
	-H 'Content-Type: application/json' \
	-d '{
		"projectName": "payments",
		"repositoryUrl": "https://git.example.com/team/payments.git",
		"gitRef": "main",
		"estimatedLines": 20000,
		"mode": "deep",
		"priority": "normal",
		"aiEnabled": true,
		"premiumModel": true,
		"excludeDirectories": ["node_modules", "dist"],
		"excludePatterns": ["*.min.js", "*_generated.go"],
		"scanDirectories": ["src", "server"],
		"vulnerabilityTypes": ["SQL注入", "硬编码密钥"]
	}'
```

查询任务：

```bash
curl -b /tmp/secscan-cookie http://localhost:8080/api/v1/scans/SCAN_TASK_ID
```

用户身份只从服务端会话读取。创建任务时，后端计算费用，并在同一数据库事务中写入任务、扫描范围配置、预冻结 Credit、对应等级的队列位置、Credit 流水和待发布消息；请求不能指定用户或费用。平台通过 RabbitMQ 或 Kafka 将轻量体验、标准检查、发布审计分别投递到独立队列或 topic，Kafka 加急任务使用独立的 `.urgent` topic，采用 Outbox 和后台重试保证至少一次投递。仓库克隆、索引、分批扫描和结果合并由引擎端执行。引擎通过受管理员令牌保护的状态与报告接口回传结果，服务端会再次应用目录、通配符和代码文件白名单。完整协议见 [扫描引擎消息队列接入指引](docs/scan-engine-queue-integration.md)。

任务创建、阶段更新和报告保存都会追加到 `scan_task_logs`。详情接口按时间返回完整日志；迁移前的历史任务会回填最后一次已知状态，迁移后的任务保留完整阶段记录。

## Web 工作台

Web 覆盖以下产品流程：

- 服务端邮箱密码登录、HttpOnly 会话、退出和个人中心。
- 服务端 Credit 余额、预冻结和流水查询。
- SAST、SCA、敏感信息和 AI 深度审计多引擎组合扫描。
- AI 模型选择、标准/深度模式和普通/加急队列调度。
- 六步扫描向导、余额检查和飞书/站内结果通知。
- Git 仓库或代码压缩包扫描任务创建。
- 扫描阶段、文件数、代码行与执行日志展示。
- 任务搜索、状态筛选、删除、重扫和报告下载。
- 漏洞等级、类型与人工研判状态筛选。
- AI 判断依据、跨文件 Source → Sink 数据流和关键代码片段。
- 有效漏洞、误报、风险接受与已修复确认。
- 管理后台计费规则、扫描引擎、AI 模型、用户余额和队列监控。

Web 的登录、当前用户、Credit 账户、Credit 流水和新建平台任务均以服务端为准。旧 `platform_state` JSON 继续承载配置和演示内容，但不是账户或账本的权威数据；页面内旧演示任务仍模拟进度，服务端平台任务和 VS Code 插件任务不参与浏览器模拟推进。

本地前端开发：

```bash
npm --prefix web ci
npm --prefix web run dev
```

Vite 从 `http://127.0.0.1:8080` 启动，并将 `/api`、`/healthz` 和 `/readyz` 代理到本地 Go API 的 `http://localhost:8081`。因此浏览器与插件统一使用 `http://127.0.0.1:8080`。

生产构建验证：

```bash
npm --prefix web run build
```

## 产品目录与企业 SSO

新建扫描中的产品由产品目录原生接口 `POST /product-catalog-service/api/product/getProductsApi` 提供。Go API 复用 `SSO_UAC_GATEWAY` 和当前登录用户的 UAC `P-Auth`、`P-Rtoken` 调用该接口，浏览器不会接触 UAC 令牌。服务重启或令牌失效后，用户需要退出并重新通过 UAC 登录。任务会持久化产品 ID 和名称，并在重扫及扫描引擎消息中保留归属。可通过 `PRODUCT_CATALOG_TIMEOUT_SECONDS` 调整请求超时。

企业登录支持 UAC 和标准 OAuth2 Authorization Code。先配置 `SSO_AUTH_ENABLED=true`、`SSO_FRONTEND_URL` 和 `SSO_REDIRECT_URI`。UAC 模式的 redirect URI 指向前端 `/sso/callback`，由页面合并 query 与 URL fragment 后提交同源后端；同时配置 `SSO_PROVIDER=uac`、`SSO_UAC_GATEWAY`、`SSO_UAC_APP_ID`。OAuth2 模式的 redirect URI 指向 `/api/v1/auth/sso/callback`，并填写其他 provider 名称、`SSO_CLIENT_ID`、`SSO_CLIENT_SECRET`、`SSO_AUTHORIZE_URL`、`SSO_TOKEN_URL` 和 `SSO_USERINFO_URL`。字段映射可通过 `SSO_USER_ID_FIELD`、`SSO_USER_NAME_FIELD`、`SSO_USER_EMAIL_FIELD` 调整。

SSO 回调验证短期 state 后创建现有 HttpOnly 会话。首次登录会自动新增用户与 Credit 账户；同邮箱本地用户会绑定企业身份。姓名、工号、部门、认证来源和最近登录时间会进入用户管理数据。

## 开发

```bash
make test
make up
make logs
make down
```

主要目录：

- `cmd/api/`：HTTP 服务入口。
- `internal/skill/`：Skill 领域逻辑及 HTTP/MySQL Adapter。
- `internal/scan/`：全量扫描任务领域逻辑及 HTTP/MySQL Adapter。
- `migrations/`：MySQL schema。
- `web/`：React 扫描工作台及 Nginx 容器配置。
