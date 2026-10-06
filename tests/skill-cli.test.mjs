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

test('obelisk skill scenes prints the current vocabulary as ready-to-use tags and the recorded user tags', () => {
  const home = makeTempDir('obelisk-skills-cli-');
  const env = { OBELISK_HOME: join(home, 'data') };
  const scenes = runCli(['skill', 'scenes'], { home, env });
  assert.equal(scenes.status, 0, scenes.stderr || scenes.stdout);
  const out = JSON.parse(scenes.stdout);
  assert.equal(out.vocabulary, 'v1');
  assert.match(out.rule, /user:<dimension>\/<label>/);
  assert.deepEqual(out.limits, { perSkill: 16, bytesPerTag: 64 });
  assert.deepEqual(out.dimensions.map((d) => d.id), ['domain', 'task', 'artifact', 'context', 'role']);
  const tags = out.dimensions.flatMap((d) => d.tags.map((entry) => entry.tag));
  assert.ok(tags.includes('v1:artifact/resume'));
  assert.ok(out.dimensions.every((d) => d.tags.every((entry) => entry.tag.startsWith(`v1:${d.id}/`) && entry.label)));
  assert.deepEqual(out.userTags, []);

  const work = join(home, 'work');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'draft.json'), JSON.stringify({ ...draft, body: '# Probe', birthScenes: ['v1:task/testing', 'user:artifact/指纹样本'] }));
  assert.equal(runCli(['skill', 'save', join(work, 'draft.json')], { home, env }).status, 0);
  const after = JSON.parse(runCli(['skill', 'scenes'], { home, env }).stdout);
  assert.deepEqual(after.userTags, [{ tag: 'user:artifact/指纹样本', label: '指纹样本', skills: ['fingerprint-probe'] }]);

  writeFileSync(join(work, 'bad.json'), JSON.stringify({ ...draft, body: '# Probe', birthScenes: ['求职材料'] }));
  const refused = runCli(['skill', 'save', join(work, 'bad.json')], { home, env });
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stdout).error, /is not a tag in scene vocabulary v1; use a tag from `obelisk skill scenes`/);
});

test('用户可以手动添加或修改草稿的场景标签 with obelisk skill tag', () => {
  const home = makeTempDir('obelisk-skills-cli-');
  const env = { OBELISK_HOME: join(home, 'data') };
  const work = join(home, 'work');
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'draft.json'), JSON.stringify({ ...draft, body: '# Probe', birthScenes: ['task/testing', 'artifact/code'] }));
  const saved = JSON.parse(runCli(['skill', 'save', join(work, 'draft.json')], { home, env }).stdout);

  const tagged = runCli(['skill', 'tag', 'fingerprint-probe', '--remove', 'artifact/code', '--add', 'v1:role/engineer', '--add', 'user:artifact/指纹 样本'], { home, env });
  assert.equal(tagged.status, 0, tagged.stderr || tagged.stdout);
  assert.deepEqual(JSON.parse(tagged.stdout).birthScenes, [
    { tag: 'v1:task/testing', kind: 'vocabulary', dimension: 'task', label: '测试' },
    { tag: 'v1:role/engineer', kind: 'vocabulary', dimension: 'role', label: '工程师' },
    { tag: 'user:artifact/指纹-样本', kind: 'user', dimension: 'artifact', label: '指纹-样本' },
  ]);
  const shown = JSON.parse(runCli(['skill', 'show', 'fingerprint-probe'], { home, env }).stdout);
  assert.equal(shown.draft.fingerprint, saved.fingerprint, 'retagging leaves the body and its fingerprint alone');
  assert.ok(existsSync(join(home, 'data', 'skills', 'user-scene-tags.json')));

  const refused = runCli(['skill', 'tag', 'fingerprint-probe', '--add', 'task/nope'], { home, env });
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stdout).error, /is not a tag in scene vocabulary v1/);
  const usage = runCli(['skill', 'tag', 'fingerprint-probe', '--add'], { home, env });
  assert.match(JSON.parse(usage.stdout).error, /Usage: obelisk skill tag/);
});
