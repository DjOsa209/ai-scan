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
exports.ReviewDetailsPanel = void 0;
const crypto_1 = require("crypto");
const vscode = __importStar(require("vscode"));
class ReviewDetailsPanel {
    reviewState;
    panel;
    mode = 'report';
    disposables = [];
    constructor(reviewState) {
        this.reviewState = reviewState;
        this.disposables.push(reviewState.onDidChangeState(state => this.pushState(state)));
    }
    openReport() {
        this.open('report');
    }
    openLogs() {
        this.open('logs');
    }
    dispose() {
        this.panel?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
    open(mode) {
        this.mode = mode;
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, false);
            this.panel.title = mode === 'report' ? '安全扫描报告' : '安全扫描日志';
            void this.panel.webview.postMessage({ type: 'mode', mode });
            this.pushState(this.reviewState.getState());
            return;
        }
        const panel = vscode.window.createWebviewPanel('piSecReview.details', mode === 'report' ? '安全扫描报告' : '安全扫描日志', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true });
        this.panel = panel;
        panel.webview.html = this.getHtml(mode);
        this.disposables.push(panel.onDidDispose(() => {
            if (this.panel === panel) {
                this.panel = undefined;
            }
        }));
        this.disposables.push(panel.webview.onDidReceiveMessage(async (message) => {
            if (!message || typeof message !== 'object' || !('type' in message)) {
                return;
            }
            const typedMessage = message;
            if (typedMessage.type === 'ready') {
                void panel.webview.postMessage({ type: 'mode', mode: this.mode });
                this.pushState(this.reviewState.getState());
            }
            else if (typedMessage.type === 'selectMode' && (typedMessage.mode === 'report' || typedMessage.mode === 'logs')) {
                this.mode = typedMessage.mode;
                panel.title = this.mode === 'report' ? '安全扫描报告' : '安全扫描日志';
            }
            else if (typedMessage.type === 'runReview') {
                await vscode.commands.executeCommand('pi-sec-review.runReview');
            }
            else if (typedMessage.type === 'exportReport') {
                await vscode.commands.executeCommand('pi-sec-review.exportLastResult');
            }
            else if (typedMessage.type === 'openFinding' && typeof typedMessage.location === 'string') {
                await vscode.commands.executeCommand('pi-sec-review.openFinding', typedMessage.location);
            }
        }));
    }
    pushState(state) {
        void this.panel?.webview.postMessage({ type: 'state', state });
    }
    getHtml(initialMode) {
        const nonce = (0, crypto_1.randomBytes)(16).toString('base64');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root { color-scheme: light dark; --border: var(--vscode-panel-border, #30363d); --muted: var(--vscode-descriptionForeground, #9299a1); --surface: var(--vscode-editorWidget-background, #171b21); --raised: var(--vscode-sideBar-background, #1c2128); --hover: var(--vscode-list-hoverBackground, #252b33); --accent: var(--vscode-focusBorder, #2f81f7); --critical: #f05252; --high: #ff735c; --medium: #e3a72f; --low: #45bd68; --manual: #4094ef; --good: var(--vscode-testing-iconPassed, #45bd68); }
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.55 var(--vscode-font-family); }
button { font: inherit; }
.shell { min-height: 100vh; }
.topbar { position: sticky; top: 0; z-index: 10; min-height: 64px; padding: 0 24px; display: flex; align-items: center; gap: 20px; border-bottom: 1px solid var(--border); background: var(--vscode-editor-background); }
.identity { min-width: 200px; }
.identity strong { display: block; font-size: 15px; }
.identity span { color: var(--muted); font-size: 11px; }
.tabs { align-self: stretch; display: flex; align-items: stretch; }
.tab { position: relative; min-width: 92px; border: 0; color: var(--muted); background: transparent; cursor: pointer; }
.tab:hover { color: var(--vscode-foreground); background: var(--hover); }
.tab.active { color: var(--vscode-foreground); }
.tab.active::after { content: ''; position: absolute; left: 18px; right: 18px; bottom: 0; height: 2px; background: var(--accent); }
.toolbar { margin-left: auto; display: flex; gap: 8px; }
.action { min-height: 30px; padding: 0 12px; border: 1px solid var(--border); border-radius: 4px; color: var(--vscode-foreground); background: var(--raised); cursor: pointer; }
.action:hover { background: var(--hover); }
.action.primary { color: var(--vscode-button-foreground); border-color: var(--vscode-button-border, transparent); background: var(--vscode-button-background); }
.action.primary:hover { background: var(--vscode-button-hoverBackground); }
.action:disabled { opacity: .45; cursor: default; }
.page { display: none; width: min(1180px, calc(100% - 48px)); margin: 0 auto; padding: 24px 0 48px; }
.page.active { display: block; }
.hero { padding: 18px 20px; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.hero h1 { margin: 0 0 5px; font-size: 20px; line-height: 1.3; }
.hero p { margin: 0; color: var(--muted); }
.hero-meta { min-width: 270px; display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 5px 10px; }
.hero-meta dt { color: var(--muted); }
.hero-meta dd { margin: 0; overflow-wrap: anywhere; }
.summary { margin-top: 14px; display: grid; grid-template-columns: repeat(5, minmax(110px, 1fr)); gap: 10px; }
.metric { --metric: var(--muted); padding: 13px 14px; border: 1px solid var(--border); border-top: 2px solid var(--metric); border-radius: 5px; background: var(--surface); }
.metric span { color: var(--muted); }
.metric strong { display: block; margin-top: 6px; color: var(--metric); font-size: 25px; line-height: 1; }
.metric.critical { --metric: var(--critical); } .metric.high { --metric: var(--high); } .metric.medium { --metric: var(--medium); } .metric.low { --metric: var(--low); } .metric.manualReview { --metric: var(--manual); }
.section { margin-top: 22px; }
.section-head { margin-bottom: 10px; display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.section-head h2 { margin: 0; font-size: 16px; }
.section-head span { color: var(--muted); font-size: 12px; }
.finding-list { display: grid; gap: 10px; }
.finding { --severity: var(--muted); padding: 16px 18px; border: 1px solid var(--border); border-left: 3px solid var(--severity); border-radius: 5px; background: var(--surface); }
.finding.critical { --severity: var(--critical); } .finding.high { --severity: var(--high); } .finding.medium { --severity: var(--medium); } .finding.low { --severity: var(--low); }
.finding-head { display: flex; align-items: flex-start; gap: 12px; }
.severity { flex: 0 0 auto; color: var(--severity); font-weight: 650; }
.finding-title { min-width: 0; flex: 1; }
.finding-title strong { display: block; font-size: 14px; }
.finding-title span { color: var(--muted); font-size: 11px; }
.location { flex: 0 1 360px; border: 0; padding: 3px 0; color: var(--vscode-textLink-foreground); background: transparent; text-align: right; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.finding-details { margin-top: 13px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 20px; }
.detail { min-width: 0; }
.detail span { display: block; margin-bottom: 3px; color: var(--muted); font-size: 11px; }
.detail p { margin: 0; overflow-wrap: anywhere; }
.review-list, .coverage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.review-item, .coverage-card { padding: 14px 16px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); }
.review-item strong { display: block; margin-bottom: 5px; }
.review-item p { margin: 4px 0 0; color: var(--muted); }
.coverage-card h3 { margin: 0 0 8px; font-size: 13px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 3px 8px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); background: var(--raised); }
.log-summary { padding: 16px 18px; display: flex; align-items: center; gap: 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); }
.log-progress { flex: 0 0 auto; color: var(--accent); font-size: 30px; font-weight: 650; }
.log-summary-copy { min-width: 0; flex: 1; }
.log-summary-copy strong { display: block; }
.log-summary-copy span { color: var(--muted); }
.log-list { margin-top: 14px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); overflow: hidden; }
.log-row { display: grid; grid-template-columns: 120px 92px minmax(160px, 240px) 70px minmax(0, 1fr); gap: 12px; align-items: start; padding: 13px 16px; border-bottom: 1px solid var(--border); }
.log-row:last-child { border-bottom: 0; }
.log-time, .log-message { color: var(--muted); }
.log-state { color: var(--good); }
.log-state.active { color: var(--accent); } .log-state.error { color: var(--critical); } .log-state.pending { color: var(--muted); }
.empty { min-height: 260px; padding: 48px 24px; display: grid; place-items: center; border: 1px dashed var(--border); border-radius: 6px; color: var(--muted); text-align: center; }
@media (max-width: 820px) { .topbar { padding: 0 14px; flex-wrap: wrap; } .identity { display: none; } .toolbar { margin-left: auto; } .page { width: calc(100% - 28px); } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hero { flex-direction: column; } .hero-meta { width: 100%; } .finding-details, .review-list, .coverage { grid-template-columns: 1fr; } .log-row { grid-template-columns: 92px 70px minmax(0, 1fr); } .log-stage, .log-progress-cell { display: none; } }
</style>
</head>
<body>
<main class="shell">
  <header class="topbar">
    <div class="identity"><strong>安全扫描详情</strong><span id="workspace">未选择工作区</span></div>
    <nav class="tabs" aria-label="详情页面"><button class="tab" data-mode="report">扫描报告</button><button class="tab" data-mode="logs">扫描日志</button></nav>
    <div class="toolbar"><button class="action" id="exportReport">导出报告</button><button class="action primary" id="runReview">开始扫描</button></div>
  </header>
  <section class="page" id="page-report">
    <div id="reportContent"></div>
  </section>
  <section class="page" id="page-logs">
    <div id="logsContent"></div>
  </section>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const severityNames = { critical: '严重', high: '高危', medium: '中危', low: '低危', manualReview: '待复核' };
const severityOrder = ['critical', 'high', 'medium', 'low', 'manualReview'];
const stateNames = { complete: '已完成', active: '进行中', pending: '等待中', error: '失败' };
let currentState;
let currentMode = '${initialMode}';

function formatDate(value, detailed = true) {
  if (!value) return '—';
  const date = new Date(value); if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', detailed ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function node(tag, className, text) {
  const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element;
}

function selectMode(mode, notify = true) {
  currentMode = mode;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
  document.querySelectorAll('.page').forEach(page => page.classList.toggle('active', page.id === 'page-' + mode));
  if (notify) vscode.postMessage({ type: 'selectMode', mode });
}

function appendMeta(root, label, value) {
  root.append(node('dt', '', label), node('dd', '', value));
}

function renderReport(state) {
  const root = byId('reportContent'); root.replaceChildren();
  if (!state.hasResult) {
    const empty = node('div', 'empty'); const copy = node('div'); copy.append(node('strong', '', '尚未生成安全扫描报告'), node('p', '', '完成一次扫描后，这里会展示问题证据、影响、修复建议与覆盖范围。')); empty.append(copy); root.append(empty); return;
  }
  const hero = node('section', 'hero'); const intro = node('div'); intro.append(node('h1', '', '本地安全扫描报告'), node('p', '', state.detail));
  const meta = node('dl', 'hero-meta'); appendMeta(meta, '生成时间', formatDate(state.scanHistory.generatedAt)); appendMeta(meta, '扫描范围', state.report.metadata.scope); appendMeta(meta, '报告结果', state.report.result === 'pass' ? '未发现问题' : state.report.result === 'incomplete' ? '扫描未完全覆盖' : '发现安全问题'); appendMeta(meta, '本地记录', state.scanHistory.storedLocally ? '已保存' : '未保存'); hero.append(intro, meta); root.append(hero);
  const summary = node('div', 'summary'); for (const severity of severityOrder) { const metric = node('div', 'metric ' + severity); metric.append(node('span', '', severityNames[severity]), node('strong', '', String(state.report.counts[severity]))); summary.append(metric); } root.append(summary);

  const findingSection = node('section', 'section'); const findingHead = node('div', 'section-head'); findingHead.append(node('h2', '', '安全发现'), node('span', '', state.report.findings.length + ' 项已确认问题')); findingSection.append(findingHead);
  if (!state.report.findings.length) findingSection.append(node('div', 'empty', '本次扫描未发现已确认的安全问题。'));
  else { const list = node('div', 'finding-list'); for (const finding of state.report.findings) { const card = node('article', 'finding ' + finding.severity); const head = node('div', 'finding-head'); const title = node('div', 'finding-title'); title.append(node('strong', '', finding.id + ' · ' + finding.title), node('span', '', finding.rule + ' · 置信度 ' + finding.confidence)); const location = node('button', 'location', finding.location); location.dataset.location = finding.location; location.title = '打开 ' + finding.location; head.append(node('span', 'severity', severityNames[finding.severity]), title, location); const details = node('div', 'finding-details'); for (const [label, value] of [['证据', finding.evidence], ['影响', finding.impact], ['修复建议', finding.remediation], ['验证方式', finding.verification]]) { const detail = node('div', 'detail'); detail.append(node('span', '', label), node('p', '', value)); details.append(detail); } card.append(head, details); list.append(card); } findingSection.append(list); }
  root.append(findingSection);

  if (state.report.manualReview.length) { const reviewSection = node('section', 'section'); const head = node('div', 'section-head'); head.append(node('h2', '', '待复核项目'), node('span', '', state.report.manualReview.length + ' 项')); const list = node('div', 'review-list'); for (const item of state.report.manualReview) { const card = node('article', 'review-item'); card.append(node('strong', '', item.id + ' · ' + item.title), node('p', '', '规则：' + item.rule), node('p', '', '复核原因：' + item.reason), node('p', '', '所需证据：' + item.requiredEvidence)); list.append(card); } reviewSection.append(head, list); root.append(reviewSection); }

  const coverageSection = node('section', 'section'); const coverageHead = node('div', 'section-head'); coverageHead.append(node('h2', '', '覆盖范围'), node('span', '', '仅展示用户可见的检查范围')); const coverage = node('div', 'coverage'); for (const [title, items] of [['已检查', state.report.coverage.checked], ['未检查', state.report.coverage.notChecked]]) { const card = node('div', 'coverage-card'); card.append(node('h3', '', title)); const tags = node('div', 'tag-list'); if (!items.length) tags.append(node('span', 'tag', '无')); else for (const item of items) tags.append(node('span', 'tag', item)); card.append(tags); coverage.append(card); } coverageSection.append(coverageHead, coverage); root.append(coverageSection);
}

function renderLogs(state) {
  const root = byId('logsContent'); root.replaceChildren();
  const summary = node('section', 'log-summary'); summary.append(node('div', 'log-progress', state.progress + '%'));
  const copy = node('div', 'log-summary-copy'); copy.append(node('strong', '', state.stage), node('span', '', state.detail)); summary.append(copy); const meta = node('dl', 'hero-meta'); appendMeta(meta, '扫描任务', state.taskId || '—'); appendMeta(meta, '记录数量', String(state.timeline.length)); appendMeta(meta, '生成时间', formatDate(state.scanHistory.generatedAt)); summary.append(meta); root.append(summary);
  if (!state.timeline.length) { const empty = node('div', 'empty'); const message = state.hasResult ? '这条历史扫描未保存执行日志；从下一次扫描开始会自动保留。' : '扫描开始后，这里会实时展示用户可见的执行日志。'; empty.append(node('div', '', message)); root.append(empty); return; }
  const list = node('div', 'log-list'); for (const item of state.timeline) { const row = node('div', 'log-row'); row.append(node('span', 'log-time', formatDate(item.timestamp, false)), node('span', 'log-state ' + item.state, stateNames[item.state]), node('strong', 'log-stage', item.label), node('span', 'log-progress-cell', item.progress + '%'), node('span', 'log-message', item.message)); list.append(row); } root.append(list);
}

function render(state) {
  currentState = state; byId('workspace').textContent = state.workspaceLabel || '未选择工作区';
  const run = byId('runReview'); run.disabled = state.status === 'running'; run.textContent = state.status === 'running' ? '扫描进行中' : state.hasResult ? '重新扫描' : '开始扫描';
  byId('exportReport').disabled = !state.hasResult;
  renderReport(state); renderLogs(state);
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => selectMode(tab.dataset.mode)));
byId('runReview').addEventListener('click', () => vscode.postMessage({ type: 'runReview' }));
byId('exportReport').addEventListener('click', () => vscode.postMessage({ type: 'exportReport' }));
byId('reportContent').addEventListener('click', event => { const location = event.target.closest('[data-location]'); if (location?.dataset.location) vscode.postMessage({ type: 'openFinding', location: location.dataset.location }); });
window.addEventListener('message', event => { if (event.data?.type === 'state') render(event.data.state); else if (event.data?.type === 'mode') selectMode(event.data.mode, false); });
selectMode(currentMode, false); vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}
exports.ReviewDetailsPanel = ReviewDetailsPanel;
//# sourceMappingURL=reviewDetailsPanel.js.map