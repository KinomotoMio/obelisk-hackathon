// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Skill usage end to end on a local Hardhat node (see local-chain.mjs, #24):
// Skills minted and usage reported through the relay, then read back through
// the usage routes.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { skillRegistryTypes, usageStatsTypes } from '../../chain/eip712.ts';
import { deadline, makeApp, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

const skip = !ready && 'chain/ not built';
let app;

before(async () => {
  await startLocalChain();
  if (ready) app = makeApp();
});
after(stopLocalChain);

const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;

async function relay(account, contract, types, action, message) {
  const signature = await signAction(app, account, contract, types, action, message);
  const result = await app.call('POST', '/v1/relay', { action, message, signature });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
  return result.body;
}

const nonceOf = async (contract, account) => (await app.call('GET', `/v1/nonces/${contract}/${account.address}`)).body.nonce;

async function mint(author, body, { parentSkillId = '0', birthScenes = [] } = {}) {
  await relay(author, 'SkillRegistry', skillRegistryTypes, 'MintSkill', {
    author: author.address, fingerprint: fingerprintOf(body), birthScenes, parentSkillId, nonce: await nonceOf('SkillRegistry', author), deadline: deadline(),
  });
  return fingerprintOf(body);
}

async function report(reporter, fingerprint, cumulativeInvocations, { scenes = [], outcomes = [] } = {}) {
  return relay(reporter, 'UsageStats', usageStatsTypes, 'ReportUsage', {
    reporter: reporter.address, fingerprint, cumulativeInvocations: String(cumulativeInvocations), scenes, outcomes,
    nonce: await nonceOf('UsageStats', reporter), deadline: deadline(),
  });
}

test('a relayed usage report is remembered with what it added, for the trend', { skip }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const reporter = privateKeyToAccount(generatePrivateKey());
  const fingerprint = await mint(author, '# trend probe');
  await report(reporter, fingerprint, 3);
  await report(reporter, fingerprint, 3);
  await report(reporter, fingerprint, 5);
  const entries = await app.usageTrend.list(app.config.chain.id, fingerprint);
  assert.deepEqual(entries.map((entry) => entry.added), [3, 2], 'a re-sent report adds nothing and is not recorded');
  assert.ok(entries.every((entry) => !Number.isNaN(Date.parse(entry.at))));
});
