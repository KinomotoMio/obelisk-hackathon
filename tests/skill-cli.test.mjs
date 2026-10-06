// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { skillBodyFromMarkdown, skillFingerprint } from '../packages/core/src/skills.ts';
import { runCli } from './cli-test-helpers.mjs';
import { makeTempDir } from './temp-dirs.mjs';

const probeSkillMd = readFileSync(new URL('./fixtures/claude/skills/fingerprint-probe/SKILL.md', import.meta.url), 'utf8');

const draft = {
  name: 'fingerprint-probe',
  description: 'probe',
  birthScenes: ['task/testing'],
  provenance: [
    { sessionId: 'session-a', reason: 'Probe skill captured here' },
    { sessionId: 'session-b', reason: 'Fingerprint rule checked here' },
  ],
};

test('CLI saves, lists, shows, and fingerprints Skills in its own data directory', () => {
  const home = makeTempDir('obelisk-skills-cli-');
  const aliceEnv = { OBELISK_HOME: join(home, 'alice') };
  const bobEnv = { OBELISK_HOME: join(home, 'bob') };
  const work = join(home, 'work');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'SKILL.md'), probeSkillMd);
  writeFileSync(join(work, 'draft.json'), JSON.stringify({ ...draft, bodyFile: 'SKILL.md' }));

  const saved = runCli(['skill', 'save', join(work, 'draft.json')], { home, env: aliceEnv });
  assert.equal(saved.status, 0, saved.stderr || saved.stdout);
  const expected = skillFingerprint(skillBodyFromMarkdown(probeSkillMd));
  assert.equal(JSON.parse(saved.stdout).fingerprint, expected);
  assert.ok(existsSync(join(home, 'alice', 'skills', 'fingerprint-probe', 'skill.json')));

  const fingerprint = runCli(['skill', 'fingerprint', join(work, 'SKILL.md')], { home, env: aliceEnv });
  assert.equal(JSON.parse(fingerprint.stdout).fingerprint, expected);

  const shown = runCli(['skill', 'show', 'fingerprint-probe'], { home, env: aliceEnv });
  assert.equal(shown.status, 0, shown.stderr || shown.stdout);
  assert.equal(JSON.parse(shown.stdout).provenance.length, 2);

  const aliceList = JSON.parse(runCli(['skill', 'list'], { home, env: aliceEnv }).stdout);
  const bobList = JSON.parse(runCli(['skill', 'list'], { home, env: bobEnv }).stdout);
  assert.deepEqual(aliceList.map((s) => s.name), ['fingerprint-probe']);
  assert.deepEqual(bobList, [], 'another data directory has its own Skill library');

  const missing = runCli(['skill', 'show', 'nope'], { home, env: aliceEnv });
  assert.equal(missing.status, 1);
  assert.match(JSON.parse(missing.stdout).error, /Skill not found in the local library: nope/);
});

test('CLI lists the fixed scene list by dimension and refuses scenes outside it', () => {
  const home = makeTempDir('obelisk-skills-cli-');
  const env = { OBELISK_HOME: join(home, 'data') };
  const scenes = runCli(['skill', 'scenes'], { home, env });
  assert.equal(scenes.status, 0, scenes.stderr || scenes.stdout);
  const dimensions = JSON.parse(scenes.stdout);
  assert.deepEqual(dimensions.map((d) => d.id), ['domain', 'task', 'artifact']);
  const ids = dimensions.flatMap((d) => d.scenes.map((scene) => scene.id));
  assert.ok(ids.includes('artifact/resume'));
  assert.ok(dimensions.every((d) => d.scenes.every((scene) => scene.id.startsWith(`${d.id}/`) && scene.label)));

  const work = join(home, 'work');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'draft.json'), JSON.stringify({ ...draft, body: '# Probe', birthScenes: ['求职材料'] }));
  const refused = runCli(['skill', 'save', join(work, 'draft.json')], { home, env });
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stdout).error, /not in the fixed scene list; pick ids from `obelisk skill scenes`/);
});
