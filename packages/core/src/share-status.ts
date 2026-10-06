// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// What the sender sees for a share (#11, docs/vision/02 S3): one of the four
// states the Share tab shows, derived from the on-chain record the online
// service serves, plus the chain record that backs it.

import type { Hex } from 'viem';

import type { ShareInfo } from './obelisk-service.ts';

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
