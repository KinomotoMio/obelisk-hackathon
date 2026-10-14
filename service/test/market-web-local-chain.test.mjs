// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The web purchase path (market/detail.js) end to end on a local Hardhat node
// (see local-chain.mjs): authors list through the relay, the buyer's own
// wallet sends the paid BuySkill, the relay records the retrieval (UseSkill),
// and the buyer's SkillAccess signature releases the licensed body.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { privateSkillContentTypes, skillAccessTypes, skillContentTypes, skillMarketTypes, skillRegistryTypes } from '../../chain/eip712.ts';
import { skillMarketAbi } from '../../chain/abi/index.ts';
import { deadline, fundedWallet, makeApp, publicClient, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

const skip = !ready && 'chain/ not built';
let app;
before(async () => { await startLocalChain({ market: true }); if (ready) app = makeApp(); });
after(stopLocalChain);

const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;
const nonceOf = async (contract, account) => (await app.call('GET', `/v1/nonces/${contract}/${account.address}`)).body.nonce;
const marketDomain = () => ({ name: 'ObeliskSkillMarket', version: '1', chainId: app.config.chain.id, verifyingContract: app.config.market });
const marketNonce = (account) => publicClient.readContract({ address: app.config.market, abi: skillMarketAbi, functionName: 'nonces', args: [account.address] });
const signMarket = (account, primaryType, message) => account.signTypedData({ domain: marketDomain(), types: skillMarketTypes, primaryType, message });

async function relay(action, message, signature) {
  const result = await app.call('POST', '/v1/relay', { action, message, signature });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function mint(author, body, name, { parentSkillId = '0', licensed = false } = {}) {
  const fingerprint = fingerprintOf(body);
  const message = { author: author.address, fingerprint, birthScenes: [], parentSkillId, nonce: await nonceOf('SkillRegistry', author), deadline: deadline() };
  await relay('MintSkill', message, await signAction(app, author, 'SkillRegistry', skillRegistryTypes, 'MintSkill', message));
  const content = { author: author.address, fingerprint, name, description: `${name} description`, ...(licensed ? { visibility: 'licensed' } : {}) };
  const signature = licensed
    ? await signAction(app, author, 'SkillRegistry', privateSkillContentTypes, 'PrivateSkillContent', content)
    : await signAction(app, author, 'SkillRegistry', skillContentTypes, 'SkillContent', content);
  assert.equal((await app.call('POST', `/v1/skills/${fingerprint}/content`, { ...content, body, signature })).status, 200);
  return fingerprint;
}

async function list(author, skillId, { price, royaltyBps, mode = 2 }) {
  const message = { author: author.address, skillId, versionIndex: '0', mode, license: 0, price: parseEther(price).toString(), royaltyBps, nonce: (await marketNonce(author)).toString(), deadline: deadline() };
  return relay('ListSkill', message, await signMarket(author, 'ListSkill', message));
}

test('listing and retrieval are relayed; the buyer’s own wallet pays, the split follows the lineage, and the body is released', { skip }, async () => {
  const original = privateKeyToAccount(generatePrivateKey());
  const derived = privateKeyToAccount(generatePrivateKey());
  await mint(original, '# Original method', 'original-method');
  const body = '# Derived method\n\nThe licensed part.';
  const fingerprint = await mint(derived, body, 'derived-method', { parentSkillId: '1', licensed: true });
  await list(original, '1', { price: '0.01', royaltyBps: 2000 });
  await list(derived, '2', { price: '0.1', royaltyBps: 0 });

  const { account: buyer, wallet } = await fundedWallet('2');
  const buy = { buyer: buyer.address, offerId: '2', nonce: (await marketNonce(buyer)).toString(), deadline: deadline() };
  const buySignature = await signMarket(buyer, 'BuySkill', buy);
  const relayed = await app.call('POST', '/v1/relay', { action: 'BuySkill', message: buy, signature: buySignature });
  assert.equal(relayed.body.error.code, 'unknown_action', 'the relay never pays a purchase');

  const call = await app.call('POST', '/v1/direct/prepare', { action: 'BuySkill', message: buy, signature: buySignature });
  assert.equal(call.status, 200, JSON.stringify(call.body));
  assert.equal(call.body.price, '0.1');
  assert.equal(BigInt(call.body.value), parseEther('0.1'));
  const buyTx = await wallet.sendTransaction({ to: call.body.to, data: call.body.data, value: BigInt(call.body.value), gas: BigInt(call.body.gas) });
  assert.equal((await publicClient.waitForTransactionReceipt({ hash: buyTx })).status, 'success');
  assert.equal((await app.call('POST', '/v1/direct', { txHash: buyTx })).body.action, 'BuySkill');
  assert.equal((await app.call('POST', '/v1/market/receipts', { transaction: buyTx })).status, 200);

  const allocations = await publicClient.readContract({ address: app.config.market, abi: skillMarketAbi, functionName: 'allocations', args: [1n] });
  const paid = Object.fromEntries(allocations.map((part) => [part.recipient.toLowerCase(), part.amount]));
  // 5% platform fee, then 20% of the rest to the parent's author.
  assert.equal(paid[original.address.toLowerCase()], parseEther('0.019'));
  assert.equal(paid[derived.address.toLowerCase()], parseEther('0.076'));

  const access = await app.call('GET', `/v1/market/access/2?wallet=${buyer.address}`);
  assert.equal(access.body.perpetual, true);

  const use = { buyer: buyer.address, offerId: '2', nonce: (await marketNonce(buyer)).toString(), deadline: deadline() };
  const used = await relay('UseSkill', use, await signMarket(buyer, 'UseSkill', use));
  const request = { buyer: buyer.address, fingerprint, useTransaction: used.txHash, deadline: String(Math.floor(Date.now() / 1000) + 600) };
  const accessSignature = await buyer.signTypedData({ domain: marketDomain(), types: skillAccessTypes, primaryType: 'SkillAccess', message: { ...request, deadline: BigInt(request.deadline) } });
  const delivered = await app.call('POST', `/v1/market/content/${fingerprint}`, { ...request, signature: accessSignature });
  assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
  assert.equal(delivered.body.content.body, body);
});
