"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReviewWebviewProvider = void 0;
const crypto_1 = require("crypto");
const vscode = __importStar(require("vscode"));
const reportJson_1 = require("./reportJson");
const emptyReport = {
    schemaVersion: '2.0', metadata: { baseline: 'sec-baseline.md', scope: '未扫描', generatedAt: 'unavailable' }, result: 'pass',
    counts: { critical: 0, high: 0, medium: 0, low: 0, manualReview: 0 }, findings: [], manualReview: [],
    coverage: { checked: [], notChecked: [], tools: [] },
};
class ReviewWebviewProvider {
    view;
    stateChangeEmitter = new vscode.EventEmitter();
    state = {
        status: 'ready',
        detail: '等待开始安全扫描',
        progress: 0,
        stage: '准备就绪',
        workspaceLabel: '',
        taskId: '',
        timeline: [],
        hasResult: false,
        reportMarkdown: '',
        report: emptyReport,
        scanHistory: { selectedReportId: '', generatedAt: '', previousGeneratedAt: '', storedLocally: false, entries: [] },
    };
    disposables = [];
    onDidChangeState = this.stateChangeEmitter.event;
    getState() {
        return this.state;
    }
    resolveWebviewView(view) {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        view.webview.html = this.getHtml(view.webview);
        this.disposables.push(view.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message !== 'object' || !('type' in message)) {
                return;
            }
            const typedMessage = message;
            if (typedMessage.type === 'ready') {
                this.pushState();
            }
            else if (typedMessage.type === 'runReview') {
                await vscode.commands.executeCommand('pi-sec-review.runReview');
            }
            else if (typedMessage.type === 'configureAccessKey') {
                await vscode.commands.executeCommand('pi-sec-review.setPlatformToken');
            }
            else if (typedMessage.type === 'openReport') {
                await vscode.commands.executeCommand('pi-sec-review.openLastResult');
            }
            else if (typedMessage.type === 'openFinding' && typeof typedMessage.location === 'string') {
                await vscode.commands.executeCommand('pi-sec-review.openFinding', typedMessage.location);
            }
        }));
    }
    dispose() {
        this.stateChangeEmitter.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
    begin(workspaceLabel) {
        this.state = {
            ...this.state,
            status: 'running',
            detail: '正在初始化安全扫描',
            progress: 2,
            stage: '初始化扫描',
            workspaceLabel,
            taskId: '',
            timeline: [{ label: '初始化扫描', message: '正在准备模型与工作区上下文', progress: 2, state: 'active' }],
        };
        this.pushState();
    }
    setStage(stage, taskId) {
        const timeline = this.state.timeline.map(item => ({ ...item, state: item.state === 'active' ? 'complete' : item.state }));
        const existingIndex = timeline.findIndex(item => item.label === stage.label);
        const item = { label: stage.label, message: stage.message, progress: stage.progress, state: 'active' };
        if (existingIndex >= 0) {
            timeline[existingIndex] = item;
        }
        else {
            timeline.push(item);
        }
        this.state = {
            ...this.state,
            status: 'running',
            detail: stage.message,
            progress: stage.progress,
            stage: stage.label,
            taskId,
            timeline,
        };
        this.pushState();
    }
    setStatus(status, detail) {
        this.state = { ...this.state, status, detail };
        this.pushState();
    }
    setReport(artifact, taskId = this.state.taskId, options) {
        const report = (0, reportJson_1.parseReviewReportJson)(artifact.reportJson);
        this.state = {
            ...this.state,
            status: 'complete',
            detail: options?.restored ? '已从本机恢复上次扫描结果' : '安全扫描已完成并保存到本机',
            progress: 100,
            stage: '扫描完成',
            taskId,
            hasResult: true,
            reportMarkdown: (0, reportJson_1.renderReviewReportMarkdown)(report),
            report,
            scanHistory: {
                selectedReportId: artifact.reportId,
                generatedAt: artifact.generatedAt,
                previousGeneratedAt: options?.previousGeneratedAt ?? '',
                previousCounts: options?.previousReport?.counts,
                storedLocally: options?.storedLocally ?? false,
                entries: options?.historyEntries ?? this.state.scanHistory.entries,
            },
            timeline: this.state.timeline.map(item => ({ ...item, state: 'complete' })),
        };
        this.pushState();
    }
    pushState() {
        this.stateChangeEmitter.fire(this.state);
        void this.view?.webview.postMessage({ type: 'state', state: this.state });
    }
    getHtml(webview) {
        const nonce = (0, crypto_1.randomBytes)(16).toString('base64');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root { color-scheme: light dark; --accent: var(--vscode-focusBorder, #2f81f7); --border: var(--vscode-panel-border, #3c4148); --muted: var(--vscode-descriptionForeground, #9ba1a6); }
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px/1.45 var(--vscode-font-family); }
button { font: inherit; }
.shell { min-width: 230px; }
.topbar { min-height: 48px; padding: 10px 12px; display: flex; align-items: center; gap: 9px; border-bottom: 1px solid var(--border); }
.brand-mark { width: 30px; height: 32px; display: grid; place-items: center; color: var(--vscode-button-foreground, #fff); background: var(--accent); font-weight: 700; clip-path: polygon(50% 0, 92% 16%, 84% 72%, 50% 100%, 16% 72%, 8% 16%); }
.brand { min-width: 0; flex: 1; }
.brand strong { display: block; font-size: 13px; }
.brand span { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.key-config { flex: 0 0 auto; min-height: 28px; padding: 0 8px; border: 1px solid var(--border); color: inherit; background: transparent; cursor: pointer; }
.key-config:hover { background: var(--vscode-toolbar-hoverBackground); }
.tabs { height: 36px; display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid var(--border); }
.tab { position: relative; border: 0; background: transparent; color: var(--muted); cursor: pointer; }
.tab.active { color: var(--vscode-foreground); }
.tab.active::after { content: ''; position: absolute; left: 18%; right: 18%; bottom: 0; height: 2px; background: var(--accent); }
.pane { display: none; }
.pane.active { display: block; }
.status { padding: 18px 14px; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 16px; align-items: center; border-bottom: 1px solid var(--border); }
.ring { --progress: 0; width: 88px; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; background: conic-gradient(var(--accent) calc(var(--progress) * 1%), var(--border) 0); }
.ring::before { content: ''; width: 72px; aspect-ratio: 1; border-radius: 50%; background: var(--vscode-sideBar-background); grid-area: 1 / 1; }
.ring-value { z-index: 1; grid-area: 1 / 1; font-size: 20px; font-weight: 650; }
.status-copy { min-width: 0; }
.eyebrow { color: var(--muted); font-size: 11px; text-transform: uppercase; }
.status-copy h2 { margin: 3px 0 5px; font-size: 15px; letter-spacing: 0; }
.status-copy p { margin: 0; color: var(--muted); overflow-wrap: anywhere; }
.section { padding: 14px; border-bottom: 1px solid var(--border); }
.section-title { margin: 0 0 10px; display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
.meta { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 7px 10px; }
.meta dt { color: var(--muted); }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.primary { width: 100%; min-height: 34px; border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
.primary:hover { background: var(--vscode-button-hoverBackground); }
.primary:disabled { opacity: .55; cursor: default; }
.timeline { padding: 10px 14px 18px; }
.timeline-item { position: relative; min-height: 56px; padding: 4px 0 12px 28px; }
.timeline-item::before { content: ''; position: absolute; left: 8px; top: 20px; bottom: -4px; width: 1px; background: var(--border); }
.timeline-item:last-child::before { display: none; }
.timeline-dot { position: absolute; left: 1px; top: 5px; width: 15px; height: 15px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--border); background: var(--vscode-sideBar-background); font-size: 9px; }
.timeline-item.complete .timeline-dot { color: var(--vscode-testing-iconPassed, #3fb950); border-color: currentColor; }
.timeline-item.active .timeline-dot { color: var(--accent); border-color: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
.timeline-spinner { width: 7px; height: 7px; border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); border-top-color: currentColor; border-radius: 50%; animation: timeline-spin .8s linear infinite; }
@keyframes timeline-spin { to { transform: rotate(360deg); } }
.timeline-label { display: flex; justify-content: space-between; gap: 8px; font-weight: 600; }
.timeline-message { margin-top: 3px; color: var(--muted); font-size: 11px; }
.empty { padding: 40px 18px; text-align: center; color: var(--muted); }
.summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }
.metric { min-height: 68px; padding: 10px 12px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.metric:nth-child(2n) { border-right: 0; }
.metric strong { display: block; margin-top: 4px; font-size: 20px; }
.critical strong { color: #f85149; } .high strong { color: #ff7b72; } .medium strong { color: #d29922; } .low strong { color: #3fb950; }
.finding { width: 100%; padding: 11px 12px; display: grid; grid-template-columns: 7px minmax(0, 1fr); gap: 9px; border: 0; border-bottom: 1px solid var(--border); text-align: left; color: inherit; background: transparent; cursor: pointer; }
.finding:hover { background: var(--vscode-list-hoverBackground); }
.severity { width: 7px; min-height: 36px; background: var(--muted); }
.finding.critical .severity { background: #f85149; } .finding.high .severity { background: #ff7b72; } .finding.medium .severity { background: #d29922; } .finding.low .severity { background: #3fb950; }
.finding-title { font-weight: 600; overflow-wrap: anywhere; }
.finding-meta { margin-top: 4px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.report-toolbar { position: sticky; top: 0; padding: 9px 12px; display: flex; justify-content: flex-end; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--border); z-index: 2; }
.secondary { min-height: 28px; padding: 0 10px; border: 1px solid var(--border); color: inherit; background: transparent; cursor: pointer; }
.secondary:hover { background: var(--vscode-toolbar-hoverBackground); }
.markdown { padding: 12px 14px 30px; overflow-wrap: anywhere; }
.markdown h1, .markdown h2, .markdown h3 { margin: 16px 0 8px; letter-spacing: 0; }
.markdown h1 { font-size: 17px; } .markdown h2 { font-size: 15px; } .markdown h3 { font-size: 13px; }
.markdown p { margin: 6px 0; color: var(--vscode-foreground); }
.markdown .list { padding-left: 12px; color: var(--muted); }
@media (max-width: 270px) { .status { grid-template-columns: 1fr; } .ring { width: 76px; } .ring::before { width: 62px; } }
</style>
</head>
<body>
<main class="shell">
		<header class="topbar"><div class="brand-mark">PI</div><div class="brand"><strong>安全扫描</strong><span id="workspace">未选择工作区</span></div><button class="key-config" id="configureAccessKey" title="配置扫描接入密钥">配置密钥</button></header>
  <nav class="tabs" aria-label="扫描视图"><button class="tab active" data-tab="scan">扫描</button><button class="tab" data-tab="timeline">执行链路</button><button class="tab" data-tab="report">报告</button></nav>
  <section class="pane active" id="pane-scan">
    <div class="status"><div class="ring" id="ring"><span class="ring-value" id="progress">0%</span></div><div class="status-copy"><span class="eyebrow" id="stateLabel">READY</span><h2 id="stage">准备就绪</h2><p id="detail">等待开始安全扫描</p></div></div>
	    <div class="section"><h3 class="section-title">扫描上下文</h3><dl class="meta"><dt>当前仓库</dt><dd id="repository">—</dd><dt>扫描任务</dt><dd id="task">—</dd><dt>扫描方式</dt><dd>本地安全扫描</dd><dt>文件访问</dt><dd>只读</dd></dl></div>
    <div class="section"><button class="primary" id="run">开始安全扫描</button></div>
    <div id="summaryArea" class="empty">完成扫描后将在此展示风险摘要</div>
  </section>
  <section class="pane" id="pane-timeline"><div id="timeline" class="timeline"></div></section>
  <section class="pane" id="pane-report"><div class="report-toolbar"><button class="secondary" id="openReport">在编辑器中打开</button></div><div id="report" class="markdown"></div></section>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const persisted = vscode.getState() || { tab: 'scan' };
let currentState;
const byId = id => document.getElementById(id);
const setText = (id, value) => { byId(id).textContent = value; };

function selectTab(tab) {
  document.querySelectorAll('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.pane').forEach(pane => pane.classList.toggle('active', pane.id === 'pane-' + tab));
  vscode.setState({ tab });
}

function renderTimeline(items) {
  const root = byId('timeline');
  root.replaceChildren();
  if (!items.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '扫描开始后将显示 Agent 执行链路'; root.append(empty); return; }
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'timeline-item ' + item.state;
		const dot = document.createElement('span'); dot.className = 'timeline-dot';
		if (item.state === 'complete') dot.textContent = '✓';
		else if (item.state === 'active') { const spinner = document.createElement('span'); spinner.className = 'timeline-spinner'; dot.append(spinner); }
    const label = document.createElement('div'); label.className = 'timeline-label';
    const name = document.createElement('span'); name.textContent = item.label;
    const progress = document.createElement('span'); progress.textContent = item.progress + '%';
    const message = document.createElement('div'); message.className = 'timeline-message'; message.textContent = item.message;
    label.append(name, progress); row.append(dot, label, message); root.append(row);
  }
}

function renderSummary(state) {
  const root = byId('summaryArea'); root.replaceChildren();
  if (!state.hasResult) { root.className = 'empty'; root.textContent = '完成扫描后将在此展示风险摘要'; return; }
  root.className = '';
  const summary = document.createElement('div'); summary.className = 'summary';
  for (const severity of ['critical', 'high', 'medium', 'low']) {
    const metric = document.createElement('div'); metric.className = 'metric ' + severity;
    const label = document.createElement('span'); label.textContent = ({ critical: '严重', high: '高危', medium: '中危', low: '低危' })[severity];
    const count = document.createElement('strong'); count.textContent = String(state.report.counts[severity]);
    metric.append(label, count); summary.append(metric);
  }
  root.append(summary);
  if (!state.report.findings.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '未发现可定位的安全问题'; root.append(empty); return; }
  for (const finding of state.report.findings) {
    const button = document.createElement('button'); button.className = 'finding ' + finding.severity; button.dataset.location = finding.location;
    const bar = document.createElement('span'); bar.className = 'severity';
    const copy = document.createElement('span');
    const title = document.createElement('span'); title.className = 'finding-title'; title.textContent = finding.id + ' · ' + finding.title;
    const meta = document.createElement('span'); meta.className = 'finding-meta'; meta.textContent = finding.location + (finding.rule ? ' · ' + finding.rule : '');
    copy.append(title, meta); button.append(bar, copy); root.append(button);
  }
}

function renderMarkdown(markdown) {
  const root = byId('report'); root.replaceChildren();
  if (!markdown) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '尚未生成扫描报告'; root.append(empty); return; }
		for (const line of markdown.split(/\\r?\\n/)) {
	    let node;
		// codex-security: allow SEC-DYNAMIC-EVAL-001 — this fixed expression only classifies locally generated Markdown headings; it never evaluates code or builds an executable expression.
		const heading = /^(#{1,3})\\s+(.+)$/.exec(line);
    if (heading) { node = document.createElement('h' + heading[1].length); node.textContent = heading[2]; }
    else if (line.startsWith('- ')) { node = document.createElement('p'); node.className = 'list'; node.textContent = '• ' + line.slice(2); }
    else if (line.trim()) { node = document.createElement('p'); node.textContent = line; }
    if (node) root.append(node);
  }
}

function render(state) {
  currentState = state;
  setText('workspace', state.workspaceLabel || '未选择工作区'); setText('repository', state.workspaceLabel || '—'); setText('task', state.taskId || '—');
  setText('progress', state.progress + '%'); setText('stateLabel', state.status.toUpperCase()); setText('stage', state.stage); setText('detail', state.detail);
  byId('ring').style.setProperty('--progress', state.progress);
  const run = byId('run'); run.disabled = state.status === 'running'; run.textContent = state.status === 'running' ? '扫描进行中' : state.hasResult ? '重新扫描' : '开始安全扫描';
  renderTimeline(state.timeline); renderSummary(state); renderMarkdown(state.reportMarkdown);
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
byId('run').addEventListener('click', () => vscode.postMessage({ type: 'runReview' }));
byId('configureAccessKey').addEventListener('click', () => vscode.postMessage({ type: 'configureAccessKey' }));
byId('openReport').addEventListener('click', () => vscode.postMessage({ type: 'openReport' }));
byId('summaryArea').addEventListener('click', event => { const finding = event.target.closest('.finding'); if (finding?.dataset.location) vscode.postMessage({ type: 'openFinding', location: finding.dataset.location }); });
window.addEventListener('message', event => { if (event.data?.type === 'state') render(event.data.state); });
selectTab(persisted.tab); vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
exports.ReviewWebviewProvider = ReviewWebviewProvider;
//# sourceMappingURL=reviewWebview.js.map