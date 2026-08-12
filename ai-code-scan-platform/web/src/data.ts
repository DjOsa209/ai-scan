import type { AIModel, BillingRules, CreditAccount, CreditTransaction, Finding, PlatformNotification, PlatformUser, ScanEngine, ScanTask } from './types';

export const vulnerabilityTypes = ['命令注入', 'SQL注入', '代码执行', '路径穿越', '任意文件读取', '任意文件写入', 'SSRF', 'XXE', '反序列化', '身份认证绕过', '权限绕过', '敏感信息泄露', '硬编码密钥', '不安全加密', '逻辑漏洞', '其他安全问题'];
export const defaultExcludes = ['node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'target', 'vendor', 'generated'];
export const defaultPatterns = ['*.pb.go', '*.pb.*.go', '*_test.go', 'test_*.py', '*.min.js', '*.map'];
export const scanStages = ['获取代码', '项目结构分析', '文件解析', '安全风险初筛', '深度安全分析', '跨文件调用链分析', '数据流分析', '漏洞可利用性判断', '漏洞去重', '报告生成'];

export const seedUsers: PlatformUser[] = [
  { id: 'USR-001', name: '张伟', email: 'admin@secscan.cn', company: '默认团队', department: '安全研发部', employeeNumber: 'A0001', role: '管理员', status: '正常', createdAt: '2026-07-01', lastLoginAt: '2026-08-07 09:42' },
  { id: 'USR-002', name: '李敏', email: 'limin@example.com', company: '星海网络', department: '应用研发部', employeeNumber: 'A0148', role: '用户', status: '正常', createdAt: '2026-07-18', lastLoginAt: '2026-08-06 16:18' },
];

export const seedAccounts: CreditAccount[] = [
  { userId: 'USR-001', available: 3280, frozen: 0, lifetimeUsed: 1720 },
  { userId: 'USR-002', available: 680, frozen: 60, lifetimeUsed: 540 },
];

export const seedTransactions: CreditTransaction[] = [
  { id: 'TXN-001', userId: 'USR-001', type: '充值', amount: 3000, balanceAfter: 3280, description: '企业套餐充值', createdAt: '2026-08-01 10:20' },
  { id: 'TXN-002', userId: 'USR-001', taskId: 'SCAN-20260807-001', type: '结算', amount: -146, balanceAfter: 3280, description: '用户中心发布前深度审计', createdAt: '2026-08-07 10:06' },
];

export const defaultBillingRules: BillingRules = {
  baseCredits: 20,
  perThousandLines: 2,
  deepModeMultiplier: 1.6,
  aiEngineCredits: 18,
  premiumModelCredits: 25,
  urgentMultiplier: 1.5,
};

export const seedEngines: ScanEngine[] = [
  { id: 'engine-sast', name: '静态代码分析', kind: 'SAST', description: '规则与语义分析，定位常见代码缺陷', enabled: true, included: true, execution: 'builtin', timeoutSeconds: 300 },
  { id: 'engine-sca', name: '开源组件检测', kind: 'SCA', description: '识别依赖漏洞与许可证风险', enabled: true, included: true, execution: 'builtin', timeoutSeconds: 300 },
  { id: 'engine-secrets', name: '敏感信息检测', kind: 'Secrets', description: '发现密钥、令牌和凭据泄露', enabled: true, included: true, execution: 'builtin', timeoutSeconds: 120 },
  { id: 'engine-ai', name: 'AI 深度审计', kind: 'AI', description: '跨文件数据流和可利用性研判', enabled: true, included: false, execution: 'builtin', timeoutSeconds: 900 },
];

export const seedModels: AIModel[] = [];

export const seedNotifications: PlatformNotification[] = [
  { id: 'NTF-001', userId: 'USR-001', taskId: 'SCAN-20260807-001', title: '扫描已完成', message: '用户中心发布前深度审计已生成报告', read: false, channel: '站内', createdAt: '2026-08-07 10:06' },
];

const commandInjection: Finding = {
  id: 'VUL-2026-0042', name: '用户可控参数导致命令注入', severity: '严重', type: '命令注入', file: 'service/exec_service.py', line: 58, confidence: 95, status: '待确认', foundAt: '2026-08-07 10:05:18',
  existence: 'HTTP 接口接收用户传入的 cmd 参数，该参数未经白名单校验或安全转义，经由 exec_cmd 与 run_command 两个函数传播，最终进入 os.system。攻击者能够控制完整命令内容，因此存在可直接利用的远程命令执行风险。',
  exploitConditions: ['普通用户可访问 POST /api/tools/execute 接口', '请求体 cmd 字段可被攻击者完整控制', '服务进程具有调用系统 Shell 的权限'],
  impact: '可在应用服务器权限范围内执行任意系统命令，读取服务凭据、篡改业务数据，并可能横向移动到内部网络。',
  aiAnalysis: 'AI Security Agent 追踪了 4 个函数和 3 个文件。外部输入从 Flask 请求对象进入，经业务服务层原样传递至系统命令执行封装。完整链路未发现白名单、参数化调用、转义或权限隔离措施，且路由只要求普通登录态，判断具有高可利用性。',
  remediation: ['使用 subprocess.run 的参数数组形式，并设置 shell=False', '对允许执行的操作建立固定白名单，不接受原始命令文本', '使用低权限独立进程执行必要任务，并限制网络和文件系统访问'],
  fixedCode: "ALLOWED_ACTIONS = {'status': ['/usr/bin/systemctl', 'status', 'agent']}\nargs = ALLOWED_ACTIONS.get(action)\nif not args:\n    abort(400)\nresult = subprocess.run(args, shell=False, capture_output=True, timeout=5)",
  evidence: [{ label: '用户输入', value: '外部可控', positive: true }, { label: '危险函数', value: 'os.system', positive: true }, { label: '安全过滤', value: '未发现', positive: false }, { label: '跨文件调用链', value: '3 个文件', positive: true }, { label: '数据流连通', value: '是', positive: true }, { label: '身份认证', value: '普通用户', positive: true }],
  dataFlow: [
    { kind: 'Source', label: 'HTTP Request', file: 'routes/tools.py', functionName: 'execute_tool', line: 21, variable: 'request.json["cmd"]' },
    { kind: 'Propagator', label: '参数传递', file: 'routes/tools.py', functionName: 'execute_tool', line: 24, variable: 'cmd' },
    { kind: 'Propagator', label: '业务层调用', file: 'service/exec_service.py', functionName: 'exec_cmd', line: 43, variable: 'command' },
    { kind: 'Propagator', label: '命令封装', file: 'utils/process.py', functionName: 'run_command', line: 17, variable: 'raw_command' },
    { kind: 'Sink', label: '系统命令执行', file: 'service/exec_service.py', functionName: 'run_command', line: 58, variable: 'os.system(raw_command)' },
  ],
  snippets: [
    { title: '路由定位位置', file: 'routes/tools.py', startLine: 18, highlightLine: 21, code: "@tools.route('/api/tools/execute', methods=['POST'])\n@login_required\ndef execute_tool():\n    cmd = request.json.get('cmd')\n    return exec_service.exec_cmd(cmd)" },
    { title: '用户输入来源', file: 'routes/tools.py', startLine: 20, highlightLine: 21, code: "def execute_tool():\n    cmd = request.json.get('cmd')\n    return exec_service.exec_cmd(cmd)" },
    { title: '危险函数调用', file: 'service/exec_service.py', startLine: 55, highlightLine: 58, code: "def run_command(raw_command):\n    logger.info('executing command')\n    result = os.system(raw_command)\n    return {'exitCode': result}" },
  ],
};

const sqlInjection: Finding = {
  ...commandInjection, id: 'VUL-2026-0043', name: '订单查询接口存在 SQL 注入', severity: '高危', type: 'SQL注入', file: 'repository/order_repository.go', line: 87, confidence: 89, status: '有效漏洞', foundAt: '2026-08-07 10:05:33',
  existence: '排序参数由查询字符串进入后直接拼接至 ORDER BY 子句。虽然其他条件使用了占位符，但排序字段没有经过枚举校验，攻击者可以改变查询结构。',
  impact: '攻击者可能读取当前数据库账户可访问的订单与用户数据。',
  aiAnalysis: '跨文件检查确认 sort 参数由 HTTP Handler 传递到 Repository，沿途没有枚举收敛。字符串拼接结果直接提交给数据库驱动。',
  remediation: ['将排序字段映射到服务端固定列名', '拒绝白名单以外的排序参数'],
  fixedCode: "column, ok := allowedSortColumns[input.Sort]\nif !ok { return nil, ErrInvalidSort }\nquery := baseQuery + ' ORDER BY ' + column",
  evidence: [{ label: '用户输入', value: '外部可控', positive: true }, { label: '危险函数', value: 'db.QueryContext', positive: true }, { label: '安全过滤', value: '未发现', positive: false }, { label: '数据流连通', value: '是', positive: true }],
};

const secretFinding: Finding = {
  ...commandInjection, id: 'VUL-2026-0044', name: '生产环境访问密钥硬编码', severity: '中危', type: '硬编码密钥', file: 'config/payment.ts', line: 14, confidence: 98, status: '风险接受', foundAt: '2026-08-07 10:05:49',
  existence: '源码中包含具有生产环境格式特征的支付网关访问密钥，并被运行时配置直接引用。',
  impact: '代码仓库泄露时可能导致支付接口被未授权调用。',
  aiAnalysis: '密钥具有真实服务前缀，且在 PaymentClient 初始化路径被读取，不是示例或测试数据。',
  remediation: ['立即轮换现有密钥', '迁移到企业密钥管理服务', '在 CI 中加入密钥泄露检测'],
  fixedCode: "const paymentKey = await secretManager.getSecret('payment/production/api-key');",
  evidence: [{ label: '密钥格式', value: '生产格式', positive: true }, { label: '运行时引用', value: '存在', positive: true }, { label: '测试代码', value: '否', positive: true }],
};

export const seedTasks: ScanTask[] = [
  {
    id: 'SCAN-20260807-001', name: '用户中心发布前深度审计', product: '用户中心', project: 'user-center', creator: '张伟', sourceType: 'git', source: 'https://git.example.com/platform/user-center.git', branch: 'main', model: 'SecAgent-Pro', mode: '深度模式', createdAt: '2026-08-07 09:58', status: '扫描完成', stage: '扫描完成', progress: 100, scannedFiles: 126, totalFiles: 126, lines: 18573, suspected: 12, duration: '7分42秒', findings: [commandInjection, sqlInjection, secretFinding],
    logs: [{ time: '09:58:02', level: 'info', message: '开始获取代码 main@8d27e4a' }, { time: '09:58:10', level: 'success', message: '代码解析完成，共发现 126 个代码文件' }, { time: '09:59:04', level: 'info', message: 'AI Security Agent 开始建立跨文件调用图' }, { time: '10:03:20', level: 'warning', message: '发现 12 个疑似安全问题，进入可利用性验证' }, { time: '10:05:30', level: 'success', message: '确认 3 个有效风险，漏洞验证完成' }, { time: '10:06:00', level: 'success', message: '扫描报告生成完成' }],
  },
  { id: 'SCAN-20260806-014', name: '支付服务每日安全扫描', product: '安全运营平台', project: 'payment-service', creator: '李敏', sourceType: 'git', source: 'https://git.example.com/pay/payment-service.git', branch: 'release/2.8', model: 'SecAgent-Pro', mode: '标准模式', createdAt: '2026-08-06 16:20', status: '扫描中', stage: 'AI深度审计', progress: 67, scannedFiles: 83, totalFiles: 142, lines: 12840, suspected: 7, duration: '3分18秒', findings: [sqlInjection], logs: [{ time: '16:20:03', level: 'info', message: '任务进入扫描队列' }, { time: '16:20:18', level: 'success', message: '项目结构分析完成' }, { time: '16:22:41', level: 'warning', message: '发现高风险数据流，正在验证利用条件' }] },
  { id: 'SCAN-20260805-009', name: 'Agent 服务基线检查', product: 'AI平台', project: 'agent-service', creator: '王浩', sourceType: 'upload', source: 'agent-service-v1.6.2.zip', model: 'SecAgent-Lite', mode: '标准模式', createdAt: '2026-08-05 11:12', status: '扫描失败', stage: '文件解析', progress: 18, scannedFiles: 22, totalFiles: 98, lines: 3940, suspected: 0, duration: '1分08秒', findings: [], logs: [{ time: '11:12:05', level: 'info', message: '压缩包上传完成' }, { time: '11:13:13', level: 'error', message: '解析失败：检测到加密压缩文件' }] },
];
