import type { CodeSnippet } from './types';

export interface SnapshotSourceFile {
  path: string;
  content: string;
}

export interface EvidenceLocation {
  path: string;
  line: number;
  title: string;
}

function normalizeRepositoryPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^file:\/\//, '')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function findSourceFile(sourceFiles: readonly SnapshotSourceFile[], requestedPath: string) {
  const normalizedRequestedPath = normalizeRepositoryPath(requestedPath);
  if (!normalizedRequestedPath) return undefined;

  const normalizedFiles = sourceFiles.map((source) => ({
    source,
    path: normalizeRepositoryPath(source.path),
  }));
  const exactMatch = normalizedFiles.find((candidate) => candidate.path === normalizedRequestedPath);
  if (exactMatch) return exactMatch.source;

  const suffixMatches = normalizedFiles.filter((candidate) => (
    candidate.path.endsWith(`/${normalizedRequestedPath}`)
    || normalizedRequestedPath.endsWith(`/${candidate.path}`)
  ));
  return suffixMatches.length === 1 ? suffixMatches[0].source : undefined;
}

export function buildEvidenceSnippets(
  sourceFiles: readonly SnapshotSourceFile[],
  locations: readonly EvidenceLocation[],
  contextLines = 4,
): CodeSnippet[] {
  const seen = new Set<string>();
  const snippets: CodeSnippet[] = [];

  for (const location of locations) {
    const normalizedPath = normalizeRepositoryPath(location.path);
    const line = Math.trunc(location.line);
    const locationKey = `${normalizedPath}:${line}`;
    if (!normalizedPath || !Number.isFinite(line) || line < 1 || seen.has(locationKey)) continue;
    seen.add(locationKey);

    const source = findSourceFile(sourceFiles, location.path);
    if (!source?.content) continue;
    const sourceLines = source.content.split('\n');
    if (line > sourceLines.length) continue;
    const startLine = Math.max(1, line - contextLines);
    const endLine = Math.min(sourceLines.length, line + contextLines);
    snippets.push({
      title: location.title,
      file: location.path,
      startLine,
      highlightLine: line,
      code: sourceLines.slice(startLine - 1, endLine).join('\n'),
    });
  }

  return snippets;
}

export function snippetUnavailableReason(
  sourceFiles: readonly SnapshotSourceFile[],
  locations: readonly EvidenceLocation[],
) {
  if (!locations.some((location) => location.path.trim())) {
    return '报告没有提供可用于提取源码的文件位置。';
  }
  if (!sourceFiles.length) {
    return '本次扫描未上传源码快照，无法还原报告定位处的代码；请使用最新版插件重新扫描。';
  }
  const paths = [...new Set(locations.map((location) => location.path).filter(Boolean))];
  const shownPaths = paths.slice(0, 2).join('、');
  return `源码快照中未找到报告定位文件${shownPaths ? `（${shownPaths}${paths.length > 2 ? ' 等' : ''}）` : ''}，请重新扫描以补全代码片段。`;
}
