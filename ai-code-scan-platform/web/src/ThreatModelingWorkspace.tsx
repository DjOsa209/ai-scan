import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, CircleDot, Clock3, Database,
  Download, FileCode2, FileSearch, FileText, Filter, GitBranch, Layers3,
  ListChecks, LoaderCircle, Network, Play, Plus, Search, ShieldCheck, Upload,
  UserRound, Workflow, X,
} from 'lucide-react';
import {
  createThreatModel, createThreatModelThreat, loadMyScans, loadThreatModels,
  startThreatModelRun, updateThreatModelThreat,
  type PlatformScanTask, type ThreatModelConfiguration, type ThreatModelDocument,
  type ThreatModelRecord, type ThreatModelResult, type ThreatModelThreat,
  type ThreatSeverity, type ThreatStatus,
} from './api';

type ThreatView = 'overview' | 'system' | 'threats' | 'paths' | 'governance' | 'run' | 'history';
type RunView = 'configuration' | 'preflight' | 'logs';

const statusLabels = { draft: '草稿', running: '分析中', completed: '已完成', failed: '失败', stopped: '已停止' } as const;
const severityLabels = { critical: '严重', high: '高', medium: '中', low: '低' } as const;
const threatStatusLabels = { open: '开放', resolved: '已解决', dismissed: '已驳回' } as const;
const environmentLabels = { production: '生产环境', staging: '预发布环境', development: '开发环境' } as const;
const modeLabels = { baseline: '首次基线', incremental: '增量更新' } as const;

export function ThreatModelingWorkspace() {
  const [models, setModels] = useState<ThreatModelRecord[]>([]);
  const [scans, setScans] = useState<PlatformScanTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const selected = models.find((model) => model.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadThreatModels(), loadMyScans(100)])
      .then(([loadedModels, loadedScans]) => {
        if (cancelled) return;
        setModels(loadedModels);
        setScans(loadedScans.filter((scan) => scan.status === 'completed' || scan.status === 'partial'));
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '加载威胁建模数据失败'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  function replaceModel(next: ThreatModelRecord) {
    setModels((current) => current.some((model) => model.id === next.id) ? current.map((model) => model.id === next.id ? next : model) : [next, ...current]);
  }

  async function handleCreate(title: string, configuration: ThreatModelConfiguration) {
    const created = await createThreatModel({ title, configuration });
    replaceModel(created);
    setSelectedId(created.id);
    setShowCreate(false);
  }

  if (loading) return <div className="threat-loading"><LoaderCircle className="spin" /><span>正在加载威胁模型…</span></div>;

  return <div className="threat-workspace">
    {error && <div className="threat-api-error"><AlertTriangle size={16} />{error}<button onClick={() => setError('')}>关闭</button></div>}
    {selected ? <ThreatModelDetail model={selected} onBack={() => setSelectedId(null)} onChange={replaceModel} onError={setError} /> : <ThreatModelList models={models} onSelect={setSelectedId} onCreate={() => setShowCreate(true)} />}
    {showCreate && <CreateThreatModel scans={scans} onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
  </div>;
}

function ThreatModelList({ models, onSelect, onCreate }: { models: ThreatModelRecord[]; onSelect: (id: string) => void; onCreate: () => void }) {
  return <section className="capability-task-panel">
    <div className="threat-explainer"><div><Network size={21} /><span><strong>威胁建模回答什么问题？</strong><p>系统由什么组成、信任边界在哪里、攻击者能怎样伤害关键资产，以及团队应先修什么。</p></span></div><div className="threat-input-modes"><span><FileCode2 size={15} /><b>已有扫描</b><small>复用源码证据</small></span><span><FileText size={15} /><b>设计文档</b><small>代码前评审方案</small></span><span><Layers3 size={15} /><b>代码 + 设计</b><small>结合现状评审变化</small></span></div></div>
    <div className="section-title-row threat-list-heading"><div><h3>威胁模型</h3><p>模型保存范围；每次运行保留独立配置快照和结果</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} />创建威胁模型</button></div>
    {models.length ? <div className="capability-task-table threat-model-table"><table><thead><tr><th>模型</th><th>输入</th><th>最新运行</th><th>状态</th><th>威胁</th><th>严重 / 高</th><th /></tr></thead><tbody>{models.map((model) => {
      const result = model.latestRun?.result;
      return <tr key={model.id} onClick={() => onSelect(model.id)}><td><strong>{model.title}</strong><small>{model.id}</small></td><td><span className="input-summary"><GitBranch size={13} />{model.configuration.sourceScanTaskId ? '扫描证据' : '无代码源'} · {model.configuration.scopeDocuments.length || (model.configuration.scopeSummary ? 1 : 0)} 份设计输入</span></td><td>{model.latestRun ? formatDate(model.latestRun.startedAt) : '-'}</td><td><ModelStatusBadge status={model.status} /></td><td><b>{result?.threats.length ?? '-'}</b></td><td><span className="severity-pair">{result?.summary.critical ?? 0} / {result?.summary.high ?? 0}</span></td><td><button className="link-button">打开模型<ChevronRight size={14} /></button></td></tr>;
    })}</tbody></table></div> : <div className="capability-empty"><Network size={30} /><strong>还没有威胁模型</strong><span>从已完成扫描、设计文档或两者组合开始</span><button className="primary-button" onClick={onCreate}><Plus size={15} />创建第一个模型</button></div>}
  </section>;
}

function CreateThreatModel({ scans, onClose, onCreate }: { scans: PlatformScanTask[]; onClose: () => void; onCreate: (title: string, configuration: ThreatModelConfiguration) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [sourceScanTaskId, setSourceScanTaskId] = useState('');
  const [documents, setDocuments] = useState<ThreatModelDocument[]>([]);
  const [scopeSummary, setScopeSummary] = useState('');
  const [environment, setEnvironment] = useState<ThreatModelConfiguration['environment']>('production');
  const [mode, setMode] = useState<ThreatModelConfiguration['mode']>('baseline');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const hasInput = Boolean(sourceScanTaskId || documents.length || scopeSummary.trim());

  async function readDocuments(files: FileList | null) {
    setError('');
    if (!files) return setDocuments([]);
    const selected = Array.from(files);
    if (selected.some((file) => file.size > 2 * 1024 * 1024)) return setError('单个设计文档不能超过 2 MiB');
    try {
      setDocuments(await Promise.all(selected.map(async (file) => ({ name: file.name, content: await file.text() }))));
    } catch {
      setError('无法读取设计文档');
    }
  }

  async function submit() {
    if (!title.trim() || !hasInput || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onCreate(title.trim(), { sourceScanTaskId: sourceScanTaskId || undefined, scopeDocuments: documents, scopeSummary: scopeSummary.trim() || undefined, environment, mode });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建威胁模型失败');
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="modal-backdrop"><div className="create-modal threat-create-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="modal-icon threat-modal-icon"><Network size={20} /></span><div><h2>创建威胁模型</h2><p>至少选择一次已有扫描或提供一份设计输入</p></div></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button></div><div className="threat-create-body">
    <section><span className="form-step">01 · 基本信息</span><label className="form-field"><span>模型标题 <em>*</em></span><input aria-label="模型标题" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：结账 API 发布前威胁模型" /></label><div className="form-grid"><label className="form-field"><span>建模方式</span><select aria-label="建模方式" value={mode} onChange={(event) => setMode(event.target.value as ThreatModelConfiguration['mode'])}><option value="baseline">首次基线</option><option value="incremental">增量更新</option></select></label><label className="form-field"><span>部署环境</span><select aria-label="部署环境" value={environment} onChange={(event) => setEnvironment(event.target.value as ThreatModelConfiguration['environment'])}><option value="production">生产环境</option><option value="staging">预发布环境</option><option value="development">开发环境</option></select></label></div></section>
    <section><span className="form-step">02 · 设计输入（可选）</span><p className="form-help">MVP 支持 MD、TXT、JSON、YAML、XML 等文本型架构与 API 文档。</p><label className="threat-upload-zone"><Upload size={20} /><strong>选择设计文档</strong><small>{documents.length ? documents.map((document) => document.name).join('、') : '可选择多个文本文件'}</small><input aria-label="选择范围文档" type="file" multiple accept=".md,.txt,.json,.yaml,.yml,.xml,.csv,.graphql,.proto" onChange={(event) => void readDocuments(event.target.files)} /></label><label className="form-field"><span>设计关注点</span><textarea aria-label="设计关注点" value={scopeSummary} onChange={(event) => setScopeSummary(event.target.value)} placeholder="例如：聚焦第三方回调、租户隔离和支付状态变更" /></label></section>
    <section><span className="form-step">03 · 源码证据（可选）</span><p className="form-help">选择已完成的代码扫描，复用其固定 revision、源码证据和数据流上下文。</p><label className="form-field"><span>已有扫描任务</span><select aria-label="已有扫描任务" value={sourceScanTaskId} onChange={(event) => setSourceScanTaskId(event.target.value)}><option value="">不使用代码源</option>{scans.map((scan) => <option key={scan.id} value={scan.id}>{scan.projectName} · {scan.gitRef} · {scan.findingCount} 项发现</option>)}</select></label><div className="input-rule"><ShieldCheck size={15} /><span><strong>只读证据分析</strong><small>读取扫描任务保存的源码证据，不执行仓库脚本，也不发起主动攻击。</small></span></div></section>
  </div><div className="modal-footer"><span className={!hasInput || error ? 'form-warning' : ''}><AlertTriangle size={14} />{error || (hasInput ? '创建后显式开始运行，不会自动消耗分析资源' : '至少添加一种输入')}</span><div><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || !hasInput || submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{submitting ? '创建中' : '创建模型'}</button></div></div></div></div>;
}

function ThreatModelDetail({ model, onBack, onChange, onError }: { model: ThreatModelRecord; onBack: () => void; onChange: (model: ThreatModelRecord) => void; onError: (message: string) => void }) {
  const [view, setView] = useState<ThreatView>('overview');
  const [runView, setRunView] = useState<RunView>('preflight');
  const [running, setRunning] = useState(false);
  const [showManualThreat, setShowManualThreat] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const result = model.latestRun?.result;
  const tabs: [ThreatView, string][] = [['overview', '运行概览'], ['system', '系统概览'], ['threats', '威胁'], ['paths', '攻击路径'], ['governance', '风险处置'], ['run', '运行过程'], ['history', '运行历史']];

  async function startRun() {
    setRunning(true);
    setView('run');
    onError('');
    try { onChange(await startThreatModelRun(model.id)); } catch (cause) { onError(cause instanceof Error ? cause.message : '运行威胁模型失败'); } finally { setRunning(false); }
  }

  async function changeThreat(threat: ThreatModelThreat, status: ThreatStatus) {
    try { onChange(await updateThreatModelThreat(model.id, threat.id, { status })); } catch (cause) { onError(cause instanceof Error ? cause.message : '更新威胁失败'); }
  }

  async function addThreat(input: Parameters<typeof createThreatModelThreat>[1]) {
    const updated = await createThreatModelThreat(model.id, input);
    onChange(updated);
    setShowManualThreat(false);
    setCatalogRevision((current) => current + 1);
    setView('threats');
  }

  return <section className="threat-detail"><header className="threat-detail-toolbar"><button className="secondary-button" onClick={onBack}><ArrowLeft size={16} />返回模型列表</button><div><span className="eyebrow">THREAT MODEL · {model.id}</span><h2>{model.title}</h2><p>{model.configuration.sourceScanTaskId ? '代码证据 + 设计输入' : '设计阶段模型'} · {environmentLabels[model.configuration.environment]} · {modeLabels[model.configuration.mode]}</p></div><div className="threat-detail-actions"><ModelStatusBadge status={running ? 'running' : model.status} /><button className="primary-button" disabled={running} onClick={() => void startRun()}>{running ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{model.runs.length ? '开始新运行' : '开始运行'}</button>{result && <button className="secondary-button" onClick={() => downloadReport(model)}><Download size={15} />导出报告</button>}</div></header>
    <nav className="result-view-tabs threat-result-tabs" aria-label="威胁模型结果视图">{tabs.map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</nav>
    {!result && model.status === 'draft' && <DraftState model={model} onStart={() => void startRun()} />}
    {!result && running && <RunningState />}
    {!result && model.status === 'failed' && <div className="draft-state"><AlertTriangle size={32} /><h3>运行失败</h3><p>{model.latestRun?.errorMessage || model.latestRun?.statusMessage}</p><button className="primary-button" onClick={() => void startRun()}>重新运行</button></div>}
    {result && <>{view === 'overview' && <RunOverview model={model} result={result} />}{view === 'system' && <SystemOverview result={result} />}{view === 'threats' && <ThreatCatalog key={catalogRevision} threats={result.threats} onChange={changeThreat} onCreate={() => setShowManualThreat(true)} />}{view === 'paths' && <AttackPaths result={result} />}{view === 'governance' && <Governance threats={result.threats} />}{view === 'run' && <RunProcess model={model} view={runView} onView={setRunView} running={running} />}{view === 'history' && <RunHistory model={model} />}</>}
    {showManualThreat && <ManualThreatModal onClose={() => setShowManualThreat(false)} onCreate={addThreat} />}
  </section>;
}

function DraftState({ model, onStart }: { model: ThreatModelRecord; onStart: () => void }) {
  return <div className="draft-state"><span><FileSearch size={30} /></span><h3>模型已创建，尚未运行</h3><p>运行时会固定输入快照，提取系统对象，再执行可解释的 STRIDE 规则并生成证据映射。</p><div><b>{model.configuration.sourceScanTaskId ? '已关联代码扫描证据' : '未添加代码源'}</b><b>设计输入：{model.configuration.scopeDocuments.length || (model.configuration.scopeSummary ? 1 : 0)} 项</b></div><button className="primary-button" onClick={onStart}><Play size={16} />开始首次运行</button></div>;
}

function RunningState() { return <div className="draft-state"><span><LoaderCircle className="spin" size={30} /></span><h3>正在建立威胁模型</h3><p>当前版本在服务端同步完成输入预检、系统对象提取、STRIDE 规则分析和证据绑定。</p></div>; }

function RunOverview({ model, result }: { model: ThreatModelRecord; result: ThreatModelResult }) {
  const stride = [['S', '身份伪造'], ['T', '数据篡改'], ['R', '抵赖'], ['I', '信息泄露'], ['D', '拒绝服务'], ['E', '权限提升']];
  return <section className="capability-result-section"><div className="capability-metric-grid"><Metric label="运行状态" value={statusLabels[model.latestRun?.status ?? 'completed']} detail={`${formatDate(model.latestRun?.startedAt)} · ${runDuration(model.latestRun?.startedAt, model.latestRun?.completedAt)}`} /><Metric label="开放威胁" value={String(result.summary.open)} detail={`${result.summary.critical} 严重 · ${result.summary.high} 高`} tone="danger" /><Metric label="系统对象" value={String(result.summary.systemObjects)} detail={`${result.systemOverview.components.length} 组件 · ${result.systemOverview.dataFlows.length} 数据流`} /><Metric label="待确认假设" value={String(result.summary.assumptions + result.threats.filter((threat) => threat.assumption).length)} detail="需架构或业务负责人确认" tone="warning" /></div><div className="overview-grid"><div><div className="section-title-row"><div><h3>严重性分布</h3><p>基于证据、可利用前提与资产影响排序</p></div></div><div className="severity-distribution">{(['critical', 'high', 'medium', 'low'] as ThreatSeverity[]).map((severity) => <div key={severity}><span className={`threat-severity severity-${severityLabels[severity]}`}>{severityLabels[severity]}</span><b>{result.summary[severity]}</b><i style={{ width: `${Math.max(8, result.summary[severity] * 22)}%` }} /></div>)}</div></div><div><div className="section-title-row"><div><h3>STRIDE 覆盖</h3><p>用于检查威胁类别是否遗漏</p></div></div><div className="stride-grid compact-stride">{stride.map(([code, name]) => <div key={code}><b>{code}</b><span>{name}</span><strong>{result.summary.strideDistribution[code] ?? 0}</strong></div>)}</div></div></div><div className="system-understanding"><div><span className="eyebrow">SYSTEM OVERVIEW</span><h3>系统理解摘要</h3><p>{result.systemOverview.architecture}</p></div><dl><div><dt>目的</dt><dd>{result.systemOverview.purpose}</dd></div><div><dt>设计关注点</dt><dd>{result.systemOverview.designIntent}</dd></div><div><dt>关键资产</dt><dd>{result.systemOverview.sensitiveAssets.join('、')}</dd></div></dl></div></section>;
}

function SystemOverview({ result }: { result: ThreatModelResult }) {
  const overview = result.systemOverview;
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>系统模型</h3><p>以下对象由真实输入证据提取，未知部分明确列为假设</p></div><span className="model-revision">{result.coverage.sourceFiles} 个源码证据 · {result.coverage.scopeDocuments} 份文档</span></div><div className="model-inventory"><Inventory icon={<UserRound />} label="信任边界" value={String(overview.trustBoundaries.length)} detail={overview.trustBoundaries.map((item) => item.name).join('、')} /><Inventory icon={<Layers3 />} label="组件" value={String(overview.components.length)} detail={overview.components.map((item) => item.name).join('、')} /><Inventory icon={<Workflow />} label="数据流" value={String(overview.dataFlows.length)} detail="跨组件和边界的关键数据移动" /><Inventory icon={<Database />} label="关键资产" value={String(overview.sensitiveAssets.length)} detail={overview.sensitiveAssets.join('、')} /></div><div className="system-overview-sections"><article><h4>目的与能力</h4><p>{overview.purpose}；{overview.capabilities.join('；')}</p></article><article><h4>设计意图</h4><p>{overview.designIntent}</p></article><article><h4>安全姿态</h4><p>{overview.securityPosture.join('；')}</p></article><article><h4>关键假设</h4><p>{overview.assumptions.join('；')}</p></article></div><div className="component-table"><table><thead><tr><th>组件</th><th>类型</th><th>职责</th><th>证据</th></tr></thead><tbody>{overview.components.map((component) => <tr key={component.id}><td><strong>{component.name}</strong></td><td>{component.kind}</td><td>{component.purpose}</td><td><code>{component.evidence.join('、') || '范围文档推导'}</code></td></tr>)}</tbody></table></div><div className="component-table"><table><thead><tr><th>数据来源</th><th>目标</th><th>数据</th><th>保护</th></tr></thead><tbody>{overview.dataFlows.map((flow, index) => <tr key={`${flow.source}-${flow.target}-${index}`}><td>{flow.source}</td><td>{flow.target}</td><td>{flow.data}</td><td>{flow.protection}</td></tr>)}</tbody></table></div></section>;
}

function ThreatCatalog({ threats, onChange, onCreate }: { threats: ThreatModelThreat[]; onChange: (threat: ThreatModelThreat, status: ThreatStatus) => Promise<void>; onCreate: () => void }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<'all' | ThreatSeverity>('all');
  const [status, setStatus] = useState<'all' | ThreatStatus>('all');
  const [saving, setSaving] = useState('');
  const filtered = useMemo(() => threats.filter((threat) => (severity === 'all' || threat.severity === severity) && (status === 'all' || threat.status === status) && (!query || `${threat.title} ${threat.id}`.toLowerCase().includes(query.toLowerCase()))), [threats, query, severity, status]);
  const [selectedId, setSelectedId] = useState(threats[0]?.id ?? '');
  const selected = filtered.find((threat) => threat.id === selectedId) ?? filtered[0];
  async function update(threat: ThreatModelThreat, next: ThreatStatus) { setSaving(threat.id); try { await onChange(threat, next); } finally { setSaving(''); } }
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>威胁清单</h3><p>每项威胁都包含声明、前置条件、资产、证据和建议</p></div><button className="secondary-button" onClick={onCreate}><Plus size={15} />人工补录威胁</button></div><div className="threat-toolbar"><label><Search size={14} /><input aria-label="搜索威胁" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题或 ID" /></label><span><Filter size={14} /><select aria-label="按严重性筛选" value={severity} onChange={(event) => setSeverity(event.target.value as 'all' | ThreatSeverity)}><option value="all">全部</option><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select><select aria-label="按状态筛选" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ThreatStatus)}><option value="all">全部</option><option value="open">开放</option><option value="resolved">已解决</option><option value="dismissed">已驳回</option></select></span></div><div className="threat-catalog"><div className="threat-list">{filtered.map((threat) => <button key={threat.id} className={selected?.id === threat.id ? 'active' : ''} onClick={() => setSelectedId(threat.id)}><span className={`threat-severity severity-${severityLabels[threat.severity]}`}>{severityLabels[threat.severity]}</span><div><strong>{threat.title}</strong><small>{threat.id} · STRIDE {threat.stride.join(' / ')} · {threat.confidence} 置信度</small></div><em className={`threat-status status-${threatStatusLabels[threat.status]}`}>{threatStatusLabels[threat.status]}</em><ChevronRight size={15} /></button>)}{!filtered.length && <div className="empty-filter">没有符合条件的威胁</div>}</div>{selected && <ThreatDetailPanel threat={selected} saving={saving === selected.id} onChange={update} />}</div></section>;
}

function ThreatDetailPanel({ threat, saving, onChange }: { threat: ThreatModelThreat; saving: boolean; onChange: (threat: ThreatModelThreat, status: ThreatStatus) => Promise<void> }) {
  return <aside className="threat-detail-panel"><header><div><span className={`threat-severity severity-${severityLabels[threat.severity]}`}>{severityLabels[threat.severity]}</span><span className={`threat-status status-${threatStatusLabels[threat.status]}`}>{threatStatusLabels[threat.status]}</span>{threat.assumption && <span className="threat-status">待确认假设</span>}</div><strong>{threat.id}</strong></header><h4>{threat.title}</h4><section><span>威胁声明</span><p>{threat.statement}</p></section><div className="threat-facts"><div><span>来源</span><p>{threat.source}</p></div><div><span>动作</span><p>{threat.action}</p></div><div><span>影响</span><p>{threat.impact}</p></div></div><section><span>前置条件</span><ul>{threat.prerequisites.map((item) => <li key={item}>{item}</li>)}</ul></section><section><span>受影响资产 / 安全目标</span><div className="detail-tags">{[...threat.assets, ...threat.goals].map((item) => <b key={item}>{item}</b>)}</div></section><section><span>证据</span>{threat.evidence.map((item) => <code key={item}>{item}</code>)}</section><section className="recommendation"><span>建议</span><p>{threat.recommendation}</p></section><footer><span>负责人：{threat.owner}</span><div><button className="secondary-button" disabled={saving || threat.status === 'open'} onClick={() => void onChange(threat, 'open')}>重新打开</button><button className="secondary-button" disabled={saving || threat.status === 'dismissed'} onClick={() => void onChange(threat, 'dismissed')}>驳回</button><button className="primary-button" disabled={saving || threat.status === 'resolved'} onClick={() => void onChange(threat, 'resolved')}>{saving ? <LoaderCircle className="spin" size={13} /> : null}标记已解决</button></div></footer></aside>;
}

function ManualThreatModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: Parameters<typeof createThreatModelThreat>[1]) => Promise<void> }) {
  const [title, setTitle] = useState(''); const [statement, setStatement] = useState(''); const [recommendation, setRecommendation] = useState('');
  const [severity, setSeverity] = useState<ThreatSeverity>('medium'); const [stride, setStride] = useState('I'); const [submitting, setSubmitting] = useState(false); const [error, setError] = useState('');
  async function submit() { setSubmitting(true); setError(''); try { await onCreate({ title: title.trim(), severity, stride: [stride], statement: statement.trim(), source: '人工评审确认', action: '待领域专家补充', impact: '待领域专家补充', prerequisites: ['待领域专家确认'], assets: ['待确认资产'], goals: ['待确认'], recommendation: recommendation.trim() }); } catch (cause) { setError(cause instanceof Error ? cause.message : '补录威胁失败'); } finally { setSubmitting(false); } }
  return <div className="modal-backdrop"><div className="create-modal manual-threat-modal" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="modal-icon threat-modal-icon"><AlertTriangle size={20} /></span><div><h2>人工补录威胁</h2><p>补充规则分析未覆盖的业务或架构威胁</p></div></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button></div><div className="capability-create-body"><label className="form-field"><span>威胁标题</span><input aria-label="威胁标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-grid"><label className="form-field"><span>严重性</span><select aria-label="威胁严重性" value={severity} onChange={(event) => setSeverity(event.target.value as ThreatSeverity)}><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label className="form-field"><span>STRIDE 类别</span><select aria-label="STRIDE 类别" value={stride} onChange={(event) => setStride(event.target.value)}><option value="S">S · 身份伪造</option><option value="T">T · 数据篡改</option><option value="R">R · 抵赖</option><option value="I">I · 信息泄露</option><option value="D">D · 拒绝服务</option><option value="E">E · 权限提升</option></select></label></div><label className="form-field"><span>威胁声明</span><textarea aria-label="威胁声明" value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="谁在什么条件下可以做什么，并造成什么影响" /></label><label className="form-field"><span>处置建议</span><textarea aria-label="处置建议" value={recommendation} onChange={(event) => setRecommendation(event.target.value)} /></label>{error && <div className="form-error">{error}</div>}</div><div className="modal-footer"><span>人工威胁与规则结果一起进入处置流程</span><div><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={!title.trim() || !statement.trim() || !recommendation.trim() || submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}创建威胁</button></div></div></div></div>;
}

function AttackPaths({ result }: { result: ThreatModelResult }) {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>高风险攻击路径</h3><p>将威胁前置条件、动作、资产和影响组织成可阻断链路</p></div><span className="risk-label">{result.attackPaths.length} 条路径</span></div>{result.attackPaths.length ? result.attackPaths.map((path) => <div className="attack-path-group" key={path.id}><div className="attack-path">{path.steps.map((step, index) => <div key={step.title} className={index > 1 ? 'danger' : ''}><b>{String(index + 1).padStart(2, '0')}</b><strong>{step.title}</strong><small>{step.detail}</small></div>).flatMap((node, index) => index ? [<ChevronRight key={`${path.id}-arrow-${index}`} />, node] : [node])}</div><div className="path-control"><ShieldCheck size={18} /><div><strong>建议阻断点：{path.controlPoint}</strong><p>{path.recommendation}</p></div><span>{path.threatId}</span></div></div>) : <div className="capability-empty"><ShieldCheck size={28} /><strong>未形成高风险攻击路径</strong><span>仍需人工确认业务滥用和输入证据未覆盖的场景</span></div>}</section>;
}

function Governance({ threats }: { threats: ThreatModelThreat[] }) {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>风险与控制治理</h3><p>威胁状态、负责人、建议和验证证据共同形成处置闭环</p></div></div><div className="governance-table"><table><thead><tr><th>威胁</th><th>严重性 / STRIDE</th><th>状态</th><th>负责人</th><th>建议控制</th><th>验证证据</th></tr></thead><tbody>{threats.map((threat) => <tr key={threat.id}><td><strong>{threat.title}</strong><small>{threat.id}</small></td><td><span className={`threat-severity severity-${severityLabels[threat.severity]}`}>{severityLabels[threat.severity]}</span><small>{threat.stride.join(' / ')}</small></td><td><span className={`threat-status status-${threatStatusLabels[threat.status]}`}>{threatStatusLabels[threat.status]}</span></td><td>{threat.owner}</td><td>{threat.recommendation}</td><td><code>{threat.status === 'resolved' ? threat.evidence[0] : '待补充修复验证'}</code></td></tr>)}</tbody></table></div></section>;
}

function RunProcess({ model, view, onView, running }: { model: ThreatModelRecord; view: RunView; onView: (view: RunView) => void; running: boolean }) {
  const run = model.latestRun; const result = run?.result;
  return <section className="capability-result-section"><div className="run-summary"><div><Clock3 size={19} /><span><strong>{run?.id ?? '尚未运行'}</strong><small>{formatDate(run?.startedAt)} · {runDuration(run?.startedAt, run?.completedAt)}</small></span></div><ModelStatusBadge status={running ? 'running' : model.status} /></div><div className="run-subtabs"><button className={view === 'configuration' ? 'active' : ''} onClick={() => onView('configuration')}><FileText size={14} />运行配置</button><button className={view === 'preflight' ? 'active' : ''} onClick={() => onView('preflight')}><ListChecks size={14} />预检</button><button className={view === 'logs' ? 'active' : ''} onClick={() => onView('logs')}><FileSearch size={14} />日志</button></div>{view === 'configuration' && <div className="run-configuration"><ConfigRow label="源码证据" value={model.configuration.sourceScanTaskId || '未提供'} /><ConfigRow label="设计文档" value={model.configuration.scopeDocuments.map((document) => document.name).join('、') || model.configuration.scopeSummary || '未提供'} /><ConfigRow label="环境 / 方式" value={`${environmentLabels[model.configuration.environment]} · ${modeLabels[model.configuration.mode]}`} /><ConfigRow label="执行边界" value="静态证据分析；不执行仓库脚本；不连接被测系统" /></div>}{view === 'preflight' && <div className="preflight-list">{(result?.preflight ?? []).map((check) => <div key={check.name}><span className={check.status === 'complete' ? 'complete' : 'running'}>{check.status === 'complete' ? <Check size={14} /> : <CircleDot size={14} />}</span><div><strong>{check.name}</strong><small>{check.detail}</small></div><b>{check.status === 'complete' ? '已完成' : '进行中'}</b></div>)}{running && <div><span className="running"><LoaderCircle className="spin" size={14} /></span><div><strong>服务端分析</strong><small>正在生成系统模型和威胁证据</small></div><b>进行中</b></div>}</div>}{view === 'logs' && <div className="run-logs">{(result?.logs ?? []).map((log) => <div key={`${log.time}-${log.stage}`}><code>{new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false })}</code><span>{log.stage} · {log.message}</span></div>)}</div>}</section>;
}

function RunHistory({ model }: { model: ThreatModelRecord }) {
  return <section className="capability-result-section"><div className="section-title-row"><div><h3>运行历史</h3><p>每次运行保留输入配置和结果快照，可用于后续版本差异分析</p></div></div><div className="run-history-table"><table><thead><tr><th>运行 ID</th><th>开始时间</th><th>状态</th><th>耗时</th><th>威胁</th></tr></thead><tbody>{model.runs.map((run) => <tr key={run.id}><td><code>{run.id}</code></td><td>{formatDate(run.startedAt)}</td><td><ModelStatusBadge status={run.status} /></td><td>{runDuration(run.startedAt, run.completedAt)}</td><td>{run.threatCount}</td></tr>)}</tbody></table></div>{model.latestRun?.result?.coverage.limitations.length ? <div className="coverage-limitations"><AlertTriangle size={17} /><div><strong>本次覆盖限制</strong>{model.latestRun.result.coverage.limitations.map((item) => <p key={item}>{item}</p>)}</div></div> : null}</section>;
}

function Metric({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) { return <div className={`capability-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Inventory({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) { return <div><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></div>; }
function ConfigRow({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function ModelStatusBadge({ status }: { status: ThreatModelRecord['status'] | NonNullable<ThreatModelRecord['latestRun']>['status'] }) { return <span className={`prototype-status model-status-${statusLabels[status]}`}>{statusLabels[status]}</span>; }
function formatDate(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'; }
function runDuration(start?: string, end?: string) { if (!start) return '-'; if (!end) return '运行中'; const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)); return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`; }

function downloadReport(model: ThreatModelRecord) {
  const result = model.latestRun?.result; if (!result) return;
  const body = [`# ${model.title}`, '', `- 模型 ID：${model.id}`, `- 运行 ID：${model.latestRun?.id}`, `- 状态：${statusLabels[model.status]}`, '', '## 系统概览', '', result.systemOverview.architecture, '', `关键资产：${result.systemOverview.sensitiveAssets.join('、')}`, '', '## 威胁', '', ...result.threats.flatMap((threat) => [`### ${threat.id} ${threat.title}`, '', `- 严重性：${severityLabels[threat.severity]}`, `- 状态：${threatStatusLabels[threat.status]}`, `- STRIDE：${threat.stride.join(' / ')}`, `- 证据：${threat.evidence.join('、')}`, '', threat.statement, '', `建议：${threat.recommendation}`, ''])].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `${model.id}-threat-model.md`; link.click(); URL.revokeObjectURL(url);
}
