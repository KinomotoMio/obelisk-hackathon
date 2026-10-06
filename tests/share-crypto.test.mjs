// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { hexToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  decryptShareContent,
  encryptShareContent,
  newShareId,
  openContentKey,
  sealContentKey,
  SHARE_KEY_HKDF_INFO,
  shareContentHash,
} from '../packages/core/src/share-crypto.ts';
import { deriveEncryptionKey } from '../packages/core/src/wallet.ts';

// Hardhat's public development accounts #1 and #2; worthless anywhere else.
const recipient = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const forwardee = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3d71e3c7d6fdc365');
const snapshot = new TextEncoder().encode(JSON.stringify({ format: 'obelisk.share.snapshot/v1', messages: [{ n: 1, text: '修复支付回调' }] }));

test('only the recipient wallet can open a share: the content key is sealed to its registered key', async () => {
  const keys = await deriveEncryptionKey(recipient);
  const shareId = newShareId();
  const { contentKey, blob, contentHash } = encryptShareContent(snapshot, shareId);
  assert.equal(contentHash, shareContentHash(blob));
  assert.ok(!Buffer.from(blob).includes(Buffer.from('修复支付回调')), 'the uploaded blob holds no plaintext');

  const keyPackage = sealContentKey(contentKey, keys.registeredKey, shareId);
  assert.equal(keyPackage.recipientKey, keys.registeredKey.toLowerCase());
  const opened = openContentKey(keyPackage, keys.privateKey, shareId);
  assert.deepEqual(Buffer.from(decryptShareContent(blob, opened, shareId)), Buffer.from(snapshot));

  const other = await deriveEncryptionKey(forwardee);
  assert.throws(() => openContentKey(keyPackage, other.privateKey, shareId), 'another wallet cannot open the key package');
  assert.throws(() => openContentKey(keyPackage, keys.privateKey, newShareId()), 'a key package is bound to its share id');
  assert.throws(() => decryptShareContent(blob, opened, newShareId()), 'content is bound to its share id');
});

test('the web reader can open a share with WebCrypto alone', async () => {
  const { subtle } = webcrypto;
  const keys = await deriveEncryptionKey(recipient);
  const shareId = newShareId();
  const { contentKey, blob } = encryptShareContent(snapshot, shareId);
  const keyPackage = sealContentKey(contentKey, keys.registeredKey, shareId);

  // What a browser does, given the X25519 private key derived as in wallet.ts.
  const pkcs8 = new Uint8Array([...hexToBytes('0x302e020100300506032b656e04220420'), ...keys.privateKey]);
  const privateKey = await subtle.importKey('pkcs8', pkcs8, { name: 'X25519' }, false, ['deriveBits']);
  const ephemeralPublic = hexToBytes(keyPackage.ephemeralPublicKey);
  const ephemeral = await subtle.importKey('raw', ephemeralPublic, { name: 'X25519' }, false, []);
  const shared = await subtle.deriveBits({ name: 'X25519', public: ephemeral }, privateKey, 256);
  const hkdf = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const recipientPublic = hexToBytes(keyPackage.recipientKey).slice(1);
  const wrapKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array([...ephemeralPublic, ...recipientPublic]), info: new TextEncoder().encode(SHARE_KEY_HKDF_INFO) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const aad = hexToBytes(shareId);
  const rawContentKey = await subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(keyPackage.nonce), additionalData: aad }, wrapKey, hexToBytes(keyPackage.wrappedKey));
  const aes = await subtle.importKey('raw', rawContentKey, 'AES-GCM', false, ['decrypt']);
  assert.equal(blob[0], 1);
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(1, 13), additionalData: aad }, aes, blob.slice(13));
  assert.deepEqual(Buffer.from(plain), Buffer.from(snapshot));
});
