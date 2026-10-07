// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readRun } from '../app/src/main/playground-runs.ts';
import {
  addressUrl,
  commandLine,
  currentStep,
  elapsedMs,
  eventFeed,
  eventProduct,
  formatElapsed,
  networkLabel,
  runArtifacts,
  runFailure,
  runStatus,
  sourceSummary,
  stepProgress,
  txUrl,
} from '../app/src/renderer/src/playground.mjs';
import { LIVE_RUN, txHash, wallet, writePlaygroundFixture } from './app-playground-fixtures.mjs';

const NOW = Date.parse('2026-10-07T13:20:00Z');

function runs(t) {
  const dir = mkdtempSync(join(tmpdir(), 'obelisk-playground-page-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writePlaygroundFixture(dir, { now: NOW });
  return {
    live: readRun(dir, LIVE_RUN),
    dry: readRun(dir, 'run-20261006T090000Z-dry'),
    failed: readRun(dir, 'run-20261005T140000Z-fail'),
  };
}

test('elapsed time reads like a stopwatch', () => {
  assert.equal(formatElapsed(222_000), '03:42');
  assert.equal(formatElapsed(3_723_000), '1:02:03');
  assert.equal(formatElapsed(-5), '00:00');
});

test('a live run shows its progress, current step, and elapsed time', (t) => {
  const { live } = runs(t);
  assert.deepEqual(stepProgress(live.record), { done: 6, total: 10 });
  assert.equal(currentStep(live.record).id, 'u3-task');
  assert.equal(elapsedMs(live.record, NOW), 222_000);
  assert.equal(networkLabel(live.record), 'BOT Chain 测试网');
  assert.deepEqual(runStatus(live.record, NOW - 4_000, NOW), { key: 'running', label: '运行中', tone: 'live' });
});

test('a running run that has gone quiet says so instead of claiming to run', (t) => {
  const { live } = runs(t);
  const status = runStatus(live.record, NOW - 5 * 60_000, NOW);
  assert.equal(status.key, 'quiet');
  assert.equal(status.label, '5 分钟没有新动静');
});

test('dry and failed runs are labelled for what they are', (t) => {
  const { dry, failed } = runs(t);
  assert.equal(networkLabel(dry.record), '空跑 · 未上链');
  assert.equal(runStatus(dry.record, 0, NOW).label, '已完成');
  assert.equal(runStatus(failed.record, 0, NOW).tone, 'danger');
  assert.deepEqual(
    { step: runFailure(failed.record, failed.events).step.id, error: runFailure(failed.record, failed.events).error },
    { step: 'a-share', error: 'B 的钱包还没有激活，分享无法加密' },
  );
  assert.equal(runFailure(dry.record, dry.events), null);
});

test('every count on the live page has the list behind it', (t) => {
  const { live } = runs(t);
  const products = runArtifacts(live.record);
  assert.equal(products.sessions.length, live.record.totals.sessions);
  assert.equal(products.transactions.length, live.record.totals.transactions);
  assert.equal(products.commands.length, live.record.totals.commands);
  assert.equal(products.screenshots.length, live.record.totals.screenshots);
  assert.equal(products.sessions[2].step.id, 'u1-task');
  assert.equal(products.tasks.length, 5);
  assert.deepEqual(products.scenes.map(scene => scene.label), ['求职与实习', '工程师', '简历与履历', '设计师', '作品集']);
  assert.deepEqual(products.harnesses.map(h => [h.kind, h.roles.length]), [['claude-code', 5], ['codex', 2]]);
});

test('events read newest first, filter by step, and point at what they produced', (t) => {
  const { live } = runs(t);
  const feed = eventFeed(live.events);
  assert.equal(feed[0].seq, 18);
  assert.deepEqual(eventFeed(live.events, 'b-open').map(event => event.seq), [8, 7]);
  assert.equal(eventProduct(feed.find(event => event.seq === 4)).kind, 'transaction');
  assert.equal(eventProduct(feed.find(event => event.seq === 3)).kind, 'session');
  assert.equal(eventProduct(feed.find(event => event.seq === 8)).kind, 'screenshot');
  assert.deepEqual(eventProduct(feed.find(event => event.seq === 6)), { kind: 'exit', exitCode: 1 });
  assert.equal(eventProduct(feed.find(event => event.seq === 1)).kind, 'local');
});

test('chain links go only to the explorer of a known chain', () => {
  assert.equal(txUrl(968, txHash('share')), `https://scan.bohr.life/tx/${txHash('share')}`);
  assert.equal(txUrl(677, txHash('share')), `https://scan.botchain.ai/tx/${txHash('share')}`);
  assert.equal(txUrl(31337, txHash('share')), null);
  assert.equal(txUrl(968, 'javascript:alert(1)'), null);
  assert.equal(addressUrl(968, wallet('A')), `https://scan.bohr.life/address/${wallet('A')}`);
  assert.equal(addressUrl(null, wallet('A')), null);
});

test('long hashes in commands are shortened for display', () => {
  const line = commandLine({ argv: ['skill', 'mint', 'x', '--confirm', 'ab'.repeat(32)] });
  assert.equal(line, 'obelisk skill mint x --confirm abababab…abab');
});

test('the Skill page sums the runs it came from', () => {
  assert.deepEqual(sourceSummary([
    { mintedBy: ['作者 A'], roles: 4, sessions: 3 },
    { mintedBy: [], roles: 1, sessions: 1 },
  ]), { runs: 2, mintedBy: ['作者 A'], roles: 5, sessions: 4 });
});
