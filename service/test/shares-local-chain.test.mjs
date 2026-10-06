// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Private shares end to end on a local Hardhat node (see local-chain.mjs):
// content encrypted exactly as the CLI does it (packages/core/src), uploaded,
// and the share authorization written on chain through the relay.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { keyRegistryTypes, shareRegistryTypes } from '../../chain/eip712.ts';
import { encryptShareContent, newShareId, sealContentKey } from '../../packages/core/src/share-crypto.ts';
import { deriveEncryptionKey } from '../../packages/core/src/wallet.ts';
import { deadline, makeApp, publicClient, ready, relayerWallet, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

const skip = !ready && 'chain/ not built';
const snapshot = new TextEncoder().encode(JSON.stringify({ format: 'obelisk.share.snapshot/v1', messages: [{ n: 1, text: '修复支付回调' }] }));

before(startLocalChain);
after(stopLocalChain);

async function chainNow() {
  return Number((await publicClient.getBlock()).timestamp);
}

/** A wallet with its encryption key registered, as `obelisk wallet activate --confirm` leaves it. */
async function activatedWallet(app) {
  const account = privateKeyToAccount(generatePrivateKey());
  const keys = await deriveEncryptionKey(account);
  const message = { user: account.address, pubKey: keys.registeredKey, nonce: '0', deadline: deadline() };
  const signature = await signAction(app, account, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
  const result = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return { account, keys };
}

/** What `obelisk share send --confirm` uploads. */
async function prepareShare(app, sender, recipientKey, { recipient, maxOpens = 1, ttl = 3600, shareId = newShareId() } = {}) {
  const { contentKey, blob, contentHash } = encryptShareContent(snapshot, shareId);
  const keyPackage = sealContentKey(contentKey, recipientKey, shareId);
  const nonce = (await app.call('GET', `/v1/nonces/ShareRegistry/${sender.address}`)).body.nonce;
  const message = {
    sender: sender.address, shareId, recipient, contentHash, maxOpens: String(maxOpens),
    expiresAt: String((await chainNow()) + ttl), nonce, deadline: deadline(),
  };
  const signature = await signAction(app, sender, 'ShareRegistry', shareRegistryTypes, 'CreateShare', message);
  return { shareId, body: { message, signature, keyPackage, ciphertext: Buffer.from(blob).toString('base64') } };
}

test('分享：上传密文并经在线服务写入分享授权，链上可查', { skip }, async () => {
  const app = makeApp();
  const sender = privateKeyToAccount(generatePrivateKey());
  const { account: recipient, keys } = await activatedWallet(app);
  const { shareId, body } = await prepareShare(app, sender, keys.registeredKey, { recipient: recipient.address, maxOpens: 1 });

  const created = await app.call('POST', '/v1/shares', body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.status, 'confirmed');
  assert.equal(created.body.shareId, shareId);
  assert.equal(created.body.action, 'CreateShare');
  const transaction = await publicClient.getTransaction({ hash: created.body.txHash });
  assert.equal(transaction.from.toLowerCase(), relayerWallet.address.toLowerCase(), 'the relay wallet pays');

  const stored = app.shares.content.get(shareId);
  assert.deepEqual(Buffer.from(stored.ciphertext), Buffer.from(body.ciphertext, 'base64'));
  assert.deepEqual(stored.keyPackage, body.keyPackage);

  const read = await app.call('GET', `/v1/shares/${shareId}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.status, 'active');
  assert.equal(read.body.sender, sender.address);
  assert.equal(read.body.recipient, recipient.address);
  assert.equal(read.body.contentHash, body.message.contentHash);
  assert.deepEqual([read.body.maxOpens, read.body.openCount, read.body.revoked], [1, 0, false]);
  assert.equal(read.body.expiresAt, new Date(Number(body.message.expiresAt) * 1000).toISOString());
  assert.equal(read.body.transactions.create.txHash, created.body.txHash);
  assert.deepEqual(read.body.receipts, []);
  assert.equal(read.body.contentStored, true);

  const unknown = await app.call('GET', `/v1/shares/${newShareId()}`);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'unknown_share');
});

test('uploads that do not match their signed share are refused before storing or spending gas', { skip }, async () => {
  const app = makeApp();
  const sender = privateKeyToAccount(generatePrivateKey());
  const { account: recipient, keys } = await activatedWallet(app);
  const other = await activatedWallet(app);
  const notActivated = privateKeyToAccount(generatePrivateKey());
  const balanceBefore = await publicClient.getBalance({ address: relayerWallet.address });
  const refuse = async (body, status, code) => {
    const result = await app.call('POST', '/v1/shares', body);
    assert.equal(result.status, status, JSON.stringify(result.body));
    assert.equal(result.body.error.code, code);
  };

  const good = await prepareShare(app, sender, keys.registeredKey, { recipient: recipient.address });
  await refuse({ ...good.body, ciphertext: Buffer.from('tampered').toString('base64') }, 400, 'content_hash_mismatch');
  const wrongKey = await prepareShare(app, sender, other.keys.registeredKey, { recipient: recipient.address });
  await refuse(wrongKey.body, 409, 'recipient_key_changed');
  const inactive = await prepareShare(app, sender, keys.registeredKey, { recipient: notActivated.address });
  await refuse(inactive.body, 422, 'recipient_not_activated');
  const forged = await prepareShare(app, sender, keys.registeredKey, { recipient: recipient.address });
  const attacker = privateKeyToAccount(generatePrivateKey());
  forged.body.signature = await signAction(app, attacker, 'ShareRegistry', shareRegistryTypes, 'CreateShare', forged.body.message);
  await refuse(forged.body, 401, 'invalid_signature');
  await refuse({ ...good.body, keyPackage: { ...good.body.keyPackage, version: 2 } }, 400, 'invalid_key_package');
  assert.equal(app.shares.content.size, 0, 'nothing was stored');
  assert.equal(await publicClient.getBalance({ address: relayerWallet.address }), balanceBefore, 'no gas was spent');

  const created = await app.call('POST', '/v1/shares', good.body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await refuse(good.body, 409, 'share_exists');
});
