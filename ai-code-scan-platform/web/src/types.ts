export type ScanStatus = '待扫描' | '排队中' | '扫描中' | '扫描完成' | '扫描失败' | '已停止';
export type Severity = '严重' | '高危' | '中危' | '低危';
export type FindingStatus = '待确认' | '有效漏洞' | '误报' | '已修复' | '风险接受';
export type UserRole = '用户' | '管理员';
export type UserStatus = '正常' | '已停用';
export type QueuePriority = '普通' | '加急';
export type ScanLevel = '轻量体验' | '标准检查' | '发布审计';
export type EngineKind = 'SAST' | 'SCA' | 'Secrets' | 'AI';
export type TransactionType = '充值' | '预冻结' | '结算' | '退款' | '赠送' | '后台调整';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  company: string;
  department?: string;
  employeeNumber?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  lastLoginAt: string;
}

export interface CreditAccount {
  userId: string;
  available: number;
  frozen: number;
  lifetimeUsed: number;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  taskId?: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

export interface BillingRules {
  baseCredits: number;
  perThousandLines: number;
  deepModeMultiplier: number;
  aiEngineCredits: number;
  premiumModelCredits: number;
  urgentMultiplier: number;
}

export interface ScanEngine {
  id: string;
  name: string;
  kind: EngineKind;
  description: string;
  enabled: boolean;
  included: boolean;
  execution?: 'builtin' | 'queue' | 'http' | 'command';
  queueProtocol?: 'rabbitmq' | 'kafka' | 'rocketmq';
  brokerUrl?: string;
  requestQueue?: string;
  resultQueue?: string;
  endpoint?: string;
  command?: string;
  timeoutSeconds?: number;
}

export interface ScanQueueConfig {
  enabled: boolean;
  protocol: 'rabbitmq' | 'kafka';
  brokerUrl?: string;
  brokerUrlConfigured?: boolean;
  exchange: string;
  liteQueue: string;
  liteRoutingKey: string;
  standardQueue: string;
  standardRoutingKey: string;
  releaseQueue: string;
  releaseRoutingKey: string;
  liteTopic: string;
  standardTopic: string;
  releaseTopic: string;
  liteUrgentTopic: string;
  standardUrgentTopic: string;
  releaseUrgentTopic: string;
}

export interface AIModel {
  id: string;
  name: string;
  description: string;
  premium: boolean;
  enabled: boolean;
  contextWindow: string;
  provider?: string;
  apiProtocol?: 'chat-completions' | 'responses';
  endpoint?: string;
  modelId?: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  proxyUserNo?: string;
  proxyUserName?: string;
  proxyUserDeptName?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface FeishuConfig {
  enabled: boolean;
  webhookUrl: string;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
}

export interface PlatformNotification {
  id: string;
  userId: string;
  taskId?: string;
  title: string;
  message: string;
  read: boolean;
  channel: '站内' | '飞书';
  createdAt: string;
}

export interface DataFlowNode {
  kind: 'Source' | 'Propagator' | 'Sink';
  label: string;
  file: string;
  functionName: string;
  line: number;
  variable: string;
}

export interface CodeSnippet {
  title: string;
  file: string;
  startLine: number;
  highlightLine: number;
  code: string;
}

export interface Finding {
  id: string;
  name: string;
  severity: Severity;
  type: string;
  file: string;
  line: number;
  confidence: number;
  status: FindingStatus;
  foundAt: string;
  existence: string;
  exploitConditions: string[];
  impact: string;
  aiAnalysis: string;
  remediation: string[];
  fixedCode: string;
  evidence: { label: string; value: string; positive: boolean }[];
  dataFlow: DataFlowNode[];
  dataFlowMethod?: 'ai-context' | 'ast-assisted';
  dataFlowLimitations?: string[];
  snippets: CodeSnippet[];
  snippetUnavailableReason?: string;
  history?: { action: FindingStatus; reason?: string; at: string }[];
}

export interface ScanLog {
  time: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  stage?: string;
  progress?: number;
}

export interface ScanTask {
  id: string;
  name: string;
  product: string;
  project: string;
  creator: string;
  sourceType: 'git' | 'upload';
  source: string;
  branch?: string;
  model: string;
  mode: '标准模式' | '深度模式';
  scanLevel?: ScanLevel;
  createdAt: string;
  startedAt?: string;
  status: ScanStatus;
  stage: string;
  progress: number;
  scannedFiles: number;
  totalFiles: number;
  lines: number;
  suspected: number;
  duration: string;
  findings: Finding[];
  logs: ScanLog[];
  ownerId?: string;
  engines?: string[];
  priority?: QueuePriority;
  queuePosition?: number;
  estimatedCredits?: number;
  chargedCredits?: number;
  frozenCredits?: number;
  aiInputTokens?: number;
  aiOutputTokens?: number;
  aiTotalTokens?: number;
  aiTokenUsageEstimated?: boolean;
  aiModelId?: string;
  hasReport?: boolean;
  hasSourceCode?: boolean;
  detailLoaded?: boolean;
  remoteUpdatedAt?: string;
  reportJson?: string;
  reportMarkdown?: string;
}

export interface NewScanForm {
  product: string;
  project: string;
  model: string;
  sourceType: 'git' | 'upload';
  repositoryUrl: string;
  repositoryToken: string;
  branch: string;
  commitId: string;
  fileName: string;
  fileSize: string;
  archiveFile?: File;
  mode: '标准模式' | '深度模式';
  scanLevel: ScanLevel;
  concurrency: number;
  execution: '立即扫描' | '稍后扫描';
  excludes: string[];
  excludePatterns: string[];
  scanDirectories: string;
  vulnerabilityTypes: string[];
  saveTemplate: boolean;
  engines?: string[];
  priority?: QueuePriority;
  estimatedLines?: number;
  aiModelId?: string;
  notifyFeishu?: boolean;
}
