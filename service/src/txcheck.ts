// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// GET /v1/txs?hashes=0x…,0x… — whether each transaction exists on this
// service's chain and succeeded (#32). The Playground run page (/runs/<id>)
// asks this for every transaction a run recorded, so a reader sees each one
// confirmed on chain rather than taking the record's word for it.
//
// Read-only and public. Unlike GET /v1/tx/:hash it takes a batch, tells a
// missing transaction from an RPC failure (a failed lookup is `unavailable`,
// never `not_found`), and names the Obelisk contract a transaction called.
// Final answers (confirmed, reverted) do not change, so they are cached in KV;
// pending, missing, and failed lookups are asked again next time.

import type { Hex, PublicClient } from 'viem';

import { RequestError } from './actions.ts';
import { CONTRACT_NAMES, explorerTxUrl, type ServiceChainConfig } from './chains.ts';

export const MAX_TX_CHECK = 50;

export type TxCheckStatus = 'confirmed' | 'reverted' | 'pending' | 'not_found' | 'unavailable';

export interface TxCheck {
  hash: string;
  status: TxCheckStatus;
  blockNumber: string | null;
  /** Block time, ISO 8601; null until the transaction is in a block. */
  timestamp: string | null;
  from: string | null;
  to: string | null;
  /** The Obelisk contract the transaction called (KeyRegistry, ShareRegistry, …), if any. */
  contract: string | null;
  explorerUrl: string | null;
}

/** Final answers by `<chainId>:<hash>`; KV in the Worker (`txcheck:` keys). */
export interface TxCheckCache {
  get(key: string): Promise<TxCheck | null>;
  put(key: string, value: TxCheck): Promise<void>;
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const NOT_FOUND = new Set(['TransactionReceiptNotFoundError', 'TransactionNotFoundError']);

export function parseHashes(query: URLSearchParams): Hex[] {
  const raw = query.get('hashes');
  if (!raw) throw new RequestError(400, 'missing_hashes', 'Pass the transactions to check as ?hashes=0x…,0x…');
  const hashes = [...new Set(raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const invalid = hashes.find((hash) => !HASH.test(hash));
  if (invalid) throw new RequestError(400, 'invalid_hash', `Not a transaction hash: ${invalid.slice(0, 80)}`);
  if (hashes.length > MAX_TX_CHECK) throw new RequestError(400, 'too_many_hashes', `Check at most ${MAX_TX_CHECK} transactions per request (got ${hashes.length})`);
  return hashes as Hex[];
}

/** `undefined` when the chain has no such object, the error when the lookup failed. */
async function lookup<T>(read: () => Promise<T | null>): Promise<{ value: T | null } | { error: unknown }> {
  try {
    return { value: await read() };
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.has(error.name)) return { value: null };
    return { error };
  }
}

export async function checkTransactions(
  client: PublicClient,
  config: ServiceChainConfig,
  hashes: Hex[],
  cache: TxCheckCache | null,
): Promise<{ chainId: number; checkedAt: string; transactions: TxCheck[] }> {
  const chainId = config.chain.id;
  const contracts = new Map(CONTRACT_NAMES.map((name) => [config.contracts[name].toLowerCase(), name]));
  const base = (hash: Hex): TxCheck => ({
    hash, status: 'not_found', blockNumber: null, timestamp: null, from: null, to: null, contract: null, explorerUrl: explorerTxUrl(config, hash),
  });

  const cached = await Promise.all(hashes.map((hash) => (cache ? cache.get(`${chainId}:${hash}`).catch(() => null) : null)));
  const open = hashes.filter((_, i) => !cached[i]);

  // One JSON-RPC batch per round (rpc.ts): receipts, then their blocks, then
  // the pending transactions among the ones without a receipt.
  const receipts = await Promise.all(open.map((hash) => lookup(() => client.getTransactionReceipt({ hash }))));
  const blockNumbers = [...new Set(receipts.flatMap((r) => ('value' in r && r.value ? [r.value.blockNumber] : [])))];
  const blocks = new Map(await Promise.all(blockNumbers.map(async (n) => [n, await lookup(() => client.getBlock({ blockNumber: n }))] as const)));
  const missing = open.filter((_, i) => { const r = receipts[i]!; return 'value' in r && !r.value; });
  const pending = new Map(await Promise.all(missing.map(async (hash) => [hash, await lookup(() => client.getTransaction({ hash }))] as const)));

  const fresh = new Map<string, TxCheck>();
  for (const [i, hash] of open.entries()) {
    const receipt = receipts[i]!;
    const entry = base(hash);
    if ('error' in receipt) {
      fresh.set(hash, { ...entry, status: 'unavailable' });
      continue;
    }
    if (receipt.value) {
      const r = receipt.value;
      const block = blocks.get(r.blockNumber);
      const to = r.to ? r.to.toLowerCase() : null;
      fresh.set(hash, {
        ...entry,
        status: r.status === 'success' ? 'confirmed' : 'reverted',
        blockNumber: r.blockNumber.toString(),
        timestamp: block && 'value' in block && block.value ? new Date(Number(block.value.timestamp) * 1000).toISOString() : null,
        from: r.from.toLowerCase(),
        to,
        contract: to ? contracts.get(to) ?? null : null,
      });
      continue;
    }
    const tx = pending.get(hash)!;
    if ('error' in tx) fresh.set(hash, { ...entry, status: 'unavailable' });
    else if (tx.value) fresh.set(hash, { ...entry, status: 'pending', from: tx.value.from.toLowerCase(), to: tx.value.to?.toLowerCase() ?? null });
    else fresh.set(hash, entry);
  }

  if (cache) {
    // Only answers that cannot change, and only with the block time, so a
    // cached entry is as complete as a fresh one.
    await Promise.all([...fresh.values()]
      .filter((entry) => (entry.status === 'confirmed' || entry.status === 'reverted') && entry.timestamp)
      .map((entry) => cache.put(`${chainId}:${entry.hash}`, entry).catch(() => {})));
  }

  return {
    chainId,
    checkedAt: new Date().toISOString(),
    transactions: hashes.map((hash, i) => cached[i] ?? fresh.get(hash)!),
  };
}
