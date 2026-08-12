import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('finding status updates every task collection used by the UI', async () => {
  const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const updateFinding = source.match(/function updateFinding\(updated: Finding\) \{([\s\S]*?)\n  \}/)?.[1] ?? '';

  assert.match(updateFinding, /setTasks\(/);
  assert.match(updateFinding, /setPluginTasks\(/);
  assert.match(updateFinding, /setMyTasks\(/);
});