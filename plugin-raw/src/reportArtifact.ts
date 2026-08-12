import { randomUUID } from 'crypto';
import { parseReviewReportJson, renderReviewReportMarkdown, reportJsonSchemaVersion } from './reportJson';

export const reportSchemaVersion = reportJsonSchemaVersion;

export interface ReviewReportArtifact {
	readonly schemaVersion: typeof reportSchemaVersion;
	readonly reportId: string;
	readonly generatedAt: string;
	readonly baseline: 'sec-baseline.md';
	readonly dataClassification: 'CONFIDENTIAL';
	readonly workspaceLabel: string;
	readonly skillPath: string;
	readonly reportJson: string;
}

export function createLocalReportArtifact(input: {
	workspaceLabel: string;
	skillPath: string;
	reportJson: string;
	now?: Date;
}): ReviewReportArtifact {
	return {
		schemaVersion: reportSchemaVersion,
		reportId: randomUUID(),
		generatedAt: (input.now ?? new Date()).toISOString(),
		baseline: 'sec-baseline.md',
		dataClassification: 'CONFIDENTIAL',
		workspaceLabel: input.workspaceLabel,
		skillPath: input.skillPath,
		reportJson: input.reportJson,
	};
}

export function renderLocalReport(artifact: ReviewReportArtifact): string {
	const report = parseReviewReportJson(artifact.reportJson);
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
		renderReviewReportMarkdown(report),
	].join('\n');
}