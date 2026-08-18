import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Bot, CheckCircle2, ChevronRight, FileArchive, FileCode2, LoaderCircle, Plus, ShieldAlert, TestTube2, Upload, X } from 'lucide-react';
import {
  createPlatformArchiveScan, loadMyScans, loadScanDetail,
  type PlatformScanDetail, type PlatformScanTask, type SecurityReport,
} from './api';

const capability = 'agent-skill-security';

function isAgentSkillTask(task: PlatformScanTask): boolean {
  return task.scanConfiguration?.capabilities?.includes(capability) ?? false;
}

function statusLabel(status: PlatformScanTask['status']): string {
  return ({ queued: '排队中', cloning: '读取资产包', indexing: '识别资产', analyzing: '安全审计', normalizing: '生成报告', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消' })[status];
}

function parseReport(detail: PlatformScanDetail | null): SecurityReport | null {
  if (!detail?.reportJson) return null;
  try {
    return JSON.parse(detail.reportJson) as SecurityReport;
  } catch {
    return null;
  }
}

function assetSourceLabel(task: Pick<PlatformScanTask, 'repositoryUrl'>): string {
  const prefix = 'archive://upload/';
  return task.repositoryUrl.startsWith(prefix) ? decodeURIComponent(task.repositoryUrl.slice(prefix.length)) : task.repositoryUrl;
}

export function AgentSkillSecurityWorkspace() {
  const [tasks, setTasks] = useState<PlatformScanTask[]>([]);
  const [selected, setSelected] = useState<PlatformScanDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      setTasks((await loadMyScans(100, 0)).filter(isAgentSkillTask));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function openTask(task: PlatformScanTask) {
    setError('');
    try {
      const detail = await loadScanDetail(task.id);
      setSelected({ ...detail, repositoryUrl: assetSourceLabel(detail), gitRef: '上传资产包' });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }

  if (selected) return <AgentSkillTaskDetail task={selected} onBack={() => { setSelected(null); void refresh(); }} />;

  return <>
    <div className="capability-tabs"><button className="active"><FileCode2 size={16} />检测任务</button><button onClick={() => setShowCreate(true)}><Plus size={16} />新建检测</button></div>
    <section className="capability-task-panel">
      <div className="section-title-row"><div><h3>第三方 Agent / Skill 检测任务</h3><p>审计上传资产包中的 Agent、Skill、Prompt、MCP、工具与运行脚本，不执行被审计内容</p></div><span>{tasks.length} 个任务</span></div>
      {error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}
      {loading ? <div className="capability-empty"><LoaderCircle className="spin" /><strong>正在加载任务</strong></div> : tasks.length ? <div className="capability-task-table"><table><thead><tr><th>任务</th><th>资产包</th><th>状态</th><th>风险</th><th>进度</th><th /></tr></thead><tbody>{tasks.map((task) => <tr key={task.id} onClick={() => void openTask(task)}><td><strong>{task.projectName}</strong><small>{task.id}</small></td><td>{assetSourceLabel(task)}<small>上传归档</small></td><td><span className={`prototype-status ${task.status === 'completed' ? 'done' : ''}`}>{statusLabel(task.status)}</span></td><td><b>{task.findingCount || '-'}</b></td><td>{task.progress}%</td><td><button className="link-button">查看结果<ChevronRight size={14} /></button></td></tr>)}</tbody></table></div> : <div className="capability-empty"><Bot size={28} /><strong>还没有 Agent / Skill 检测任务</strong><button className="primary-button" onClick={() => setShowCreate(true)}>创建第一个检测</button></div>}
    </section>
    {showCreate && <CreateAgentSkillTask onClose={() => setShowCreate(false)} onCreated={(task) => { setShowCreate(false); setTasks((current) => [task, ...current]); }} />}
  </>;
}

function CreateAgentSkillTask({ onClose, onCreated }: { onClose: () => void; onCreated: (task: PlatformScanTask) => void }) {
  const [projectName, setProjectName] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!projectName.trim() || !archive) {
      setError('请填写任务名称并选择 Agent / Skill ZIP 资产包');
      return;
    }
    if (archive.size > 64 * 1024 * 1024) {
      setError('资产包不能超过 64 MiB');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const task = await createPlatformArchiveScan({
        projectName: projectName.trim(), repositoryUrl: '', gitRef: '', estimatedLines: 10000,
        mode: 'deep', scanLevel: 'release', priority: 'normal', aiEnabled: true, premiumModel: true,
        excludeDirectories: [], excludePatterns: [], scanDirectories: [], vulnerabilityTypes: [], capabilities: [capability],
      }, archive);
      onCreated(task);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="modal-backdrop"><div className="create-modal capability-create" role="dialog" aria-modal="true"><div className="modal-header"><div><span className="modal-icon"><Bot size={20} /></span><div><h2>创建 Agent / Skill 安全检测</h2><p>上传第三方 Agent、Skill、Prompt 或 MCP 资产包</p></div></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={19} /></button></div><div className="capability-create-body"><label className="form-field"><span>任务名称</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="例如：发布助手 Skill 安全审计" /></label><label className="threat-upload-zone"><Upload size={22} /><strong>{archive ? archive.name : '选择 Agent / Skill ZIP 资产包'}</strong><small>{archive ? `${(archive.size / 1024).toFixed(1)} KiB` : '包含声明文件、Prompt、MCP 配置及其相关实现脚本，最大 64 MiB'}</small><input type="file" accept=".zip,application/zip" onChange={(event) => { setArchive(event.target.files?.[0] ?? null); setError(''); }} /></label><div className="scenario-banner"><TestTube2 size={20} /><div><strong>静态审计边界</strong><p>平台只解包并读取声明和源码，不执行脚本、不调用工具、不连接资产声明的 MCP 服务，也不注入真实凭据。</p></div></div>{error && <div className="form-error"><AlertTriangle size={15} />{error}</div>}</div><div className="modal-footer"><span className="input-summary"><FileArchive size={15} />ZIP 资产包</span><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={submitting} onClick={() => void submit()}>{submitting ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}提交检测</button></div></div></div>;
}

function AgentSkillTaskDetail({ task, onBack }: { task: PlatformScanDetail; onBack: () => void }) {
  const [view, setView] = useState<'overview' | 'findings' | 'validation' | 'logs'>('overview');
  const report = parseReport(task);
  const findings = report?.findings ?? [];
  return <div className="capability-page"><header className="capability-detail-header"><button className="secondary-button" onClick={onBack}>返回任务列表</button><div><span className="eyebrow">AGENT SECURITY · {task.id}</span><h1>{task.projectName}</h1><p>{task.repositoryUrl} · {task.gitRef}</p></div><span className={`prototype-status ${task.status === 'completed' ? 'done' : ''}`}>{statusLabel(task.status)}</span></header><nav className="result-view-tabs"><button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>资产与覆盖</button><button className={view === 'findings' ? 'active' : ''} onClick={() => setView('findings')}>发现与修复</button><button className={view === 'validation' ? 'active' : ''} onClick={() => setView('validation')}>隔离验证建议</button><button className={view === 'logs' ? 'active' : ''} onClick={() => setView('logs')}>执行日志</button></nav>{view === 'overview' && <section className="capability-result-section"><div className="capability-metric-grid"><Metric label="状态" value={statusLabel(task.status)} detail={task.statusMessage} /><Metric label="识别资产" value={String(report?.coverage.checked.length ?? task.scannedFiles)} detail="Agent、Skill、Prompt、MCP 与脚本" /><Metric label="安全发现" value={String(findings.length)} detail={`严重 ${report?.summary.critical ?? 0} · 高危 ${report?.summary.high ?? 0}`} danger={findings.some((item) => item.severity === 'critical' || item.severity === 'high')} /><Metric label="分析完整性" value={report?.result === 'incomplete' ? '不完整' : report ? '已完成' : `${task.progress}%`} detail={report?.coverage.notChecked.length ? `${report.coverage.notChecked.length} 项未检查` : '未执行目标仓库内容'} /></div><div className="asset-source-list">{report?.coverage.checked.map((asset) => <div key={asset}><span><FileCode2 /></span><div><strong>{asset}</strong><small>第三方被审计资产</small></div><b>静态证据</b></div>)}</div></section>}{view === 'findings' && <section className="capability-result-section"><div className="section-title-row"><div><h3>发现与修复</h3><p>仅展示有仓库文件和行号支持的结论</p></div></div>{findings.length ? <div className="finding-catalog">{findings.map((finding) => <article key={finding.id} className="prototype-finding"><ShieldAlert /><div><strong>{finding.title}</strong><p>{finding.evidence}</p><small>{finding.rule} · {finding.locations.map((location) => `${location.path}:${location.line}`).join('、')}</small><p><b>修复：</b>{finding.remediation}</p></div><span>{finding.severity}</span></article>)}</div> : <div className="capability-empty"><CheckCircle2 size={28} /><strong>{report ? '未发现有证据支持的安全问题' : '报告尚未生成'}</strong></div>}</section>}{view === 'validation' && <section className="capability-result-section"><div className="scenario-banner"><TestTube2 /><div><strong>仅生成隔离验证建议</strong><p>使用断网沙箱、合成秘密和工具替身复核；不得执行仓库脚本、连接真实 MCP 或提供生产身份。</p></div></div><div className="scenario-list">{findings.map((finding) => <div key={finding.id}><span><TestTube2 size={14} /></span><div><strong>{finding.title}</strong><small>{finding.verification}</small></div><b>{finding.confidence} confidence</b><em>待授权验证</em></div>)}</div></section>}{view === 'logs' && <section className="capability-result-section"><div className="scenario-list">{task.logs.map((log, index) => <div key={`${log.createdAt}-${index}`}><span><Activity size={14} /></span><div><strong>{log.stage}</strong><small>{log.message}</small></div><b>{log.progress}%</b><em>{log.level}</em></div>)}</div></section>}</div>;
}

function Metric({ label, value, detail, danger = false }: { label: string; value: string; detail: string; danger?: boolean }) {
  return <div className={`capability-metric ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}