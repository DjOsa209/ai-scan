import assert from 'node:assert/strict';
import test from 'node:test';

import { BEIJING_OFFSET_MINUTES, formatBeijingDate, formatBeijingDateTime, formatBeijingTime } from '../src/beijingTime.ts';

test('formats UTC instants in Beijing time', () => {
  const instant = '2026-08-08T16:30:00Z';

  assert.equal(BEIJING_OFFSET_MINUTES, 480);
  assert.equal(formatBeijingDate(instant), '2026-08-09');
  assert.equal(formatBeijingDateTime(instant), '2026-08-09 00:30');
  assert.equal(formatBeijingTime(instant), '00:30:00');
});
