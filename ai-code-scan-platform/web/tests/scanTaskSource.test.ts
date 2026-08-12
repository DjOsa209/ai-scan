import assert from 'node:assert/strict';
import test from 'node:test';

import { authenticatedScanTasks, mergeRemoteTaskSummaries } from '../src/scanTaskSource.ts';

test('authenticated task views merge sources in reverse chronological order', () => {
  const platformTasks = [{ id: 'platform-1', createdAt: '2026-08-11T10:24:43Z' }];
  const pluginTasks = [{ id: 'plugin-1', createdAt: '2026-08-11T11:15:45Z' }];

  assert.deepEqual(authenticatedScanTasks(platformTasks, pluginTasks), [pluginTasks[0], platformTasks[0]]);
});

test('remote task changes invalidate previously loaded detail', () => {
  const current = [{ id: 'scan-1', remoteUpdatedAt: 'v1', detailLoaded: true, findings: ['finding-1'] }];

  assert.deepEqual(mergeRemoteTaskSummaries(current, [{ id: 'scan-1', remoteUpdatedAt: 'v1', findings: [] }]), current);
  assert.deepEqual(
    mergeRemoteTaskSummaries(current, [{ id: 'scan-1', remoteUpdatedAt: 'v2', findings: [] }]),
    [{ id: 'scan-1', remoteUpdatedAt: 'v2', findings: [] }],
  );
});
