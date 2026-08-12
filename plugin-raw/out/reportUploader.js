"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeUploadEndpoint = normalizeUploadEndpoint;
exports.uploadReport = uploadReport;
const https = __importStar(require("https"));
const vscode = __importStar(require("vscode"));
const requestTimeoutMilliseconds = 15_000;
const maxResponseCharacters = 64_000;
function normalizeUploadEndpoint(input) {
    const endpoint = new URL(input.trim());
    if (endpoint.protocol !== 'https:') {
        throw new Error('Report upload endpoint must use HTTPS.');
    }
    if (endpoint.username || endpoint.password) {
        throw new Error('Report upload endpoint must not contain credentials.');
    }
    return endpoint;
}
function receiptFromResponse(content, fallbackReportId) {
    let remoteReportId = fallbackReportId;
    if (content.trim()) {
        try {
            const response = JSON.parse(content);
            const responseId = response.id ?? response.reportId;
            if (typeof responseId === 'string' && responseId.trim()) {
                remoteReportId = responseId;
            }
        }
        catch {
            // A successful endpoint may return plain text or no receipt body.
        }
    }
    return { remoteReportId, uploadedAt: new Date().toISOString() };
}
function uploadReport(endpointInput, report, bearerToken, cancellationToken) {
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
            response.on('data', (chunk) => {
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
//# sourceMappingURL=reportUploader.js.map