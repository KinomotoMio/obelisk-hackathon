// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Mint, store, and read a Skill end to end on a local Hardhat node (see
// local-chain.mjs, #16): MintSkill through the relay, the body through
// /v1/skills, and the chain record read back through the contract's views.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { skillContentTypes, skillRegistryTypes } from '../../chain/eip712.ts';
import { deadline, makeApp, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

let app;

before(async () => {
  await startLocalChain();
  if (ready) app = makeApp();
});
after(stopLocalChain);

const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;

const sign = (account, types, primaryType, message) => signAction(app, account, 'SkillRegistry', types, primaryType, message);

async function relay(account, action, message) {
  const signature = await sign(account, skillRegistryTypes, action, message);
  const result = await app.call('POST', '/v1/relay', { action, message, signature });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function storeContent(account, body, name) {
  const message = { author: account.address, fingerprint: fingerprintOf(body), name, description: `${name} description` };
  const signature = await sign(account, skillContentTypes, 'SkillContent', message);
  return app.call('POST', `/v1/skills/${message.fingerprint}/content`, { ...message, body, signature });
}

test('mint through the relay, store the body, and read both back; derived Skills and new versions too', { skip: !ready && 'chain/ not built' }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const nonce = async () => (await app.call('GET', `/v1/nonces/SkillRegistry/${author.address}`)).body.nonce;
  const body = '# AI 能力履历\n\nCollect the evidence first.';
  const scenes = ['v1:artifact/resume', 'v1:role/engineer', 'user:context/播客'];

  const early = await storeContent(author, body, 'ai-resume');
  assert.equal(early.status, 409, 'a body is stored only after its mint');

  const minted = await relay(author, 'MintSkill', {
    author: author.address, fingerprint: fingerprintOf(body), birthScenes: scenes, parentSkillId: '0', nonce: await nonce(), deadline: deadline(),
  });
  assert.equal(minted.status, 'confirmed');

  const stored = await storeContent(author, body, 'ai-resume');
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  assert.equal(stored.body.skillId, '1');

  const read = await app.call('GET', `/v1/skills/${fingerprintOf(body)}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.author, author.address);
  assert.deepEqual(read.body.birthScenes, scenes, 'birth scenes are on chain exactly as written');
  assert.equal(read.body.version.index, 0);
  assert.equal(read.body.content.body, body);

  const child = 'designer variant';
  await relay(author, 'MintSkill', {
    author: author.address, fingerprint: fingerprintOf(child), birthScenes: [], parentSkillId: '1', nonce: await nonce(), deadline: deadline(),
  });
  assert.equal((await app.call('GET', '/v1/skills/2')).body.parentSkillId, '1');

  const v2 = `${body}\n\nThen draft.`;
  await relay(author, 'PublishVersion', {
    author: author.address, skillId: '1', fingerprint: fingerprintOf(v2), nonce: await nonce(), deadline: deadline(),
  });
  assert.equal((await storeContent(author, v2, 'ai-resume')).body.versionIndex, 1);
  const latest = await app.call('GET', '/v1/skills/1');
  assert.equal(latest.body.versionCount, 2);
  assert.equal(latest.body.version.fingerprint, fingerprintOf(v2));
  assert.equal(latest.body.content.body, v2);

  const stranger = privateKeyToAccount(generatePrivateKey());
  const refused = await storeContent(stranger, child, 'not-mine');
  assert.equal(refused.status, 403);
});

test('lineage: from any Skill in a family, the tree from its root down, with stored names', { skip: !ready && 'chain/ not built' }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const nonce = async (account) => (await app.call('GET', `/v1/nonces/SkillRegistry/${account.address}`)).body.nonce;
  const mint = async (account, body, parentSkillId = '0') => {
    await relay(account, 'MintSkill', {
      author: account.address, fingerprint: fingerprintOf(body), birthScenes: [], parentSkillId, nonce: await nonce(account), deadline: deadline(),
    });
    return (await app.call('GET', `/v1/skills/${fingerprintOf(body)}`)).body.skillId;
  };
  const root = await mint(author, '# lineage root');
  assert.equal((await storeContent(author, '# lineage root', 'lineage-root')).status, 200);
  const designer = await mint(other, '# lineage designer', root);
  const yearEnd = await mint(author, '# lineage year end', root);
  const illustrator = await mint(other, '# lineage illustrator', designer);

  const lineage = await app.call('GET', `/v1/skills/${illustrator}/lineage`);
  assert.equal(lineage.status, 200, JSON.stringify(lineage.body));
  assert.deepEqual(lineage.body.path, [root, designer, illustrator]);
  assert.equal(lineage.body.rootSkillId, root);
  assert.equal(lineage.body.truncated, false);
  assert.deepEqual(
    lineage.body.nodes.map(({ skillId, parentSkillId, depth, name, childSkillIds }) => ({ skillId, parentSkillId, depth, name, childSkillIds })),
    [
      { skillId: root, parentSkillId: null, depth: 0, name: 'lineage-root', childSkillIds: [designer, yearEnd] },
      { skillId: designer, parentSkillId: root, depth: 1, name: null, childSkillIds: [illustrator] },
      { skillId: yearEnd, parentSkillId: root, depth: 1, name: null, childSkillIds: [] },
      { skillId: illustrator, parentSkillId: designer, depth: 2, name: null, childSkillIds: [] },
    ],
  );
  assert.equal((await app.call('GET', '/v1/skills/999/lineage')).status, 404);
});
