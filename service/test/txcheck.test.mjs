// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// GET /v1/txs (#32): the run page's on-chain check, against a stubbed chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { MAX_TX_CHECK } from '../src/txcheck.ts';

const config = resolveChainConfig({ CHAIN_ID: '968' });
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const RELAYER = '0x1111111111111111111111111111111111111111';

function notFound(name) {
  const error = new Error(`${name}: not found`);
  error.name = name;
  return error;
}

/**
 * A chain with mined transactions (`receipts`), pending ones, and an RPC that
 * can fail for given hashes. Counts every call so the cache can be checked.
 */
function stubChain({ receipts = {}, pending = [], failing = [] } = {}) {
  const calls = { receipt: [], block: [], transaction: [] };
  const client = {
    async getTransactionReceipt({ hash }) {
      calls.receipt.push(hash);
      if (failing.includes(hash)) throw new Error('HTTP request failed. Status: 502');
      const receipt = receipts[hash];
      if (!receipt) throw notFound('TransactionReceiptNotFoundError');
      return { from: RELAYER, to: receipt.to, status: receipt.status ?? 'success', blockNumber: receipt.block };
    },
    async getBlock({ blockNumber }) {
      calls.block.push(blockNumber);
      return { timestamp: 1_791_000_000n + blockNumber };
    },
    async getTransaction({ hash }) {
      calls.transaction.push(hash);
      if (pending.includes(hash)) return { from: RELAYER, to: config.contracts.UsageStats };
      throw notFound('TransactionNotFoundError');
    },
  };
  return { client, calls };
}

function memoryCache() {
  const map = new Map();
  return { map, get: async (key) => map.get(key) ?? null, put: async (key, value) => { map.set(key, value); } };
}

const deps = (client, txChecks = null) => ({
  config, publicClient: client, relayerAddress: null, txIndex: null,
  storage: { kv: Boolean(txChecks), r2: false }, shares: null, relay: null, txChecks,
});

const get = async (query, d) => {
  const response = await handleRequest(new Request(`http://service.test/v1/txs${query}`), d);
  return { status: response.status, body: await response.json() };
};

test('each transaction is reported as confirmed, reverted, pending, or not found, in the order asked', async () => {
  const { client } = stubChain({
    receipts: {
      [hash(1)]: { to: config.contracts.SkillRegistry, block: 100n },
      [hash(2)]: { to: config.contracts.ShareRegistry, block: 101n, status: 'reverted' },
      [hash(3)]: { to: '0x2222222222222222222222222222222222222222', block: 100n },
    },
    pending: [hash(4)],
  });
  const { status, body } = await get(`?hashes=${[1, 2, 3, 4, 5].map(hash).join(',')}`, deps(client));
  assert.equal(status, 200);
  assert.equal(body.chainId, 968);
  assert.deepEqual(body.transactions.map((tx) => [tx.hash, tx.status]), [
    [hash(1), 'confirmed'], [hash(2), 'reverted'], [hash(3), 'confirmed'], [hash(4), 'pending'], [hash(5), 'not_found'],
  ]);
  const [mint, revert, other, queued, missing] = body.transactions;
  assert.equal(mint.contract, 'SkillRegistry', 'the Obelisk contract it called is named');
  assert.equal(mint.blockNumber, '100');
  assert.equal(mint.timestamp, new Date((1_791_000_000 + 100) * 1000).toISOString());
  assert.equal(mint.from, RELAYER);
  assert.equal(mint.explorerUrl, `https://scan.bohr.life/tx/${hash(1)}`);
  assert.equal(revert.contract, 'ShareRegistry');
  assert.equal(other.contract, null, 'a contract that is not Obelisk’s is not named');
  assert.equal(queued.contract, null);
  assert.equal(queued.blockNumber, null);
  assert.equal(missing.from, null);
  assert.equal(missing.explorerUrl, `https://scan.bohr.life/tx/${hash(5)}`);
});

test('a lookup that fails is unavailable, never not found', async () => {
  const { client } = stubChain({ receipts: { [hash(1)]: { to: config.contracts.UsageStats, block: 7n } }, failing: [hash(2)] });
  const { body } = await get(`?hashes=${hash(1)},${hash(2)}`, deps(client));
  assert.deepEqual(body.transactions.map((tx) => tx.status), ['confirmed', 'unavailable']);
});

test('final answers are cached per chain; pending and missing ones are asked again', async () => {
  const cache = memoryCache();
  const { client, calls } = stubChain({
    receipts: { [hash(1)]: { to: config.contracts.SkillRegistry, block: 9n }, [hash(2)]: { to: config.contracts.SkillRegistry, block: 9n, status: 'reverted' } },
    pending: [hash(3)],
  });
  const query = `?hashes=${[1, 2, 3, 4].map(hash).join(',')}`;
  const first = await get(query, deps(client, cache));
  assert.deepEqual([...cache.map.keys()].sort(), [`968:${hash(1)}`, `968:${hash(2)}`]);
  assert.deepEqual(calls.block, [9n], 'one block read for two transactions in it');

  calls.receipt.length = 0;
  const second = await get(query, deps(client, cache));
  assert.deepEqual(second.body.transactions, first.body.transactions);
  assert.deepEqual(calls.receipt, [hash(3), hash(4)], 'only the open ones go to the chain');
});

test('hashes are checked once each, and bad requests are refused before any chain read', async () => {
  const { client, calls } = stubChain({ receipts: { [hash(0xabc)]: { to: config.contracts.KeyRegistry, block: 1n } } });
  const upper = `0x${hash(0xabc).slice(2).toUpperCase()}`;
  const { body } = await get(`?hashes=${hash(0xabc)},${upper}, ${hash(0xabc)}`, deps(client));
  assert.equal(body.transactions.length, 1);
  assert.equal(calls.receipt.length, 1);

  calls.receipt.length = 0;
  for (const [query, code] of [
    ['', 'missing_hashes'],
    ['?hashes=', 'missing_hashes'],
    ['?hashes=0x1234', 'invalid_hash'],
    [`?hashes=${hash(1)},nope`, 'invalid_hash'],
    [`?hashes=${Array.from({ length: MAX_TX_CHECK + 1 }, (_, i) => hash(i + 1)).join(',')}`, 'too_many_hashes'],
  ]) {
    const { status, body: error } = await get(query, deps(client));
    assert.equal(status, 400, query);
    assert.equal(error.error.code, code, query);
  }
  assert.equal(calls.receipt.length, 0);
  const post = await handleRequest(new Request(`http://service.test/v1/txs?hashes=${hash(1)}`, { method: 'POST' }), deps(client));
  assert.equal(post.status, 405);
});
