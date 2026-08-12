export function authenticatedScanTasks<T extends { createdAt: string }>(platformTasks: readonly T[], pluginTasks: readonly T[]): T[] {
  return [...platformTasks, ...pluginTasks].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function mergeRemoteTaskSummaries<T extends { id: string; remoteUpdatedAt?: string; detailLoaded?: boolean }>(current: readonly T[], incoming: readonly T[]): T[] {
  return incoming.map((task) => {
    const existing = current.find((item) => item.id === task.id);
    return existing?.detailLoaded && existing.remoteUpdatedAt === task.remoteUpdatedAt ? existing : task;
  });
}
