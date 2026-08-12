import { createHash, randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { ReviewReportArtifact } from './reportArtifact';
import { parseReviewReportJson } from './reportJson';

export const scanHistorySchemaVersion = '1.0' as const;
const maxStoredScans = 20;

export interface LocalScanSnapshot {
	readonly schemaVersion: typeof scanHistorySchemaVersion;
	readonly reportId: string;
	readonly taskId: string;
	readonly generatedAt: string;
	readonly workspaceLabel: string;
	readonly reportJson: string;
}

export interface LocalScanHistory {
	readonly schemaVersion: typeof scanHistorySchemaVersion;
	readonly workspaceKey: string;
	readonly scans: readonly LocalScanSnapshot[];
}

export interface ScanHistoryRecord {
	readonly current: LocalScanSnapshot;
	readonly previous?: LocalScanSnapshot;
	readonly storageUri: vscode.Uri;
}

function workspaceKey(workspaceUri: vscode.Uri): string {
	return createHash('sha256').update(workspaceUri.toString()).digest('hex');
}

function snapshot(value: unknown): LocalScanSnapshot | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Partial<LocalScanSnapshot>;
	if (
		candidate.schemaVersion !== scanHistorySchemaVersion
		|| typeof candidate.reportId !== 'string'
		|| typeof candidate.taskId !== 'string'
		|| typeof candidate.generatedAt !== 'string'
		|| typeof candidate.workspaceLabel !== 'string'
		|| typeof candidate.reportJson !== 'string'
	) {
		return undefined;
	}
	try {
		parseReviewReportJson(candidate.reportJson);
	} catch {
		return undefined;
	}
	return candidate as LocalScanSnapshot;
}

export function parseLocalScanHistory(content: string, expectedWorkspaceKey: string): LocalScanHistory {
	try {
		const decoded = JSON.parse(content) as Partial<LocalScanHistory>;
		if (
			decoded.schemaVersion !== scanHistorySchemaVersion
			|| decoded.workspaceKey !== expectedWorkspaceKey
			|| !Array.isArray(decoded.scans)
		) {
			return { schemaVersion: scanHistorySchemaVersion, workspaceKey: expectedWorkspaceKey, scans: [] };
		}
		return {
			schemaVersion: scanHistorySchemaVersion,
			workspaceKey: expectedWorkspaceKey,
			scans: decoded.scans.map(snapshot).filter((item): item is LocalScanSnapshot => item !== undefined).slice(0, maxStoredScans),
		};
	} catch {
		return { schemaVersion: scanHistorySchemaVersion, workspaceKey: expectedWorkspaceKey, scans: [] };
	}
}

export function createLocalScanSnapshot(artifact: ReviewReportArtifact, taskId: string): LocalScanSnapshot {
	parseReviewReportJson(artifact.reportJson);
	return {
		schemaVersion: scanHistorySchemaVersion,
		reportId: artifact.reportId,
		taskId,
		generatedAt: artifact.generatedAt,
		workspaceLabel: artifact.workspaceLabel,
		reportJson: artifact.reportJson,
	};
}

export function artifactFromSnapshot(value: LocalScanSnapshot): ReviewReportArtifact {
	return {
		schemaVersion: '2.0',
		reportId: value.reportId,
		generatedAt: value.generatedAt,
		baseline: 'sec-baseline.md',
		dataClassification: 'CONFIDENTIAL',
		workspaceLabel: value.workspaceLabel,
		skillPath: '本地安全扫描',
		reportJson: value.reportJson,
	};
}

export class LocalScanHistoryStore {
	private readonly historyDirectory: vscode.Uri;

	constructor(globalStorageUri: vscode.Uri) {
		this.historyDirectory = vscode.Uri.joinPath(globalStorageUri, 'scan-history');
	}

	async load(workspaceUri: vscode.Uri): Promise<LocalScanHistory> {
		const key = workspaceKey(workspaceUri);
		try {
			const bytes = await vscode.workspace.fs.readFile(this.historyUri(key));
			return parseLocalScanHistory(Buffer.from(bytes).toString('utf8'), key);
		} catch {
			return { schemaVersion: scanHistorySchemaVersion, workspaceKey: key, scans: [] };
		}
	}

	async record(workspaceUri: vscode.Uri, artifact: ReviewReportArtifact, taskId: string): Promise<ScanHistoryRecord> {
		const history = await this.load(workspaceUri);
		const current = createLocalScanSnapshot(artifact, taskId);
		const scans = [current, ...history.scans.filter(item => item.reportId !== current.reportId)].slice(0, maxStoredScans);
		const updated: LocalScanHistory = { ...history, scans };
		const storageUri = this.historyUri(history.workspaceKey);
		const temporaryUri = vscode.Uri.joinPath(this.historyDirectory, `${history.workspaceKey}.${randomUUID()}.tmp`);
		await vscode.workspace.fs.createDirectory(this.historyDirectory);
		await vscode.workspace.fs.writeFile(temporaryUri, Buffer.from(JSON.stringify(updated, undefined, 2), 'utf8'));
		await vscode.workspace.fs.rename(temporaryUri, storageUri, { overwrite: true });
		return { current, previous: scans[1], storageUri };
	}

	private historyUri(key: string): vscode.Uri {
		return vscode.Uri.joinPath(this.historyDirectory, `${key}.json`);
	}
}
