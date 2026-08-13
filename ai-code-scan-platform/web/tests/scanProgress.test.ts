import assert from 'node:assert/strict';
import test from 'node:test';

import { averageTokenRate, formatScanElapsed, formatTokenCount, scanElapsedSeconds } from '../src/scanProgress.ts';

test('scan progress derives live elapsed time from the task start', () => {
  assert.equal(scanElapsedSeconds('2026-08-13T10:00:00Z', Date.parse('2026-08-13T10:01:12Z')), 72);
  assert.equal(scanElapsedSeconds(undefined), 0);
  assert.equal(scanElapsedSeconds('invalid'), 0);
});

test('scan progress formats elapsed time at useful precision', () => {
  assert.equal(formatScanElapsed(42), '42秒');
  assert.equal(formatScanElapsed(198), '3分18秒');
  assert.equal(formatScanElapsed(3723), '1小时2分3秒');
});

test('scan progress calculates a stable average token rate', () => {
  assert.equal(averageTokenRate(8360, 42), 199);
  assert.equal(averageTokenRate(8360, 0), 0);
  assert.equal(averageTokenRate(undefined, 42), 0);
});

test('scan progress presents cumulative tokens compactly', () => {
  assert.equal(formatTokenCount(8360), '8.36K');
  assert.equal(formatTokenCount(1200), '1.20K');
  assert.equal(formatTokenCount(2_500_000), '2.50M');
});