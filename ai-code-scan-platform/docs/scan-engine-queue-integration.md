# 扫描引擎消息队列接入指引

本文说明扫描引擎如何接收平台任务、回传执行状态和提交最终报告。平台负责鉴权、积分冻结、排队、可靠投递、日志与报告存储；仓库克隆、文件分片、扫描执行、重试和结果合并由引擎端负责。

## 1. 平台队列配置

平台支持 RabbitMQ（AMQP 0-9-1）和 Kafka。管理员可在“配置中心 → 消息投递”中选择协议：RabbitMQ 填写 Broker、Exchange 和三级队列路由；Kafka 填写逗号分隔的 broker 地址和三级 topic。保存后配置会应用于下一次 Outbox 投递，无需重启 API 服务；Broker 地址使用 AES-256-GCM 加密保存，浏览器不会读取其明文或密文。

未在配置中心保存消息投递配置时，也可以通过 API 服务环境变量提供回退配置：

```env
PUBLIC_API_BASE_URL=https://security.example.com
SCAN_QUEUE_PROTOCOL=rabbitmq
SCAN_QUEUE_BROKER_URL=amqps://platform-publisher:password@mq.example.com:5671/security
SCAN_QUEUE_EXCHANGE=security.scan
SCAN_QUEUE_LITE_NAME=security.scan.lite
SCAN_QUEUE_LITE_ROUTING_KEY=security.scan.lite.requested
SCAN_QUEUE_STANDARD_NAME=security.scan.standard
SCAN_QUEUE_STANDARD_ROUTING_KEY=security.scan.standard.requested
SCAN_QUEUE_RELEASE_NAME=security.scan.release
SCAN_QUEUE_RELEASE_ROUTING_KEY=security.scan.release.requested
```

Kafka 使用相同的名称变量表示 topic，不需要路由键和 Exchange：

```env
SCAN_QUEUE_PROTOCOL=kafka
SCAN_QUEUE_BROKER_URL=kafka-1.example.com:9092,kafka-2.example.com:9092
SCAN_QUEUE_LITE_NAME=security.scan.lite
SCAN_QUEUE_STANDARD_NAME=security.scan.standard
SCAN_QUEUE_RELEASE_NAME=security.scan.release
SCAN_QUEUE_LITE_URGENT_NAME=security.scan.lite.urgent
SCAN_QUEUE_STANDARD_URGENT_NAME=security.scan.standard.urgent
SCAN_QUEUE_RELEASE_URGENT_NAME=security.scan.release.urgent
```

三个加急 topic 变量均可省略；平台默认在对应普通 topic 后追加 `.urgent`。配置中心同样允许覆盖加急 topic 名称。

- `PUBLIC_API_BASE_URL` 必须是引擎能够访问的平台 API 地址。
- 配置中心已有消息投递配置时以配置中心为准；关闭“启用任务消息投递”会暂停 Outbox 发布，不会回退到环境变量。
- 三个 RabbitMQ 队列分别承载轻量体验、标准检查和发布审计任务；Kafka 为每个等级使用普通和加急两个 topic，共六个 topic。排队位次在各自等级内独立计算。
- 新的等级队列会声明为 RabbitMQ 优先级队列（`x-max-priority=10`）；普通消息优先级为 `0`，加急消息为 `5`。加急不会中断已经被引擎领取或正在执行的任务。
- RabbitMQ 不允许把已存在的普通队列原地改成优先级队列；如果环境中已有同名队列，请先排空后重建，或为三级队列使用新名称。
- `SCAN_QUEUE_EXCHANGE` 可以为空；为空时消息发送到 RabbitMQ 默认交换机，路由键默认使用队列名。指定交换机时，交换机需提前创建，平台会声明队列并建立绑定。
- 旧版 `SCAN_QUEUE_NAME` 与 `SCAN_QUEUE_ROUTING_KEY` 仍兼容；使用旧配置时三个等级会暂时投递到同一队列，不建议用于新部署。
- RabbitMQ 下平台会声明持久化队列，并以持久化消息发布；Kafka 下 producer 使用 `acks=all` 并同步等待 broker 确认。
- 队列连接未配置或暂时不可用时，任务仍会创建并保存在 Outbox 中，平台后台按指数退避重试，不会丢失任务。
- 平台与引擎使用独立的 RabbitMQ 账号。生产环境应使用 TLS、独立 vhost 和最小权限。

### 为什么平台使用 Outbox

如果创建任务后直接调用 RabbitMQ，会遇到数据库与消息队列无法组成同一个事务的问题：数据库提交成功但消息发送失败，会产生“平台有任务、引擎收不到”；消息发送成功但数据库提交失败，则可能产生没有平台记录的孤立扫描。

Outbox 的做法是把业务任务和待发送消息写进同一个 MySQL 事务：

1. 创建扫描任务、冻结积分并计算该等级的队列位次。
2. 同时向 `scan_dispatch_outbox` 写入完整的 `scan.requested` 消息。
3. 数据库事务成功后立即返回；此时即使 RabbitMQ 不可用，消息仍然安全保存在数据库。
4. 后台 Dispatcher 领取尚未发布的 Outbox 记录，根据 `scanLevel` 选择目标队列或 topic 并发布。
5. 收到 RabbitMQ Publisher Confirm 或 Kafka `acks=all` 确认后标记 `published_at`；失败则记录原因并退避重试。

这提供的是“至少一次投递”，不是“恰好一次投递”。极端情况下消息可能重复，因此引擎仍必须用 `eventId` 和 `task.id` 幂等处理。

## 2. 任务消息

消息 `Content-Type` 为 `application/json`，当前版本为 `1.0`：

```json
{
  "schemaVersion": "1.0",
  "eventId": "8f9e42a6-a426-4df8-9fa2-c4a79a16a292",
  "eventType": "scan.requested",
  "occurredAt": "2026-08-10T08:30:21.123456Z",
  "task": {
    "id": "92734b60-7ac7-452c-8ed8-5bbb817bf8ae",
    "projectName": "payment-service",
    "repositoryUrl": "https://git.example.com/pay/payment-service.git",
    "gitRef": "release/2.8",
    "mode": "deep",
    "scanLevel": "release",
    "priority": "urgent",
    "queuePosition": 2,
    "scanConfiguration": {
      "mode": "deep",
      "scanLevel": "release",
      "priority": "urgent",
      "aiEnabled": true,
      "aiModelId": "model-production-1",
      "excludeDirectories": ["vendor", "dist"],
      "excludePatterns": ["*.min.js", "*_generated.go"],
      "scanDirectories": ["src", "server"],
      "vulnerabilityTypes": ["SQL注入", "硬编码密钥"]
    },
    "callbacks": {
      "statusUrl": "https://security.example.com/api/v1/admin/scans/92734b60-7ac7-452c-8ed8-5bbb817bf8ae",
      "reportUrl": "https://security.example.com/api/v1/admin/scans/92734b60-7ac7-452c-8ed8-5bbb817bf8ae/report",
      "authType": "bearer",
      "header": "Authorization"
    }
  }
}
```

消息不携带平台管理令牌或供应商模型密钥。`aiModelId` 在创建任务时解析并固定，只是平台模型配置的内部标识。引擎需要通过安全配置中心或 Secret 挂载获得与平台 `ADMIN_TOKEN` 相同的回传令牌。

ZIP 上传任务使用同一消息版本和扫描配置，但不发送 `repositoryUrl`。此时 `gitRef` 为 `uploaded`，并在 `callbacks` 中增加：

```json
"archiveUrl": "https://security.example.com/api/v1/admin/scans/92734b60-7ac7-452c-8ed8-5bbb817bf8ae/source-archive"
```

引擎使用管理员 Bearer 令牌下载归档，再进入与 Git 任务相同的目录扫描流程。平台限制上传 ZIP 为 64 MiB；引擎解压时拒绝绝对路径、目录穿越和符号链接，并限制解压后总量为 256 MiB。

### 任务级模型会话

启用 AI 的任务开始分析前，引擎使用管理员令牌领取一次短期会话：

```http
POST /api/v1/admin/scans/{taskId}/model-session
Authorization: Bearer <ADMIN_TOKEN>
```

平台返回绑定 `taskId`、`aiModelId` 和过期时间的 AES-GCM 加密 token。引擎随后使用该 token 调用：

```http
POST /api/v1/model-proxy/completions
Authorization: Bearer <MODEL_SESSION_TOKEN>
Content-Type: application/json

{"system":"安全基线提示词","user":"待分析源码批次"}
```

平台代理解密已保存的供应商凭据并返回 `{"output":"..."}`。短期 token、prompt 和模型响应不得写入队列或常规日志；供应商 API key 不得下发到引擎。生产环境建议进一步使用 mTLS，让平台同时验证引擎客户端证书；管理员令牌仍用于应用层授权。

`scanLevel` 与目标的固定映射为：`lite` → 轻量体验队列/topic、`standard` → 标准检查队列/topic、`release` → 发布审计队列/topic。RabbitMQ 加急消息使用消息优先级；Kafka 加急消息发送到该等级的加急 topic，普通消息发送到基础 topic。引擎应校验消息等级与当前消费目标一致。

Kafka 引擎应为每个扫描等级同时消费普通和加急 topic。调度器优先从加急 topic 取得已持久化的作业，但不能让普通任务无限等待：建议每调度 5 个加急任务，至少调度 1 个已等待的普通任务。该优先级只决定尚未开始任务的领取顺序，不抢占已领取或正在执行的任务。两个 topic 的 offset 分别管理，消息只有在作业持久化后才能提交 offset。

新任务的回调 URL 为绝对地址。升级前已经处于排队状态的历史任务可能收到以 `/api/` 开头的相对回调地址，引擎应使用自身配置的平台基地址进行拼接。

## 3. 消费与幂等

平台采用至少一次投递语义，引擎必须支持重复消息：

1. 使用 `eventId` 去重消息，使用 `task.id` 作为扫描作业的业务唯一键。
2. 只有在任务已经持久化到引擎自己的作业表后才向 RabbitMQ ACK 或提交 Kafka offset。
3. 如果同一个 `task.id` 已经执行中或已完成，直接 ACK，不得重复启动扫描。
4. 瞬时故障使用延迟重试队列；不可恢复的消息进入死信队列并告警。
5. 引擎应保存平台任务 ID、当前状态、批次进度、报告 ID和最后回传时间，支持进程重启后续跑。

## 4. 状态回传

请求：

```http
PATCH {callbacks.statusUrl}
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

请求体：

```json
{
  "status": "indexing",
  "stage": "文件索引",
  "progress": 25,
  "statusMessage": "已完成 1,260 / 5,040 个文件索引"
}
```

可用状态及推荐阶段：

| 状态 | 含义 | 推荐进度 |
|---|---|---:|
| `queued` | 引擎已接收但尚未取得执行资源 | 0 |
| `cloning` | 获取仓库和指定 Git 引用 | 1–15 |
| `indexing` | 文件清单、过滤、语言和模块索引 | 15–35 |
| `analyzing` | 分批执行安全检查 | 35–85 |
| `normalizing` | 合并、去重和生成统一报告 | 85–99 |
| `completed` | 全部计划范围完成 | 100 |
| `partial` | 产生可用报告，但存在未完成范围 | 100 |
| `failed` | 未产生可用结果 | 当前进度 |
| `cancelled` | 任务被取消 | 当前进度 |

约束：

- 状态只能按允许的状态机前进，进度不能倒退。
- 相同状态、阶段、进度和消息的重复回传是幂等的，不会重复写日志。
- 从 `queued` 进入任一执行状态后，平台会释放该任务的队列位置，并自动更新其后任务的位次。
- `statusMessage` 面向最终用户，不得包含内部组件名称、连接串、密钥或堆栈。

示例：

```bash
curl -X PATCH "$STATUS_URL" \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"analyzing",
    "stage":"安全分析",
    "progress":60,
    "statusMessage":"已完成 18 / 30 个扫描批次"
  }'
```

## 5. 大仓库执行建议

平台只发送仓库位置和扫描配置，不发送仓库文件。引擎端建议按以下流程执行：

1. 克隆指定 `gitRef`，解析为确定的 Commit SHA 并记录。
2. 建立全量文件清单，应用 `scanDirectories`、`excludeDirectories` 和 `excludePatterns`。
3. 跳过二进制、生成目录和不可读取文件，并记录明确原因。
4. 按语言、模块和依赖关系分批；每个批次独立持久化、重试和断点续跑。
5. 批次完成后进行跨模块合并、规则统一、严重程度归一化和重复问题合并。
6. 任何未完成批次都应写入报告的 `coverage.notChecked`，最终状态使用 `partial`，不得静默标记为完整完成。

平台接受的源码快照最多 24 MiB。大仓库不应上传全部源码，只上传报告定位和 Web 证据展示需要的少量相关文件。最终 `reportJson` 最大 8 MiB，以容纳全仓扫描的完整覆盖清单。

## 6. 报告回传

建议顺序：先上传报告，成功后再把状态更新为 `completed` 或 `partial`。

```http
PUT {callbacks.reportUrl}
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

```json
{
  "schemaVersion": "2.0",
  "reportId": "report-92734b60-20260810",
  "generatedAt": "2026-08-10T09:12:30Z",
  "workspaceLabel": "payment-service@f4e3d2c",
  "reportJson": "{\"schemaVersion\":\"2.0\",\"metadata\":{...}}",
  "sourceSnapshot": {
    "gitStatus": "M server/payment.go",
    "diff": "diff --git a/server/payment.go b/server/payment.go\n...",
    "files": [
      {
        "path": "server/payment.go",
        "kind": "evidence",
        "content": "package payment\n..."
      }
    ]
  },
  "aiTokenUsage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "estimated": true
  }
}
```

注意：

- `reportId` 在一个任务内必须稳定。相同 `reportId` 重试是幂等的；不同 `reportId` 覆盖已存在报告会被拒绝。
- `reportJson` 必须符合平台 `schemaVersion: 2.0` 的结构化报告规范，摘要计数必须与问题列表一致。
- `sourceSnapshot.files[].path` 必须是相对 POSIX 路径，`kind` 只能是 `changed`、`test`、`config` 或 `evidence`。
- 平台会再次应用扫描目录、排除目录、通配符和文件白名单。
- 如果没有模型 Token 数据，使用全零并保留 `estimated: true`，不要伪造用量。

报告上传成功后：

```bash
curl -X PATCH "$STATUS_URL" \
  -H "Authorization: Bearer $PLATFORM_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "status":"completed",
    "stage":"扫描完成",
    "progress":100,
    "statusMessage":"扫描完成，报告已生成"
  }'
```

## 7. 失败和部分完成

- 仓库不存在、凭据无效或 Git 引用不存在：回传 `failed`，给出用户可理解的原因。
- 个别批次超时但已有有效结果：生成报告，在 `coverage.notChecked` 说明缺失范围，回传 `partial`。
- 队列消费后暂时没有执行资源：保持 `queued`，可以回传“扫描中心已接收，等待执行资源”。
- 回传平台出现 5xx 或网络超时：按相同请求体重试。
- 回传平台出现 401：停止重试并告警，检查引擎端令牌配置。
- 回传平台出现 422：视为协议或状态机错误，记录响应内容并进入人工处理队列。

## 8. 联调检查表

- [ ] 平台能连接 RabbitMQ，Outbox 消息最终变为已发布。
- [ ] Kafka 普通与加急消息分别进入基础 topic 和 `.urgent` topic，引擎按 5:1 上限防止普通任务饥饿。
- [ ] 引擎收到重复 `eventId` 时只创建一个作业。
- [ ] 引擎能访问消息中的两个回调 URL。
- [ ] `ADMIN_TOKEN` 只通过 Secret 注入，不写入消息和日志。
- [ ] 引擎可领取任务级模型会话并调用平台代理，供应商 API key 未进入引擎。
- [ ] 任务开始后平台队列位次变为 0，后续任务位次前移。
- [ ] 状态进度单调递增，用户日志不包含内部组件信息。
- [ ] 相同 `reportId` 重试不会生成重复报告日志。
- [ ] 大仓库的未检查范围在报告中明确展示。
