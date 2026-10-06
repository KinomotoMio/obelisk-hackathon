// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk usage` (#23) through the built CLI. Alice mints a Skill; Bob
// fetches it, his Claude Code loads it (captured loads), and he reports that
// usage to an in-memory UsageStats (skill-chain-fakes.mjs): off by default,
// previewed before it is turned on, and only increases are sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { skillBodyFromMarkdown, skillFingerprint } from '../packages/core/src/skills.ts';
import { supported } from './chain-cli-fakes.mjs';
import { setupPeople, startFakeSkillService } from './skill-chain-fakes.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const probeMd = readFileSync(new URL('claude/skills/fingerprint-probe/SKILL.md', fixtures), 'utf8');
const probeFp = skillFingerprint(skillBodyFromMarkdown(probeMd));
const claudeLoads = readFileSync(new URL('claude/skill-load-session.jsonl', fixtures), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const skip = !supported && 'system keychain not supported here';

const probeDraft = {
  name: 'fingerprint-probe',
  description: 'Fixture skill for Obelisk fingerprint tests. Use only when explicitly asked to run fingerprint-probe.',
  body: probeMd,
  birthScenes: ['v1:task/testing'],
};

/** Captured Claude Code loads of the probe, written into `home`'s history; `tag` makes them new sessions. */
function writeLoads(home, tag = '') {
  const projects = join(home, '.claude', 'projects', '-tmp-probe');
  mkdirSync(projects, { recursive: true });
  for (const record of claudeLoads) {
    const sessionId = tag ? `${record.sessionId.slice(0, -tag.length)}${tag}` : record.sessionId;
    const uuid = tag ? `${record.uuid.slice(0, -tag.length)}${tag}` : record.uuid;
    writeFileSync(join(projects, `${sessionId}.jsonl`), `${JSON.stringify({ ...record, sessionId, uuid })}\n`);
  }
}

test('"开启上报": off by default, preview of exactly what is sent, then only increases are reported, once per wallet', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    const minted = await alice.mint(probeDraft);
    await bob.ok('wallet', 'create');
    await bob.ok('skill', 'fetch', probeFp, '--confirm');
    writeLoads(bob.home);

    const status = await bob.ok('usage', 'status');
    assert.equal(status.enabled, false, 'reporting is off by default');
    assert.deepEqual(
      status.versions.map(({ skill, state, skillId, version, fingerprint, invocations, alreadyReported, willAdd }) =>
        ({ skill, state, skillId, version, fingerprint, invocations, alreadyReported, willAdd })),
      [{ skill: 'fingerprint-probe', state: 'fetched', skillId: minted.skillId, version: 1, fingerprint: probeFp, invocations: claudeLoads.length, alreadyReported: 0, willAdd: claudeLoads.length }],
    );
    const refused = await bob.run('usage', 'report');
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /Usage reporting is off.*obelisk usage enable/);
    assert.deepEqual(await bob.ok('usage', 'report', '--if-due'), { status: 'off', enabled: false }, 'a scheduled run while off does nothing');

    const preview = await bob.ok('usage', 'enable');
    assert.equal(preview.preview, true);
    assert.match(preview.sends, /fingerprint, how many times you invoked it/);
    assert.match(preview.neverSent, /session content/);
    assert.match(preview.public, /under your wallet address/);
    assert.match(preview.fee, /not charged/);
    assert.match(preview.next, /Only after they confirm, run `obelisk usage enable --confirm`/);
    assert.equal(preview.versions[0].willAdd, claudeLoads.length);
    assert.equal(service.relays.filter((relay) => relay.action === 'ReportUsage').length, 0, 'a preview sends nothing');

    const enabled = await bob.ok('usage', 'enable', '--confirm');
    assert.equal(enabled.status, 'enabled');
    assert.deepEqual(
      enabled.reports.map(({ status, skillId, cumulative, added }) => ({ status, skillId, cumulative, added })),
      [{ status: 'reported', skillId: minted.skillId, cumulative: claudeLoads.length, added: claudeLoads.length }],
    );
    assert.match(enabled.reports[0].explorer, /^https:\/\/scan\.bohr\.life\/tx\/0x/);
    const reported = service.usage.get(`0x${probeFp}:${enabled.wallet}`);
    assert.deepEqual(reported, { cumulative: claudeLoads.length, scenes: {}, outcomes: {} }, 'no scene or outcome buckets until #25 judges them');

    assert.equal((await bob.ok('usage', 'report')).status, 'nothing_new');
    // More loads later. A refresh within 30 s of the last index build is
    // skipped, so start from a fresh index instead of waiting.
    writeLoads(bob.home, 'b0b');
    for (const file of readdirSync(join(bob.home, '.obelisk'))) if (file.startsWith('obelisk.sqlite')) rmSync(join(bob.home, '.obelisk', file));
    const more = await bob.ok('usage', 'report');
    assert.deepEqual(more.reports.map(({ cumulative, added }) => ({ cumulative, added })), [{ cumulative: claudeLoads.length * 2, added: claudeLoads.length }]);
    assert.equal((await bob.ok('usage', 'report', '--if-due')).status, 'not_due');
    assert.equal(service.relays.filter((relay) => relay.action === 'ReportUsage').length, 2);

    assert.equal((await bob.ok('usage', 'disable')).status, 'disabled');
    assert.equal((await bob.ok('usage', 'status')).enabled, false);
    assert.equal((await bob.run('usage', 'report')).status, 1);

    const aliceStatus = await alice.ok('usage', 'status');
    assert.deepEqual(aliceStatus.versions, [], 'a Skill nobody here invoked has nothing to report');
  } finally {
    service.close();
  }
});

test('usage commands explain what is missing', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice } = setupPeople(service, ['alice']);
    const noWallet = await alice.run('usage', 'status');
    assert.equal(noWallet.status, 1);
    assert.match(noWallet.json.error, /obelisk wallet create/);
    const bad = await alice.run('usage', 'enable', '--yes');
    assert.equal(bad.status, 1);
    assert.match(bad.json.error, /Usage: obelisk usage status \| enable \[--confirm\]/);
    assert.equal((await alice.ok('usage', 'disable')).status, 'already_disabled');
  } finally {
    service.close();
  }
});
