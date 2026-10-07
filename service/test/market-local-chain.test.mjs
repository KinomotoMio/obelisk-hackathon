// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// GET /v1/skills (the market list, #35) end to end on a local Hardhat node
// (see local-chain.mjs): Skills minted, bodies stored, and usage reported
// through the relay, then listed newest first with real totals.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { skillContentTypes, skillRegistryTypes, usageStatsTypes } from '../../chain/eip712.ts';
import { deadline, makeApp, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

const skip = !ready && 'chain/ not built';
let app;

before(async () => {
  await startLocalChain();
  if (ready) app = makeApp();
});
after(stopLocalChain);

const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;
const nonceOf = async (contract, account) => (await app.call('GET', `/v1/nonces/${contract}/${account.address}`)).body.nonce;

async function relay(account, contract, types, action, message) {
  const signature = await signAction(app, account, contract, types, action, message);
  const result = await app.call('POST', '/v1/relay', { action, message, signature });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
}

async function mint(author, body, name, { parentSkillId = '0', birthScenes = [], store = true } = {}) {
  await relay(author, 'SkillRegistry', skillRegistryTypes, 'MintSkill', {
    author: author.address, fingerprint: fingerprintOf(body), birthScenes, parentSkillId, nonce: await nonceOf('SkillRegistry', author), deadline: deadline(),
  });
  if (store) {
    const message = { author: author.address, fingerprint: fingerprintOf(body), name, description: `${name} description` };
    const signature = await signAction(app, author, 'SkillRegistry', skillContentTypes, 'SkillContent', message);
    assert.equal((await app.call('POST', `/v1/skills/${message.fingerprint}/content`, { ...message, body, signature })).status, 200);
  }
  return fingerprintOf(body);
}

const report = async (reporter, fingerprint, cumulative) => relay(reporter, 'UsageStats', usageStatsTypes, 'ReportUsage', {
  reporter: reporter.address, fingerprint, cumulativeInvocations: String(cumulative), scenes: [], outcomes: [],
  nonce: await nonceOf('UsageStats', reporter), deadline: deadline(),
});

test('an empty chain lists no Skills', { skip }, async () => {
  const empty = await app.call('GET', '/v1/skills');
  assert.equal(empty.status, 200);
  assert.deepEqual({ total: empty.body.total, skills: empty.body.skills, nextBefore: empty.body.nextBefore }, { total: 0, skills: [], nextBefore: null });
});

test('the market list: newest first, with names, scenes, derived counts, and real usage; paged by id', { skip }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const alice = privateKeyToAccount(generatePrivateKey());
  const bob = privateKeyToAccount(generatePrivateKey());
  const resume = await mint(author, '# resume', 'ai-resume', { birthScenes: ['v1:artifact/resume', 'user:context/求职季'] });
  await mint(other, '# designer', 'designer-portfolio', { parentSkillId: '1' });
  await mint(other, '# unstored', 'never-stored', { store: false });
  await report(alice, resume, 3);
  await report(bob, resume, 2);

  const list = await app.call('GET', '/v1/skills');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.deepEqual(list.body.skills.map((skill) => [skill.skillId, skill.name]), [['3', null], ['2', 'designer-portfolio'], ['1', 'ai-resume']]);
  const first = list.body.skills[2];
  assert.equal(first.author, author.address);
  assert.equal(first.description, 'ai-resume description');
  assert.deepEqual(first.birthScenes.map((scene) => [scene.tag, scene.kind]), [['v1:artifact/resume', 'vocabulary'], ['user:context/求职季', 'user']]);
  assert.deepEqual({ calls: first.totalInvocations, wallets: first.uniqueWallets, exact: first.uniqueWalletsExact, children: first.childCount }, { calls: 5, wallets: 2, exact: true, children: 1 });
  assert.equal(first.latest.fingerprint, resume);
  assert.match(first.lastReportAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(list.body.skills[1].parentSkillId, '1');
  assert.equal(list.body.nextBefore, null);

  const page = await app.call('GET', '/v1/skills?limit=2');
  assert.deepEqual(page.body.skills.map((skill) => skill.skillId), ['3', '2']);
  assert.equal(page.body.nextBefore, '2');
  const rest = await app.call('GET', `/v1/skills?limit=2&before=${page.body.nextBefore}`);
  assert.deepEqual(rest.body.skills.map((skill) => skill.skillId), ['1']);
  assert.equal(rest.body.nextBefore, null);

  for (const bad of ['limit=0', 'limit=49', 'limit=x', 'before=-1']) {
    const refused = await app.call('GET', `/v1/skills?${bad}`);
    assert.equal(refused.status, 400, bad);
  }
});
