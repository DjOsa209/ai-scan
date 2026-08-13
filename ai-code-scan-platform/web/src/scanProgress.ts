export function scanElapsedSeconds(startedAt: string | undefined, now = Date.now()) {
  if (!startedAt) return 0;
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs)) return 0;
  return Math.max(0, Math.floor((now - startedAtMs) / 1000));
}

export function formatScanElapsed(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${remainder}秒`;
  if (minutes > 0) return `${minutes}分${remainder}秒`;
  return `${remainder}秒`;
}

export function averageTokenRate(totalTokens: number | undefined, elapsedSeconds: number) {
  if (!totalTokens || elapsedSeconds <= 0) return 0;
  return Math.round(totalTokens / elapsedSeconds);
}

export function formatTokenCount(totalTokens: number | undefined) {
  const tokens = Math.max(0, totalTokens ?? 0);
  if (tokens < 1000) return tokens.toLocaleString('en-US');
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(2).replace(/\.00$/, '')}K`;
  return `${(tokens / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
}