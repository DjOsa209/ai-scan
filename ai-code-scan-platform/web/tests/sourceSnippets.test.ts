import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvidenceSnippets } from '../src/sourceSnippets.ts';

test('builds snippets for finding locations and data-flow nodes across repository path prefixes', () => {
  const snippets = buildEvidenceSnippets(
    [
      {
        path: 'security-service/server/kafka_adapter/socengine/receiver.go',
        content: Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join('\n'),
      },
      {
        path: './server/service/socengine/soc_engine_alert.go',
        content: Array.from({ length: 90 }, (_, index) => `service line ${index + 1}`).join('\n'),
      },
    ],
    [
      { path: 'server/kafka_adapter/socengine/receiver.go', line: 74, title: '问题代码上下文' },
      { path: 'server/kafka_adapter/socengine/receiver.go', line: 197, title: 'Propagator 代码上下文' },
      { path: 'server/service/socengine/soc_engine_alert.go', line: 65, title: 'Propagator 代码上下文' },
    ],
  );

  assert.equal(snippets.length, 3);
  assert.deepEqual(
    snippets.map((snippet) => [snippet.file, snippet.highlightLine]),
    [
      ['server/kafka_adapter/socengine/receiver.go', 74],
      ['server/kafka_adapter/socengine/receiver.go', 197],
      ['server/service/socengine/soc_engine_alert.go', 65],
    ],
  );
  assert.match(snippets[0].code, /line 74/);
  assert.match(snippets[2].code, /service line 65/);
});

test('does not guess when a suffix path matches more than one source file', () => {
  const snippets = buildEvidenceSnippets(
    [
      { path: 'service-a/src/handler.go', content: 'a' },
      { path: 'service-b/src/handler.go', content: 'b' },
    ],
    [{ path: 'src/handler.go', line: 1, title: '问题代码上下文' }],
  );

  assert.deepEqual(snippets, []);
});
