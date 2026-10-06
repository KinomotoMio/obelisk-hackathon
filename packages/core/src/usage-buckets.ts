// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Outcome bucket keys for usage reports (#23, vision 04 U3/U4).
//
// UsageStats keeps two distributions per Skill version, each keyed by opaque
// bytes32 values: scenes (sceneBucketKey in scenes.ts) and outcomes. The
// outcomes distribution carries both kinds of per-invocation result:
//
//   outcome/<id>  the judged result of an invocation, at most one each:
//                 smooth (顺利), rework (有返工), failed (失败), unknown (无法判断)
//   signal/<id>   fact signals counted by rule, any number each:
//                 tool-error, user-correction, repeated-edit, repeated-invocation
//
// The key of an id is keccak256 of its UTF-8 bytes, so anyone can recompute it
// on or off chain. Like every bucket, each is a per-wallet running total no
// larger than the wallet's invocation count. 顺利率 is smooth / (smooth +
// rework + failed); unknown is shown next to it, never counted in it.

import { keccak256, stringToBytes, type Hex } from 'viem';

export const OUTCOMES = ['smooth', 'rework', 'failed', 'unknown'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const SIGNALS = ['tool-error', 'user-correction', 'repeated-edit', 'repeated-invocation'] as const;
export type Signal = (typeof SIGNALS)[number];

export type OutcomeBucketId = `outcome/${Outcome}` | `signal/${Signal}`;

export const OUTCOME_BUCKET_IDS: readonly OutcomeBucketId[] = [
  ...OUTCOMES.map((id) => `outcome/${id}` as const),
  ...SIGNALS.map((id) => `signal/${id}` as const),
];

export function outcomeBucketKey(id: OutcomeBucketId): Hex {
  return keccak256(stringToBytes(id));
}

/** Mirrors UsageStats.MAX_BUCKETS: buckets per array in one report. */
export const MAX_REPORT_BUCKETS = 32;

/** bytes32 key -> outcome bucket id, for reading distributions back. */
export function outcomeBucketIdsByKey(): Map<Hex, OutcomeBucketId> {
  return new Map(OUTCOME_BUCKET_IDS.map((id) => [outcomeBucketKey(id), id]));
}
