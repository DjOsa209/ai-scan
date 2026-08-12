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
exports.WorkspaceSourceBaseline = void 0;
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const util_1 = require("util");
const gitChanges_1 = require("./gitChanges");
const sourceFilter_1 = require("./sourceFilter");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function normalizePath(value) {
    return value.split(path.sep).join('/');
}
async function fingerprint(filePath) {
    try {
        const contents = await fs_1.promises.readFile(filePath);
        return (0, crypto_1.createHash)('sha256').update(contents).digest('hex');
    }
    catch {
        return undefined;
    }
}
async function canonicalPath(filePath) {
    try {
        return await fs_1.promises.realpath(filePath);
    }
    catch {
        return path.join(await fs_1.promises.realpath(path.dirname(filePath)), path.basename(filePath));
    }
}
class WorkspaceSourceBaseline {
    gitRoot;
    fingerprints;
    constructor(gitRoot, fingerprints) {
        this.gitRoot = gitRoot;
        this.fingerprints = fingerprints;
    }
    static async capture(startPath) {
        const gitRoot = await (0, gitChanges_1.findGitRoot)(startPath);
        const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
            encoding: 'utf8',
            maxBuffer: 5 * 1024 * 1024,
        });
        const sourcePaths = stdout.split('\0').filter(sourceFilter_1.isScannableSourcePath);
        const entries = await Promise.all(sourcePaths.map(async (sourcePath) => [
            normalizePath(sourcePath),
            await fingerprint(path.join(gitRoot, sourcePath)),
        ]));
        return new WorkspaceSourceBaseline(gitRoot, new Map(entries.filter((entry) => entry[1] !== undefined)));
    }
    async changedPath(filePath) {
        const relativePath = path.relative(this.gitRoot, await canonicalPath(filePath));
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return undefined;
        }
        const normalized = normalizePath(relativePath);
        if (!(0, sourceFilter_1.isScannableSourcePath)(normalized)) {
            return undefined;
        }
        const current = await fingerprint(filePath);
        const initial = this.fingerprints.get(normalized);
        return current !== initial && (current !== undefined || initial !== undefined) ? normalized : undefined;
    }
}
exports.WorkspaceSourceBaseline = WorkspaceSourceBaseline;
//# sourceMappingURL=autoIncrementalScan.js.map