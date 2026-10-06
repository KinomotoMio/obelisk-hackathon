// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Minted Skills (#16, #17): chain reads plus the stored body others fetch.
//
//   GET  /v1/skills/:ref                  a minted Skill version and its stored content
//        ref = Skill id (decimal) or version fingerprint (0x + 64 hex);
//        ?versionIndex=N picks a version of a Skill id (default: latest)
//   POST /v1/skills/:fingerprint/content  { author, name, description, body, signature }
//   GET  /v1/skills/:skillId/lineage      the family tree the Skill belongs to
//
// Minting itself goes through POST /v1/relay (MintSkill / PublishVersion);
// the body is stored afterwards, so the service only ever keeps bodies of
// versions that are on chain. The fingerprint is sha256 over the normalized
// body (packages/core/src/skills.ts), so anyone can check a fetched body
// against the chain. Name and description are not covered by it; only the
// version's on-chain author may set them, once (SkillContent in eip712.ts).
// Skill bodies are public: fetching needs no signature.

import { getAddress, isAddress, recoverTypedDataAddress, sha256, stringToBytes, type Address, type Hex, type PublicClient } from 'viem';

import { obeliskDomain, skillContentTypes } from '../../chain/eip712.ts';
import { RequestError } from './actions.ts';
import { explorerAddressUrl, type ServiceChainConfig } from './chains.ts';
import { CONTRACT_ABIS } from './relayer.ts';

/** A Skill body plus its metadata stays well under this. */
export const MAX_SKILL_CONTENT_BYTES = 256 * 1024;
const MAX_DESCRIPTION_LENGTH = 1024;
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINGERPRINT_RE = /^(?:0x)?([0-9a-fA-F]{64})$/;
export const SKILL_ID_RE = /^([1-9]\d{0,30})$/;

/** Where stored Skill content lives: R2 in the Worker, a Map in tests. */
export interface SkillContentStore {
  get(key: string): Promise<string | null>;
  /** Write only if absent; false when the key already exists. */
  putIfAbsent(key: string, value: string): Promise<boolean>;
}

export interface SkillRouteDeps {
  config: ServiceChainConfig;
  publicClient: PublicClient;
  skillContent?: SkillContentStore | null;
}

export interface StoredSkillContent {
  fingerprint: Hex;
  chainId: number;
  skillId: string;
  versionIndex: number;
  author: Address;
  name: string;
  description: string;
  body: string;
  signature: Hex;
  storedAt: string;
}

// Must stay identical to normalizeSkillBody in packages/core/src/skills.ts.
function normalizeSkillBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim();
}

function contentKey(chainId: number, fingerprint: Hex): string {
  return `skills/${chainId}/${fingerprint}.json`;
}

export function parseFingerprint(value: string): Hex | null {
  const match = FINGERPRINT_RE.exec(value);
  return match ? (`0x${match[1]!.toLowerCase()}` as Hex) : null;
}

const ZERO = `0x${'0'.repeat(64)}`;

export async function readVersionRef(deps: SkillRouteDeps, fingerprint: Hex) {
  const [skillId, versionIndex] = await deps.publicClient.readContract({
    address: deps.config.contracts.SkillRegistry,
    abi: CONTRACT_ABIS.SkillRegistry,
    functionName: 'skillOfFingerprint',
    args: [fingerprint],
  }) as readonly [bigint, bigint];
  return skillId === 0n ? null : { skillId, versionIndex: Number(versionIndex) };
}

export async function readSkillRecord(deps: SkillRouteDeps, skillId: bigint) {
  const count = await deps.publicClient.readContract({
    address: deps.config.contracts.SkillRegistry,
    abi: CONTRACT_ABIS.SkillRegistry,
    functionName: 'skillCount',
  }) as bigint;
  if (skillId > count) return null;
  const [author, parentSkillId, createdAt, versionCount, birthScenes] = await deps.publicClient.readContract({
    address: deps.config.contracts.SkillRegistry,
    abi: CONTRACT_ABIS.SkillRegistry,
    functionName: 'getSkill',
    args: [skillId],
  }) as readonly [Address, bigint, bigint, bigint, readonly string[]];
  return { author, parentSkillId, createdAt, versionCount: Number(versionCount), birthScenes: [...birthScenes] };
}

export async function readVersion(deps: SkillRouteDeps, skillId: bigint, index: number) {
  const [fingerprint, publishedAt] = await deps.publicClient.readContract({
    address: deps.config.contracts.SkillRegistry,
    abi: CONTRACT_ABIS.SkillRegistry,
    functionName: 'versionAt',
    args: [skillId, BigInt(index)],
  }) as readonly [Hex, bigint];
  return { fingerprint: fingerprint.toLowerCase() as Hex, publishedAt };
}

export async function readStored(deps: SkillRouteDeps, fingerprint: Hex): Promise<StoredSkillContent | null> {
  if (!deps.skillContent) return null;
  const text = await deps.skillContent.get(contentKey(deps.config.chain.id, fingerprint));
  return text === null ? null : JSON.parse(text) as StoredSkillContent;
}

export const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

/** GET /v1/skills/:ref */
export async function readMintedSkill(deps: SkillRouteDeps, ref: string, versionParam: string | null) {
  let skillId: bigint;
  let versionIndex: number | null = null;
  const fingerprint = parseFingerprint(ref);
  if (fingerprint) {
    if (versionParam !== null) throw new RequestError(400, 'invalid_request', 'versionIndex applies to a Skill id, not a fingerprint');
    const found = await readVersionRef(deps, fingerprint);
    if (!found) throw new RequestError(404, 'unknown_skill', `No Skill version with fingerprint ${fingerprint} is minted on chain ${deps.config.chain.id}`);
    ({ skillId, versionIndex } = found);
  } else {
    const match = SKILL_ID_RE.exec(ref);
    if (!match) throw new RequestError(400, 'invalid_skill_ref', `Not a Skill id or a 64-hex fingerprint: ${ref}`);
    skillId = BigInt(match[1]!);
    if (versionParam !== null) {
      if (!/^\d{1,9}$/.test(versionParam)) throw new RequestError(400, 'invalid_request', 'versionIndex must be a non-negative integer');
      versionIndex = Number(versionParam);
    }
  }
  const skill = await readSkillRecord(deps, skillId);
  if (!skill) throw new RequestError(404, 'unknown_skill', `Skill ${skillId} is not minted on chain ${deps.config.chain.id}`);
  const index = versionIndex ?? skill.versionCount - 1;
  if (index >= skill.versionCount) {
    throw new RequestError(404, 'unknown_version', `Skill ${skillId} has ${skill.versionCount} version(s); versionIndex ${index} does not exist`);
  }
  const version = await readVersion(deps, skillId, index);
  const stored = await readStored(deps, version.fingerprint);
  return {
    chainId: deps.config.chain.id,
    contract: deps.config.contracts.SkillRegistry,
    skillId: skillId.toString(),
    author: skill.author,
    parentSkillId: skill.parentSkillId === 0n ? null : skill.parentSkillId.toString(),
    createdAt: iso(skill.createdAt),
    birthScenes: skill.birthScenes,
    versionCount: skill.versionCount,
    version: { index, fingerprint: version.fingerprint, publishedAt: iso(version.publishedAt) },
    content: stored ? { name: stored.name, description: stored.description, body: stored.body } : null,
    explorer: { author: explorerAddressUrl(deps.config, skill.author) },
  };
}

function requireString(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== 'string') throw new RequestError(400, 'invalid_request', `${field} must be a string`);
  return value;
}

/** POST /v1/skills/:fingerprint/content */
export async function storeSkillContent(deps: SkillRouteDeps, fingerprintParam: string, payload: unknown, now = () => new Date()) {
  const fingerprint = parseFingerprint(fingerprintParam);
  if (!fingerprint || fingerprint === ZERO) throw new RequestError(400, 'invalid_fingerprint', `Not a 64-hex fingerprint: ${fingerprintParam}`);
  if (typeof payload !== 'object' || payload === null) throw new RequestError(400, 'invalid_request', 'Request body must be a JSON object');
  const raw = payload as Record<string, unknown>;
  const authorField = requireString(raw, 'author');
  if (!isAddress(authorField, { strict: false })) throw new RequestError(400, 'invalid_address', `Not an address: ${authorField}`);
  const author = getAddress(authorField);
  const name = requireString(raw, 'name');
  if (name.length > 64 || !NAME_RE.test(name)) {
    throw new RequestError(400, 'invalid_request', 'name must be 1-64 lowercase letters, digits, and single hyphens');
  }
  const description = requireString(raw, 'description');
  if (description.trim().length === 0 || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new RequestError(400, 'invalid_request', `description must be 1-${MAX_DESCRIPTION_LENGTH} characters`);
  }
  const body = requireString(raw, 'body');
  if (body.length === 0 || body !== normalizeSkillBody(body)) {
    throw new RequestError(400, 'invalid_request', 'body must be the normalized Skill body: LF line endings, no surrounding whitespace, no frontmatter');
  }
  const signature = requireString(raw, 'signature');
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new RequestError(400, 'invalid_signature', 'signature must be a 65-byte 0x-prefixed hex string');

  const computed = sha256(stringToBytes(body));
  if (computed !== fingerprint) {
    throw new RequestError(422, 'fingerprint_mismatch', `The body hashes to ${computed}, not ${fingerprint}`);
  }
  const signer = await recoverTypedDataAddress({
    domain: obeliskDomain('SkillRegistry', deps.config.chain.id, deps.config.contracts.SkillRegistry),
    types: skillContentTypes,
    primaryType: 'SkillContent',
    message: { author, fingerprint, name, description },
    signature: signature as Hex,
  });
  if (signer !== author) throw new RequestError(401, 'invalid_signature', `The signature was not made by ${author}`);

  const ref = await readVersionRef(deps, fingerprint);
  if (!ref) {
    throw new RequestError(409, 'not_minted', `Fingerprint ${fingerprint} is not minted on chain ${deps.config.chain.id}; mint it first, then store its body`);
  }
  const skill = await readSkillRecord(deps, ref.skillId);
  if (!skill || getAddress(skill.author) !== author) {
    throw new RequestError(403, 'not_author', `Skill ${ref.skillId} was minted by ${skill?.author ?? 'nobody'}, not ${author}`);
  }
  if (!deps.skillContent) throw new RequestError(503, 'storage_unavailable', 'This service has no Skill body storage configured');

  const record: StoredSkillContent = {
    fingerprint,
    chainId: deps.config.chain.id,
    skillId: ref.skillId.toString(),
    versionIndex: ref.versionIndex,
    author,
    name,
    description,
    body,
    signature: signature as Hex,
    storedAt: now().toISOString(),
  };
  const created = await deps.skillContent.putIfAbsent(contentKey(record.chainId, fingerprint), JSON.stringify(record));
  if (!created) {
    const existing = await readStored(deps, fingerprint);
    if (!existing || existing.name !== name || existing.description !== description) {
      throw new RequestError(409, 'content_exists', `Content for ${fingerprint} is already stored as ${existing?.name ?? 'another name'}; it is written once per version`);
    }
  }
  return { stored: true, created, fingerprint, skillId: record.skillId, versionIndex: record.versionIndex, name };
}

export async function readSkillContentPayload(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  const tooLarge = () => new RequestError(413, 'body_too_large', `Request body exceeds ${MAX_SKILL_CONTENT_BYTES} bytes`);
  if (declared > MAX_SKILL_CONTENT_BYTES) throw tooLarge();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_SKILL_CONTENT_BYTES) throw tooLarge();
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

/** Ancestors walked up and Skills listed per lineage read. */
const MAX_LINEAGE_DEPTH = 32;
const MAX_LINEAGE_NODES = 64;

const registryCall = (deps: SkillRouteDeps, functionName: string, args: readonly unknown[]) => deps.publicClient.readContract({
  address: deps.config.contracts.SkillRegistry,
  abi: CONTRACT_ABIS.SkillRegistry,
  functionName,
  args,
});

/**
 * GET /v1/skills/:skillId/lineage: the family tree a Skill belongs to, from
 * its root ancestor down, read through SkillRegistry's parent and children
 * views (K3).
 */
export async function readSkillLineage(deps: SkillRouteDeps, skillIdParam: string) {
  const match = SKILL_ID_RE.exec(skillIdParam);
  if (!match) throw new RequestError(400, 'invalid_skill_ref', `Not a Skill id: ${skillIdParam}`);
  const skillId = BigInt(match[1]!);
  const records = new Map<bigint, NonNullable<Awaited<ReturnType<typeof readSkillRecord>>>>();
  const record = async (id: bigint) => {
    const cached = records.get(id);
    if (cached) return cached;
    const found = await readSkillRecord(deps, id);
    if (!found) throw new RequestError(404, 'unknown_skill', `Skill ${id} is not minted on chain ${deps.config.chain.id}`);
    records.set(id, found);
    return found;
  };

  const path = [skillId];
  let truncated = false;
  for (let parent = (await record(skillId)).parentSkillId; parent !== 0n; parent = (await record(parent)).parentSkillId) {
    if (path.length > MAX_LINEAGE_DEPTH) { truncated = true; break; }
    path.unshift(parent);
  }

  // Breadth first, one level of the tree per round of (batched) reads.
  const order: { id: bigint; depth: number }[] = [{ id: path[0]!, depth: 0 }];
  const children = new Map<bigint, bigint[]>();
  for (let level = order.slice(); level.length > 0;) {
    const counts = await Promise.all(level.map(({ id }) => registryCall(deps, 'childrenCount', [id]) as Promise<bigint>));
    const next: typeof order = [];
    for (const [index, { id, depth }] of level.entries()) {
      const room = MAX_LINEAGE_NODES - order.length - next.length;
      const take = Math.min(Number(counts[index]), Math.max(room, 0));
      if (take < Number(counts[index])) truncated = true;
      const ids = await Promise.all(Array.from({ length: take }, (_, at) =>
        registryCall(deps, 'childAt', [id, BigInt(at)]) as Promise<bigint>));
      children.set(id, ids);
      next.push(...ids.map((child) => ({ id: child, depth: depth + 1 })));
    }
    order.push(...next);
    level = next;
  }

  const nodes = await Promise.all(order.map(async ({ id, depth }) => {
    const skill = await record(id);
    const latest = await readVersion(deps, id, skill.versionCount - 1);
    const stored = await readStored(deps, latest.fingerprint);
    return {
      skillId: id.toString(),
      parentSkillId: skill.parentSkillId === 0n ? null : skill.parentSkillId.toString(),
      depth,
      author: skill.author,
      name: stored?.name ?? null,
      versionCount: skill.versionCount,
      latestFingerprint: latest.fingerprint,
      createdAt: iso(skill.createdAt),
      childSkillIds: (children.get(id) ?? []).map(String),
    };
  }));
  return {
    chainId: deps.config.chain.id,
    contract: deps.config.contracts.SkillRegistry,
    skillId: skillId.toString(),
    rootSkillId: path[0]!.toString(),
    path: path.map(String),
    nodes,
    truncated,
  };
}

/**
 * The /v1/skills routes; `route` is the path after /v1. Returns null for any
 * other route so app.ts can keep dispatching.
 */
export async function handleSkillRoute(request: Request, route: string[], deps: SkillRouteDeps): Promise<unknown | null> {
  if (route[0] !== 'skills') return null;
  if (request.method === 'GET' && route.length === 2) {
    return readMintedSkill(deps, route[1]!, new URL(request.url).searchParams.get('versionIndex'));
  }
  if (request.method === 'GET' && route.length === 3 && route[2] === 'lineage') return readSkillLineage(deps, route[1]!);
  if (request.method === 'POST' && route.length === 3 && route[2] === 'content') {
    return storeSkillContent(deps, route[1]!, await readSkillContentPayload(request));
  }
  throw new RequestError(404, 'not_found', `No route for ${request.method} ${new URL(request.url).pathname}`);
}
