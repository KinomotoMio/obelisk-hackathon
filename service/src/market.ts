// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// GET /v1/skills: the minted Skills on this chain, newest first, with what a
// market listing shows (#35): name and description from the stored body,
// birth scenes, versions, derived Skills, and real usage from UsageStats.
// Everything is read from the chain and the stored bodies; nothing is
// estimated. A Skill whose body this service never stored is listed without
// a name rather than left out.

import type { Address, Hex } from 'viem';

import { CONTRACT_ABIS } from './relayer.ts';
import { RequestError } from './actions.ts';
import { iso, readSkillRecord, readStored, readVersion } from './skills.ts';
import { distinctWallets, readVersionStats, type UsageRouteDeps } from './usage.ts';
import { describeSceneTag } from '../../packages/core/src/scenes.ts';

export const DEFAULT_SKILL_PAGE = 24;
export const MAX_SKILL_PAGE = 48;
/** Versions read per listed Skill; later ones still count in versionCount. */
const MAX_LISTED_VERSIONS = 16;

function pageParam(value: string | null, name: string, max: number): number | null {
  if (value === null || value === '') return null;
  if (!/^[1-9]\d{0,8}$/.test(value)) throw new RequestError(400, 'invalid_request', `${name} must be a positive integer`);
  const parsed = Number(value);
  if (name === 'limit' && parsed > max) throw new RequestError(400, 'invalid_request', `limit is at most ${max}`);
  return parsed;
}

async function listedSkill(deps: UsageRouteDeps, skillId: bigint) {
  const skill = await readSkillRecord(deps, skillId);
  if (!skill) return null;
  const indexes = Array.from({ length: Math.min(skill.versionCount, MAX_LISTED_VERSIONS) }, (_, at) => skill.versionCount - 1 - at);
  const [versions, children] = await Promise.all([
    Promise.all(indexes.map(async (index) => {
      const version = await readVersion(deps, skillId, index);
      return { index, ...version, stats: await readVersionStats(deps, version.fingerprint) };
    })),
    deps.publicClient.readContract({
      address: deps.config.contracts.SkillRegistry,
      abi: CONTRACT_ABIS.SkillRegistry,
      functionName: 'childrenCount',
      args: [skillId],
    }) as Promise<bigint>,
  ]);
  const latest = versions[0]!;
  const stored = await readStored(deps, latest.fingerprint);
  const wallets = await distinctWallets(deps, versions);
  const lastReports = versions.map((version) => version.stats.lastReportAt).filter((value): value is string => value !== null).sort();
  return {
    skillId: skillId.toString(),
    author: skill.author as Address,
    parentSkillId: skill.parentSkillId === 0n ? null : skill.parentSkillId.toString(),
    createdAt: iso(skill.createdAt),
    name: stored?.name ?? null,
    description: stored?.description ?? null,
    birthScenes: skill.birthScenes.map((tag) => {
      const described = describeSceneTag(tag);
      return { tag, label: described.label, dimension: described.dimension, kind: described.kind };
    }),
    versionCount: skill.versionCount,
    latest: { index: latest.index, fingerprint: latest.fingerprint as Hex, publishedAt: iso(latest.publishedAt) },
    childCount: Number(children),
    totalInvocations: versions.reduce((sum, version) => sum + version.stats.totalInvocations, 0),
    uniqueWallets: wallets.uniqueWallets,
    uniqueWalletsExact: wallets.uniqueWalletsExact && skill.versionCount <= MAX_LISTED_VERSIONS,
    lastReportAt: lastReports.at(-1) ?? null,
  };
}

/** GET /v1/skills?limit=&before= — newest first; `before` is an exclusive Skill id. */
export async function readSkillList(deps: UsageRouteDeps, query: URLSearchParams) {
  const limit = pageParam(query.get('limit'), 'limit', MAX_SKILL_PAGE) ?? DEFAULT_SKILL_PAGE;
  const before = pageParam(query.get('before'), 'before', Number.MAX_SAFE_INTEGER);
  const total = Number(await deps.publicClient.readContract({
    address: deps.config.contracts.SkillRegistry,
    abi: CONTRACT_ABIS.SkillRegistry,
    functionName: 'skillCount',
  }) as bigint);
  const start = Math.min(total, before === null ? total : before - 1);
  const ids = Array.from({ length: Math.max(0, Math.min(limit, start)) }, (_, at) => BigInt(start - at));
  const skills = (await Promise.all(ids.map((id) => listedSkill(deps, id)))).filter((skill) => skill !== null);
  const last = ids.at(-1);
  return {
    chainId: deps.config.chain.id,
    contract: deps.config.contracts.SkillRegistry,
    total,
    skills,
    nextBefore: last !== undefined && last > 1n ? last.toString() : null,
  };
}
