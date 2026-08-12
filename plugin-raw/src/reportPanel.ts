import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import { ReviewUiState, ReviewWebviewProvider } from './reviewWebview';

export class ReviewReportPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	private view: vscode.WebviewView | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly reviewState: ReviewWebviewProvider) {
		this.disposables.push(reviewState.onDidChangeState(state => this.pushState(state)));
	}

	resolveWebviewView(view: vscode.WebviewView): void {
		this.view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [] };
		view.webview.html = this.getHtml();
		this.disposables.push(view.webview.onDidReceiveMessage(async (message: unknown) => {
			if (!message || typeof message !== 'object' || !('type' in message)) {
				return;
			}
      const typedMessage = message as { type: string; location?: unknown; reportId?: unknown };
			if (typedMessage.type === 'ready') {
				this.pushState(this.reviewState.getState());
			} else if (typedMessage.type === 'runReview') {
				await vscode.commands.executeCommand('pi-sec-review.runReview');
			} else if (typedMessage.type === 'openReport') {
				await vscode.commands.executeCommand('pi-sec-review.openLastResult');
			} else if (typedMessage.type === 'exportReport') {
				await vscode.commands.executeCommand('pi-sec-review.exportLastResult');
      } else if (typedMessage.type === 'selectHistory' && typeof typedMessage.reportId === 'string') {
        await vscode.commands.executeCommand('pi-sec-review.openHistoryResult', typedMessage.reportId);
			} else if (typedMessage.type === 'openFinding' && typeof typedMessage.location === 'string') {
				await vscode.commands.executeCommand('pi-sec-review.openFinding', typedMessage.location);
			}
		}));
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private pushState(state: ReviewUiState): void {
		void this.view?.webview.postMessage({ type: 'state', state });
	}

	private getHtml(): string {
		const nonce = randomBytes(16).toString('base64');
		return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
:root { color-scheme: light dark; --border: var(--vscode-panel-border, #30363d); --muted: var(--vscode-descriptionForeground, #9299a1); --surface: var(--vscode-editorWidget-background, #171b21); --surface-raised: var(--vscode-sideBar-background, #1c2128); --hover: var(--vscode-list-hoverBackground, #252b33); --critical: #f05252; --high: #ff735c; --medium: #e3a72f; --low: #45bd68; --manual: #4094ef; --accent: var(--vscode-focusBorder, #2f81f7); --good: var(--vscode-testing-iconPassed, #3fb950); }
* { box-sizing: border-box; }
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-panel-background); font: 12px/1.45 var(--vscode-font-family); }
button { font: inherit; }
.dashboard { min-width: 760px; min-height: 100%; padding: 12px; display: grid; grid-template-columns: 210px minmax(520px, 1fr); gap: 12px; }
.sidebar { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.overview { min-height: 284px; padding: 15px; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); }
.overview-label { font-size: 13px; font-weight: 600; }
.overview-time { margin-top: 3px; color: var(--muted); font-size: 11px; }
.overview-total { margin-top: 22px; color: var(--vscode-foreground); font-size: 42px; line-height: 1; font-weight: 650; }
.overview-total small { margin-left: 5px; color: var(--muted); font-size: 12px; font-weight: 400; }
.overview-caption { margin-top: 8px; color: var(--muted); }
.overview-delta { margin-top: 18px; padding: 9px 10px; border-left: 2px solid var(--border); background: var(--surface-raised); }
.overview-delta.worse { border-left-color: var(--critical); color: var(--critical); }
.overview-delta.better { border-left-color: var(--good); color: var(--good); }
.overview-meta { margin: auto 0 0; padding-top: 13px; display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 5px 8px; border-top: 1px solid var(--border); }
.overview-meta dt { color: var(--muted); }
.overview-meta dd { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history { min-height: 0; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); overflow: hidden; }
.history-head { padding: 9px 11px; border-bottom: 1px solid var(--border); font-size: 12px; font-weight: 600; }
.history-list { max-height: 180px; overflow: auto; }
.history-item { width: 100%; min-height: 42px; padding: 7px 10px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; border: 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent); color: var(--vscode-foreground); background: transparent; text-align: left; cursor: pointer; }
.history-item:hover { background: var(--hover); }
.history-item.active { box-shadow: inset 2px 0 var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.history-time { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-count { grid-row: span 2; align-self: center; font-weight: 600; }
.history-task { color: var(--muted); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.content { min-width: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; }
.summary { display: grid; grid-template-columns: repeat(5, minmax(88px, 1fr)); gap: 9px; }
.metric { --metric-color: var(--muted); min-height: 92px; padding: 11px 12px; border: 1px solid var(--border); border-top: 2px solid var(--metric-color); border-radius: 5px; background: var(--surface); }
.metric-label { color: var(--vscode-foreground); font-size: 12px; font-weight: 600; }
.metric strong { display: block; margin-top: 7px; color: var(--metric-color); font-size: 27px; line-height: 1; font-weight: 650; }
.metric-delta { display: block; margin-top: 7px; color: var(--muted); font-size: 11px; }
.metric-delta.worse { color: var(--critical); } .metric-delta.better { color: var(--good); }
.metric.critical { --metric-color: var(--critical); } .metric.high { --metric-color: var(--high); } .metric.medium { --metric-color: var(--medium); } .metric.low { --metric-color: var(--low); } .metric.manualReview { --metric-color: var(--manual); }
.findings { min-width: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); overflow: hidden; }
.findings-head { min-height: 38px; padding: 8px 12px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--border); }
.findings-title { font-size: 13px; font-weight: 600; }
.findings-status { min-width: 0; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-notice { padding: 8px 12px; border-bottom: 1px solid color-mix(in srgb, var(--medium) 55%, var(--border)); color: var(--vscode-foreground); background: color-mix(in srgb, var(--medium) 12%, var(--surface)); }
.history-notice[hidden] { display: none; }
.local-badge { margin-left: auto; flex: 0 0 auto; padding: 2px 7px; border: 1px solid var(--border); border-radius: 10px; color: var(--muted); font-size: 11px; }
.findings-footer { min-height: 42px; padding: 7px 10px 7px 12px; display: flex; align-items: center; justify-content: space-between; gap: 14px; border-top: 1px solid var(--border); }
.finding-total { color: var(--muted); }
.finding-total strong { color: var(--vscode-foreground); font-weight: 600; }
.actions { display: flex; gap: 7px; }
.action { min-height: 28px; padding: 0 11px; border: 1px solid var(--border); border-radius: 4px; color: var(--vscode-foreground); background: var(--surface-raised); cursor: pointer; white-space: nowrap; }
.action:hover { background: var(--hover); }
.action.primary { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 16%, var(--surface-raised)); }
.action:disabled { opacity: .45; cursor: default; }
.table-wrap { max-height: 208px; overflow: auto; }
table { width: 100%; min-width: 820px; border-collapse: collapse; table-layout: fixed; }
th { position: sticky; top: 0; z-index: 1; padding: 8px 10px; color: var(--muted); background: var(--surface-raised); border-bottom: 1px solid var(--border); text-align: left; font-weight: 500; }
td { height: 38px; padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tbody tr[data-location] { cursor: pointer; }
tbody tr:hover, tbody tr:focus { outline: none; background: var(--hover); }
.severity { color: var(--severity-color); font-weight: 600; }
.severity.critical { --severity-color: var(--critical); } .severity.high { --severity-color: var(--high); } .severity.medium { --severity-color: var(--medium); } .severity.low { --severity-color: var(--low); } .severity.manualReview { --severity-color: var(--manual); }
.empty { min-height: 130px; padding: 28px; display: grid; place-items: center; color: var(--muted); text-align: center; }
.running { width: min(460px, 90%); }
.running-copy { display: flex; justify-content: space-between; gap: 12px; }
.progress-track { height: 4px; margin-top: 10px; overflow: hidden; background: var(--border); }
.progress-bar { width: 0; height: 100%; background: var(--accent); transition: width .2s ease; }
.scan-timeline { margin-top: 18px; text-align: left; }
.scan-step { position: relative; min-height: 46px; padding: 0 0 14px 28px; }
.scan-step::before { content: ''; position: absolute; left: 8px; top: 18px; bottom: -2px; width: 1px; background: var(--border); }
.scan-step:last-child::before { display: none; }
.scan-step-state { position: absolute; left: 0; top: 0; width: 17px; color: var(--muted); font-size: 11px; text-align: center; }
.scan-step.complete .scan-step-state { color: var(--good); } .scan-step.active .scan-step-state { color: var(--accent); }
.scan-step-head { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
.scan-step-message { margin-top: 2px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
@media (max-width: 940px) { .dashboard { grid-template-columns: 185px minmax(520px, 1fr); } .summary { grid-template-columns: repeat(5, minmax(82px, 1fr)); } }
</style>
</head>
<body>
<main class="dashboard">
  <div class="sidebar">
  <section class="overview" aria-label="扫描数量概览">
    <span class="overview-label" id="overviewLabel">本次扫描</span>
    <span class="overview-time" id="scanTime">尚未扫描</span>
    <div class="overview-total"><span id="total">0</span><small id="totalUnit">项问题</small></div>
    <span class="overview-caption" id="overviewCaption">等待本地安全扫描</span>
    <div class="overview-delta" id="overviewDelta">首次扫描后可查看变化</div>
    <dl class="overview-meta"><dt>工作区</dt><dd id="workspace">—</dd><dt>扫描范围</dt><dd id="scope">—</dd><dt>上次扫描</dt><dd id="previousScan">—</dd><dt>本地记录</dt><dd id="storage">尚未生成</dd></dl>
  </section>
  <section class="history" aria-label="最近扫描"><header class="history-head">最近扫描</header><div class="history-list" id="historyList"></div></section>
  </div>
  <section class="content">
    <div class="summary" id="summary"></div>
    <div class="findings">
      <header class="findings-head"><span class="findings-title">安全发现</span><span class="findings-status" id="status">尚未扫描</span><span class="local-badge" id="localBadge">本机数据</span></header>
      <div class="history-notice" id="historyNotice" hidden>历史快照仅代表当时的代码状态，其中的问题可能已在后续修改中修复。请切换到“当前最新”确认现状。</div>
      <div class="table-wrap" id="tableWrap"></div>
      <footer class="findings-footer"><span class="finding-total" id="findingTotal">共 <strong>0</strong> 项问题</span><div class="actions"><button class="action primary" id="run">开始扫描</button><button class="action" id="openReport">查看报告</button><button class="action" id="exportReport">导出报告</button></div></footer>
    </div>
  </section>
</main>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const severityNames = { critical: '严重', high: '高危', medium: '中危', low: '低危', manualReview: '待复核' };
const metricOrder = ['critical', 'high', 'medium', 'low', 'manualReview'];

function issueTotal(counts) {
  return metricOrder.reduce((total, severity) => total + counts[severity], 0);
}

function deltaCopy(current, previous) {
  if (previous === undefined) return { text: '首次扫描，暂无对比', className: '' };
  const difference = current - previous;
  if (difference > 0) return { text: '较上次增加 ' + difference, className: 'worse' };
  if (difference < 0) return { text: '较上次减少 ' + Math.abs(difference), className: 'better' };
  return { text: '较上次无变化', className: '' };
}

function formatTime(value) {
  if (!value) return '尚未扫描';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function isLatestReport(state) {
  return !state.hasResult || state.scanHistory.entries[0]?.reportId === state.scanHistory.selectedReportId;
}

function renderOverview(state) {
  const counts = state.report.counts;
  const currentTotal = issueTotal(counts);
  const previousCounts = state.scanHistory.previousCounts;
  const comparison = deltaCopy(currentTotal, previousCounts ? issueTotal(previousCounts) : undefined);
  const latest = isLatestReport(state);
  byId('overviewLabel').textContent = state.status === 'running' ? '扫描进度' : latest ? '当前最新扫描' : '历史扫描';
  byId('scanTime').textContent = state.status === 'running' ? state.stage : formatTime(state.scanHistory.generatedAt);
  byId('total').textContent = String(state.status === 'running' ? state.progress : currentTotal);
  byId('totalUnit').textContent = state.status === 'running' ? '%' : '项问题';
  byId('overviewCaption').textContent = state.status === 'running' ? state.detail : state.hasResult ? latest ? '当前代码的最新扫描结果' : '该时间点保存的扫描快照' : '等待本地安全扫描';
  const delta = byId('overviewDelta'); delta.textContent = state.status === 'running' ? '扫描完成后将更新本地记录' : comparison.text; delta.className = 'overview-delta ' + comparison.className;
  byId('workspace').textContent = state.workspaceLabel || '—';
  byId('scope').textContent = state.hasResult ? state.report.metadata.scope : '—';
  byId('previousScan').textContent = state.scanHistory.previousGeneratedAt ? formatTime(state.scanHistory.previousGeneratedAt) : state.hasResult ? '首次扫描' : '—';
  byId('storage').textContent = state.scanHistory.storedLocally ? '已保存' : '尚未生成';
}

function renderSummary(state) {
  const root = byId('summary'); root.replaceChildren();
  const previousCounts = state.scanHistory.previousCounts;
  for (const severity of metricOrder) {
    const metric = document.createElement('div'); metric.className = 'metric ' + severity;
    const label = document.createElement('span'); label.className = 'metric-label'; label.textContent = severityNames[severity];
    const count = document.createElement('strong'); count.textContent = String(state.report.counts[severity]);
    const comparison = deltaCopy(state.report.counts[severity], previousCounts?.[severity]);
    const delta = document.createElement('span'); delta.className = 'metric-delta ' + comparison.className; delta.textContent = comparison.text;
    metric.append(label, count, delta); root.append(metric);
  }
}

function renderFindingTotal(state) {
  const root = byId('findingTotal');
  const total = document.createElement('strong'); total.textContent = String(issueTotal(state.report.counts));
  root.replaceChildren('共 ', total, ' 项问题（已确认 ' + state.report.findings.length + '，待复核 ' + state.report.manualReview.length + '）');
}

function renderHistory(entries) {
  const root = byId('historyList'); root.replaceChildren();
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '暂无本地扫描记录'; root.append(empty); return; }
  for (const [index, entry] of entries.entries()) {
    const item = document.createElement('button'); item.className = 'history-item' + (entry.reportId === currentState.scanHistory.selectedReportId ? ' active' : ''); item.dataset.reportId = entry.reportId;
    const time = document.createElement('span'); time.className = 'history-time'; time.textContent = formatTime(entry.generatedAt);
    const count = document.createElement('span'); count.className = 'history-count'; count.textContent = issueTotal(entry.counts) + ' 项';
    const task = document.createElement('span'); task.className = 'history-task'; task.textContent = (index === 0 ? '当前最新 · ' : '') + entry.taskId;
    item.append(time, count, task); root.append(item);
  }
}

function renderTimeline(items) {
  const timeline = document.createElement('div'); timeline.className = 'scan-timeline';
  for (const item of items) {
    const step = document.createElement('div'); step.className = 'scan-step ' + item.state;
    const marker = document.createElement('span'); marker.className = 'scan-step-state'; marker.textContent = item.state === 'complete' ? '完成' : item.state === 'active' ? '进行' : '等待';
    const head = document.createElement('div'); head.className = 'scan-step-head';
    const label = document.createElement('span'); label.textContent = item.label;
    const progress = document.createElement('span'); progress.textContent = item.progress + '%';
    const message = document.createElement('div'); message.className = 'scan-step-message'; message.textContent = item.message;
    head.append(label, progress); step.append(marker, head, message); timeline.append(step);
  }
  return timeline;
}

function appendCell(row, value, className) {
  const cell = document.createElement('td'); cell.textContent = value || '—'; cell.title = value || ''; if (className) cell.className = className; row.append(cell);
}

function renderFindings(state) {
  const root = byId('tableWrap'); root.replaceChildren();
  if (state.status === 'running') {
    const empty = document.createElement('div'); empty.className = 'empty';
    const running = document.createElement('div'); running.className = 'running';
    const copy = document.createElement('div'); copy.className = 'running-copy';
    const stage = document.createElement('span'); stage.textContent = state.stage;
    const percent = document.createElement('span'); percent.textContent = state.progress + '%';
    const track = document.createElement('div'); track.className = 'progress-track'; track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuenow', String(state.progress)); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
    const bar = document.createElement('div'); bar.className = 'progress-bar'; bar.style.width = state.progress + '%';
    copy.append(stage, percent); track.append(bar); running.append(copy, track, renderTimeline(state.timeline)); empty.append(running); root.append(empty); return;
  }
  if (!state.hasResult || issueTotal(state.report.counts) === 0) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = state.hasResult ? (isLatestReport(state) ? '当前最新扫描未发现安全问题' : '该次历史扫描未发现安全问题') : '完成扫描后将在这里展示本机保存的安全发现'; root.append(empty); return;
  }
  const table = document.createElement('table');
  const head = document.createElement('thead'); const headRow = document.createElement('tr');
  for (const [label, width] of [['严重性', '10%'], ['问题描述', '28%'], ['位置', '24%'], ['规则', '16%'], ['修复建议', '22%']]) {
    const cell = document.createElement('th'); cell.textContent = label; cell.style.width = width; headRow.append(cell);
  }
  head.append(headRow); table.append(head);
  const body = document.createElement('tbody');
  for (const finding of state.report.findings) {
    const row = document.createElement('tr'); row.tabIndex = 0; row.dataset.location = finding.location; row.title = '打开 ' + finding.location;
    appendCell(row, severityNames[finding.severity], 'severity ' + finding.severity); appendCell(row, finding.title || finding.impact); appendCell(row, finding.location); appendCell(row, finding.rule); appendCell(row, finding.remediation); body.append(row);
  }
  for (const item of state.report.manualReview) {
    const row = document.createElement('tr');
    appendCell(row, severityNames.manualReview, 'severity manualReview'); appendCell(row, item.title); appendCell(row, '需要补充证据'); appendCell(row, item.rule); appendCell(row, item.requiredEvidence); body.append(row);
  }
  table.append(body); root.append(table);
}

function render(state) {
  currentState = state;
  byId('status').textContent = state.detail;
  byId('localBadge').hidden = !state.scanHistory.storedLocally;
  byId('historyNotice').hidden = state.status === 'running' || isLatestReport(state);
  renderOverview(state); renderSummary(state); renderFindingTotal(state); renderFindings(state); renderHistory(state.scanHistory.entries);
  const run = byId('run'); run.disabled = state.status === 'running'; run.textContent = state.status === 'running' ? '扫描中' : state.hasResult ? '重新扫描' : '开始扫描';
  byId('openReport').disabled = !state.hasResult; byId('exportReport').disabled = !state.hasResult;
}

let currentState;
byId('run').addEventListener('click', () => vscode.postMessage({ type: 'runReview' }));
byId('openReport').addEventListener('click', () => vscode.postMessage({ type: 'openReport' }));
byId('exportReport').addEventListener('click', () => vscode.postMessage({ type: 'exportReport' }));
byId('tableWrap').addEventListener('click', event => { const row = event.target.closest('tr[data-location]'); if (row?.dataset.location) vscode.postMessage({ type: 'openFinding', location: row.dataset.location }); });
byId('tableWrap').addEventListener('keydown', event => { if (event.key !== 'Enter' && event.key !== ' ') return; const row = event.target.closest('tr[data-location]'); if (row?.dataset.location) vscode.postMessage({ type: 'openFinding', location: row.dataset.location }); });
byId('historyList').addEventListener('click', event => { const item = event.target.closest('button[data-report-id]'); if (item?.dataset.reportId) vscode.postMessage({ type: 'selectHistory', reportId: item.dataset.reportId }); });
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
	}
}
