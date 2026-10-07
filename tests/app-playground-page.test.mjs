// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The App's 「来源：Playground」 marks (#32): run status labels, the summary on
// a Skill page, and 查看产生方法, which opens the run's published web page.
// The run page itself is on the web (service/public/runs, tested in
// service/test/runs-page.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { publishedRunPage } from '../app/src/main/playground-runs.ts';
import { runStatus, sourceSummary } from '../app/src/renderer/src/playground.mjs';

const NOW = Date.parse('2026-10-07T13:20:00Z');
const run = (status) => ({ run: { status } });

test('a run’s status is labelled, and a quiet running run says so', () => {
  assert.deepEqual(runStatus(run('succeeded')), { key: 'succeeded', label: '已完成', tone: 'ok' });
  assert.equal(runStatus(run('failed')).tone, 'danger');
  assert.equal(runStatus(run('running'), NOW - 1_000, NOW).label, '运行中');
  assert.equal(runStatus(run('running'), NOW - 5 * 60_000, NOW).label, '5 分钟没有新动静');
});

test('the Skill page sums the runs it came from', () => {
  assert.deepEqual(sourceSummary([
    { mintedBy: ['作者 A'], roles: 4, sessions: 3 },
    { mintedBy: [], roles: 1, sessions: 1 },
  ]), { runs: 2, mintedBy: ['作者 A'], roles: 5, sessions: 4 });
});

test('查看产生方法 opens a run’s page only once the service has it', async () => {
  const asked = [];
  const service = (status) => async (url) => { asked.push(url); return new Response('{}', { status }); };
  const base = 'https://obelisk-service.example.workers.dev/';

  assert.deepEqual(await publishedRunPage(base, 'run-20261007T120000Z-ab12', service(200)),
    { ok: true, url: 'https://obelisk-service.example.workers.dev/runs/run-20261007T120000Z-ab12' });
  assert.deepEqual(asked, ['https://obelisk-service.example.workers.dev/runs/run-20261007T120000Z-ab12/published.json']);

  assert.deepEqual(await publishedRunPage(base, 'run-1', service(404)), {
    ok: false, reason: 'unpublished', url: 'https://obelisk-service.example.workers.dev/runs/run-1', command: 'npm run playground -- publish run-1',
  });
  assert.equal((await publishedRunPage(base, 'run-1', service(502))).reason, 'unreachable');
  assert.equal((await publishedRunPage(base, 'run-1', async () => { throw new Error('offline'); })).reason, 'unreachable');

  asked.length = 0;
  for (const id of ['../x', 'a/b', 'run.1', '', null, 'x'.repeat(97)]) {
    assert.deepEqual(await publishedRunPage(base, id, service(200)), { ok: false, reason: 'invalid' }, String(id));
  }
  assert.deepEqual(asked, [], 'nothing is fetched for an id that is not a run id');
});
