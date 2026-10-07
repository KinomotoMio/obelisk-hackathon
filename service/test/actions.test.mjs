// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeFunctionData } from 'viem';

import { parseRelayRequest, RELAY_ACTIONS, RequestError } from '../src/actions.ts';
import { handleRequest } from '../src/app.ts';
import { pinnedDeployments } from '../../packages/core/src/chain-protocol.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { HourlyRateLimiter } from '../src/limits.ts';
import { CONTRACT_ABIS } from '../src/relayer.ts';

const deployment = JSON.parse(readFileSync(new URL('../../chain/deployments/968.json', import.meta.url), 'utf8'));

const user = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const signature = `0x${'11'.repeat(65)}`;
const bytes32 = `0x${'ab'.repeat(32)}`;

const samples = {
  RegisterKey: { user, pubKey: '0x01' + 'cd'.repeat(32), nonce: '0', deadline: '1900000000' },
  CreateShare: { sender: user, shareId: bytes32, recipient: user, contentHash: bytes32, maxOpens: 1, expiresAt: '1900000000', nonce: 0, deadline: 1900000000 },
  RevokeShare: { sender: user, shareId: bytes32, nonce: '0', deadline: '1900000000' },
  MintSkill: { author: user, fingerprint: bytes32, birthScenes: ['testing'], parentSkillId: '0', nonce: '0', deadline: '1900000000' },
  PublishVersion: { author: user, skillId: '1', fingerprint: bytes32, nonce: '0', deadline: '1900000000' },
  ReportUsage: {
    reporter: user, fingerprint: bytes32, cumulativeInvocations: '3',
    scenes: [{ key: bytes32, cumulative: '2' }], outcomes: [], nonce: '0', deadline: '1900000000',
  },
};

test('every relayable action maps its signed fields onto the contract function, nonce omitted', () => {
  assert.deepEqual(Object.keys(RELAY_ACTIONS).sort(), Object.keys(samples).sort());
  for (const [action, message] of Object.entries(samples)) {
    const parsed = parseRelayRequest({ action, message, signature });
    const { contract, functionName } = RELAY_ACTIONS[action];
    // Encoding against the real ABI fails if the argument list is wrong.
    encodeFunctionData({ abi: CONTRACT_ABIS[contract], functionName, args: parsed.args });
    assert.equal(parsed.args.at(-1), signature);
    assert.equal(parsed.signer, user);
    assert.equal(parsed.nonce, 0n);
  }
});

test('RecordOpen is not relayable; the key-release flow submits it', () => {
  assert.throws(
    () => parseRelayRequest({ action: 'RecordOpen', message: {}, signature }),
    (error) => error instanceof RequestError && error.code === 'unknown_action',
  );
});

test('malformed messages are rejected with the offending field named', () => {
  const cases = [
    [{ ...samples.RegisterKey, user: '0x1234' }, /message\.user must be an address/],
    [{ ...samples.RegisterKey, nonce: '-1' }, /message\.nonce must be a uint256/],
    [{ ...samples.RegisterKey, nonce: 1.5 }, /message\.nonce must be a uint256/],
    [{ ...samples.RegisterKey, pubKey: 'cafe' }, /message\.pubKey must be 0x-prefixed hex bytes/],
    [{ ...samples.RegisterKey, extra: 1 }, /unexpected field\(s\): extra/],
    [{ user, pubKey: '0x01', nonce: '0' }, /message\.deadline must be present/],
  ];
  for (const [message, pattern] of cases) {
    assert.throws(() => parseRelayRequest({ action: 'RegisterKey', message, signature }), pattern);
  }
  assert.throws(
    () => parseRelayRequest({ action: 'CreateShare', message: { ...samples.CreateShare, maxOpens: 2 ** 32 }, signature }),
    /message\.maxOpens must be a uint32/,
  );
  assert.throws(
    () => parseRelayRequest({ action: 'ReportUsage', message: { ...samples.ReportUsage, scenes: [{ key: '0x01', cumulative: '1' }] }, signature }),
    /message\.scenes\[0\]\.key must be 32 bytes/,
  );
  assert.throws(() => parseRelayRequest({ action: 'RegisterKey', message: samples.RegisterKey, signature: '0x12' }), /signature must be/);
});

test('the testnet service config reads addresses from the committed deployment record', () => {
  const config = resolveChainConfig({ CHAIN_ID: '968' });
  assert.equal(config.chain.id, 968);
  assert.equal(config.rpcUrl, 'https://rpc.bohr.life');
  assert.equal(config.explorerUrl, 'https://scan.bohr.life');
  for (const [name, record] of Object.entries(deployment.contracts)) {
    assert.equal(config.contracts[name], record.address);
  }
  assert.throws(() => resolveChainConfig({ CHAIN_ID: '677' }), /No complete deployment/);
  assert.throws(() => resolveChainConfig({ CHAIN_ID: '1' }), /Unsupported CHAIN_ID/);
  assert.throws(() => resolveChainConfig({ CHAIN_ID: '31337' }), /LOCAL_CONTRACTS/);
});

test('mainnet is served as soon as its deployment is committed and synced, with no code change', () => {
  // What `npm run sync:chain` adds to chain-protocol.ts once chain/deployments/677.json is complete.
  const contracts = { KeyRegistry: '0x0000000000000000000000000000000000000a01', ShareRegistry: '0x0000000000000000000000000000000000000a02', SkillRegistry: '0x0000000000000000000000000000000000000a03', UsageStats: '0x0000000000000000000000000000000000000a04' };
  pinnedDeployments[677] = { chainId: 677, contracts };
  try {
    const config = resolveChainConfig({ CHAIN_ID: '677' });
    assert.equal(config.chain.id, 677);
    assert.equal(config.rpcUrl, 'https://rpc.botchain.ai');
    assert.equal(config.explorerUrl, 'https://scan.botchain.ai');
    assert.deepEqual(config.contracts, contracts);
  } finally {
    delete pinnedDeployments[677];
  }
});

test('/v1/chain gives a browser wallet the public RPC, never the configured RPC_URL', async () => {
  const config = resolveChainConfig({ CHAIN_ID: '968', RPC_URL: 'https://rpc.example/v1/not-public-key' });
  const response = await handleRequest(new Request('http://service.test/v1/chain'), {
    config, publicClient: null, relayerAddress: null, txIndex: null, storage: { kv: false, r2: false }, shares: null, relay: null,
  });
  const body = await response.json();
  assert.equal(body.rpcUrl, 'https://rpc.bohr.life');
  assert.deepEqual(body.nativeCurrency, { name: 'BOT', symbol: 'BOT', decimals: 18 });
  assert.ok(!JSON.stringify(body).includes('not-public-key'));
});

test('relay limits cap each signer and the whole service per hour', async () => {
  const store = new Map();
  const storage = { get: async (key) => store.get(key), put: async (key, value) => { store.set(key, value); } };
  let now = Date.UTC(2026, 9, 7, 10, 0, 0);
  const limiter = new HourlyRateLimiter(storage, { perSigner: 2, global: 3 }, () => now);
  const other = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
  const fourth = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
  assert.equal(await limiter.take(user), true);
  assert.equal(await limiter.take(user), true);
  assert.equal(await limiter.take(user), false, 'per-signer limit');
  assert.equal(await limiter.take(other), true);
  assert.equal(await limiter.take(fourth), false, 'global limit');
  now += 3_600_000;
  assert.equal(await limiter.take(user), true, 'a new hour resets the window');
});
