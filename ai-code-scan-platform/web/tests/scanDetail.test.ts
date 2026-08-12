import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeTaskDetail, scannedFileCount } from '../src/scanDetail.ts';

test('historical detail preserves persisted logs and report content', () => {
  const task = { id: 'scan-1', logs: [], reportJson: undefined, reportMarkdown: undefined };
  const detail = {
    logs: [
      { createdAt: '2026-08-09T01:00:00Z', level: 'info' as const, stage: '获取代码', progress: 10, message: '代码已获取' },
      { createdAt: '2026-08-09T01:02:00Z', level: 'success' as const, stage: '报告生成', progress: 100, message: '报告已生成' },
    ],
    reportJson: '{"schemaVersion":"2.0"}',
    reportMarkdown: undefined,
  };

  const merged = mergeTaskDetail(task, detail);

  assert.equal(merged.logs.length, 2);
  assert.equal(merged.logs[0].message, '代码已获取');
  assert.equal(merged.logs[0].stage, '获取代码');
  assert.equal(merged.logs[1].progress, 100);
  assert.equal(merged.reportJson, detail.reportJson);
});

test('scan file count uses the report coverage manifest', () => {
  const reportJson = JSON.stringify({ coverage: { checked: ['src/a.ts', 'src/b.ts'] } });

  assert.equal(scannedFileCount(reportJson, 0), 2);
  assert.equal(scannedFileCount(undefined, 3), 3);
});
