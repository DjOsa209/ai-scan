import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPlatformScanInput } from '../src/scanSubmission.ts';

test('platform scan submission includes every user-selected scope rule', () => {
  const input = buildPlatformScanInput({
    project: 'payments',
    repositoryUrl: 'https://git.example.com/payments.git',
    repositoryToken: ' repo-secret ',
    branch: 'release',
    commitId: '',
    estimatedLines: 12000,
    scanLevel: '标准检查',
    priority: '普通',
    excludes: ['node_modules', 'docs'],
    excludePatterns: ['*.min.js', '*.md'],
    scanDirectories: 'src/, server',
    vulnerabilityTypes: ['SQL注入', '硬编码密钥'],
  });

  assert.deepEqual(input.excludeDirectories, ['node_modules', 'docs']);
  assert.deepEqual(input.excludePatterns, ['*.min.js', '*.md']);
  assert.deepEqual(input.scanDirectories, ['src', 'server']);
  assert.deepEqual(input.vulnerabilityTypes, ['SQL注入', '硬编码密钥']);
  assert.equal(input.scanLevel, 'standard');
  assert.equal(input.repositoryToken, 'repo-secret');
});

test('platform scan submission omits an empty repository token', () => {
  const input = buildPlatformScanInput({
    project: 'public', repositoryUrl: 'https://git.example.com/public.git', repositoryToken: ' ', branch: 'main', commitId: '',
    estimatedLines: 1000, scanLevel: '轻量体验', priority: '普通', excludes: [], excludePatterns: [], scanDirectories: '', vulnerabilityTypes: [],
  });
  assert.equal('repositoryToken' in input, false);
});

test('platform scan submission accepts a custom product name', () => {
  const input = buildPlatformScanInput({
    product: ' 自定义产品 ', project: 'custom', repositoryUrl: 'https://git.example.com/custom.git', repositoryToken: '', branch: 'main', commitId: '',
    estimatedLines: 1000, scanLevel: '轻量体验', priority: '普通', excludes: [], excludePatterns: [], scanDirectories: '', vulnerabilityTypes: [],
  });
  assert.equal(input.productName, '自定义产品');
  assert.equal('productId' in input, false);
});

test('platform scan levels map to independent backend queues', () => {
  const base = {
    project: 'payments', repositoryUrl: 'https://git.example.com/payments.git', repositoryToken: '', branch: 'main', commitId: '',
    estimatedLines: 1000, priority: '普通' as const, excludes: [], excludePatterns: [], scanDirectories: '', vulnerabilityTypes: [],
  };
  assert.equal(buildPlatformScanInput({ ...base, scanLevel: '轻量体验' }).scanLevel, 'lite');
  assert.equal(buildPlatformScanInput({ ...base, scanLevel: '标准检查' }).scanLevel, 'standard');
  assert.equal(buildPlatformScanInput({ ...base, scanLevel: '发布审计' }).scanLevel, 'release');
});
