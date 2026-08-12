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
exports.NoChangesError = void 0;
exports.findGitRoot = findGitRoot;
exports.getRepositoryIdentity = getRepositoryIdentity;
exports.getFullWorkspaceIdentity = getFullWorkspaceIdentity;
exports.truncateReviewInput = truncateReviewInput;
exports.collectFullWorkspaceContext = collectFullWorkspaceContext;
exports.collectWorkspaceContext = collectWorkspaceContext;
exports.collectSourceSnapshot = collectSourceSnapshot;
exports.collectFullSourceSnapshot = collectFullSourceSnapshot;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const util_1 = require("util");
const codeGraph_1 = require("./codeGraph");
const sourceFilter_1 = require("./sourceFilter");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
const gitBufferLimit = 5 * 1024 * 1024;
const fileCharacterLimit = 30_000;
const sourceSnapshotByteLimit = 23 * 1024 * 1024;
const sourceSnapshotTruncationMarker = '\n[truncated for source snapshot upload]';
class NoChangesError extends Error {
    constructor() {
        super('The workspace has no uncommitted changes to review.');
        this.name = 'NoChangesError';
    }
}
exports.NoChangesError = NoChangesError;
async function runGit(rootPath, args) {
    const { stdout } = await execFileAsync('git', ['-C', rootPath, ...args], {
        encoding: 'utf8',
        maxBuffer: gitBufferLimit,
    });
    return stdout;
}
async function findGitRoot(startPath) {
    let workingDirectory = startPath;
    try {
        if (!(await fs_1.promises.stat(startPath)).isDirectory()) {
            workingDirectory = path.dirname(startPath);
        }
    }
    catch {
        workingDirectory = path.dirname(startPath);
    }
    try {
        return (await runGit(workingDirectory, ['rev-parse', '--show-toplevel'])).trim();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not a git repository/i.test(message)) {
            throw new Error('当前扫描目录不是 Git 仓库。请在项目根目录执行 git init，或打开已有 Git 仓库后重试。');
        }
        throw error;
    }
}
async function getRepositoryIdentity(rootPath, workspaceName) {
    const gitRoot = await findGitRoot(rootPath);
    let repositoryUrl = '';
    try {
        repositoryUrl = (await runGit(gitRoot, ['remote', 'get-url', 'origin'])).trim();
    }
    catch {
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
    }
    catch {
        // Detached HEAD is handled below.
    }
    if (!gitRef) {
        gitRef = (await runGit(gitRoot, ['rev-parse', '--short', 'HEAD'])).trim();
    }
    return { repositoryUrl, gitRef };
}
function getFullWorkspaceIdentity(workspaceName) {
    return {
        repositoryUrl: `workspace://local/${encodeURIComponent(workspaceName)}`,
        gitRef: 'full-scan',
    };
}
function truncateReviewInput(input, maxCharacters) {
    if (input.length <= maxCharacters) {
        return input;
    }
    const omitted = input.length - maxCharacters;
    return `${input.slice(0, maxCharacters)}\n\n[review input truncated; ${omitted} characters omitted]`;
}
function splitNullSeparated(value) {
    return value.split('\0').filter(Boolean);
}
function normalizePath(value) {
    return value.split(path.sep).join('/');
}
function filterStatus(status, allowedPaths) {
    return status.split('\n').filter(line => {
        const rawPath = line.slice(3).trim();
        const currentPath = normalizePath(rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) ?? rawPath : rawPath);
        return allowedPaths.has(currentPath);
    }).join('\n');
}
function filterDiff(diff, allowedPaths) {
    return diff.split(/(?=^diff --git )/m).filter(section => {
        if (!section.startsWith('diff --git ')) {
            return false;
        }
        const header = section.split('\n', 1)[0];
        const match = header.match(/^diff --git a\/(.+) b\/(.+)$/);
        return !!match && allowedPaths.has(normalizePath(match[2]));
    }).join('');
}
function isRelatedTest(candidate, changedPaths) {
    const basename = path.posix.basename(candidate).replace(/\.(test|spec)\.[^.]+$/, '').replace(/\.[^.]+$/, '');
    return /(^|\/)(__tests__|tests?|testdata)(\/|$)|\.(test|spec)\.[^.]+$/.test(candidate)
        && [...changedPaths].some(changed => path.posix.basename(changed).replace(/\.[^.]+$/, '') === basename);
}
function isRootConfiguration(candidate) {
    return !candidate.includes('/') && /^(package(-lock)?\.json|go\.(mod|sum)|pyproject\.toml|requirements.*\.txt|Cargo\.(toml|lock)|pom\.xml|build\.gradle|tsconfig.*\.json|Dockerfile|docker-compose\.ya?ml)$/.test(candidate);
}
async function readContextFile(rootPath, relativePath, kind, remaining) {
    const fullPath = path.resolve(rootPath, relativePath);
    const resolvedRelativePath = path.relative(rootPath, fullPath);
    if (resolvedRelativePath.startsWith('..') || path.isAbsolute(resolvedRelativePath) || remaining <= 0) {
        return undefined;
    }
    try {
        const contents = await fs_1.promises.readFile(fullPath);
        if (contents.includes(0)) {
            return undefined;
        }
        const text = contents.toString('utf8');
        const limit = Math.min(fileCharacterLimit, remaining);
        const suffix = text.length > limit ? `\n[truncated ${text.length - limit} characters]` : '';
        return { path: normalizePath(resolvedRelativePath), kind, content: text.slice(0, limit) + suffix };
    }
    catch {
        return undefined;
    }
}
async function listScannableSourcePaths(rootPath) {
    const paths = [];
    const visit = async (relativeDirectory) => {
        const directory = path.join(rootPath, relativeDirectory);
        const entries = await fs_1.promises.readdir(directory, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) {
                if (!(0, sourceFilter_1.isExcludedSourceDirectory)(entry.name)) {
                    await visit(relativePath);
                }
                continue;
            }
            if (entry.isFile()) {
                const normalized = normalizePath(relativePath);
                if ((0, sourceFilter_1.isScannableSourcePath)(normalized)) {
                    paths.push(normalized);
                }
            }
        }
    };
    await visit('');
    return paths;
}
async function collectFullWorkspaceContext(rootPath, maxCharacters) {
    const allPaths = await listScannableSourcePaths(rootPath);
    if (!allPaths.length) {
        throw new Error('当前工作区没有可扫描的源码或配置文件。');
    }
    const gitStatus = truncateReviewInput(allPaths.map(filePath => `A  ${filePath}`).join('\n'), Math.min(maxCharacters, 10_000));
    const changedPaths = new Set(allPaths);
    const analysisContext = (0, codeGraph_1.collectTypeScriptCodeGraph)(rootPath, allPaths, changedPaths, Math.floor(maxCharacters * 0.2));
    const analysisContextCharacters = analysisContext ? JSON.stringify(analysisContext).length : 0;
    let remaining = Math.max(0, maxCharacters - gitStatus.length - analysisContextCharacters);
    const files = [];
    for (const filePath of allPaths) {
        const file = await readContextFile(rootPath, filePath, 'changed', remaining);
        if (file) {
            files.push(file);
            remaining -= file.path.length + file.kind.length + file.content.length;
        }
    }
    return { gitStatus, diff: '', files, analysisContext, scanScope: 'full' };
}
async function collectWorkspaceContext(rootPath, maxCharacters, includedPaths) {
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
        .filter(candidate => (0, sourceFilter_1.isScannableSourcePath)(candidate) && (!includedPaths || includedPaths.has(candidate))));
    if (!changedPaths.size) {
        throw new NoChangesError();
    }
    const allPaths = splitNullSeparated(repositoryFiles).map(normalizePath).filter(sourceFilter_1.isScannableSourcePath);
    const gitStatus = truncateReviewInput(filterStatus(status, changedPaths).trim(), Math.min(maxCharacters, 10_000));
    const combinedDiff = [filterDiff(staged, changedPaths).trim(), filterDiff(unstaged, changedPaths).trim()].filter(Boolean).join('\n\n');
    const diffBudget = Math.max(0, Math.floor(maxCharacters * 0.6) - gitStatus.length);
    const diff = truncateReviewInput(combinedDiff, diffBudget);
    const analysisContext = (0, codeGraph_1.collectTypeScriptCodeGraph)(gitRoot, allPaths, changedPaths, Math.floor(maxCharacters * 0.2));
    const analysisContextCharacters = analysisContext ? JSON.stringify(analysisContext).length : 0;
    let remaining = Math.max(0, maxCharacters - gitStatus.length - diff.length - analysisContextCharacters);
    const candidates = [
        ...[...changedPaths].map(filePath => ({ path: filePath, kind: 'changed' })),
        ...allPaths.filter(filePath => !changedPaths.has(filePath) && isRelatedTest(filePath, changedPaths)).map(filePath => ({ path: filePath, kind: 'test' })),
        ...allPaths.filter(filePath => !changedPaths.has(filePath) && isRootConfiguration(filePath)).map(filePath => ({ path: filePath, kind: 'config' })),
    ];
    const files = [];
    for (const candidate of candidates) {
        const file = await readContextFile(gitRoot, candidate.path, candidate.kind, remaining);
        if (file) {
            files.push(file);
            remaining -= file.path.length + file.kind.length + file.content.length;
        }
    }
    return { gitStatus, diff, files, analysisContext };
}
function byteLength(value) {
    return Buffer.byteLength(value, 'utf8');
}
function decodeUTF8Prefix(contents) {
    for (let end = contents.length; end >= Math.max(0, contents.length - 3); end -= 1) {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(contents.subarray(0, end));
        }
        catch {
            // A UTF-8 code point can span at most four bytes.
        }
    }
    return '';
}
async function readSourceSnapshotFile(fullPath, maxBytes) {
    if (maxBytes <= 0) {
        return undefined;
    }
    const stats = await fs_1.promises.lstat(fullPath);
    if (!stats.isFile()) {
        return undefined;
    }
    const markerBytes = byteLength(sourceSnapshotTruncationMarker);
    const truncated = stats.size > maxBytes;
    const includeMarker = truncated && maxBytes >= markerBytes;
    const readLimit = truncated ? Math.max(0, maxBytes - (includeMarker ? markerBytes : 0)) : Math.min(stats.size, maxBytes);
    const handle = await fs_1.promises.open(fullPath, 'r');
    try {
        const buffer = Buffer.alloc(readLimit);
        const { bytesRead } = await handle.read(buffer, 0, readLimit, 0);
        const contents = buffer.subarray(0, bytesRead);
        if (contents.includes(0)) {
            return undefined;
        }
        return decodeUTF8Prefix(contents) + (includeMarker ? sourceSnapshotTruncationMarker : '');
    }
    finally {
        await handle.close();
    }
}
async function collectSourceSnapshot(rootPath, context, maxBytes = sourceSnapshotByteLimit, evidencePaths = []) {
    const gitRoot = await findGitRoot(rootPath);
    const files = [];
    const contextFilesByPath = new Map(context.files.map(file => [normalizePath(file.path).replace(/^\.\//, ''), file]));
    const candidates = [];
    const seenPaths = new Set();
    const addCandidate = (filePath, defaultKind) => {
        const normalized = normalizePath(filePath).replace(/^\.\//, '');
        if (!normalized || seenPaths.has(normalized) || !(0, sourceFilter_1.isScannableSourcePath)(normalized)) {
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
        }
        catch {
            // Deleted or unreadable files remain represented by the Git diff.
        }
    }
    return { gitStatus: context.gitStatus, diff: context.diff, files };
}
async function collectFullSourceSnapshot(rootPath, context, maxBytes = sourceSnapshotByteLimit, evidencePaths = []) {
    const allPaths = await listScannableSourcePaths(rootPath);
    const contextFilesByPath = new Map(context.files.map(file => [normalizePath(file.path).replace(/^\.\//, ''), file]));
    const orderedPaths = [...new Set([...evidencePaths, ...allPaths].map(filePath => {
            const relativePath = path.relative(rootPath, path.resolve(rootPath, filePath));
            if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                return undefined;
            }
            return normalizePath(relativePath);
        }).filter((filePath) => filePath !== undefined))];
    const candidates = orderedPaths
        .filter(filePath => filePath && (0, sourceFilter_1.isScannableSourcePath)(filePath))
        .map(filePath => ({ path: filePath, kind: contextFilesByPath.get(filePath)?.kind ?? 'changed' }));
    const metadataBytes = candidates.reduce((total, file) => total + byteLength(file.path) + byteLength(file.kind), 0);
    let remainingContentBytes = Math.max(0, maxBytes - byteLength(context.gitStatus) - metadataBytes);
    const files = [];
    for (const [index, candidate] of candidates.entries()) {
        try {
            const contentBudget = Math.floor(remainingContentBytes / (candidates.length - index));
            const content = await readSourceSnapshotFile(path.resolve(rootPath, candidate.path), contentBudget);
            if (content === undefined) {
                continue;
            }
            files.push({ path: candidate.path, kind: candidate.kind, content });
            remainingContentBytes -= byteLength(content);
        }
        catch {
            // Files can disappear while a full scan is collecting its snapshot.
        }
    }
    return { gitStatus: context.gitStatus, diff: '', files };
}
//# sourceMappingURL=gitChanges.js.map