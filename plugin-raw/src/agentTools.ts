import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const maxToolResultCharacters = 30_000;
const maxSearchFiles = 200;

export const reviewAgentTools: readonly vscode.LanguageModelChatTool[] = [
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
] as const;

interface ResolvedWorkspacePath {
	readonly fullPath: string;
	readonly relativePath: string;
}

async function resolveWorkspacePath(rootPath: string, relativePath: string): Promise<ResolvedWorkspacePath> {
	const resolvedRoot = await fs.realpath(rootPath);
	const candidatePath = path.resolve(resolvedRoot, relativePath);
	const resolvedPath = await fs.realpath(candidatePath);
	const relation = path.relative(resolvedRoot, resolvedPath);
	if (!relativePath.trim() || relation.startsWith('..') || path.isAbsolute(relation)) {
		throw new Error('工具只能访问当前工作区内的相对路径。');
	}
	return { fullPath: resolvedPath, relativePath: relation.split(path.sep).join('/') };
}

function truncate(value: string): string {
	if (value.length <= maxToolResultCharacters) {
		return value;
	}
	return `${value.slice(0, maxToolResultCharacters)}\n[工具结果已截断]`;
}

async function listFiles(rootPath: string, glob: string): Promise<string> {
	const root = vscode.Uri.file(rootPath);
	const pattern = new vscode.RelativePattern(root, glob || '**/*');
	const files = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,dist,out,build,vendor}/**', maxSearchFiles);
	return files.map(file => path.relative(rootPath, file.fsPath).split(path.sep).join('/')).join('\n') || '未找到匹配文件。';
}

async function readFile(rootPath: string, relativePath: string, onFileAccess?: (path: string) => void): Promise<string> {
	const resolved = await resolveWorkspacePath(rootPath, relativePath);
	const contents = await fs.readFile(resolved.fullPath);
	if (contents.includes(0)) {
		throw new Error('不支持读取二进制文件。');
	}
	onFileAccess?.(resolved.relativePath);
	return truncate(contents.toString('utf8'));
}

async function searchWorkspace(rootPath: string, query: string, glob: string, onFileAccess?: (path: string) => void): Promise<string> {
	if (!query.trim()) {
		throw new Error('搜索内容不能为空。');
	}
	const listed = await listFiles(rootPath, glob || '**/*');
	if (listed === '未找到匹配文件。') {
		return listed;
	}
	const matches: string[] = [];
	for (const relativePath of listed.split('\n')) {
		try {
			const resolved = await resolveWorkspacePath(rootPath, relativePath);
			const contents = await fs.readFile(resolved.fullPath);
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
		} catch {
			// Ignore files that disappear or cannot be decoded during a scan.
		}
	}
	return truncate(matches.join('\n') || '未找到匹配内容。');
}

export async function invokeReviewAgentTool(rootPath: string, call: vscode.LanguageModelToolCallPart, onFileAccess?: (path: string) => void): Promise<string> {
	const input = call.input as { path?: unknown; glob?: unknown; query?: unknown };
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
