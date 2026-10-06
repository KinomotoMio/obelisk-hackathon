// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Skill usage statistics (#24, vision 04 U5).
//
// Totals, distinct wallets, and the scene and outcome distributions are read
// from UsageStats through its views. The chain keeps no history that a view
// can return, and BOT Chain does not serve eth_getLogs, so the trend comes
// from this service's own record: every ReportUsage it relays and sees
// confirmed adds one entry (the UsageReported event's added invocations, at
// confirmation time). Reports sent to the contract by anyone else are in the
// totals but not in the trend.

import { parseEventLogs, type Hex, type TransactionReceipt } from 'viem';

import { usageStatsAbi } from '../../chain/abi/index.ts';
import type { ParsedRelayRequest } from './actions.ts';
import type { ServiceChainConfig } from './chains.ts';

export interface UsageTrendEntry {
  /** Confirmation time, ISO 8601. */
  at: string;
  /** Invocations this report added to the version's total. */
  added: number;
}

/** Where relayed reports are remembered: KV in the Worker, memory in tests. */
export interface UsageTrendStore {
  add(chainId: number, fingerprint: Hex, id: string, entry: UsageTrendEntry): Promise<void>;
  list(chainId: number, fingerprint: Hex): Promise<UsageTrendEntry[]>;
}

/** The relayer's onConfirmed hook: remember what a confirmed ReportUsage added. */
export function usageTrendRecorder(config: ServiceChainConfig, store: UsageTrendStore, now = () => new Date()) {
  return async (request: ParsedRelayRequest, receipt: TransactionReceipt): Promise<void> => {
    if (request.action !== 'ReportUsage') return;
    const events = parseEventLogs({ abi: usageStatsAbi, logs: receipt.logs, eventName: 'UsageReported' })
      .filter((event) => event.address.toLowerCase() === config.contracts.UsageStats.toLowerCase());
    const at = now().toISOString();
    for (const event of events) {
      const { fingerprint, addedInvocations } = event.args as { fingerprint: Hex; addedInvocations: bigint };
      if (addedInvocations === 0n) continue;
      await store.add(config.chain.id, fingerprint.toLowerCase() as Hex, `${receipt.transactionHash}:${event.logIndex}`, {
        at,
        added: Number(addedInvocations),
      });
    }
  };
}
