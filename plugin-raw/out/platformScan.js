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
exports.platformScanEndpoint = platformScanEndpoint;
exports.platformScanReportEndpoint = platformScanReportEndpoint;
exports.validatePlatformAccessKey = validatePlatformAccessKey;
exports.createPlatformScan = createPlatformScan;
exports.updatePlatformScan = updatePlatformScan;
exports.uploadPlatformScanReport = uploadPlatformScanReport;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const requestTimeoutMilliseconds = 15_000;
const maxResponseCharacters = 100_000;
function platformScanEndpoint(baseUrl, taskId) {
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
function platformScanReportEndpoint(baseUrl, taskId) {
    const endpoint = platformScanEndpoint(baseUrl, taskId);
    endpoint.pathname += '/report';
    return endpoint;
}
function requestPlatformScan(endpoint, method, body, token) {
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
            response.on('data', (chunk) => {
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
                        detail = JSON.parse(responseBody).message?.trim() ?? '';
                    }
                    catch {
                        detail = responseBody.trim().slice(0, 500);
                    }
                    reject(new Error(`扫描平台请求失败（HTTP ${response.statusCode ?? 'unknown'}）${detail ? `：${detail}` : '。'}`));
                    return;
                }
                try {
                    const task = JSON.parse(responseBody);
                    if (!task.id || !task.status || typeof task.progress !== 'number') {
                        throw new Error('扫描平台返回了无效任务。');
                    }
                    resolve(task);
                }
                catch (error) {
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
function validatePlatformAccessKey(baseUrl, token) {
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
function createPlatformScan(baseUrl, input, token) {
    return requestPlatformScan(platformScanEndpoint(baseUrl), 'POST', input, token);
}
function updatePlatformScan(baseUrl, taskId, input, token) {
    return requestPlatformScan(platformScanEndpoint(baseUrl, taskId), 'PATCH', input, token);
}
function uploadPlatformScanReport(baseUrl, taskId, artifact, sourceSnapshot, aiTokenUsage, token) {
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
//# sourceMappingURL=platformScan.js.map