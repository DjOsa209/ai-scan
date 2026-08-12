import assert from 'node:assert/strict';
import test from 'node:test';

import { rescanPlatformScan } from '../src/api.ts';

test('rescan submits the existing task to the backend', async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = '';
  let requestedMethod = '';
  globalThis.fetch = async (input, init) => {
    requestedURL = String(input);
    requestedMethod = init?.method ?? 'GET';
    return new Response(JSON.stringify({ id: 'scan-new', estimatedCredits: 88 }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const created = await rescanPlatformScan('scan/old');
    assert.equal(requestedURL, '/api/v1/scans/scan%2Fold/rescan');
    assert.equal(requestedMethod, 'POST');
    assert.equal(created.id, 'scan-new');
  } finally {
    globalThis.fetch = originalFetch;
  }
});