// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk skill mint` (#16) through the built CLI, with a fake keychain and
// an in-memory SkillRegistry service (skill-chain-fakes.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { skillBodyFromMarkdown, skillFingerprint } from '../packages/core/src/skills.ts';
import { supported } from './chain-cli-fakes.mjs';
import { setupPeople, startFakeSkillService } from './skill-chain-fakes.mjs';

const probeMd = readFileSync(new URL('./fixtures/claude/skills/fingerprint-probe/SKILL.md', import.meta.url), 'utf8');
const probeBody = skillBodyFromMarkdown(probeMd);
const probeFp = skillFingerprint(probeBody);

const skip = !supported && 'system keychain not supported here';

const probeDraft = {
  name: 'fingerprint-probe',
  description: 'Fixture skill for Obelisk fingerprint tests. Use only when explicitly asked to run fingerprint-probe.',
  body: probeMd,
  birthScenes: ['v1:artifact/resume', 'task/testing', 'user:context/播客'],
  provenance: [{ sessionId: 'session-a', reason: 'captured here' }, { sessionId: 'session-b', reason: 'checked here' }],
};

test('"mint this Skill": preview first, then sign only the previewed fingerprint; the service pays and keeps the body', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice } = setupPeople(service, ['alice']);
    await alice.ok('wallet', 'create');
    await alice.saveDraft(probeDraft);

    const preview = await alice.ok('skill', 'mint', 'fingerprint-probe');
    assert.equal(preview.preview, true);
    assert.equal(preview.action, 'Mint a new Skill in SkillRegistry');
    assert.equal(preview.fingerprint, probeFp);
    assert.equal(preview.network, 'BOT Chain testnet (968)');
    assert.match(preview.author, /^0x[0-9a-fA-F]{40}$/);
    assert.deepEqual(
      preview.birthScenes.map((scene) => scene.tag),
      ['v1:artifact/resume', 'v1:task/testing', 'user:context/播客'],
      'birth scenes go on chain in the versioned format',
    );
    assert.ok(preview.birthScenes.every((scene) => scene.label));
    assert.equal(preview.parent, null);
    assert.equal(preview.provenanceSessions, 2);
    assert.match(preview.visibility, /publicly/);
    assert.match(preview.fee, /not charged/);
    assert.ok(preview.next.includes(`obelisk skill mint fingerprint-probe --confirm ${probeFp}`));
    assert.equal(service.relays.length, 0, 'a preview submits nothing');

    const stale = await alice.run('skill', 'mint', 'fingerprint-probe', '--confirm', 'f'.repeat(64));
    assert.equal(stale.status, 1);
    assert.match(stale.json.error, /changed since the preview/);
    assert.equal(service.relays.length, 0);

    const minted = await alice.ok('skill', 'mint', 'fingerprint-probe', '--confirm', probeFp);
    assert.equal(minted.status, 'minted');
    assert.deepEqual(
      { skillId: minted.skillId, version: minted.version, fingerprint: minted.fingerprint, bodyStored: minted.bodyStored },
      { skillId: '1', version: 1, fingerprint: probeFp, bodyStored: true },
    );
    assert.match(minted.explorer.transaction, /^https:\/\/scan\.bohr\.life\/tx\/0x/);
    assert.ok(minted.next.includes(`obelisk skill fetch ${probeFp}`));
    assert.deepEqual(service.skills[0].birthScenes, preview.birthScenes.map((scene) => scene.tag));
    assert.equal(service.contents.get(`0x${probeFp}`).body, probeBody);

    const shown = await alice.ok('skill', 'show', 'fingerprint-probe');
    assert.equal(shown.status, 'minted');
    const [version] = shown.versions;
    assert.deepEqual(
      { skillId: version.mint.skillId, versionIndex: version.mint.versionIndex, txHash: version.mint.txHash, verified: version.verified },
      { skillId: '1', versionIndex: 0, txHash: minted.transaction, verified: true },
    );

    const again = await alice.ok('skill', 'mint', 'fingerprint-probe', '--confirm', probeFp);
    assert.equal(again.status, 'already_minted');
    assert.equal(service.relays.length, 1, 'confirming twice does not mint twice');
  } finally {
    service.close();
  }
});

test('a changed draft of a minted Skill publishes a new version; a derived Skill names its parent', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice } = setupPeople(service, ['alice']);
    await alice.ok('wallet', 'create');
    await alice.mint({ ...probeDraft, name: 'ai-resume', body: '# AI resume\n\nCollect the evidence first.' });

    await alice.saveDraft({ ...probeDraft, name: 'ai-resume', body: '# AI resume\n\nCollect the evidence first.\n\nThen draft each section.' });
    const preview = await alice.ok('skill', 'mint', 'ai-resume');
    assert.equal(preview.action, 'Publish version 2 of Skill #1 in SkillRegistry');
    assert.equal(preview.version, 2);
    assert.equal(preview.birthScenes, undefined, 'a new version keeps the minted birth scenes');
    const published = await alice.ok('skill', 'mint', 'ai-resume', '--confirm', preview.fingerprint);
    assert.deepEqual({ status: published.status, version: published.version }, { status: 'version_published', version: 2 });
    assert.equal(service.skills.length, 1);
    assert.equal(service.skills[0].versions.length, 2);
    assert.deepEqual((await alice.ok('skill', 'show', 'ai-resume')).versions.map((version) => version.mint.versionIndex), [0, 1]);

    await alice.saveDraft({ ...probeDraft, name: 'ai-resume-designer', body: '# AI resume for designers', parent: { name: 'ai-resume' } });
    const derived = await alice.ok('skill', 'mint', 'ai-resume-designer');
    assert.equal(derived.parent.skillId, '1');
    await alice.ok('skill', 'mint', 'ai-resume-designer', '--confirm', derived.fingerprint);
    assert.equal(service.skills[1].parentSkillId, 1n);

    await alice.saveDraft({ ...probeDraft, name: 'orphan', body: '# Orphan', parent: { name: 'never-minted' } });
    const orphan = await alice.run('skill', 'mint', 'orphan');
    assert.equal(orphan.status, 1);
    assert.match(orphan.json.error, /Parent Skill never-minted is not minted .*obelisk skill mint never-minted/);
  } finally {
    service.close();
  }
});

test('deriving from someone else\'s minted Skill (#20): read it without installing, save with its id as parent, mint records it', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    const minted = await alice.mint({ ...probeDraft, name: 'ai-resume', body: '# AI resume\n\nCollect the evidence first.' });

    assert.match(minted.author, /^0x[0-9a-fA-F]{40}$/);
    // What obelisk-distill does for "在 Skill #1「ai-resume」v1 的基础上改出一个新版本": a fetch preview.
    const parent = await bob.ok('skill', 'fetch', '1', '--version', '1', '--name', 'ai-resume-designer-portfolio');
    assert.equal(parent.preview, true);
    assert.equal(parent.body, '# AI resume\n\nCollect the evidence first.');
    assert.equal(parent.skill.skillId, '1');
    assert.equal(parent.skill.author, minted.author);
    assert.equal(existsSync(join(bob.home, '.claude', 'skills', 'ai-resume-designer-portfolio')), false, 'a preview installs nothing');

    await bob.ok('wallet', 'create');
    await bob.saveDraft({ ...probeDraft, name: 'ai-resume-designer-portfolio', body: '# AI resume for a designer portfolio\n\nCollect the evidence first.\n\nLead with the work samples.', parent: { skillId: '1' }, provenance: [] });
    const preview = await bob.ok('skill', 'mint', 'ai-resume-designer-portfolio');
    assert.deepEqual({ skillId: preview.parent.skillId, author: preview.parent.author }, { skillId: '1', author: minted.author });
    await bob.ok('skill', 'mint', 'ai-resume-designer-portfolio', '--confirm', preview.fingerprint);
    assert.equal(service.skills[1].parentSkillId, 1n, 'the parent is written on chain');
    assert.equal((await bob.ok('skill', 'show', 'ai-resume-designer-portfolio')).parent.skillId, '1');
  } finally {
    service.close();
  }
});

test('mint needs a wallet, finishes an interrupted mint without minting again, and refuses a body someone else minted', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.saveDraft(probeDraft);
    const noWallet = await alice.run('skill', 'mint', 'fingerprint-probe');
    assert.equal(noWallet.status, 1);
    assert.match(noWallet.json.error, /obelisk wallet create/);

    await alice.ok('wallet', 'create');
    service.respond.relay = 'pending';
    const submitted = await alice.ok('skill', 'mint', 'fingerprint-probe', '--confirm', probeFp);
    assert.equal(submitted.status, 'submitted');
    assert.match(submitted.next, /again to finish/);
    const status = await alice.ok('skill', 'mint', 'fingerprint-probe');
    assert.deepEqual(
      { status: status.status, bodyStored: status.bodyStored, recordedLocally: status.recordedLocally },
      { status: 'already_minted', bodyStored: false, recordedLocally: false },
    );
    const finished = await alice.ok('skill', 'mint', 'fingerprint-probe', '--confirm', probeFp);
    assert.deepEqual(
      { status: finished.status, bodyStored: finished.bodyStored, transaction: finished.transaction },
      { status: 'already_minted', bodyStored: true, transaction: null },
    );
    assert.equal(service.relays.length, 1, 'finishing a pending mint writes nothing new on chain');

    await bob.ok('wallet', 'create');
    await bob.saveDraft(probeDraft);
    const copied = await bob.run('skill', 'mint', 'fingerprint-probe');
    assert.equal(copied.status, 1);
    assert.match(copied.json.error, /already minted as Skill #1 by 0x/);

    const usage = await alice.run('skill', 'mint', 'fingerprint-probe', '--confirm');
    assert.equal(usage.status, 1);
    assert.match(usage.json.error, /--confirm takes the 64-hex fingerprint from the preview/);
  } finally {
    service.close();
  }
});
