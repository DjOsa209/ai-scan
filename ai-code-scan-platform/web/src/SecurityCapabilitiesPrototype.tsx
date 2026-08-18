import { useState } from 'react';
import {
  ArrowLeft, Bot, Check, ChevronRight, CircleDot, Database, Diff, FileCode2,
  FileSearch, GitBranch, KeyRound, Layers3, Network, Play, Plus, Route,
  Settings2, ShieldAlert, ShieldCheck, Swords, TestTube2, UserRound, Workflow,
  X,
} from 'lucide-react';
import { ThreatModelingWorkspace } from './ThreatModelingWorkspace';
import { AgentSkillSecurityWorkspace } from './AgentSkillSecurityWorkspace';

export type SecurityCapability = 'threat-modeling' | 'agent-skill-security' | 'red-team';

type CapabilityTask = {
  id: string;
  capability: SecurityCapability;
  name: string;
  target: string;
  status: '已完成' | '草稿';
  createdAt: string;
  risks: number;
};

type Evidence = {
  id: string;
  source: string;
  location: string;
  confidence: '高' | '中' | '待验证';
};

type ThreatRisk = {
  id: string;
  title: string;
  category: string;
  asset: string;
  likelihood: string;
  impact: string;
  control: string;
  decision: string;
  owner: string;
  evidence: string;
};

type ThreatResultView = 'overview' | 'model' | 'paths' | 'governance' | 'changes';
type AgentResultView = 'inventory' | 'permissions' | 'paths' | 'findings' | 'scenarios';

const threatEvidence: Evidence[] = [
  { id: 'EV-014', source: '路由与鉴权中间件', location: 'internal/order/routes.go:48-91', confidence: '高' },
  { id: 'EV-021', source: '订单查询实现', location: 'internal/order/service.go:112-146', confidence: '高' },
  { id: 'EV-033', source: '部署架构说明', location: 'docs/payment-architecture.md', confidence: '中' },
];

const threatRisks: ThreatRisk[] = [
  { id: 'TM-T-017', title: '跨租户订单访问缺少资源归属校验', category: 'E / I', asset: '订单与交易数据', likelihood: '高', impact: '严重', control: '网关仅验证身份，未约束订单所属租户', decision: '缓解中', owner: '支付服务 · 李明', evidence: 'EV-014 · EV-021' },
  { id: 'TM-T-022', title: '第三方支付回调缺少重放窗口', category: 'S / T', asset: '支付状态', likelihood: '中', impact: '高', control: '已校验签名，缺少 nonce 与时间窗', decision: '待分派', owner: '未分派', evidence: 'EV-033' },
  { id: 'TM-T-026', title: '审计事件可能记录完整支付标识', category: 'I', asset: '支付凭据', likelihood: '中', impact: '中', control: '日志平台有访问控制，字段未脱敏', decision: '已接受', owner: '平台安全 · 王琳', evidence: 'EV-021' },
];

const agentDomains = [
  ['指令与优先级', '2', '仓库指令、Skill 指令与外部内容边界'],
  ['身份与授权', '1', '用户、Agent、服务身份与委托链'],
  ['工具与副作用', '3', '文件、命令、网络与审批 guardrail'],
  ['MCP 协议边界', '2', 'OAuth、scope、SSRF 与服务来源'],
  ['Skill 供应链', '2', '脚本、资源、依赖与声明能力'],
  ['记忆与多 Agent', '1', '会话隔离、handoff 与权限继承'],
  ['运行时与可观测性', '1', '沙箱、秘密注入、trace 与脱敏'],
] as const;

const capabilityProfiles = {
  'threat-modeling': {
    name: '威胁建模', kicker: 'THREAT MODELING', icon: Network,
    summary: '从代码与架构信息识别资产、信任边界和 STRIDE 威胁。',
    action: '创建威胁模型', accent: 'teal',
  },
  'agent-skill-security': {
    name: 'Agent / Skill 安全检测', kicker: 'AGENT SECURITY', icon: Bot,
    summary: '检查 Prompt、工具权限、Agent 源码与 MCP 配置的安全边界。',
    action: '创建 Agent 检测', accent: 'indigo',
  },
  'red-team': {
    name: '红队渗透测试', kicker: 'RED TEAM', icon: Swords,
    summary: '通过 PentAGI 适配器编排经授权、沙箱化的渗透测试任务。',
    action: '创建红队任务', accent: 'red',
  },
} as const;

const seedTasks: CapabilityTask[] = [
  { id: 'TM-20260814-003', capability: 'threat-modeling', name: '支付服务发布前威胁模型', target: 'payment-service / release-2.8', status: '已完成', createdAt: '2026-08-14 10:24', risks: 12 },
  { id: 'AS-20260813-011', capability: 'agent-skill-security', name: '研发 Copilot Skill 安全检查', target: '.github/skills + MCP 配置', status: '已完成', createdAt: '2026-08-13 16:40', risks: 7 },
  { id: 'RT-20260812-004', capability: 'red-team', name: '测试环境 API 授权验证', target: 'staging-api.internal', status: '草稿', createdAt: '2026-08-12 14:08', risks: 0 },
];

export function CapabilityQuickLaunch({ onOpen }: { onOpen: (capability: SecurityCapability) => void }) {
  return <section className="capability-launch"><div className="capability-launch-heading"><div><span className="eyebrow">SECURITY CAPABILITIES</span><h2>专项安全能力</h2><p>从代码扫描延伸到架构、Agent 与授权测试环境</p></div></div><div className="capability-launch-grid">{(Object.entries(capabilityProfiles) as [SecurityCapability, typeof capabilityProfiles[SecurityCapability]][]).map(([key, profile]) => { const Icon = profile.icon; return <button key={key} className={`capability-launch-card ${profile.accent}`} onClick={() => onOpen(key)}><span><Icon size={19} /></span><div><strong>{profile.name}</strong><small>{profile.summary}</small></div><ChevronRight size={18} /></button>; })}</div></section>;
}

export function SecurityCapabilitiesPrototype({ initialCapability, onBack }: { initialCapability: SecurityCapability; onBack: () => void }) {
  const [capability, setCapability] = useState(initialCapability);
  const [tab, setTab] = useState<'tasks' | 'config'>('tasks');
  const [tasks, setTasks] = useState(seedTasks);
  const [selectedTask, setSelectedTask] = useState<CapabilityTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const profile = capabilityProfiles[capability];
  const visibleTasks = tasks.filter((task) => task.capability === capability);

  function createTask(name: string, target: string) {
    const prefix = capability === 'threat-modeling' ? 'TM' : capability === 'agent-skill-security' ? 'AS' : 'RT';
    setTasks((current) => [{ id: `${prefix}-20260814-${String(current.length + 12).padStart(3, '0')}`, capability, name, target, status: '草稿', createdAt: '刚刚', risks: 0 }, ...current]);
    setShowCreate(false);
  }

  if (selectedTask) return <CapabilityDetail task={selectedTask} onBack={() => setSelectedTask(null)} />;

  return <div className="capability-page"><header className="capability-page-header"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} />返回安全概览</button><div><span className="eyebrow">{capability === 'red-team' ? 'PROTOTYPE · LOCAL MOCK DATA' : 'LIVE · SERVER PERSISTED'}</span><h1>专项安全能力</h1><p>{capability === 'threat-modeling' ? '基于真实代码与设计证据建立、运行和治理威胁模型' : capability === 'agent-skill-security' ? '检测第三方 Agent、Skill、Prompt、MCP 配置及其实现脚本' : '独立创建任务、管理检测策略并查看能力专属结果'}</p></div></header><div className="capability-switcher">{(Object.entries(capabilityProfiles) as [SecurityCapability, typeof profile][]).map(([key, item]) => { const Icon = item.icon; return <button key={key} className={capability === key ? `active ${item.accent}` : ''} onClick={() => { setCapability(key); setTab('tasks'); }}><Icon size={18} /><span><strong>{item.name}</strong><small>{item.kicker}</small></span></button>; })}</div><section className={`capability-overview ${profile.accent}`}><div><span className="capability-icon"><profile.icon size={24} /></span><div><span className="eyebrow">{profile.kicker}</span><h2>{profile.name}</h2><p>{profile.summary}</p></div></div>{capability === 'red-team' && <button className="primary-button" onClick={() => setShowCreate(true)}><Plus size={17} />{profile.action}</button>}</section>{capability === 'threat-modeling' ? <ThreatModelingWorkspace /> : capability === 'agent-skill-security' ? <AgentSkillSecurityWorkspace /> : <><div className="capability-tabs"><button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><FileCode2 size={16} />任务</button><button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}><Settings2 size={16} />配置</button></div>{tab === 'tasks' ? <TaskList tasks={visibleTasks} capability={capability} onSelect={setSelectedTask} onCreate={() => setShowCreate(true)} /> : <CapabilityConfig capability={capability} />}{showCreate && <CreateCapabilityTask capability={capability} onClose={() => setShowCreate(false)} onCreate={createTask} />}</>}</div>;
}

function TaskList({ tasks, capability, onSelect, onCreate }: { tasks: CapabilityTask[]; capability: SecurityCapability; onSelect: (task: CapabilityTask) => void; onCreate: () => void }) {
  const EmptyIcon = capabilityProfiles[capability].icon;
  return <section className="capability-task-panel"><div className="section-title-row"><div><h3>最近任务</h3><p>原型数据仅保存在当前页面内存中</p></div><span>{tasks.length} 个任务</span></div>{tasks.length ? <div className="capability-task-table"><table><thead><tr><th>任务</th><th>目标</th><th>状态</th><th>风险</th><th>创建时间</th><th /></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} onClick={() => onSelect(task)}><td><strong>{task.name}</strong><small>{task.id}</small></td><td>{task.target}</td><td><span className={`prototype-status ${task.status === '已完成' ? 'done' : ''}`}>{task.status}</span></td><td><b>{task.risks || '-'}</b></td><td>{task.createdAt}</td><td><button className="link-button">查看结果<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <div className="capability-empty"><EmptyIcon size={28} /><strong>还没有任务</strong><button className="primary-button" onClick={onCreate}>创建第一个任务</button></div>}</section>;
}

function CreateCapabilityTask({ capability, onClose, onCreate }: { capability: SecurityCapability; onClose: () => void; onCreate: (name: string, target: string) => void }) {
  const profile = capabilityProfiles[capability];
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [baseline, setBaseline] = useState('增量更新');
  const [environment, setEnvironment] = useState('生产环境');
  const [ecosystem, setEcosystem] = useState('GitHub Copilot');
  const [validationMode, setValidationMode] = useState('静态审计 + 沙箱场景');
  return <div className="modal-backdrop"><div className="create-modal capability-create" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="modal-icon"><profile.icon size={20} /></span><div><h2>{profile.action}</h2><p>{profile.summary}</p></div></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button></div><div className="capability-create-body"><div className="form-grid"><label className="form-field"><span>任务名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={`例如：${profile.name}验证`} /></label><label className="form-field"><span>{capability === 'red-team' ? '授权测试目标' : '仓库或分析范围'}</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={capability === 'red-team' ? '仅填写已获得授权的测试环境' : '仓库地址、分支或目录'} /></label></div>{capability === 'threat-modeling' && <><div className="capability-form-section"><div><strong>模型上下文</strong><small>建立可重复运行的范围与版本基线</small></div><div className="form-grid"><label className="form-field"><span>建模方式</span><select value={baseline} onChange={(event) => setBaseline(event.target.value)}><option>首次基线</option><option>增量更新</option></select></label><label className="form-field"><span>部署环境</span><select value={environment} onChange={(event) => setEnvironment(event.target.value)}><option>生产环境</option><option>预发布环境</option><option>开发环境</option></select></label></div></div><PrototypeChecklist items={['代码与部署清单', '架构文档与数据分类', '身份主体与外部依赖', '上一版本模型与已知控制']} /></>}{capability === 'agent-skill-security' && <><div className="capability-form-section"><div><strong>检测边界</strong><small>声明生态、验证深度与允许的副作用</small></div><div className="form-grid"><label className="form-field"><span>生态 / 对象</span><select value={ecosystem} onChange={(event) => setEcosystem(event.target.value)}><option>GitHub Copilot</option><option>Claude Agent Skills</option><option>通用 Agent</option><option>MCP Client / Server</option></select></label><label className="form-field"><span>验证模式</span><select value={validationMode} onChange={(event) => setValidationMode(event.target.value)}><option>仅静态审计</option><option>静态审计 + 沙箱场景</option></select></label></div></div><PrototypeChecklist items={['文件：仓库范围内只读', '网络：默认拒绝，按域名放行', '命令：沙箱内白名单', '秘密：短期注入且禁止回显']} /></>}{capability === 'red-team' && <div className="red-team-guard"><ShieldAlert size={18} /><div><strong>仅预留 PentAGI 适配器</strong><p>原型不会连接目标或执行命令。正式接入需先验证授权范围、沙箱、审批和停止机制。</p></div></div>}</div><div className="modal-footer"><span>PROTOTYPE · 不会提交到后端</span><div><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!name.trim() || !target.trim()} onClick={() => onCreate(name.trim(), target.trim())}><Play size={16} />创建草稿</button></div></div></div></div>;
}

function PrototypeChecklist({ items }: { items: string[] }) {
  return <div className="prototype-checklist">{items.map((item) => <span key={item}><Check size={13} />{item}</span>)}</div>;
}

function CapabilityConfig({ capability }: { capability: SecurityCapability }) {
  if (capability === 'threat-modeling') return <div className="capability-config-grid"><ConfigCard title="建模流程" value="持续模型" description="范围、威胁、缓解、评估形成版本化闭环；STRIDE 用于威胁分类。" /><ConfigCard title="模型输入" value="代码 + 架构 + 部署" description="证据映射到资产、主体、组件、数据流和信任边界。" /><ConfigCard title="风险治理" value="控制与责任人" description="处置决定、控制有效性、责任人与复核日期均可追溯。" /></div>;
  if (capability === 'agent-skill-security') return <div className="capability-config-grid"><ConfigCard title="生态适配" value="4 类对象" description="Copilot、Claude Skills、通用 Agent 与 MCP 使用统一资产模型。" /><ConfigCard title="检测策略" value="7 个安全域" description="覆盖指令、身份、工具、MCP、供应链、记忆与运行时。" /><ConfigCard title="验证边界" value="静态 + 沙箱" description="动态场景默认断网、无真实秘密，副作用需逐项审批。" /></div>;
  return <div className="capability-config-grid"><ConfigCard title="执行适配器" value="PentAGI" description="计划通过 REST API / GraphQL 连接自托管实例" /><ConfigCard title="执行环境" value="Docker 沙箱" description="工具执行与平台运行环境隔离" /><ConfigCard title="接入状态" value="未连接" description="等待授权校验、审批、停止开关和审计协议设计" /></div>;
}

function ConfigCard({ title, value, description }: { title: string; value: string; description: string }) {
  return <section className="capability-config-card"><span>{title}</span><strong>{value}</strong><p>{description}</p><button className="secondary-button">配置<ChevronRight size={14} /></button></section>;
}

function CapabilityDetail({ task, onBack }: { task: CapabilityTask; onBack: () => void }) {
  const profile = capabilityProfiles[task.capability];
  return <div className="capability-page"><header className="capability-detail-header"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} />返回任务列表</button><div><span className="eyebrow">{profile.kicker} · {task.id}</span><h1>{task.name}</h1><p>{task.target} · {task.createdAt}</p></div><span className="prototype-status done">{task.status}</span></header>{task.capability === 'threat-modeling' && <ThreatModelResult />}{task.capability === 'agent-skill-security' && <AgentSecurityResult />}{task.capability === 'red-team' && <RedTeamResult />}</div>;
}

function ThreatModelResult() {
  const [view, setView] = useState<ThreatResultView>('overview');
  const threats = [['S', '身份伪造', '2'], ['T', '数据篡改', '3'], ['R', '抵赖', '1'], ['I', '信息泄露', '4'], ['D', '拒绝服务', '1'], ['E', '权限提升', '1']];
  const tabs: [ThreatResultView, string][] = [['overview', '模型概览'], ['model', '系统模型'], ['paths', '威胁与攻击路径'], ['governance', '风险处置'], ['changes', '模型差异']];
  return <><ResultTabs tabs={tabs} active={view} onChange={setView} />{view === 'overview' && <section className="capability-result-section"><div className="capability-metric-grid"><CapabilityMetric label="模型覆盖度" value="86%" detail="43 / 50 个对象有证据" /><CapabilityMetric label="开放风险" value="12" detail="3 项高风险" tone="danger" /><CapabilityMetric label="待确认假设" value="5" detail="需架构或业务确认" tone="warning" /><CapabilityMetric label="控制缺口" value="4" detail="2 项已进入修复" /></div><div className="result-split"><div><div className="section-title-row"><div><h3>STRIDE 分布</h3><p>分类汇总，不替代攻击路径和风险判断</p></div></div><div className="stride-grid">{threats.map(([code, name, count]) => <div key={code}><b>{code}</b><span>{name}</span><strong>{count}</strong></div>)}</div></div><EvidencePanel evidence={threatEvidence} /></div></section>}{view === 'model' && <ThreatSystemModel />}{view === 'paths' && <ThreatPaths />}{view === 'governance' && <ThreatGovernance />}{view === 'changes' && <ThreatChanges />}</>;
}

function ResultTabs<T extends string>({ tabs, active, onChange }: { tabs: [T, string][]; active: T; onChange: (value: T) => void }) {
  return <nav className="result-view-tabs" aria-label="结果视图">{tabs.map(([key, label]) => <button key={key} className={active === key ? 'active' : ''} onClick={() => onChange(key)}>{label}</button>)}</nav>;
}

function CapabilityMetric({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) {
  return <div className={`capability-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function EvidencePanel({ evidence }: { evidence: Evidence[] }) {
  return <aside className="evidence-panel"><div><FileSearch size={17} /><span><strong>来源证据</strong><small>模型结论可回溯到仓库版本</small></span></div>{evidence.map((item) => <button key={item.id}><span><b>{item.id}</b>{item.source}</span><code>{item.location}</code><em className={item.confidence === '待验证' ? 'pending' : ''}>{item.confidence}</em></button>)}</aside>;
}

function ThreatSystemModel() {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>支付域系统模型</h3><p>主体、组件、数据存储及边界均关联推导证据</p></div><span className="model-revision">REV release-2.8 · 2026-08-14</span></div><div className="system-model"><div className="boundary-label">互联网 / 企业网络信任边界</div><FlowNode icon="USR" title="租户用户" meta="主体 · OIDC" /><ChevronRight /><FlowNode icon="GW" title="API 网关" meta="进程 · 身份验证" /><ChevronRight /><FlowNode icon="PAY" title="支付服务" meta="进程 · 订单处理" /><ChevronRight /><FlowNode icon="DB" title="交易数据库" meta="存储 · 机密数据" /></div><div className="model-inventory"><ModelItem icon={<UserRound />} label="身份主体" value="4" detail="用户、管理员、服务账号、第三方" /><ModelItem icon={<Layers3 />} label="组件" value="8" detail="6 个内部、2 个外部" /><ModelItem icon={<Workflow />} label="数据流" value="13" detail="7 条跨越信任边界" /><ModelItem icon={<Database />} label="关键资产" value="5" detail="订单、凭据、审计、支付状态" /></div></section>;
}

function ModelItem({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></div>;
}

function ThreatPaths() {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>高风险攻击路径</h3><p>从前置条件到受影响资产，并标出可阻断控制点</p></div><span className="risk-label">TM-T-017 · 高风险</span></div><div className="attack-path"><PathStep index="01" title="有效租户会话" detail="攻击者拥有普通租户身份" /><ChevronRight /><PathStep index="02" title="替换订单标识" detail="修改 GET /orders/{id}" /><ChevronRight /><PathStep index="03" title="服务按 ID 查询" detail="未绑定当前 tenant_id" danger /><ChevronRight /><PathStep index="04" title="读取跨租户订单" detail="交易数据与支付状态泄露" danger /></div><div className="path-control"><ShieldCheck size={18} /><div><strong>建议阻断点：支付服务资源级授权</strong><p>将订单查询绑定当前租户主体，并为跨租户访问失败写入脱敏审计事件。</p></div><span>控制待验证</span></div><EvidencePanel evidence={threatEvidence.slice(0, 2)} /></section>;
}

function PathStep({ index, title, detail, danger = false }: { index: string; title: string; detail: string; danger?: boolean }) {
  return <div className={danger ? 'danger' : ''}><b>{index}</b><strong>{title}</strong><small>{detail}</small></div>;
}

function ThreatGovernance() {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>风险与控制治理</h3><p>风险决定、责任人与验证状态共同构成处置闭环</p></div></div><div className="governance-table"><table><thead><tr><th>风险</th><th>分类 / 资产</th><th>可能性 / 影响</th><th>现有控制</th><th>处置</th><th>责任人</th><th>证据</th></tr></thead><tbody>{threatRisks.map((risk) => <tr key={risk.id}><td><strong>{risk.title}</strong><small>{risk.id}</small></td><td>{risk.category}<small>{risk.asset}</small></td><td>{risk.likelihood} / {risk.impact}</td><td>{risk.control}</td><td><span className="decision-chip">{risk.decision}</span></td><td>{risk.owner}</td><td><code>{risk.evidence}</code></td></tr>)}</tbody></table></div></section>;
}

function ThreatChanges() {
  const changes = [['新增', '数据流', 'API 网关 → 审计平台', 'release-2.8 引入异步审计事件'], ['变化', '信任边界', '第三方支付回调', '回调入口迁移至公共网关'], ['新增', '威胁', 'TM-T-022 回调重放', '签名存在，但缺少时间窗和 nonce'], ['已消失', '组件', '旧版订单同步 Worker', 'release-2.8 已移除']];
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>release-2.7 → release-2.8</h3><p>仅复核变化对象及其关联威胁，保留历史决策</p></div><span className="model-revision"><Diff size={14} /> 14 项变化</span></div><div className="change-list">{changes.map(([kind, type, title, detail]) => <div key={title}><span className={`change-kind kind-${kind}`}>{kind}</span><b>{type}</b><div><strong>{title}</strong><small>{detail}</small></div><ChevronRight size={16} /></div>)}</div></section>;
}

function FlowNode({ icon, title, meta }: { icon: string; title: string; meta: string }) {
  return <div><b>{icon}</b><strong>{title}</strong><small>{meta}</small></div>;
}

function AgentSecurityResult() {
  const [view, setView] = useState<AgentResultView>('inventory');
  const tabs: [AgentResultView, string][] = [['inventory', '资产与来源'], ['permissions', '权限矩阵'], ['paths', '攻击路径'], ['findings', '发现与修复'], ['scenarios', '动态场景']];
  return <><ResultTabs tabs={tabs} active={view} onChange={setView} />{view === 'inventory' && <AgentInventory />}{view === 'permissions' && <AgentPermissions />}{view === 'paths' && <AgentAttackPath />}{view === 'findings' && <AgentFindings />}{view === 'scenarios' && <AgentScenarios />}</>;
}

function AgentInventory() {
  return <section className="capability-result-section"><div className="capability-metric-grid"><CapabilityMetric label="检测对象" value="18" detail="13 个已固定版本" /><CapabilityMetric label="安全域" value="7 / 7" detail="统一策略已覆盖" /><CapabilityMetric label="高危组合" value="3" detail="跨越文件与网络权限" tone="danger" /><CapabilityMetric label="待动态验证" value="4" detail="静态证据不足" tone="warning" /></div><div className="section-title-row"><div><h3>七域安全覆盖</h3><p>按能力和协议边界组织，不再按文件类型计数</p></div></div><div className="agent-domain-grid">{agentDomains.map(([name, count, detail], index) => <div key={name}><span>{index + 1}</span><div><strong>{name}</strong><small>{detail}</small></div><b>{count} 项</b></div>)}</div><div className="asset-source-list"><AssetSource icon={<Bot />} name="release-reviewer.agent.md" type="Custom Agent" source="仓库 · 已固定 revision" /><AssetSource icon={<FileCode2 />} name="security-baseline-review" type="Skill" source=".github/skills · 本地来源" /><AssetSource icon={<Network />} name="github-mcp-server" type="MCP Server" source="容器镜像 · 缺少 digest" /></div></section>;
}

function AssetSource({ icon, name, type, source }: { icon: React.ReactNode; name: string; type: string; source: string }) {
  return <div><span>{icon}</span><div><strong>{name}</strong><small>{source}</small></div><b>{type}</b><ChevronRight size={16} /></div>;
}

function AgentPermissions() {
  const rows = [['release-reviewer', '仓库只读', '禁止', '允许：git diff', 'github-mcp', '发布前审批'], ['security-baseline-review', '工作区只读 + ~/.config', '任意 HTTPS', '脚本执行', 'filesystem + fetch', '仅危险命令'], ['github-mcp-server', '无', 'api.github.com', '容器内执行', 'OAuth: repo', '写操作审批']];
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>有效权限矩阵</h3><p>合并声明权限、工具实现和运行时策略后的实际能力</p></div><span className="risk-label">3 个跨域高危组合</span></div><div className="permission-table"><table><thead><tr><th>主体 / 对象</th><th>文件</th><th>网络</th><th>命令</th><th>MCP / Scope</th><th>人工审批</th></tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>)}</tbody></table></div><div className="prototype-finding"><KeyRound /><div><strong>读取敏感文件 + 任意 HTTPS 外发 + 弱审批</strong><p>声明边界允许 Skill 读取用户配置目录，并可通过 fetch 工具向任意域发送内容，权限跨度高于任务用途。</p></div><span>高风险</span></div></section>;
}

function AgentAttackPath() {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>间接 Prompt 注入攻击路径</h3><p>关联指令来源、有效权限、工具副作用和可能爆炸半径</p></div><span className="risk-label">AS-P-004 · 证据置信度高</span></div><div className="attack-path agent-path"><PathStep index="01" title="恶意仓库内容" detail="PR 文档包含伪造系统指令" /><ChevronRight /><PathStep index="02" title="Skill 读取上下文" detail="外部内容未标记为不可信" danger /><ChevronRight /><PathStep index="03" title="读取本地凭据" detail="filesystem 范围包含 ~/.config" danger /><ChevronRight /><PathStep index="04" title="网络工具外发" detail="fetch 未限制目标域名" danger /></div><div className="blast-radius"><Route size={18} /><div><strong>爆炸半径</strong><p>开发者会话 → 本地 API 凭据 → 代码托管平台与制品仓库；handoff 后权限可能继续传播。</p></div><span>3 个系统 · 2 类身份</span></div></section>;
}

function AgentFindings() {
  const findings = [['AS-017', 'Skill 声明能力与实际脚本行为不一致', '供应链', '高', '固定后再启用'], ['AS-021', 'MCP OAuth token 直接透传至下游服务', 'MCP', '严重', '阻断'], ['AS-024', '工具调用前 guardrail 未覆盖 handoff', '工具与副作用', '高', '修复中'], ['AS-031', '持久化记忆可能写入用户秘密', '记忆与多 Agent', '中', '待验证']];
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>发现与修复</h3><p>风险排序综合影响、可利用性、权限跨度和证据置信度</p></div></div><div className="finding-catalog">{findings.map(([id, title, domain, severity, decision]) => <button key={id}><span className={`finding-severity severity-${severity}`}>{severity}</span><div><strong>{title}</strong><small>{id} · {domain}</small></div><b>{decision}</b><ChevronRight size={16} /></button>)}</div></section>;
}

function AgentScenarios() {
  const scenarios = [['间接 Prompt 注入外发', '静态前置条件满足', '待沙箱验证', '断网沙箱 + 假秘密'], ['MCP SSRF 元数据访问', 'URL 参数可控', '已阻断', '回环与云元数据地址'], ['Handoff 权限继承', '策略未显式收窄', '待沙箱验证', '双 Agent 最小权限夹具'], ['工具参数 schema 绕过', '结构校验已启用', '通过', '畸形参数与超长输入']];
  return <section className="capability-result-section"><div className="scenario-banner"><TestTube2 size={21} /><div><strong>动态验证仅使用无网络沙箱和合成秘密</strong><p>不会连接真实 MCP 服务、执行仓库脚本或注入生产凭据；所有副作用均由测试替身记录。</p></div></div><div className="scenario-list">{scenarios.map(([name, evidence, status, fixture]) => <div key={name}><span><CircleDot size={14} /></span><div><strong>{name}</strong><small>{evidence}</small></div><b>{fixture}</b><em className={status === '通过' ? 'passed' : status === '已阻断' ? 'blocked' : ''}>{status}</em></div>)}</div></section>;
}

function RedTeamResult() {
  return <section className="capability-result-section"><div className="red-team-adapter"><div><span className="capability-icon"><Swords size={22} /></span><div><span className="eyebrow">PENTAGI ADAPTER</span><h3>适配器尚未连接</h3><p>已预留任务定义、实时状态和结果报告位置。正式版本通过自托管 PentAGI 的 API 接入。</p></div></div><span>DESIGN ONLY</span></div><div className="red-team-gates"><h3>执行前强制门禁</h3>{['目标所有权与授权证明', '域名、IP 和端口白名单', 'Docker 沙箱与资源上限', '人工审批与紧急停止', '命令、输出和证据审计'].map((item) => <div key={item}><CircleDot size={14} /><span>{item}</span><b>待设计</b></div>)}</div></section>;
}
