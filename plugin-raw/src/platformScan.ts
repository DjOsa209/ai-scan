import * as http from 'http';
import * as https from 'https';
import type { ReviewContextBundle } from './gitChanges';
import type { ReviewReportArtifact } from './reportArtifact';
import type { AITokenUsage } from './reviewService';

const requestTimeoutMilliseconds = 15_000;
const maxResponseCharacters = 100_000;

export type PlatformScanStatus = 'queued' | 'cloning' | 'indexing' | 'analyzing' | 'normalizing' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface PlatformScanTask {
	readonly id: string;
	readonly projectName: string;
	readonly repositoryUrl: string;
	readonly gitRef: string;
	readonly status: PlatformScanStatus;
	readonly stage: string;
	readonly progress: number;
	readonly statusMessage: string;
}

export function platformScanEndpoint(baseUrl: string, taskId?: string): URL {
	const pathname = taskId ? `/api/v1/plugin/scans/${encodeURIComponent(taskId)}` : '/api/v1/plugin/scans';
	const url = new URL(pathname, baseUrl.trim());
	const isLocalDevelopment = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if (url.protocol !== 'https:' && !isLocalDevelopment) {
		throw new Error('扫描平台在非本地环境必须使用 HTTPS。');
	}
	if (url.username || url.password) {
		throw new Error('扫描平台地址不能包含凭据。');
	}
	return url;
}

export function platformScanReportEndpoint(baseUrl: string, taskId: string): URL {
	const endpoint = platformScanEndpoint(baseUrl, taskId);
	endpoint.pathname += '/report';
	return endpoint;
}

function requestPlatformScan(endpoint: URL, method: 'POST' | 'PATCH' | 'PUT', body: unknown, token?: string): Promise<PlatformScanTask> {
	const payload = JSON.stringify(body);
	const transport = endpoint.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const request = transport.request(endpoint, {
			method,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(payload),
				'User-Agent': 'pi-sec-review-vscode',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		}, response => {
			response.setEncoding('utf8');
			let responseBody = '';
			response.on('data', (chunk: string) => {
				responseBody += chunk;
				if (responseBody.length > maxResponseCharacters) {
					response.destroy(new Error('扫描平台响应过大。'));
				}
			});
			response.on('end', () => {
				if (response.statusCode === 401) {
					reject(new Error('扫描接入密钥无效。请运行“PI Security Review: 配置扫描接入密钥”后重试。'));
					return;
				}
				if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
					let detail = '';
					try {
						detail = (JSON.parse(responseBody) as { message?: string }).message?.trim() ?? '';
					} catch {
						detail = responseBody.trim().slice(0, 500);
					}
					reject(new Error(`扫描平台请求失败（HTTP ${response.statusCode ?? 'unknown'}）${detail ? `：${detail}` : '。'}`));
					return;
				}
				try {
					const task = JSON.parse(responseBody) as PlatformScanTask;
					if (!task.id || !task.status || typeof task.progress !== 'number') {
						throw new Error('扫描平台返回了无效任务。');
					}
					resolve(task);
				} catch (error) {
					reject(error);
				}
			});
			response.on('error', reject);
		});
		request.setTimeout(requestTimeoutMilliseconds, () => request.destroy(new Error('扫描平台请求超时。')));
		request.on('error', reject);
		request.end(payload);
	});
}

export function validatePlatformAccessKey(baseUrl: string, token: string): Promise<void> {
	const endpoint = platformScanEndpoint(baseUrl);
	const transport = endpoint.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const request = transport.request(endpoint, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
				'User-Agent': 'pi-sec-review-vscode',
			},
		}, response => {
			response.resume();
			response.on('end', () => {
				if (response.statusCode === 401) {
					reject(new Error(`扫描接入密钥未通过 ${endpoint.origin} 验证。`));
					return;
				}
				if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error(`扫描平台 ${endpoint.origin} 验证失败（HTTP ${response.statusCode ?? 'unknown'}）。`));
					return;
				}
				resolve();
			});
			response.on('error', reject);
		});
		request.setTimeout(requestTimeoutMilliseconds, () => request.destroy(new Error(`扫描平台 ${endpoint.origin} 验证超时。`)));
		request.on('error', reject);
		request.end();
	});
}

export function createPlatformScan(baseUrl: string, input: {
	projectName: string;
	repositoryUrl: string;
	gitRef: string;
}, token?: string): Promise<PlatformScanTask> {
	return requestPlatformScan(platformScanEndpoint(baseUrl), 'POST', input, token);
}

export function updatePlatformScan(baseUrl: string, taskId: string, input: {
	status: PlatformScanStatus;
	stage: string;
	progress: number;
	statusMessage: string;
}, token?: string): Promise<PlatformScanTask> {
	return requestPlatformScan(platformScanEndpoint(baseUrl, taskId), 'PATCH', input, token);
}

export function uploadPlatformScanReport(baseUrl: string, taskId: string, artifact: ReviewReportArtifact, sourceSnapshot: ReviewContextBundle, aiTokenUsage: AITokenUsage, token?: string): Promise<PlatformScanTask> {
	return requestPlatformScan(platformScanReportEndpoint(baseUrl, taskId), 'PUT', {
		schemaVersion: artifact.schemaVersion,
		reportId: artifact.reportId,
		generatedAt: artifact.generatedAt,
		workspaceLabel: artifact.workspaceLabel,
		reportJson: artifact.reportJson,
		sourceSnapshot,
		aiTokenUsage,
	}, token);
}