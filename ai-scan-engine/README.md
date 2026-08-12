# AI Scan Engine

扫描引擎支持 Git 仓库任务和平台上传的 ZIP 任务。ZIP 由任务消息中的 `callbacks.archiveUrl` 下载，安全解压后复用同一套目录扫描与报告流程。

独立的安全扫描 worker。它从 RabbitMQ 或 Kafka 接收平台下发的 `scan.requested` 任务，浅克隆目标 Git 仓库，先执行内置确定性安全规则，再通过 OpenAI 兼容模型进行数据流与漏洞分析，最后更新进度并上传 schema 2.0 报告。

## 工作流程

1. 消费 schema 1.0 扫描事件并持久化到 SQLite，按 `eventId` 和任务状态去重。
2. 浅克隆指定 `gitRef`，应用平台传入的目录、文件模式和漏洞类型过滤条件。
3. 检查硬编码凭据、私钥、弱哈希和命令拼接等高置信度模式。
4. 为任务领取短期模型会话，将带原始行号的源码按上下文上限分批提交给平台代理。
5. 严格解析模型 JSON，仅接受指向已提交文件和行号的发现，再与规则发现合并。
6. 使用 Bearer Token 发送状态回调，并上传平台兼容的报告 JSON。
7. RabbitMQ 在成功处理后 ACK；Kafka 在成功处理后提交 offset。模型或平台调用失败时任务由消息系统重新投递。

## AI 分析模块

实际模型分析位于 `internal/analyzer`。启动时它从 `BUILTIN_SKILL_ROOT` 读取平台的 `security-baseline-review/SKILL.md` 和 `references/sec-baseline.md`，并以该基线作为唯一扫描规范；任一文件缺失、为空、不是普通文件或过大时，引擎拒绝启动 AI 分析。它将源码视为不可信数据，限制单批上下文和总批次数，要求模型输出结构化漏洞证据，并拒绝模型虚构的文件路径或行号。供应商模型凭据只保存在平台，由平台解密并调用模型，不进入队列、引擎环境或日志。

完整扫描依据见 [扫描依据与策略](docs/scanning-strategy.md)。`internal/analyzer/policy.go` 只负责安全加载 skill、附加任务范围和批次输出契约，不再维护另一份漏洞分类或严重性规则。修改平台 skill 后需重启引擎以重新加载。

设置 `AI_ANALYSIS_ENABLED=true` 后，默认使用 `AI_MODEL_ACCESS_MODE=platform`。引擎通过管理员令牌为每个已持久化任务领取 10 分钟短期会话，同一任务的所有批次复用该会话。设置为 `false` 时仅运行内置规则，适合离线预筛选，但不等同于 AI 深度分析。`direct` 模式只用于兼容旧部署，此时才需要在引擎配置供应商 endpoint、model ID 和 API key。

## 本地运行

要求 Go 1.26、Git，以及可访问的消息中间件和平台 API。

```sh
cp .env.example .env
set -a
source .env
set +a
go run ./cmd/engine
```

RabbitMQ 使用 `QUEUE_PROTOCOL=rabbitmq` 和 `QUEUE_BROKER_URL`。队列通过 `RABBITMQ_QUEUES` 配置，并声明为支持 0-10 优先级的持久队列。

Kafka 使用 `QUEUE_PROTOCOL=kafka`、`KAFKA_BROKERS` 和 `KAFKA_TOPICS`。引擎自动同时订阅每个基础 topic 及其 `.urgent` topic，并在持续高优先级流量下为普通任务保留处理机会。

## 容器运行

```sh
cp .env.example .env
docker compose -f compose.example.yaml up --build
```

容器内需要 Git 才能克隆仓库，镜像已包含 Git、CA 证书和 SSH 客户端。平台生成的 `statusUrl`、`reportUrl` 必须从引擎容器可达；本机开发时可将平台公开基址设置为 `http://host.docker.internal:8081`。

## 主要配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `QUEUE_PROTOCOL` | `rabbitmq` | `rabbitmq` 或 `kafka` |
| `QUEUE_BROKER_URL` | 无 | RabbitMQ AMQP URL |
| `RABBITMQ_QUEUES` | 三个扫描级别队列 | 逗号分隔队列名 |
| `KAFKA_BROKERS` | 无 | 逗号分隔 broker 地址 |
| `KAFKA_TOPICS` | 三个扫描级别 topic | 基础 topic，自动追加 `.urgent` |
| `KAFKA_GROUP_ID` | `ai-scan-engine` | 普通任务 consumer group 前缀 |
| `PLATFORM_BASE_URL` | 空 | 相对回调地址的解析基址 |
| `PLATFORM_ADMIN_TOKEN` | 无 | 必填，平台回调 Bearer Token |
| `ENGINE_WORK_ROOT` | `./data/work` | 临时克隆目录 |
| `ENGINE_DATABASE_PATH` | `./data/engine.db` | SQLite 幂等状态库 |
| `MAX_FILE_BYTES` | `1048576` | 单文件扫描上限 |
| `CALLBACK_TIMEOUT_SECONDS` | `15` | 单次平台回调超时 |
| `AI_ANALYSIS_ENABLED` | `false` | 是否启用真实模型分析 |
| `AI_MODEL_ACCESS_MODE` | `platform` | `platform` 使用短期会话；`direct` 为旧版直连兼容模式 |
| `AI_MODEL_PROTOCOL` | `responses` | `responses` 或 `chat-completions` |
| `AI_MODEL_ENDPOINT` | 无 | 仅 direct 模式：OpenAI 兼容 API 基址 |
| `AI_MODEL_ID` | 无 | 仅 direct 模式：模型标识 |
| `AI_MODEL_API_KEY` | 无 | 仅 direct 模式：模型 API 密钥 |
| `BUILTIN_SKILL_ROOT` | `../plugin-raw/.github/skills/security-baseline-review` | 与平台共享的安全基线 skill 目录 |
| `AI_MODEL_TEMPERATURE` | `0.1` | 模型温度 |
| `AI_MODEL_MAX_TOKENS` | `4096` | 单批最大输出 token |
| `AI_MODEL_CONTEXT_BYTES` | `120000` | 单批上下文字节上限；约 25% 预留给 Go/Python/JavaScript/TypeScript 跨文件函数证据 |
| `AI_MODEL_MAX_BATCHES` | `0` | 单任务最大模型批次数；`0` 表示处理筛选后的全部文件 |
| `AI_MODEL_TIMEOUT_SECONDS` | `210` | 单次模型请求超时 |
| `AI_PROXY_USER_*` | 空 | 企业模型代理身份透传字段 |

## 验证

```sh
go test ./...
go vet ./...
go build ./cmd/engine
```