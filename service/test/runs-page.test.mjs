// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The Playground run page (/runs/<id>, #32): its shell, its policy, and the
// model it renders from (public/runs/model.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import {
  checkRecord, checkState, checkSummary, eventProduct, hashesToCheck, parseEvents, runArtifacts, runIdOfPath, runStatus,
  skillUrl, txCheckOf, txUrl, addressUrl, QUIET_MS,
} from '../public/runs/model.js';
import { fixtureRun } from '../../playground/src/fixture.ts';

const dir = new URL('../public/runs/', import.meta.url);
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;

test('/runs and /runs/<id> serve the page with the strict policy; a run’s files are the assets binding’s', async () => {
  const served = [];
  const deps = {
    config: resolveChainConfig({ CHAIN_ID: '968' }), publicClient: null, relayerAddress: null, txIndex: null,
    storage: { kv: false, r2: false }, shares: null, relay: null,
    sitePage: async (path) => { served.push(path); return new Response('<!doctype html><title>runs</title>'); },
  };
  for (const path of ['/runs', '/runs/', '/runs/run-20261007T120000Z-ab12', '/runs/run-20261007T120000Z-ab12/']) {
    const response = await handleRequest(new Request(`http://service.test${path}`), deps);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'/);
  }
  assert.deepEqual([...new Set(served)], ['/runs/index.html']);
  for (const path of ['/runs/x/provenance.json', '/runs/x/screenshots/a.png', '/runs/index.json']) {
    assert.equal((await handleRequest(new Request(`http://service.test${path}`), deps)).status, 404, `${path} is a file, not the page`);
  }
});

test('the page uses the shared shell, builds no markup from strings, and reads only this service', () => {
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/site\/site\.css">\s*<link rel="stylesheet" href="\/runs\/runs\.css">/);
  assert.match(html, /<script type="module" src="\/runs\/app\.js"><\/script>/);
  assert.match(html, /<a href="\/runs" aria-current="page">运行记录<\/a>/);
  assert.match(html, /<footer class="site-foot">/);
  assert.doesNotMatch(html, /\sstyle=|<script>|\son[a-z]+=/, 'no inline style or script for the CSP to block');
  // The page's own files; published runs are directories next to them.
  for (const file of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && /\.(html|js|css)$/.test(entry.name)).map((entry) => entry.name)) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    if (file.endsWith('.js')) assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, file);
    assert.doesNotMatch(source, /(?:src|href)=["']https?:|fetch\(['"`]https?:|url\(['"]?https?:/, `${file} loads nothing from another origin`);
  }
  const app = readFileSync(new URL('app.js', dir), 'utf8');
  assert.match(app, /fetch\(`\/v1\/txs\?hashes=\$\{chunk\.join\(','\)\}`/);
  assert.doesNotMatch(app, /explorerUrl/, 'explorer links come from the chain id, never from the record');
});

test('paths name one run or the list', () => {
  assert.equal(runIdOfPath('/runs'), null);
  assert.equal(runIdOfPath('/runs/'), null);
  assert.equal(runIdOfPath('/runs/run-20261007T120000Z-ab12'), 'run-20261007T120000Z-ab12');
  assert.equal(runIdOfPath('/runs/run-1/'), 'run-1');
  assert.equal(runIdOfPath('/runs/bad%20id'), undefined);
  assert.equal(runIdOfPath('/runs/a/b'), undefined);
});

test('events are read as written: in order, other runs’ and broken lines counted, a half-written line left', () => {
  const { events } = fixtureRun('run-x');
  const lines = events.slice(0, 4).map((e) => JSON.stringify(e));
  const text = [lines[1], lines[0], '{not json', JSON.stringify({ ...events[2], runId: 'run-y' }), lines[3], ''].join('\n') + lines[3].slice(0, 20);
  const parsed = parseEvents(text, 'run-x');
  assert.deepEqual(parsed.events.map((e) => e.seq), [1, 2, 4]);
  assert.equal(parsed.skipped, 2);
});

test('links go to the explorer of the run’s chain, and to the market for a minted Skill', () => {
  assert.equal(txUrl(968, hash(1)), `https://scan.bohr.life/tx/${hash(1)}`);
  assert.equal(txUrl(677, hash(1)), `https://scan.botchain.ai/tx/${hash(1)}`);
  assert.equal(txUrl(31337, hash(1)), null);
  assert.equal(txUrl(968, 'javascript:alert(1)'), null);
  assert.equal(addressUrl(677, `0x${'a'.repeat(40)}`), `https://scan.botchain.ai/address/0x${'a'.repeat(40)}`);
  assert.equal(skillUrl({ kind: 'skill-mint', ref: '12' }), '/market/skills/12');
  assert.equal(skillUrl({ kind: 'skill-draft', ref: 'job-application-materials' }), null);
  assert.equal(eventProduct({ type: 'transaction', data: { hash: hash(2) } }).kind, 'transaction');
  assert.equal(eventProduct({ type: 'screenshot', data: { file: '../../etc/x.png' } }).kind, 'local');
});

test('the on-chain check: each transaction’s state, the summary, and what to ask again', () => {
  const { record } = fixtureRun('run-x');
  assert.equal(checkRecord(record).ok, true);
  assert.equal(checkRecord({ ...record, schema: 'x' }).ok, false);
  const txs = runArtifacts(record).transactions;
  assert.equal(txs.length, record.totals.transactions);

  assert.equal(checkState(record, undefined, new Map()).mode, 'checking', 'still asking the service which chain');
  assert.equal(checkState(record, null, new Map()).mode, 'offline');
  assert.deepEqual(checkState(record, { chainId: 677 }, new Map()), { mode: 'other-chain', serviceChain: 677, runChain: 968 });
  assert.equal(checkState({ ...record, run: { ...record.run, dryRun: true } }, { chainId: 968 }, new Map()).mode, 'none');

  const results = new Map([
    [txs[0].hash, { status: 'confirmed' }],
    [txs[1].hash, { status: 'not_found' }],
    [txs[2].hash, { status: 'pending' }],
    [txs[3].hash, { status: 'unavailable' }],
  ]);
  const state = checkState(record, { chainId: 968 }, results);
  assert.equal(txCheckOf(state, txs[0].hash.toUpperCase().replace('0X', '0x')), 'confirmed');
  assert.equal(txCheckOf(state, txs[5].hash), 'checking');
  const summary = checkSummary(state, txs);
  assert.deepEqual([summary.confirmed, summary.not_found, summary.pending, summary.unavailable, summary.checking, summary.done], [1, 1, 1, 1, 2, false]);
  assert.deepEqual(hashesToCheck(txs, results), [txs[2].hash, txs[3].hash, txs[4].hash, txs[5].hash], 'confirmed and missing ones are final');
  assert.deepEqual(hashesToCheck(txs, results, true), [txs[1].hash, txs[2].hash, txs[3].hash, txs[4].hash, txs[5].hash], 'while the run goes, a missing one is asked again');
  assert.equal(txCheckOf(checkState(record, null, results), txs[0].hash), 'offline');
});

test('a running run that has gone quiet says so', () => {
  const { record } = fixtureRun('run-x', { elapsed: 40 });
  const now = Date.parse(record.run.startedAt) + 60_000;
  assert.equal(runStatus(record, now - 1_000, now).key, 'running');
  assert.equal(runStatus(record, now - QUIET_MS - 60_000, now).key, 'quiet');
});
