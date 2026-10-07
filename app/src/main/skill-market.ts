// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// A minted Skill as the Skill detail page shows it (#19): the version, real
// usage, and family tree, read from the Obelisk online service (#24).
//
// The renderer never talks to the network. The main process reads the
// service the CLI uses (OBELISK_SERVICE_URL or the default) and hands the
// renderer only fields it has checked: everything the service returns is
// untrusted input, so ids, addresses, fingerprints, counts, dates, and URLs
// are validated and strings are length-capped. Scene labels are resolved
// locally from the scene vocabulary, like the rest of the Skill tab.

import {
  ObeliskServiceClient,
  ServiceError,
  type MintedSkillInfo,
  type SkillLineageInfo,
  type SkillUsageInfo,
} from '../../../packages/core/src/obelisk-service.ts';
import { describeSceneTag, SCENE_DIMENSIONS } from '../../../packages/core/src/scenes.ts';

export const TREND_WEEKS = 8;
const MAX_TEXT = 2048;
const MAX_LIST = 256;

const SKILL_ID_RE = /^[1-9][0-9]{0,77}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const FINGERPRINT_RE = /^0x[0-9a-fA-F]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isSkillId(value: unknown): value is string {
  return typeof value === 'string' && SKILL_ID_RE.test(value);
}

class InvalidResponse extends Error {}

function invalid(field: string): never {
  throw new InvalidResponse(`The Obelisk online service returned an invalid ${field}`);
}

function skillId(value: unknown, field: string): string {
  return isSkillId(value) ? value : invalid(field);
}

function optionalSkillId(value: unknown, field: string): string | null {
  return value === null || value === undefined || value === '0' ? null : skillId(value, field);
}

function address(value: unknown, field: string): string {
  return typeof value === 'string' && ADDRESS_RE.test(value) ? value : invalid(field);
}

function fingerprint(value: unknown, field: string): string {
  return typeof value === 'string' && FINGERPRINT_RE.test(value) ? value.slice(2).toLowerCase() : invalid(field);
}

function count(value: unknown, field: string): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(field);
}

function date(value: unknown, field: string): string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value)) ? value : invalid(field);
}

function optionalDate(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : date(value, field);
}

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : null;
}

function list<T>(value: unknown, field: string, map: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) invalid(field);
  return value.slice(0, MAX_LIST).map(map);
}

function record(value: unknown, field: string): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid(field);
}

// A scene tag labelled from the local vocabulary; a bucket the service could
// not name keeps tag null.
function scene(tag: unknown) {
  if (typeof tag !== 'string' || tag.length > 64) return { tag: null, kind: 'unknown', label: null, dimensionLabel: null };
  const described = describeSceneTag(tag);
  const dimension = SCENE_DIMENSIONS.find((entry) => entry.id === described.dimension);
  return { tag, kind: described.kind, label: described.label, dimensionLabel: dimension?.label ?? null };
}

function explorer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.origin + url.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

export function checkMintedSkill(raw: MintedSkillInfo) {
  const body = record(raw, 'Skill');
  const version = record(body['version'], 'Skill version');
  const content = body['content'] === null ? null : record(body['content'], 'Skill content');
  return {
    chainId: count(body['chainId'], 'chain id'),
    skillId: skillId(body['skillId'], 'Skill id'),
    author: address(body['author'], 'author'),
    parentSkillId: optionalSkillId(body['parentSkillId'], 'parent Skill id'),
    createdAt: date(body['createdAt'], 'mint time'),
    birthScenes: list(body['birthScenes'], 'birth scenes', scene),
    versionCount: count(body['versionCount'], 'version count'),
    version: {
      index: count(version['index'], 'version index'),
      fingerprint: fingerprint(version['fingerprint'], 'fingerprint'),
      publishedAt: date(version['publishedAt'], 'publish time'),
    },
    name: content ? text(content['name'], 64) : null,
    description: content ? text(content['description']) : null,
  };
}

export function checkUsage(raw: SkillUsageInfo) {
  const body = record(raw, 'usage');
  const results = record(body['results'], 'usage results');
  const signals = record(results['signals'] ?? {}, 'usage signals');
  const trend = record(body['trend'], 'usage trend');
  const smoothRate = results['smoothRate'];
  return {
    totalInvocations: count(body['totalInvocations'], 'invocation count'),
    uniqueWallets: count(body['uniqueWallets'], 'wallet count'),
    uniqueWalletsExact: body['uniqueWalletsExact'] !== false,
    lastReportAt: optionalDate(body['lastReportAt'], 'report time'),
    scenes: list(body['scenes'], 'scenes', (item) => {
      const bucket = record(item, 'scene');
      return { ...scene(bucket['tag']), invocations: count(bucket['invocations'], 'scene count') };
    }),
    outcomesReported: Array.isArray(body['outcomes']) && body['outcomes'].length > 0,
    results: {
      smooth: count(results['smooth'], 'outcome count'),
      rework: count(results['rework'], 'outcome count'),
      failed: count(results['failed'], 'outcome count'),
      unknown: count(results['unknown'], 'outcome count'),
      judged: count(results['judged'], 'outcome count'),
      smoothRate: typeof smoothRate === 'number' && smoothRate >= 0 && smoothRate <= 1 ? smoothRate : null,
      toolErrors: count(signals['tool-error'] ?? 0, 'signal count'),
      userCorrections: count(signals['user-correction'] ?? 0, 'signal count'),
    },
    trend: {
      available: trend['available'] === true,
      weeks: list(trend['weeks'] ?? [], 'trend weeks', (item) => {
        const week = record(item, 'trend week');
        if (typeof week['start'] !== 'string' || !DAY_RE.test(week['start'])) invalid('trend week');
        return { start: week['start'], invocations: count(week['invocations'], 'trend count') };
      }),
    },
    versions: list(body['versions'], 'versions', (item) => {
      const version = record(item, 'version');
      return {
        index: count(version['index'], 'version index'),
        fingerprint: fingerprint(version['fingerprint'], 'fingerprint'),
        publishedAt: date(version['publishedAt'], 'publish time'),
        totalInvocations: count(version['totalInvocations'], 'invocation count'),
        uniqueWallets: count(version['uniqueWallets'], 'wallet count'),
      };
    }),
  };
}

export function checkLineage(raw: SkillLineageInfo) {
  const body = record(raw, 'lineage');
  return {
    rootSkillId: skillId(body['rootSkillId'], 'root Skill id'),
    path: list(body['path'], 'lineage path', (item) => skillId(item, 'lineage path')),
    truncated: body['truncated'] === true,
    nodes: list(body['nodes'], 'lineage', (item) => {
      const node = record(item, 'lineage node');
      return {
        skillId: skillId(node['skillId'], 'lineage Skill id'),
        parentSkillId: optionalSkillId(node['parentSkillId'], 'lineage parent'),
        depth: count(node['depth'], 'lineage depth'),
        author: address(node['author'], 'lineage author'),
        name: text(node['name'], 64),
        versionCount: count(node['versionCount'], 'lineage version count'),
        createdAt: date(node['createdAt'], 'lineage time'),
      };
    }),
  };
}

export type ChainSkillDetail = ReturnType<typeof checkMintedSkill> & {
  serviceUrl: string;
  explorerUrl: string | null;
  usage: ReturnType<typeof checkUsage> | null;
  usageError: string | null;
  lineage: ReturnType<typeof checkLineage> | null;
  lineageError: string | null;
};

export type ChainSkillResult =
  | { ok: true; skill: ChainSkillDetail }
  | { ok: false; error: { code: string; message: string } };

function failure(error: unknown): { code: string; message: string } {
  if (error instanceof ServiceError) return { code: error.code, message: error.message };
  if (error instanceof InvalidResponse) return { code: 'invalid_response', message: error.message };
  return { code: 'error', message: error instanceof Error ? error.message : String(error) };
}

/**
 * Read a minted Skill for the detail page. The Skill itself must load; usage,
 * lineage, and the explorer link degrade on their own so one missing route
 * does not hide the rest.
 */
export async function readChainSkill(client: ObeliskServiceClient, id: unknown): Promise<ChainSkillResult> {
  if (!isSkillId(id)) return { ok: false, error: { code: 'invalid_skill_id', message: 'A Skill id is a positive decimal number' } };
  let skill: ReturnType<typeof checkMintedSkill>;
  try {
    skill = checkMintedSkill(await client.skill(id));
  } catch (error) {
    return { ok: false, error: failure(error) };
  }
  const [usage, lineage, chain] = await Promise.allSettled([
    client.skillUsage(id, { weeks: TREND_WEEKS }).then(checkUsage),
    client.skillLineage(id).then(checkLineage),
    client.chain(),
  ]);
  return {
    ok: true,
    skill: {
      ...skill,
      serviceUrl: client.baseUrl,
      explorerUrl: chain.status === 'fulfilled' && chain.value.chainId === skill.chainId ? explorer(chain.value.explorerUrl) : null,
      usage: usage.status === 'fulfilled' ? usage.value : null,
      usageError: usage.status === 'rejected' ? failure(usage.reason).message : null,
      lineage: lineage.status === 'fulfilled' ? lineage.value : null,
      lineageError: lineage.status === 'rejected' ? failure(lineage.reason).message : null,
    },
  };
}
