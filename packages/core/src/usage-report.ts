// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Usage reports (#23, vision 04 U4): what this wallet tells UsageStats about
// the minted Skill versions it used.
//
// A report is one wallet's running totals for one minted version: how many
// times it was invoked in this data directory's history (recognized by
// skill-invocations.ts, #22), plus scene and outcome buckets. UsageStats adds
// only the increase since the wallet's previous report and rejects any
// decrease, so re-sending a report never double counts and one wallet is
// counted once per version.
//
// Only versions minted on the service's chain are reported: the user's own
// minted versions and minted versions they fetched (#17). Drafts and Skills
// that are not in the library stay local. Nothing else leaves the machine: no
// session content, names, paths, or timestamps, only the counts.
//
// Scene and outcome buckets come from per-invocation annotations (#25 fills
// them in). Without annotations the bucket arrays are empty, which UsageStats
// accepts; the format already carries them.

import type { Address, Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

import { obeliskDomain, usageStatsTypes } from './chain-protocol.ts';
import { migrateSceneTag, sceneBucketKey } from './scenes.ts';
import type { SkillInvocation, SkillVersionMatch } from './skill-invocations.ts';
import { MAX_REPORT_BUCKETS, outcomeBucketKey, type Outcome, type OutcomeBucketId, type Signal } from './usage-buckets.ts';

/** What #25 knows about one invocation: observed scenes, judged outcome, fact signals. */
export interface InvocationAnnotation {
  scenes?: readonly string[];
  outcome?: Outcome | null;
  signals?: readonly Signal[];
}

export type InvocationAnnotator = (invocation: SkillInvocation) => InvocationAnnotation | null;

export interface ReportBucket {
  key: Hex;
  /** The scene tag (current vocabulary version) or outcome bucket id. */
  label: string;
  cumulative: number;
}

export interface UsageReportPlan {
  /** 64-hex version fingerprint, as in the library. */
  fingerprint: string;
  skillId: string;
  versionIndex: number;
  /** Library or installed names that hold this version. */
  names: string[];
  state: 'minted' | 'fetched';
  cumulativeInvocations: number;
  sessions: number;
  scenes: ReportBucket[];
  outcomes: ReportBucket[];
}

/**
 * Canonical bucket array: at most MAX_REPORT_BUCKETS (the largest counts
 * kept), keys strictly ascending as UsageStats requires.
 */
export function toReportBuckets(counts: ReadonlyMap<Hex, { label: string; cumulative: number }>): ReportBucket[] {
  return [...counts.entries()]
    .map(([key, value]) => ({ key: key.toLowerCase() as Hex, label: value.label, cumulative: value.cumulative }))
    .filter((bucket) => bucket.cumulative > 0)
    .sort((a, b) => b.cumulative - a.cumulative || (a.key < b.key ? -1 : 1))
    .slice(0, MAX_REPORT_BUCKETS)
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

function chainVersion(match: SkillVersionMatch, chainId: number): { skillId: string; versionIndex: number } | null {
  if (match.state === 'minted' && match.mint?.chainId === chainId) return { skillId: match.mint.skillId, versionIndex: match.mint.versionIndex };
  if (match.state === 'fetched' && match.fetched?.chainId === chainId) return { skillId: match.fetched.skillId, versionIndex: match.fetched.versionIndex };
  return null;
}

/** Fingerprints of versions that are reported: minted or fetched on `chainId` (any chain when omitted). */
export function reportableFingerprints(versions: ReadonlyMap<string, SkillVersionMatch[]>, chainId?: number): Set<string> {
  const out = new Set<string>();
  for (const [fingerprint, matches] of versions) {
    const onChain = matches.some((match) => chainId === undefined
      ? (match.state === 'minted' && match.mint !== null) || (match.state === 'fetched' && match.fetched !== undefined)
      : chainVersion(match, chainId) !== null);
    if (onChain) out.add(fingerprint);
  }
  return out;
}

/** One report per minted version on `chainId` that has at least one invocation. */
export function planUsageReports(
  invocations: readonly SkillInvocation[],
  versions: ReadonlyMap<string, SkillVersionMatch[]>,
  chainId: number,
  annotate: InvocationAnnotator = () => null,
): UsageReportPlan[] {
  const byFingerprint = new Map<string, SkillInvocation[]>();
  for (const invocation of invocations) {
    if (invocation.fingerprint === null) continue;
    const list = byFingerprint.get(invocation.fingerprint) ?? [];
    list.push(invocation);
    byFingerprint.set(invocation.fingerprint, list);
  }
  const plans: UsageReportPlan[] = [];
  for (const [fingerprint, items] of byFingerprint) {
    const matches = (versions.get(fingerprint) ?? [])
      .map((match) => ({ match, onChain: chainVersion(match, chainId) }))
      .filter((entry) => entry.onChain !== null);
    const first = matches[0];
    if (!first) continue;
    const scenes = new Map<Hex, { label: string; cumulative: number }>();
    const outcomes = new Map<Hex, { label: string; cumulative: number }>();
    const bump = (map: typeof scenes, key: Hex, label: string): void => {
      const entry = map.get(key) ?? { label, cumulative: 0 };
      entry.cumulative += 1;
      map.set(key, entry);
    };
    for (const invocation of items) {
      const annotation = annotate(invocation);
      if (!annotation) continue;
      // Each bucket counts invocations, so an invocation adds at most 1 to it.
      const sceneKeys = new Map<Hex, string>();
      for (const tag of annotation.scenes ?? []) sceneKeys.set(sceneBucketKey(tag), migrateSceneTag(tag) ?? tag);
      for (const [key, tag] of sceneKeys) bump(scenes, key, tag);
      const ids = new Set<OutcomeBucketId>(annotation.signals?.map((signal) => `signal/${signal}` as const));
      if (annotation.outcome) ids.add(`outcome/${annotation.outcome}`);
      for (const id of ids) bump(outcomes, outcomeBucketKey(id), id);
    }
    plans.push({
      fingerprint,
      skillId: first.onChain!.skillId,
      versionIndex: first.onChain!.versionIndex,
      names: [...new Set(matches.map((entry) => entry.match.name))],
      state: matches.some((entry) => entry.match.state === 'minted') ? 'minted' : 'fetched',
      cumulativeInvocations: items.length,
      sessions: new Set(items.map((item) => item.sessionId)).size,
      scenes: toReportBuckets(scenes),
      outcomes: toReportBuckets(outcomes),
    });
  }
  return plans.sort((a, b) => b.cumulativeInvocations - a.cumulativeInvocations || a.fingerprint.localeCompare(b.fingerprint));
}

export interface ReportUsageMessage {
  reporter: Address;
  fingerprint: Hex;
  cumulativeInvocations: bigint;
  scenes: { key: Hex; cumulative: bigint }[];
  outcomes: { key: Hex; cumulative: bigint }[];
  nonce: bigint;
  deadline: bigint;
}

export function signReportUsage(
  signer: Pick<PrivateKeyAccount, 'signTypedData'>,
  chainId: number,
  usageStats: Address,
  message: ReportUsageMessage,
): Promise<Hex> {
  return signer.signTypedData({
    domain: obeliskDomain('UsageStats', chainId, usageStats),
    types: usageStatsTypes,
    primaryType: 'ReportUsage',
    message,
  });
}
