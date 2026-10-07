// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The Settings 钱包 section (#6, docs/vision/01 I1).
//
// The App shows the wallet; creating and activating it go through the
// obelisk-wallet skill in the user's AI coding assistant (the buttons copy a
// prompt). Importing is the exception: a private key or recovery phrase must
// not pass through a conversation, so the renderer hands it to the main
// process once and core stores it in the system keychain.
//
// Nothing here returns the private key, a recovery phrase, or a word of one
// to the renderer. Addresses and the encryption public key are public. The
// online service is untrusted input: only the chain id, the registration
// flag, the key, its version, and its date are read from it, and explorer
// links are built from the chain id, never from a URL the service reports.

import type { Address } from 'viem';

import {
  deriveEncryptionKey,
  importWallet,
  InvalidWalletSecretError,
  loadWallet,
  walletActivation,
  WalletExistsError,
  WalletKeyMissingError,
  WalletNotFoundError,
  type WalletContext,
} from '../../../packages/core/src/wallet.ts';
import { explorerAddressUrl, networkNameZh, ServiceError, type ObeliskServiceClient } from '../../../packages/core/src/obelisk-service.ts';

/** The longest secret the App accepts: a 24-word phrase with generous spacing. */
export const MAX_SECRET_LENGTH = 1024;

const KEY_RE = /^0x[0-9a-fA-F]{2,256}$/;

export type WalletOverview =
  | { state: 'none'; dataDir: string; storedIn: string }
  | { state: 'ready'; address: Address; dataDir: string; storedIn: string }
  | { state: 'key_missing'; address: Address; dataDir: string; storedIn: string; message: string }
  | { state: 'error'; dataDir: string; message: string };

export type WalletActivationResult =
  | {
    activation: 'active' | 'not_activated' | 'different_key';
    address: Address;
    chainId: number;
    network: string;
    explorerUrl: string | null;
    activatedAt: string | null;
    keyVersion: number | null;
  }
  | { activation: 'unknown'; address: Address | null; error: { code: string; message: string } };

export type WalletImportResult =
  | { ok: true; status: 'imported' | 'exists' | 'restored'; address: Address; kind: 'private-key' | 'mnemonic' }
  | { ok: false; error: { code: string; message: string; wordIndex?: number; address?: Address } };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What this data directory's wallet is, read locally (keychain and wallet.json). */
export async function readWalletOverview(context: () => WalletContext, dataDir: string): Promise<WalletOverview> {
  let ctx: WalletContext;
  try {
    ctx = context();
  } catch (error) {
    // No keychain support on this platform.
    return { state: 'error', dataDir, message: message(error) };
  }
  const storedIn = ctx.secrets.description;
  try {
    const { account } = await loadWallet(ctx);
    return { state: 'ready', address: account.address, dataDir, storedIn };
  } catch (error) {
    if (error instanceof WalletNotFoundError) return { state: 'none', dataDir, storedIn };
    if (error instanceof WalletKeyMissingError) return { state: 'key_missing', address: error.address, dataDir, storedIn, message: error.message };
    return { state: 'error', dataDir, message: message(error) };
  }
}

function serviceFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ServiceError) return { code: error.code, message: error.message };
  return { code: 'error', message: message(error) };
}

function checkedDate(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value)) ? value : null;
}

/**
 * Whether the wallet's encryption key is registered on chain, the same reading
 * as `obelisk wallet show`. The service being unreachable is a normal state
 * here, reported as 'unknown' with the reason.
 */
export async function readWalletActivation(context: () => WalletContext, service: () => ObeliskServiceClient): Promise<WalletActivationResult> {
  let account;
  try {
    ({ account } = await loadWallet(context()));
  } catch (error) {
    return { activation: 'unknown', address: null, error: { code: error instanceof WalletNotFoundError ? 'no_wallet' : 'wallet', message: message(error) } };
  }
  const { registeredKey } = await deriveEncryptionKey(account);
  try {
    const client = service();
    const chain = await client.chain();
    const key = await client.key(account.address);
    if (!Number.isSafeInteger(chain.chainId) || chain.chainId <= 0) throw new Error('The Obelisk online service returned an invalid chain id');
    const pubKey = typeof key.pubKey === 'string' && KEY_RE.test(key.pubKey) ? key.pubKey : null;
    const activation = walletActivation({ registered: key.registered === true, pubKey }, registeredKey);
    const active = activation === 'active';
    return {
      activation,
      address: account.address,
      chainId: chain.chainId,
      network: networkNameZh(chain.chainId),
      explorerUrl: explorerAddressUrl(chain.chainId, account.address),
      activatedAt: active ? checkedDate(key.updatedAt) : null,
      keyVersion: active && Number.isSafeInteger(key.version) ? key.version : null,
    };
  } catch (error) {
    return { activation: 'unknown', address: account.address, error: serviceFailure(error) };
  }
}

/**
 * Import a wallet from what the user typed in Settings. The secret is used
 * once and dropped; the result says what happened in codes the page words.
 */
export async function importWalletFromApp(context: () => WalletContext, secret: unknown): Promise<WalletImportResult> {
  if (typeof secret !== 'string' || secret.length > MAX_SECRET_LENGTH) {
    return { ok: false, error: { code: 'unrecognized', message: 'Expected a private key or a recovery phrase' } };
  }
  try {
    const { status, address, kind } = await importWallet(context(), secret);
    return { ok: true, status, address, kind };
  } catch (error) {
    if (error instanceof InvalidWalletSecretError) {
      return { ok: false, error: { code: error.reason, message: error.message, ...(error.wordIndex ? { wordIndex: error.wordIndex } : {}) } };
    }
    if (error instanceof WalletExistsError) {
      return { ok: false, error: { code: 'wallet_exists', message: error.message, address: error.address } };
    }
    // Keychain and file errors; neither ever includes the secret (keychain.ts).
    return { ok: false, error: { code: 'error', message: message(error) } };
  }
}
