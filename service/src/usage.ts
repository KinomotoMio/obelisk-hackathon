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
import { describeSceneTag, migrateSceneTag, sceneBucketKey, SCENES, vocabularyTag } from '../../packages/core/src/scenes.ts';
import {
  OUTCOMES,
  outcomeBucketIdsByKey,
  outcomeBucketKey,
  SIGNALS,
  type OutcomeBucketId,
  type Signal,
} from '../../packages/core/src/usage-buckets.ts';
import { RequestError, type ParsedRelayRequest } from './actions.ts';
import type { ServiceChainConfig } from './chains.ts';
import { parseAddressParam } from './reads.ts';
import { iso, parseFingerprint, readSkillRecord, readVersion, readVersionRef, SKILL_ID_RE, type SkillRouteDeps } from './skills.ts';

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

// --- Reads -----------------------------------------------------------------

export const DEFAULT_TREND_WEEKS = 8;
const MAX_TREND_WEEKS = 52;
/** Distribution keys read per version; UsageStats does not bound the list. */
const MAX_DISTRIBUTION_KEYS = 64;
/** Reporter addresses read to count distinct wallets across versions. */
const MAX_REPORTERS_FOR_UNION = 1000;

export interface UsageRouteDeps extends SkillRouteDeps {
  usageTrend?: UsageTrendStore | null;
}

export interface SceneCount {
  key: Hex;
  /** The scene tag, or null for a key this service cannot name (a user tag no Skill was born with). */
  tag: string | null;
  label: string | null;
  dimension: string | null;
  invocations: number;
}

export interface OutcomeCount {
  key: Hex;
  /** `outcome/<id>` or `signal/<id>` (packages/core/src/usage-buckets.ts), or null if unknown. */
  id: OutcomeBucketId | null;
  invocations: number;
}

export interface ResultSummary {
  smooth: number;
  rework: number;
  failed: number;
  unknown: number;
  /** smooth + rework + failed: the sample 顺利率 is computed over. */
  judged: number;
  /** smooth / judged, or null when nothing was judged. */
  smoothRate: number | null;
  signals: Record<Signal, number>;
}

export interface TrendWeek {
  /** Monday 00:00 UTC that starts the week, YYYY-MM-DD. */
  start: string;
  invocations: number;
}

const usageCall = (deps: UsageRouteDeps, functionName: string, args: readonly unknown[]) => deps.publicClient.readContract({
  address: deps.config.contracts.UsageStats,
  abi: usageStatsAbi,
  functionName: functionName as never,
  args: args as never,
});

let vocabularyKeys: Map<Hex, string> | null = null;

/** Scene tag of a bucket key: any tag of the current vocabulary, or one of `extraTags`. */
function sceneTagsByKey(extraTags: readonly string[]): Map<Hex, string> {
  vocabularyKeys ??= new Map(SCENES.map((scene) => {
    const tag = vocabularyTag(scene.id);
    return [sceneBucketKey(tag), tag];
  }));
  const out = new Map(vocabularyKeys);
  for (const tag of extraTags) if (!out.has(sceneBucketKey(tag))) out.set(sceneBucketKey(tag), migrateSceneTag(tag) ?? tag);
  return out;
}

async function readDistribution(deps: UsageRouteDeps, kind: 'scene' | 'outcome', fingerprint: Hex): Promise<Map<Hex, number>> {
  const count = Number(await usageCall(deps, `${kind}KeyCount`, [fingerprint]) as bigint);
  const keys = await Promise.all(
    Array.from({ length: Math.min(count, MAX_DISTRIBUTION_KEYS) }, (_, index) =>
      usageCall(deps, `${kind}KeyAt`, [fingerprint, BigInt(index)]) as Promise<Hex>),
  );
  const totals = await Promise.all(keys.map((key) => usageCall(deps, `${kind}Count`, [fingerprint, key]) as Promise<bigint>));
  return new Map(keys.map((key, index) => [key.toLowerCase() as Hex, Number(totals[index])]));
}

function addInto(target: Map<Hex, number>, source: Map<Hex, number>): void {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value);
}

function describeScenes(counts: Map<Hex, number>, extraTags: readonly string[]): SceneCount[] {
  const tags = sceneTagsByKey(extraTags);
  return [...counts].map(([key, invocations]) => {
    const tag = tags.get(key) ?? null;
    const described = tag ? describeSceneTag(tag) : null;
    return { key, tag, label: described?.label ?? null, dimension: described?.dimension ?? null, invocations };
  }).sort((a, b) => b.invocations - a.invocations || (a.key < b.key ? -1 : 1));
}

function describeOutcomes(counts: Map<Hex, number>): { outcomes: OutcomeCount[]; results: ResultSummary } {
  const ids = outcomeBucketIdsByKey();
  const outcomes = [...counts].map(([key, invocations]) => ({ key, id: ids.get(key) ?? null, invocations }))
    .sort((a, b) => b.invocations - a.invocations || (a.key < b.key ? -1 : 1));
  const of = (id: OutcomeBucketId) => counts.get(outcomeBucketKey(id)) ?? 0;
  const [smooth, rework, failed, unknown] = OUTCOMES.map((id) => of(`outcome/${id}`)) as [number, number, number, number];
  const judged = smooth + rework + failed;
  const signals = Object.fromEntries(SIGNALS.map((id) => [id, of(`signal/${id}`)])) as Record<Signal, number>;
  return { outcomes, results: { smooth, rework, failed, unknown, judged, smoothRate: judged === 0 ? null : smooth / judged, signals } };
}

const DAY_MS = 86_400_000;

function weekStart(time: number): number {
  const day = Math.floor(time / DAY_MS);
  // 1970-01-01 was a Thursday; (day + 3) % 7 is days since Monday.
  return (day - ((day + 3) % 7)) * DAY_MS;
}

export function weeklyTrend(entries: readonly UsageTrendEntry[], weeks: number, now: Date): TrendWeek[] {
  const current = weekStart(now.getTime());
  const out = Array.from({ length: weeks }, (_, index) => ({ start: current - (weeks - 1 - index) * 7 * DAY_MS, invocations: 0 }));
  for (const entry of entries) {
    const start = weekStart(Date.parse(entry.at));
    const week = out.find((item) => item.start === start);
    if (week) week.invocations += entry.added;
  }
  return out.map((week) => ({ start: new Date(week.start).toISOString().slice(0, 10), invocations: week.invocations }));
}

function parseWeeks(value: string | null): number {
  if (value === null) return DEFAULT_TREND_WEEKS;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > MAX_TREND_WEEKS) {
    throw new RequestError(400, 'invalid_request', `weeks must be 1-${MAX_TREND_WEEKS}`);
  }
  return Number(value);
}

async function trendEntries(deps: UsageRouteDeps, fingerprint: Hex): Promise<UsageTrendEntry[] | null> {
  return deps.usageTrend ? deps.usageTrend.list(deps.config.chain.id, fingerprint) : null;
}

function trendOf(entries: UsageTrendEntry[] | null, weeks: number, now: Date) {
  return {
    unit: 'week' as const,
    source: 'relayed_reports' as const,
    available: entries !== null,
    weeks: weeklyTrend(entries ?? [], weeks, now),
  };
}

async function readVersionStats(deps: UsageRouteDeps, fingerprint: Hex) {
  const [totalInvocations, uniqueWallets, lastReportAt] = await usageCall(deps, 'versionStats', [fingerprint]) as readonly [bigint, number, bigint];
  return {
    totalInvocations: Number(totalInvocations),
    uniqueWallets: Number(uniqueWallets),
    lastReportAt: lastReportAt === 0n ? null : iso(lastReportAt),
  };
}

/** GET /v1/usage/:fingerprint */
export async function readVersionUsage(deps: UsageRouteDeps, fingerprintParam: string, query: URLSearchParams, now = new Date()) {
  const fingerprint = parseFingerprint(fingerprintParam);
  if (!fingerprint) throw new RequestError(400, 'invalid_fingerprint', `Not a 64-hex fingerprint: ${fingerprintParam}`);
  const weeks = parseWeeks(query.get('weeks'));
  const walletParam = query.get('wallet');
  const wallet = walletParam === null ? null : parseAddressParam(walletParam);
  const ref = await readVersionRef(deps, fingerprint);
  if (!ref) throw new RequestError(404, 'unknown_skill', `No Skill version with fingerprint ${fingerprint} is minted on chain ${deps.config.chain.id}`);
  const [skill, stats, scenes, outcomes, entries, walletReport] = await Promise.all([
    readSkillRecord(deps, ref.skillId),
    readVersionStats(deps, fingerprint),
    readDistribution(deps, 'scene', fingerprint),
    readDistribution(deps, 'outcome', fingerprint),
    trendEntries(deps, fingerprint),
    wallet ? usageCall(deps, 'walletReport', [fingerprint, wallet]) as Promise<readonly [bigint, bigint]> : null,
  ]);
  return {
    chainId: deps.config.chain.id,
    contract: deps.config.contracts.UsageStats,
    fingerprint,
    skillId: ref.skillId.toString(),
    versionIndex: ref.versionIndex,
    ...stats,
    scenes: describeScenes(scenes, skill?.birthScenes ?? []),
    ...describeOutcomes(outcomes),
    trend: trendOf(entries, weeks, now),
    ...(wallet && walletReport
      ? { wallet: { address: wallet, cumulative: Number(walletReport[0]), reportedAt: walletReport[1] === 0n ? null : iso(walletReport[1]) } }
      : {}),
  };
}

async function reporters(deps: UsageRouteDeps, fingerprint: Hex): Promise<string[]> {
  const count = Number(await usageCall(deps, 'reporterCount', [fingerprint]) as bigint);
  const addresses = await Promise.all(Array.from({ length: count }, (_, index) =>
    usageCall(deps, 'reporterAt', [fingerprint, BigInt(index)]) as Promise<string>));
  return addresses.map((address) => address.toLowerCase());
}

/** GET /v1/skills/:skillId/usage: every version of a Skill together. */
export async function readSkillUsage(deps: UsageRouteDeps, skillIdParam: string, query: URLSearchParams, now = new Date()) {
  const match = SKILL_ID_RE.exec(skillIdParam);
  if (!match) throw new RequestError(400, 'invalid_skill_ref', `Not a Skill id: ${skillIdParam}`);
  const skillId = BigInt(match[1]!);
  const weeks = parseWeeks(query.get('weeks'));
  const skill = await readSkillRecord(deps, skillId);
  if (!skill) throw new RequestError(404, 'unknown_skill', `Skill ${skillId} is not minted on chain ${deps.config.chain.id}`);
  const versions = await Promise.all(Array.from({ length: skill.versionCount }, async (_, index) => {
    const version = await readVersion(deps, skillId, index);
    const fingerprint = version.fingerprint;
    const [stats, scenes, outcomes, entries] = await Promise.all([
      readVersionStats(deps, fingerprint),
      readDistribution(deps, 'scene', fingerprint),
      readDistribution(deps, 'outcome', fingerprint),
      trendEntries(deps, fingerprint),
    ]);
    return { index, fingerprint, publishedAt: iso(version.publishedAt), stats, scenes, outcomes, entries };
  }));

  const scenes = new Map<Hex, number>();
  const outcomes = new Map<Hex, number>();
  for (const version of versions) {
    addInto(scenes, version.scenes);
    addInto(outcomes, version.outcomes);
  }
  // A wallet that reported two versions is one wallet: union the reporter lists
  // while they are small enough to read; otherwise the largest version's count
  // is a lower bound.
  const reporterTotal = versions.reduce((sum, version) => sum + version.stats.uniqueWallets, 0);
  let uniqueWallets: number;
  let uniqueWalletsExact = true;
  if (versions.length === 1) {
    uniqueWallets = versions[0]!.stats.uniqueWallets;
  } else if (reporterTotal <= MAX_REPORTERS_FOR_UNION) {
    const lists = await Promise.all(versions.map((version) => reporters(deps, version.fingerprint)));
    uniqueWallets = new Set(lists.flat()).size;
  } else {
    uniqueWallets = Math.max(...versions.map((version) => version.stats.uniqueWallets));
    uniqueWalletsExact = false;
  }
  const lastReports = versions.map((version) => version.stats.lastReportAt).filter((value): value is string => value !== null).sort();
  const allEntries = versions.every((version) => version.entries === null) ? null : versions.flatMap((version) => version.entries ?? []);
  return {
    chainId: deps.config.chain.id,
    contract: deps.config.contracts.UsageStats,
    skillId: skillId.toString(),
    author: skill.author,
    parentSkillId: skill.parentSkillId === 0n ? null : skill.parentSkillId.toString(),
    birthScenes: skill.birthScenes.map((tag) => {
      const described = describeSceneTag(tag);
      return { tag, label: described.label, dimension: described.dimension };
    }),
    totalInvocations: versions.reduce((sum, version) => sum + version.stats.totalInvocations, 0),
    uniqueWallets,
    uniqueWalletsExact,
    lastReportAt: lastReports.at(-1) ?? null,
    scenes: describeScenes(scenes, skill.birthScenes),
    ...describeOutcomes(outcomes),
    trend: trendOf(allEntries, weeks, now),
    versions: versions.map((version) => ({
      index: version.index,
      fingerprint: version.fingerprint,
      publishedAt: version.publishedAt,
      ...version.stats,
    })),
  };
}

/**
 * The usage routes; `route` is the path after /v1. Returns null for any other
 * route so app.ts can keep dispatching.
 */
export async function handleUsageRoute(request: Request, route: string[], deps: UsageRouteDeps): Promise<unknown | null> {
  if (request.method !== 'GET') return null;
  const query = new URL(request.url).searchParams;
  if (route.length === 2 && route[0] === 'usage') return readVersionUsage(deps, route[1]!, query);
  if (route.length === 3 && route[0] === 'skills' && route[2] === 'usage') return readSkillUsage(deps, route[1]!, query);
  return null;
}
