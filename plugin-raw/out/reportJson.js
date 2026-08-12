"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportJsonSchemaVersion = void 0;
exports.parseReviewReportJson = parseReviewReportJson;
exports.validateReviewReportJson = validateReviewReportJson;
exports.reportSourcePaths = reportSourcePaths;
exports.renderReviewReportMarkdown = renderReviewReportMarkdown;
exports.reportJsonSchemaVersion = '2.0';
const severities = new Set(['critical', 'high', 'medium', 'low']);
const confidences = new Set(['high', 'medium', 'low']);
const results = new Set(['pass', 'findings', 'incomplete']);
function record(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} 必须为 JSON 对象`);
    }
    return value;
}
function exactKeys(value, name, allowed) {
    const unknown = Object.keys(value).find(key => !allowed.includes(key));
    if (unknown) {
        throw new Error(`${name} 包含不支持字段 ${unknown}`);
    }
}
function text(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${name} 必须为非空字符串`);
    }
    return value.trim();
}
function integer(value, name) {
    if (!Number.isSafeInteger(value) || Number(value) < 0) {
        throw new Error(`${name} 必须为非负整数`);
    }
    return Number(value);
}
function stringList(value, name) {
    if (!Array.isArray(value)) {
        throw new Error(`${name} 必须为字符串数组`);
    }
    return value.map((item, index) => text(item, `${name}[${index}]`));
}
function parseLocation(value, name) {
    const location = record(value, name);
    exactKeys(location, name, ['path', 'line']);
    const path = text(location.path, `${name}.path`);
    if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
        throw new Error(`${name}.path 必须为仓库相对 POSIX 路径`);
    }
    const line = integer(location.line, `${name}.line`);
    if (line < 1) {
        throw new Error(`${name}.line 必须为正整数`);
    }
    return { path, line };
}
function parseDataFlow(value, name) {
    const dataFlow = record(value, name);
    exactKeys(dataFlow, name, ['analysisMethod', 'nodes', 'limitations']);
    const analysisMethod = text(dataFlow.analysisMethod, `${name}.analysisMethod`);
    if (analysisMethod !== 'ai-context' && analysisMethod !== 'ast-assisted') {
        throw new Error(`${name}.analysisMethod 无效`);
    }
    if (!Array.isArray(dataFlow.nodes) || dataFlow.nodes.length < 2) {
        throw new Error(`${name}.nodes 至少需要 Source 和 Sink 两个节点`);
    }
    const nodes = dataFlow.nodes.map((value, index) => {
        const nodeName = `${name}.nodes[${index}]`;
        const node = record(value, nodeName);
        exactKeys(node, nodeName, ['kind', 'label', 'path', 'line', 'symbol', 'expression']);
        const location = parseLocation({ path: node.path, line: node.line }, nodeName);
        const kind = text(node.kind, `${nodeName}.kind`);
        if (kind !== 'source' && kind !== 'propagator' && kind !== 'sink') {
            throw new Error(`${nodeName}.kind 无效`);
        }
        return {
            ...location,
            kind,
            label: text(node.label, `${nodeName}.label`),
            symbol: text(node.symbol, `${nodeName}.symbol`),
            expression: text(node.expression, `${nodeName}.expression`),
        };
    });
    if (nodes[0].kind !== 'source' || nodes[nodes.length - 1].kind !== 'sink') {
        throw new Error(`${name}.nodes 必须从 Source 开始并以 Sink 结束`);
    }
    return { analysisMethod, nodes, limitations: stringList(dataFlow.limitations, `${name}.limitations`) };
}
function parseFinding(value, index) {
    const finding = record(value, `findings[${index}]`);
    exactKeys(finding, `findings[${index}]`, ['id', 'title', 'severity', 'rule', 'locations', 'confidence', 'evidence', 'impact', 'remediation', 'verification', 'dataFlow']);
    const severity = text(finding.severity, `findings[${index}].severity`);
    const confidence = text(finding.confidence, `findings[${index}].confidence`);
    if (!severities.has(severity)) {
        throw new Error(`findings[${index}].severity 无效`);
    }
    if (!confidences.has(confidence)) {
        throw new Error(`findings[${index}].confidence 无效`);
    }
    if (!Array.isArray(finding.locations) || finding.locations.length === 0) {
        throw new Error(`findings[${index}].locations 至少需要一个位置`);
    }
    const locations = finding.locations.map((location, locationIndex) => parseLocation(location, `findings[${index}].locations[${locationIndex}]`));
    return {
        id: text(finding.id, `findings[${index}].id`),
        title: text(finding.title, `findings[${index}].title`),
        severity,
        rule: text(finding.rule, `findings[${index}].rule`),
        locations,
        location: `${locations[0].path}:${locations[0].line}`,
        confidence,
        evidence: text(finding.evidence, `findings[${index}].evidence`),
        impact: text(finding.impact, `findings[${index}].impact`),
        remediation: text(finding.remediation, `findings[${index}].remediation`),
        verification: text(finding.verification, `findings[${index}].verification`),
        dataFlow: finding.dataFlow === undefined ? undefined : parseDataFlow(finding.dataFlow, `findings[${index}].dataFlow`),
    };
}
function parseReviewReportJson(reportJson) {
    let decoded;
    try {
        decoded = JSON.parse(reportJson);
    }
    catch {
        throw new Error('安全报告必须是合法 JSON，且不能包含 Markdown 代码围栏');
    }
    const report = record(decoded, 'report');
    exactKeys(report, 'report', ['schemaVersion', 'metadata', 'result', 'summary', 'findings', 'manualReview', 'coverage']);
    if (report.schemaVersion !== exports.reportJsonSchemaVersion) {
        throw new Error(`安全报告 schemaVersion 必须为 ${exports.reportJsonSchemaVersion}`);
    }
    const metadata = record(report.metadata, 'metadata');
    exactKeys(metadata, 'metadata', ['baseline', 'scope', 'generatedAt']);
    if (metadata.baseline !== 'sec-baseline.md') {
        throw new Error('安全报告 baseline 必须为 sec-baseline.md');
    }
    const result = text(report.result, 'result');
    if (!results.has(result)) {
        throw new Error('安全报告 result 必须为 pass、findings 或 incomplete');
    }
    const summary = record(report.summary, 'summary');
    exactKeys(summary, 'summary', ['critical', 'high', 'medium', 'low', 'manualReview']);
    const counts = {
        critical: integer(summary.critical, 'summary.critical'),
        high: integer(summary.high, 'summary.high'),
        medium: integer(summary.medium, 'summary.medium'),
        low: integer(summary.low, 'summary.low'),
        manualReview: integer(summary.manualReview, 'summary.manualReview'),
    };
    if (!Array.isArray(report.findings) || !Array.isArray(report.manualReview)) {
        throw new Error('findings 和 manualReview 必须为数组');
    }
    const findings = report.findings.map(parseFinding);
    const manualReview = report.manualReview.map((value, index) => {
        const item = record(value, `manualReview[${index}]`);
        exactKeys(item, `manualReview[${index}]`, ['id', 'title', 'rule', 'reason', 'requiredEvidence']);
        return {
            id: text(item.id, `manualReview[${index}].id`),
            title: text(item.title, `manualReview[${index}].title`),
            rule: text(item.rule, `manualReview[${index}].rule`),
            reason: text(item.reason, `manualReview[${index}].reason`),
            requiredEvidence: text(item.requiredEvidence, `manualReview[${index}].requiredEvidence`),
        };
    });
    for (const severity of severities) {
        if (counts[severity] !== findings.filter(finding => finding.severity === severity).length) {
            throw new Error(`summary.${severity} 与 findings 数量不一致`);
        }
    }
    if (counts.manualReview !== manualReview.length) {
        throw new Error('summary.manualReview 与 manualReview 数量不一致');
    }
    if (result === 'pass' && (findings.length > 0 || manualReview.length > 0)) {
        throw new Error('result 为 pass 时不能包含 findings 或 manualReview');
    }
    const coverage = record(report.coverage, 'coverage');
    exactKeys(coverage, 'coverage', ['checked', 'notChecked', 'tools']);
    return {
        schemaVersion: exports.reportJsonSchemaVersion,
        metadata: {
            baseline: 'sec-baseline.md',
            scope: text(metadata.scope, 'metadata.scope'),
            generatedAt: text(metadata.generatedAt, 'metadata.generatedAt'),
        },
        result,
        counts,
        findings,
        manualReview,
        coverage: {
            checked: stringList(coverage.checked, 'coverage.checked'),
            notChecked: stringList(coverage.notChecked, 'coverage.notChecked'),
            tools: stringList(coverage.tools, 'coverage.tools'),
        },
    };
}
function validateReviewReportJson(reportJson) {
    parseReviewReportJson(reportJson);
}
function reportSourcePaths(report) {
    const paths = new Set();
    for (const finding of report.findings) {
        for (const location of finding.locations) {
            paths.add(location.path);
        }
        for (const node of finding.dataFlow?.nodes ?? []) {
            paths.add(node.path);
        }
    }
    return [...paths];
}
function renderReviewReportMarkdown(report) {
    const findingSections = report.findings.map(finding => [
        `### ${finding.id} ${finding.title}`,
        `- 严重程度：${finding.severity}`,
        `- 规则：${finding.rule}`,
        `- 位置：${finding.locations.map(location => `${location.path}:${location.line}`).join('、')}`,
        `- 置信度：${finding.confidence}`,
        `- 证据：${finding.evidence}`,
        `- 影响：${finding.impact}`,
        `- 修复建议：${finding.remediation}`,
        `- 验证方式：${finding.verification}`,
    ].join('\n'));
    const manualSections = report.manualReview.map(item => [
        `### ${item.id} ${item.title}`,
        `- 规则：${item.rule}`,
        `- 原因：${item.reason}`,
        `- 所需证据：${item.requiredEvidence}`,
    ].join('\n'));
    return [
        '## 摘要',
        `- 结果：${report.result}`,
        `- 严重：${report.counts.critical}`,
        `- 高危：${report.counts.high}`,
        `- 中危：${report.counts.medium}`,
        `- 低危：${report.counts.low}`,
        `- 人工复核：${report.counts.manualReview}`,
        '',
        '## 安全发现',
        findingSections.join('\n\n') || '未发现安全问题。',
        '',
        '## 人工复核',
        manualSections.join('\n\n') || '无需人工复核。',
        '',
        '## 覆盖范围',
        `- 已检查：${report.coverage.checked.join('、') || '无'}`,
        `- 未检查：${report.coverage.notChecked.join('、') || '无'}`,
    ].join('\n');
}
//# sourceMappingURL=reportJson.js.map