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
exports.LocalScanHistoryStore = exports.scanHistorySchemaVersion = void 0;
exports.parseLocalScanHistory = parseLocalScanHistory;
exports.createLocalScanSnapshot = createLocalScanSnapshot;
exports.artifactFromSnapshot = artifactFromSnapshot;
const crypto_1 = require("crypto");
const vscode = __importStar(require("vscode"));
const reportJson_1 = require("./reportJson");
exports.scanHistorySchemaVersion = '1.0';
const maxStoredScans = 20;
function workspaceKey(workspaceUri) {
    return (0, crypto_1.createHash)('sha256').update(workspaceUri.toString()).digest('hex');
}
function snapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const candidate = value;
    if (candidate.schemaVersion !== exports.scanHistorySchemaVersion
        || typeof candidate.reportId !== 'string'
        || typeof candidate.taskId !== 'string'
        || typeof candidate.generatedAt !== 'string'
        || typeof candidate.workspaceLabel !== 'string'
        || typeof candidate.reportJson !== 'string') {
        return undefined;
    }
    try {
        (0, reportJson_1.parseReviewReportJson)(candidate.reportJson);
    }
    catch {
        return undefined;
    }
    return candidate;
}
function parseLocalScanHistory(content, expectedWorkspaceKey) {
    try {
        const decoded = JSON.parse(content);
        if (decoded.schemaVersion !== exports.scanHistorySchemaVersion
            || decoded.workspaceKey !== expectedWorkspaceKey
            || !Array.isArray(decoded.scans)) {
            return { schemaVersion: exports.scanHistorySchemaVersion, workspaceKey: expectedWorkspaceKey, scans: [] };
        }
        return {
            schemaVersion: exports.scanHistorySchemaVersion,
            workspaceKey: expectedWorkspaceKey,
            scans: decoded.scans.map(snapshot).filter((item) => item !== undefined).slice(0, maxStoredScans),
        };
    }
    catch {
        return { schemaVersion: exports.scanHistorySchemaVersion, workspaceKey: expectedWorkspaceKey, scans: [] };
    }
}
function createLocalScanSnapshot(artifact, taskId) {
    (0, reportJson_1.parseReviewReportJson)(artifact.reportJson);
    return {
        schemaVersion: exports.scanHistorySchemaVersion,
        reportId: artifact.reportId,
        taskId,
        generatedAt: artifact.generatedAt,
        workspaceLabel: artifact.workspaceLabel,
        reportJson: artifact.reportJson,
    };
}
function artifactFromSnapshot(value) {
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
class LocalScanHistoryStore {
    historyDirectory;
    constructor(globalStorageUri) {
        this.historyDirectory = vscode.Uri.joinPath(globalStorageUri, 'scan-history');
    }
    async load(workspaceUri) {
        const key = workspaceKey(workspaceUri);
        try {
            const bytes = await vscode.workspace.fs.readFile(this.historyUri(key));
            return parseLocalScanHistory(Buffer.from(bytes).toString('utf8'), key);
        }
        catch {
            return { schemaVersion: exports.scanHistorySchemaVersion, workspaceKey: key, scans: [] };
        }
    }
    async record(workspaceUri, artifact, taskId) {
        const history = await this.load(workspaceUri);
        const current = createLocalScanSnapshot(artifact, taskId);
        const scans = [current, ...history.scans.filter(item => item.reportId !== current.reportId)].slice(0, maxStoredScans);
        const updated = { ...history, scans };
        const storageUri = this.historyUri(history.workspaceKey);
        const temporaryUri = vscode.Uri.joinPath(this.historyDirectory, `${history.workspaceKey}.${(0, crypto_1.randomUUID)()}.tmp`);
        await vscode.workspace.fs.createDirectory(this.historyDirectory);
        await vscode.workspace.fs.writeFile(temporaryUri, Buffer.from(JSON.stringify(updated, undefined, 2), 'utf8'));
        await vscode.workspace.fs.rename(temporaryUri, storageUri, { overwrite: true });
        return { current, previous: scans[1], storageUri };
    }
    historyUri(key) {
        return vscode.Uri.joinPath(this.historyDirectory, `${key}.json`);
    }
}
exports.LocalScanHistoryStore = LocalScanHistoryStore;
//# sourceMappingURL=scanHistory.js.map