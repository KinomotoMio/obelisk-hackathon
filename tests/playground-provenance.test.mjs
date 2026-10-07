// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { repoRoot } from './cli-test-helpers.mjs';
import { validateEvent, validateProvenance } from '../playground/src/provenance.ts';
import { extractArtifacts } from '../playground/src/record-command.ts';

test('role fetch installs in its workspace even when the keychain needs the real HOME', () => {
  const dir = mkdtempSync(join(tmpdir(), 'obelisk-role-fetch-'));
  try {
    const cli = join(dir, 'cli.mjs');
    writeFileSync(cli, 'console.log(JSON.stringify({argv:process.argv.slice(2),home:process.env.HOME}))');
    const env = { ...process.env, OBELISK_PLAYGROUND_CLI: cli, OBELISK_PLAYGROUND_COMMAND_LOG: '', OBELISK_PLAYGROUND_WORKSPACE: join(dir, 'workspace'), OBELISK_PLAYGROUND_REAL_HOME: dir, HOME: join(dir, 'isolated-home') };
    for (const extra of [[], ['--project', join(dir, 'explicit')]]) {
      const result = spawnSync(process.execPath, ['playground/src/record-command.ts', 'skill', 'fetch', '10', '--harness', 'codex', ...extra], { cwd: repoRoot, env, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.home, dir);
      assert.deepEqual(output.argv.slice(-2), extra.length ? extra : ['--project', join(dir, 'workspace')]);
      assert.equal(output.argv.filter(x => x === '--project').length, 1);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('previewing a Skill is not recorded as installing or minting it', () => {
  assert.deepEqual(extractArtifacts(['skill', 'fetch', '9'], { preview: true, name: 'example' }), [{ kind: 'skill-fetch-preview', ref: 'example' }]);
  assert.deepEqual(extractArtifacts(['skill', 'mint', 'example'], { preview: true, skill: 'example' }), [{ kind: 'skill-mint-preview', ref: 'example' }]);
  assert.deepEqual(extractArtifacts(['skill', 'fetch', '9', '--confirm'], { status: 'installed', name: 'example' }), [{ kind: 'skill-fetch', ref: 'example' }]);
});

const examples = join(repoRoot, 'playground', 'examples');
const example = () => JSON.parse(readFileSync(join(examples, 'provenance.example.json'), 'utf8'));

test('the example provenance record and event stream follow the schema', () => {
  assert.deepEqual(validateProvenance(example()), []);
  const lines = readFileSync(join(examples, 'events.example.jsonl'), 'utf8').trim().split('\n');
  lines.forEach((line, i) => {
    const event = JSON.parse(line);
    assert.deepEqual(validateEvent(event), [], `line ${i + 1}`);
    assert.equal(event.seq, i + 1);
  });
});

test('provenance validation names each problem by path', () => {
  const record = example();
  record.steps[1].role = 'Z';
  record.steps[1].transactions[0].hash = '0x1234';
  record.steps[1].screenshots[0].file = '/abs/shot.png';
  record.run.status = 'done';
  assert.deepEqual(validateProvenance(record).sort(), [
    'run.status: must be one of running, succeeded, failed, aborted',
    'steps[1].role: must name a role in roles',
    'steps[1].screenshots[0]: must have a relative file and a caption',
    'steps[1].transactions[0].hash: must be a 0x transaction hash',
  ]);
});

test('provenance totals must match the steps they summarize', () => {
  const record = example();
  record.totals.transactions += 1;
  const [problem] = validateProvenance(record);
  assert.match(problem, /^totals: must match the roles and steps/);
});
