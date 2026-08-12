import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const argumentsList = process.argv.slice(2);
const valueAfter = (name, fallback) => {
	const index = argumentsList.indexOf(name);
	return index >= 0 && argumentsList[index + 1] ? argumentsList[index + 1] : fallback;
};
const host = valueAfter('--host', '127.0.0.1');
const port = Number.parseInt(valueAfter('--port', '4173'), 10);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const panelSource = await readFile(path.join(scriptDirectory, '..', 'src', 'reportPanel.ts'), 'utf8');
const startMarker = 'return `<!DOCTYPE html>';
const endMarker = '</html>`;';
const start = panelSource.indexOf(startMarker);
const end = panelSource.indexOf(endMarker, start);
if (start < 0 || end < 0) {
	throw new Error('Unable to locate the report panel HTML template.');
}

const nonce = 'cHJldmlldy1ub25jZQ==';
let html = panelSource.slice(start + 'return `'.length, end + '</html>'.length).replaceAll('${nonce}', nonce);
html = html.replace(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">`, '');
const demoStyle = `<style nonce="${nonce}">
:root {
  --vscode-foreground: #d6dbe1; --vscode-descriptionForeground: #9299a1; --vscode-panel-background: #11161c;
  --vscode-panel-border: #29313a; --vscode-editorWidget-background: #171d24; --vscode-sideBar-background: #1b222a;
  --vscode-list-hoverBackground: #242d37; --vscode-focusBorder: #3c8df6; --vscode-testing-iconPassed: #45bd68;
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
html, body { min-height: 100%; }
</style>`;
const demoScript = `const demoRows = [
  ['critical', '发现命令注入风险', 'backend/src/controller/user_controller.py:56', 'SHELL-INJECTION', '使用参数化调用并限制允许的命令'],
  ['critical', '检测到硬编码访问凭据', 'backend/src/service/auth_service.py:23', 'HARD-CODED-SECRET', '改用安全的密钥存储并立即轮换'],
  ['high', 'SQL 查询条件由外部输入拼接', 'backend/src/controller/user_controller.py:48', 'SQL-INJECTION', '使用参数化查询并校验输入'],
  ['medium', '文件路径缺少边界校验', 'backend/src/utils/file_helper.py:88', 'PATH-TRAVERSAL', '规范化路径并限制到工作目录'],
  ['low', '日志中可能包含敏感信息', 'backend/src/utils/logger.py:32', 'LOG-SENSITIVE', '脱敏后再写入日志'],
  ['medium', '跨域策略范围过宽', 'backend/src/config/cors.py:17', 'CORS-POLICY', '仅允许可信来源'],
  ['medium', '错误信息包含内部实现细节', 'backend/src/api/errors.py:41', 'ERROR-DISCLOSURE', '对外返回统一错误码']
];
const demoFindings = demoRows.map((row, index) => ({ id: 'SEC-' + String(index + 1).padStart(3, '0'), severity: row[0], title: row[1], location: row[2], rule: row[3], remediation: row[4], impact: row[1] }));
const demoState = {
  status: 'complete', detail: '安全扫描已完成并保存到本机', progress: 100, stage: '扫描完成', workspaceLabel: 'payment-service', taskId: 'scan-local-20260809', timeline: [], hasResult: true, reportMarkdown: '',
  report: {
    schemaVersion: '2.0', metadata: { baseline: 'sec-baseline.md', scope: '本次代码变更', generatedAt: '2026-08-09T14:35:00.000Z' }, result: 'findings',
    counts: { critical: 2, high: 1, medium: 3, low: 1, manualReview: 2 }, findings: demoFindings,
    manualReview: [
      { id: 'CHECK-001', title: '确认生产环境访问控制', rule: 'ACCESS-REVIEW', reason: '需要运行环境信息', requiredEvidence: '补充网关和角色权限配置' },
      { id: 'CHECK-002', title: '确认依赖补丁状态', rule: 'DEPENDENCY-REVIEW', reason: '需要制品信息', requiredEvidence: '补充最终构建清单' }
    ], coverage: { checked: ['代码变更'], notChecked: ['运行环境'], tools: [] }
  },
  scanHistory: { generatedAt: '2026-08-09T14:35:00.000Z', previousGeneratedAt: '2026-08-08T10:00:00.000Z', previousCounts: { critical: 1, high: 2, medium: 3, low: 2, manualReview: 1 }, storedLocally: true }
};
window.acquireVsCodeApi = () => ({
  getState: () => ({}), setState: () => undefined,
  postMessage: message => {
    if (message.type === 'ready') setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: demoState } })), 0);
    if (message.type === 'runReview') {
      const running = { ...demoState, status: 'running', detail: '正在验证代码中的安全风险', progress: 55, stage: '深度安全审计', timeline: [{ label: '收集变更上下文', message: '已完成本地文件读取', progress: 25, state: 'complete' }, { label: '深度安全审计', message: '正在验证跨文件调用链', progress: 55, state: 'active' }] };
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: running } }));
      setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: demoState } })), 1200);
    }
    if (message.type === 'openFinding') document.getElementById('status').textContent = '已请求打开 ' + message.location;
  }
});
`;
const panelScriptOpen = `<script nonce="${nonce}">`;
const panelScriptStart = html.indexOf(panelScriptOpen);
const panelScriptEnd = html.indexOf('</script>', panelScriptStart);
if (panelScriptStart < 0 || panelScriptEnd < 0) {
	throw new Error('Unable to locate the report panel script.');
}
const panelScript = html.slice(panelScriptStart + panelScriptOpen.length, panelScriptEnd);
html = `${html.slice(0, panelScriptStart)}<script src="/panel.js"></script>${html.slice(panelScriptEnd + '</script>'.length)}`;
html = html.replace('<body>', `<body>${demoStyle}<script src="/bootstrap.js"></script>`);
const previewMetrics = [
	['critical', '严重', 2, '较上次增加 1', 'worse'],
	['high', '高危', 1, '较上次减少 1', 'better'],
	['medium', '中危', 3, '较上次无变化', ''],
	['low', '低危', 1, '较上次减少 1', 'better'],
	['manualReview', '待复核', 2, '较上次增加 1', 'worse'],
];
const previewRows = [
	['严重', 'critical', '发现命令注入风险', 'backend/src/controller/user_controller.py:56', 'SHELL-INJECTION', '使用参数化调用并限制允许的命令'],
	['严重', 'critical', '检测到硬编码访问凭据', 'backend/src/service/auth_service.py:23', 'HARD-CODED-SECRET', '改用安全的密钥存储并立即轮换'],
	['高危', 'high', 'SQL 查询条件由外部输入拼接', 'backend/src/controller/user_controller.py:48', 'SQL-INJECTION', '使用参数化查询并校验输入'],
	['中危', 'medium', '文件路径缺少边界校验', 'backend/src/utils/file_helper.py:88', 'PATH-TRAVERSAL', '规范化路径并限制到工作目录'],
	['低危', 'low', '日志中可能包含敏感信息', 'backend/src/utils/logger.py:32', 'LOG-SENSITIVE', '脱敏后再写入日志'],
];
const staticMetrics = previewMetrics.map(([severity, label, count, delta, trend]) => `<div class="metric ${severity}"><span class="metric-label">${label}</span><strong>${count}</strong><span class="metric-delta ${trend}">${delta}</span></div>`).join('');
const staticRows = previewRows.map(([label, severity, title, location, rule, remediation]) => `<tr tabindex="0" data-location="${location}"><td class="severity ${severity}">${label}</td><td title="${title}">${title}</td><td title="${location}">${location}</td><td title="${rule}">${rule}</td><td title="${remediation}">${remediation}</td></tr>`).join('');
const staticTable = `<table><thead><tr><th style="width:10%">严重性</th><th style="width:28%">问题描述</th><th style="width:24%">位置</th><th style="width:16%">规则</th><th style="width:22%">修复建议</th></tr></thead><tbody>${staticRows}</tbody></table>`;
html = html
	.replace('<span class="overview-time" id="scanTime">尚未扫描</span>', '<span class="overview-time" id="scanTime">08/09 22:35</span>')
	.replace('<span id="total">0</span>', '<span id="total">9</span>')
	.replace('<span class="overview-caption" id="overviewCaption">等待本地安全扫描</span>', '<span class="overview-caption" id="overviewCaption">已完成本地安全扫描</span>')
	.replace('<div class="overview-delta" id="overviewDelta">首次扫描后可查看变化</div>', '<div class="overview-delta worse" id="overviewDelta">较上次增加 1</div>')
	.replace('<dd id="workspace">—</dd>', '<dd id="workspace">payment-service</dd>')
	.replace('<dd id="scope">—</dd>', '<dd id="scope">本次代码变更</dd>')
	.replace('<dd id="previousScan">—</dd>', '<dd id="previousScan">08/08 18:00</dd>')
	.replace('<dd id="storage">尚未生成</dd>', '<dd id="storage">已保存</dd>')
	.replace('<div class="summary" id="summary"></div>', `<div class="summary" id="summary">${staticMetrics}</div>`)
	.replace('<span class="findings-status" id="status">尚未扫描</span>', '<span class="findings-status" id="status">安全扫描已完成并保存到本机</span>')
	.replace('<div class="table-wrap" id="tableWrap"></div>', `<div class="table-wrap" id="tableWrap">${staticTable}</div>`)
	.replace('共 <strong>0</strong> 项问题', '共 <strong>9</strong> 项问题（已确认 7，待复核 2）')
	.replace('>开始扫描</button>', '>重新扫描</button>');

const projectRoot = path.join(scriptDirectory, '..', '..');
const server = createServer(async (request, response) => {
	if (request.url === '/compare') {
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
		response.end('<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;background:#080b0f}img{display:block;width:1872px;height:auto}</style></head><body><img src="/source.png" alt="source"><img src="/implementation.png" alt="implementation"></body></html>');
		return;
	}
	if (request.url === '/source.png' || request.url === '/implementation.png') {
		const filename = request.url === '/source.png' ? 'design-qa-source.png' : 'design-qa-implementation.png';
		response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
		response.end(await readFile(path.join(projectRoot, filename)));
		return;
	}
	if (request.url === '/bootstrap.js' || request.url === '/panel.js') {
		response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
		response.end(request.url === '/bootstrap.js' ? demoScript : panelScript);
		return;
	}
	if (request.url !== '/' && request.url !== '/index.html') {
		response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
		response.end('Not found');
		return;
	}
	response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
	response.end(html);
});

server.listen(port, host, () => {
	console.log(`Security scan panel preview listening on http://${host}:${port}`);
});
