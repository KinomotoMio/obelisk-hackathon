import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';

test('buyer offer omits allocation details; creator income sums only that wallet', async () => {
  const wallet = `0x${'11'.repeat(20)}`;
  const other = `0x${'22'.repeat(20)}`;
  const fp = `0x${'aa'.repeat(32)}`;
  const values = {
    latestOffer: 3n,
    getOffer: { skillId: 3n, versionIndex: 0n, fingerprint: fp, author: wallet, price: 10000n, mode: 1, license: 1 },
    incomeCount: 1n, totalIncome: 7600n, platform: other, incomeAt: 1n,
    getReceipt: { offerId: 3n, buyer: other, amount: 10000n, timestamp: 1791399900n },
    allocations: [{ recipient: wallet, amount: 7600n, skillId: 3n }, { recipient: other, amount: 2400n, skillId: 0n }],
  };
  const deps = { config: { ...resolveChainConfig({ CHAIN_ID: '968' }), market: other }, publicClient: {
    readContract: async ({ functionName }) => { assert.ok(functionName in values); return values[functionName]; },
  }, storage: {}, shares: null, relayerAddress: null, txIndex: null };
  const get = async path => (await handleRequest(new Request(`https://example.test/v1/market/${path}`), deps)).json();
  const { offer } = await get(`offers/${fp}`);
  assert.equal(offer.priceWei, '10000');
  assert.equal(offer.mode, 'per-use');
  assert.equal(offer.license, 'commercial');
  assert.equal(offer.testnet, true);
  assert.equal('allocations' in offer, false);
  assert.equal('platform' in offer, false);
  const income = await get(`income/${wallet}`);
  assert.equal(income.rows[0].incomeWei, '7600');
  assert.equal(income.rows[0].paidWei, '10000');
  assert.equal(income.nextBefore, null);
  const invalid = await handleRequest(new Request(`https://example.test/v1/market/income/${wallet}?limit=99`), deps);
  assert.equal(invalid.status, 400);
  delete deps.config.market;
  assert.deepEqual(await get(`offers/${fp}`), { offer: null });
});
