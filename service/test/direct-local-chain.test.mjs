// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// A user's own browser wallet sends a signed action (direct.ts), end to end
// against real contracts on a local Hardhat node; see local-chain.mjs.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { keyRegistryTypes } from '../../chain/eip712.ts';
import { deadline, fundedWallet, makeApp, publicClient, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

before(startLocalChain);
after(stopLocalChain);

const skip = !ready && 'chain/ not built';

test('a wallet sends its own RegisterKey: prepared after the relay checks, indexed only once confirmed and wallet-sent', { skip }, async () => {
  const app = makeApp();
  const { account: user, wallet } = await fundedWallet();
  const pubKey = `0x01${'7b'.repeat(32)}`;
  const { nonce } = (await app.call('GET', `/v1/keys/${user.address}`)).body;
  const message = { user: user.address, pubKey, nonce, deadline: deadline() };
  const signature = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);

  const prepared = await app.call('POST', '/v1/direct/prepare', { action: 'RegisterKey', message, signature });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  assert.equal(prepared.body.from, user.address);
  assert.equal(prepared.body.to, app.config.contracts.KeyRegistry);
  assert.equal(prepared.body.enoughBalance, true);
  assert.match(prepared.body.data, /^0x[0-9a-f]+$/);

  const pendingRecord = await app.call('POST', '/v1/direct', { txHash: `0x${'ab'.repeat(32)}` });
  assert.equal(pendingRecord.body.error.code, 'not_confirmed');

  const hash = await wallet.sendTransaction({ to: prepared.body.to, data: prepared.body.data, gas: BigInt(prepared.body.gas) });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assert.equal(receipt.from.toLowerCase(), user.address.toLowerCase(), 'the user’s own wallet sent it');
  assert.equal((await app.call('GET', `/v1/keys/${user.address}`)).body.registered, true);

  const recorded = await app.call('POST', '/v1/direct', { txHash: hash });
  assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
  assert.deepEqual({ from: recorded.body.from, contract: recorded.body.contract, action: recorded.body.action },
    { from: user.address, contract: 'KeyRegistry', action: 'RegisterKey' });
  const listed = await app.call('GET', '/v1/direct');
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.transactions[0].txHash, hash);

  const stats = await app.call('GET', '/v1/stats');
  assert.equal(stats.status, 200, JSON.stringify(stats.body));
  assert.equal(stats.body.activatedWallets, '1');
  assert.equal(stats.body.walletSentTransactions, 1);

  const replay = await app.call('POST', '/v1/direct/prepare', { action: 'RegisterKey', message, signature });
  assert.equal(replay.body.error.code, 'stale_nonce', 'a used signature is refused before the wallet is asked to pay');
});

test('relayed transactions and forged signatures are not counted as wallet-sent', { skip }, async () => {
  const app = makeApp();
  const user = privateKeyToAccount(generatePrivateKey());
  const message = { user: user.address, pubKey: `0x01${'11'.repeat(32)}`, nonce: '0', deadline: deadline() };
  const signature = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
  const relayed = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  assert.equal(relayed.body.status, 'confirmed');
  const refused = await app.call('POST', '/v1/direct', { txHash: relayed.body.txHash });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'relayed');

  const other = privateKeyToAccount(generatePrivateKey());
  const forged = { ...message, user: other.address };
  const forgedPrepare = await app.call('POST', '/v1/direct/prepare', { action: 'RegisterKey', message: forged, signature });
  assert.equal(forgedPrepare.body.error.code, 'invalid_signature');
});
