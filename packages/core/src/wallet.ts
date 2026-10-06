// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The built-in wallet (#4, docs/vision/01 I1/I2).
//
// The private key lives only in the system keychain, under service
// `obelisk-wallet` and account = the absolute data directory, so every
// OBELISK_HOME (one per Playground role, #30) has its own wallet on the same
// machine. `<dataDir>/wallet.json` keeps the non-secret part: the address and
// where the key is. Nothing in this module returns or prints the key.
//
// Encryption key derivation. Content shared with a wallet is encrypted to an
// X25519 key derived from that wallet, so the web reader (#10) can recover the
// same key from a browser wallet without ever seeing the private key:
//
//   1. signature = personal_sign(ENCRYPTION_KEY_MESSAGE)   (EIP-191, UTF-8 text)
//   2. ikm = r || s (64 bytes), with s normalized to the low half of the
//      secp256k1 order; `v` is dropped because wallets encode it differently
//   3. x25519 private key = HKDF-SHA256(ikm, salt = empty, info =
//      ENCRYPTION_KEY_HKDF_INFO, length 32)
//   4. registered key = 0x01 || x25519 public key (33 bytes); the leading byte
//      names the algorithm so a later scheme can coexist in KeyRegistry
//
// ECDSA signatures here are deterministic (RFC 6979), so the same wallet
// always derives the same key. tests/wallet.test.mjs pins a test vector.

import { createPrivateKey, hkdfSync } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { bytesToBigInt, bytesToHex, concatBytes, getAddress, hexToBytes, isAddress, numberToBytes, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

import { keyRegistryTypes, obeliskDomain } from './chain-protocol.ts';
import type { SecretStore } from './keychain.ts';

export const WALLET_KEYCHAIN_SERVICE = 'obelisk-wallet';

export const ENCRYPTION_KEY_MESSAGE = [
  'Obelisk encryption key v1',
  '',
  'Signing this derives the key that opens content shared with this wallet.',
  'Only sign it in Obelisk: anyone who gets this signature can read what is shared with you.',
].join('\n');

export const ENCRYPTION_KEY_HKDF_INFO = 'obelisk/encryption-key/x25519/v1';
export const ENCRYPTION_KEY_ALGORITHM_X25519 = 0x01;

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
// PKCS#8 prefix for a raw 32-byte X25519 private key (RFC 8410).
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

export interface WalletRecord {
  version: 1;
  address: Address;
  createdAt: string;
  keychain: { service: string; account: string };
}

export interface WalletPaths {
  dataDir: string;
  walletPath: string;
}

export interface WalletContext {
  paths: WalletPaths;
  secrets: SecretStore;
  now?: () => Date;
}

export type CreateWalletStatus = 'created' | 'exists' | 'recovered';

export class WalletNotFoundError extends Error {}

export function walletKeychainAccount(dataDir: string): string {
  return resolve(dataDir);
}

async function readRecord(path: string): Promise<WalletRecord | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<WalletRecord>;
  if (typeof parsed.address !== 'string' || !isAddress(parsed.address, { strict: false })) throw new Error(`${path} has no valid wallet address`);
  return { ...parsed, address: getAddress(parsed.address) } as WalletRecord;
}

async function writeRecord(path: string, record: WalletRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temp, path);
}

function accountFromStoredKey(stored: string): PrivateKeyAccount {
  const key = stored.trim();
  const hex = (key.startsWith('0x') ? key : `0x${key}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error('The keychain entry for this data directory is not a valid wallet key');
  return privateKeyToAccount(hex);
}

function newRecord(ctx: WalletContext, address: Address): WalletRecord {
  return {
    version: 1,
    address,
    createdAt: (ctx.now?.() ?? new Date()).toISOString(),
    keychain: { service: WALLET_KEYCHAIN_SERVICE, account: walletKeychainAccount(ctx.paths.dataDir) },
  };
}

function mismatch(record: WalletRecord, address: Address, ctx: WalletContext): Error {
  return new Error(
    `${ctx.paths.walletPath} records ${record.address}, but the ${ctx.secrets.description} entry for this data directory holds ${address}; refusing to guess which is right`,
  );
}

/**
 * Create this data directory's wallet, or report the one it already has.
 * Never replaces an existing key. Re-running after an interruption between
 * the keychain write and wallet.json heals the record from the keychain.
 */
export async function createWallet(ctx: WalletContext): Promise<{ status: CreateWalletStatus; address: Address }> {
  const account = walletKeychainAccount(ctx.paths.dataDir);
  const [record, stored] = await Promise.all([
    readRecord(ctx.paths.walletPath),
    ctx.secrets.get(WALLET_KEYCHAIN_SERVICE, account),
  ]);
  if (stored !== null) {
    const { address } = accountFromStoredKey(stored);
    if (record && record.address !== address) throw mismatch(record, address, ctx);
    if (record) return { status: 'exists', address };
    await writeRecord(ctx.paths.walletPath, newRecord(ctx, address));
    return { status: 'recovered', address };
  }
  if (record) {
    throw new Error(
      `${ctx.paths.walletPath} records ${record.address}, but its private key is not in the ${ctx.secrets.description} (service ${WALLET_KEYCHAIN_SERVICE}, account ${account}). Restore that entry, or move wallet.json aside to create a new wallet.`,
    );
  }
  const privateKey = generatePrivateKey();
  const { address } = privateKeyToAccount(privateKey);
  await ctx.secrets.add(WALLET_KEYCHAIN_SERVICE, account, `Obelisk wallet (${account})`, privateKey);
  await writeRecord(ctx.paths.walletPath, newRecord(ctx, address));
  return { status: 'created', address };
}

/** The wallet's signing account. Throws WalletNotFoundError when there is none. */
export async function loadWallet(ctx: WalletContext): Promise<{ record: WalletRecord; account: PrivateKeyAccount }> {
  const keychainAccount = walletKeychainAccount(ctx.paths.dataDir);
  const [record, stored] = await Promise.all([
    readRecord(ctx.paths.walletPath),
    ctx.secrets.get(WALLET_KEYCHAIN_SERVICE, keychainAccount),
  ]);
  if (stored === null) {
    if (!record) throw new WalletNotFoundError(`No Obelisk wallet for ${ctx.paths.dataDir}; create one with \`obelisk wallet create\``);
    throw new Error(
      `${ctx.paths.walletPath} records ${record.address}, but its private key is not in the ${ctx.secrets.description} (service ${WALLET_KEYCHAIN_SERVICE}, account ${keychainAccount})`,
    );
  }
  const account = accountFromStoredKey(stored);
  if (record && record.address !== account.address) throw mismatch(record, account.address, ctx);
  if (record) return { record, account };
  const healed = newRecord(ctx, account.address);
  await writeRecord(ctx.paths.walletPath, healed);
  return { record: healed, account };
}

export interface EncryptionKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  /** What KeyRegistry stores: algorithm byte || public key. */
  registeredKey: Hex;
}

/** r || s of a 65-byte signature, with s normalized to the low half. */
export function encryptionKeyMaterial(signature: Hex): Uint8Array {
  const bytes = hexToBytes(signature);
  if (bytes.length !== 65) throw new Error(`Expected a 65-byte signature, got ${bytes.length} bytes`);
  const r = bytes.slice(0, 32);
  let s = bytesToBigInt(bytes.slice(32, 64));
  if (s > SECP256K1_N / 2n) s = SECP256K1_N - s;
  return concatBytes([r, numberToBytes(s, { size: 32 })]);
}

export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  const key = createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, privateKey]), format: 'der', type: 'pkcs8' });
  const { x } = key.export({ format: 'jwk' });
  if (typeof x !== 'string') throw new Error('X25519 public key derivation failed');
  return new Uint8Array(Buffer.from(x, 'base64url'));
}

export async function deriveEncryptionKey(signer: Pick<PrivateKeyAccount, 'signMessage'>): Promise<EncryptionKeyPair> {
  const signature = await signer.signMessage({ message: ENCRYPTION_KEY_MESSAGE });
  const privateKey = new Uint8Array(hkdfSync('sha256', encryptionKeyMaterial(signature), new Uint8Array(0), ENCRYPTION_KEY_HKDF_INFO, 32));
  const publicKey = x25519PublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    registeredKey: bytesToHex(concatBytes([new Uint8Array([ENCRYPTION_KEY_ALGORITHM_X25519]), publicKey])),
  };
}

export interface RegisterKeyMessage {
  user: Address;
  pubKey: Hex;
  nonce: bigint;
  deadline: bigint;
}

/** EIP-712 `RegisterKey` signature for KeyRegistry at `keyRegistry` on `chainId`. */
export function signRegisterKey(
  signer: Pick<PrivateKeyAccount, 'signTypedData'>,
  chainId: number,
  keyRegistry: Address,
  message: RegisterKeyMessage,
): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain('KeyRegistry', chainId, keyRegistry),
    types: keyRegistryTypes,
    primaryType: 'RegisterKey',
    message,
  });
}
