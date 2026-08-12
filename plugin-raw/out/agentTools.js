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
exports.reviewAgentTools = void 0;
exports.invokeReviewAgentTool = invokeReviewAgentTool;
const fs_1 = require("fs");
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const maxToolResultCharacters = 30_000;
const maxSearchFiles = 200;
exports.reviewAgentTools = [
    {
        name: 'list_workspace_files',
        description: 'List files in the workspace that match a glob. Use this to discover relevant implementation, tests, and configuration.',
        inputSchema: {
            type: 'object', properties: { glob: { type: 'string', description: 'Workspace-relative glob such as src/**/*.ts' } }, required: ['glob'], additionalProperties: false,
        },
    },
    {
        name: 'read_workspace_file',
        description: 'Read a UTF-8 text file from the workspace. Paths must be workspace-relative.',
        inputSchema: {
            type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false,
        },
    },
    {
        name: 'search_workspace',
        description: 'Search workspace text files for a literal string and return matching file paths and lines.',
        inputSchema: {
            type: 'object', properties: { query: { type: 'string' }, glob: { type: 'string', description: 'Optional workspace-relative glob' } }, required: ['query'], additionalProperties: false,
        },
    },
];
async function resolveWorkspacePath(rootPath, relativePath) {
    const resolvedRoot = await fs_1.promises.realpath(rootPath);
    const candidatePath = path.resolve(resolvedRoot, relativePath);
    const resolvedPath = await fs_1.promises.realpath(candidatePath);
    const relation = path.relative(resolvedRoot, resolvedPath);
    if (!relativePath.trim() || relation.startsWith('..') || path.isAbsolute(relation)) {
        throw new Error('工具只能访问当前工作区内的相对路径。');
    }
    return { fullPath: resolvedPath, relativePath: relation.split(path.sep).join('/') };
}
function truncate(value) {
    if (value.length <= maxToolResultCharacters) {
        return value;
    }
    return `${value.slice(0, maxToolResultCharacters)}\n[工具结果已截断]`;
}
async function listFiles(rootPath, glob) {
    const root = vscode.Uri.file(rootPath);
    const pattern = new vscode.RelativePattern(root, glob || '**/*');
    const files = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,dist,out,build,vendor}/**', maxSearchFiles);
    return files.map(file => path.relative(rootPath, file.fsPath).split(path.sep).join('/')).join('\n') || '未找到匹配文件。';
}
async function readFile(rootPath, relativePath, onFileAccess) {
    const resolved = await resolveWorkspacePath(rootPath, relativePath);
    const contents = await fs_1.promises.readFile(resolved.fullPath);
    if (contents.includes(0)) {
        throw new Error('不支持读取二进制文件。');
    }
    onFileAccess?.(resolved.relativePath);
    return truncate(contents.toString('utf8'));
}
async function searchWorkspace(rootPath, query, glob, onFileAccess) {
    if (!query.trim()) {
        throw new Error('搜索内容不能为空。');
    }
    const listed = await listFiles(rootPath, glob || '**/*');
    if (listed === '未找到匹配文件。') {
        return listed;
    }
    const matches = [];
    for (const relativePath of listed.split('\n')) {
        try {
            const resolved = await resolveWorkspacePath(rootPath, relativePath);
            const contents = await fs_1.promises.readFile(resolved.fullPath);
            if (contents.includes(0)) {
                continue;
            }
            let matched = false;
            contents.toString('utf8').split(/\r?\n/).forEach((line, index) => {
                if (line.includes(query) && matches.join('\n').length < maxToolResultCharacters) {
                    matches.push(`${relativePath}:${index + 1}: ${line.trim()}`);
                    matched = true;
                }
            });
            if (matched) {
                onFileAccess?.(resolved.relativePath);
            }
        }
        catch {
            // Ignore files that disappear or cannot be decoded during a scan.
        }
    }
    return truncate(matches.join('\n') || '未找到匹配内容。');
}
async function invokeReviewAgentTool(rootPath, call, onFileAccess) {
    const input = call.input;
    if (call.name === 'list_workspace_files') {
        return listFiles(rootPath, typeof input.glob === 'string' ? input.glob : '**/*');
    }
    if (call.name === 'read_workspace_file') {
        if (typeof input.path !== 'string') {
            throw new Error('path 必须是字符串。');
        }
        return readFile(rootPath, input.path, onFileAccess);
    }
    if (call.name === 'search_workspace') {
        if (typeof input.query !== 'string') {
            throw new Error('query 必须是字符串。');
        }
        return searchWorkspace(rootPath, input.query, typeof input.glob === 'string' ? input.glob : '**/*', onFileAccess);
    }
    throw new Error(`不支持的工具：${call.name}`);
}
//# sourceMappingURL=agentTools.js.map