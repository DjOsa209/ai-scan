import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { collectTypeScriptCodeGraph, TypeScriptCodeGraph } from './codeGraph';
import { isExcludedSourceDirectory, isScannableSourcePath } from './sourceFilter';

const execFileAsync = promisify(execFile);
const gitBufferLimit = 5 * 1024 * 1024;
const fileCharacterLimit = 30_000;
const sourceSnapshotByteLimit = 23 * 1024 * 1024;
const sourceSnapshotTruncationMarker = '\n[truncated for source snapshot upload]';

export interface ReviewContextFile {
	readonly path: string;
	readonly kind: 'changed' | 'test' | 'config' | 'evidence';
	readonly content: string;
}

export interface ReviewContextBundle {
	readonly gitStatus: string;
	readonly diff: string;
	readonly files: readonly ReviewContextFile[];
	readonly analysisContext?: TypeScriptCodeGraph;
	readonly scanScope?: 'full' | 'incremental';
}

export interface RepositoryIdentity {
	readonly repositoryUrl: string;
	readonly gitRef: string;
}

export class NoChangesError extends Error {
	constructor() {
		super('The workspace has no uncommitted changes to review.');
		this.name = 'NoChangesError';
	}
}

async function runGit(rootPath: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync('git', ['-C', rootPath, ...args], {
		encoding: 'utf8',
		maxBuffer: gitBufferLimit,
	});
	return stdout;
}

export async function findGitRoot(startPath: string): Promise<string> {
	let workingDirectory = startPath;
	try {
		if (!(await fs.stat(startPath)).isDirectory()) {
			workingDirectory = path.dirname(startPath);
		}
	} catch {
		workingDirectory = path.dirname(startPath);
	}

	try {
		return (await runGit(workingDirectory, ['rev-parse', '--show-toplevel'])).trim();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not a git repository/i.test(message)) {
			throw new Error('当前扫描目录不是 Git 仓库。请在项目根目录执行 git init，或打开已有 Git 仓库后重试。');
		}
		throw error;
	}
}

export async function getRepositoryIdentity(rootPath: string, workspaceName: string): Promise<RepositoryIdentity> {
	const gitRoot = await findGitRoot(rootPath);
	let repositoryUrl = '';
	try {
		repositoryUrl = (await runGit(gitRoot, ['remote', 'get-url', 'origin'])).trim();
	} catch {
		// A local-only repository is still a valid review source.
	}
	if (/^git@[^:]+:.+/.test(repositoryUrl)) {
		repositoryUrl = repositoryUrl.replace(/^git@([^:]+):/, 'ssh://git@$1/');
	}
	if (!repositoryUrl) {
		repositoryUrl = `workspace://local/${encodeURIComponent(workspaceName)}`;
	}

	let gitRef = '';
	try {
		gitRef = (await runGit(gitRoot, ['branch', '--show-current'])).trim();
	} catch {
		// Detached HEAD is handled below.
	}
	if (!gitRef) {
		gitRef = (await runGit(gitRoot, ['rev-parse', '--short', 'HEAD'])).trim();
	}
	return { repositoryUrl, gitRef };
}

export function getFullWorkspaceIdentity(workspaceName: string): RepositoryIdentity {
	return {
		repositoryUrl: `workspace://local/${encodeURIComponent(workspaceName)}`,
		gitRef: 'full-scan',
	};
}

export function truncateReviewInput(input: string, maxCharacters: number): string {
	if (input.length <= maxCharacters) {
		return input;
	}

	const omitted = input.length - maxCharacters;
	return `${input.slice(0, maxCharacters)}\n\n[review input truncated; ${omitted} characters omitted]`;
}

function splitNullSeparated(value: string): string[] {
	return value.split('\0').filter(Boolean);
}

function normalizePath(value: string): string {
	return value.split(path.sep).join('/');
}

function filterStatus(status: string, allowedPaths: Set<string>): string {
	return status.split('\n').filter(line => {
		const rawPath = line.slice(3).trim();
		const currentPath = normalizePath(rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath);
		return allowedPaths.has(currentPath);
	}).join('\n');
}

function filterDiff(diff: string, allowedPaths: Set<string>): string {
	return diff.split(/(?=^diff --git )/m).filter(section => {
		if (!section.startsWith('diff --git ')) {
			return false;
		}
		const header = section.split('\n', 1)[0];
		const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
		return !!match && allowedPaths.has(normalizePath(match[2]));
	}).join('');
}

function isRelatedTest(candidate: string, changedPaths: Set<string>): boolean {
	const basename = path.posix.basename(candidate).replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '');
	return /(^|\/)(__tests__|tests?|testdata)(\/|$)|\.(test|spec)\.[^.]+$/.test(candidate)
		&& [...changedPaths].some(changed => path.posix.basename(changed).replace(/\.[^.]+$/, '') === basename);
}

function isRootConfiguration(candidate: string): boolean {
	return !candidate.includes('/') && /^(package(-lock)?\.json|go\.(mod|sum)|pyproject\.toml|requirements.*\.txt|Cargo\.(toml|lock)|pom\.xml|build\.gradle|tsconfig.*\.json|Dockerfile|docker-compose\.ya?ml)$/.test(candidate);
}

async function readContextFile(rootPath: string, relativePath: string, kind: ReviewContextFile['kind'], remaining: number): Promise<ReviewContextFile | undefined> {
	const fullPath = path.resolve(rootPath, relativePath);
	const resolvedRelativePath = path.relative(rootPath, fullPath);
	if (resolvedRelativePath.startsWith('..') || path.isAbsolute(resolvedRelativePath) || remaining <= 0) {
		return undefined;
	}
	try {
		const contents = await fs.readFile(fullPath);
		if (contents.includes(0)) {
			return undefined;
		}
		const text = contents.toString('utf8');
		const limit = Math.min(fileCharacterLimit, remaining);
		const suffix = text.length > limit ? `\n[truncated ${text.length - limit} characters]` : '';
		return { path: normalizePath(resolvedRelativePath), kind, content: text.slice(0, limit) + suffix };
	} catch {
		return undefined;
	}
}

async function listScannableSourcePaths(rootPath: string): Promise<string[]> {
	const paths: string[] = [];
	const visit = async (relativeDirectory: string): Promise<void> => {
		const directory = path.join(rootPath, relativeDirectory);
		const entries = await fs.readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const relativePath = path.join(relativeDirectory, entry.name);
			if (entry.isDirectory()) {
				if (!isExcludedSourceDirectory(entry.name)) {
					await visit(relativePath);
				}
				continue;
			}
			if (entry.isFile()) {
				const normalized = normalizePath(relativePath);
				if (isScannableSourcePath(normalized)) {
					paths.push(normalized);
				}
			}
		}
	};

	await visit('');
	return paths;
}

export async function collectFullWorkspaceContext(rootPath: string, maxCharacters: number): Promise<ReviewContextBundle> {
	const allPaths = await listScannableSourcePaths(rootPath);
	if (!allPaths.length) {
		throw new Error('当前工作区没有可扫描的源码或配置文件。');
	}

	const gitStatus = truncateReviewInput(allPaths.map(filePath => `A  ${filePath}`).join('\n'), Math.min(maxCharacters, 10_000));
	const changedPaths = new Set(allPaths);
	const analysisContext = collectTypeScriptCodeGraph(rootPath, allPaths, changedPaths, Math.floor(maxCharacters * 0.2));
	const analysisContextCharacters = analysisContext ? JSON.stringify(analysisContext).length : 0;
	let remaining = Math.max(0, maxCharacters - gitStatus.length - analysisContextCharacters);
	const files: ReviewContextFile[] = [];
	for (const filePath of allPaths) {
		const file = await readContextFile(rootPath, filePath, 'changed', remaining);
		if (file) {
			files.push(file);
			remaining -= file.path.length + file.kind.length + file.content.length;
		}
	}

	return { gitStatus, diff: '', files, analysisContext, scanScope: 'full' };
}

export async function collectWorkspaceContext(rootPath: string, maxCharacters: number, includedPaths?: ReadonlySet<string>): Promise<ReviewContextBundle> {
	const gitRoot = await findGitRoot(rootPath);

	const [status, staged, unstaged, stagedNames, unstagedNames, untrackedOutput, repositoryFiles] = await Promise.all([
		runGit(gitRoot, ['status', '--short']),
		runGit(gitRoot, ['diff', '--cached', '--no-ext-diff', '--no-color', '--unified=40', '--']),
		runGit(gitRoot, ['diff', '--no-ext-diff', '--no-color', '--unified=40', '--']),
		runGit(gitRoot, ['diff', '--cached', '--name-only', '-z', '--']),
		runGit(gitRoot, ['diff', '--name-only', '-z', '--']),
		runGit(gitRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
		runGit(gitRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']),
	]);

	if (!status.trim()) {
		throw new NoChangesError();
	}

	const changedPaths = new Set([...splitNullSeparated(stagedNames), ...splitNullSeparated(unstagedNames), ...splitNullSeparated(untrackedOutput)]
		.map(normalizePath)
		.filter(candidate => isScannableSourcePath(candidate) && (!includedPaths || includedPaths.has(candidate))));
	if (!changedPaths.size) {
		throw new NoChangesError();
	}
	const allPaths = splitNullSeparated(repositoryFiles).map(normalizePath).filter(isScannableSourcePath);
	const gitStatus = truncateReviewInput(filterStatus(status, changedPaths).trim(), Math.min(maxCharacters, 10_000));
	const combinedDiff = [filterDiff(staged, changedPaths).trim(), filterDiff(unstaged, changedPaths).trim()].filter(Boolean).join('\n\n');
	const diffBudget = Math.max(0, Math.floor(maxCharacters * 0.6) - gitStatus.length);
	const diff = truncateReviewInput(combinedDiff, diffBudget);
	const analysisContext = collectTypeScriptCodeGraph(gitRoot, allPaths, changedPaths, Math.floor(maxCharacters * 0.2));
	const analysisContextCharacters = analysisContext ? JSON.stringify(analysisContext).length : 0;
	let remaining = Math.max(0, maxCharacters - gitStatus.length - diff.length - analysisContextCharacters);
	const candidates = [
		...[...changedPaths].map(filePath => ({ path: filePath, kind: 'changed' as const })),
		...allPaths.filter(filePath => !changedPaths.has(filePath) && isRelatedTest(filePath, changedPaths)).map(filePath => ({ path: filePath, kind: 'test' as const })),
		...allPaths.filter(filePath => !changedPaths.has(filePath) && isRootConfiguration(filePath)).map(filePath => ({ path: filePath, kind: 'config' as const })),
	];
	const files: ReviewContextFile[] = [];
	for (const candidate of candidates) {
		const file = await readContextFile(gitRoot, candidate.path, candidate.kind, remaining);
		if (file) {
			files.push(file);
			remaining -= file.path.length + file.kind.length + file.content.length;
		}
	}

	return { gitStatus, diff, files, analysisContext };
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, 'utf8');
}

function decodeUTF8Prefix(contents: Buffer): string {
	for (let end = contents.length; end >= Math.max(0, contents.length - 3); end -= 1) {
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(contents.subarray(0, end));
		} catch {
			// A UTF-8 code point can span at most four bytes.
		}
	}
	return '';
}

async function readSourceSnapshotFile(fullPath: string, maxBytes: number): Promise<string | undefined> {
	if (maxBytes <= 0) {
		return undefined;
	}
	const stats = await fs.lstat(fullPath);
	if (!stats.isFile()) {
		return undefined;
	}
	const markerBytes = byteLength(sourceSnapshotTruncationMarker);
	const truncated = stats.size > maxBytes;
	const includeMarker = truncated && maxBytes >= markerBytes;
	const readLimit = truncated ? Math.max(0, maxBytes - (includeMarker ? markerBytes : 0)) : Math.min(stats.size, maxBytes);
	const handle = await fs.open(fullPath, 'r');
	try {
		const buffer = Buffer.alloc(readLimit);
		const { bytesRead } = await handle.read(buffer, 0, readLimit, 0);
		const contents = buffer.subarray(0, bytesRead);
		if (contents.includes(0)) {
			return undefined;
		}
		return decodeUTF8Prefix(contents) + (includeMarker ? sourceSnapshotTruncationMarker : '');
	} finally {
		await handle.close();
	}
}

export async function collectSourceSnapshot(
	rootPath: string,
	context: ReviewContextBundle,
	maxBytes = sourceSnapshotByteLimit,
	evidencePaths: readonly string[] = [],
): Promise<ReviewContextBundle> {
	const gitRoot = await findGitRoot(rootPath);
	const files: ReviewContextFile[] = [];
	const contextFilesByPath = new Map(context.files.map(file => [normalizePath(file.path).replace(/^\.\//, ''), file]));
	const candidates: Array<Pick<ReviewContextFile, 'path' | 'kind'>> = [];
	const seenPaths = new Set<string>();
	const addCandidate = (filePath: string, defaultKind: ReviewContextFile['kind']) => {
		const normalized = normalizePath(filePath).replace(/^\.\//, '');
		if (!normalized || seenPaths.has(normalized) || !isScannableSourcePath(normalized)) {
			return;
		}
		seenPaths.add(normalized);
		const contextFile = contextFilesByPath.get(normalized);
		candidates.push({ path: normalized, kind: contextFile?.kind ?? defaultKind });
	};
	for (const evidencePath of evidencePaths) {
		addCandidate(evidencePath, 'evidence');
	}
	for (const contextFile of context.files) {
		addCandidate(contextFile.path, contextFile.kind);
	}

	const metadataBytes = candidates.reduce((total, file) => total + byteLength(file.path) + byteLength(file.kind), 0);
	let remainingContentBytes = Math.max(0, maxBytes - byteLength(context.gitStatus) - byteLength(context.diff) - metadataBytes);
	for (const [index, contextFile] of candidates.entries()) {
		const fullPath = path.resolve(gitRoot, contextFile.path);
		const relativePath = path.relative(gitRoot, fullPath);
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			continue;
		}
		try {
			const remainingFiles = candidates.length - index;
			const contentBudget = Math.floor(remainingContentBytes / remainingFiles);
			const content = await readSourceSnapshotFile(fullPath, contentBudget);
			if (content === undefined) {
				continue;
			}
			files.push({ path: normalizePath(relativePath), kind: contextFile.kind, content });
			remainingContentBytes -= byteLength(content);
		} catch {
			// Deleted or unreadable files remain represented by the Git diff.
		}
	}
	return { gitStatus: context.gitStatus, diff: context.diff, files };
}

export async function collectFullSourceSnapshot(
	rootPath: string,
	context: ReviewContextBundle,
	maxBytes = sourceSnapshotByteLimit,
	evidencePaths: readonly string[] = [],
): Promise<ReviewContextBundle> {
	const allPaths = await listScannableSourcePaths(rootPath);
	const contextFilesByPath = new Map(context.files.map(file => [normalizePath(file.path).replace(/^\.\//, ''), file]));
	const orderedPaths = [...new Set([...evidencePaths, ...allPaths].map(filePath => {
		const relativePath = path.relative(rootPath, path.resolve(rootPath, filePath));
		if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
			return undefined;
		}
		return normalizePath(relativePath);
	}).filter((filePath): filePath is string => filePath !== undefined))];
	const candidates = orderedPaths
		.filter(filePath => filePath && isScannableSourcePath(filePath))
		.map(filePath => ({ path: filePath, kind: contextFilesByPath.get(filePath)?.kind ?? 'changed' as const }));
	const metadataBytes = candidates.reduce((total, file) => total + byteLength(file.path) + byteLength(file.kind), 0);
	let remainingContentBytes = Math.max(0, maxBytes - byteLength(context.gitStatus) - metadataBytes);
	const files: ReviewContextFile[] = [];

	for (const [index, candidate] of candidates.entries()) {
		try {
			const contentBudget = Math.floor(remainingContentBytes / (candidates.length - index));
			const content = await readSourceSnapshotFile(path.resolve(rootPath, candidate.path), contentBudget);
			if (content === undefined) {
				continue;
			}
			files.push({ path: candidate.path, kind: candidate.kind, content });
			remainingContentBytes -= byteLength(content);
		} catch {
			// Files can disappear while a full scan is collecting its snapshot.
		}
	}

	return { gitStatus: context.gitStatus, diff: '', files };
}
