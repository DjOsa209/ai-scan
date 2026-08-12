import type { PlatformScanDetail } from './api';
import type { ScanLog } from './types';
import { sanitizeUserVisibleText, userVisibleStage } from './taskPresentation.ts';

type DetailFields = Pick<PlatformScanDetail, 'logs' | 'reportJson' | 'reportMarkdown'>;

export function scannedFileCount(reportJson: string | undefined, snapshotFileCount: number): number {
  if (!reportJson) return snapshotFileCount;
  try {
    const report = JSON.parse(reportJson) as { coverage?: { checked?: unknown } };
    return Array.isArray(report.coverage?.checked) ? report.coverage.checked.length : snapshotFileCount;
  } catch {
    return snapshotFileCount;
  }
}

function formatLogTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

export function mergeTaskDetail<T extends { logs: readonly unknown[]; reportJson?: string; reportMarkdown?: string }>(task: T, detail: DetailFields): Omit<T, 'logs' | 'reportJson' | 'reportMarkdown'> & { logs: ScanLog[]; reportJson?: string; reportMarkdown?: string } {
  const persistedLogs: ScanLog[] = (detail.logs ?? []).map((entry) => ({
    time: formatLogTime(entry.createdAt),
    level: entry.level,
    message: sanitizeUserVisibleText(entry.message),
    stage: userVisibleStage(entry.stage),
    progress: entry.progress,
  }));
  return {
    ...task,
    logs: persistedLogs.length ? persistedLogs : task.logs as ScanLog[],
    reportJson: detail.reportJson,
    reportMarkdown: detail.reportMarkdown,
  };
}
