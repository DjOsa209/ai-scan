import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidTimestamp, sanitizeUserVisibleText, userVisibleStage } from '../src/taskPresentation.ts';

test('removes internal scanner and model names from user-visible logs', () => {
  assert.equal(
    sanitizeUserVisibleText('Fortify、SonarQube 与 AI Security Agent 已完成检查'),
    '安全扫描引擎、安全扫描引擎 与 安全分析引擎 已完成检查',
  );
  assert.equal(userVisibleStage('AI深度审计'), '深度安全分析');
});

test('rejects historical placeholder values as report timestamps', () => {
  assert.equal(isValidTimestamp('unavailable'), false);
  assert.equal(isValidTimestamp('2026-08-10T07:32:00+08:00'), true);
});
