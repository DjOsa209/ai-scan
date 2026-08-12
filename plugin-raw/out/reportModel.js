"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateReviewReport = validateReviewReport;
exports.parseReviewReport = parseReviewReport;
const severities = new Set(['critical', 'high', 'medium', 'low']);
const reportResults = new Set(['pass', 'findings', 'incomplete']);
const requiredFindingFields = ['severity', 'rule', 'location', 'confidence', 'evidence', 'impact', 'remediation', 'verification'];
function reportSection(report, heading) {
    const startMatch = new RegExp(`^## ${heading}$`, 'm').exec(report);
    if (!startMatch) {
        return '';
    }
    const start = startMatch.index + startMatch[0].length;
    const remainder = report.slice(start);
    const nextSection = /^## /m.exec(remainder);
    return remainder.slice(0, nextSection?.index ?? remainder.length);
}
function validateReviewReport(report) {
    for (const section of ['Metadata', 'Summary', 'Findings', 'Manual Review', 'Coverage']) {
        if (!new RegExp(`^## ${section}$`, 'm').test(report)) {
            throw new Error(`结构化报告缺少 ## ${section}`);
        }
    }
    if (!/^- schemaVersion:\s*1\.1$/m.test(report)) {
        throw new Error('结构化报告 schemaVersion 必须为 1.1');
    }
    const metadataSection = reportSection(report, 'Metadata');
    if (!/^- baseline:\s*sec-baseline\.md$/m.test(metadataSection)
        || !/^- scope:\s*\S/m.test(metadataSection)
        || !/^- generatedAt:\s*\S/m.test(metadataSection)) {
        throw new Error('结构化报告 Metadata 字段不完整');
    }
    const model = parseReviewReport(report);
    if (!reportResults.has(model.result)) {
        throw new Error('结构化报告 result 必须为 pass、findings 或 incomplete');
    }
    const summarySection = reportSection(report, 'Summary');
    for (const field of ['critical', 'high', 'medium', 'low', 'manualReview']) {
        if (!new RegExp(`^- ${field}:\\s*\\d+$`, 'm').test(summarySection)) {
            throw new Error(`结构化报告 Summary 缺少有效的 ${field}`);
        }
    }
    const coverageSection = reportSection(report, 'Coverage');
    for (const field of ['checked', 'notChecked', 'tools']) {
        if (!new RegExp(`^- ${field}:\\s*\\S`, 'm').test(coverageSection)) {
            throw new Error(`结构化报告 Coverage 缺少 ${field}`);
        }
    }
    const findingsSection = reportSection(report, 'Findings');
    const headings = [...findingsSection.matchAll(/^###\s+(\S+)\s+(.+)$/gm)];
    if (headings.length === 0 && !/^No findings\.$/m.test(findingsSection)) {
        throw new Error('结构化报告 Findings 必须包含漏洞条目或 No findings.');
    }
    for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const section = findingsSection.slice(heading.index, headings[index + 1]?.index ?? findingsSection.length);
        for (const field of requiredFindingFields) {
            if (!new RegExp(`^- ${field}:\\s*\\S`, 'm').test(section)) {
                throw new Error(`结构化漏洞 ${heading[1]} 缺少 ${field}`);
            }
        }
        const location = section.match(/^- location:\s*(.+)$/m)?.[1]?.trim() ?? '';
        if (!/^[^:\r\n]+:\d+$/.test(location)) {
            throw new Error(`结构化漏洞 ${heading[1]} 的 location 必须为仓库相对路径:行号`);
        }
        if (!/^- severity:\s*(critical|high|medium|low)$/m.test(section)) {
            throw new Error(`结构化漏洞 ${heading[1]} 的 severity 无效`);
        }
        if (!/^- confidence:\s*(high|medium|low)$/m.test(section)) {
            throw new Error(`结构化漏洞 ${heading[1]} 的 confidence 无效`);
        }
    }
    for (const severity of severities) {
        const actual = model.findings.filter(finding => finding.severity === severity).length;
        if (model.counts[severity] !== actual) {
            throw new Error(`结构化报告 ${severity} 数量与漏洞条目不一致`);
        }
    }
    const manualReviewCount = [...reportSection(report, 'Manual Review').matchAll(/^###\s+\S+\s+.+$/gm)].length;
    if (model.counts.manualReview !== manualReviewCount) {
        throw new Error('结构化报告 manualReview 数量与条目不一致');
    }
}
function parseReviewReport(report) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, manualReview: 0 };
    const findings = [];
    let result = 'unknown';
    let section = '';
    let current;
    const commitFinding = () => {
        if (!current) {
            return;
        }
        const severity = severities.has(current.severity)
            ? current.severity
            : 'low';
        findings.push({
            id: current.id,
            title: current.title,
            severity,
            rule: current.rule ?? '',
            location: current.location ?? '',
            confidence: current.confidence ?? '',
            impact: current.impact ?? '',
            remediation: current.remediation ?? '',
        });
        current = undefined;
    };
    for (const line of report.split(/\r?\n/)) {
        const sectionMatch = /^##\s+(.+)$/.exec(line);
        if (sectionMatch) {
            commitFinding();
            const heading = sectionMatch[1].trim().toLowerCase();
            section = heading === '摘要' ? 'summary' : heading === '安全发现' ? 'findings' : heading;
            continue;
        }
        if (section === 'summary') {
            const field = /^-\s+(result|critical|high|medium|low|manualReview):\s*(.+)$/i.exec(line);
            if (!field) {
                continue;
            }
            const key = field[1];
            if (key.toLowerCase() === 'result') {
                result = field[2].trim();
            }
            else {
                const countKey = key.toLowerCase() === 'manualreview' ? 'manualReview' : key.toLowerCase();
                counts[countKey] = Number.parseInt(field[2], 10) || 0;
            }
            continue;
        }
        if (section !== 'findings') {
            continue;
        }
        const heading = /^###\s+(\S+)\s*(.*)$/.exec(line);
        if (heading) {
            commitFinding();
            current = { id: heading[1], title: heading[2].trim() };
            continue;
        }
        const field = /^-\s+([A-Za-z]+):\s*(.*)$/.exec(line);
        if (current && field) {
            current[field[1].toLowerCase()] = field[2].trim();
        }
    }
    commitFinding();
    return { result, counts, findings };
}
//# sourceMappingURL=reportModel.js.map