import * as https from 'https';
import * as vscode from 'vscode';
import { ReportUploadReceipt, ReviewReportArtifact } from './reportArtifact';

const requestTimeoutMilliseconds = 15_000;
const maxResponseCharacters = 64_000;

export function normalizeUploadEndpoint(input: string): URL {
	const endpoint = new URL(input.trim());
	if (endpoint.protocol !== 'https:') {
		throw new Error('Report upload endpoint must use HTTPS.');
	}
	if (endpoint.username || endpoint.password) {
		throw new Error('Report upload endpoint must not contain credentials.');
	}
	return endpoint;
}

function receiptFromResponse(content: string, fallbackReportId: string): ReportUploadReceipt {
	let remoteReportId = fallbackReportId;
	if (content.trim()) {
		try {
			const response = JSON.parse(content) as { id?: unknown; reportId?: unknown };
			const responseId = response.id ?? response.reportId;
			if (typeof responseId === 'string' && responseId.trim()) {
				remoteReportId = responseId;
			}
		} catch {
			// A successful endpoint may return plain text or no receipt body.
		}
	}
	return { remoteReportId, uploadedAt: new Date().toISOString() };
}

export function uploadReport(
	endpointInput: string,
	report: ReviewReportArtifact,
	bearerToken: string | undefined,
	cancellationToken: vscode.CancellationToken,
): Promise<ReportUploadReceipt> {
	const endpoint = normalizeUploadEndpoint(endpointInput);
	const body = JSON.stringify(report);

	return new Promise((resolve, reject) => {
		const request = https.request(endpoint, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body),
				'User-Agent': 'pi-sec-review-vscode',
				...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
			},
		}, response => {
			response.setEncoding('utf8');
			let content = '';
			response.on('data', (chunk: string) => {
				content += chunk;
				if (content.length > maxResponseCharacters) {
					response.destroy(new Error('Report upload response exceeded the size limit.'));
				}
			});
			response.on('end', () => {
				if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error(`Report upload failed with HTTP ${response.statusCode ?? 'unknown'}.`));
					return;
				}
				resolve(receiptFromResponse(content, report.reportId));
			});
			response.on('error', reject);
		});

		const cancellation = cancellationToken.onCancellationRequested(() => {
			request.destroy(new vscode.CancellationError());
		});
		request.setTimeout(requestTimeoutMilliseconds, () => {
			request.destroy(new Error('Report upload timed out.'));
		});
		request.on('error', reject);
		request.on('close', () => cancellation.dispose());
		request.end(body);
	});
}