import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowLeft, BarChart3, Bot, Box, Check, CheckCircle2, ChevronDown,
  ChevronLeft, ChevronRight, CircleUserRound, Clipboard, Clock3, Code2, Coins, Copy, Database, Download,
  ExternalLink, FileArchive, FileCode2, FileDown, FileSearch, Filter, GitBranch,
  KeyRound, Layers3, LayoutDashboard, ListFilter, LoaderCircle, LogOut, Menu, MoreHorizontal,
  Network, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Settings2,
  Shield, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Square, Trash2, Upload,
  UserCog, Users, Wallet, X, XCircle,
} from 'lucide-react';
import { defaultBillingRules, defaultExcludes, defaultPatterns, scanStages, seedAccounts, seedEngines, seedModels, seedNotifications, seedTasks, seedTransactions, seedUsers, vulnerabilityTypes } from './data';
import {
  changeAdminPassword, createPlatformArchiveScan, createPlatformScan, deletePlatformScan, grantUserCredits, loadAdminCreditAccounts, loadAuthConfig, loadCreditAccount, loadCreditTransactions, loadMyAPIKey, loadMyScans, loadNotificationPreference, loadPlatformState, loadProducts, loadRepositoryBranches, loadScanDetail, loadScanStatistics, loadUserAPIKeyStatuses,
  login as loginApi, logout as logoutApi, me, rescanPlatformScan, rotateAPIKey, rotateUserAPIKey, saveNotificationPreference, savePlatformState, submitUACCallback, testModelConnection, testNotificationWebhook,
  type AdminCreditAccount, type AuthUser, type FeishuApplicationConfig, type PlatformScanDetail, type PlatformScanTask, type PlatformState, type ProductCatalogItem, type ScanStatistics, type SecurityReport, type UserAPIKeyStatus,
} from './api';
import type { AIModel, BillingRules, CreditAccount, CreditTransaction, Finding, FindingStatus, NewScanForm, PlatformNotification, PlatformUser, ScanEngine, ScanLevel, ScanQueueConfig, ScanStatus, ScanTask, Severity } from './types';
import { formatBeijingDate, formatBeijingDateTime, formatBeijingTime } from './beijingTime';
import { authenticatedScanTasks, mergeRemoteTaskSummaries } from './scanTaskSource';
import { buildEvidenceSnippets, snippetUnavailableReason, type EvidenceLocation } from './sourceSnippets';
import { buildPlatformScanInput } from './scanSubmission';
import { mergeTaskDetail, scannedFileCount } from './scanDetail';
import { averageTokenRate, formatScanElapsed, formatTokenCount, scanElapsedSeconds } from './scanProgress';
import { isValidTimestamp, sanitizeUserVisibleText, userVisibleStage } from './taskPresentation';

type NavKey = 'dashboard' | 'scan' | 'credits' | 'config' | 'users' | 'profile' | 'platform';
type TaskPageState = { type: 'logs' | 'report'; task: ScanTask; loading?: boolean; error?: string } | null;

const navKeys: NavKey[] = ['dashboard', 'scan', 'credits', 'config', 'users', 'profile', 'platform'];
const runtimeSections = ['AI 模型', '扫描引擎', '消息投递'] as const;

const models = ['SecAgent-Pro', 'SecAgent-Lite', 'DeepAudit-R1'];
const severityOrder: Severity[] = ['严重', '高危', '中危', '低危'];
const progressMilestones = [0, 15, 35, 60, 85, 100];
const scanPageSize = 20;
const findingPageSize = 10;
const defaultFeishuApplication: FeishuApplicationConfig = { appId: '', appSecretConfigured: false };
const defaultScanQueue: ScanQueueConfig = {
  enabled: false,
  protocol: 'rabbitmq',
  exchange: 'security.scan',
  liteQueue: 'security.scan.lite',
  liteRoutingKey: 'security.scan.lite.requested',
  standardQueue: 'security.scan.standard',
  standardRoutingKey: 'security.scan.standard.requested',
  releaseQueue: 'security.scan.release',
  releaseRoutingKey: 'security.scan.release.requested',
  liteTopic: 'security.scan.lite',
  standardTopic: 'security.scan.standard',
  releaseTopic: 'security.scan.release',
  liteUrgentTopic: 'security.scan.lite.urgent',
  standardUrgentTopic: 'security.scan.standard.urgent',
  releaseUrgentTopic: 'security.scan.release.urgent',
};

const initialForm: NewScanForm = {
  product: '', project: '', model: '系统智能组合', sourceType: 'git', repositoryUrl: '', repositoryToken: '', branch: 'main', commitId: '', fileName: '', fileSize: '', mode: '标准模式', scanLevel: '标准检查', concurrency: 2, execution: '立即扫描', excludes: defaultExcludes, excludePatterns: defaultPatterns, scanDirectories: '', vulnerabilityTypes, saveTemplate: false, engines: ['engine-sast', 'engine-sca', 'engine-ai'], priority: '普通', estimatedLines: 20000, notifyFeishu: true,
};

const scanLevelProfiles: Record<ScanLevel, {
  tagline: string;
  description: string;
  audience: string;
  stage: string;
  duration: string;
  basis: string;
  mode: NewScanForm['mode'];
  engines: string[];
  aiEnabled: boolean;
  premiumModel: boolean;
}> = {
  轻量体验: {
    tagline: '最快看到结果',
    description: '快速发现明显风险，结果精简，适合验证流程和做演示。',
    audience: '产品、运营、非技术人员',
    stage: 'Demo、原型和内部展示',
    duration: '约 3–8 分钟',
    basis: '平台安全基线；4 项确定性预筛；单文件直接风险；不启用 AI 推断',
    mode: '标准模式',
    engines: ['engine-sast'],
    aiEnabled: false,
    premiumModel: false,
  },
  标准检查: {
    tagline: '速度与覆盖平衡',
    description: '覆盖常见代码与依赖风险，并对重点问题做进一步判断。',
    audience: '开发、测试和技术负责人',
    stage: '开发联调、提测和日常检查',
    duration: '约 10–25 分钟',
    basis: '平台 security-baseline-review；所选检查项；同批次证据链与门禁验证',
    mode: '标准模式',
    engines: ['engine-sast', 'engine-sca', 'engine-ai'],
    aiEnabled: true,
    premiumModel: false,
  },
  发布审计: {
    tagline: '结果最完整',
    description: '执行更全面的交叉验证与深度分析，尽可能降低遗漏。',
    audience: '研发、安全和发布负责人',
    stage: '发版上线、重大变更和安全验收',
    duration: '约 45–120 分钟，后台运行',
    basis: '平台安全基线全部检查；多文件信任边界；配置、依赖、测试与 AI 门禁',
    mode: '深度模式',
    engines: ['engine-sast', 'engine-sca', 'engine-secrets', 'engine-ai'],
    aiEnabled: true,
    premiumModel: true,
  },
};

function estimateCredits(form: NewScanForm, rules: BillingRules) {
  const lineCost = Math.ceil((form.estimatedLines ?? 0) / 1000) * rules.perThousandLines;
  const profile = scanLevelProfiles[form.scanLevel];
  const subtotal = (rules.baseCredits + lineCost + (profile.aiEnabled ? rules.aiEngineCredits : 0) + (profile.premiumModel ? rules.premiumModelCredits : 0)) * (profile.mode === '深度模式' ? rules.deepModeMultiplier : 1);
  return Math.ceil(subtotal * (form.priority === '加急' ? rules.urgentMultiplier : 1));
}

function taskScanLevel(task: ScanTask): ScanLevel {
  return task.scanLevel ?? (task.mode === '深度模式' ? '发布审计' : '标准检查');
}

function estimateQueue(tasks: ScanTask[], priority: NewScanForm['priority'], scanLevel: ScanLevel) {
  const sameLevel = tasks.filter((task) => taskScanLevel(task) === scanLevel);
  const running = sameLevel.filter((task) => task.status === '扫描中').length;
  const queued = sameLevel.filter((task) => task.status === '排队中');
  const urgentAhead = queued.filter((task) => task.priority === '加急').length;
  const normalAhead = queued.length - urgentAhead;
  const ahead = running + urgentAhead + (priority === '普通' ? normalAhead : 0);
  if (ahead === 0) return { ahead, label: '预计 2 分钟内开始' };
  const lower = Math.max(3, running * 6 + urgentAhead * 5 + (priority === '普通' ? normalAhead * 5 : 0));
  const upper = lower + Math.max(5, ahead * 7);
  return { ahead, label: `预计等待 ${lower}–${upper} 分钟` };
}

function classNames(...values: (string | false | undefined)[]) {
  return values.filter(Boolean).join(' ');
}

function statusTone(status: ScanStatus) {
  return { 待扫描: 'neutral', 排队中: 'neutral', 扫描中: 'running', 扫描完成: 'success', 扫描失败: 'danger', 已停止: 'warning' }[status];
}

function validFindingCount(task: ScanTask) {
  return task.findings.filter((finding) => finding.status === '有效漏洞').length;
}

function riskCount(task: ScanTask, severity: Severity) {
  return task.findings.filter((finding) => finding.severity === severity).length;
}

function normalizeLegacyCompanies(users: PlatformUser[]) {
  return users.map((user) => ({
    ...user,
    company: user.company === '凌云科技' ? '默认团队' : user.company,
    department: user.department ?? '未分配',
    employeeNumber: user.employeeNumber ?? user.id,
  }));
}

function reportField(section: string, name: string) {
  const prefix = `- ${name}:`;
  const line = section.split('\n').find((item) => item.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? '';
}

function reportSection(report: string, headings: string[]) {
  const lines = report.split('\n');
  const acceptedHeadings = new Set(headings.map((heading) => `## ${heading}`));
  const startIndex = lines.findIndex((line) => acceptedHeadings.has(line.trim()));
  if (startIndex < 0) return '';
  const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => line.startsWith('## '));
  const endIndex = relativeEnd < 0 ? lines.length : startIndex + 1 + relativeEnd;
  return lines.slice(startIndex + 1, endIndex).join('\n');
}

function parseSecurityReport(reportJson?: string): SecurityReport | undefined {
  if (!reportJson) return undefined;
  try {
    const report = JSON.parse(reportJson) as Partial<SecurityReport>;
    return report.schemaVersion === '2.0'
      && report.metadata?.baseline === 'sec-baseline.md'
      && typeof report.metadata.scope === 'string'
      && typeof report.metadata.generatedAt === 'string'
      && Array.isArray(report.findings)
      && Array.isArray(report.manualReview)
      && Array.isArray(report.coverage?.checked)
      && Array.isArray(report.coverage.notChecked)
      && Array.isArray(report.coverage.tools)
      ? report as SecurityReport
      : undefined;
  } catch {
    return undefined;
  }
}

function parseReportFindings(detail: PlatformScanDetail, foundAt: string): Finding[] {
  const structuredReport = parseSecurityReport(detail.reportJson);
  const sourceFiles = detail.sourceSnapshot.files ?? [];
  if (structuredReport) {
    return structuredReport.findings.map((finding) => {
      const primaryLocation = finding.locations[0] ?? { path: '', line: 1 };
      const snippetLocations: EvidenceLocation[] = [
        ...finding.locations.map((location, index) => ({ ...location, title: index === 0 ? '问题代码上下文' : '补充定位代码上下文' })),
        ...(finding.dataFlow?.nodes.map((node) => ({
          path: node.path,
          line: node.line,
          title: `${({ source: 'Source', propagator: 'Propagator', sink: 'Sink' } as const)[node.kind]} 代码上下文`,
        })) ?? []),
      ];
      const snippets = buildEvidenceSnippets(sourceFiles, snippetLocations);
      const severity = ({ critical: '严重', high: '高危', medium: '中危', low: '低危' } as const)[finding.severity];
      const confidence = finding.confidence === 'high' ? 95 : finding.confidence === 'medium' ? 80 : 65;
      return {
        id: finding.id, name: finding.title, severity, type: finding.rule, file: primaryLocation.path, line: primaryLocation.line,
        confidence, status: '待确认', foundAt, existence: finding.evidence, exploitConditions: [finding.evidence], impact: finding.impact,
        aiAnalysis: [finding.evidence, finding.impact].join(' '), remediation: [finding.remediation], fixedCode: finding.remediation,
        evidence: [{ label: '规则', value: finding.rule, positive: true }, { label: '置信度', value: finding.confidence, positive: finding.confidence === 'high' }],
        dataFlow: finding.dataFlow?.nodes.map((node) => ({ kind: ({ source: 'Source', propagator: 'Propagator', sink: 'Sink' } as const)[node.kind], label: node.label, file: node.path, functionName: node.symbol, line: node.line, variable: node.expression })) ?? [],
        dataFlowMethod: finding.dataFlow?.analysisMethod, dataFlowLimitations: finding.dataFlow?.limitations ?? [],
        snippets,
        snippetUnavailableReason: snippets.length ? undefined : snippetUnavailableReason(sourceFiles, snippetLocations),
      };
    });
  }
  const report = detail.reportMarkdown ?? '';
  const findingsSection = reportSection(report, ['Findings', '安全发现']);
  const headings = [...findingsSection.matchAll(/^###\s+(\S+)\s+(.+)$/gm)];
  return headings.map((heading, index) => {
    const section = findingsSection.slice(heading.index, headings[index + 1]?.index ?? findingsSection.length);
    const rawLocation = reportField(section, 'location');
    const location = rawLocation.match(/^(.+?):(\d+)/);
    const file = location?.[1] ?? rawLocation;
    const line = Number(location?.[2] ?? 1);
    const severity = ({ critical: '严重', high: '高危', medium: '中危', low: '低危' } as const)[reportField(section, 'severity') as 'critical' | 'high' | 'medium' | 'low'] ?? '中危';
    const confidenceName = reportField(section, 'confidence');
    const confidence = confidenceName === 'high' ? 95 : confidenceName === 'medium' ? 80 : 65;
    const evidence = reportField(section, 'evidence');
    const impact = reportField(section, 'impact');
    const remediation = reportField(section, 'remediation');
    const snippetLocations = [{ path: file, line, title: '问题代码上下文' }];
    const snippets = buildEvidenceSnippets(sourceFiles, snippetLocations);
    return {
      id: heading[1],
      name: heading[2].trim(),
      severity,
      type: reportField(section, 'rule') || '安全基线',
      file,
      line,
      confidence,
      status: '待确认',
      foundAt,
      existence: evidence,
      exploitConditions: evidence ? [evidence] : [],
      impact,
      aiAnalysis: [evidence, impact].filter(Boolean).join(' '),
      remediation: remediation ? [remediation] : [],
      fixedCode: remediation,
      evidence: [
        { label: '规则', value: reportField(section, 'rule') || '安全基线', positive: true },
        { label: '置信度', value: confidenceName || 'unknown', positive: confidenceName === 'high' },
      ],
      dataFlow: [],
      dataFlowLimitations: [],
      snippets,
      snippetUnavailableReason: snippets.length ? undefined : snippetUnavailableReason(sourceFiles, snippetLocations),
    };
  });
}

function mapScanDetail(task: ScanTask, detail: PlatformScanDetail): ScanTask {
  const files = detail.sourceSnapshot.files ?? [];
  const findings = parseReportFindings(detail, formatBeijingDateTime(detail.updatedAt));
  const sourceLineCount = files.reduce((total, file) => total + (file.content ? file.content.split('\n').length : 0), 0);
  const coveredFileCount = scannedFileCount(detail.reportJson, files.length);
  return {
    ...mergeTaskDetail(task, detail),
    findings: findings.length || detail.hasReport ? findings : task.findings,
    suspected: findings.length || task.suspected,
    scannedFiles: coveredFileCount,
    totalFiles: coveredFileCount,
    lines: sourceLineCount || task.lines,
    hasReport: detail.hasReport,
    hasSourceCode: detail.hasSourceCode,
    detailLoaded: true,
    remoteUpdatedAt: detail.updatedAt,
  };
}

function mergeRemoteTasks(current: ScanTask[], incoming: ScanTask[]) {
  return mergeRemoteTaskSummaries(current, incoming);
}

function refreshRemoteTaskPage(current: ScanTask[], incoming: ScanTask[]) {
  const incomingIds = new Set(incoming.map((task) => task.id));
  return [...mergeRemoteTasks(current, incoming), ...current.filter((task) => !incomingIds.has(task.id))];
}

function scanCreatorLabel(task: PlatformScanTask) {
  if (task.creatorName && task.creatorEmployeeNo) return `${task.creatorName}（${task.creatorEmployeeNo}）`;
  return task.creatorName || task.creatorEmployeeNo || '未知用户';
}

function mapPlatformScan(task: PlatformScanTask): ScanTask {
  const status: ScanStatus = {
    queued: '排队中', cloning: '扫描中', indexing: '扫描中', analyzing: '扫描中', normalizing: '扫描中',
    completed: '扫描完成', partial: '扫描完成', failed: '扫描失败', cancelled: '已停止',
  }[task.status] as ScanStatus;
  const startedAt = new Date(task.createdAt);
  const updatedAt = new Date(task.updatedAt);
  const elapsedSeconds = Math.max(0, Math.floor((updatedAt.getTime() - startedAt.getTime()) / 1000));
  return {
    id: task.id,
    name: task.source === 'plugin' ? `${task.projectName} VS Code 安全审查` : `${task.projectName} 平台安全扫描`,
    product: task.source === 'plugin' ? 'VS Code 插件' : '安全扫描平台',
    project: task.projectName,
    creator: task.source === 'plugin' ? 'PI Security Review' : scanCreatorLabel(task),
    sourceType: 'git',
    source: task.repositoryUrl,
    branch: task.gitRef,
    model: '系统智能组合',
    mode: task.scanConfiguration?.mode === 'deep' ? '深度模式' : '标准模式',
    scanLevel: task.scanConfiguration?.scanLevel === 'lite' ? '轻量体验' : task.scanConfiguration?.scanLevel === 'release' || task.scanConfiguration?.mode === 'deep' ? '发布审计' : '标准检查',
    createdAt: formatBeijingDateTime(startedAt),
    startedAt: task.createdAt,
    status,
    stage: userVisibleStage(task.stage),
    progress: task.progress,
    scannedFiles: task.scannedFiles,
    totalFiles: task.scannedFiles,
    lines: task.codeLines,
    suspected: task.findingCount,
    duration: elapsedSeconds < 60 ? `${elapsedSeconds}秒` : `${Math.floor(elapsedSeconds / 60)}分${elapsedSeconds % 60}秒`,
    findings: [],
    logs: [{ time: formatBeijingTime(updatedAt), level: status === '扫描失败' ? 'error' : status === '扫描完成' ? 'success' : 'info', message: sanitizeUserVisibleText(task.statusMessage), stage: userVisibleStage(task.stage), progress: task.progress }],
    ownerId: task.actorId,
    priority: task.scanConfiguration?.priority === 'urgent' ? '加急' : '普通',
    queuePosition: task.queuePosition,
    estimatedCredits: task.estimatedCredits,
    chargedCredits: task.chargedCredits,
    frozenCredits: task.billingMode === 'credit' && !['completed', 'partial', 'failed', 'cancelled'].includes(task.status) ? task.estimatedCredits : 0,
    aiInputTokens: task.aiInputTokens,
    aiOutputTokens: task.aiOutputTokens,
    aiTotalTokens: task.aiTotalTokens,
    aiTokenUsageEstimated: task.aiTokenUsageEstimated,
    hasReport: task.hasReport,
    hasSourceCode: task.hasSourceCode,
    remoteUpdatedAt: task.updatedAt,
  };
}

function platformUserFromAuth(user: AuthUser): PlatformUser {
  return {
    id: user.id,
    name: user.name || user.email.split('@')[0] || user.email,
    email: user.email,
    company: '默认团队',
    department: user.department || '未分配',
    employeeNumber: user.employeeNo || '-',
    role: user.role === 'admin' ? '管理员' : '用户',
    status: '正常',
    createdAt: formatBeijingDate(user.createdAt),
    lastLoginAt: user.lastLoginAt ? formatBeijingDateTime(user.lastLoginAt) : '当前会话',
  };
}

function App() {
  const [sessionUser, setSessionUser] = useState<PlatformUser | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
  const [nav, setNav] = useState<NavKey>(() => {
    const stored = sessionStorage.getItem('ai-security-active-nav') as NavKey | null;
    return stored && navKeys.includes(stored) ? stored : 'dashboard';
  });
  const [tasks, setTasks] = useState<ScanTask[]>(() => {
    const stored = localStorage.getItem('ai-security-scan-tasks');
    return stored ? JSON.parse(stored) as ScanTask[] : seedTasks;
  });
  const [pluginTasks, setPluginTasks] = useState<ScanTask[]>([]);
  const [myTasks, setMyTasks] = useState<ScanTask[]>([]);
  const [hasMoreScanTasks, setHasMoreScanTasks] = useState(true);
  const [loadingMoreScanTasks, setLoadingMoreScanTasks] = useState(false);
  const [users, setUsers] = useState<PlatformUser[]>(() => normalizeLegacyCompanies(seedUsers));
  const [accounts, setAccounts] = useState<CreditAccount[]>(seedAccounts);
  const [transactions, setTransactions] = useState<CreditTransaction[]>(seedTransactions);
  const [billingRules, setBillingRules] = useState<BillingRules>(defaultBillingRules);
  const [engines, setEngines] = useState<ScanEngine[]>(seedEngines);
  const [scanQueue, setScanQueue] = useState<ScanQueueConfig>(defaultScanQueue);
  const [aiModels, setAIModels] = useState<AIModel[]>(seedModels);
  const [notifications, setNotifications] = useState<PlatformNotification[]>(seedNotifications);
  const [feishuEnabled, setFeishuEnabled] = useState(true);
  const [feishuApplication, setFeishuApplication] = useState<FeishuApplicationConfig>(defaultFeishuApplication);
  const [stateRevision, setStateRevision] = useState<number | null>(null);
  const [stateError, setStateError] = useState('');
  const stateRevisionRef = useRef<number | null>(null);
  const pendingStateRef = useRef<PlatformState | null>(null);
  const saveInFlightRef = useRef(false);
  const [activeTaskId, setActiveTaskId] = useState(tasks[0]?.id ?? '');
  const [showCreate, setShowCreate] = useState(false);
  const [finding, setFinding] = useState<Finding | null>(null);
  const [taskPage, setTaskPage] = useState<TaskPageState>(null);
  const [toast, setToast] = useState('');
  const displayedTasks = authenticatedScanTasks(myTasks, pluginTasks);
  const activeTask = displayedTasks.find((task) => task.id === activeTaskId) ?? displayedTasks[0];
  const taskPageSummary = taskPage ? displayedTasks.find((task) => task.id === taskPage.task.id) : undefined;
  const taskPageRefreshKey = taskPageSummary?.hasReport && taskPageSummary.remoteUpdatedAt !== taskPage?.task.remoteUpdatedAt
    ? `${taskPageSummary.id}:${taskPageSummary.remoteUpdatedAt ?? ''}`
    : '';
  const currentUser = sessionUser;
  const account = accounts.find((item) => item.userId === currentUser?.id) ?? { userId: currentUser?.id ?? '', available: 0, frozen: 0, lifetimeUsed: 0 };

  useEffect(() => {
    sessionStorage.setItem('ai-security-active-nav', nav);
  }, [nav]);
  useEffect(() => {
    if (currentUser?.role !== '管理员') return;
    const initialState: PlatformState = { tasks, users, accounts, transactions, billingRules, engines, scanQueue, aiModels, notifications, feishuEnabled, feishuApplication };
    loadPlatformState(initialState).then((snapshot) => {
      setTasks(snapshot.state.tasks); setUsers(normalizeLegacyCompanies(snapshot.state.users)); setBillingRules(snapshot.state.billingRules);
      setEngines(snapshot.state.engines); setScanQueue({ ...defaultScanQueue, ...snapshot.state.scanQueue }); setAIModels(snapshot.state.aiModels);
      setNotifications(snapshot.state.notifications); setFeishuEnabled(snapshot.state.feishuEnabled);
      setFeishuApplication({ ...defaultFeishuApplication, ...snapshot.state.feishuApplication });
      stateRevisionRef.current = snapshot.revision;
      setStateRevision(snapshot.revision);
    }).catch((error: Error) => setStateError(error.message));
  }, [currentUser?.id, currentUser?.role]);
  useEffect(() => {
    me().then(async (authenticatedUser) => {
      const user = platformUserFromAuth(authenticatedUser);
      setSessionUser(user);
      await refreshAccountData();
    }).catch(() => setSessionUser(null)).finally(() => setRestoringSession(false));
  }, []);
  useEffect(() => {
    if (currentUser?.role !== '管理员' && (nav === 'config' || nav === 'platform')) {
      setNav('dashboard');
    }
  }, [currentUser?.role, nav]);
  useEffect(() => {
    if (nav !== 'scan' || !currentUser) return;
    let cancelled = false;
    let refreshing = false;
    const refreshScanTasks = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const userTasks = await loadMyScans(scanPageSize, 0);
        if (cancelled) return;
        setPluginTasks((current) => refreshRemoteTaskPage(current, userTasks.filter((task) => task.source === 'plugin').map(mapPlatformScan)));
        setMyTasks((current) => refreshRemoteTaskPage(current, userTasks.filter((task) => task.source === 'platform').map(mapPlatformScan)));
      } catch (error) {
        if (cancelled) return;
        setStateError(error instanceof Error ? error.message : String(error));
      } finally {
        refreshing = false;
      }
    };
    void refreshScanTasks();
    const timer = window.setInterval(() => void refreshScanTasks(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [nav, currentUser?.id]);
  useEffect(() => {
    if (nav !== 'scan' || !activeTask?.hasReport || activeTask.detailLoaded) return;
    let cancelled = false;
    loadScanDetail(activeTask.id).then((detail) => {
      if (cancelled) return;
      const loadedTask = mapScanDetail(activeTask, detail);
      setPluginTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
      setMyTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
    }).catch((error) => {
      if (!cancelled) setStateError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [nav, activeTask?.id, activeTask?.hasReport, activeTask?.detailLoaded, activeTask?.remoteUpdatedAt]);
  useEffect(() => {
    if (!taskPageRefreshKey || !taskPageSummary) return;
    let cancelled = false;
    loadScanDetail(taskPageSummary.id).then((detail) => {
      if (cancelled) return;
      const loadedTask = mapScanDetail(taskPageSummary, detail);
      setPluginTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
      setMyTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
      setTaskPage((current) => current?.task.id === loadedTask.id
        ? { ...current, task: loadedTask, loading: false, error: undefined }
        : current);
    }).catch((error) => {
      if (!cancelled) setStateError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [taskPageRefreshKey]);
  useEffect(() => {
    if (stateRevision === null || currentUser?.role !== '管理员') return;
    pendingStateRef.current = { tasks, users, accounts, transactions, billingRules, engines, scanQueue, aiModels, notifications, feishuEnabled, feishuApplication };
    const timer = window.setTimeout(() => {
      const flush = async () => {
        const revision = stateRevisionRef.current;
        const state = pendingStateRef.current;
        if (saveInFlightRef.current || revision === null || state === null) return;
        saveInFlightRef.current = true;
        pendingStateRef.current = null;
        let saved = false;
        try {
          const snapshot = await savePlatformState(revision, state);
          stateRevisionRef.current = snapshot.revision;
          setStateRevision(snapshot.revision);
          setAIModels((current) => current.some((model) => model.apiKey)
            ? current.map((model) => model.apiKey ? { ...model, apiKey: undefined, apiKeyConfigured: true } : model)
            : current);
          setScanQueue((current) => current.brokerUrl
            ? { ...current, brokerUrl: undefined, brokerUrlConfigured: true }
            : current);
          setFeishuApplication((current) => current.appSecret
            ? { ...current, appSecret: undefined, appSecretConfigured: true }
            : current);
          setStateError('');
          saved = true;
        } catch (error) {
          pendingStateRef.current = state;
          setStateError(error instanceof Error ? error.message : String(error));
        } finally {
          saveInFlightRef.current = false;
          if (saved && pendingStateRef.current !== null) void flush();
        }
      };
      void flush();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [tasks, users, accounts, transactions, billingRules, engines, scanQueue, aiModels, notifications, feishuEnabled, feishuApplication, currentUser?.role]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }

  function updateFinding(updated: Finding) {
    const updateTasks = (current: ScanTask[]) => current.map((task) => task.id === activeTaskId ? { ...task, findings: task.findings.map((item) => item.id === updated.id ? updated : item) } : task);
    setTasks(updateTasks);
    setPluginTasks(updateTasks);
    setMyTasks(updateTasks);
    setFinding(updated);
  }

  async function deleteTask(taskId: string) {
    try {
      await deletePlatformScan(taskId);
      const nextTaskID = displayedTasks.find((task) => task.id !== taskId)?.id ?? '';
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setPluginTasks((current) => current.filter((task) => task.id !== taskId));
      setMyTasks((current) => current.filter((task) => task.id !== taskId));
      setTaskPage((current) => current?.task.id === taskId ? null : current);
      if (activeTaskId === taskId) {
        setActiveTaskId(nextTaskID);
        setFinding(null);
      }
      notify('扫描任务已永久删除');
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }

  async function rescan(task: ScanTask) {
    try {
      const rescanned = await rescanPlatformScan(task.id);
      await refreshAccountData();
      setActiveTaskId(rescanned.id);
      notify(`重新扫描已提交，预估冻结 ${rescanned.estimatedCredits} 积分`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }

  function downloadReport(task: ScanTask) {
    const report = parseSecurityReport(task.reportJson);
    const publicReport = report ? { ...report, coverage: { checked: report.coverage.checked, notChecked: report.coverage.notChecked } } : { generatedAt: new Date().toISOString(), legacyReportMarkdown: task.reportMarkdown ?? '', summary: { total: task.findings.length, valid: validFindingCount(task) } };
    const content = sanitizeUserVisibleText(JSON.stringify(publicReport, null, 2));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    link.download = `${task.project}-security-report.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    notify('扫描报告已下载');
  }

  async function openTaskPage(request: NonNullable<TaskPageState>) {
    setTaskPage({ ...request, loading: true, error: undefined });
    try {
      const detail = await loadScanDetail(request.task.id);
      const loadedTask = mapScanDetail(request.task, detail);
      setPluginTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
      setMyTasks((current) => current.map((task) => task.id === loadedTask.id ? loadedTask : task));
      setTaskPage((current) => current?.task.id === loadedTask.id ? { ...current, task: loadedTask, loading: false } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTaskPage((current) => current?.task.id === request.task.id ? { ...current, loading: false, error: message } : current);
    }
  }

  async function createTask(form: NewScanForm, product?: ProductCatalogItem) {
    try {
      const input = buildPlatformScanInput(form, product);
      const created = form.sourceType === 'upload' && form.archiveFile
        ? await createPlatformArchiveScan(input, form.archiveFile)
        : await createPlatformScan(input);
      await refreshAccountData();
      setActiveTaskId(created.id);
      setShowCreate(false);
      setNav('scan');
      notify(`任务已提交，预估冻结 ${created.estimatedCredits} 积分`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  }

  async function refreshAccountData() {
    const [creditAccount, creditTransactions, platformScans] = await Promise.all([
      loadCreditAccount(), loadCreditTransactions(), loadMyScans(scanPageSize, 0),
    ]);
    setAccounts([creditAccount]);
    setTransactions(creditTransactions);
    setHasMoreScanTasks(platformScans.length === scanPageSize);
    setPluginTasks(platformScans.filter((task) => task.source === 'plugin').map(mapPlatformScan));
    setMyTasks(platformScans.filter((task) => task.source === 'platform').map(mapPlatformScan));
  }

  async function loadMoreScanTasks() {
    if (loadingMoreScanTasks || !hasMoreScanTasks) return;
    setLoadingMoreScanTasks(true);
    try {
      const page = await loadMyScans(scanPageSize, pluginTasks.length + myTasks.length);
      const pluginPage = page.filter((task) => task.source === 'plugin').map(mapPlatformScan);
      const platformPage = page.filter((task) => task.source === 'platform').map(mapPlatformScan);
      setPluginTasks((current) => mergeRemoteTasks(current, [...current, ...pluginPage]));
      setMyTasks((current) => mergeRemoteTasks(current, [...current, ...platformPage]));
      setHasMoreScanTasks(page.length === scanPageSize);
    } catch (error) {
      setStateError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingMoreScanTasks(false);
    }
  }

  async function login(email: string, password: string) {
    const authenticatedUser = await loginApi(email, password);
    const user = platformUserFromAuth(authenticatedUser);
    await refreshAccountData();
    setSessionUser(user);
  }

  async function logout() {
    try {
      await logoutApi();
    } finally {
      setSessionUser(null);
      setAccounts([]);
      setTransactions([]);
      setMyTasks([]);
    }
  }

  if (restoringSession) return <div className="auth-page"><LoaderCircle className="spin" /></div>;
  if (!currentUser) return <AuthScreen onLogin={login} />;

  return (
    <div className="app-shell">
      <Header nav={nav} onNav={(nextNav) => { setTaskPage(null); setNav(nextNav); }} onNewScan={() => { setTaskPage(null); setShowCreate(true); }} user={currentUser} account={account} unread={notifications.filter((item) => item.userId === currentUser.id && !item.read).length} onLogout={logout} />
      <main className="main-content">
        {taskPage ? <TaskDetailPage page={taskPage} showTokenUsage={currentUser.role === '管理员'} onBack={() => setTaskPage(null)} onSwitch={(type) => void openTaskPage({ type, task: taskPage.task })} onDownload={downloadReport} /> : <>
          {nav === 'dashboard' && <Dashboard user={currentUser} account={account} tasks={displayedTasks} notifications={notifications} onNewScan={() => setShowCreate(true)} onNav={setNav} />}
          {nav === 'scan' && <ScanWorkspace tasks={displayedTasks} activeTask={activeTask} showTokenUsage={currentUser.role === '管理员'} hasMoreTasks={hasMoreScanTasks} loadingMoreTasks={loadingMoreScanTasks} onLoadMore={() => void loadMoreScanTasks()} onSelectTask={setActiveTaskId} onFinding={setFinding} onNewScan={() => setShowCreate(true)} onOverlay={(request) => void openTaskPage(request)} onDownload={downloadReport} onRescan={(task) => void rescan(task)} onDelete={deleteTask} />}
          {nav === 'credits' && <CreditCenter account={account} transactions={transactions.filter((item) => item.userId === currentUser.id)} />}
          {nav === 'config' && currentUser.role === '管理员' && <RuntimeConfiguration engines={engines} scanQueue={scanQueue} models={aiModels} feishuApplication={feishuApplication} onEngines={setEngines} onScanQueue={setScanQueue} onModels={setAIModels} onFeishuApplication={setFeishuApplication} notify={notify} />}
          {nav === 'users' && <UserManagement users={users} currentUser={currentUser} onUsers={setUsers} notify={notify} />}
          {nav === 'profile' && <ProfileCenter user={currentUser} notify={notify} />}
          {nav === 'platform' && <CommercialAdmin users={users} accounts={accounts} rules={billingRules} engines={engines} models={aiModels} onRules={setBillingRules} onEngines={setEngines} onModels={setAIModels} notify={notify} />}
        </>}
      </main>
      {showCreate && <NewScanModal onClose={() => setShowCreate(false)} onCreate={createTask} notify={notify} account={account} rules={billingRules} tasks={tasks} />}
      {finding && activeTask && <FindingDrawer finding={finding} task={activeTask} onClose={() => setFinding(null)} onUpdate={updateFinding} notify={notify} />}
      {toast && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={18} />{toast}</div>}
      {stateError && <div className="toast error" role="alert"><AlertTriangle size={18} /><span>{stateError}</span><button className="toast-close" aria-label="关闭提示" onClick={() => setStateError('')}><X size={16} /></button></div>}
    </div>
  );
}

function Header({ nav, onNav, onNewScan, user, account, unread, onLogout }: { nav: NavKey; onNav: (nav: NavKey) => void; onNewScan: () => void; user: PlatformUser; account: CreditAccount; unread: number; onLogout: () => void }) {
  const pageNames: Record<NavKey, string> = { dashboard: '安全概览', scan: '扫描任务', credits: 'Credit 管理', config: '配置中心', users: '用户管理', profile: '个人中心', platform: '系统管理' };
  return <>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><ShieldCheck size={21} /></span><div><strong>SecScan Cloud</strong><small>企业代码安全平台</small></div></div>
      <nav className="primary-nav" aria-label="主导航">
        <span className="nav-section">工作区</span>
        <button className={nav === 'dashboard' ? 'active' : ''} onClick={() => onNav('dashboard')}><LayoutDashboard size={18} />安全概览</button>
        <button className={nav === 'scan' ? 'active' : ''} onClick={() => onNav('scan')}><Bot size={18} />扫描任务</button>
        <button className={nav === 'credits' ? 'active' : ''} onClick={() => onNav('credits')}><Coins size={18} />Credit 管理</button>
        <span className="nav-section">管理</span>
        {user.role === '管理员' && <button className={nav === 'config' ? 'active' : ''} onClick={() => onNav('config')}><Settings2 size={18} />配置中心</button>}
        <button className={nav === 'users' ? 'active' : ''} onClick={() => onNav('users')}><Users size={18} />用户管理</button>
        {user.role === '管理员' && <button className={nav === 'platform' ? 'active' : ''} onClick={() => onNav('platform')}><SlidersHorizontal size={18} />系统管理</button>}
      </nav>
      <div className="sidebar-health"><span /><div><strong>安全服务正常</strong><small>所有检测引擎可用</small></div></div>
    </aside>
    <header className="topbar">
      <div className="page-context"><span>SecScan Cloud</span><strong>{pageNames[nav]}</strong></div>
      <div className="header-actions"><button className="credit-balance" onClick={() => onNav('credits')}><Wallet size={16} /><b>{account.available.toLocaleString()}</b><span>Credit</span></button><button className="primary-button compact" onClick={onNewScan}><Plus size={17} />新建扫描</button><button className="user-menu-button" title="个人中心" aria-label="个人中心" onClick={() => onNav('profile')}><CircleUserRound size={20} /><span>{user.name}<small>{unread ? `${unread} 条未读通知` : user.role}</small></span></button><button className="icon-button" title="退出登录" onClick={onLogout}><LogOut size={18} /></button></div>
    </header>
  </>;
}

function AuthScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ssoEnabled, setSSOEnabled] = useState(false);
  const [ssoLoginUrl, setSSOLoginUrl] = useState('/api/v1/auth/sso/login');
  useEffect(() => {
    let cancelled = false;
    void loadAuthConfig().then((configuration) => {
      if (!cancelled) {
        setSSOEnabled(configuration.ssoEnabled);
        setSSOLoginUrl(configuration.ssoLoginUrl || '/api/v1/auth/sso/login');
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('请输入有效邮箱地址');
    if (!password) return setError('请输入密码');
    setSubmitting(true);
    setError('');
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }
  if (ssoEnabled) {
    return <div className="auth-page"><section className="auth-brand"><span className="brand-mark"><ShieldCheck size={28} /></span><div><small>SECSCAN CLOUD</small><h1>企业代码安全平台</h1><p>使用企业身份或管理员账号进入安全扫描工作台。</p></div></section><section className="auth-panel"><div className="auth-form"><span className="eyebrow">WELCOME BACK</span><h2>登录安全扫描平台</h2><button className="primary-button auth-submit" onClick={() => { window.location.href = ssoLoginUrl; }}><KeyRound size={17} />企业 SSO 登录<ChevronRight size={17} /></button><Field label="企业邮箱"><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></Field><Field label="密码"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} /></Field>{error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}<button className="secondary-button auth-submit" disabled={submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" size={17} /> : '使用密码登录'}</button></div></section></div>;
  }
  return <div className="auth-page"><section className="auth-brand"><span className="brand-mark"><ShieldCheck size={28} /></span><div><small>SECSCAN CLOUD</small><h1>让每一次代码交付<br />都有安全依据</h1><p>多层代码安全检查、智能漏洞研判和可追溯 Credit 结算，为研发团队提供完整安全扫描服务。</p></div><div className="auth-proof"><span><CheckCircle2 />完整证据链</span><span><CheckCircle2 />企业数据隔离</span><span><CheckCircle2 />按实际用量结算</span></div></section><section className="auth-panel"><div className="auth-form"><span className="eyebrow">WELCOME BACK</span><h2>登录安全扫描平台</h2><p>使用企业邮箱继续</p><Field label="企业邮箱"><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></Field><Field label="密码"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }} /></Field>{error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}<button className="primary-button auth-submit" disabled={submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" size={17} /> : '登录'}<ChevronRight size={17} /></button><small className="demo-hint">管理员账号由服务端启动配置提供</small></div></section></div>;
}

function parseCallbackParams(raw: string) {
  const params = new URLSearchParams(raw);
  for (const [encodedQuery, value] of Array.from(params.entries())) {
    if (value !== '' || !encodedQuery.includes('=')) continue;
    params.delete(encodedQuery);
    new URLSearchParams(encodedQuery).forEach((nestedValue, key) => {
      if (!params.has(key)) params.set(key, nestedValue);
    });
  }
  return params;
}

export function SSOCallback() {
  const [error, setError] = useState('');
  const submitted = useRef(false);
  useEffect(() => {
    if (submitted.current) return;
    submitted.current = true;
    const params = parseCallbackParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, '');
    const hashParams = parseCallbackParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash);
    hashParams.forEach((value, key) => {
      if (!params.has(key)) params.set(key, value);
    });
    void submitUACCallback(params.get('state') ?? '', Object.fromEntries(params.entries()))
      .then(({ next }) => window.location.replace(next || '/'))
      .catch((callbackError: unknown) => setError(callbackError instanceof Error ? callbackError.message : '统一身份认证回调失败'));
  }, []);
  return <div className="auth-page"><section className="auth-brand"><span className="brand-mark"><ShieldCheck size={28} /></span><div><small>SECSCAN CLOUD</small><h1>企业代码安全平台</h1></div></section><section className="auth-panel"><div className="auth-form"><LoaderCircle className="spin" size={28} /><h2>正在完成统一身份认证</h2>{error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}</div></section></div>;
}

function Dashboard({ user, account, tasks, notifications, onNewScan, onNav }: { user: PlatformUser; account: CreditAccount; tasks: ScanTask[]; notifications: PlatformNotification[]; onNewScan: () => void; onNav: (nav: NavKey) => void }) {
  const [statistics, setStatistics] = useState<ScanStatistics | null>(null);
  const [statisticsError, setStatisticsError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await loadScanStatistics();
        if (!cancelled) {
          setStatistics(result);
          setStatisticsError('');
        }
      } catch (error) {
        if (!cancelled) setStatisticsError(error instanceof Error ? error.message : String(error));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user.id]);
  const running = tasks.filter((task) => ['排队中', '扫描中'].includes(task.status)).length;
  const risks = statistics ? Object.values(statistics.riskDistribution).reduce((total, count) => total + count, 0) : 0;
  const totalLines = tasks.reduce((total, task) => total + task.lines, 0);
  const severityKeys: Record<Severity, keyof ScanStatistics['riskDistribution']> = { 严重: 'critical', 高危: 'high', 中危: 'medium', 低危: 'low' };
  const severityData = severityOrder.map((severity) => ({ severity, count: statistics?.riskDistribution[severityKeys[severity]] ?? 0 }));
  const maxSeverity = Math.max(1, ...severityData.map((item) => item.count));
  const maxTrend = Math.max(1, ...(statistics?.trend.map((item) => item.completed) ?? [0]));
  const comparison = !statistics ? '统计中…' : statistics.changePercent === null
    ? `较上周新增 ${statistics.currentPeriodCompleted} 次`
    : `较上周 ${statistics.changePercent >= 0 ? '+' : ''}${statistics.changePercent.toFixed(1)}%`;
  const trendLabel = (date: string, index: number) => index === 6 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
  return <div className="dashboard-page"><div className="dashboard-welcome"><div><span className="eyebrow">SECURITY OVERVIEW</span><h1>安全概览</h1><p>{user.company} 的扫描运行、风险发现与服务用量</p></div><button className="primary-button" onClick={onNewScan}><Plus size={17} />发起安全扫描</button></div><div className="dashboard-metrics"><Metric icon={<Activity />} label="进行中任务" value={String(running)} tone="blue" /><Metric icon={<FileCode2 />} label="累计扫描代码" value={`${Math.round(totalLines / 1000)}K`} tone="slate" /><Metric icon={<ShieldAlert />} label="发现安全风险" value={String(risks)} tone="red" /><Metric icon={<Coins />} label="剩余 Credit" value={account.available.toLocaleString()} tone="amber" /></div><div className="dashboard-analysis"><section className="dashboard-section"><div className="section-title-row"><div><h3>近 7 日扫描趋势</h3><p>每日完成的代码扫描任务量</p></div><span className="trend-summary">{comparison}</span></div>{statisticsError && <p className="statistics-error">{statisticsError}</p>}<div className="trend-chart" aria-label="近 7 日扫描趋势图">{(statistics?.trend ?? []).map((item, index) => <div key={item.date} title={`${item.date}：完成 ${item.completed} 次扫描`}><strong>{item.completed}</strong><i style={{ height: `${item.completed / maxTrend * 100}%` }} /><span>{trendLabel(item.date, index)}</span></div>)}</div></section><section className="dashboard-section risk-panel"><div className="section-title-row"><div><h3>风险等级分布</h3><p>已完成扫描报告中的风险构成</p></div></div>{statisticsError && <p className="statistics-error">{statisticsError}</p>}<div className="risk-bars">{severityData.map((item) => <div key={item.severity}><span><i className={`severity-bg-${item.severity}`} />{item.severity}</span><div><i className={`severity-bg-${item.severity}`} style={{ width: `${item.count / maxSeverity * 100}%` }} /></div><b>{item.count}</b></div>)}</div></section></div><div className="dashboard-grid"><section className="dashboard-section"><div className="section-title-row"><div><h3>最近扫描任务</h3><p>跟踪任务状态、项目和执行进度</p></div><button className="link-button" onClick={() => onNav('scan')}>查看全部<ChevronRight size={15} /></button></div><div className="recent-task-list">{tasks.slice(0, 4).map((task) => <button key={task.id} onClick={() => onNav('scan')}><span className={`task-icon ${statusTone(task.status)}`}><Code2 /></span><div><strong>{task.name}</strong><small>{task.project} · {task.createdAt}</small></div><span className={`status-pill ${statusTone(task.status)}`}>{task.status}</span><b>{task.progress}%</b></button>)}</div></section><aside className="dashboard-side"><section className="credit-panel"><span><Wallet size={19} />Credit 账户</span><strong>{account.available.toLocaleString()}</strong><small>冻结 {account.frozen} · 累计消耗 {account.lifetimeUsed}</small><div className="credit-bar"><i style={{ width: `${Math.min(100, account.available / 40)}%` }} /></div><button onClick={() => onNav('credits')}>查看账单与充值</button></section><section className="notification-panel"><h3>最新通知</h3>{notifications.filter((item) => item.userId === user.id).slice(0, 3).map((item) => <div key={item.id}><span className={item.read ? '' : 'unread'} /><p><strong>{item.title}</strong><small>{item.message}</small></p></div>)}</section></aside></div></div>;
}

function CreditCenter({ account, transactions }: { account: CreditAccount; transactions: CreditTransaction[] }) {
  return <div className="simple-page"><div className="management-header"><span className="eyebrow">USAGE & BILLING</span><h1>Credit 中心</h1><p>查看余额、冻结金额和每一笔扫描费用变更</p></div><div className="credit-overview"><section><span>可用余额</span><strong>{account.available.toLocaleString()} <small>Credit</small></strong><p>可用于提交新的扫描任务</p></section><section><span>任务冻结</span><strong>{account.frozen.toLocaleString()} <small>Credit</small></strong><p>任务结束后按实际用量结算</p></section><section><span>累计消耗</span><strong>{account.lifetimeUsed.toLocaleString()} <small>Credit</small></strong><p>账户全生命周期扫描用量</p></section></div><div className="management-table"><div className="page-actions"><div><h2>Credit 流水</h2><p>预冻结、结算和退款均独立留痕</p></div></div><table><thead><tr><th>流水号</th><th>时间</th><th>类型</th><th>关联任务</th><th>说明</th><th>变动</th><th>可用余额</th></tr></thead><tbody>{transactions.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td>{item.createdAt}</td><td><span className={`transaction-type type-${item.type}`}>{item.type}</span></td><td>{item.taskId ?? '-'}</td><td>{item.description}</td><td className={item.amount >= 0 ? 'amount-positive' : 'amount-negative'}>{item.amount >= 0 ? '+' : ''}{item.amount}</td><td>{item.balanceAfter}</td></tr>)}</tbody></table></div></div>;
}

function ProfileCenter({
  user,
  notify,
}: {
  user: PlatformUser;
  notify: (message: string) => void;
}) {
  const [apiKey, setAPIKey] = useState("");
  const [rotatingKey, setRotatingKey] = useState(false);
  const [applicationEnabled, setApplicationEnabled] = useState(true);
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [webhookURL, setWebhookURL] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadMyAPIKey()
      .then((status) => {
        if (!cancelled) setAPIKey(status.apiKey ?? "");
      })
      .catch((error) => {
        if (!cancelled)
          notify(error instanceof Error ? error.message : String(error));
      });
    loadNotificationPreference()
      .then((preference) => {
        if (!cancelled) {
          setApplicationEnabled(preference.applicationEnabled);
          setWebhookEnabled(preference.webhookEnabled);
          setWebhookConfigured(preference.webhookConfigured);
        }
      })
      .catch((error) => {
        if (!cancelled) notify(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveWebhook() {
    setSavingWebhook(true);
    try {
      const preference = await saveNotificationPreference(applicationEnabled, webhookEnabled, webhookURL);
      setApplicationEnabled(preference.applicationEnabled);
      setWebhookEnabled(preference.webhookEnabled);
      setWebhookConfigured(preference.webhookConfigured);
      setWebhookURL("");
      notify("飞书通知设置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingWebhook(false);
    }
  }

  async function testWebhook() {
    setTestingWebhook(true);
    try {
      await testNotificationWebhook();
      notify("Webhook 测试消息已发送");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setTestingWebhook(false);
    }
  }

  async function rotateKey() {
    if (!window.confirm("生成新密钥后，旧密钥会立即失效。继续吗？")) return;
    setRotatingKey(true);
    try {
      setAPIKey(await rotateAPIKey());
      notify("新密钥已生成，请立即保存到 VS Code");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setRotatingKey(false);
    }
  }

  function closePasswordChange() {
    setShowPasswordChange(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
  }

  async function submitPasswordChange() {
    if (newPassword.length < 12 || newPassword.length > 128) {
      setPasswordError("新密码长度需为 12 至 128 个字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }
    setChangingPassword(true);
    setPasswordError("");
    try {
      await changeAdminPassword(currentPassword, newPassword);
      closePasswordChange();
      notify("登录密码已更新");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : String(error));
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <>
    <div className="simple-page">
      <div className="management-header">
        <span className="eyebrow">ACCOUNT SETTINGS</span>
        <h1>个人中心</h1>
        <p>维护企业身份、安全设置与消息接收方式</p>
      </div>
      <div className="profile-grid">
        <section className="profile-card">
          <div className="profile-avatar">{user.name.slice(0, 1)}</div>
          <h2>{user.name}</h2>
          <p>{user.email}</p>
          <span className="role-chip">{user.role}</span>
          <dl>
            <div>
              <dt>企业</dt>
              <dd>{user.company}</dd>
            </div>
            <div>
              <dt>账号状态</dt>
              <dd className="online">{user.status}</dd>
            </div>
            <div>
              <dt>最近登录</dt>
              <dd>{user.lastLoginAt}</dd>
            </div>
          </dl>
          <button
            className="secondary-button"
            onClick={() => notify("个人资料已保存")}
          >
            编辑个人资料
          </button>
        </section>
        <section className="settings-stack">
          <div className="policy-card">
            <div>
              <span className="policy-icon">
                <Rocket />
              </span>
              <div>
                <h3>飞书通知</h3>
                <p>扫描结束后，结果摘要会定向发送给任务所属用户。</p>
              </div>
            </div>
            <label className="switch-row">
              <div>
                <strong>飞书应用机器人</strong>
                <small>按当前账号邮箱发送给本人</small>
              </div>
              <input
                type="checkbox"
                checked={applicationEnabled}
                onChange={(event) => setApplicationEnabled(event.target.checked)}
              />
              <span />
            </label>
            <label className="switch-row">
              <div>
                <strong>额外发送到个人 Webhook</strong>
                <small>适合将同一份通知同步到自建飞书群</small>
              </div>
              <input
                type="checkbox"
                checked={webhookEnabled}
                onChange={(event) => setWebhookEnabled(event.target.checked)}
              />
              <span />
            </label>
            <Field label="飞书 Webhook">
              <input
                type="password"
                autoComplete="off"
                value={webhookURL}
                onChange={(event) => setWebhookURL(event.target.value)}
                placeholder={webhookConfigured ? "已配置，留空则保留原地址" : "https://open.feishu.cn/open-apis/bot/v2/hook/..."}
              />
            </Field>
            <div className="notification-actions">
              <button className="primary-button" disabled={savingWebhook} onClick={() => void saveWebhook()}>
                {savingWebhook ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}保存设置
              </button>
              <button className="secondary-button" disabled={testingWebhook || !webhookConfigured} onClick={() => void testWebhook()}>
                {testingWebhook ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}测试 Webhook
              </button>
            </div>
          </div>
          <div className="policy-card">
            <div>
              <span className="policy-icon">
                <KeyRound />
              </span>
              <div>
                <h3>API Key</h3>
                <p>密钥归属于当前账号，扫描权限和 Credit 消耗均计入此账号。</p>
              </div>
            </div>
            <label className="api-key-display">
              <span>访问密钥</span>
              <div className="api-key-control">
                <input
                  readOnly
                  value={apiKey}
                  placeholder="尚未生成 API Key"
                  aria-label="API Key"
                />
                {apiKey && (
                <button
                  type="button"
                  className="api-key-copy"
                  title="复制 API Key"
                  aria-label="复制 API Key"
                  onClick={() => {
                    void navigator.clipboard.writeText(apiKey);
                    notify("密钥已复制");
                  }}
                >
                  <Copy size={15} />
                </button>
                )}
              </div>
            </label>
            <button
              className="secondary-button"
              disabled={rotatingKey}
              onClick={() => void rotateKey()}
            >
              <RefreshCw size={14} />
              {rotatingKey ? "生成中" : apiKey ? "重新生成" : "生成密钥"}
            </button>
          </div>
          {user.role === "管理员" && <div className="policy-card">
            <div>
              <span className="policy-icon">
                <KeyRound />
              </span>
              <div>
                <h3>账号安全</h3>
                <p>更新密码并管理当前登录会话。</p>
              </div>
            </div>
            <button
              className="secondary-button"
              onClick={() => setShowPasswordChange(true)}
            >
              修改登录密码
            </button>
          </div>}
        </section>
      </div>
    </div>
    {showPasswordChange && (
      <div className="modal-backdrop">
        <div className="task-modal password-modal" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">
          <div className="modal-header">
            <div>
              <span className="modal-icon"><KeyRound /></span>
              <div>
                <h2 id="password-dialog-title">修改登录密码</h2>
                <p>更新管理员账号的本地登录凭据</p>
              </div>
            </div>
            <button className="icon-button" aria-label="关闭" onClick={closePasswordChange}><X size={20} /></button>
          </div>
          <div className="password-form">
            <Field label="当前密码" required>
              <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoFocus />
            </Field>
            <Field label="新密码" required>
              <input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="12 至 128 个字符" />
            </Field>
            <Field label="确认新密码" required>
              <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitPasswordChange(); }} />
            </Field>
            {passwordError && <div className="form-error"><AlertTriangle size={15} />{passwordError}</div>}
          </div>
          <div className="modal-footer">
            <span><ShieldCheck size={16} />仅管理员账号支持本地密码登录</span>
            <div>
              <button className="secondary-button" onClick={closePasswordChange}>取消</button>
              <button className="primary-button" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} onClick={() => void submitPasswordChange()}>
                {changingPassword ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
                {changingPassword ? "保存中" : "保存新密码"}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

type UserEditor = { originalId?: string; draft: PlatformUser };

function UserManagement({
  users,
  currentUser,
  onUsers,
  notify,
}: {
  users: PlatformUser[];
  currentUser: PlatformUser;
  onUsers: (users: PlatformUser[]) => void;
  notify: (message: string) => void;
}) {
  const [editor, setEditor] = useState<UserEditor | null>(null);
  const [search, setSearch] = useState("");
  const [keyStatuses, setKeyStatuses] = useState<UserAPIKeyStatus[]>([]);
  const [plainKeys, setPlainKeys] = useState<Record<string, string>>({});
  const [rotatingUserId, setRotatingUserId] = useState("");
  useEffect(() => {
    let cancelled = false;
    const loadStatuses = currentUser.role === "管理员"
      ? loadUserAPIKeyStatuses()
      : loadMyAPIKey().then((status) => [status]);
    loadStatuses
      .then((statuses) => {
        if (cancelled) return;
        setKeyStatuses(statuses);
        setPlainKeys(
          Object.fromEntries(
            statuses.flatMap((status) =>
              status.apiKey ? [[status.userId, status.apiKey]] : [],
            ),
          ),
        );
      })
      .catch((error) => {
        if (!cancelled)
          notify(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
    }, [currentUser.id, currentUser.role]);
  const managedUsers: PlatformUser[] = keyStatuses.map((status) => ({
      id: status.userId,
      name: status.name || status.email.split("@")[0] || status.email,
      email: status.email,
      company: "默认团队",
      department: status.department || "未分配",
      employeeNumber: status.employeeNo || "-",
      role: status.role === "admin" ? "管理员" : "用户",
      status: status.active ? "正常" : "已停用",
      createdAt: formatBeijingDate(status.createdAt),
      lastLoginAt: status.lastLoginAt ? formatBeijingDateTime(status.lastLoginAt) : "已开通登录",
    }));
  const visibleUsers = managedUsers.filter(
    (user) =>
      !search ||
      [user.name, user.email, user.department, user.employeeNumber].some(
        (value) => value?.toLowerCase().includes(search.toLowerCase()),
      ),
  );
  const newUser = (): PlatformUser => ({
    id: `USR-${Date.now()}`,
    name: "",
    email: "",
    company: "默认团队",
    department: "",
    employeeNumber: "",
    role: "用户",
    status: "正常",
    createdAt: formatBeijingDate(new Date()),
    lastLoginAt: "从未登录",
  });

  function saveUser() {
    if (!editor) return;
    const user = editor.draft;
    if (
      !user.name.trim() ||
      !user.email.trim() ||
      !user.department?.trim() ||
      !user.employeeNumber?.trim()
    )
      return notify("请填写姓名、部门、工号和邮箱");
    if (!/^\S+@\S+\.\S+$/.test(user.email)) return notify("请输入有效邮箱地址");
    if (
      users.some(
        (item) =>
          item.id !== editor.originalId &&
          item.email.toLowerCase() === user.email.toLowerCase(),
      )
    )
      return notify("邮箱已被其他用户使用");
    if (
      users.some(
        (item) =>
          item.id !== editor.originalId &&
          item.employeeNumber === user.employeeNumber,
      )
    )
      return notify("工号已被其他用户使用");
    if (editor.originalId === currentUser.id && user.status === "已停用")
      return notify("不能停用当前登录账号");
    onUsers(
      editor.originalId
        ? users.map((item) => (item.id === editor.originalId ? user : item))
        : [...users, user],
    );
    setEditor(null);
    notify(editor.originalId ? "用户信息已更新" : "用户已添加");
  }

  function toggleStatus(user: PlatformUser) {
    if (user.id === currentUser.id) return notify("不能停用当前登录账号");
    const status = user.status === "正常" ? "已停用" : "正常";
    onUsers(
      users.map((item) => (item.id === user.id ? { ...item, status } : item)),
    );
    notify(status === "正常" ? "用户已启用" : "用户已停用");
  }

  async function rotateManagedKey(
    user: PlatformUser,
    status: UserAPIKeyStatus,
  ) {
    if (
      status.configured &&
      !window.confirm(
        `重置 ${status.email} 的密钥后，旧密钥会立即失效。继续吗？`,
      )
    )
      return;
    setRotatingUserId(status.userId);
    try {
      const result = currentUser.role === "管理员"
        ? await rotateUserAPIKey({
            id: status.userId,
            email: user.email,
            role: user.role === "管理员" ? "admin" : "user",
          })
        : { userId: currentUser.id, apiKey: await rotateAPIKey() };
      const nextStatus = {
        ...status,
        userId: result.userId,
        configured: true,
        keyPrefix: result.apiKey.slice(0, 16),
        apiKey: result.apiKey,
        updatedAt: new Date().toISOString(),
      };
      setPlainKeys((current) => ({
        ...current,
        [result.userId]: result.apiKey,
      }));
      setKeyStatuses((current) =>
        current.some(
          (item) => item.email.toLowerCase() === user.email.toLowerCase(),
        )
          ? current.map((item) =>
              item.email.toLowerCase() === user.email.toLowerCase()
                ? nextStatus
                : item,
            )
          : [...current, nextStatus],
      );
      notify("新 API Key 已生成，可随时复制");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setRotatingUserId("");
    }
  }

  return (
    <>
      <div className="management-page user-management">
        <div className="management-header">
          <span className="eyebrow">IDENTITY & ACCESS</span>
          <h1>用户管理</h1>
          <p>维护组织成员身份、角色与账号状态</p>
        </div>
        <section className="user-management-panel">
          <PageActions
            title="用户列表"
            description={`共 ${managedUsers.length} 个用户，${managedUsers.filter((user) => user.status === "正常").length} 个正常账号`}
          />
          <div className="table-toolbar">
            <label className="search-field user-search">
              <Search size={16} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索姓名、部门、工号或邮箱"
              />
            </label>
          </div>
          <div className="management-table">
            <table>
              <thead>
                <tr>
                  <th>用户</th>
                  <th>部门</th>
                  <th>工号</th>
                  <th>邮箱</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>API Key</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <span>{user.name.slice(0, 1)}</span>
                        <div>
                          <strong>{user.name}</strong>
                          <small>{user.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>{user.department || "未分配"}</td>
                    <td>
                      <code>{user.employeeNumber || "-"}</code>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      <span className="role-chip">{user.role}</span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${user.status === "正常" ? "success" : "neutral"}`}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const keyStatus = keyStatuses.find(
                          (item) =>
                            item.email.toLowerCase() ===
                            user.email.toLowerCase(),
                        ) ?? {
                          userId: user.id,
                          email: user.email,
                          role:
                            user.role === "管理员"
                              ? ("admin" as const)
                              : ("user" as const),
                          active: user.status === "正常",
                          createdAt: new Date().toISOString(),
                          configured: false,
                        };
                        const plainKey = plainKeys[keyStatus.userId];
                        return (
                          <div className="api-key-cell">
                            <code
                              title={
                                plainKey ||
                                (keyStatus.configured
                                  ? "重置后可复制完整 API Key"
                                  : undefined)
                              }
                            >
                              {plainKey ||
                                (keyStatus.configured
                                  ? `${keyStatus.keyPrefix}…`
                                  : "未生成")}
                            </code>
                            <button
                              title={
                                plainKey
                                  ? "复制 API Key"
                                  : "生成 API Key 后可复制"
                              }
                              aria-label={`复制 ${user.email} 的 API Key`}
                              disabled={!plainKey}
                              onClick={() => {
                                if (plainKey)
                                  void navigator.clipboard
                                    .writeText(plainKey)
                                    .then(() => notify("API Key 已复制"));
                              }}
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              className="key-action"
                              disabled={rotatingUserId === keyStatus.userId}
                              onClick={() =>
                                void rotateManagedKey(user, keyStatus)
                              }
                            >
                              {rotatingUserId === keyStatus.userId
                                ? "生成中"
                                : keyStatus.configured
                                  ? "重置"
                                  : "生成"}
                            </button>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className="key-unavailable">认证账号</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleUsers.length && (
              <EmptyState icon={<Users />} title="没有匹配的用户" />
            )}
          </div>
        </section>
      </div>
      {editor && (
        <div className="modal-backdrop">
          <div
            className="task-modal config-editor"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <span className="modal-icon">
                  <UserCog />
                </span>
                <div>
                  <h2>{editor.originalId ? "编辑用户" : "添加用户"}</h2>
                  <p>维护组织身份与 API 访问权限</p>
                </div>
              </div>
              <button className="icon-button" onClick={() => setEditor(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="config-editor-body">
              <div className="form-grid">
                <Field label="姓名" required>
                  <input
                    value={editor.draft.name}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: { ...editor.draft, name: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="邮箱" required>
                  <input
                    type="email"
                    value={editor.draft.email}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: { ...editor.draft, email: event.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="部门" required>
                  <input
                    value={editor.draft.department ?? ""}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          department: event.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="工号" required>
                  <input
                    value={editor.draft.employeeNumber ?? ""}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          employeeNumber: event.target.value,
                        },
                      })
                    }
                  />
                </Field>
                <Field label="角色">
                  <select
                    value={editor.draft.role}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          role: event.target.value as PlatformUser["role"],
                        },
                      })
                    }
                  >
                    <option>用户</option>
                    <option>管理员</option>
                  </select>
                </Field>
                <Field label="账号状态">
                  <select
                    value={editor.draft.status}
                    disabled={editor.originalId === currentUser.id}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          status: event.target.value as PlatformUser["status"],
                        },
                      })
                    }
                  >
                    <option>正常</option>
                    <option>已停用</option>
                  </select>
                </Field>
                <Field label="所属团队">
                  <input
                    value={editor.draft.company}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: { ...editor.draft, company: event.target.value },
                      })
                    }
                  />
                </Field>
              </div>
            </div>
            <div className="modal-footer">
              <span>
                <ShieldCheck size={15} />
                停用后用户无法再次登录
              </span>
              <div>
                <button
                  className="secondary-button"
                  onClick={() => setEditor(null)}
                >
                  取消
                </button>
                <button className="primary-button" onClick={saveUser}>
                  保存用户
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type RuntimeEditor =
  | { type: "model"; originalId?: string; draft: AIModel }
  | { type: "engine"; originalId?: string; draft: ScanEngine };

function RuntimeConfiguration({
  engines,
  scanQueue,
  models,
  feishuApplication,
  onEngines,
  onScanQueue,
  onModels,
  onFeishuApplication,
  notify,
}: {
  engines: ScanEngine[];
  scanQueue: ScanQueueConfig;
  models: AIModel[];
  feishuApplication: FeishuApplicationConfig;
  onEngines: (engines: ScanEngine[]) => void;
  onScanQueue: (configuration: ScanQueueConfig) => void;
  onModels: (models: AIModel[]) => void;
  onFeishuApplication: (configuration: FeishuApplicationConfig) => void;
  notify: (message: string) => void;
}) {
  const [section, setSection] = useState(() => {
    const stored = sessionStorage.getItem('ai-security-runtime-section');
    return runtimeSections.includes(stored as typeof runtimeSections[number]) ? stored! : 'AI 模型';
  });
  const [editor, setEditor] = useState<RuntimeEditor | null>(null);
  const [queueDraft, setQueueDraft] = useState(scanQueue);
  const [feishuDraft, setFeishuDraft] = useState(feishuApplication);
  const [testingConnection, setTestingConnection] = useState(false);
  const sections = [
    { name: "AI 模型", icon: <Bot /> },
    { name: "扫描引擎", icon: <Shield /> },
    { name: "消息投递", icon: <Network /> },
  ];
  useEffect(() => sessionStorage.setItem('ai-security-runtime-section', section), [section]);
  const newModel = (): AIModel => ({
    id: `model-${Date.now()}`,
    name: "",
    description: "",
    premium: false,
    enabled: true,
    contextWindow: "128K",
    provider: "OpenAI",
    apiProtocol: "responses",
    endpoint: "",
    modelId: "",
    apiKey: "",
    apiKeyConfigured: false,
    temperature: 0.1,
    maxTokens: 4096,
  });
  const newEngine = (): ScanEngine => ({
    id: `engine-${Date.now()}`,
    name: "",
    kind: "SAST",
    description: "",
    enabled: true,
    included: true,
    execution: "queue",
    queueProtocol: "rabbitmq",
    brokerUrl: "",
    requestQueue: "",
    resultQueue: "",
    timeoutSeconds: 300,
  });

  useEffect(() => setQueueDraft(scanQueue), [scanQueue]);
  useEffect(() => setFeishuDraft(feishuApplication), [feishuApplication]);

  function saveFeishuApplication() {
    if (!feishuDraft.appId.trim()) return notify("请填写飞书 App ID");
    if (!feishuDraft.appSecret?.trim() && !feishuDraft.appSecretConfigured)
      return notify("请填写飞书 App Secret");
    onFeishuApplication(feishuDraft);
    notify("飞书应用机器人配置已保存");
  }

  function saveQueueConfiguration() {
    if (queueDraft.enabled && !queueDraft.brokerUrl?.trim() && !queueDraft.brokerUrlConfigured)
      return notify("请填写 Broker 地址");
    if (queueDraft.protocol === 'rabbitmq' && [queueDraft.liteQueue, queueDraft.liteRoutingKey, queueDraft.standardQueue, queueDraft.standardRoutingKey, queueDraft.releaseQueue, queueDraft.releaseRoutingKey].some((value) => !value.trim()))
      return notify("请完整填写三级队列和路由键");
    if (queueDraft.protocol === 'kafka' && [queueDraft.liteTopic, queueDraft.standardTopic, queueDraft.releaseTopic].some((value) => !value.trim()))
      return notify("请完整填写三级 Topic");
    onScanQueue(queueDraft);
    notify("消息投递配置已保存");
  }

  function saveEditor() {
    if (!editor?.draft.name.trim() || !editor.draft.id.trim())
      return notify("请填写名称和配置 ID");
    if (editor.type === "model") {
      if (!editor.draft.modelId?.trim()) return notify("请填写模型标识");
      if (!editor.draft.endpoint?.trim()) return notify("请填写 API 地址");
      if (!editor.draft.apiKey?.trim() && !editor.draft.apiKeyConfigured)
        return notify("请填写 API 密钥");
      onModels(
        editor.originalId
          ? models.map((item) =>
              item.id === editor.originalId ? editor.draft : item,
            )
          : [...models, editor.draft],
      );
      notify(editor.originalId ? "AI 模型配置已更新" : "AI 模型已添加");
    } else {
      const target =
        editor.draft.execution === "queue"
          ? editor.draft.brokerUrl
          : editor.draft.execution === "command"
          ? editor.draft.command
          : editor.draft.execution === "http"
            ? editor.draft.endpoint
            : "builtin";
      if (!target?.trim()) return notify("请填写引擎执行地址或命令");
      if (editor.draft.execution === "queue" && !editor.draft.requestQueue?.trim())
        return notify("请填写任务队列");
      if (editor.draft.execution === "queue" && !editor.draft.resultQueue?.trim())
        return notify("请填写结果队列");
      if (
        !editor.originalId &&
        engines.some((item) => item.id === editor.draft.id.trim())
      )
        return notify("配置 ID 已存在");
      onEngines(
        editor.originalId
          ? engines.map((item) =>
              item.id === editor.originalId ? editor.draft : item,
            )
          : [...engines, editor.draft],
      );
      notify(editor.originalId ? "扫描引擎配置已更新" : "扫描引擎已添加");
    }
    setEditor(null);
  }

  async function testConnection() {
    if (!editor || editor.type !== "model") return;
    if (!editor.draft.endpoint?.trim() || !editor.draft.modelId?.trim())
      return notify("请先填写 API 地址和模型标识");
    if (!editor.draft.apiKey?.trim() && !editor.draft.apiKeyConfigured)
      return notify("请先填写 API 密钥");
    setTestingConnection(true);
    try {
      const result = await testModelConnection(editor.draft);
      notify(`${result.message}（${result.latencyMs} ms）`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "连通性测试失败");
    } finally {
      setTestingConnection(false);
    }
  }

  return (
    <>
      <ManagementLayout
        eyebrow="RUNTIME CONFIGURATION"
        title="配置中心"
        description="管理 AI 模型、检测引擎与任务消息投递"
        sections={sections}
        active={section}
        onActive={setSection}
      >
        {section === "AI 模型" ? (
          <>
            <PageActions
              title="AI 模型"
              description="接入内置模型或 OpenAI 兼容服务，配置将应用于后续任务"
              action="添加模型"
              onAction={() => setEditor({ type: "model", draft: newModel() })}
            />
            <div className="model-grid">
              {models.map((model) => (
                <article className="model-card runtime-card" key={model.id}>
                  <div>
                    <span>
                      <Bot />
                    </span>
                    <div>
                      <h3>{model.name}</h3>
                      <p>{model.description || "未填写说明"}</p>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>提供商</dt>
                      <dd>{model.provider || "内置服务"}</dd>
                    </div>
                    <div>
                      <dt>模型标识</dt>
                      <dd>{model.modelId || model.id}</dd>
                    </div>
                    <div>
                      <dt>上下文</dt>
                      <dd>{model.contextWindow}</dd>
                    </div>
                    <div>
                      <dt>最大输出</dt>
                      <dd>{model.maxTokens ?? "-"} tokens</dd>
                    </div>
                  </dl>
                  <label className="switch-row">
                    <strong>允许使用</strong>
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={() =>
                        onModels(
                          models.map((item) =>
                            item.id === model.id
                              ? { ...item, enabled: !item.enabled }
                              : item,
                          ),
                        )
                      }
                    />
                    <span />
                  </label>
                  <div className="runtime-card-actions">
                    <button
                      onClick={() =>
                        setEditor({
                          type: "model",
                          originalId: model.id,
                          draft: { ...model },
                        })
                      }
                    >
                      <Settings2 size={14} />
                      编辑
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => {
                        if (!window.confirm(`确定删除 AI 模型“${model.name}”吗？确认后将从数据库中移除，且无法恢复。`)) return;
                        onModels(models.filter((item) => item.id !== model.id));
                        notify("AI 模型已删除");
                      }}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : section === "扫描引擎" ? (
          <>
            <PageActions
              title="扫描引擎"
              description="管理任务可选择的检测能力；平台到引擎的队列连接请在“消息投递”中配置"
              action="添加引擎"
              onAction={() => setEditor({ type: "engine", draft: newEngine() })}
            />
            <div className="model-grid">
              {engines.map((engine) => (
                <article className="model-card runtime-card" key={engine.id}>
                  <div>
                    <span>
                      <Shield />
                    </span>
                    <div>
                      <h3>{engine.name}</h3>
                      <p>{engine.description || "未填写说明"}</p>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>能力类型</dt>
                      <dd>{engine.kind}</dd>
                    </div>
                    <div>
                      <dt>执行方式</dt>
                      <dd>{engine.execution === "queue" ? `消息队列 · ${engine.queueProtocol ?? "rabbitmq"}` : engine.execution || "builtin"}</dd>
                    </div>
                    <div>
                      <dt>{engine.execution === "queue" ? "任务队列" : "超时时间"}</dt>
                      <dd>{engine.execution === "queue" ? engine.requestQueue || "-" : `${engine.timeoutSeconds ?? 300} 秒`}</dd>
                    </div>
                    <div>
                      <dt>计费方式</dt>
                      <dd>{engine.included ? "基础费用内" : "附加费用"}</dd>
                    </div>
                  </dl>
                  <label className="switch-row">
                    <strong>允许使用</strong>
                    <input
                      type="checkbox"
                      checked={engine.enabled}
                      onChange={() =>
                        onEngines(
                          engines.map((item) =>
                            item.id === engine.id
                              ? { ...item, enabled: !item.enabled }
                              : item,
                          ),
                        )
                      }
                    />
                    <span />
                  </label>
                  <div className="runtime-card-actions">
                    <button
                      onClick={() =>
                        setEditor({
                          type: "engine",
                          originalId: engine.id,
                          draft: { ...engine },
                        })
                      }
                    >
                      <Settings2 size={14} />
                      编辑
                    </button>
                    <button
                      className="danger-text"
                      onClick={() => {
                        if (!window.confirm(`确定删除扫描引擎“${engine.name}”吗？确认后将从数据库中移除，且无法恢复。`)) return;
                        onEngines(
                          engines.filter((item) => item.id !== engine.id),
                        );
                        notify("扫描引擎已删除");
                      }}
                    >
                      <Trash2 size={14} />
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="page-actions">
              <div>
                <h2>消息投递</h2>
                <p>配置扫描任务队列，以及面向用户的飞书应用机器人</p>
              </div>
              <button className="primary-button" onClick={saveQueueConfiguration}><Check size={15} />保存</button>
            </div>
            <div className="queue-config-panel">
              <div className="page-actions queue-panel-header">
                <div>
                  <h3>飞书应用机器人</h3>
                  <p>平台使用企业自建应用，按任务所属账号的邮箱定向发送扫描结果</p>
                </div>
                <button className="secondary-button" onClick={saveFeishuApplication}><Check size={15} />保存机器人配置</button>
              </div>
              <div className="queue-config-fields form-grid">
                <Field label="App ID" required>
                  <input
                    value={feishuDraft.appId}
                    placeholder="cli_xxxxxxxxxxxxxxxx"
                    onChange={(event) => setFeishuDraft({ ...feishuDraft, appId: event.target.value })}
                  />
                </Field>
                <Field label="App Secret" required>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={feishuDraft.appSecret ?? ""}
                    placeholder={feishuDraft.appSecretConfigured ? "已加密保存，留空表示不修改" : "填写飞书应用 App Secret"}
                    onChange={(event) => setFeishuDraft({ ...feishuDraft, appSecret: event.target.value })}
                  />
                </Field>
              </div>
            </div>
            <div className="queue-config-panel">
              <label className="switch-row">
                <div>
                  <strong>启用任务消息投递</strong>
                  <small>开启后，待发送任务将按扫描等级投递到对应队列</small>
                </div>
                <input
                  type="checkbox"
                  checked={queueDraft.enabled}
                  onChange={(event) => setQueueDraft({ ...queueDraft, enabled: event.target.checked })}
                />
                <span />
              </label>
              <div className="queue-config-fields form-grid">
                <Field label="消息队列类型">
                  <select value={queueDraft.protocol} onChange={(event) => setQueueDraft({ ...queueDraft, protocol: event.target.value as ScanQueueConfig['protocol'], brokerUrl: undefined, brokerUrlConfigured: false })}>
                    <option value="rabbitmq">RabbitMQ</option>
                    <option value="kafka">Kafka</option>
                  </select>
                </Field>
                <Field label={queueDraft.protocol === 'kafka' ? "Broker 地址（逗号分隔）" : "Broker 地址"} required>
                  <input
                    type={queueDraft.protocol === 'rabbitmq' ? "password" : "text"}
                    autoComplete="new-password"
                    value={queueDraft.brokerUrl ?? ""}
                    placeholder={queueDraft.brokerUrlConfigured ? "已加密保存，留空表示不修改" : queueDraft.protocol === 'kafka' ? "kafka-1.example.com:9092,kafka-2.example.com:9092" : "amqps://user:password@mq.example.com/vhost"}
                    onChange={(event) => setQueueDraft({ ...queueDraft, brokerUrl: event.target.value })}
                  />
                </Field>
                {queueDraft.protocol === 'rabbitmq' ? <>
                  <Field label="Exchange">
                    <input value={queueDraft.exchange} onChange={(event) => setQueueDraft({ ...queueDraft, exchange: event.target.value })} />
                  </Field>
                  <div />
                  {([
                    ["轻量体验队列", "liteQueue", "liteRoutingKey"],
                    ["标准检查队列", "standardQueue", "standardRoutingKey"],
                    ["发布审计队列", "releaseQueue", "releaseRoutingKey"],
                  ] as const).map(([label, queueKey, routingKey]) => (
                    <div className="queue-route-row" key={queueKey}>
                      <Field label={label} required>
                        <input value={queueDraft[queueKey]} onChange={(event) => setQueueDraft({ ...queueDraft, [queueKey]: event.target.value })} />
                      </Field>
                      <Field label="路由键" required>
                        <input value={queueDraft[routingKey]} onChange={(event) => setQueueDraft({ ...queueDraft, [routingKey]: event.target.value })} />
                      </Field>
                    </div>
                  ))}
                </> : ([
                  ["轻量体验 Topic", "liteTopic"],
                  ["标准检查 Topic", "standardTopic"],
                  ["发布审计 Topic", "releaseTopic"],
                ] as const).map(([label, topicKey]) => {
                  const urgentTopicKey = `${topicKey.slice(0, -5)}UrgentTopic` as 'liteUrgentTopic' | 'standardUrgentTopic' | 'releaseUrgentTopic';
                  return <div className="queue-route-row" key={topicKey}>
                    <Field label={label} required>
                      <input value={queueDraft[topicKey]} onChange={(event) => setQueueDraft({ ...queueDraft, [topicKey]: event.target.value })} />
                    </Field>
                    <Field label="加急 Topic（可选）">
                      <input
                        value={queueDraft[urgentTopicKey] ?? ''}
                        placeholder={`${queueDraft[topicKey]}.urgent`}
                        onChange={(event) => setQueueDraft({ ...queueDraft, [urgentTopicKey]: event.target.value })}
                      />
                    </Field>
                  </div>;
                })}
              </div>
            </div>
          </>
        )}
      </ManagementLayout>
      {editor && (
        <div className="modal-backdrop">
          <div
            className="task-modal config-editor"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <span className="modal-icon">
                  {editor.type === "model" ? <Bot /> : <Shield />}
                </span>
                <div>
                  <h2>
                    {editor.originalId ? "编辑" : "添加"}
                    {editor.type === "model" ? " AI 模型" : "扫描引擎"}
                  </h2>
                  <p>配置连接参数和任务可用状态</p>
                </div>
              </div>
              <button className="icon-button" onClick={() => setEditor(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="config-editor-body">
              {editor.type === "model" ? (
                <div className="form-grid">
                  <Field label="配置名称" required>
                    <input
                      value={editor.draft.name}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: { ...editor.draft, name: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="配置 ID" required>
                    <input
                      value={editor.draft.id}
                      disabled={Boolean(editor.originalId)}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: { ...editor.draft, id: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="提供商">
                    <input
                      value={editor.draft.provider ?? ""}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            provider: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="接口协议">
                    <select
                      value={editor.draft.apiProtocol ?? "chat-completions"}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            apiProtocol: event.target
                              .value as AIModel["apiProtocol"],
                          },
                        })
                      }
                    >
                      <option value="chat-completions">Chat Completions</option>
                      <option value="responses">Responses API</option>
                    </select>
                  </Field>
                  <Field label="模型标识" required>
                    <input
                      value={editor.draft.modelId ?? ""}
                      placeholder="例如 gpt-5.2"
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            modelId: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="API 地址">
                    <input
                      value={editor.draft.endpoint ?? ""}
                      placeholder={
                        editor.draft.apiProtocol === "responses"
                          ? "https://api.openai.com/v1"
                          : "https://api.example.com/v1"
                      }
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            endpoint: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="API 密钥">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={editor.draft.apiKey ?? ""}
                      placeholder={
                        editor.draft.apiKeyConfigured
                          ? "已加密保存，留空表示不修改"
                          : "输入模型服务 API key"
                      }
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            apiKey: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="代理用户工号">
                    <input
                      value={editor.draft.proxyUserNo ?? ""}
                      placeholder="x-user-no"
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            proxyUserNo: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="代理用户姓名">
                    <input
                      value={editor.draft.proxyUserName ?? ""}
                      placeholder="x-user-name"
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            proxyUserName: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="代理用户部门">
                    <input
                      value={editor.draft.proxyUserDeptName ?? ""}
                      placeholder="x-user-dept-name"
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            proxyUserDeptName: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="上下文窗口">
                    <input
                      value={editor.draft.contextWindow}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            contextWindow: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="最大输出 Tokens">
                    <input
                      type="number"
                      min="1"
                      value={editor.draft.maxTokens ?? 4096}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            maxTokens: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="Temperature">
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={editor.draft.temperature ?? 0.1}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            temperature: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="说明">
                    <input
                      value={editor.draft.description}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            description: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              ) : (
                <div className="form-grid">
                  <Field label="引擎名称" required>
                    <input
                      value={editor.draft.name}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: { ...editor.draft, name: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="配置 ID" required>
                    <input
                      value={editor.draft.id}
                      disabled={Boolean(editor.originalId)}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: { ...editor.draft, id: event.target.value },
                        })
                      }
                    />
                  </Field>
                  <Field label="能力类型">
                    <select
                      value={editor.draft.kind}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            kind: event.target.value as ScanEngine["kind"],
                          },
                        })
                      }
                    >
                      {["SAST", "SCA", "Secrets", "AI"].map((kind) => (
                        <option key={kind}>{kind}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="执行方式">
                    <select
                      value={editor.draft.execution ?? "builtin"}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            execution: event.target
                              .value as ScanEngine["execution"],
                          },
                        })
                      }
                    >
                      <option value="builtin">平台内置</option>
                      <option value="queue">消息队列</option>
                      <option value="http">HTTP 服务</option>
                      <option value="command">本地命令</option>
                    </select>
                  </Field>
                  {editor.draft.execution === "queue" && (
                    <>
                      <Field label="消息队列类型">
                        <select
                          value={editor.draft.queueProtocol ?? "rabbitmq"}
                          onChange={(event) =>
                            setEditor({
                              ...editor,
                              draft: {
                                ...editor.draft,
                                queueProtocol: event.target.value as ScanEngine["queueProtocol"],
                              },
                            })
                          }
                        >
                          <option value="rabbitmq">RabbitMQ</option>
                          <option value="kafka">Kafka</option>
                          <option value="rocketmq">RocketMQ</option>
                        </select>
                      </Field>
                      <Field label="Broker 地址" required>
                        <input
                          value={editor.draft.brokerUrl ?? ""}
                          placeholder="amqp://mq.example.com:5672"
                          onChange={(event) =>
                            setEditor({
                              ...editor,
                              draft: { ...editor.draft, brokerUrl: event.target.value },
                            })
                          }
                        />
                      </Field>
                      <Field label="任务队列" required>
                        <input
                          value={editor.draft.requestQueue ?? ""}
                          placeholder="security.scan.request"
                          onChange={(event) =>
                            setEditor({
                              ...editor,
                              draft: { ...editor.draft, requestQueue: event.target.value },
                            })
                          }
                        />
                      </Field>
                      <Field label="结果队列" required>
                        <input
                          value={editor.draft.resultQueue ?? ""}
                          placeholder="security.scan.result"
                          onChange={(event) =>
                            setEditor({
                              ...editor,
                              draft: { ...editor.draft, resultQueue: event.target.value },
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                  {editor.draft.execution === "http" && (
                    <Field label="服务地址" required>
                      <input
                        value={editor.draft.endpoint ?? ""}
                        placeholder="http://scanner:8080/scan"
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            draft: {
                              ...editor.draft,
                              endpoint: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  )}
                  {editor.draft.execution === "command" && (
                    <Field label="执行命令" required>
                      <input
                        value={editor.draft.command ?? ""}
                        placeholder="semgrep scan --json"
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            draft: {
                              ...editor.draft,
                              command: event.target.value,
                            },
                          })
                        }
                      />
                    </Field>
                  )}
                  <Field label="超时时间（秒）">
                    <input
                      type="number"
                      min="1"
                      value={editor.draft.timeoutSeconds ?? 300}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            timeoutSeconds: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </Field>
                  <Field label="说明">
                    <input
                      value={editor.draft.description}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            description: event.target.value,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              )}
              <div className="config-flags">
                <label>
                  <input
                    type="checkbox"
                    checked={editor.draft.enabled}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        draft: {
                          ...editor.draft,
                          enabled: event.target.checked,
                        },
                      } as RuntimeEditor)
                    }
                  />
                  创建后允许任务使用
                </label>
                {editor.type === "model" ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={editor.draft.premium}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            premium: event.target.checked,
                          },
                        })
                      }
                    />
                    高级模型计费
                  </label>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={editor.draft.included}
                      onChange={(event) =>
                        setEditor({
                          ...editor,
                          draft: {
                            ...editor.draft,
                            included: event.target.checked,
                          },
                        })
                      }
                    />
                    包含在基础费用内
                  </label>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <span>
                <ShieldCheck size={15} />
                密钥由平台加密保存，不会回显
              </span>
              <div>
                {editor.type === "model" && (
                  <button
                    className="secondary-button"
                    disabled={testingConnection}
                    onClick={() => void testConnection()}
                  >
                    {testingConnection ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Network size={15} />
                    )}
                    {testingConnection ? "测试中" : "测试连通性"}
                  </button>
                )}
                <button
                  className="secondary-button"
                  onClick={() => setEditor(null)}
                >
                  取消
                </button>
                <button className="primary-button" onClick={saveEditor}>
                  保存配置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AdminCreditAccounts({ notify }: { notify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<AdminCreditAccount[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submittingUserId, setSubmittingUserId] = useState('');

  async function refresh() {
    try {
      setAccounts(await loadAdminCreditAccounts());
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function grant(account: AdminCreditAccount) {
    const amount = Number(amounts[account.userId]);
    if (!Number.isInteger(amount) || amount <= 0) {
      notify('请输入正整数积分');
      return;
    }
    setSubmittingUserId(account.userId);
    try {
      const result = await grantUserCredits(account.userId, amount);
      setAccounts((current) => current.map((item) => item.userId === account.userId ? { ...item, available: result.available } : item));
      setAmounts((current) => ({ ...current, [account.userId]: '' }));
      notify(`已为 ${account.email} 增加 ${amount} Credit`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmittingUserId('');
    }
  }

  if (loading) return <div className="admin-credit-loading"><LoaderCircle className="spin" size={20} />正在加载真实账户...</div>;
  return <div className="management-table"><table><thead><tr><th>用户</th><th>角色</th><th>状态</th><th>可用</th><th>冻结</th><th>累计消耗</th><th>增加积分</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.userId}><td><strong>{account.email.split('@')[0]}</strong><small>{account.email}</small></td><td>{account.role === 'admin' ? '管理员' : '用户'}</td><td><span className={`status-pill ${account.active ? 'success' : 'danger'}`}>{account.active ? '正常' : '已停用'}</span></td><td><strong>{account.available.toLocaleString()}</strong></td><td>{account.frozen.toLocaleString()}</td><td>{account.lifetimeUsed.toLocaleString()}</td><td><div className="credit-grant-control"><input type="number" min="1" step="1" value={amounts[account.userId] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [account.userId]: event.target.value }))} placeholder="如 500" aria-label={`为 ${account.email} 增加的积分`} /><button className="primary-button" disabled={submittingUserId === account.userId} onClick={() => void grant(account)}>{submittingUserId === account.userId ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />}增加</button></div></td></tr>)}</tbody></table>{!accounts.length && <div className="admin-credit-loading">暂无 Credit 账户</div>}</div>;
}

function CommercialAdmin({ users, accounts, rules, engines, models, onRules, onEngines, onModels, notify }: { users: PlatformUser[]; accounts: CreditAccount[]; rules: BillingRules; engines: ScanEngine[]; models: AIModel[]; onRules: (rules: BillingRules) => void; onEngines: (engines: ScanEngine[]) => void; onModels: (models: AIModel[]) => void; notify: (message: string) => void }) {
  const [section, setSection] = useState('计费规则');
  const [accountRefreshKey, setAccountRefreshKey] = useState(0);
  const sections = [{ name: '计费规则', icon: <Coins /> }, { name: '扫描引擎', icon: <Shield /> }, { name: 'AI 模型', icon: <Bot /> }, { name: '用户与余额', icon: <Users /> }, { name: '队列监控', icon: <Activity /> }];
  if (section === '用户与余额') {
    return <ManagementLayout eyebrow="PLATFORM CONTROL" title="管理后台" description="管理商业计费、扫描能力、用户额度与运行队列" sections={sections} active={section} onActive={setSection}>
      <PageActions title="用户与余额" description="查看真实用户账户并增加可审计的 Credit" action="刷新账户" onAction={() => setAccountRefreshKey((current) => current + 1)} />
      <AdminCreditAccounts key={accountRefreshKey} notify={notify} />
    </ManagementLayout>;
  }
  return <ManagementLayout eyebrow="PLATFORM CONTROL" title="管理后台" description="管理商业计费、扫描能力、用户额度与运行队列" sections={sections} active={section} onActive={setSection}>{section === '计费规则' && <><PageActions title="Credit 计费规则" description="新任务预估与最终结算均使用此处配置" action="保存规则" onAction={() => notify('计费规则已保存并应用于新任务')} /><div className="billing-rule-grid">{([['baseCredits', '基础任务费'], ['perThousandLines', '每千行代码'], ['aiEngineCredits', 'AI 引擎附加费'], ['premiumModelCredits', '高级模型附加费'], ['deepModeMultiplier', '深度模式倍率'], ['urgentMultiplier', '加急倍率']] as const).map(([key, label]) => <Field key={key} label={label}><input type="number" step={key.includes('Multiplier') ? '0.1' : '1'} value={rules[key]} onChange={(event) => onRules({ ...rules, [key]: Number(event.target.value) })} /></Field>)}</div></>}{section === '扫描引擎' && <><PageActions title="扫描引擎" description="控制用户创建任务时可选的检测能力" action="保存配置" onAction={() => notify('引擎配置已保存')} /><div className="model-grid">{engines.map((engine) => <div className="model-card" key={engine.id}><div><span><Shield /></span><div><h3>{engine.name}</h3><p>{engine.description}</p></div></div><dl><div><dt>类型</dt><dd>{engine.kind}</dd></div><div><dt>计费</dt><dd>{engine.included ? '基础费用内' : '附加费用'}</dd></div></dl><label className="switch-row"><strong>允许使用</strong><input type="checkbox" checked={engine.enabled} onChange={() => onEngines(engines.map((item) => item.id === engine.id ? { ...item, enabled: !item.enabled } : item))} /><span /></label></div>)}</div></>}{section === 'AI 模型' && <><PageActions title="AI 模型" description="配置可用模型及高级模型计费标记" action="保存配置" onAction={() => notify('模型配置已保存')} /><div className="model-grid">{models.map((model) => <div className="model-card" key={model.id}><div><span><Bot /></span><div><h3>{model.name}</h3><p>{model.description}</p></div></div><dl><div><dt>上下文</dt><dd>{model.contextWindow}</dd></div><div><dt>级别</dt><dd>{model.premium ? '高级' : '标准'}</dd></div></dl><label className="switch-row"><strong>允许使用</strong><input type="checkbox" checked={model.enabled} onChange={() => onModels(models.map((item) => item.id === model.id ? { ...item, enabled: !item.enabled } : item))} /><span /></label></div>)}</div></>}{section === '用户与余额' && <><PageActions title="用户与余额" description="查看企业用户状态与 Credit 账户" action="导出用户" onAction={() => notify('用户清单已导出')} /><div className="management-table"><table><thead><tr><th>用户</th><th>企业</th><th>角色</th><th>状态</th><th>可用</th><th>冻结</th><th>累计消耗</th></tr></thead><tbody>{users.map((user) => { const item = accounts.find((account) => account.userId === user.id); return <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.company}</td><td>{user.role}</td><td><span className="status-pill success">{user.status}</span></td><td>{item?.available ?? 0}</td><td>{item?.frozen ?? 0}</td><td>{item?.lifetimeUsed ?? 0}</td></tr>; })}</tbody></table></div></>}{section === '队列监控' && <PolicyPanel section="队列监控" notify={notify} />}</ManagementLayout>;
}

function ScanWorkspace(props: { tasks: ScanTask[]; activeTask?: ScanTask; showTokenUsage: boolean; hasMoreTasks: boolean; loadingMoreTasks: boolean; onLoadMore: () => void; onSelectTask: (id: string) => void; onFinding: (finding: Finding) => void; onNewScan: () => void; onOverlay: (page: NonNullable<TaskPageState>) => void; onDownload: (task: ScanTask) => void; onRescan: (task: ScanTask) => void; onDelete: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('全部');
  const [timeRange, setTimeRange] = useState('最近30天');
  const [tokenUsage, setTokenUsage] = useState<ScanStatistics['aiTokenUsage'] | null>(null);
  useEffect(() => {
    if (!props.showTokenUsage) return;
    let cancelled = false;
    const refresh = async () => {
      const statistics = await loadScanStatistics();
      if (!cancelled) setTokenUsage(statistics.aiTokenUsage);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [props.showTokenUsage]);
  const filtered = props.tasks.filter((task) => (!search || [task.name, task.product, task.project, task.source, task.creator].some((value) => value.toLowerCase().includes(search.toLowerCase()))) && (status === '全部' || task.status === status));
  return <div className="workspace">
    <aside className="task-panel">
      <div className="panel-heading"><div><span className="eyebrow">SECURITY SCANS</span><h1>扫描任务</h1></div><span className="count-badge">{props.tasks.length}</span></div>
      {props.showTokenUsage && <div className="token-usage-summary"><div><span>总 Token</span><strong>{tokenUsage?.totalTokens.toLocaleString() ?? '统计中'}</strong></div><div><span>输入 / 输出</span><strong>{tokenUsage ? `${tokenUsage.inputTokens.toLocaleString()} / ${tokenUsage.outputTokens.toLocaleString()}` : '-'}</strong></div><small>已记录 {tokenUsage?.taskCount.toLocaleString() ?? '-'} 个任务</small></div>}
      <div className="task-filters">
        <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索任务、产品、仓库..." /></label>
        <div className="filter-row"><Select value={status} onChange={setStatus} options={['全部', '扫描中', '扫描完成', '扫描失败']} icon={<ListFilter size={15} />} /><Select value={timeRange} onChange={setTimeRange} options={['今天', '最近7天', '最近30天', '自定义']} icon={<Clock3 size={15} />} /></div>
      </div>
      <div className="task-list" onScroll={(event) => {
        const list = event.currentTarget;
        if (props.hasMoreTasks && !props.loadingMoreTasks && list.scrollHeight - list.scrollTop - list.clientHeight < 120) props.onLoadMore();
      }}>
        {filtered.map((task) => <TaskCard key={task.id} task={task} selected={props.activeTask?.id === task.id} showTokenUsage={props.showTokenUsage} onSelect={() => props.onSelectTask(task.id)} onOverlay={props.onOverlay} onDownload={props.onDownload} onRescan={props.onRescan} onDelete={props.onDelete} />)}
        {!filtered.length && <EmptyState icon={<FileSearch />} title="没有匹配的扫描任务" action="新建扫描" onAction={props.onNewScan} />}
        {props.loadingMoreTasks && <div className="task-list-loading"><LoaderCircle className="spin" size={16} />正在加载更多任务...</div>}
      </div>
    </aside>
    <section className="result-panel">
      {props.activeTask ? <TaskResults task={props.activeTask} showTokenUsage={props.showTokenUsage} onFinding={props.onFinding} onOverlay={props.onOverlay} onDownload={props.onDownload} /> : <EmptyState icon={<ShieldCheck />} title="创建首个安全扫描任务" action="新建扫描" onAction={props.onNewScan} />}
    </section>
  </div>;
}

function TaskCard({ task, selected, showTokenUsage, onSelect, onOverlay, onDownload, onRescan, onDelete }: { task: ScanTask; selected: boolean; showTokenUsage: boolean; onSelect: () => void; onOverlay: (page: NonNullable<TaskPageState>) => void; onDownload: (task: ScanTask) => void; onRescan: (task: ScanTask) => void; onDelete: (id: string) => void }) {
  const [menu, setMenu] = useState(false);
  return <article className={classNames('task-card', selected && 'selected')} onClick={onSelect}>
    <div className="task-card-top"><span className={`status-pill ${statusTone(task.status)}`}>{task.status === '扫描中' && <LoaderCircle size={13} className="spin" />}{task.status}</span><span className="task-time">{task.createdAt}</span><button className="more-button" onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><MoreHorizontal size={18} /></button></div>
    <h3>{task.name}</h3>
    <div className="task-meta"><span><Box size={14} />{task.product} / {task.project}</span><span title={task.source}><GitBranch size={14} />{task.source}</span></div>
    {task.status === '扫描中' && <div className="progress-block"><div className="progress-label"><span>{userVisibleStage(task.stage)}</span><strong>{task.progress}%</strong></div><div className="progress-track"><i style={{ width: `${task.progress}%` }} /></div></div>}
    {task.status === '排队中' && <div className="queue-position-line"><Clock3 size={14} /><span>{task.queuePosition ? `当前排队第 ${task.queuePosition} 位` : '等待扫描中心接收任务'}</span>{task.priority === '加急' && <em>优先</em>}</div>}
    <div className="task-stats"><span><b>{task.lines.toLocaleString()}</b>代码行</span><span><b>{task.scannedFiles}</b>扫描文件</span><span><b>{task.suspected}</b>发现问题</span><span><b>{validFindingCount(task)}</b>有效漏洞</span></div>
    {showTokenUsage && <div className="task-token-usage"><Bot size={14} /><span>Token</span><strong>{(task.aiTotalTokens ?? 0).toLocaleString()}</strong><small>输入 {(task.aiInputTokens ?? 0).toLocaleString()} / 输出 {(task.aiOutputTokens ?? 0).toLocaleString()}{task.aiTokenUsageEstimated ? ' · 估算' : ''}</small></div>}
    <div className="card-actions"><button onClick={(event) => { event.stopPropagation(); onSelect(); }}>查看漏洞</button><button onClick={(event) => { event.stopPropagation(); onOverlay({ type: 'logs', task }); }}>日志</button><button onClick={(event) => { event.stopPropagation(); onOverlay({ type: 'report', task }); }}>报告</button></div>
    {menu && <div className="context-menu" onClick={(event) => event.stopPropagation()}><button onClick={() => onDownload(task)}><Download size={15} />下载报告</button><button onClick={() => onRescan(task)}><RotateCcw size={15} />重新扫描</button><button className="danger-text" onClick={() => onDelete(task.id)}><Trash2 size={15} />删除任务</button></div>}
  </article>;
}

function TaskResults({ task, showTokenUsage, onFinding, onOverlay, onDownload }: { task: ScanTask; showTokenUsage: boolean; onFinding: (finding: Finding) => void; onOverlay: (page: NonNullable<TaskPageState>) => void; onDownload: (task: ScanTask) => void }) {
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('全部等级');
  const [findingStatus, setFindingStatus] = useState('全部状态');
  const [type, setType] = useState('全部类型');
  const [page, setPage] = useState(1);
  const findings = task.findings.filter((item) => (!search || `${item.name}${item.file}`.toLowerCase().includes(search.toLowerCase())) && (severity === '全部等级' || item.severity === severity) && (findingStatus === '全部状态' || item.status === findingStatus) && (type === '全部类型' || item.type === type));
  const totalPages = Math.max(1, Math.ceil(findings.length / findingPageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * findingPageSize;
  const pagedFindings = findings.slice(pageStart, pageStart + findingPageSize);
  useEffect(() => setPage(1), [task.id, search, severity, findingStatus, type]);
  return <>
    <div className="result-header">
      <div><div className="breadcrumb">安全扫描 <ChevronRight size={14} /> {task.project}</div><h2>{task.name}</h2><div className="result-subtitle"><span>{task.id}</span><span>{task.mode}</span><span>创建人：{task.creator}</span>{showTokenUsage && <span className="result-token-badge"><Bot size={12} />Token {(task.aiTotalTokens ?? 0).toLocaleString()}<small>输入 {(task.aiInputTokens ?? 0).toLocaleString()} · 输出 {(task.aiOutputTokens ?? 0).toLocaleString()}</small></span>}</div></div>
      <div className="result-actions"><button className="secondary-button" onClick={() => onOverlay({ type: 'logs', task })}><Activity size={16} />扫描日志</button><button className="secondary-button" onClick={() => onOverlay({ type: 'report', task })}><BarChart3 size={16} />查看报告</button><button className="primary-button" onClick={() => onDownload(task)}><Download size={16} />下载报告</button></div>
    </div>
    {task.status === '扫描中' && <ScanProgress task={task} />}
    {task.status === '排队中' && <QueueWaitCard task={task} />}
    <div className="metric-grid">
      <Metric icon={<FileCode2 />} label="扫描文件" value={task.scannedFiles.toString()} suffix={`/ ${task.totalFiles}`} tone="blue" />
      <Metric icon={<Code2 />} label="代码行" value={task.lines.toLocaleString()} tone="slate" />
      <Metric icon={<AlertTriangle />} label="发现问题" value={task.suspected.toString()} tone="amber" />
      <Metric icon={<ShieldAlert />} label="有效漏洞" value={validFindingCount(task).toString()} tone="red" />
    </div>
    <div className="finding-section">
      <div className="section-title-row"><div><h3>漏洞结果</h3><p>结合完整代码上下文完成真实性与可利用性判断</p></div><div className="risk-summary">{severityOrder.map((item) => <span key={item} className={`risk-dot severity-${item}`}>{item} {riskCount(task, item)}</span>)}</div></div>
      <div className="table-toolbar"><label className="search-field finding-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索漏洞名称或文件路径" /></label><Select value={severity} onChange={setSeverity} options={['全部等级', ...severityOrder]} /><Select value={type} onChange={setType} options={['全部类型', ...new Set(task.findings.map((item) => item.type))]} /><Select value={findingStatus} onChange={setFindingStatus} options={['全部状态', '待确认', '有效漏洞', '误报', '已修复', '风险接受']} /><button className="icon-button"><Filter size={17} /></button></div>
      {findings.length ? <><div className="table-wrap"><table><thead><tr><th>漏洞名称</th><th>风险等级</th><th>漏洞类型</th><th>漏洞文件</th><th>代码行</th><th>可信度</th><th>状态</th><th>发现时间</th><th>操作</th></tr></thead><tbody>{pagedFindings.map((item) => <tr key={item.id} onClick={() => onFinding(item)}><td><div className="finding-name"><ShieldAlert size={17} /><span><strong>{item.name}</strong><small>{item.id}</small></span></div></td><td><span className={`severity-badge severity-${item.severity}`}>{item.severity}</span></td><td>{item.type}</td><td><code>{item.file}</code></td><td>{item.line}</td><td><span className="confidence"><i style={{ width: `${item.confidence}%` }} />{item.confidence}%</span></td><td><span className={`finding-status status-${item.status}`}>{item.status}</span></td><td>{item.foundAt.slice(5)}</td><td><button className="link-button">查看分析<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div><div className="table-pagination"><span>共 {findings.length} 条，当前 {pageStart + 1}-{Math.min(pageStart + findingPageSize, findings.length)} 条</span><div><button className="icon-button" title="上一页" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button><strong>{currentPage} / {totalPages}</strong><button className="icon-button" title="下一页" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}><ChevronRight size={16} /></button></div></div></> : <EmptyState icon={<ShieldCheck />} title={task.status === '扫描中' ? '正在分析代码上下文' : '当前筛选条件下没有漏洞'} />}
    </div>
  </>;
}

function ScanProgress({ task }: { task: ScanTask }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedSeconds = task.startedAt ? scanElapsedSeconds(task.startedAt, now) : 0;
  const elapsed = task.startedAt ? formatScanElapsed(elapsedSeconds) : task.duration;
  const totalTokens = task.aiTotalTokens ?? 0;
  const tokenRate = averageTokenRate(totalTokens, elapsedSeconds);
  const activeIndex = Math.min(scanStages.length - 1, Math.floor(task.progress / 10));
  return <div className="scan-progress-card"><div className="scan-progress-head"><div><span className="agent-pulse"><Sparkles size={17} /></span><div><strong>安全扫描正在运行</strong><p>{userVisibleStage(task.stage)}</p></div></div><b>{task.progress}%</b></div><div className="progress-live-stats"><span><Clock3 size={13} />已用时 <strong>{elapsed}</strong></span><span><Bot size={13} />累计 Token <strong>{formatTokenCount(totalTokens)}</strong></span><span><Activity size={13} />平均速率 <strong>{tokenRate.toLocaleString()} tokens/s</strong></span></div><div className="progress-track large"><i style={{ width: `${task.progress}%` }} /></div><div className="stage-strip">{scanStages.map((stage, index) => <span key={stage} className={classNames(index < activeIndex && 'done', index === activeIndex && 'active')}><i>{index < activeIndex ? <Check size={11} /> : index === activeIndex ? <LoaderCircle className="stage-spinner" size={11} /> : index + 1}</i>{stage}</span>)}</div></div>;
}

function QueueWaitCard({ task }: { task: ScanTask }) {
  return <div className="queue-wait-card"><span><Clock3 size={19} /></span><div><strong>{task.queuePosition ? `当前排队第 ${task.queuePosition} 位` : '任务等待扫描中心接收'}</strong><p>{task.priority === '加急' ? '该任务会排在同等级中尚未开始的普通任务之前，不会中断正在执行的扫描。' : '任务开始后会自动进入代码获取阶段，页面将持续更新执行日志。'}</p></div><b>{taskScanLevel(task)} · {task.priority === '加急' ? '优先' : '普通'}</b></div>;
}

function Metric({ icon, label, value, suffix, tone }: { icon: React.ReactNode; label: string; value: string; suffix?: string; tone: string }) {
  return <div className="metric"><span className={`metric-icon ${tone}`}>{icon}</span><div><p>{label}</p><strong>{value}</strong>{suffix && <small>{suffix}</small>}</div></div>;
}

function NewScanModal({ onClose, onCreate, notify, account, rules, tasks }: { onClose: () => void; onCreate: (form: NewScanForm, product?: ProductCatalogItem) => void; notify: (message: string) => void; account: CreditAccount; rules: BillingRules; tasks: ScanTask[] }) {
  const [form, setForm] = useState<NewScanForm>(initialForm);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [catalogProducts, setCatalogProducts] = useState<ProductCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [repositoryBranches, setRepositoryBranches] = useState<string[]>([]);
  const [repositoryAccess, setRepositoryAccess] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [repositoryAccessMessage, setRepositoryAccessMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const steps = ['项目', '代码来源', '扫描等级', '扫描规则', '排队方式', '费用确认'];
  const profile = scanLevelProfiles[form.scanLevel];
  const estimatedCredits = estimateCredits(form, rules);
  const normalCredits = estimateCredits({ ...form, priority: '普通' }, rules);
  const prioritySurcharge = Math.max(0, estimatedCredits - normalCredits);
  const queueEstimate = estimateQueue(tasks, form.priority, form.scanLevel);
  const insufficient = account.available < estimatedCredits;
  const selectedProduct = catalogProducts.find((product) => product.name === form.product.trim());
  useEffect(() => {
    let cancelled = false;
    void loadProducts().then((items) => {
      if (!cancelled) {
        setCatalogProducts(items.filter((item) => item.state === undefined || item.state === 1));
    		setCatalogError(false);
      }
    }).catch((error) => {
    if (!cancelled) {
      setCatalogError(true);
      notify(error instanceof Error ? error.message : String(error));
    }
    }).finally(() => {
    if (!cancelled) setCatalogLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const repositoryUrl = form.repositoryUrl.trim();
    if (form.sourceType !== 'git' || !/^https:\/\/.+/.test(repositoryUrl)) {
      setRepositoryBranches([]);
      setRepositoryAccess('idle');
      setRepositoryAccessMessage('');
      return;
    }
    const controller = new AbortController();
    setRepositoryBranches([]);
    setRepositoryAccess('loading');
    setRepositoryAccessMessage('正在验证仓库访问权限并加载分支...');
    const timer = window.setTimeout(() => {
      void loadRepositoryBranches(repositoryUrl, form.repositoryToken.trim(), controller.signal).then((branches) => {
        if (!branches.length) throw new Error('仓库可访问，但没有可用分支');
        setRepositoryBranches(branches);
        setRepositoryAccess('success');
        setRepositoryAccessMessage(`已验证访问权限，加载到 ${branches.length} 个分支`);
        setForm((current) => ({
          ...current,
          branch: branches.includes(current.branch) ? current.branch : branches.includes('main') ? 'main' : branches[0],
        }));
      }).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setRepositoryAccess('error');
        setRepositoryAccessMessage(error instanceof Error ? error.message : String(error));
      });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [form.sourceType, form.repositoryUrl, form.repositoryToken]);
  function patch<K extends keyof NewScanForm>(key: K, value: NewScanForm[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function chooseLevel(level: ScanLevel) {
    const nextProfile = scanLevelProfiles[level];
    setForm((current) => ({
      ...current,
      scanLevel: level,
      mode: nextProfile.mode,
      engines: nextProfile.engines,
      model: '系统智能组合',
      aiModelId: undefined,
    }));
  }
  function validateCurrent() {
    const nextErrors: Record<string, string> = {};
    if (step === 1 && !form.product.trim()) nextErrors.product = '请输入产品名称';
    if (step === 1 && !form.project.trim()) nextErrors.project = '请输入扫描项目名称';
    if (step === 2 && form.sourceType === 'git' && !/^https:\/\/.+/.test(form.repositoryUrl)) nextErrors.source = '请输入有效的 HTTPS Git 仓库地址';
    else if (step === 2 && form.sourceType === 'git' && repositoryAccess !== 'success') nextErrors.source = repositoryAccess === 'error' ? repositoryAccessMessage : '请等待仓库权限验证和分支加载完成';
    if (step === 2 && form.sourceType === 'upload' && !form.fileName) nextErrors.source = '请选择代码压缩包';
    setErrors(nextErrors);
    return !Object.keys(nextErrors).length;
  }
  function next() { if (validateCurrent()) setStep((current) => Math.min(6, current + 1)); }
  function submit() {
    if (insufficient) return notify('积分余额不足，请先充值或调整扫描等级');
    if (validateCurrent()) {
      onCreate(form, selectedProduct);
      patch('repositoryToken', '');
    }
  }
  function handleFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      patch('fileName', ''); patch('fileSize', ''); patch('archiveFile', undefined);
      return notify('仅支持 ZIP 格式的代码压缩包');
    }
    if (file.size > 64 * 1024 * 1024) {
      patch('fileName', ''); patch('fileSize', ''); patch('archiveFile', undefined);
      return notify('代码压缩包不能超过 64 MiB');
    }
    patch('fileName', file.name); patch('fileSize', `${(file.size / 1024 / 1024).toFixed(1)} MB`); patch('archiveFile', file); setUploadProgress(20);
    const timer = window.setInterval(() => setUploadProgress((value) => { if (value >= 100) { window.clearInterval(timer); return 100; } return value + 20; }), 180);
  }
  return <div className="modal-backdrop"><div className="create-modal wizard-modal" role="dialog" aria-modal="true">
    <div className="modal-header"><div><span className="modal-icon"><Bot size={20} /></span><div><h2>新建安全扫描</h2><p>按使用场景选择扫描等级，系统自动组合最合适的检测能力</p></div></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div>
    <div className="wizard-steps">{steps.map((label, index) => <button key={label} className={classNames(step === index + 1 && 'active', step > index + 1 && 'done')} onClick={() => index + 1 < step && setStep(index + 1)}><span>{step > index + 1 ? <Check size={13} /> : index + 1}</span>{label}</button>)}</div>
    <div className="wizard-layout"><section className="wizard-content">
      {step === 1 && <div className="wizard-section"><div className="column-heading"><span>01</span><div><h3>项目基本信息</h3><p>标识本次扫描所属的产品与项目</p></div></div><div className="form-grid"><Field label="产品" required error={errors.product}><input list="product-catalog" value={form.product} onChange={(event) => patch('product', event.target.value)} placeholder={catalogLoading ? '正在加载产品目录' : catalogError ? '输入产品名称' : '选择或输入产品名称'} /><datalist id="product-catalog">{catalogProducts.map((product) => <option key={product.id} value={product.name} />)}</datalist></Field><Field label="扫描项目名称" required error={errors.project}><input value={form.project} onChange={(event) => patch('project', event.target.value)} placeholder="例如 user-center" /></Field></div><Field label="预计代码行数"><input type="number" min="1000" step="1000" value={form.estimatedLines} onChange={(event) => patch('estimatedLines', Number(event.target.value))} /><small>用于费用预估，最终按实际扫描量结算</small></Field></div>}
      {step === 2 && <div className="wizard-section"><div className="column-heading"><span>02</span><div><h3>选择代码来源</h3><p>从 Git 仓库或压缩包获取待扫描代码</p></div></div><Field label="代码来源" required error={errors.source}><div className="segmented"><button className={form.sourceType === 'git' ? 'active' : ''} onClick={() => patch('sourceType', 'git')}><GitBranch size={17} />Git 仓库</button><button className={form.sourceType === 'upload' ? 'active' : ''} onClick={() => patch('sourceType', 'upload')}><Upload size={17} />上传代码</button></div></Field>{form.sourceType === 'git' ? <div className="source-box"><Field label="Git 仓库地址"><input value={form.repositoryUrl} onChange={(event) => patch('repositoryUrl', event.target.value)} placeholder="https://git.example.com/team/project.git" /></Field><Field label="仓库授权令牌（可选）"><input type="password" autoComplete="off" value={form.repositoryToken} onChange={(event) => patch('repositoryToken', event.target.value)} placeholder="私有仓库的访问令牌" /><small>令牌加密保存，仅由扫描引擎在拉取当前仓库时使用。</small></Field>{repositoryAccess !== 'idle' && <div className={classNames('repository-access', repositoryAccess)}>{repositoryAccess === 'loading' ? <LoaderCircle className="stage-spinner" size={15} /> : repositoryAccess === 'success' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}<span>{repositoryAccessMessage}</span></div>}<div className="form-grid"><Field label="分支"><select value={form.branch} disabled={repositoryAccess !== 'success'} onChange={(event) => patch('branch', event.target.value)}>{repositoryBranches.length ? repositoryBranches.map((branch) => <option key={branch}>{branch}</option>) : <option>{repositoryAccess === 'loading' ? '正在加载分支' : '请先验证仓库权限'}</option>}</select></Field><Field label="Commit ID（可选）"><input value={form.commitId} onChange={(event) => patch('commitId', event.target.value)} /></Field></div></div> : <div className="upload-zone" onClick={() => fileRef.current?.click()}><input ref={fileRef} type="file" accept=".zip,.tar,.gz" hidden onChange={(event) => handleFile(event.target.files?.[0])} />{form.fileName ? <><FileArchive size={28} /><strong>{form.fileName}</strong><span>{form.fileSize} · {uploadProgress === 100 ? '上传完成' : `上传中 ${uploadProgress}%`}</span><div className="progress-track"><i style={{ width: `${uploadProgress}%` }} /></div></> : <><Upload size={28} /><strong>选择代码压缩包</strong><span>支持 ZIP、TAR、GZ，最大 500 MB</span></>}</div>}</div>}
      {step === 3 && <div className="wizard-section"><div className="column-heading"><span>03</span><div><h3>选择扫描等级</h3><p>不熟悉安全工具也没关系，按当前阶段选择即可</p></div></div><div className="scan-level-grid">{(Object.entries(scanLevelProfiles) as [ScanLevel, typeof profile][]).map(([level, item]) => { const selected = form.scanLevel === level; const levelCredits = estimateCredits({ ...form, scanLevel: level, mode: item.mode, engines: item.engines, priority: '普通' }, rules); return <button key={level} className={classNames(selected && 'active', level === '标准检查' && 'recommended')} onClick={() => chooseLevel(level)}><span className="level-kicker">{item.tagline}</span>{level === '标准检查' && <em>推荐</em>}<CheckCircle2 size={18} /><strong>{level}</strong><small>{item.description}</small><dl><div><dt>适合阶段</dt><dd>{item.stage}</dd></div><div><dt>检测依据</dt><dd>{item.basis}</dd></div><div><dt>扫描耗时</dt><dd>{item.duration}</dd></div></dl><b>预计 {levelCredits} 积分</b></button>; })}</div><div className="level-note"><ShieldCheck size={17} /><span><strong>系统自动组合检测能力</strong><small>你只需选择用途；结果会统一校验、去重并生成一份报告。</small></span></div></div>}
      {step === 4 && <div className="wizard-section"><div className="column-heading"><span>04</span><div><h3>扫描范围与规则</h3><p>控制目录范围和重点漏洞类型</p></div></div><TagEditor label="排除目录" values={form.excludes} onChange={(values) => patch('excludes', values)} /><TagEditor label="排除文件类型" values={form.excludePatterns} onChange={(values) => patch('excludePatterns', values)} /><Field label="指定扫描目录"><input value={form.scanDirectories} onChange={(event) => patch('scanDirectories', event.target.value)} placeholder="例如 src/, app/；留空扫描整个项目" /></Field><div className="vulnerability-picker"><div className="picker-heading"><label>漏洞类型</label><div><button onClick={() => patch('vulnerabilityTypes', vulnerabilityTypes)}>全选</button><button onClick={() => patch('vulnerabilityTypes', [])}>取消</button></div></div><div className="check-grid">{vulnerabilityTypes.map((item) => <label key={item}><input type="checkbox" checked={form.vulnerabilityTypes.includes(item)} onChange={() => patch('vulnerabilityTypes', form.vulnerabilityTypes.includes(item) ? form.vulnerabilityTypes.filter((value) => value !== item) : [...form.vulnerabilityTypes, item])} /><span><Check size={12} /></span>{item}</label>)}</div></div><div className="scan-policy-summary"><div><FileSearch size={18} /><span><strong>当前扫描依据</strong><small>{form.scanLevel} · {form.vulnerabilityTypes.length ? `聚焦 ${form.vulnerabilityTypes.length} 类已选漏洞` : '未指定类型时执行完整漏洞基线'}</small></span></div><dl><div><dt>分析路径</dt><dd>攻击者入口或敏感源 → 传播与转换 → 校验/权限防护 → 危险点或安全边界 → 实际影响</dd></div><div><dt>结果门槛</dt><dd>必须有真实文件与行号、可达条件和具体影响；纯加固建议、样式问题和无调用路径的推测不进入报告。</dd></div><div><dt>等级策略</dt><dd>{profile.basis}</dd></div></dl></div></div>}
      {step === 5 && <div className="wizard-section"><div className="column-heading"><span>05</span><div><h3>选择排队方式</h3><p>等待时间根据当前扫描等级的独立队列动态估算</p></div></div><div className="queue-load"><Activity size={18} /><div><strong>{form.scanLevel}队列有 {tasks.filter((task) => taskScanLevel(task) === form.scanLevel && ['排队中', '扫描中'].includes(task.status)).length} 个任务正在处理</strong><span>不同扫描等级使用独立队列，预计值会随新任务、项目大小和实际运行情况变化</span></div></div><Field label="任务优先级"><div className="mode-options queue-options"><button className={form.priority === '普通' ? 'active' : ''} onClick={() => patch('priority', '普通')}><Clock3 size={20} /><span><strong>普通排队</strong><small>{estimateQueue(tasks, '普通', form.scanLevel).ahead} 个任务在前，{estimateQueue(tasks, '普通', form.scanLevel).label}</small></span><em>不加收积分</em></button><button className={form.priority === '加急' ? 'active urgent' : ''} onClick={() => patch('priority', '加急')}><Rocket size={20} /><span><strong>优先处理</strong><small>{estimateQueue(tasks, '加急', form.scanLevel).ahead} 个任务在前，{estimateQueue(tasks, '加急', form.scanLevel).label}</small></span><em>额外 {Math.ceil(normalCredits * (rules.urgentMultiplier - 1))} 积分</em></button></div></Field><div className="priority-explainer"><AlertTriangle size={16} /><span>优先处理只在当前扫描等级队列内生效，会排在尚未开始的普通任务之前，但不会中断正在运行的扫描。</span></div><Field label="执行方式"><select value={form.execution} onChange={(event) => patch('execution', event.target.value as NewScanForm['execution'])}><option>立即扫描</option><option>稍后扫描</option></select></Field><div className="level-note"><Bot size={17} /><span><strong>扫描结果自动通知</strong><small>任务结束后，将按个人中心启用的飞书应用机器人和 Webhook 通道发送结果。</small></span></div></div>}
      {step === 6 && <div className="wizard-section"><div className="column-heading"><span>06</span><div><h3>确认扫描与费用</h3><p>提交后将预冻结预估费用，任务结束自动结算差额</p></div></div><div className="review-list"><div><span>项目</span><strong>{form.product} / {form.project}</strong></div><div><span>代码来源</span><strong>{form.sourceType === 'git' ? `${form.repositoryUrl} · ${form.branch}` : form.fileName}</strong></div><div><span>扫描方案</span><strong>{form.scanLevel} · {profile.stage}</strong></div><div><span>预计扫描</span><strong>{profile.duration}</strong></div><div><span>排队方式</span><strong>{form.priority === '加急' ? '优先处理' : '普通排队'} · {queueEstimate.label}</strong></div><div><span>通知方式</span><strong>按个人中心启用的飞书通道发送</strong></div></div><div className={classNames('balance-check', insufficient && 'insufficient')}>{insufficient ? <AlertTriangle /> : <ShieldCheck />}<div><strong>{insufficient ? '积分余额不足' : '余额充足，可以提交'}</strong><span>当前可用 {account.available} 积分，本次预计冻结 {estimatedCredits} 积分</span></div></div></div>}
    </section><aside className="cost-sidebar"><span className="eyebrow">ESTIMATE</span><h3>费用与时间预估</h3><div><span>{form.scanLevel}</span><b>{normalCredits}</b></div><div><span>预计代码量</span><b>{(form.estimatedLines ?? 0).toLocaleString()} 行</b></div>{form.priority === '加急' && <div><span>优先处理加收</span><b>+{prioritySurcharge}</b></div>}<div><span>前方任务</span><b>{queueEstimate.ahead} 个</b></div><div><span>预计开始</span><b>{queueEstimate.label.replace('预计', '')}</b></div><div><span>预计扫描</span><b>{profile.duration}</b></div><div className="cost-total"><span>预计冻结</span><strong>{estimatedCredits}<small> 积分</small></strong></div><p>费用和时间均为预估。实际费用按完成的代码量与扫描用量结算，多冻结部分自动退回。</p></aside></div>
    <div className="modal-footer"><span><ShieldCheck size={16} />所有积分变化均生成可追溯流水</span><div><button className="secondary-button" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? '取消' : '上一步'}</button>{step < 6 ? <button className="primary-button" onClick={next}>下一步<ChevronRight size={16} /></button> : <button className="primary-button" disabled={insufficient} onClick={submit}><Play size={16} />{form.execution === '立即扫描' ? `确认并冻结 ${estimatedCredits} 积分` : '保存任务'}</button>}</div></div>
  </div></div>;
}

function TagEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [input, setInput] = useState('');
  function add() { if (input.trim() && !values.includes(input.trim())) onChange([...values, input.trim()]); setInput(''); }
  return <div className="tag-editor"><label>{label}</label><div className="tags">{values.map((value) => <span key={value}>{value}<button onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} /></button></span>)}<input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} placeholder="输入后回车新增" /></div></div>;
}

function FindingDrawer({ finding, task, onClose, onUpdate, notify }: { finding: Finding; task: ScanTask; onClose: () => void; onUpdate: (finding: Finding) => void; notify: (message: string) => void }) {
  const [confirmAction, setConfirmAction] = useState<FindingStatus | null>(null);
  const [reason, setReason] = useState('');
  const hasVerifiedDataFlow = finding.dataFlow[0]?.kind === 'Source' && finding.dataFlow[finding.dataFlow.length - 1]?.kind === 'Sink';
  const dataFlowFileCount = new Set(finding.dataFlow.map((node) => node.file)).size;
  const dataFlowMethod = finding.dataFlowMethod === 'ast-assisted' ? '结构辅助分析' : '上下文分析';
  function applyStatus(status: FindingStatus) {
    if (status === '误报' && !reason.trim()) return;
    const updated = { ...finding, status, history: [...(finding.history ?? []), { action: status, reason: reason || undefined, at: formatBeijingDateTime(new Date()) }] };
    onUpdate(updated); setConfirmAction(null); setReason(''); notify(`漏洞已标记为${status}`);
  }
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="finding-drawer">
    <div className="drawer-header"><div><div className="drawer-id"><span className={`severity-badge severity-${finding.severity}`}>{finding.severity}</span><span>{finding.id}</span><span>{finding.type}</span></div><h2>{finding.name}</h2><div className="location"><FileCode2 size={15} /><code>{finding.file}:{finding.line}</code><span>分析可信度 <b>{finding.confidence}%</b></span></div></div><button className="icon-button" onClick={onClose}><X size={21} /></button></div>
    <div className="drawer-content">
      <section className="analysis-section"><SectionTitle number="1" title="安全漏洞存在性" icon={<ShieldAlert />} /><p className="analysis-lead">{finding.existence}</p><div className="agent-verdict"><Sparkles size={18} /><div><strong>真实性判断</strong><span>{hasVerifiedDataFlow ? '报告提供了完整 Source → Sink 传播路径，请结合代码证据复核' : '基于代码上下文推断，报告未提供可验证的完整传播路径'}</span></div><b>{finding.confidence}%</b></div></section>
      <section className="analysis-section"><SectionTitle number="2" title="漏洞利用条件及触发方式" icon={<KeyRound />} /><div className="condition-grid"><div><span>利用前提</span>{finding.exploitConditions.map((item) => <p key={item}><CheckCircle2 size={15} />{item}</p>)}</div><div><span>影响范围</span><p>{finding.impact}</p></div></div></section>
      <section className="analysis-section"><SectionTitle number="3" title="Source → Sink 数据流分析" icon={<Network />} />{hasVerifiedDataFlow ? <><p className="section-description">{dataFlowMethod}记录了涉及 {dataFlowFileCount} 个文件的 Source → Sink 传播路径。该路径仍需结合代码人工复核。</p>{(finding.dataFlowLimitations ?? []).map((limitation) => <p className="section-description" key={limitation}>分析限制：{limitation}</p>)}<div className="data-flow">{finding.dataFlow.map((node, index) => <div className={`flow-node flow-${node.kind.toLowerCase()}`} key={`${node.file}-${node.line}`}><div className="flow-rail"><span>{node.kind === 'Source' ? <ExternalLink size={16} /> : node.kind === 'Sink' ? <ShieldAlert size={16} /> : <GitBranch size={16} />}</span>{index < finding.dataFlow.length - 1 && <i />}</div><button onClick={() => notify(`已定位到 ${node.file}:${node.line}`)}><div className="flow-kind">{node.kind}<small>{node.label}</small></div><div className="flow-location"><strong title={node.functionName}>{node.functionName.endsWith(')') ? node.functionName : `${node.functionName}()`}</strong><code title={node.variable}>{node.variable}</code><span title={`${node.file}:${node.line}`}>{node.file}:{node.line}</span></div><ChevronRight size={16} /></button></div>)}</div></> : <p className="section-description">当前报告未包含可验证的数据流节点。以下结论来自代码上下文推断，不代表静态污点分析结果。</p>}</section>
      <section className="analysis-section"><SectionTitle number="4" title="关键代码片段" icon={<Code2 />} />{finding.snippets.length ? <div className="snippet-list">{finding.snippets.map((snippet) => <CodeSnippetView key={`${snippet.file}:${snippet.highlightLine}:${snippet.title}`} snippet={snippet} notify={notify} />)}</div> : <div className="snippet-empty"><FileSearch size={20} /><div><strong>暂无可展示的代码片段</strong><span>{finding.snippetUnavailableReason ?? '报告包含定位信息，但没有匹配到对应的源码内容。'}</span></div></div>}</section>
      <section className="analysis-section ai-analysis"><SectionTitle number="5" title="安全分析" icon={<ShieldCheck />} /><div className="ai-message"><span><Sparkles size={20} /></span><p>{sanitizeUserVisibleText(finding.aiAnalysis)}</p></div></section>
      <section className="analysis-section"><SectionTitle number="6" title="修复建议" icon={<ShieldCheck />} /><div className="remediation-list">{finding.remediation.map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</div><div className="fixed-code"><div><strong>推荐修复示例</strong><button onClick={() => { navigator.clipboard.writeText(finding.fixedCode); notify('修复代码已复制'); }}><Copy size={14} />复制</button></div><pre>{finding.fixedCode}</pre></div></section>
      <section className="analysis-section"><SectionTitle number="7" title="判断依据" icon={<FileSearch />} /><div className="evidence-grid">{finding.evidence.map((item) => <div key={item.label}><span>{item.label}</span><strong className={item.positive ? '' : 'negative'}>{item.positive ? <CheckCircle2 size={15} /> : <XCircle size={15} />}{item.value}</strong></div>)}</div><div className="final-verdict"><span>最终判断</span><strong>{finding.status === '待确认' ? '疑似有效漏洞，建议人工确认' : finding.status}</strong><div><i style={{ width: `${finding.confidence}%` }} /></div></div></section>
    </div>
    <div className="drawer-footer"><div><span>当前状态</span><strong className={`finding-status status-${finding.status}`}>{finding.status}</strong></div><div><button className="secondary-button" onClick={() => setConfirmAction('误报')}>标记误报</button><button className="secondary-button" onClick={() => setConfirmAction('风险接受')}>风险接受</button><button className="secondary-button" onClick={() => setConfirmAction('已修复')}>已修复</button><button className="primary-button" onClick={() => setConfirmAction('有效漏洞')}><ShieldCheck size={16} />确认有效</button></div></div>
    {confirmAction && <div className="inline-dialog"><div><h3>确认标记为「{confirmAction}」</h3><p>该操作将作为人工研判结果保留在审计记录中。</p>{confirmAction === '误报' && <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请填写误报原因，例如：参数已在上层经过白名单校验" autoFocus />}<div><button className="secondary-button" onClick={() => setConfirmAction(null)}>取消</button><button className="primary-button" disabled={confirmAction === '误报' && !reason.trim()} onClick={() => applyStatus(confirmAction)}>确认</button></div></div></div>}
  </aside></div>;
}

function CodeSnippetView({ snippet, notify }: { snippet: Finding['snippets'][number]; notify: (message: string) => void }) {
  const lines = snippet.code.split('\n');
  return <div className="code-card"><div className="code-card-head"><div><span>{snippet.title}</span><code>{snippet.file}:{snippet.highlightLine}</code></div><button onClick={() => { navigator.clipboard.writeText(snippet.code); notify('代码片段已复制'); }}><Clipboard size={14} />复制代码</button></div><pre>{lines.map((line, index) => <div key={index} className={snippet.startLine + index === snippet.highlightLine ? 'highlight' : ''}><span>{snippet.startLine + index}</span><code>{line || ' '}</code></div>)}</pre></div>;
}

function TaskDetailPage({ page, showTokenUsage, onBack, onSwitch, onDownload }: { page: NonNullable<TaskPageState>; showTokenUsage: boolean; onBack: () => void; onSwitch: (type: 'logs' | 'report') => void; onDownload: (task: ScanTask) => void }) {
  const task = page.task;
  const report = parseSecurityReport(task.reportJson);
  const rawGeneratedAt = report?.metadata.generatedAt;
  const generatedAt = isValidTimestamp(rawGeneratedAt) ? formatBeijingDateTime(rawGeneratedAt) : task.createdAt;
  return <section className="task-detail-page">
    <header className="task-detail-header">
      <button className="detail-back" onClick={onBack}><ArrowLeft size={17} />返回扫描任务</button>
      <div className="task-detail-title"><span className="detail-page-icon">{page.type === 'logs' ? <Activity size={22} /> : <ShieldCheck size={22} />}</span><div><small>{task.project} / {task.id}</small><h1>{page.type === 'logs' ? '扫描执行日志' : '代码安全扫描报告'}</h1><p>{task.name}</p></div></div>
      <div className="task-detail-actions">
        <button className={classNames('detail-tab', page.type === 'report' && 'active')} onClick={() => onSwitch('report')}><BarChart3 size={16} />查看报告</button>
        <button className={classNames('detail-tab', page.type === 'logs' && 'active')} onClick={() => onSwitch('logs')}><Activity size={16} />扫描日志</button>
        {page.type === 'report' && <button className="primary-button" onClick={() => onDownload(task)}><FileDown size={16} />下载报告</button>}
      </div>
    </header>
    <div className="task-detail-meta">
      <span className={`status-pill ${statusTone(task.status)}`}>{task.status}</span>
      <span><strong>当前阶段</strong>{userVisibleStage(task.stage)}</span>
      <span><strong>执行进度</strong>{task.progress}%</span>
      <span><strong>创建时间</strong>{task.createdAt}</span>
      <span><strong>已用时间</strong>{task.duration}</span>
      {showTokenUsage && <span><strong>AI Token（输入 / 输出 / 总计）</strong>{(task.aiInputTokens ?? 0).toLocaleString()} / {(task.aiOutputTokens ?? 0).toLocaleString()} / {(task.aiTotalTokens ?? 0).toLocaleString()}{task.aiTokenUsageEstimated ? '（估算）' : ''}</span>}
    </div>
    {page.loading && <div className="detail-notice loading"><LoaderCircle className="spin" size={16} />正在同步最新{page.type === 'logs' ? '执行日志' : '扫描报告'}…</div>}
    {page.error && <div className="detail-notice warning"><AlertTriangle size={16} /><span><strong>最新数据同步失败</strong>当前展示任务中已保存的数据。{page.error}</span></div>}
    {page.type === 'logs' ? <TaskLogPage task={task} /> : <TaskReportPage task={task} report={report} generatedAt={generatedAt} />}
  </section>;
}

function TaskLogPage({ task }: { task: ScanTask }) {
  const completedLogs = task.logs.filter((log) => log.level === 'success').length;
  const warningLogs = task.logs.filter((log) => log.level === 'warning' || log.level === 'error').length;
  return <div className="task-detail-body log-page-body">
    <div className="detail-stat-grid">
      <Metric icon={<Activity />} label="日志记录" value={String(task.logs.length)} tone="blue" />
      <Metric icon={<CheckCircle2 />} label="完成节点" value={String(completedLogs)} tone="slate" />
      <Metric icon={<AlertTriangle />} label="异常提示" value={String(warningLogs)} tone="amber" />
      <Metric icon={<Clock3 />} label="当前进度" value={`${task.progress}%`} tone="red" />
    </div>
    <section className="detail-section log-timeline-section">
      <div className="detail-section-heading"><div><span className="section-kicker">EXECUTION TIMELINE</span><h2>任务执行记录</h2><p>展示该任务从排队到报告生成的用户可见状态，不包含内部引擎信息。</p></div><span className={`status-pill ${statusTone(task.status)}`}>{task.status}</span></div>
      {task.logs.length ? <div className="log-timeline">{task.logs.map((log, index) => <article className={`log-event ${log.level}`} key={`${log.time}-${index}`}>
        <div className="log-event-rail"><i />{index < task.logs.length - 1 && <span />}</div>
        <time>{log.time}</time>
        <div className="log-event-content"><div><strong>{userVisibleStage(log.stage ?? task.stage)}</strong>{typeof log.progress === 'number' && <b>{log.progress}%</b>}</div><p>{sanitizeUserVisibleText(log.message)}</p></div>
      </article>)}</div> : <EmptyState icon={<Clock3 />} title={task.status === '排队中' ? '任务正在排队，开始后将在这里记录执行过程' : '该任务暂无执行日志'} />}
    </section>
  </div>;
}

function TaskReportPage({ task, report, generatedAt }: { task: ScanTask; report?: SecurityReport; generatedAt: string }) {
  const displayedFindingCount = report?.findings.length ?? task.findings.length;
  return <div className="task-detail-body report-page-body">
    <div className="report-page-cover"><div><span className="section-kicker">SECURITY SCAN REPORT</span><h2>{task.project} 代码安全扫描报告</h2><p>基于本次扫描范围汇总问题、证据、影响与修复建议</p></div><dl><div><dt>报告生成</dt><dd>{generatedAt}</dd></div><div><dt>扫描范围</dt><dd>{task.mode}</dd></div><div><dt>任务编号</dt><dd>{task.id}</dd></div></dl></div>
    <div className="detail-stat-grid report-stat-grid">
      <Metric icon={<FileCode2 />} label="扫描文件" value={String(task.scannedFiles)} tone="blue" />
      <Metric icon={<Code2 />} label="代码行" value={task.lines.toLocaleString()} tone="slate" />
      <Metric icon={<AlertTriangle />} label="发现问题" value={String(displayedFindingCount)} tone="amber" />
      <Metric icon={<ShieldAlert />} label="需人工复核" value={String(report?.manualReview.length ?? task.findings.filter((item) => item.status === '待确认').length)} tone="red" />
    </div>
    <div className="report-overview-grid">
      <section className="detail-section risk-distribution"><div className="detail-section-heading compact"><div><h2>风险分布</h2><p>按严重程度统计本次发现</p></div></div>{severityOrder.map((severity) => { const count = report ? report.summary[({ 严重: 'critical', 高危: 'high', 中危: 'medium', 低危: 'low' } as const)[severity]] : riskCount(task, severity); return <div key={severity}><span>{severity}</span><div><i className={`severity-bg-${severity}`} style={{ width: count ? `${Math.max(8, Math.min(100, count * 20))}%` : '0%' }} /></div><b>{count}</b></div>; })}</section>
      <section className="detail-section report-summary"><div className="detail-section-heading compact"><div><h2>扫描摘要</h2><p>用于快速判断后续处理优先级</p></div></div><p>本次{task.mode}已覆盖 {task.scannedFiles || task.totalFiles} 个文件，共记录 {displayedFindingCount} 个安全问题。建议先处理严重和高危问题，对待确认项补充业务上下文后再进行人工研判，并在修复完成后重新扫描验证。</p></section>
    </div>
    {report ? <StructuredReport report={report} /> : task.findings.length ? <TaskFindingReport findings={task.findings} /> : task.reportMarkdown ? <div className="detail-section report-markdown"><div className="detail-section-heading compact"><div><h2>历史扫描报告</h2></div></div><pre>{sanitizeUserVisibleText(task.reportMarkdown)}</pre></div> : <section className="detail-section"><EmptyState icon={<ShieldCheck />} title={task.status === '扫描完成' ? '本次扫描未发现需要展示的安全问题' : '报告内容将在扫描完成后持续更新'} /></section>}
  </div>;
}

function StructuredReport({ report }: { report: SecurityReport }) {
  const severityNames = { critical: '严重', high: '高危', medium: '中危', low: '低危' } as const;
  const confidenceNames = { high: '高', medium: '中', low: '低' } as const;
  return <div className="structured-report-page">
    <section className="detail-section report-findings"><div className="detail-section-heading"><div><span className="section-kicker">FINDINGS</span><h2>问题明细</h2><p>共 {report.findings.length} 项，包含定位、证据、影响和验证方式。</p></div></div>
      {report.findings.length ? <div className="report-finding-list">{report.findings.map((finding) => <article key={finding.id}><header><span className={`severity-badge severity-${severityNames[finding.severity]}`}>{severityNames[finding.severity]}</span><div><h3>{finding.title}</h3><p>{finding.id} · {finding.rule} · 可信度 {confidenceNames[finding.confidence]}</p></div></header><div className="report-finding-location"><FileCode2 size={15} />{finding.locations.map((location) => `${location.path}:${location.line}`).join('、')}</div><dl><div><dt>判断依据</dt><dd>{finding.evidence}</dd></div><div><dt>影响</dt><dd>{finding.impact}</dd></div><div><dt>修复建议</dt><dd>{finding.remediation}</dd></div><div><dt>验证方式</dt><dd>{finding.verification}</dd></div></dl></article>)}</div> : <EmptyState icon={<ShieldCheck />} title="本次扫描未发现安全问题" />}
    </section>
    <ReportReviewAndCoverage manualReview={report.manualReview} checked={report.coverage.checked} notChecked={report.coverage.notChecked} />
  </div>;
}

function TaskFindingReport({ findings }: { findings: Finding[] }) {
  return <section className="detail-section report-findings"><div className="detail-section-heading"><div><span className="section-kicker">FINDINGS</span><h2>问题明细</h2><p>共 {findings.length} 项，展示当前任务已经保存的分析结果。</p></div></div><div className="report-finding-list">{findings.map((finding) => <article key={finding.id}><header><span className={`severity-badge severity-${finding.severity}`}>{finding.severity}</span><div><h3>{finding.name}</h3><p>{finding.id} · {finding.type} · {finding.status}</p></div></header><div className="report-finding-location"><FileCode2 size={15} />{finding.file}:{finding.line}</div><dl><div><dt>判断依据</dt><dd>{sanitizeUserVisibleText(finding.existence)}</dd></div><div><dt>影响</dt><dd>{sanitizeUserVisibleText(finding.impact)}</dd></div><div><dt>修复建议</dt><dd>{finding.remediation.map(sanitizeUserVisibleText).join('；') || '建议结合业务逻辑制定修复方案。'}</dd></div><div><dt>处理状态</dt><dd>{finding.status}</dd></div></dl></article>)}</div></section>;
}

function ReportReviewAndCoverage({ manualReview, checked, notChecked }: { manualReview: SecurityReport['manualReview']; checked: string[]; notChecked: string[] }) {
  return <div className="report-bottom-grid">
    <section className="detail-section"><div className="detail-section-heading compact"><div><h2>人工复核项</h2><p>需要补充业务信息后进一步确认</p></div><span className="count-badge">{manualReview.length}</span></div>{manualReview.length ? <div className="report-review-list">{manualReview.map((item) => <article key={item.id}><strong>{item.title}</strong><span>{item.rule}</span><p>{item.reason}</p><small>需要：{item.requiredEvidence}</small></article>)}</div> : <p className="report-empty-copy">暂无需要人工补充证据的项目。</p>}</section>
    <section className="detail-section"><div className="detail-section-heading compact"><div><h2>扫描覆盖范围</h2><p>说明本次已检查和未检查的内容</p></div></div><div className="coverage-group"><strong><CheckCircle2 size={15} />已检查</strong><div>{checked.length ? checked.map((item) => <span key={item}>{item}</span>) : <small>无记录</small>}</div></div><div className="coverage-group muted"><strong><AlertTriangle size={15} />未检查</strong><div>{notChecked.length ? notChecked.map((item) => <span key={item}>{item}</span>) : <small>无</small>}</div></div></section>
  </div>;
}

function ConfigManagement({ notify }: { notify: (message: string) => void }) {
  const [section, setSection] = useState('扫描模板');
  const [templates, setTemplates] = useState([{ name: '研发日常安全扫描', mode: '标准模式', scope: '全项目', types: 8, isDefault: true }, { name: '发布前深度审计', mode: '深度模式', scope: 'src/, server/', types: 16, isDefault: false }, { name: '密钥与敏感信息检查', mode: '标准模式', scope: '全项目', types: 3, isDefault: false }]);
  const sections = [{ name: '扫描模板', icon: <Layers3 /> }, { name: 'AI模型配置', icon: <Bot /> }, { name: '默认扫描规则', icon: <ShieldCheck /> }, { name: '漏洞类型', icon: <ShieldAlert /> }, { name: '扫描策略', icon: <SlidersHorizontal /> }];
  return <ManagementLayout eyebrow="POLICY & MODELS" title="配置管理" description="维护 AI 安全审计模型、模板和组织级扫描策略" sections={sections} active={section} onActive={setSection}>
    {section === '扫描模板' && <><PageActions title="扫描模板" description="复用扫描范围、漏洞类型与 Agent 执行参数" action="新增模板" onAction={() => { setTemplates((current) => [...current, { name: `新扫描模板 ${current.length + 1}`, mode: '深度模式', scope: '全项目', types: 16, isDefault: false }]); notify('扫描模板已创建'); }} /><div className="management-table"><table><thead><tr><th>模板名称</th><th>扫描模式</th><th>扫描范围</th><th>漏洞类型</th><th>状态</th><th>操作</th></tr></thead><tbody>{templates.map((template, index) => <tr key={template.name}><td><strong>{template.name}</strong></td><td><span className="mode-chip"><Bot size={14} />{template.mode}</span></td><td>{template.scope}</td><td>{template.types} 项</td><td>{template.isDefault ? <span className="status-pill success">默认模板</span> : '正常'}</td><td><div className="row-actions"><button onClick={() => notify('模板编辑器已打开')}>编辑</button><button onClick={() => { setTemplates((current) => [...current, { ...template, name: `${template.name} - 副本`, isDefault: false }]); notify('模板已复制'); }}>复制</button><button onClick={() => setTemplates((current) => current.map((item, itemIndex) => ({ ...item, isDefault: itemIndex === index })))}>设为默认</button><button className="danger-text" onClick={() => setTemplates((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</button></div></td></tr>)}</tbody></table></div></>}
    {section === 'AI模型配置' && <><PageActions title="AI 模型配置" description="管理用于代码上下文分析和漏洞验证的模型" action="接入模型" onAction={() => notify('模型接入向导已打开')} /><div className="model-grid">{models.map((model, index) => <div className="model-card" key={model}><div><span><Bot /></span><div><h3>{model}</h3><p>{index === 0 ? '深度安全审计主模型' : index === 1 ? '快速初筛与日常扫描' : '复杂调用链推理模型'}</p></div></div><dl><div><dt>上下文窗口</dt><dd>{index === 1 ? '128K' : '256K'}</dd></div><div><dt>状态</dt><dd className="online">可用</dd></div></dl><button onClick={() => notify(`${model} 连通性测试通过`)}><Activity size={15} />测试连接</button></div>)}</div></>}
    {!['扫描模板', 'AI模型配置'].includes(section) && <PolicyPanel section={section} notify={notify} />}
  </ManagementLayout>;
}

function PlatformManagement({ notify }: { notify: (message: string) => void }) {
  const [section, setSection] = useState('用户管理');
  const [users, setUsers] = useState([{ name: '张伟', account: 'zhangwei', role: '安全人员', product: '全部产品', status: '正常' }, { name: '李敏', account: 'limin', role: '普通研发人员', product: '用户中心', status: '正常' }, { name: '王浩', account: 'wanghao', role: '管理员', product: '全部产品', status: '正常' }]);
  const sections = [{ name: '用户管理', icon: <Users /> }, { name: '角色管理', icon: <UserCog /> }, { name: '产品管理', icon: <Box /> }, { name: '任务管理', icon: <Activity /> }, { name: '系统配置', icon: <Settings2 /> }, { name: '操作日志', icon: <FileSearch /> }];
  return <ManagementLayout eyebrow="ORGANIZATION" title="平台管理" description="管理用户权限、产品边界与平台运行状态" sections={sections} active={section} onActive={setSection}>
    {section === '用户管理' ? <><PageActions title="用户管理" description="用户仅可访问角色与产品授权范围内的扫描任务" action="新增用户" onAction={() => { setUsers((current) => [...current, { name: '新用户', account: `user${current.length + 1}`, role: '普通研发人员', product: '内部管理系统', status: '正常' }]); notify('用户已添加'); }} /><div className="management-table"><table><thead><tr><th>用户</th><th>账号</th><th>角色</th><th>产品范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.account}><td><div className="user-cell"><span>{user.name.slice(0, 1)}</span><strong>{user.name}</strong></div></td><td>{user.account}</td><td><span className="role-chip">{user.role}</span></td><td>{user.product}</td><td><span className="status-pill success">{user.status}</span></td><td><div className="row-actions"><button onClick={() => notify('用户编辑器已打开')}>编辑</button><button onClick={() => notify('权限配置已打开')}>配置权限</button></div></td></tr>)}</tbody></table></div></> : <PolicyPanel section={section} notify={notify} />}
  </ManagementLayout>;
}

function ManagementLayout({ eyebrow, title, description, sections, active, onActive, children }: { eyebrow: string; title: string; description: string; sections: { name: string; icon: React.ReactNode }[]; active: string; onActive: (name: string) => void; children: React.ReactNode }) {
  return <div className="management-page"><div className="management-header"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div><div className="management-body"><aside>{sections.map((section) => <button key={section.name} className={active === section.name ? 'active' : ''} onClick={() => onActive(section.name)}>{section.icon}{section.name}<ChevronRight size={15} /></button>)}</aside><section className="management-content">{children}</section></div></div>;
}

function PolicyPanel({ section, notify }: { section: string; notify: (message: string) => void }) {
  return <><PageActions title={section} description={`配置组织级${section}，变更将应用于后续扫描任务`} action="保存配置" onAction={() => notify(`${section}已保存`)} /><div className="policy-card"><div><span className="policy-icon"><SlidersHorizontal /></span><div><h3>{section}策略</h3><p>统一管理企业安全扫描的默认行为和使用边界。</p></div></div>{['启用组织默认配置', '允许项目管理员覆盖', '记录配置变更审计日志', '高风险变更需要二次确认'].map((item, index) => <label className="switch-row" key={item}><div><strong>{item}</strong><small>{index === 0 ? '对所有新建扫描任务生效' : '遵循最小权限和可审计原则'}</small></div><input type="checkbox" defaultChecked={index !== 1} /><span /></label>)}</div></>;
}

function PageActions({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return <div className="page-actions"><div><h2>{title}</h2><p>{description}</p></div>{action && onAction && <button className="primary-button" onClick={onAction}><Plus size={16} />{action}</button>}</div>;
}

function SectionTitle({ number, title, icon }: { number: string; title: string; icon: React.ReactNode }) { return <div className="analysis-title"><span>{number}</span><div>{icon}<h3>{title}</h3></div></div>; }
function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) { return <label className={classNames('form-field', error && 'has-error')}><span>{label}{required && <em>*</em>}</span>{children}{error && <small>{error}</small>}</label>; }
function Select({ value, onChange, options, icon }: { value: string; onChange: (value: string) => void; options: Iterable<string>; icon?: React.ReactNode }) { return <label className="select-control">{icon}<select value={value} onChange={(event) => onChange(event.target.value)}>{[...options].map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label>; }
function EmptyState({ icon, title, action, onAction }: { icon: React.ReactNode; title: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span>{icon}</span><p>{title}</p>{action && <button className="primary-button" onClick={onAction}>{action}</button>}</div>; }

export default App;
