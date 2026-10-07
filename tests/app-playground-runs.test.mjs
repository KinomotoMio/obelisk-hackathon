// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkEvent,
  displayDir,
  listRuns,
  readRun,
  readScreenshot,
  resolvePlaygroundDir,
  skillSources,
} from '../app/src/main/playground-runs.ts';
import { repoRoot } from './cli-test-helpers.mjs';
import { BROKEN_RUN, liveRun, LIVE_RUN, SKILL_ID, SKILL_NAME, txHash, writePlaygroundFixture, writeRun } from './app-playground-fixtures.mjs';

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'obelisk-playground-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const fixture = (t, options) => writePlaygroundFixture(tempDir(t), options);

test('the Playground home is the runner\'s, and the default one counts once it has runs', () => {
  const none = () => false;
  const some = () => true;
  assert.equal(resolvePlaygroundDir({ OBELISK_PLAYGROUND_HOME: '/runs/here' }, none), '/runs/here');
  assert.equal(resolvePlaygroundDir({ OBELISK_PLAYGROUND_HOME: 'relative' }, some), null);
  assert.equal(resolvePlaygroundDir({}, none), null);
  assert.equal(resolvePlaygroundDir({}, some), join(homedir(), '.obelisk-hackathon', 'playground'));
  assert.equal(displayDir(join('/home/u', '.obelisk-hackathon', 'playground'), '/home/u'), join('~', '.obelisk-hackathon', 'playground'));
  assert.equal(displayDir('/srv/runs', '/home/u'), '/srv/runs');
});

test('the runner\'s example record and events are read as they are written', (t) => {
  const dir = tempDir(t);
  const runId = 'run-20261007T131000Z-7f3a';
  mkdirSync(join(dir, 'runs', runId), { recursive: true });
  copyFileSync(join(repoRoot, 'playground', 'examples', 'provenance.example.json'), join(dir, 'runs', runId, 'provenance.json'));
  copyFileSync(join(repoRoot, 'playground', 'examples', 'events.example.jsonl'), join(dir, 'runs', runId, 'events.jsonl'));
  const run = readRun(dir, runId);
  assert.equal(run.error, null);
  assert.equal(run.record.run.scenario.title, '冒烟：沉淀并铸造一个 Skill');
  assert.equal(run.record.run.network.chainId, 968);
  assert.equal(run.record.roles[1].harness.kind, 'codex');
  assert.equal(run.record.steps[0].scenes[0].label, '求职与实习');
  assert.equal(run.record.steps[1].transactions[0].command, 'skill mint');
  assert.equal(run.record.totals.transactions, 2);
  assert.equal(run.events.length, 7);
  assert.equal(run.skipped, 0);
  assert.equal(run.events[2].session.obeliskId, '5b9e0c1e-0000-4000-8000-000000000001');
  assert.equal(run.events[5].transaction.hash, `0x${'3f'.repeat(32)}`);
  assert.equal(run.events[6].status, 'succeeded');
});

test('runs are listed newest first, with an unreadable record listed last with the reason', (t) => {
  const dir = fixture(t);
  const runs = listRuns(dir);
  assert.deepEqual(runs.map(run => run.id), [LIVE_RUN, 'run-20261006T090000Z-dry', 'run-20261005T140000Z-fail', BROKEN_RUN]);
  assert.equal(runs[0].record.run.status, 'running');
  assert.equal(runs[1].record.run.dryRun, true);
  assert.equal(runs[2].record.steps[0].error, 'B 的钱包还没有激活，分享无法加密');
  assert.equal(runs[3].record, null);
  assert.equal(runs[3].error, '不是有效的 JSON');
  assert.ok(runs[0].updatedAt > 0);
});

test('a run is read with its events in order, leaving a half-written last line for later', (t) => {
  const dir = fixture(t);
  appendFileSync(join(dir, 'runs', LIVE_RUN, 'events.jsonl'), '{"schema":"obelisk.playground.event/1","seq":99,"te');
  const run = readRun(dir, LIVE_RUN);
  assert.equal(run.events.length, 18);
  assert.equal(run.skipped, 0);
  assert.deepEqual(run.events.map(event => event.seq), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.equal(run.events[3].transaction.hash, txHash('share'));
  assert.equal(run.events[5].exitCode, 1);
  assert.equal(run.events[7].screenshot.file, 'screenshots/b-open.png');
});

test('event lines that do not follow the schema are counted, not shown', (t) => {
  const dir = fixture(t);
  const base = { schema: 'obelisk.playground.event/1', runId: LIVE_RUN, at: '2026-10-07T00:00:00Z', stepId: null, role: null, text: 'x', data: {} };
  appendFileSync(join(dir, 'runs', LIVE_RUN, 'events.jsonl'), [
    'not json',
    JSON.stringify({ ...base, seq: 0, type: 'note' }),
    JSON.stringify({ ...base, seq: 30, type: 'unknown' }),
    '',
  ].join('\n'));
  const run = readRun(dir, LIVE_RUN);
  assert.equal(run.events.length, 18);
  assert.equal(run.skipped, 3);
  // Data that does not have its type's shape is dropped; the line is kept as text.
  const event = checkEvent({ ...base, seq: 1, type: 'transaction', role: '../A', text: '<b>plain</b>', data: { hash: '0x12' } });
  assert.equal(event.text, '<b>plain</b>');
  assert.equal(event.role, null);
  assert.equal(event.transaction, undefined);
});

test('a record that breaks the runner\'s schema is rejected with the first problem', (t) => {
  const dir = fixture(t);
  const { record, events } = liveRun();
  record.totals.sessions = 99;
  writeRun(dir, 'run-totals', { record, events });
  assert.match(readRun(dir, 'run-totals').error, /^totals: must match/);

  const second = liveRun();
  second.record.steps[2].screenshots[0].file = 'screenshots/../../secret.png';
  writeRun(dir, 'run-path', second);
  assert.equal(readRun(dir, 'run-path').error, 'screenshot file is not in the expected format');
});

test('run ids from the renderer cannot leave the runs directory', (t) => {
  const dir = fixture(t);
  assert.equal(readRun(dir, `../runs/${LIVE_RUN}`), null);
  assert.equal(readRun(dir, '.'), null);
  assert.equal(readRun(dir, 12), null);
  assert.equal(readRun(dir, 'missing'), null);
});

test('screenshots are read only when a step lists them and they stay inside the run', (t) => {
  const dir = fixture(t);
  const shot = readScreenshot(dir, LIVE_RUN, 'screenshots/b-open.png');
  assert.equal(shot.ok, true);
  assert.match(shot.dataUrl, /^data:image\/png;base64,iVBOR/);
  assert.deepEqual(readScreenshot(dir, LIVE_RUN, '../run-20261006T090000Z-dry/provenance.json'), { ok: false, error: 'invalid' });
  assert.deepEqual(readScreenshot(dir, LIVE_RUN, 'screenshots/not-listed.png'), { ok: false, error: 'unknown' });

  const outside = join(dir, 'secret.png');
  writeFileSync(outside, 'secret');
  const listed = join(dir, 'runs', LIVE_RUN, 'screenshots', 'a-distill-mint.png');
  rmSync(listed);
  symlinkSync(outside, listed);
  assert.deepEqual(readScreenshot(dir, LIVE_RUN, 'screenshots/a-distill-mint.png'), { ok: false, error: 'outside' });
});

test('a minted Skill lists the runs on its chain whose steps name it', (t) => {
  const dir = fixture(t);
  const sources = skillSources(dir, { chainId: 968, skillId: SKILL_ID, name: SKILL_NAME });
  assert.equal(sources.length, 1);
  assert.deepEqual(
    { id: sources[0].id, mintedBy: sources[0].mintedBy, steps: sources[0].steps, roles: sources[0].roles, sessions: sources[0].sessions },
    { id: LIVE_RUN, mintedBy: ['作者 A'], steps: 4, roles: 4, sessions: 3 },
  );
  // By id alone the fetches still match; the mint names the Skill by name.
  assert.equal(skillSources(dir, { chainId: 968, skillId: SKILL_ID })[0].steps, 3);
  assert.deepEqual(skillSources(dir, { chainId: 677, skillId: SKILL_ID, name: SKILL_NAME }), []);
  assert.deepEqual(skillSources(dir, { chainId: 968, skillId: '7' }), []);
  assert.deepEqual(skillSources(dir, { chainId: '968', skillId: SKILL_ID }), []);
  assert.deepEqual(skillSources(dir, null), []);
});
