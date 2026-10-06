// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// /v1/skills routes against a stubbed SkillRegistry: what is accepted, what is
// refused before anything is stored, and how a stored body reads back. The
// same routes against real contracts are in skills-local-chain.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { obeliskDomain, skillContentTypes } from '../../chain/eip712.ts';

const config = resolveChainConfig({ CHAIN_ID: '968' });
const BODY = '# AI 能力履历\n\nTurn session history into a résumé section.';
const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;

/** SkillRegistry views over an in-memory list of minted Skills. */
function stubRegistry(skills) {
  return {
    async readContract({ functionName, args }) {
      if (functionName === 'skillCount') return BigInt(skills.length);
      if (functionName === 'skillOfFingerprint') {
        for (const [index, skill] of skills.entries()) {
          const version = skill.versions.indexOf(args[0]);
          if (version >= 0) return [BigInt(index + 1), BigInt(version)];
        }
        return [0n, 0n];
      }
      const skill = skills[Number(args[0]) - 1];
      if (!skill) throw new Error(`UnknownSkill(${args[0]})`);
      if (functionName === 'getSkill') return [skill.author, skill.parent ?? 0n, 1_790_000_000n, BigInt(skill.versions.length), skill.birthScenes];
      if (functionName === 'versionAt') return [skill.versions[Number(args[1])], 1_790_000_100n + args[1]];
      throw new Error(`unexpected ${functionName}`);
    },
  };
}

function makeApp(skills, { storage = true } = {}) {
  const objects = new Map();
  const deps = {
    config,
    publicClient: stubRegistry(skills),
    relayerAddress: null,
    txIndex: null,
    storage: { kv: false, r2: storage },
    relay: async () => new Response('{}'),
    skillContent: storage
      ? {
        get: async (key) => objects.get(key) ?? null,
        putIfAbsent: async (key, value) => (objects.has(key) ? false : (objects.set(key, value), true)),
      }
      : null,
  };
  return {
    objects,
    async call(method, path, body) {
      const response = await handleRequest(new Request(`http://service.test${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }), deps);
      return { status: response.status, body: await response.json() };
    },
  };
}

async function signContent(account, message) {
  return account.signTypedData({
    domain: obeliskDomain('SkillRegistry', config.chain.id, config.contracts.SkillRegistry),
    types: skillContentTypes,
    primaryType: 'SkillContent',
    message,
  });
}

async function contentRequest(account, overrides = {}) {
  const message = { author: account.address, fingerprint: fingerprintOf(BODY), name: 'ai-resume', description: 'Draft an AI résumé', ...overrides.message };
  const signature = await signContent(account, message);
  return { ...message, body: BODY, signature, ...overrides.request };
}

test('the author stores a minted body once, and anyone reads it back with the chain record', async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const fp = fingerprintOf(BODY);
  const app = makeApp([{ author: author.address, versions: [fp], birthScenes: ['v1:artifact/resume'] }]);

  const before = await app.call('GET', `/v1/skills/${fp}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.content, null, 'minted, but no body stored yet');

  const stored = await app.call('POST', `/v1/skills/${fp}/content`, await contentRequest(author));
  assert.equal(stored.status, 200, JSON.stringify(stored.body));
  assert.deepEqual(stored.body, { stored: true, created: true, fingerprint: fp, skillId: '1', versionIndex: 0, name: 'ai-resume' });
  assert.deepEqual([...app.objects.keys()], [`skills/968/${fp}.json`]);

  const again = await app.call('POST', `/v1/skills/${fp}/content`, await contentRequest(author));
  assert.equal(again.status, 200, 'storing the same content again is a no-op');
  assert.equal(again.body.created, false);

  const renamed = await app.call('POST', `/v1/skills/${fp}/content`, await contentRequest(author, { message: { name: 'other-name' } }));
  assert.equal(renamed.status, 409);
  assert.equal(renamed.body.error.code, 'content_exists');

  for (const ref of [fp, fp.slice(2), '1']) {
    const read = await app.call('GET', `/v1/skills/${ref}`);
    assert.equal(read.status, 200, ref);
    assert.equal(read.body.skillId, '1');
    assert.equal(read.body.author, author.address);
    assert.deepEqual(read.body.birthScenes, ['v1:artifact/resume']);
    assert.deepEqual(read.body.version, { index: 0, fingerprint: fp, publishedAt: new Date(1_790_000_100_000).toISOString() });
    assert.deepEqual(read.body.content, { name: 'ai-resume', description: 'Draft an AI résumé', body: BODY });
    assert.equal(read.body.parentSkillId, null);
    assert.match(read.body.explorer.author, /\/address\/0x/);
  }
});

test('a Skill id reads its latest version unless versionIndex picks another', async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const v1 = fingerprintOf('v1 body');
  const v2 = fingerprintOf('v2 body');
  const app = makeApp([{ author: author.address, versions: [v1, v2], birthScenes: [], parent: 0n }]);
  assert.equal((await app.call('GET', '/v1/skills/1')).body.version.fingerprint, v2);
  assert.equal((await app.call('GET', '/v1/skills/1?versionIndex=0')).body.version.fingerprint, v1);
  const missing = await app.call('GET', '/v1/skills/1?versionIndex=2');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'unknown_version');
  const unknown = await app.call('GET', '/v1/skills/2');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'unknown_skill');
  const unminted = await app.call('GET', `/v1/skills/${fingerprintOf('never minted')}`);
  assert.equal(unminted.status, 404);
  const bad = await app.call('GET', '/v1/skills/ai-resume');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'invalid_skill_ref');
});

test('content is refused unless it hashes to a minted fingerprint and is signed by that version\'s author', async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const fp = fingerprintOf(BODY);
  const app = makeApp([{ author: author.address, versions: [fp], birthScenes: [] }]);
  const post = async (request, fingerprint = fp) => app.call('POST', `/v1/skills/${fingerprint}/content`, request);

  const tampered = await post(await contentRequest(author, { request: { body: `${BODY}!` } }));
  assert.equal(tampered.status, 422);
  assert.equal(tampered.body.error.code, 'fingerprint_mismatch');

  const unnormalized = await post(await contentRequest(author, { request: { body: `${BODY}\n` } }));
  assert.equal(unnormalized.status, 400);
  assert.match(unnormalized.body.error.message, /normalized/);

  const forged = await post({ ...(await contentRequest(stranger)), author: author.address });
  assert.equal(forged.status, 401);
  assert.equal(forged.body.error.code, 'invalid_signature');

  const notAuthor = await post(await contentRequest(stranger));
  assert.equal(notAuthor.status, 403);
  assert.equal(notAuthor.body.error.code, 'not_author');

  const otherBody = 'not minted';
  const notMinted = await post(
    await contentRequest(author, { message: { fingerprint: fingerprintOf(otherBody) }, request: { body: otherBody } }),
    fingerprintOf(otherBody),
  );
  assert.equal(notMinted.status, 409);
  assert.equal(notMinted.body.error.code, 'not_minted');

  const badName = await post(await contentRequest(author, { message: { name: 'AI Resume' } }));
  assert.equal(badName.status, 400);

  assert.equal(app.objects.size, 0, 'nothing was stored');

  const noBucket = makeApp([{ author: author.address, versions: [fp], birthScenes: [] }], { storage: false });
  const unavailable = await noBucket.call('POST', `/v1/skills/${fp}/content`, await contentRequest(author));
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.error.code, 'storage_unavailable');
});
