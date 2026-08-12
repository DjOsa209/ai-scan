import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

export const reportSchemaVersion = '1.0' as const;

export interface ReviewReportArtifact {
	readonly schemaVersion: typeof reportSchemaVersion;
	readonly reportId: string;
	readonly generatedAt: string;
	readonly baseline: 'sec-baseline.md';
	readonly dataClassification: 'CONFIDENTIAL';
	readonly remoteUploadAllowed: false;
	readonly uploadStatus: 'not-configured';
	readonly workspaceLabel: string;
	readonly skillPath: string;
	readonly reportMarkdown: string;
}

export interface AuthorizedReportUpload {
	readonly report: Omit<ReviewReportArtifact, 'remoteUploadAllowed' | 'uploadStatus'> & {
		readonly remoteUploadAllowed: true;
		readonly uploadStatus: 'pending';
	};
	readonly authorizationReference: string;
	readonly destinationId: string;
}

export interface ReportUploadReceipt {
	readonly remoteReportId: string;
	readonly uploadedAt: string;
}

export interface ReportUploader {
	upload(request: AuthorizedReportUpload, token: vscode.CancellationToken): Promise<ReportUploadReceipt>;
}

export function createLocalReportArtifact(input: {
	workspaceLabel: string;
	skillPath: string;
	reportMarkdown: string;
	now?: Date;
}): ReviewReportArtifact {
	return {
		schemaVersion: reportSchemaVersion,
		reportId: randomUUID(),
		generatedAt: (input.now ?? new Date()).toISOString(),
		baseline: 'sec-baseline.md',
		dataClassification: 'CONFIDENTIAL',
		remoteUploadAllowed: false,
		uploadStatus: 'not-configured',
		workspaceLabel: input.workspaceLabel,
		skillPath: input.skillPath,
		reportMarkdown: input.reportMarkdown,
	};
}

export function renderLocalReport(artifact: ReviewReportArtifact): string {
	return [
		'# PI Security Review',
		'',
		`- Report ID: ${artifact.reportId}`,
		`- Schema: ${artifact.schemaVersion}`,
		`- Workspace: ${artifact.workspaceLabel}`,
		`- Skill: ${artifact.skillPath}`,
		`- Generated: ${artifact.generatedAt}`,
		`- Classification: ${artifact.dataClassification}`,
		`- Upload: ${artifact.uploadStatus}`,
		'',
		artifact.reportMarkdown,
	].join('\n');
}