// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// What the sender sees for a share (#11, docs/vision/02 S3): one of the four
// states the Share tab shows, derived from the on-chain record the online
// service serves, plus the chain record that backs it.

import { getAddress, type Address, type Hex } from 'viem';

import { networkLabel, type ChainInfo, type ObeliskServiceClient, type ShareInfo } from './obelisk-service.ts';
import { UNLIMITED_OPENS, type SentShare, type ShareDrafts } from './share-drafts.ts';

/** 未读 / 已读 / 已过期 / 已撤回. */
export type ShareState = 'unread' | 'read' | 'expired' | 'revoked';

export interface ShareStateView {
  state: ShareState;
  /** Whether the recipient can still open it now. */
  canOpen: boolean;
  opens: { count: number; max: number | null; lastOpenedAt: string | null };
  expiresAt: string;
  revokedAt: string | null;
  /** The transaction that shows this state on the explorer. */
  record: { kind: 'create' | 'open' | 'revoke'; txHash: Hex; explorerUrl: string | null } | null;
}

/**
 * A revoked share reads "revoked"; otherwise one that was opened reads
 * "read" (even if it has since expired or used up its opens), and one never
 * opened reads "expired" or "unread".
 */
export function shareStateView(info: ShareInfo): ShareStateView {
  const lastOpen = info.receipts.at(-1) ?? null;
  let state: ShareState;
  let record: ShareStateView['record'] = info.transactions.create ? { kind: 'create', ...info.transactions.create } : null;
  if (info.revoked) {
    state = 'revoked';
    record = info.transactions.revoke ? { kind: 'revoke', ...info.transactions.revoke } : null;
  } else if (info.openCount > 0) {
    state = 'read';
    if (lastOpen?.txHash) record = { kind: 'open', txHash: lastOpen.txHash, explorerUrl: lastOpen.explorerUrl };
  } else {
    state = info.status === 'expired' ? 'expired' : 'unread';
  }
  return {
    state,
    canOpen: info.status === 'active',
    opens: { count: info.openCount, max: info.maxOpens, lastOpenedAt: lastOpen?.openedAt ?? null },
    expiresAt: info.expiresAt,
    revokedAt: info.revokedAt,
    record,
  };
}

/**
 * The short number people use for a share, as the reader page watermark shows
 * it: `S-` and the first four hex digits of the share id (`#S-3F2A`).
 */
export function shareNumber(shareId: string): string {
  return `S-${shareId.slice(2, 6).toUpperCase()}`;
}

const SHARE_NUMBER = /^#?S-([0-9a-f]{4})$/i;

/** Whether `ref` is a share number such as `S-3F2A` or `#S-3F2A`. */
export function isShareNumber(ref: string): boolean {
  return SHARE_NUMBER.test(ref.trim());
}

/**
 * The sent shares whose share id starts with that number. Four hex digits are
 * short enough to collide, so callers must refuse when more than one matches.
 */
export function sentSharesByNumber(sent: SentShare[], ref: string): SentShare[] {
  const match = SHARE_NUMBER.exec(ref.trim());
  if (!match) return [];
  const prefix = `0x${match[1]!.toLowerCase()}`;
  return sent.filter((record) => record.shareId.toLowerCase().startsWith(prefix));
}

/** A sent share as `obelisk share list/status/revoke` and the App's Share tab show it. */
export function sentShareView(sent: SentShare | null, info: ShareInfo | null) {
  const shareId = sent?.shareId ?? info!.shareId;
  return {
    ...(sent ? { draft: sent.draftId } : {}),
    shareId,
    number: shareNumber(shareId),
    title: sent?.title ?? null,
    ...(sent ? { session: { id: sent.source.sessionId, provider: sent.source.provider }, messages: { from: sent.range.from, to: sent.range.to } } : {}),
    recipient: sent?.recipient ?? getAddress(info!.recipient),
    ...(sent ? { rules: { opens: sent.maxOpens === UNLIMITED_OPENS ? 'unlimited' as const : sent.maxOpens, expiresAt: sent.expiresAt } } : {}),
    ...(info ? shareStateView(info) : {}),
    ...(sent ? { sentAt: sent.sentAt, link: sent.link } : {}),
  };
}

/** The chain record of one share, refusing a share sent on another network. */
export async function readShareInfo(client: ObeliskServiceClient, chain: ChainInfo, shareId: Hex, sent: SentShare | null): Promise<ShareInfo> {
  if (sent && sent.chainId !== chain.chainId) {
    throw new Error(`Share ${shareId} was sent on ${networkLabel(sent.chainId)}, but the Obelisk online service at ${client.baseUrl} serves ${networkLabel(chain.chainId)}`);
  }
  const info = await client.share(shareId);
  if (!info) throw new Error(`${networkLabel(chain.chainId)} has no share ${shareId}`);
  return info;
}

type SentShareFields = Omit<ReturnType<typeof sentShareView>, 'state'>;

export type SentShareListing =
  | (SentShareFields & { state: ShareState })
  | (SentShareFields & { state: 'unknown'; error: string | null });

/**
 * Every share sent from this computer, newest first, each with its state from
 * the chain. A share whose state cannot be read (service unreachable, another
 * network) is listed as `unknown` with the reason, never dropped.
 */
export async function listSentShares(store: ShareDrafts, client: ObeliskServiceClient, options: { to?: Address } = {}): Promise<{ shares: SentShareListing[]; chain: ChainInfo | null }> {
  const records = (await store.listSent()).filter((sent) => options.to === undefined || getAddress(sent.recipient) === getAddress(options.to));
  let chain: ChainInfo | null = null;
  let serviceError: string | null = null;
  if (records.length > 0) {
    try {
      chain = await client.chain();
    } catch (error) {
      serviceError = error instanceof Error ? error.message : String(error);
    }
  }
  const shares = await Promise.all(records.map(async (sent): Promise<SentShareListing> => {
    if (!chain) return { ...sentShareView(sent, null), state: 'unknown', error: serviceError };
    try {
      return sentShareView(sent, await readShareInfo(client, chain, sent.shareId, sent)) as SentShareListing;
    } catch (error) {
      return { ...sentShareView(sent, null), state: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
  }));
  return { shares, chain };
}
