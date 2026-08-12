import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Script } from 'vm';
import { invokeReviewAgentTool } from '../agentTools';
import { chatHistoryToMessages } from '../chatHistory';
import { mergeIncrementalReport } from '../currentReport';
import { collectSourceSnapshot, collectWorkspaceContext, findGitRoot, getRepositoryIdentity, truncateReviewInput } from '../gitChanges';
import { extractMarkdownReferences, unpackPlatformSkill } from '../localSkill';
import { platformSkillEndpoint, validatePlatformSkill } from '../platformSkill';
import { platformScanEndpoint, platformScanReportEndpoint, uploadPlatformScanReport, validatePlatformAccessKey } from '../platformScan';
import { createLocalReportArtifact, renderLocalReport } from '../reportArtifact';
import { parseReviewReportJson, reportSourcePaths, validateReviewReportJson } from '../reportJson';
import { ReviewReportPanelProvider } from '../reportPanel';
import { ReviewService } from '../reviewService';
import { ReviewWebviewProvider } from '../reviewWebview';
import { LocalScanHistoryStore, parseLocalScanHistory } from '../scanHistory';

const validReportJson = JSON.stringify({
	schemaVersion: '2.0', metadata: { baseline: 'sec-baseline.md', scope: 'changed files', generatedAt: 'unavailable' }, result: 'pass',
	summary: { critical: 0, high: 0, medium: 0, low: 0, manualReview: 0 }, findings: [], manualReview: [],
	coverage: { checked: ['凭据'], notChecked: ['联网 CVE'], tools: ['workspace search'] },
});

suite('Extension Test Suite', () => {
	test('removes fixed findings from the current incremental report', () => {
		const previous = parseReviewReportJson(JSON.stringify({
			...JSON.parse(validReportJson),
			result: 'findings',
			summary: { critical: 0, high: 1, medium: 1, low: 0, manualReview: 0 },
			findings: [
				{ id: 'SEC-OLD', title: '已修复问题', severity: 'high', rule: 'AUTH-01', locations: [{ path: 'src/auth.ts', line: 8 }], confidence: 'high', evidence: '旧证据', impact: '越权', remediation: '校验权限', verification: '重新扫描' },
				{ id: 'SEC-KEEP', title: '其他问题', severity: 'medium', rule: 'DATA-01', locations: [{ path: 'src/data.ts', line: 3 }], confidence: 'high', evidence: '仍存在', impact: '泄露', remediation: '过滤', verification: '重新扫描' },
			],
		}));
		const incremental = parseReviewReportJson(validReportJson);

		const merged = mergeIncrementalReport(previous, incremental, new Set(['src/auth.ts']));

		assert.deepStrictEqual(merged.findings.map(finding => finding.id), ['SEC-KEEP']);
		assert.strictEqual(merged.counts.high, 0);
		assert.strictEqual(merged.counts.medium, 1);
		assert.strictEqual(merged.result, 'findings');
	});

	test('validates and parses versioned JSON security reports', () => {
		const reportJson = JSON.stringify({
			schemaVersion: '2.0', metadata: { baseline: 'sec-baseline.md', scope: 'changed files', generatedAt: 'unavailable' }, result: 'findings',
			summary: { critical: 1, high: 0, medium: 0, low: 0, manualReview: 0 },
			findings: [{
				id: 'SEC-001', title: '硬编码凭据', severity: 'critical', rule: 'DS-01',
				locations: [{ path: 'server/config.yaml', line: 4 }], confidence: 'high', evidence: '发现凭据字段',
				impact: '凭据泄露', remediation: '轮换并迁移凭据', verification: '运行凭据扫描',
				dataFlow: {
					analysisMethod: 'ai-context',
					nodes: [
						{ kind: 'source', label: '配置输入', path: 'server/config.yaml', line: 4, symbol: 'config', expression: 'credential' },
						{ kind: 'sink', label: '日志输出', path: 'server/log.ts', line: 9, symbol: 'logger.info', expression: 'config.credential' },
					],
					limitations: ['未执行运行时验证'],
				},
			}],
			manualReview: [],
			coverage: { checked: ['凭据'], notChecked: ['联网 CVE'], tools: ['workspace search'] },
		});

		assert.doesNotThrow(() => validateReviewReportJson(reportJson));
		const report = parseReviewReportJson(reportJson);
		assert.strictEqual(report.findings[0].location, 'server/config.yaml:4');
		assert.strictEqual(report.counts.critical, 1);
		assert.strictEqual(report.findings[0].dataFlow?.nodes[1].kind, 'sink');
		assert.deepStrictEqual(reportSourcePaths(report), ['server/config.yaml', 'server/log.ts']);
		assert.throws(() => validateReviewReportJson('```json\n' + reportJson + '\n```'), /合法 JSON/);
		assert.throws(() => validateReviewReportJson(JSON.stringify({ ...JSON.parse(validReportJson), extra: true })), /不支持字段 extra/);
		const incompleteDataFlow = JSON.parse(reportJson);
		incompleteDataFlow.findings[0].dataFlow.nodes = incompleteDataFlow.findings[0].dataFlow.nodes.slice(1);
		assert.throws(() => validateReviewReportJson(JSON.stringify(incompleteDataFlow)), /至少需要 Source 和 Sink/);
	});

	test('normalizes singleton coverage fields from model reports', async () => {
		const report = JSON.parse(validReportJson);
		report.coverage.checked = '凭据';
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				const part = new vscode.LanguageModelTextPart(JSON.stringify(report));
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const service = new ReviewService({ appendLine: () => undefined } as unknown as vscode.OutputChannel);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.deepStrictEqual(JSON.parse(result.json).coverage.checked, ['凭据']);
		} finally {
			tokenSource.dispose();
		}
	});

	test('repairs a report containing artifact-only fields', async () => {
		let requestCount = 0;
		let correctionPrompt = '';
		const invalidReport = JSON.stringify({ ...JSON.parse(validReportJson), reportId: 'artifact-report-id' });
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async (messages: vscode.LanguageModelChatMessage[]) => {
				requestCount += 1;
				if (requestCount === 2) {
					correctionPrompt = (messages[messages.length - 1].content[0] as vscode.LanguageModelTextPart).value;
				}
				const part = new vscode.LanguageModelTextPart(requestCount === 1 ? invalidReport : validReportJson);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.strictEqual(result.json, validReportJson);
			assert.strictEqual(requestCount, 2);
			assert.match(correctionPrompt, /reportId/);
			assert.match(correctionPrompt, /locations 必须是非空 JSON 对象数组/);
		} finally {
			tokenSource.dispose();
		}
	});

	test('allows two bounded repair rounds for successive report format errors', async () => {
		let requestCount = 0;
		const extraFieldReport = JSON.stringify({ ...JSON.parse(validReportJson), unexpected: true });
		const invalidCoverage = JSON.parse(validReportJson);
		invalidCoverage.coverage.checked = 42;
		const invalidCoverageReport = JSON.stringify(invalidCoverage);
		const responses = [extraFieldReport, invalidCoverageReport, validReportJson];
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				const part = new vscode.LanguageModelTextPart(responses[requestCount] ?? validReportJson);
				requestCount += 1;
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.strictEqual(result.json, validReportJson);
			assert.strictEqual(requestCount, 3);
		} finally {
			tokenSource.dispose();
		}
	});

	test('unwraps a fenced JSON report before strict validation', async () => {
		let requestCount = 0;
		const fencedReport = `\`\`\`json\n${validReportJson}\n\`\`\``;
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(fencedReport);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.strictEqual(result.json, validReportJson);
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('normalizes the fixed report baseline before strict validation', async () => {
		let requestCount = 0;
		const report = JSON.parse(validReportJson);
		report.metadata.baseline = 'security-baseline.md';
		const invalidBaselineReport = JSON.stringify(report);
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(invalidBaselineReport);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.strictEqual(JSON.parse(result.json).metadata.baseline, 'sec-baseline.md');
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('removes a misplaced result from summary', async () => {
		let requestCount = 0;
		const report = JSON.parse(validReportJson);
		report.summary.result = report.result;
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(JSON.stringify(report));
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			const normalized = JSON.parse(result.json);
			assert.strictEqual(normalized.result, 'pass');
			assert.ok(!('result' in normalized.summary));
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('normalizes common report schema version variants before strict validation', async () => {
		for (const version of [2, '2', undefined]) {
			let requestCount = 0;
			const report = JSON.parse(validReportJson);
			if (version === undefined) {
				delete report.schemaVersion;
			} else {
				report.schemaVersion = version;
			}
			const model = {
				vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
				countTokens: async () => 1,
				sendRequest: async () => {
					requestCount += 1;
					const part = new vscode.LanguageModelTextPart(JSON.stringify(report));
					return { stream: (async function* () { yield part; })() };
				},
			} as unknown as vscode.LanguageModelChat;
			const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
			const service = new ReviewService(output);
			const tokenSource = new vscode.CancellationTokenSource();

			try {
				const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
				assert.strictEqual(JSON.parse(result.json).schemaVersion, '2.0');
				assert.strictEqual(requestCount, 1);
			} finally {
				tokenSource.dispose();
			}
		}
	});

	test('normalizes a findings result and legacy description field', async () => {
		let requestCount = 0;
		const report = JSON.parse(validReportJson);
		report.result = '';
		report.summary.high = 1;
		report.findings = [{
			id: 'SEC-001', title: '命令注入', severity: 'high', rule: 'IN-01',
			locations: [{ path: 'src/command.ts', line: 10 }], confidence: 'high',
			description: '未经校验的输入进入命令执行函数', impact: '攻击者可以执行任意命令',
			remediation: '使用参数化 API', verification: '运行命令注入测试',
		}];
		const legacyReport = JSON.stringify(report);
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(legacyReport);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			const normalized = JSON.parse(result.json);
			assert.strictEqual(normalized.result, 'findings');
			assert.strictEqual(normalized.findings[0].evidence, report.findings[0].description);
			assert.ok(!('description' in normalized.findings[0]));
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('normalizes common non-object finding locations before strict validation', async () => {
		let requestCount = 0;
		const report = JSON.parse(validReportJson);
		report.result = 'findings';
		report.summary.high = 1;
		report.findings = [{
			id: 'SEC-001', title: '命令注入', severity: 'high', rule: 'IN-01',
			locations: ['src/command.ts:10', { file: 'src/config.ts', lineNumber: '7' }], confidence: 'high', evidence: '外部输入进入命令执行函数',
			impact: '攻击者可以执行任意命令', remediation: '使用参数化 API', verification: '运行命令注入测试',
		}];
		const malformedReport = JSON.stringify(report);
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(malformedReport);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.deepStrictEqual(JSON.parse(result.json).findings[0].locations, [
				{ path: 'src/command.ts', line: 10 },
				{ path: 'src/config.ts', line: 7 },
			]);
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('normalizes source and sink dataFlow objects into ordered nodes', async () => {
		let requestCount = 0;
		const report = JSON.parse(validReportJson);
		report.result = 'findings';
		report.summary.high = 1;
		report.findings = [{
			id: 'SEC-001', title: '命令注入', severity: 'high', rule: 'IN-01',
			locations: [{ path: 'src/command.ts', line: 10 }], confidence: 'high', evidence: '外部输入进入命令执行函数',
			impact: '攻击者可以执行任意命令', remediation: '使用参数化 API', verification: '运行命令注入测试',
			dataFlow: {
				analysisMethod: 'ai-context',
				source: { name: '请求参数', file: 'src/route.ts', lineNumber: '5', functionName: 'handler', variable: 'request.cmd' },
				propagators: [{ type: 'Propagator', label: '参数传递', path: 'src/service.ts', line: 8, symbol: 'run', expression: 'command' }],
				sink: { label: '命令执行', path: 'src/command.ts', line: 10, symbol: 'runCommand', expression: 'runCommand(command)' },
				limitations: [],
			},
		}];
		const malformedReport = JSON.stringify(report);
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = new vscode.LanguageModelTextPart(malformedReport);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			const dataFlow = JSON.parse(result.json).findings[0].dataFlow;
			assert.deepStrictEqual(dataFlow.nodes.map((node: { kind: string }) => node.kind), ['source', 'propagator', 'sink']);
			assert.deepStrictEqual(dataFlow.nodes[0], {
				kind: 'source', label: '请求参数', path: 'src/route.ts', line: 5, symbol: 'handler', expression: 'request.cmd',
			});
			assert.ok(!('source' in dataFlow));
			assert.ok(!('sink' in dataFlow));
			assert.strictEqual(requestCount, 1);
		} finally {
			tokenSource.dispose();
		}
	});

	test('generates an executable review webview script', () => {
		const provider = new ReviewWebviewProvider();
		const html = (provider as unknown as { getHtml(webview: vscode.Webview): string }).getHtml({} as vscode.Webview);
		// codex-security: allow SEC-DYNAMIC-EVAL-001 — this fixed regex only extracts a locally generated test script; it does not execute or interpolate user input.
		const script = /<script nonce="[^"]+">([\s\S]+)<\/script>/.exec(html)?.[1];
		provider.dispose();

		assert.ok(script);
		assert.ok(html.includes('timeline-spinner'));
		assert.ok(html.includes('@keyframes timeline-spin'));
		// codex-security: allow SEC-DYNAMIC-EVAL-001 — test-only syntax validation in an isolated VM; the script is generated by the local extension renderer, not user input.
		assert.doesNotThrow(() => new Script(script));
	});

	test('renders local scan counts and previous-scan comparisons without a score', () => {
		const reviewProvider = new ReviewWebviewProvider();
		const panelProvider = new ReviewReportPanelProvider(reviewProvider);
		const html = (panelProvider as unknown as { getHtml(): string }).getHtml();
		// codex-security: allow SEC-DYNAMIC-EVAL-001 — this fixed regex only extracts a locally generated test script; it does not execute or interpolate user input.
		const script = /<script nonce="[^"]+">([\s\S]+)<\/script>/.exec(html)?.[1];
		panelProvider.dispose();
		reviewProvider.dispose();

		assert.ok(script);
		assert.ok(html.includes('扫描数量概览'));
		assert.ok(html.includes('metric-delta'));
		assert.ok(html.includes('较上次'));
		assert.ok(html.includes('上次扫描'));
		assert.ok(html.includes('本机数据'));
		assert.ok(html.includes('renderTimeline(state.timeline)'));
		assert.ok(html.includes('class="summary"'));
		assert.ok(html.includes('class="findings-footer"'));
		assert.ok(html.includes('renderFindingTotal(state)'));
		assert.ok(html.includes('最近扫描'));
		assert.ok(html.includes('renderHistory(state.scanHistory.entries)'));
		assert.ok(html.includes('历史快照仅代表当时的代码状态'));
		assert.ok(html.includes('当前最新'));
		assert.ok(!html.includes('综合风险评分'));
		assert.ok(!html.includes('riskDetails'));
		assert.ok(!html.includes('规则 / Skill'));
		assert.ok(!html.includes('findingTotal\').innerHTML'));
		// codex-security: allow SEC-DYNAMIC-EVAL-001 — test-only syntax validation in an isolated VM; the script is generated by the local extension renderer, not user input.
		assert.doesNotThrow(() => new Script(script));
	});

	test('stores workspace scan snapshots locally and restores the previous scan', async () => {
		const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-scan-history-'));
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-scan-workspace-'));
		const store = new LocalScanHistoryStore(vscode.Uri.file(storageRoot));
		const first = createLocalReportArtifact({ workspaceLabel: 'fixture', skillPath: 'local', reportJson: validReportJson, now: new Date('2026-08-08T10:00:00.000Z') });
		const second = createLocalReportArtifact({ workspaceLabel: 'fixture', skillPath: 'local', reportJson: validReportJson, now: new Date('2026-08-09T10:00:00.000Z') });

		try {
			const firstRecord = await store.record(vscode.Uri.file(workspaceRoot), first, 'task-1');
			assert.strictEqual(firstRecord.previous, undefined);
			const secondRecord = await store.record(vscode.Uri.file(workspaceRoot), second, 'task-2');
			assert.strictEqual(secondRecord.previous?.reportId, first.reportId);
			assert.ok(secondRecord.storageUri.fsPath.startsWith(path.join(storageRoot, 'scan-history')));

			const restored = await store.load(vscode.Uri.file(workspaceRoot));
			assert.deepStrictEqual(restored.scans.map(scan => scan.taskId), ['task-2', 'task-1']);
			assert.strictEqual(parseLocalScanHistory('not-json', restored.workspaceKey).scans.length, 0);
		} finally {
			rmSync(storageRoot, { recursive: true, force: true });
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('preserves review input within the configured limit', () => {
		assert.strictEqual(truncateReviewInput('security change', 20), 'security change');
	});

	test('marks review input that exceeds the configured limit', () => {
		assert.strictEqual(
			truncateReviewInput('0123456789', 5),
			'01234\n\n[review input truncated; 5 characters omitted]',
		);
	});

	test('validates platform Skill responses and content hashes', () => {
		const content = '# Security Skill';
		const sha256 = require('crypto').createHash('sha256').update(content).digest('hex');
		assert.strictEqual(platformSkillEndpoint('http://localhost:8080').pathname, '/api/v1/plugin/skills/resolve');
		assert.throws(() => platformSkillEndpoint('http://scanner.example.com'), /must use HTTPS/);
		assert.strictEqual(validatePlatformSkill({
			skillId: 1,
			name: 'security-baseline',
			version: sha256.slice(0, 12),
			sha256,
			content,
			expiresAt: '2026-08-07T01:00:00.000Z',
		}).content, content);
		assert.throws(() => validatePlatformSkill({
			skillId: 1,
			name: 'security-baseline',
			version: 'bad',
			sha256: '0'.repeat(64),
			content,
			expiresAt: '2026-08-07T01:00:00.000Z',
		}), /SHA-256/);
	});

	test('extracts local Markdown Skill references', () => {
		assert.deepStrictEqual(
			extractMarkdownReferences('[Baseline](./references/sec-baseline.md)\n[Schema](./schema.json)'),
			['./references/sec-baseline.md'],
		);
	});

	test('unpacks platform Skill references for local persistence', () => {
		assert.deepStrictEqual(unpackPlatformSkill([
			'# Security Skill',
			'',
			'<skill_reference path="references/baseline.md">',
			'# Baseline',
			'</skill_reference>',
		].join('\n')), {
			skill: '# Security Skill\n',
			references: [{ path: 'references/baseline.md', content: '# Baseline' }],
		});
	});

	test('creates confidential local reports', () => {
		const artifact = createLocalReportArtifact({
			workspaceLabel: 'security-plugin',
			skillPath: '.github/skills/security-baseline-review/SKILL.md',
			reportJson: validReportJson,
			now: new Date('2026-08-07T00:00:00.000Z'),
		});

		assert.strictEqual(artifact.schemaVersion, '2.0');
		assert.strictEqual(artifact.dataClassification, 'CONFIDENTIAL');
		assert.ok(renderLocalReport(artifact).includes('# PI 安全审查报告'));
		assert.ok(renderLocalReport(artifact).includes('- 数据分级：CONFIDENTIAL'));
		assert.ok(!renderLocalReport(artifact).includes('Upload:'));

	});

	test('builds secure platform scan endpoints', () => {
		assert.strictEqual(platformScanEndpoint('http://localhost:8081').pathname, '/api/v1/plugin/scans');
		assert.strictEqual(platformScanEndpoint('https://scan.example.com', 'task/1').pathname, '/api/v1/plugin/scans/task%2F1');
		assert.strictEqual(platformScanReportEndpoint('https://scan.example.com', 'task/1').pathname, '/api/v1/plugin/scans/task%2F1/report');
		assert.throws(() => platformScanEndpoint('http://scan.example.com'), /必须使用 HTTPS/);
	});

	test('uploads the source snapshot with the platform report', async () => {
		let requestBody = '';
		const server = http.createServer((request, response) => {
			request.setEncoding('utf8');
			request.on('data', chunk => requestBody += chunk);
			request.on('end', () => {
				response.setHeader('Content-Type', 'application/json');
				response.end(JSON.stringify({ id: 'scan-1', status: 'completed', progress: 100 }));
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		assert.ok(address && typeof address !== 'string');

		try {
			const artifact = createLocalReportArtifact({
				workspaceLabel: 'security-plugin',
				skillPath: '.github/skills/security-baseline-review/SKILL.md',
				reportJson: validReportJson,
			});
			await uploadPlatformScanReport(`http://127.0.0.1:${address.port}`, 'scan-1', artifact, {
				gitStatus: 'M src/extension.ts',
				diff: 'diff --git a/src/extension.ts b/src/extension.ts',
				files: [{ path: 'src/extension.ts', kind: 'changed', content: 'export const enabled = true;\n' }],
			}, { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimated: true }, 'access-key');

			const payload = JSON.parse(requestBody) as { sourceSnapshot: unknown; aiTokenUsage: unknown };
			assert.deepStrictEqual(payload.sourceSnapshot, {
				gitStatus: 'M src/extension.ts',
				diff: 'diff --git a/src/extension.ts b/src/extension.ts',
				files: [{ path: 'src/extension.ts', kind: 'changed', content: 'export const enabled = true;\n' }],
			});
			assert.deepStrictEqual(payload.aiTokenUsage, {
				inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimated: true,
			});
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});

	test('includes platform validation details in report upload errors', async () => {
		const server = http.createServer((_request, response) => {
			response.statusCode = 422;
			response.setHeader('Content-Type', 'application/json');
			response.end(JSON.stringify({ code: 'report_upload_failed', message: 'sourceSnapshot exceeds 24 MiB' }));
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		assert.ok(address && typeof address !== 'string');

		try {
			const artifact = createLocalReportArtifact({
				workspaceLabel: 'security-plugin',
				skillPath: '.github/skills/security-baseline-review/SKILL.md',
				reportJson: validReportJson,
			});
			await assert.rejects(uploadPlatformScanReport(`http://127.0.0.1:${address.port}`, 'scan-1', artifact, {
				gitStatus: 'M src/extension.ts',
				diff: '',
				files: [{ path: 'src/extension.ts', kind: 'changed', content: 'export const enabled = true;\n' }],
			}, { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, estimated: true }), /sourceSnapshot exceeds 24 MiB/);
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});

	test('bounds source snapshots by UTF-8 byte size across files', async () => {
		const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-source-snapshot-'));
		try {
			execFileSync('git', ['init'], { cwd: repositoryRoot });
			writeFileSync(path.join(repositoryRoot, 'first.ts'), '一'.repeat(100));
			writeFileSync(path.join(repositoryRoot, 'second.ts'), '二'.repeat(100));
			const snapshot = await collectSourceSnapshot(repositoryRoot, {
				gitStatus: 'M first.ts\nM second.ts',
				diff: '',
				files: [
					{ path: 'first.ts', kind: 'changed', content: '' },
					{ path: 'second.ts', kind: 'changed', content: '' },
				],
			}, 200);
			const totalBytes = Buffer.byteLength(snapshot.gitStatus)
				+ Buffer.byteLength(snapshot.diff)
				+ snapshot.files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.kind) + Buffer.byteLength(file.content), 0);

			assert.strictEqual(snapshot.files.length, 2);
			assert.ok(snapshot.files.every(file => file.content.endsWith('[truncated for source snapshot upload]')));
			assert.ok(totalBytes <= 200, `snapshot used ${totalBytes} bytes`);

			const tinySnapshot = await collectSourceSnapshot(repositoryRoot, {
				gitStatus: 'M first.ts',
				diff: '',
				files: [{ path: 'first.ts', kind: 'changed', content: '' }],
			}, 30);
			const tinyBytes = Buffer.byteLength(tinySnapshot.gitStatus)
				+ tinySnapshot.files.reduce((total, file) => total + Buffer.byteLength(file.path) + Buffer.byteLength(file.kind) + Buffer.byteLength(file.content), 0);
			assert.ok(tinyBytes <= 30, `tiny snapshot used ${tinyBytes} bytes`);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('prioritizes report and Agent-read evidence files in source snapshots', async () => {
		const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-evidence-snapshot-'));
		try {
			execFileSync('git', ['init'], { cwd: repositoryRoot });
			writeFileSync(path.join(repositoryRoot, 'changed.ts'), 'export const changed = true;\n');
			writeFileSync(path.join(repositoryRoot, 'flow.go'), 'package flow\n\nfunc Sink() {}\n');
			const snapshot = await collectSourceSnapshot(repositoryRoot, {
				gitStatus: 'M changed.ts',
				diff: '',
				files: [{ path: 'changed.ts', kind: 'changed', content: '' }],
			}, 10_000, ['flow.go']);

			assert.deepStrictEqual(snapshot.files.map(file => [file.path, file.kind]), [
				['flow.go', 'evidence'],
				['changed.ts', 'changed'],
			]);
			assert.match(snapshot.files[0].content, /func Sink/);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('validates a platform access key before saving it', async () => {
		const server = http.createServer((request, response) => {
			response.statusCode = request.headers.authorization === 'Bearer valid-key' ? 200 : 401;
			response.end('[]');
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		const platformUrl = `http://127.0.0.1:${address.port}`;

		try {
			await validatePlatformAccessKey(platformUrl, 'valid-key');
			await assert.rejects(validatePlatformAccessKey(platformUrl, 'invalid-key'), /未通过 .* 验证/);
		} finally {
			await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
		}
	});

	test('keeps review Agent tools read-only and inside the workspace', async () => {
		const workspaceRoot = realpathSync(path.join(__dirname, '..', '..'));
		const fixtureRoot = mkdtempSync(path.join(workspaceRoot, '.agent-tools-test-'));
		const fixtureName = path.basename(fixtureRoot);
		const outsideRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-agent-outside-')));
		try {
			writeFileSync(path.join(fixtureRoot, 'source.ts'), 'const marker = "security-needle";\n');
			writeFileSync(path.join(fixtureRoot, 'binary.dat'), Buffer.from([0, 1, 2]));
			writeFileSync(path.join(fixtureRoot, 'large.txt'), 'x'.repeat(30_100));
			writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside workspace\n');
			symlinkSync(path.join(outsideRoot, 'secret.txt'), path.join(fixtureRoot, 'escape.txt'));

			const call = (name: string, input: object) => new vscode.LanguageModelToolCallPart('test-call', name, input);
			const listed = await invokeReviewAgentTool(workspaceRoot, call('list_workspace_files', { glob: `${fixtureName}/**/*` }));
			assert.ok(listed.includes(`${fixtureName}/source.ts`));
			assert.strictEqual(
				await invokeReviewAgentTool(workspaceRoot, call('search_workspace', { query: 'security-needle', glob: `${fixtureName}/**/*` })),
				`${fixtureName}/source.ts:1: const marker = "security-needle";`,
			);
			assert.ok((await invokeReviewAgentTool(workspaceRoot, call('read_workspace_file', { path: `${fixtureName}/large.txt` }))).endsWith('[工具结果已截断]'));
			await assert.rejects(
				invokeReviewAgentTool(workspaceRoot, call('read_workspace_file', { path: `${fixtureName}/binary.dat` })),
				/二进制文件/,
			);
			await assert.rejects(
				invokeReviewAgentTool(workspaceRoot, call('read_workspace_file', { path: `${fixtureName}/escape.txt` })),
				/当前工作区/,
			);
		} finally {
			rmSync(fixtureRoot, { recursive: true, force: true });
			rmSync(outsideRoot, { recursive: true, force: true });
		}
	});

	test('allows more than eight Agent rounds when tools keep producing new evidence', async () => {
		let requestCount = 0;
		const model = {
			vendor: 'test', family: 'test', id: 'test',
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = requestCount <= 8
					? new vscode.LanguageModelToolCallPart(`call-${requestCount}`, 'unsupported_test_tool', { requestCount })
					: new vscode.LanguageModelTextPart(validReportJson);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const output = { appendLine: () => undefined } as unknown as vscode.OutputChannel;
		const service = new ReviewService(output);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, process.cwd(), tokenSource.token);
			assert.strictEqual(result.json, validReportJson);
			assert.strictEqual(requestCount, 9);
		} finally {
			tokenSource.dispose();
		}
	});

	test('records workspace files whose contents were returned to the review Agent', async () => {
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'pi-agent-accessed-'));
		writeFileSync(path.join(workspaceRoot, 'flow.go'), 'package flow\n');
		let requestCount = 0;
		const model = {
			vendor: 'test', family: 'test', id: 'test', maxInputTokens: 100_000,
			countTokens: async () => 1,
			sendRequest: async () => {
				requestCount += 1;
				const part = requestCount === 1
					? new vscode.LanguageModelToolCallPart('read-flow', 'read_workspace_file', { path: './flow.go' })
					: new vscode.LanguageModelTextPart(validReportJson);
				return { stream: (async function* () { yield part; })() };
			},
		} as unknown as vscode.LanguageModelChat;
		const service = new ReviewService({ appendLine: () => undefined } as unknown as vscode.OutputChannel);
		const tokenSource = new vscode.CancellationTokenSource();

		try {
			const result = await service.review(model, '# Skill', { gitStatus: '', diff: '', files: [] }, workspaceRoot, tokenSource.token);
			assert.deepStrictEqual(result.accessedFiles, ['flow.go']);
		} finally {
			tokenSource.dispose();
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('converts participant history into bounded model messages', () => {
		const requestTurn = Object.assign(Object.create(vscode.ChatRequestTurn.prototype), { prompt: '解释第一个问题' }) as vscode.ChatRequestTurn;
		const responseTurn = Object.assign(Object.create(vscode.ChatResponseTurn.prototype), {
			response: [new vscode.ChatResponseMarkdownPart('这是上一轮结论。')],
		}) as vscode.ChatResponseTurn;
		const messages = chatHistoryToMessages([requestTurn, responseTurn]);

		assert.strictEqual(messages.length, 2);
		assert.strictEqual(messages[0].role, vscode.LanguageModelChatMessageRole.User);
		assert.strictEqual(messages[1].role, vscode.LanguageModelChatMessageRole.Assistant);
		assert.strictEqual((messages[1].content[0] as vscode.LanguageModelTextPart).value, '这是上一轮结论。');
	});

	test('resolves the Git root from nested folders and files', async () => {
		const repositoryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-sec-review-')));
		const nestedFolder = path.join(repositoryRoot, 'src');
		const nestedFile = path.join(nestedFolder, 'extension.ts');
		try {
			execFileSync('git', ['init', repositoryRoot]);
			mkdirSync(nestedFolder);
			writeFileSync(nestedFile, 'export {};\n');

			assert.strictEqual(await findGitRoot(nestedFolder), repositoryRoot);
			assert.strictEqual(await findGitRoot(nestedFile), repositoryRoot);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('explains how to prepare a non-Git workspace for scanning', async () => {
		const workspaceRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-sec-non-git-')));
		try {
			await assert.rejects(
				getRepositoryIdentity(workspaceRoot, 'Non-Git Fixture'),
				(error: Error) => /不是 Git 仓库/.test(error.message) && /git init/.test(error.message),
			);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('uses local workspace identity when a repository has no origin', async () => {
		const repositoryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-sec-identity-')));
		try {
			execFileSync('git', ['init', repositoryRoot]);
			execFileSync('git', ['-C', repositoryRoot, 'config', 'user.email', 'test@example.com']);
			execFileSync('git', ['-C', repositoryRoot, 'config', 'user.name', 'Test']);
			writeFileSync(path.join(repositoryRoot, 'README.md'), '# Fixture\n');
			execFileSync('git', ['-C', repositoryRoot, 'add', '.']);
			execFileSync('git', ['-C', repositoryRoot, 'commit', '-m', 'fixture']);
			const identity = await getRepositoryIdentity(repositoryRoot, 'Local Fixture');
			assert.strictEqual(identity.repositoryUrl, 'workspace://local/Local%20Fixture');
			assert.ok(identity.gitRef);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('collects changed files, related tests, and root configuration within a budget', async () => {
		const repositoryRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pi-sec-context-')));
		try {
			execFileSync('git', ['init', repositoryRoot]);
			execFileSync('git', ['-C', repositoryRoot, 'config', 'user.email', 'test@example.com']);
			execFileSync('git', ['-C', repositoryRoot, 'config', 'user.name', 'Test']);
			mkdirSync(path.join(repositoryRoot, 'src'));
			writeFileSync(path.join(repositoryRoot, 'src', 'helper.ts'), 'export function secure(value: boolean) { return value; }\n');
			writeFileSync(path.join(repositoryRoot, 'src', 'auth.ts'), 'import { secure } from "./helper";\nexport const result = secure(true);\n');
			writeFileSync(path.join(repositoryRoot, 'src', 'auth.test.ts'), 'test("auth", () => {});\n');
			writeFileSync(path.join(repositoryRoot, 'package.json'), '{"name":"fixture"}\n');
			execFileSync('git', ['-C', repositoryRoot, 'add', '.']);
			execFileSync('git', ['-C', repositoryRoot, 'commit', '-m', 'fixture']);
			writeFileSync(path.join(repositoryRoot, 'src', 'auth.ts'), 'import { secure } from "./helper";\nexport const result = secure(false);\n');

			const context = await collectWorkspaceContext(repositoryRoot, 20_000);
			assert.ok(context.diff.includes('secure(false)'));
			assert.deepStrictEqual(context.files.map(file => [file.path, file.kind]), [
				['src/auth.ts', 'changed'],
				['src/auth.test.ts', 'test'],
				['package.json', 'config'],
			]);
			assert.strictEqual(context.analysisContext?.method, 'typescript-compiler-api');
			assert.ok(context.analysisContext?.callEdges.some(edge => edge.callee.path === 'src/helper.ts' && edge.callee.symbol === 'secure'));
			assert.ok(JSON.stringify(context).length < 21_000);
		} finally {
			rmSync(repositoryRoot, { recursive: true, force: true });
		}
	});

	test('registers the public review commands', async () => {
		const extension = vscode.extensions.all.find(candidate => candidate.packageJSON.name === 'pi-sec-review');
		assert.ok(extension, 'Development extension was not loaded');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('pi-sec-review.runReview'));
		assert.ok(commands.includes('pi-sec-review.runFullReview'));
		assert.ok(commands.includes('pi-sec-review.runIncrementalReview'));
		assert.ok(commands.includes('pi-sec-review.openLastResult'));
		assert.ok(commands.includes('pi-sec-review.exportLastResult'));
		assert.ok(commands.includes('pi-sec-review.openFinding'));
		assert.ok(commands.includes('pi-sec-review.openHistoryResult'));
		assert.ok(commands.includes('piSecReview.view.focus'));
		assert.ok(commands.includes('piSecReview.resultsView.focus'));
	});

	test('contributes an unconditional review submenu to resource context menus', () => {
		const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
		const submenu = manifest.contributes.submenus?.find((entry: { id: string }) => entry.id === 'piSecReview.context');
		assert.ok(submenu, 'PI Security Review submenu is missing');

		for (const menuId of ['explorer/context', 'editor/context']) {
			const entry = manifest.contributes.menus[menuId]
				.find((item: { submenu?: string }) => item.submenu === 'piSecReview.context');
			assert.ok(entry, `${menuId} does not contain the review submenu`);
			assert.strictEqual(entry.when, undefined, `${menuId} review submenu must be unconditional`);
		}

		const reviewCommands = manifest.contributes.menus['piSecReview.context'].map((item: { command: string }) => item.command);
		assert.deepStrictEqual(reviewCommands, [
			'pi-sec-review.runFullReview',
			'pi-sec-review.runIncrementalReview',
		]);
	});

	test('contributes local Skill and Chat participant configuration', () => {
		const manifest = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
		assert.strictEqual(manifest.contributes.views['pi-sec-review'][0].type, 'webview');
		assert.strictEqual(manifest.contributes.views['pi-sec-review-results'][0].type, 'webview');
		assert.strictEqual(manifest.contributes.viewsContainers.panel[0].id, 'pi-sec-review-results');
		assert.strictEqual(
			manifest.contributes.configuration.properties['piSecReview.skillPath'].default,
			'.github/skills/security-baseline-review/SKILL.md',
		);
		assert.strictEqual(
			manifest.contributes.configuration.properties['piSecReview.platformUrl'].default,
			'http://localhost:8081',
		);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.remoteSkillUrl'], undefined);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.uploadEndpoint'], undefined);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.modelFamily'], undefined);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.maxDiffCharacters'], undefined);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.maxContextCharacters'].type, 'number');
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.autoIncrementalScan.enabled'].default, true);
		assert.strictEqual(manifest.contributes.configuration.properties['piSecReview.autoIncrementalScan.debounceSeconds'].default, 5);
		assert.strictEqual(manifest.contributes.chatParticipants[0].id, 'pi-sec-review.chatParticipant');
		assert.strictEqual(manifest.contributes.chatParticipants[0].name, 'pi-security');
		assert.strictEqual(
			manifest.contributes.commands.find((command: { command: string }) => command.command === 'pi-sec-review.runReview').title,
			'Run Security Review',
		);
		assert.strictEqual(
			manifest.contributes.commands.find((command: { command: string }) => command.command === 'pi-sec-review.setPlatformToken').title,
			'配置扫描接入密钥',
		);
	});
});
