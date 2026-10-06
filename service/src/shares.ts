// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Private shares (docs/vision/02). The sender's Obelisk encrypts locally and
// uploads ciphertext plus a key package sealed to the recipient's registered
// key (#8); this service stores both and relays the sender-signed CreateShare.
// It never holds a key that opens either.
//
//   POST /v1/shares        { message: CreateShare, signature, keyPackage, ciphertext (base64) }
//   GET  /v1/shares/:id    the on-chain rules, status, open receipts, and transactions
//
// Formats (the CLI writes them in packages/core/src/share-crypto.ts; the web
// reader, #10, reads them):
//   ciphertext   0x01 || nonce (12) || AES-256-GCM(content key, snapshot JSON, aad = shareId) || tag (16)
//   contentHash  SHA-256(ciphertext), as signed in CreateShare
//   keyPackage   { version: 1, algorithm: "x25519-hkdf-sha256-aes-256-gcm",
//                  recipientKey, ephemeralPublicKey, nonce, wrappedKey }

import { bytesToHex, getAddress, isHex, size, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';

import { keyRegistryAbi, shareRegistryAbi } from '../../chain/abi/index.ts';
import { parseRelayRequest, RequestError, type ParsedRelayRequest } from './actions.ts';
import { explorerAddressUrl, explorerTxUrl, type ServiceChainConfig } from './chains.ts';
import { verifyActionSignature } from './relayer.ts';

export const KEY_PACKAGE_ALGORITHM = 'x25519-hkdf-sha256-aes-256-gcm';
/** Largest ciphertext accepted for one share. */
export const MAX_SHARE_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
/** Request body limit for an upload: base64 ciphertext plus the JSON around it. */
export const MAX_SHARE_BODY_BYTES = Math.ceil(MAX_SHARE_CIPHERTEXT_BYTES / 3) * 4 + 64 * 1024;
/** `maxOpens` meaning "no limit". */
export const UNLIMITED_OPENS = 0xffffffff;
const MAX_RECEIPTS_LISTED = 100;

export interface KeyPackage {
  version: 1;
  algorithm: typeof KEY_PACKAGE_ALGORITHM;
  recipientKey: Hex;
  ephemeralPublicKey: Hex;
  nonce: Hex;
  wrappedKey: Hex;
}

/** Transactions this service sent for a share, for explorer links. */
export interface ShareTransactions {
  create?: Hex;
  opens?: { txHash: Hex; openCount: number }[];
  revoke?: Hex;
}

export interface ShareStore {
  putContent(shareId: Hex, ciphertext: Uint8Array, keyPackage: KeyPackage): Promise<void>;
  getContent(shareId: Hex): Promise<{ ciphertext: Uint8Array; keyPackage: KeyPackage } | null>;
  hasContent(shareId: Hex): Promise<boolean>;
  deleteContent(shareId: Hex): Promise<void>;
  getTransactions(shareId: Hex): Promise<ShareTransactions>;
  putTransactions(shareId: Hex, transactions: ShareTransactions): Promise<void>;
}

export interface ShareDeps {
  config: ServiceChainConfig;
  publicClient: PublicClient;
  store: ShareStore | null;
  /** Forward `{ action, message, signature }` to the serialized relay queue. */
  relay(body: unknown): Promise<Response>;
}

export function requireStore(deps: ShareDeps): ShareStore {
  if (!deps.store) throw new RequestError(503, 'storage_unavailable', 'This service has no share storage bound (R2 BLOBS / KV INDEX)');
  return deps.store;
}

export function parseShareId(value: string): Hex {
  if (!isHex(value, { strict: true }) || size(value as Hex) !== 32) throw new RequestError(400, 'invalid_share_id', `Not a share id (32 bytes of 0x hex): ${value}`);
  return value.toLowerCase() as Hex;
}

export function base64ToBytes(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new RequestError(400, 'invalid_ciphertext', 'ciphertext must be base64');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<Hex> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function hexOfSize(value: unknown, bytes: number, field: string): Hex {
  if (typeof value !== 'string' || !isHex(value, { strict: true }) || size(value as Hex) !== bytes) {
    throw new RequestError(400, 'invalid_key_package', `keyPackage.${field} must be ${bytes} bytes of 0x hex`);
  }
  return value.toLowerCase() as Hex;
}

export function parseKeyPackage(value: unknown): KeyPackage {
  if (typeof value !== 'object' || value === null) throw new RequestError(400, 'invalid_key_package', 'keyPackage must be an object');
  const input = value as Record<string, unknown>;
  if (input['version'] !== 1 || input['algorithm'] !== KEY_PACKAGE_ALGORITHM) {
    throw new RequestError(400, 'invalid_key_package', `keyPackage must be version 1 of ${KEY_PACKAGE_ALGORITHM}`);
  }
  return {
    version: 1,
    algorithm: KEY_PACKAGE_ALGORITHM,
    recipientKey: hexOfSize(input['recipientKey'], 33, 'recipientKey'),
    ephemeralPublicKey: hexOfSize(input['ephemeralPublicKey'], 32, 'ephemeralPublicKey'),
    nonce: hexOfSize(input['nonce'], 12, 'nonce'),
    wrappedKey: hexOfSize(input['wrappedKey'], 48, 'wrappedKey'),
  };
}

export interface OnChainShare {
  shareId: Hex;
  sender: Address;
  recipient: Address;
  contentHash: Hex;
  maxOpens: number;
  openCount: number;
  createdAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
  revokedAt: bigint;
}

export async function readOnChainShare(deps: ShareDeps, shareId: Hex): Promise<OnChainShare | null> {
  const [sender, recipient, contentHash, maxOpens, openCount, createdAt, expiresAt, revoked, revokedAt] = await deps.publicClient.readContract({
    address: deps.config.contracts.ShareRegistry,
    abi: shareRegistryAbi,
    functionName: 'getShare',
    args: [shareId],
  });
  if (sender === zeroAddress) return null;
  return { shareId, sender, recipient, contentHash, maxOpens, openCount, createdAt, expiresAt, revoked, revokedAt };
}

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

/** POST /v1/shares: store the encrypted content, then relay CreateShare. */
export async function createShare(deps: ShareDeps, body: unknown): Promise<Response> {
  const store = requireStore(deps);
  if (typeof body !== 'object' || body === null) throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object');
  const { message, signature, keyPackage: rawKeyPackage, ciphertext: rawCiphertext } = body as Record<string, unknown>;
  const request: ParsedRelayRequest = parseRelayRequest({ action: 'CreateShare', message, signature });
  const shareId = request.message['shareId'] as Hex;
  const recipient = request.message['recipient'] as Address;

  if (typeof rawCiphertext !== 'string') throw new RequestError(400, 'invalid_ciphertext', 'ciphertext must be a base64 string');
  const ciphertext = base64ToBytes(rawCiphertext);
  if (ciphertext.length === 0 || ciphertext.length > MAX_SHARE_CIPHERTEXT_BYTES) {
    throw new RequestError(413, 'ciphertext_too_large', `ciphertext must be 1 to ${MAX_SHARE_CIPHERTEXT_BYTES} bytes (got ${ciphertext.length}); share fewer messages`);
  }
  if ((await sha256Hex(ciphertext)) !== (request.message['contentHash'] as Hex)) {
    throw new RequestError(400, 'content_hash_mismatch', 'message.contentHash is not the SHA-256 of the uploaded ciphertext');
  }
  const keyPackage = parseKeyPackage(rawKeyPackage);

  const [registered, , version] = await deps.publicClient.readContract({
    address: deps.config.contracts.KeyRegistry,
    abi: keyRegistryAbi,
    functionName: 'keyOf',
    args: [recipient],
  });
  if (version === 0) {
    throw new RequestError(422, 'recipient_not_activated', `${recipient} has not activated an Obelisk wallet, so nothing can be encrypted to it yet`);
  }
  if (registered.toLowerCase() !== keyPackage.recipientKey) {
    throw new RequestError(409, 'recipient_key_changed', `The key package is sealed to a key ${recipient} no longer has registered; encrypt again`);
  }
  if (await readOnChainShare(deps, shareId)) throw new RequestError(409, 'share_exists', `Share ${shareId} already exists on chain`);
  await verifyActionSignature(deps.publicClient, deps.config, request);

  await store.putContent(shareId, ciphertext, keyPackage);
  const relayed = await deps.relay({ action: 'CreateShare', message, signature });
  const result = await relayed.json() as Record<string, unknown> & { txHash?: Hex; error?: { code?: string } };
  if (relayed.status >= 400) {
    // Nothing reached the chain (or it reverted): do not keep the upload.
    // An ambiguous upstream failure keeps it, since the transaction may be out.
    if (result.error?.code !== 'upstream_error') await store.deleteContent(shareId).catch(() => undefined);
    return new Response(JSON.stringify(result, null, 2), { status: relayed.status, headers: relayed.headers });
  }
  if (result.txHash) await store.putTransactions(shareId, { ...(await store.getTransactions(shareId)), create: result.txHash });
  return new Response(JSON.stringify({ ...result, shareId }, null, 2), { status: relayed.status, headers: relayed.headers });
}

export type ShareStatus = 'active' | 'exhausted' | 'expired' | 'revoked';

/** GET /v1/shares/:id: public rules and receipts, all read from chain. */
export async function readShare(deps: ShareDeps, shareId: Hex) {
  const share = await readOnChainShare(deps, shareId);
  if (!share) throw new RequestError(404, 'unknown_share', `No share ${shareId} on ${deps.config.chain.name}`);
  const { publicClient, config } = deps;
  const address = config.contracts.ShareRegistry;
  const [block, receiptCount, transactions, contentStored] = await Promise.all([
    publicClient.getBlock(),
    publicClient.readContract({ address, abi: shareRegistryAbi, functionName: 'receiptCount', args: [shareId] }),
    deps.store?.getTransactions(shareId).catch(() => ({} as ShareTransactions)) ?? ({} as ShareTransactions),
    deps.store?.hasContent(shareId).catch(() => false) ?? false,
  ]);
  const listed = Math.min(Number(receiptCount), MAX_RECEIPTS_LISTED);
  const receipts = await Promise.all(Array.from({ length: listed }, async (_, index) => {
    const [openedAt, blockNumber] = await publicClient.readContract({ address, abi: shareRegistryAbi, functionName: 'receiptAt', args: [shareId, BigInt(index)] });
    const txHash = transactions.opens?.find((open) => open.openCount === index + 1)?.txHash ?? null;
    return { openCount: index + 1, openedAt: iso(openedAt), blockNumber: blockNumber.toString(), txHash, explorerUrl: txHash ? explorerTxUrl(config, txHash) : null };
  }));
  let status: ShareStatus = 'active';
  if (share.revoked) status = 'revoked';
  else if (block.timestamp >= share.expiresAt) status = 'expired';
  else if (share.openCount >= share.maxOpens) status = 'exhausted';
  const link = (hash: Hex | undefined) => (hash ? { txHash: hash, explorerUrl: explorerTxUrl(config, hash) } : null);
  return {
    shareId,
    status,
    sender: getAddress(share.sender),
    recipient: getAddress(share.recipient),
    contentHash: share.contentHash,
    maxOpens: share.maxOpens === UNLIMITED_OPENS ? null : share.maxOpens,
    openCount: share.openCount,
    createdAt: iso(share.createdAt),
    expiresAt: iso(share.expiresAt),
    revoked: share.revoked,
    revokedAt: share.revoked ? iso(share.revokedAt) : null,
    receipts,
    transactions: { create: link(transactions.create), revoke: link(transactions.revoke) },
    contentStored,
    explorer: {
      sender: explorerAddressUrl(config, share.sender),
      recipient: explorerAddressUrl(config, share.recipient),
      contract: explorerAddressUrl(config, address),
    },
  };
}
