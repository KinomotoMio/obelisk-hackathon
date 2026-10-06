// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Private shares (docs/vision/02). The sender's Obelisk encrypts locally and
// uploads ciphertext plus a key package sealed to the recipient's registered
// key (#8); this service stores both and relays the sender-signed CreateShare.
// It never holds a key that opens either.
//
// Opening (#9): the recipient signs RecordOpen. The service checks the share's
// on-chain rules, relays that RecordOpen (the contract checks the same rules
// again), and hands out the key package only once the receipt is on chain.
//
//   POST /v1/shares             { message: CreateShare, signature, keyPackage, ciphertext (base64) }
//   GET  /v1/shares/:id         the on-chain rules, status, open receipts, and transactions
//   POST /v1/shares/:id/open    { message: RecordOpen, signature } -> receipt, key package, ciphertext
//   POST /v1/shares/:id/revoke  { message: RevokeShare, signature } -> relayed RevokeShare; content deleted
//
// Formats (the CLI writes them in packages/core/src/share-crypto.ts; the web
// reader, #10, reads them):
//   ciphertext   0x01 || nonce (12) || AES-256-GCM(content key, snapshot JSON, aad = shareId) || tag (16)
//   contentHash  SHA-256(ciphertext), as signed in CreateShare
//   keyPackage   { version: 1, algorithm: "x25519-hkdf-sha256-aes-256-gcm",
//                  recipientKey, ephemeralPublicKey, nonce, wrappedKey }

import { bytesToHex, getAddress, isAddressEqual, isHex, keccak256, parseEventLogs, size, zeroAddress, type Address, type Hex, type PublicClient } from 'viem';

import { keyRegistryAbi, shareRegistryAbi } from '../../chain/abi/index.ts';
import { OpenStatus } from '../../chain/eip712.ts';
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
/**
 * Longest a RecordOpen signature may stay valid. It asks for one open, now;
 * a long-lived one would let its key package be fetched again much later.
 */
export const MAX_OPEN_SIGNATURE_SECONDS = 3600n;

export interface KeyPackage {
  version: 1;
  algorithm: typeof KEY_PACKAGE_ALGORITHM;
  recipientKey: Hex;
  ephemeralPublicKey: Hex;
  nonce: Hex;
  wrappedKey: Hex;
}

/** One RecordOpen this service relayed. */
export interface ShareOpenRecord {
  txHash: Hex;
  /** The share's open count after this open; null until the receipt is confirmed. */
  openCount: number | null;
  /** keccak256 of the recipient's signature, so the same request can be resumed. */
  request: Hex;
}

/** Transactions this service sent for a share, for explorer links. */
export interface ShareTransactions {
  create?: Hex;
  opens?: ShareOpenRecord[];
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
  /** Same queue, for the service's own actions (RecordOpen). */
  relayInternal(body: unknown): Promise<Response>;
}

/** A JSON answer; the router adds the headers. */
export interface ShareReply {
  status: number;
  body: Record<string, unknown>;
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

/**
 * A revoked share's ciphertext and key package are deleted: nobody may open
 * it again, so the service has no reason to keep them. Runs when a revoke is
 * confirmed and again whenever a revoked share is read or opened, which also
 * covers a revoke that was pending or relayed through /v1/relay.
 */
async function dropRevokedContent(store: ShareStore | null, shareId: Hex): Promise<void> {
  if (store && (await store.hasContent(shareId).catch(() => false))) await store.deleteContent(shareId).catch(() => undefined);
}

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
  if (share.revoked) await dropRevokedContent(deps.store, shareId);
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

function shareRecordUrl(deps: ShareDeps, transactions: ShareTransactions): string | null {
  return transactions.create
    ? explorerTxUrl(deps.config, transactions.create)
    : explorerAddressUrl(deps.config, deps.config.contracts.ShareRegistry);
}

/** Turn a `checkOpen` result other than Ok into the refusal the reader shows. */
function openRefusal(deps: ShareDeps, share: OnChainShare, opener: Address, status: number, transactions: ShareTransactions): RequestError {
  const details = { recipient: getAddress(share.recipient), opener, explorerUrl: shareRecordUrl(deps, transactions) };
  switch (status) {
    case OpenStatus.NotRecipient:
      return new RequestError(403, 'not_recipient', `This share belongs to ${details.recipient}; ${opener} cannot open it`, details);
    case OpenStatus.Revoked:
      return new RequestError(410, 'share_revoked', `The sender revoked this share at ${iso(share.revokedAt)}`, details);
    case OpenStatus.Expired:
      return new RequestError(410, 'share_expired', `This share expired at ${iso(share.expiresAt)}`, details);
    case OpenStatus.Exhausted:
      return new RequestError(410, 'opens_exhausted', `This share has been opened ${share.openCount} of ${share.maxOpens} times; no opens are left`, details);
    default:
      return new RequestError(404, 'unknown_share', `No share ${share.shareId} on ${deps.config.chain.name}`);
  }
}

async function relayFailure(relayed: Response): Promise<ShareReply> {
  return { status: relayed.status, body: await relayed.json() as Record<string, unknown> };
}

/**
 * Finish an open whose RecordOpen is out: once its receipt is confirmed,
 * hand over the key package and ciphertext; until then, answer 202.
 */
async function finishOpen(deps: ShareDeps, store: ShareStore, share: OnChainShare, txHash: Hex): Promise<ShareReply> {
  const { publicClient, config } = deps;
  const explorerUrl = explorerTxUrl(config, txHash);
  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) {
    return {
      status: 202,
      body: {
        status: 'pending',
        shareId: share.shareId,
        txHash,
        explorerUrl,
        message: 'The open receipt is not confirmed yet; send the same request again to receive the key package',
      },
    };
  }
  if (receipt.status !== 'success') {
    throw new RequestError(502, 'transaction_reverted', `The open receipt transaction ${txHash} reverted; sign a new open request`, { txHash, explorerUrl });
  }
  const [opened] = parseEventLogs({ abi: shareRegistryAbi, eventName: 'ShareOpened', logs: receipt.logs })
    .filter((log) => isAddressEqual(log.address, config.contracts.ShareRegistry) && log.args.shareId.toLowerCase() === share.shareId);
  if (!opened) throw new RequestError(502, 'upstream_error', `Transaction ${txHash} did not record an open of share ${share.shareId}`);
  const openCount = opened.args.openCount;

  const transactions = await store.getTransactions(share.shareId);
  const opens = (transactions.opens ?? []).map((open) => (open.txHash === txHash ? { ...open, openCount } : open));
  await store.putTransactions(share.shareId, { ...transactions, opens }).catch(() => undefined);

  const [content, block] = await Promise.all([
    store.getContent(share.shareId),
    publicClient.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (!content) throw new RequestError(410, 'content_unavailable', `The encrypted content of share ${share.shareId} is no longer stored on this service`);
  const unlimited = share.maxOpens === UNLIMITED_OPENS;
  return {
    status: 200,
    body: {
      status: 'opened',
      shareId: share.shareId,
      sender: getAddress(share.sender),
      recipient: getAddress(share.recipient),
      openCount,
      maxOpens: unlimited ? null : share.maxOpens,
      remainingOpens: unlimited ? null : Math.max(share.maxOpens - openCount, 0),
      expiresAt: iso(share.expiresAt),
      openedAt: iso(block.timestamp),
      receipt: { txHash, blockNumber: receipt.blockNumber.toString(), explorerUrl },
      contentHash: share.contentHash,
      keyPackage: content.keyPackage,
      ciphertext: bytesToBase64(content.ciphertext),
    },
  };
}

/**
 * POST /v1/shares/:id/open: the recipient's signed RecordOpen proves who is
 * opening. Refusals (not the recipient, revoked, expired, no opens left) cost
 * no gas. Otherwise the open receipt goes on chain first, and only a confirmed
 * receipt releases the key package, so every release is counted.
 */
export async function openShare(deps: ShareDeps, shareId: Hex, body: unknown): Promise<ShareReply> {
  const store = requireStore(deps);
  if (typeof body !== 'object' || body === null) throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object');
  const { message, signature } = body as Record<string, unknown>;
  const request = parseRelayRequest({ action: 'RecordOpen', message, signature }, { internal: true });
  if (request.message['shareId'] !== shareId) {
    throw new RequestError(400, 'share_id_mismatch', `message.shareId is ${String(request.message['shareId'])}, but the URL names share ${shareId}`);
  }
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (request.deadline > nowSeconds + MAX_OPEN_SIGNATURE_SECONDS) {
    throw new RequestError(400, 'deadline_too_far', `An open request may be valid for at most ${MAX_OPEN_SIGNATURE_SECONDS} s; sign again with an earlier deadline`);
  }
  const share = await readOnChainShare(deps, shareId);
  if (!share) throw new RequestError(404, 'unknown_share', `No share ${shareId} on ${deps.config.chain.name}`);
  await verifyActionSignature(deps.publicClient, deps.config, request);
  const opener = request.signer;

  // The same signed request again (after a 202, or a dropped connection):
  // resume that open instead of counting a new one.
  const requestId = keccak256(request.signature);
  const transactions = await store.getTransactions(shareId);
  const earlier = transactions.opens?.find((open) => open.request === requestId);
  if (earlier) {
    if (request.deadline <= nowSeconds) throw new RequestError(400, 'deadline_passed', 'This open request has expired; sign a new one');
    return finishOpen(deps, store, share, earlier.txHash);
  }

  const status = await deps.publicClient.readContract({
    address: deps.config.contracts.ShareRegistry,
    abi: shareRegistryAbi,
    functionName: 'checkOpen',
    args: [shareId, opener],
  });
  if (status === OpenStatus.Revoked) await dropRevokedContent(store, shareId);
  if (status !== OpenStatus.Ok) throw openRefusal(deps, share, opener, status, transactions);
  if (!(await store.hasContent(shareId))) {
    throw new RequestError(410, 'content_unavailable', `The encrypted content of share ${shareId} is no longer stored on this service`);
  }

  const relayed = await deps.relayInternal({ action: 'RecordOpen', message, signature });
  if (relayed.status >= 400) return relayFailure(relayed);
  const { txHash } = await relayed.json() as { txHash: Hex };
  const latest = await store.getTransactions(shareId);
  await store.putTransactions(shareId, { ...latest, opens: [...(latest.opens ?? []), { txHash, openCount: null, request: requestId }] });
  return finishOpen(deps, store, share, txHash);
}

/** POST /v1/shares/:id/revoke: relay the sender's RevokeShare and keep its transaction with the share. */
export async function revokeShare(deps: ShareDeps, shareId: Hex, body: unknown): Promise<ShareReply> {
  if (typeof body !== 'object' || body === null) throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object');
  const { message, signature } = body as Record<string, unknown>;
  const request = parseRelayRequest({ action: 'RevokeShare', message, signature });
  if (request.message['shareId'] !== shareId) {
    throw new RequestError(400, 'share_id_mismatch', `message.shareId is ${String(request.message['shareId'])}, but the URL names share ${shareId}`);
  }
  const share = await readOnChainShare(deps, shareId);
  if (!share) throw new RequestError(404, 'unknown_share', `No share ${shareId} on ${deps.config.chain.name}`);
  await verifyActionSignature(deps.publicClient, deps.config, request);
  if (!isAddressEqual(share.sender, request.signer)) {
    throw new RequestError(403, 'not_sender', `Only the sender ${getAddress(share.sender)} can revoke this share`);
  }
  if (share.revoked) throw new RequestError(409, 'already_revoked', `This share was already revoked at ${iso(share.revokedAt)}`);

  const relayed = await deps.relay({ action: 'RevokeShare', message, signature });
  if (relayed.status >= 400) return relayFailure(relayed);
  const result = await relayed.json() as Record<string, unknown> & { txHash: Hex };
  if (deps.store) {
    await deps.store.putTransactions(shareId, { ...(await deps.store.getTransactions(shareId)), revoke: result.txHash }).catch(() => undefined);
    if (result['status'] === 'confirmed') await dropRevokedContent(deps.store, shareId);
  }
  return { status: relayed.status, body: { ...result, shareId } };
}
