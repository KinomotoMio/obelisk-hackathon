// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { listRuns, resolvePlaygroundDir, skillSources } from '../app/src/main/playground-runs.ts';
import { repoRoot } from './cli-test-helpers.mjs';
import { BROKEN_RUN, liveRun, LIVE_RUN, SKILL_ID, SKILL_NAME, writePlaygroundFixture, writeRun } from './app-playground-fixtures.mjs';

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
});

test('the runner\'s example record is read as it is written', (t) => {
  const dir = tempDir(t);
  const runId = 'run-20261007T131000Z-7f3a';
  mkdirSync(join(dir, 'runs', runId), { recursive: true });
  copyFileSync(join(repoRoot, 'playground', 'examples', 'provenance.example.json'), join(dir, 'runs', runId, 'provenance.json'));
  const [run] = listRuns(dir);
  assert.equal(run.error, null);
  assert.equal(run.record.run.scenario.title, '冒烟：沉淀并铸造一个 Skill');
  assert.equal(run.record.run.network.chainId, 968);
  assert.equal(run.record.roles[1].harness.kind, 'codex');
  assert.equal(run.record.steps[0].scenes[0].label, '求职与实习');
  assert.equal(run.record.steps[1].transactions[0].command, 'skill mint');
  assert.equal(run.record.totals.transactions, 2);
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

test('a record that breaks the runner\'s schema is listed with the first problem', (t) => {
  const dir = fixture(t);
  const { record, events } = liveRun();
  record.totals.sessions = 99;
  writeRun(dir, 'run-totals', { record, events });
  const second = liveRun();
  second.record.steps[2].screenshots[0].file = 'screenshots/../../secret.png';
  writeRun(dir, 'run-path', second);
  const byId = Object.fromEntries(listRuns(dir).map((run) => [run.id, run]));
  assert.match(byId['run-totals'].error, /^totals: must match/);
  assert.equal(byId['run-path'].error, 'screenshot file is not in the expected format');
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
