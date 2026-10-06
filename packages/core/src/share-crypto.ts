// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Encryption for private shares (#8, docs/vision/02 S1). Everything here runs
// on the sender's machine; the online service only stores the results and
// never sees a key that can open them. The web reader (#10) reverses it with
// WebCrypto alone (X25519, HKDF-SHA256, AES-GCM); tests/share-crypto.test.mjs
// decrypts through WebCrypto to keep that true.
//
// Content. A fresh 32-byte content key encrypts the snapshot (UTF-8 JSON):
//   blob        = 0x01 || nonce (12) || AES-256-GCM(contentKey, nonce, snapshot, aad = shareId) || tag (16)
//   contentHash = SHA-256(blob)   — written on chain in CreateShare
//
// Key package. The content key is sealed to the recipient's X25519 key as
// registered in KeyRegistry (`0x01 || public key`, see wallet.ts):
//   shared   = X25519(ephemeral private, recipient public)
//   wrapKey  = HKDF-SHA256(shared, salt = ephemeral public || recipient public, info = SHARE_KEY_HKDF_INFO, 32)
//   wrapped  = AES-256-GCM(wrapKey, nonce, contentKey, aad = shareId) || tag
// The service releases the key package only after checking the share's
// on-chain rules (#9); without the recipient's wallet it opens nothing.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

import { bytesToHex, hexToBytes, type Hex } from 'viem';

import { ENCRYPTION_KEY_ALGORITHM_X25519 } from './wallet.ts';

export const SHARE_CONTENT_VERSION = 0x01;
export const SHARE_KEY_PACKAGE_ALGORITHM = 'x25519-hkdf-sha256-aes-256-gcm';
export const SHARE_KEY_HKDF_INFO = 'obelisk/share-key/x25519/v1';

const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface ShareKeyPackage {
  version: 1;
  algorithm: typeof SHARE_KEY_PACKAGE_ALGORITHM;
  /** The recipient key this was sealed to, as registered: 0x01 || X25519 public key. */
  recipientKey: Hex;
  ephemeralPublicKey: Hex;
  nonce: Hex;
  /** Sealed content key followed by the 16-byte GCM tag. */
  wrappedKey: Hex;
}

function shareIdBytes(shareId: Hex): Buffer {
  const bytes = hexToBytes(shareId);
  if (bytes.length !== 32) throw new Error(`A share id is 32 bytes, got ${bytes.length}`);
  return Buffer.from(bytes);
}

function seal(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): { nonce: Buffer; sealed: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const sealed = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { nonce, sealed };
}

function open(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, aad: Uint8Array): Buffer {
  if (sealed.length < TAG_BYTES) throw new Error('Ciphertext is too short');
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
}

export function newShareId(): Hex {
  return bytesToHex(randomBytes(32));
}

export function shareContentHash(blob: Uint8Array): Hex {
  return `0x${createHash('sha256').update(blob).digest('hex')}`;
}

export function encryptShareContent(plaintext: Uint8Array, shareId: Hex): { contentKey: Uint8Array; blob: Uint8Array; contentHash: Hex } {
  const contentKey = randomBytes(32);
  const { nonce, sealed } = seal(contentKey, plaintext, shareIdBytes(shareId));
  const blob = Buffer.concat([Buffer.from([SHARE_CONTENT_VERSION]), nonce, sealed]);
  return { contentKey, blob, contentHash: shareContentHash(blob) };
}

export function decryptShareContent(blob: Uint8Array, contentKey: Uint8Array, shareId: Hex): Uint8Array {
  if (blob[0] !== SHARE_CONTENT_VERSION) throw new Error(`Unknown share content version ${blob[0]}`);
  return open(contentKey, blob.subarray(1, 1 + NONCE_BYTES), blob.subarray(1 + NONCE_BYTES), shareIdBytes(shareId));
}

/** The raw X25519 public key inside a KeyRegistry record. */
export function x25519KeyFromRegistered(registeredKey: Hex): Uint8Array {
  const bytes = hexToBytes(registeredKey);
  if (bytes.length !== 33 || bytes[0] !== ENCRYPTION_KEY_ALGORITHM_X25519) {
    throw new Error('The recipient\'s registered key is not an Obelisk X25519 encryption key');
  }
  return bytes.slice(1);
}

function wrapKey(shared: Uint8Array, ephemeralPublic: Uint8Array, recipientPublic: Uint8Array): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', shared, Buffer.concat([ephemeralPublic, recipientPublic]), SHARE_KEY_HKDF_INFO, 32));
}

export function sealContentKey(contentKey: Uint8Array, recipientKey: Hex, shareId: Hex): ShareKeyPackage {
  const recipientPublic = x25519KeyFromRegistered(recipientKey);
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralPublic = new Uint8Array(ephemeral.publicKey.export({ format: 'der', type: 'spki' }).subarray(X25519_SPKI_PREFIX.length));
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, recipientPublic]), format: 'der', type: 'spki' }),
  });
  const { nonce, sealed } = seal(wrapKey(shared, ephemeralPublic, recipientPublic), contentKey, shareIdBytes(shareId));
  return {
    version: 1,
    algorithm: SHARE_KEY_PACKAGE_ALGORITHM,
    recipientKey: recipientKey.toLowerCase() as Hex,
    ephemeralPublicKey: bytesToHex(ephemeralPublic),
    nonce: bytesToHex(nonce),
    wrappedKey: bytesToHex(sealed),
  };
}

/** Recover the content key with the recipient's X25519 private key (see deriveEncryptionKey). */
export function openContentKey(keyPackage: ShareKeyPackage, recipientPrivateKey: Uint8Array, shareId: Hex): Uint8Array {
  if (keyPackage.version !== 1 || keyPackage.algorithm !== SHARE_KEY_PACKAGE_ALGORITHM) {
    throw new Error(`Unsupported key package ${keyPackage.algorithm} v${keyPackage.version}`);
  }
  const recipientPublic = x25519KeyFromRegistered(keyPackage.recipientKey);
  const ephemeralPublic = hexToBytes(keyPackage.ephemeralPublicKey);
  const shared = diffieHellman({
    privateKey: createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, recipientPrivateKey]), format: 'der', type: 'pkcs8' }),
    publicKey: createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, ephemeralPublic]), format: 'der', type: 'spki' }),
  });
  return new Uint8Array(open(wrapKey(shared, ephemeralPublic, recipientPublic), hexToBytes(keyPackage.nonce), hexToBytes(keyPackage.wrappedKey), shareIdBytes(shareId)));
}
