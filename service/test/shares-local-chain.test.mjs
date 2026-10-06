// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Private shares end to end on a local Hardhat node (see local-chain.mjs):
// content encrypted exactly as the CLI does it (packages/core/src), uploaded,
// and the share authorization written on chain through the relay; then opened
// by the recipient (open receipt first, key package after) and revoked.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { keyRegistryTypes, shareRegistryTypes } from '../../chain/eip712.ts';
import { decryptShareContent, encryptShareContent, newShareId, openContentKey, sealContentKey } from '../../packages/core/src/share-crypto.ts';
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

/** A RecordOpen signed by `opener`, as the web reader (#10) sends it. */
async function signOpen(app, opener, shareId, { recipient = opener.address } = {}) {
  const nonce = (await app.call('GET', `/v1/nonces/ShareRegistry/${opener.address}`)).body.nonce;
  const message = { recipient, shareId, nonce, deadline: deadline() };
  const signature = await signAction(app, opener, 'ShareRegistry', shareRegistryTypes, 'RecordOpen', message);
  return { message, signature };
}

async function signRevoke(app, signer, shareId) {
  const nonce = (await app.call('GET', `/v1/nonces/ShareRegistry/${signer.address}`)).body.nonce;
  const message = { sender: signer.address, shareId, nonce, deadline: deadline() };
  const signature = await signAction(app, signer, 'ShareRegistry', shareRegistryTypes, 'RevokeShare', message);
  return { message, signature };
}

async function createdShare(app, options = {}) {
  const sender = privateKeyToAccount(generatePrivateKey());
  const recipient = await activatedWallet(app);
  const { shareId, body } = await prepareShare(app, sender, recipient.keys.registeredKey, { recipient: recipient.account.address, ...options });
  const created = await app.call('POST', '/v1/shares', body);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  return { sender, recipient, shareId, body, created };
}

test('打开：回执先上链，再交出钥匙包；同一请求可续上，次数用完后被拒', { skip }, async () => {
  const app = makeApp();
  const { recipient, shareId, body } = await createdShare(app, { maxOpens: 1 });

  const request = await signOpen(app, recipient.account, shareId);
  const opened = await app.call('POST', `/v1/shares/${shareId}/open`, request);
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.status, 'opened');
  assert.equal(opened.body.recipient, recipient.account.address);
  assert.deepEqual([opened.body.openCount, opened.body.maxOpens, opened.body.remainingOpens], [1, 1, 0]);
  assert.deepEqual(opened.body.keyPackage, body.keyPackage);
  assert.equal(opened.body.ciphertext, body.ciphertext);
  const contentKey = openContentKey(opened.body.keyPackage, recipient.keys.privateKey, shareId);
  assert.deepEqual(Buffer.from(decryptShareContent(Buffer.from(opened.body.ciphertext, 'base64'), contentKey, shareId)), Buffer.from(snapshot));

  const receiptTx = await publicClient.getTransaction({ hash: opened.body.receipt.txHash });
  assert.equal(receiptTx.from.toLowerCase(), relayerWallet.address.toLowerCase(), 'the relay wallet pays for the receipt');
  assert.equal(receiptTx.to.toLowerCase(), app.config.contracts.ShareRegistry.toLowerCase());
  const read = await app.call('GET', `/v1/shares/${shareId}`);
  assert.equal(read.body.status, 'exhausted');
  assert.equal(read.body.openCount, 1);
  assert.equal(read.body.receipts.length, 1);
  assert.equal(read.body.receipts[0].txHash, opened.body.receipt.txHash);
  assert.equal(read.body.receipts[0].openedAt, opened.body.openedAt);

  // A dropped connection: the same signed request again is the same open.
  const again = await app.call('POST', `/v1/shares/${shareId}/open`, request);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.receipt.txHash, opened.body.receipt.txHash);
  assert.equal((await app.call('GET', `/v1/shares/${shareId}`)).body.openCount, 1);

  const balanceBefore = await publicClient.getBalance({ address: relayerWallet.address });
  const second = await app.call('POST', `/v1/shares/${shareId}/open`, await signOpen(app, recipient.account, shareId));
  assert.equal(second.status, 410, JSON.stringify(second.body));
  assert.equal(second.body.error.code, 'opens_exhausted');
  assert.equal(second.body.error.message, 'This share has been opened 1 of 1 times; no opens are left');
  assert.equal(await publicClient.getBalance({ address: relayerWallet.address }), balanceBefore, 'a refusal spends no gas');
});

test('打开被拒：转发者、冒充接收者、已撤回、已过期；拒绝时不花 gas', { skip }, async () => {
  const app = makeApp();
  const { sender, recipient, shareId, created } = await createdShare(app, { maxOpens: 3 });
  const forwardee = privateKeyToAccount(generatePrivateKey());
  const refuse = async (path, request, status, code) => {
    const result = await app.call('POST', path, request);
    assert.equal(result.status, status, JSON.stringify(result.body));
    assert.equal(result.body.error.code, code);
    return result.body.error;
  };
  const balanceBefore = await publicClient.getBalance({ address: relayerWallet.address });

  const notYours = await refuse(`/v1/shares/${shareId}/open`, await signOpen(app, forwardee, shareId), 403, 'not_recipient');
  assert.equal(notYours.message, `This share belongs to ${recipient.account.address}; ${forwardee.address} cannot open it`);
  assert.deepEqual(notYours.details, { recipient: recipient.account.address, opener: forwardee.address, explorerUrl: null });
  await refuse(`/v1/shares/${shareId}/open`, await signOpen(app, forwardee, shareId, { recipient: recipient.account.address }), 401, 'invalid_signature');
  await refuse(`/v1/shares/${newShareId()}/open`, await signOpen(app, recipient.account, shareId), 400, 'share_id_mismatch');
  const unknownId = newShareId();
  await refuse(`/v1/shares/${unknownId}/open`, await signOpen(app, recipient.account, unknownId), 404, 'unknown_share');
  const tooLong = await signOpen(app, recipient.account, shareId);
  tooLong.message.deadline = String(Math.floor(Date.now() / 1000) + 7200);
  tooLong.signature = await signAction(app, recipient.account, 'ShareRegistry', shareRegistryTypes, 'RecordOpen', tooLong.message);
  await refuse(`/v1/shares/${shareId}/open`, tooLong, 400, 'deadline_too_far');
  // RecordOpen reaches the chain only through the open flow, never POST /v1/relay.
  await refuse('/v1/relay', { action: 'RecordOpen', ...(await signOpen(app, recipient.account, shareId)) }, 400, 'unknown_action');
  await refuse(`/v1/shares/${shareId}/revoke`, await signRevoke(app, forwardee, shareId), 403, 'not_sender');
  assert.equal(await publicClient.getBalance({ address: relayerWallet.address }), balanceBefore, 'no gas was spent');

  const revoked = await app.call('POST', `/v1/shares/${shareId}/revoke`, await signRevoke(app, sender, shareId));
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.status, 'confirmed');
  assert.equal(revoked.body.shareId, shareId);
  const read = await app.call('GET', `/v1/shares/${shareId}`);
  assert.equal(read.body.status, 'revoked');
  assert.equal(read.body.transactions.revoke.txHash, revoked.body.txHash);
  assert.equal(read.body.transactions.create.txHash, created.body.txHash);
  assert.equal(read.body.contentStored, false, 'revoking deletes the stored ciphertext');
  assert.equal(app.shares.content.has(shareId), false);
  await refuse(`/v1/shares/${shareId}/open`, await signOpen(app, recipient.account, shareId), 410, 'share_revoked');
  await refuse(`/v1/shares/${shareId}/open`, await signOpen(app, forwardee, shareId), 403, 'not_recipient');
  await refuse(`/v1/shares/${shareId}/revoke`, await signRevoke(app, sender, shareId), 409, 'already_revoked');

  const short = await createdShare(app, { ttl: 2 });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await publicClient.request({ method: 'evm_mine', params: [] });
  await refuse(`/v1/shares/${short.shareId}/open`, await signOpen(app, short.recipient.account, short.shareId), 410, 'share_expired');
  assert.equal((await app.call('GET', `/v1/shares/${short.shareId}`)).body.receipts.length, 0);
});

test('撤回：经 /v1/relay 撤回的分享，在下次读取时也删除密文', { skip }, async () => {
  const app = makeApp();
  const { sender, shareId } = await createdShare(app);
  const relayed = await app.call('POST', '/v1/relay', { action: 'RevokeShare', ...(await signRevoke(app, sender, shareId)) });
  assert.equal(relayed.status, 200, JSON.stringify(relayed.body));
  assert.equal(app.shares.content.has(shareId), true, 'the relay route itself does not touch storage');
  const read = await app.call('GET', `/v1/shares/${shareId}`);
  assert.equal(read.body.status, 'revoked');
  assert.equal(read.body.contentStored, false);
  assert.equal(app.shares.content.has(shareId), false);
});
