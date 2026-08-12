"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeIncrementalReport = mergeIncrementalReport;
exports.stringifyReviewReport = stringifyReviewReport;
function findingKey(finding) {
    const locations = finding.locations
        .map(location => `${location.path}:${location.line}`)
        .sort()
        .join('|');
    return `${finding.rule}|${locations}|${finding.title}`;
}
function isInScope(finding, replacedPaths) {
    return finding.locations.some(location => replacedPaths.has(location.path));
}
function counts(findings, manualReview) {
    const result = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        manualReview: manualReview.length,
    };
    for (const finding of findings) {
        result[finding.severity] += 1;
    }
    return result;
}
function mergeIncrementalReport(previous, incremental, replacedPaths) {
    const retained = previous.findings.filter(finding => !isInScope(finding, replacedPaths));
    const findings = [...retained];
    const known = new Set(findings.map(findingKey));
    for (const finding of incremental.findings) {
        const key = findingKey(finding);
        if (!known.has(key)) {
            findings.push(finding);
            known.add(key);
        }
    }
    const manualReview = incremental.manualReview;
    const checked = [...new Set([...previous.coverage.checked, ...incremental.coverage.checked])];
    const notChecked = [...new Set([...previous.coverage.notChecked, ...incremental.coverage.notChecked])]
        .filter(item => !checked.includes(item));
    return {
        ...incremental,
        metadata: { ...incremental.metadata, scope: 'current workspace state from incremental scans' },
        result: incremental.result === 'incomplete' ? 'incomplete' : findings.length ? 'findings' : 'pass',
        counts: counts(findings, manualReview),
        findings,
        manualReview,
        coverage: {
            checked,
            notChecked,
            tools: [...new Set([...previous.coverage.tools, ...incremental.coverage.tools])],
        },
    };
}
function stringifyReviewReport(report) {
    return JSON.stringify(report, (key, value) => key === 'location' ? undefined : value);
}
//# sourceMappingURL=currentReport.js.map