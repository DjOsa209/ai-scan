import type { AIModel, BillingRules, CreditAccount, CreditTransaction, PlatformNotification, PlatformUser, ScanEngine, ScanQueueConfig, ScanTask } from './types.ts';
import { BEIJING_OFFSET_MINUTES, formatBeijingDateTime } from './beijingTime.ts';

export interface PlatformState {
  tasks: ScanTask[];
  users: PlatformUser[];
  accounts: CreditAccount[];
  transactions: CreditTransaction[];
  billingRules: BillingRules;
  engines: ScanEngine[];
  scanQueue: ScanQueueConfig;
  aiModels: AIModel[];
  notifications: PlatformNotification[];
  feishuEnabled: boolean;
  feishuApplication: FeishuApplicationConfig;
}

export interface FeishuApplicationConfig {
  appId: string;
  appSecret?: string;
  appSecretConfigured: boolean;
}

interface Snapshot {
  revision: number;
  state: PlatformState;
}

interface ModelConnectionResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface PlatformScanTask {
  id: string;
  projectName: string;
  repositoryUrl: string;
  repositoryToken?: string;
  gitRef: string;
  status: 'queued' | 'cloning' | 'indexing' | 'analyzing' | 'normalizing' | 'completed' | 'partial' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  statusMessage: string;
  queuePosition: number;
  createdAt: string;
  updatedAt: string;
  source: 'plugin' | 'platform';
  actorType: 'anonymous' | 'user';
  actorId?: string;
  creatorName: string;
  creatorEmployeeNo: string;
  billingMode: 'free' | 'credit';
  estimatedCredits: number;
  chargedCredits: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiTokenUsageEstimated: boolean;
  hasReport: boolean;
  hasSourceCode: boolean;
  scannedFiles: number;
  codeLines: number;
  findingCount: number;
  scanConfiguration?: {
	productId?: string;
	productName?: string;
    mode?: 'standard' | 'deep';
    scanLevel?: 'lite' | 'standard' | 'release';
    priority?: 'normal' | 'urgent';
    excludeDirectories?: string[];
    excludePatterns?: string[];
    scanDirectories?: string[];
    vulnerabilityTypes?: string[];
  };
}

export interface PlatformScanDetail extends PlatformScanTask {
  reportJson?: string;
  reportMarkdown?: string;
  sourceSnapshot: {
    gitStatus: string;
    diff: string;
    files: Array<{ path: string; kind: string; content: string }> | null;
  };
  logs: Array<{
    level: 'info' | 'success' | 'warning' | 'error';
    stage: string;
    progress: number;
    message: string;
    createdAt: string;
  }>;
}

export interface SecurityReport {
  schemaVersion: '2.0';
  metadata: { baseline: 'sec-baseline.md'; scope: string; generatedAt: string };
  result: 'pass' | 'findings' | 'incomplete';
  summary: { critical: number; high: number; medium: number; low: number; manualReview: number };
  findings: Array<{
    id: string; title: string; severity: 'critical' | 'high' | 'medium' | 'low'; rule: string;
    locations: Array<{ path: string; line: number }>; confidence: 'high' | 'medium' | 'low';
    evidence: string; impact: string; remediation: string; verification: string;
    dataFlow?: {
      analysisMethod: 'ai-context' | 'ast-assisted';
      nodes: Array<{ kind: 'source' | 'propagator' | 'sink'; label: string; path: string; line: number; symbol: string; expression: string }>;
      limitations: string[];
    };
  }>;
  manualReview: Array<{ id: string; title: string; rule: string; reason: string; requiredEvidence: string }>;
  coverage: { checked: string[]; notChecked: string[]; tools: string[] };
}

export interface ScanStatistics {
  trend: Array<{ date: string; completed: number }>;
  currentPeriodCompleted: number;
  previousPeriodCompleted: number;
  changePercent: number | null;
  riskDistribution: { critical: number; high: number; medium: number; low: number };
  aiTokenUsage: { taskCount: number; inputTokens: number; outputTokens: number; totalTokens: number };
}

export interface AuthUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: string;
  name?: string;
  employeeNo?: string;
  department?: string;
  authProvider: string;
  lastLoginAt?: string;
}

export interface ProductCatalogItem {
  id: number;
  name: string;
  groupName?: string;
  repoName?: string;
  code?: string;
  state?: number;
}

export interface AuthConfig {
  ssoEnabled: boolean;
  ssoLoginUrl: string;
}

export interface NotificationPreference {
  applicationEnabled: boolean;
  webhookEnabled: boolean;
  webhookConfigured: boolean;
}

export interface UserAPIKeyStatus {
  userId: string;
  email: string;
  role: 'user' | 'admin';
  active: boolean;
  createdAt: string;
  configured: boolean;
  keyPrefix?: string;
  apiKey?: string;
  updatedAt?: string;
  name?: string;
  employeeNo?: string;
  department?: string;
  authProvider?: string;
  lastLoginAt?: string;
}

export interface AdminCreditAccount extends CreditAccount {
  email: string;
  role: 'user' | 'admin';
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlatformScanInput {
  projectName: string;
  productId?: string;
  productName?: string;
  repositoryUrl: string;
  gitRef: string;
  estimatedLines: number;
  mode: 'standard' | 'deep';
  scanLevel: 'lite' | 'standard' | 'release';
  priority: 'normal' | 'urgent';
  aiEnabled: boolean;
  aiModelId?: string;
  premiumModel: boolean;
  excludeDirectories: string[];
  excludePatterns: string[];
  scanDirectories: string[];
  vulnerabilityTypes: string[];
}

export async function loadAuthConfig(): Promise<AuthConfig> {
  const response = await fetch('/api/v1/auth/config', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载登录配置失败');
  return response.json() as Promise<AuthConfig>;
}

export async function submitUACCallback(state: string, params: Record<string, string>): Promise<{ next: string }> {
  const response = await fetch('/api/v1/auth/sso/uac/callback', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state,
      token: params.token,
      rtoken: params.rtoken,
      employeeNo: params.employeeNo,
      params,
    }),
  });
  if (!response.ok) throw await apiError(response, '统一身份认证回调失败');
  return response.json() as Promise<{ next: string }>;
}

export async function loadProducts(): Promise<ProductCatalogItem[]> {
  const response = await fetch('/api/v1/products', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载产品目录失败');
  return response.json() as Promise<ProductCatalogItem[]>;
}

async function apiError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { message?: string };
  return new Error(body.message || `${fallback}（HTTP ${response.status}）`);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await apiError(response, '登录失败');
  return response.json() as Promise<AuthUser>;
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '退出登录失败');
}

export async function me(): Promise<AuthUser> {
  const response = await fetch('/api/v1/auth/me', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '会话恢复失败');
  return response.json() as Promise<AuthUser>;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch('/api/v1/auth/password', {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (response.status === 401) throw new Error('当前密码不正确');
  if (response.status === 400) throw new Error('新密码长度需为 12 至 128 个字符');
  if (!response.ok) throw await apiError(response, '修改密码失败');
}

export async function rotateAPIKey(): Promise<string> {
  const response = await fetch('/api/v1/auth/api-key', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '生成扫描接入密钥失败');
  const result = await response.json() as { apiKey: string };
  return result.apiKey;
}

export async function loadMyAPIKey(): Promise<UserAPIKeyStatus> {
  const response = await fetch('/api/v1/auth/api-key', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载 API Key 失败');
  return response.json() as Promise<UserAPIKeyStatus>;
}

export async function loadNotificationPreference(): Promise<NotificationPreference> {
  const response = await fetch('/api/v1/notifications/preferences', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载飞书通知设置失败');
  return response.json() as Promise<NotificationPreference>;
}

export async function saveNotificationPreference(applicationEnabled: boolean, webhookEnabled: boolean, webhookUrl: string): Promise<NotificationPreference> {
  const response = await fetch('/api/v1/notifications/preferences', {
    method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationEnabled, webhookEnabled, webhookUrl }),
  });
  if (!response.ok) throw await apiError(response, '保存飞书通知设置失败');
  return response.json() as Promise<NotificationPreference>;
}

export async function testNotificationWebhook(): Promise<void> {
  const response = await fetch('/api/v1/notifications/webhook/test', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '发送 Webhook 测试消息失败');
}

export async function loadUserAPIKeyStatuses(): Promise<UserAPIKeyStatus[]> {
  const response = await fetch('/api/v1/admin/users/api-keys', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载用户扫描密钥失败');
  return response.json() as Promise<UserAPIKeyStatus[]>;
}

export async function rotateUserAPIKey(user: { id: string; email: string; role: 'user' | 'admin' }): Promise<{ userId: string; apiKey: string }> {
  const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(user.id)}/api-key`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, role: user.role }),
  });
  if (!response.ok) throw await apiError(response, '生成用户 API Key 失败');
  return response.json() as Promise<{ userId: string; apiKey: string }>;
}

export async function loadCreditAccount(): Promise<CreditAccount> {
  const response = await fetch('/api/v1/credits', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载 Credit 账户失败');
  return response.json() as Promise<CreditAccount>;
}

export async function loadCreditTransactions(): Promise<CreditTransaction[]> {
  const response = await fetch('/api/v1/credits/transactions', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载 Credit 流水失败');
  const transactions = await response.json() as Array<Omit<CreditTransaction, 'taskId' | 'type'> & { scanTaskId?: string; type: string }>;
  const typeNames: Record<string, CreditTransaction['type']> = {
    grant: '赠送', freeze: '预冻结', settlement: '结算', charge: '结算', refund: '退款', recharge: '充值', adjustment: '后台调整',
  };
  return transactions.map(({ scanTaskId, type, ...transaction }) => ({
    ...transaction, createdAt: formatBeijingDateTime(transaction.createdAt), taskId: scanTaskId, type: typeNames[type] ?? '后台调整',
  }));
}

export async function loadAdminCreditAccounts(): Promise<AdminCreditAccount[]> {
  const response = await fetch('/api/v1/admin/credits/accounts', { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载用户 Credit 账户失败');
  return response.json() as Promise<AdminCreditAccount[]>;
}

export async function grantUserCredits(userId: string, amount: number, description = '管理后台增加积分'): Promise<{ userId: string; available: number }> {
  const response = await fetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/credits`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, description }),
  });
  if (!response.ok) throw await apiError(response, '增加积分失败');
  return response.json() as Promise<{ userId: string; available: number }>;
}

export async function createPlatformScan(input: CreatePlatformScanInput): Promise<PlatformScanTask> {
  const response = await fetch('/api/v1/scans', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!response.ok) throw await apiError(response, '创建平台扫描失败');
  return response.json() as Promise<PlatformScanTask>;
}

export async function createPlatformArchiveScan(input: CreatePlatformScanInput, archive: File): Promise<PlatformScanTask> {
  const body = new FormData();
  body.set('metadata', JSON.stringify(input));
  body.set('archive', archive);
  const response = await fetch('/api/v1/scans/archive', {
    method: 'POST', credentials: 'same-origin', body,
  });
  if (!response.ok) throw await apiError(response, '创建压缩包扫描失败');
  return response.json() as Promise<PlatformScanTask>;
}

export async function loadRepositoryBranches(repositoryUrl: string, repositoryToken: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/v1/repositories/branches', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ repositoryUrl, repositoryToken }),
  });
  if (!response.ok) throw await apiError(response, '加载仓库分支失败');
  const result = await response.json() as { branches: string[] };
  return result.branches;
}

export async function rescanPlatformScan(taskId: string): Promise<PlatformScanTask> {
  const response = await fetch(`/api/v1/scans/${encodeURIComponent(taskId)}/rescan`, {
    method: 'POST', credentials: 'same-origin',
  });
  if (!response.ok) throw await apiError(response, '重新扫描失败');
  return response.json() as Promise<PlatformScanTask>;
}

export async function loadMyScans(limit = 20, offset = 0): Promise<PlatformScanTask[]> {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  const response = await fetch(`/api/v1/scans?${query}`, { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载我的扫描任务失败');
  return response.json() as Promise<PlatformScanTask[]>;
}

export async function loadScanStatistics(): Promise<ScanStatistics> {
  const query = new URLSearchParams({ timezoneOffsetMinutes: String(BEIJING_OFFSET_MINUTES) });
  const response = await fetch(`/api/v1/scans/statistics?${query}`, { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载扫描统计失败');
  return response.json() as Promise<ScanStatistics>;
}

export async function loadScanDetail(taskId: string): Promise<PlatformScanDetail> {
  const response = await fetch(`/api/v1/scans/${encodeURIComponent(taskId)}`, { credentials: 'same-origin' });
  if (!response.ok) throw await apiError(response, '加载扫描详情失败');
  return response.json() as Promise<PlatformScanDetail>;
}

export async function deletePlatformScan(taskId: string): Promise<void> {
  const response = await fetch(`/api/v1/scans/${encodeURIComponent(taskId)}`, {
    method: 'DELETE', credentials: 'same-origin',
  });
  if (!response.ok) throw await apiError(response, '删除扫描任务失败');
}

export async function loadPlatformState(initialState: PlatformState): Promise<Snapshot> {
  const response = await fetch('/api/v1/platform/state', { credentials: 'same-origin' });
  if (response.status === 404) return { revision: 0, state: initialState };
  if (!response.ok) throw new Error(`加载平台数据失败（HTTP ${response.status}）`);
  return response.json() as Promise<Snapshot>;
}

export async function savePlatformState(revision: number, state: PlatformState, conflictRetries = 2): Promise<Snapshot> {
  const response = await fetch('/api/v1/platform/state', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, state }),
  });
  if (response.status === 409 && conflictRetries > 0) {
    const latestResponse = await fetch('/api/v1/platform/state', { credentials: 'same-origin' });
    if (!latestResponse.ok) throw new Error(`刷新平台数据失败（HTTP ${latestResponse.status}）`);
    const latest = await latestResponse.json() as Snapshot;
    return savePlatformState(latest.revision, state, conflictRetries - 1);
  }
  if (!response.ok) throw new Error(`保存平台数据失败（HTTP ${response.status}）`);
  return response.json() as Promise<Snapshot>;
}

export async function testModelConnection(model: AIModel): Promise<ModelConnectionResult> {
  const response = await fetch('/api/v1/models/test-connection', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: model.id,
      apiProtocol: model.apiProtocol ?? 'chat-completions',
      endpoint: model.endpoint,
      modelId: model.modelId,
      apiKey: model.apiKey ?? '',
      proxyUserNo: model.proxyUserNo ?? '',
      proxyUserName: model.proxyUserName ?? '',
      proxyUserDeptName: model.proxyUserDeptName ?? '',
      temperature: model.temperature ?? 0.1,
    }),
  });
  const result = await response.json() as ModelConnectionResult & { error?: string };
  if (!response.ok) throw new Error(result.error || `连通性测试失败（HTTP ${response.status}）`);
  return result;
}
