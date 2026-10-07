// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

import { bytesToHex, hexToBytes, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { keyRegistryTypes, obeliskDomain, pinnedDeployments } from '../packages/core/src/chain-protocol.ts';
import { resolveObeliskPaths } from '../packages/core/src/paths.ts';
import {
  createWallet,
  deriveEncryptionKey,
  encryptionKeyMaterial,
  ENCRYPTION_KEY_HKDF_INFO,
  ENCRYPTION_KEY_MESSAGE,
  loadWallet,
  signRegisterKey,
  WALLET_KEYCHAIN_SERVICE,
  walletActivation,
  WalletNotFoundError,
} from '../packages/core/src/wallet.ts';
import { makeTempDir } from './temp-dirs.mjs';

// Hardhat's public development key #0. Never holds real funds.
const VECTOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// The web reader (#10) must derive this same key from this wallet.
const VECTOR_REGISTERED_KEY = '0x01a46436ebac0536d5b527c27f59b78cc83a6fd2be2f0d5c2db673f55add120c31';

function memorySecrets() {
  const entries = new Map();
  return {
    description: 'test keychain',
    entries,
    async get(service, account) { return entries.get(`${service}\n${account}`) ?? null; },
    async add(service, account, _label, secret) {
      const key = `${service}\n${account}`;
      if (entries.has(key)) throw new Error('already exists');
      entries.set(key, secret);
    },
  };
}

function walletContext(home, secrets) {
  return { paths: resolveObeliskPaths({ env: { OBELISK_HOME: home } }), secrets };
}

test('the encryption key is derived from a wallet signature over the fixed message (test vector for the web reader)', async () => {
  const account = privateKeyToAccount(VECTOR_KEY);
  const derived = await deriveEncryptionKey(account);
  assert.equal(derived.registeredKey, VECTOR_REGISTERED_KEY);
  assert.equal(derived.privateKey.length, 32);
  assert.deepEqual(await deriveEncryptionKey(account), derived, 'the same wallet always derives the same key');

  // A browser can reproduce the private key with WebCrypto alone.
  const signature = await account.signMessage({ message: ENCRYPTION_KEY_MESSAGE });
  const base = await webcrypto.subtle.importKey('raw', hexToBytes(signature).slice(0, 64), 'HKDF', false, ['deriveBits']);
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(ENCRYPTION_KEY_HKDF_INFO) },
    base,
    256,
  );
  assert.equal(bytesToHex(new Uint8Array(bits)), bytesToHex(derived.privateKey));

  const other = await deriveEncryptionKey(privateKeyToAccount(`0x${'42'.repeat(32)}`));
  assert.notEqual(other.registeredKey, derived.registeredKey);
});

test('a high-s or differently encoded v signature derives the same key material', async () => {
  const account = privateKeyToAccount(VECTOR_KEY);
  const signature = hexToBytes(await account.signMessage({ message: ENCRYPTION_KEY_MESSAGE }));
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const s = BigInt(bytesToHex(signature.slice(32, 64)));
  const highS = hexToBytes(`0x${(n - s).toString(16).padStart(64, '0')}`);
  const malleated = new Uint8Array([...signature.slice(0, 32), ...highS, signature[64] === 27 ? 1 : 0]);
  assert.deepEqual(encryptionKeyMaterial(bytesToHex(malleated)), encryptionKeyMaterial(bytesToHex(signature)));
});

test('RegisterKey is signed for the pinned testnet KeyRegistry', async () => {
  const account = privateKeyToAccount(VECTOR_KEY);
  const keyRegistry = pinnedDeployments[968].contracts.KeyRegistry;
  const message = { user: account.address, pubKey: VECTOR_REGISTERED_KEY, nonce: 0n, deadline: 2_000_000_000n };
  const signature = await signRegisterKey(account, 968, keyRegistry, message);
  const signer = await recoverTypedDataAddress({
    domain: obeliskDomain('KeyRegistry', 968, keyRegistry),
    types: keyRegistryTypes,
    primaryType: 'RegisterKey',
    message,
    signature,
  });
  assert.equal(signer, account.address);
});

test('each data directory gets its own wallet in a shared keychain', async () => {
  const root = makeTempDir('obelisk-wallet-');
  const secrets = memorySecrets();
  const alice = await createWallet(walletContext(join(root, 'alice'), secrets));
  const bob = await createWallet(walletContext(join(root, 'bob'), secrets));
  assert.equal(alice.status, 'created');
  assert.equal(bob.status, 'created');
  assert.notEqual(alice.address, bob.address);
  assert.deepEqual([...secrets.entries.keys()].sort(), [
    `${WALLET_KEYCHAIN_SERVICE}\n${join(root, 'alice')}`,
    `${WALLET_KEYCHAIN_SERVICE}\n${join(root, 'bob')}`,
  ]);

  const record = JSON.parse(readFileSync(join(root, 'alice', 'wallet.json'), 'utf8'));
  assert.equal(record.address, alice.address);
  assert.doesNotMatch(JSON.stringify(record), /0x[0-9a-f]{64}/i, 'wallet.json holds no private key');

  const again = await createWallet(walletContext(join(root, 'alice'), secrets));
  assert.deepEqual(again, { status: 'exists', address: alice.address }, 'create never replaces a wallet');
  assert.equal((await loadWallet(walletContext(join(root, 'alice'), secrets))).account.address, alice.address);
});

test('an interrupted create heals from the keychain and a lost key is never papered over', async () => {
  const root = makeTempDir('obelisk-wallet-heal-');
  const home = join(root, 'carol');
  const secrets = memorySecrets();
  const created = await createWallet(walletContext(home, secrets));

  rmSync(join(home, 'wallet.json'));
  assert.deepEqual(await createWallet(walletContext(home, secrets)), { status: 'recovered', address: created.address });
  assert.ok(existsSync(join(home, 'wallet.json')));

  secrets.entries.clear();
  await assert.rejects(createWallet(walletContext(home, secrets)), /private key is not in the test keychain/);
  await assert.rejects(loadWallet(walletContext(home, secrets)), /private key is not in the test keychain/);

  renameSync(join(home, 'wallet.json'), join(home, 'wallet.json.bak'));
  await assert.rejects(loadWallet(walletContext(home, secrets)), (error) => error instanceof WalletNotFoundError && /obelisk wallet create/.test(error.message));
});

test('activation compares the key on chain with the one this wallet derives', () => {
  assert.equal(walletActivation({ registered: false, pubKey: null }, VECTOR_REGISTERED_KEY), 'not_activated');
  assert.equal(walletActivation({ registered: true, pubKey: VECTOR_REGISTERED_KEY.toUpperCase().replace('0X', '0x') }, VECTOR_REGISTERED_KEY), 'active');
  assert.equal(walletActivation({ registered: true, pubKey: `0x01${'22'.repeat(32)}` }, VECTOR_REGISTERED_KEY), 'different_key');
});
