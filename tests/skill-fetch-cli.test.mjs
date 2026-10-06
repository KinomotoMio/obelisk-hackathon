// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk skill fetch` (#17) through the built CLI. Alice mints through the
// CLI against an in-memory SkillRegistry service (skill-chain-fakes.mjs);
// Bob, with his own HOME and data directory, fetches into Claude Code, and
// his captured Claude Code loads of that Skill are recognized as uses of the
// minted version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { skillBodyFromMarkdown, skillFingerprint } from '../packages/core/src/skills.ts';
import { supported } from './chain-cli-fakes.mjs';
import { setupPeople, startFakeSkillService } from './skill-chain-fakes.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const probeMd = readFileSync(new URL('claude/skills/fingerprint-probe/SKILL.md', fixtures), 'utf8');
const probeBody = skillBodyFromMarkdown(probeMd);
const probeFp = skillFingerprint(probeBody);
const claudeLoads = readFileSync(new URL('claude/skill-load-session.jsonl', fixtures), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const skip = !supported && 'system keychain not supported here';

const probeDraft = {
  name: 'fingerprint-probe',
  description: 'Fixture skill for Obelisk fingerprint tests. Use only when explicitly asked to run fingerprint-probe.',
  body: probeMd,
  birthScenes: ['v1:task/testing'],
};

test('"fetch Skill #1": preview with the body, install the exact minted body into Claude Code, record it, and recognize its uses', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    const minted = await alice.mint(probeDraft);
    const target = join(bob.home, '.claude', 'skills', 'fingerprint-probe', 'SKILL.md');

    const byName = await bob.run('skill', 'fetch', 'fingerprint-probe');
    assert.equal(byName.status, 1);
    assert.match(byName.json.error, /Skill id .* or the full 64-hex fingerprint/);

    const preview = await bob.ok('skill', 'fetch', '1');
    assert.equal(preview.preview, true);
    assert.equal(preview.installTo, target);
    assert.equal(preview.body, probeBody);
    assert.equal(preview.description, probeDraft.description);
    assert.deepEqual(
      { fingerprint: preview.skill.fingerprint, author: preview.skill.author, version: preview.skill.version },
      { fingerprint: probeFp, author: minted.author, version: 1 },
    );
    assert.match(preview.trust, new RegExp(minted.author));
    assert.ok(preview.next.includes(`obelisk skill fetch ${probeFp} --confirm`));
    assert.equal(existsSync(target), false, 'a preview installs nothing');

    const unbound = await bob.run('skill', 'fetch', '1', '--confirm');
    assert.equal(unbound.status, 1);
    assert.match(unbound.json.error, /--confirm takes the fingerprint from the preview/);

    const installed = await bob.ok('skill', 'fetch', probeFp, '--confirm');
    assert.equal(installed.status, 'installed');
    assert.equal(installed.installedTo, target);
    const installedMd = readFileSync(target, 'utf8');
    assert.equal(skillFingerprint(skillBodyFromMarkdown(installedMd)), probeFp, 'the installed SKILL.md hashes to the minted fingerprint');
    assert.match(installedMd, /^---\nname: fingerprint-probe\ndescription: "Fixture skill/);
    const { fetches } = JSON.parse(readFileSync(join(bob.skillsDir, 'fetched-skills.json'), 'utf8'));
    assert.deepEqual(
      fetches.map(({ name, fingerprint, chainId, skillId, versionIndex, author, installedTo }) => ({ name, fingerprint, chainId, skillId, versionIndex, author, installedTo })),
      [{ name: 'fingerprint-probe', fingerprint: probeFp, chainId: 968, skillId: '1', versionIndex: 0, author: minted.author, installedTo: target }],
    );
    assert.equal((await bob.ok('skill', 'fetch', probeFp, '--confirm')).status, 'already_installed');

    // Bob's Claude Code then loads it: captured loads of this exact body.
    const projects = join(bob.home, '.claude', 'projects', '-tmp-probe');
    mkdirSync(projects, { recursive: true });
    for (const record of claudeLoads) writeFileSync(join(projects, `${record.sessionId}.jsonl`), `${JSON.stringify(record)}\n`);
    const usage = await bob.ok('skill', 'invocations', 'fingerprint-probe');
    assert.equal(usage.invocations, claudeLoads.length);
    assert.deepEqual(
      usage.versions.map(({ state, fingerprint, fetched }) => ({ state, fingerprint, skillId: fetched.skillId, author: fetched.author })),
      [{ state: 'fetched', fingerprint: probeFp, skillId: '1', author: minted.author }],
    );
    const overview = await bob.ok('skill', 'invocations');
    assert.deepEqual(overview.library.map((entry) => [entry.name, entry.state, entry.invocations]), [['fingerprint-probe', 'fetched', claudeLoads.length]]);
    assert.deepEqual(overview.other, []);
  } finally {
    service.close();
  }
});

test('fetch updates what it installed, pins a version, installs per project, and renames on request', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    const v1 = await alice.mint({ ...probeDraft, name: 'ai-resume', body: '# AI resume\n\nCollect the evidence first.' });
    await bob.ok('skill', 'fetch', v1.fingerprint, '--confirm');
    const v2 = await alice.mint({ ...probeDraft, name: 'ai-resume', body: '# AI resume\n\nCollect the evidence first.\n\nThen draft.' });
    assert.equal(v2.version, 2);

    const update = await bob.ok('skill', 'fetch', '1');
    assert.match(update.action, /^Replace the installed ai-resume with Skill #1 version 2/);
    assert.deepEqual({ skillId: update.replaces.skillId, version: update.replaces.version }, { skillId: '1', version: 1 });
    const updated = await bob.ok('skill', 'fetch', v2.fingerprint, '--confirm');
    assert.equal(updated.status, 'updated');

    const pinnedPreview = await bob.ok('skill', 'fetch', '1', '--version', '1', '--name', 'ai-resume-v1');
    assert.equal(pinnedPreview.skill.fingerprint, v1.fingerprint);
    assert.ok(pinnedPreview.next.includes(`obelisk skill fetch ${v1.fingerprint} --confirm --name ai-resume-v1`));
    const pinned = await bob.ok('skill', 'fetch', v1.fingerprint, '--confirm', '--name', 'ai-resume-v1');
    assert.equal(pinned.installedTo, join(bob.home, '.claude', 'skills', 'ai-resume-v1', 'SKILL.md'));

    const project = join(bob.home, 'project');
    const local = await bob.ok('skill', 'fetch', v2.fingerprint, '--project', project, '--confirm');
    assert.equal(local.installedTo, join(project, '.claude', 'skills', 'ai-resume', 'SKILL.md'));
  } finally {
    service.close();
  }
});

test('fetch refuses to overwrite a foreign Skill, to install a body that does not match the chain, or a Skill that does not exist', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    await alice.mint(probeDraft);

    const foreign = join(bob.home, '.claude', 'skills', 'fingerprint-probe', 'SKILL.md');
    mkdirSync(join(foreign, '..'), { recursive: true });
    writeFileSync(foreign, '---\nname: fingerprint-probe\ndescription: mine\n---\n\nSomething else.\n');
    const conflict = await bob.run('skill', 'fetch', probeFp, '--confirm');
    assert.equal(conflict.status, 1);
    assert.match(conflict.json.error, /already holds a different Skill .* --name/);
    assert.match(readFileSync(foreign, 'utf8'), /Something else/, 'the foreign Skill is untouched');

    service.respond.tamper = true;
    const tampered = await bob.run('skill', 'fetch', probeFp, '--name', 'probe-copy', '--confirm');
    assert.equal(tampered.status, 1);
    assert.match(tampered.json.error, /does not hash to its on-chain fingerprint/);
    assert.equal(existsSync(join(bob.home, '.claude', 'skills', 'probe-copy')), false);

    const missing = await bob.run('skill', 'fetch', '9');
    assert.equal(missing.status, 1);
    assert.match(missing.json.error, /not minted/);
  } finally {
    service.close();
  }
});
