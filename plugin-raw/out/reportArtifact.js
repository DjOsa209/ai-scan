"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportSchemaVersion = void 0;
exports.createLocalReportArtifact = createLocalReportArtifact;
exports.renderLocalReport = renderLocalReport;
const crypto_1 = require("crypto");
const reportJson_1 = require("./reportJson");
exports.reportSchemaVersion = reportJson_1.reportJsonSchemaVersion;
function createLocalReportArtifact(input) {
    return {
        schemaVersion: exports.reportSchemaVersion,
        reportId: (0, crypto_1.randomUUID)(),
        generatedAt: (input.now ?? new Date()).toISOString(),
        baseline: 'sec-baseline.md',
        dataClassification: 'CONFIDENTIAL',
        workspaceLabel: input.workspaceLabel,
        skillPath: input.skillPath,
        reportJson: input.reportJson,
    };
}
function renderLocalReport(artifact) {
    const report = (0, reportJson_1.parseReviewReportJson)(artifact.reportJson);
    return [
        '# PI 安全审查报告',
        '',
        `- 报告 ID：${artifact.reportId}`,
        `- 数据格式版本：${artifact.schemaVersion}`,
        `- 工作区：${artifact.workspaceLabel}`,
        `- 安全 Skill：${artifact.skillPath}`,
        `- 生成时间：${artifact.generatedAt}`,
        `- 数据分级：${artifact.dataClassification}`,
        '',
        (0, reportJson_1.renderReviewReportMarkdown)(report),
    ].join('\n');
}
//# sourceMappingURL=reportArtifact.js.map