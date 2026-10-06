// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Local Skill library: drafts, minted versions, provenance, birth scenes, and
// parent Skill, stored as plain files under <data dir>/skills/<name>/.
//
//   skill.json                      metadata (this module's schema, see SkillRecordFile)
//   draft/SKILL.md                  the current draft, installable as-is
//   versions/<fingerprint>/SKILL.md frozen copy of every minted version
//
// Files instead of SQLite tables: schema.sql is pinned and its writes are owned
// by the index writer lease (ADR 0006); the library is written by the CLI while
// the app may own the index, and is read by both.
//
// The version fingerprint is the contract with usage recognition (#22) and the
// on-chain SkillRegistry (#2): sha256 over the normalized body, where the body
// is SKILL.md without its frontmatter. Claude Code loads a Skill as
// "Base directory for this skill: <dir>\n\n" + body (+ "\n\nARGUMENTS: ..."),
// and skillBodyFromLoadedText() reverses exactly that, so both sides hash the
// same bytes.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeBirthScenes } from './scenes.ts';

export const SKILL_RECORD_SCHEMA = 1;

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---(?:\n|$)/;
const LOADED_PREFIX_RE = /^Base directory for this skill:[^\n]*\n(?:\n)?/;
const LOADED_ARGUMENTS_RE = /\n\nARGUMENTS: [\s\S]*$/;

// Content Claude Code rewrites at load time. A body containing any of these is
// never loaded verbatim, so its fingerprint could never match an invocation.
const DYNAMIC_CONTENT: Array<[RegExp, string]> = [
  [/\$ARGUMENTS\b/, '$ARGUMENTS'],
  [/\$\d/, '$N argument placeholder'],
  [/\$\{CLAUDE_[A-Z_]+\}/, '${CLAUDE_*} variable'],
  [/^!`/m, '!`command` injection'],
];

export interface SkillProvenanceExcerpt {
  messageUuid?: string;
  text: string;
}

export interface SkillProvenance {
  sessionId: string;
  reason: string;
  excerpts?: SkillProvenanceExcerpt[];
}

export interface SkillParent {
  // Local library name, when the parent lives in this library.
  name?: string;
  chainId?: number;
  skillId?: string;
  fingerprint?: string;
}

export interface SkillMint {
  chainId: number;
  skillId: string;
  versionIndex: number;
  author: string;
  txHash: string;
  mintedAt: string;
}

export interface SkillVersionEntry {
  fingerprint: string;
  createdAt: string;
  description: string;
  birthScenes: string[];
  parent: SkillParent | null;
  provenance: SkillProvenance[];
  mint: SkillMint | null;
}

export interface SkillRecordFile {
  schema: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  birthScenes: string[];
  parent: SkillParent | null;
  provenance: SkillProvenance[];
  versions: SkillVersionEntry[];
}

export interface SkillDraftInput {
  name: string;
  description: string;
  body: string;
  birthScenes?: string[];
  parent?: SkillParent | null;
  provenance?: SkillProvenance[];
}

export interface SkillVersionView extends SkillVersionEntry {
  path: string;
  // false when versions/<fp>/SKILL.md is missing or no longer hashes to <fp>.
  verified: boolean;
}

export interface SkillView extends Omit<SkillRecordFile, 'versions'> {
  dir: string;
  status: 'draft' | 'minted';
  draft: { fingerprint: string; path: string; body: string; skillMd: string; minted: boolean } | null;
  versions: SkillVersionView[];
}

export interface SkillSummary {
  name: string;
  description: string;
  status: 'draft' | 'minted';
  draftFingerprint: string | null;
  draftMinted: boolean;
  versionCount: number;
  latestVersion: { fingerprint: string; mint: SkillMint | null } | null;
  birthScenes: string[];
  parent: SkillParent | null;
  provenanceSessions: number;
  updatedAt: string;
}

// --- Fingerprint contract -------------------------------------------------

export function normalizeSkillBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').trim();
}

// SKILL.md (with or without frontmatter) -> normalized body.
export function skillBodyFromMarkdown(markdown: string): string {
  const text = markdown.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  return normalizeSkillBody(text.replace(FRONTMATTER_RE, ''));
}

// Text Claude Code put in the transcript when it loaded a Skill -> normalized
// body, or null when the text is not a Skill load.
export function skillBodyFromLoadedText(text: string): string | null {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!LOADED_PREFIX_RE.test(normalized)) return null;
  return normalizeSkillBody(normalized.replace(LOADED_PREFIX_RE, '').replace(LOADED_ARGUMENTS_RE, ''));
}

// Lowercase hex sha256 of the normalized body. On chain it is the bytes32
// `0x<fingerprint>`.
export function skillFingerprint(body: string): string {
  return createHash('sha256').update(normalizeSkillBody(body), 'utf8').digest('hex');
}

export function findDynamicSkillContent(body: string): string[] {
  return DYNAMIC_CONTENT.filter(([re]) => re.test(body)).map(([, label]) => label);
}

export function renderSkillMarkdown({ name, description, body }: { name: string; description: string; body: string }): string {
  // JSON strings are valid YAML double-quoted scalars, so any description is safe.
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${normalizeSkillBody(body)}\n`;
}

// --- Validation -------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function assertSkillName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length > 64 || !NAME_RE.test(name)) {
    fail(`Skill name must be 1-64 lowercase letters, digits, and single hyphens (got ${JSON.stringify(name)})`);
  }
}

function parseParent(value: unknown): SkillParent | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('parent must be an object or null');
  const raw = value as Record<string, unknown>;
  const parent: SkillParent = {};
  if (raw['name'] !== undefined) {
    assertSkillName(raw['name']);
    parent.name = raw['name'];
  }
  if (raw['chainId'] !== undefined) {
    if (!Number.isSafeInteger(raw['chainId'])) fail('parent.chainId must be an integer');
    parent.chainId = raw['chainId'] as number;
  }
  if (raw['skillId'] !== undefined) {
    if (typeof raw['skillId'] !== 'string' || !/^[1-9]\d*$/.test(raw['skillId'])) fail('parent.skillId must be a decimal string');
    parent.skillId = raw['skillId'];
  }
  if (raw['fingerprint'] !== undefined) {
    if (typeof raw['fingerprint'] !== 'string' || !FINGERPRINT_RE.test(raw['fingerprint'])) fail('parent.fingerprint must be 64 lowercase hex characters');
    parent.fingerprint = raw['fingerprint'];
  }
  if (Object.keys(parent).length === 0) fail('parent must name at least one of name, chainId+skillId, fingerprint');
  return parent;
}

function parseProvenance(value: unknown): SkillProvenance[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('provenance must be an array');
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) fail(`provenance[${index}] must be an object`);
    const { sessionId, reason, excerpts } = entry as Record<string, unknown>;
    if (typeof sessionId !== 'string' || sessionId === '') fail(`provenance[${index}].sessionId must be a non-empty string`);
    if (typeof reason !== 'string' || reason.trim() === '') fail(`provenance[${index}].reason must be a non-empty string`);
    const out: SkillProvenance = { sessionId, reason: reason.trim() };
    if (excerpts !== undefined) {
      if (!Array.isArray(excerpts)) fail(`provenance[${index}].excerpts must be an array`);
      out.excerpts = excerpts.map((excerpt, j) => {
        const { messageUuid, text } = (excerpt ?? {}) as Record<string, unknown>;
        if (typeof text !== 'string' || text === '') fail(`provenance[${index}].excerpts[${j}].text must be a non-empty string`);
        if (messageUuid !== undefined && typeof messageUuid !== 'string') fail(`provenance[${index}].excerpts[${j}].messageUuid must be a string`);
        return messageUuid === undefined ? { text } : { messageUuid, text };
      });
    }
    return out;
  });
}

export function parseSkillDraft(value: unknown): SkillDraftInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Skill draft must be a JSON object');
  const raw = value as Record<string, unknown>;
  assertSkillName(raw['name']);
  const description = raw['description'];
  if (typeof description !== 'string' || description.trim() === '' || description.length > 1024) {
    fail('description must be a non-empty string of at most 1024 characters');
  }
  if (typeof raw['body'] !== 'string') fail('body must be a string');
  const body = skillBodyFromMarkdown(raw['body']);
  if (body === '') fail('body must not be empty');
  const dynamic = findDynamicSkillContent(body);
  if (dynamic.length > 0) {
    fail(`body contains content Claude Code rewrites when loading a Skill (${dynamic.join(', ')}); `
      + 'its fingerprint would never match a real invocation, so rephrase it (escaping with a backslash does not help: Claude Code drops the backslash)');
  }
  return {
    name: raw['name'],
    description: description.trim(),
    body,
    birthScenes: normalizeBirthScenes(raw['birthScenes']),
    parent: parseParent(raw['parent']),
    provenance: parseProvenance(raw['provenance']),
  };
}

// --- Storage -----------------------------------------------------------------

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function skillDir(skillsDir: string, name: string): string {
  assertSkillName(name);
  return join(skillsDir, name);
}

async function readRecordFile(dir: string): Promise<SkillRecordFile | null> {
  const text = await readOptional(join(dir, 'skill.json'));
  if (text === null) return null;
  const record = JSON.parse(text) as SkillRecordFile;
  if (record.schema !== SKILL_RECORD_SCHEMA) {
    fail(`Unsupported Skill record schema ${String(record.schema)} in ${join(dir, 'skill.json')}`);
  }
  return record;
}

// Create or replace the draft of a Skill. Minted versions are kept. The draft
// file is written before skill.json, so an interrupted save is healed by
// running the same save again.
export async function saveSkillDraft(skillsDir: string, input: unknown, { now = () => new Date().toISOString() } = {}): Promise<SkillView> {
  const draft = parseSkillDraft(input);
  const dir = skillDir(skillsDir, draft.name);
  await mkdir(join(dir, 'draft'), { recursive: true });
  const existing = await readRecordFile(dir);
  const timestamp = now();
  await writeFileAtomic(join(dir, 'draft', 'SKILL.md'), renderSkillMarkdown(draft));
  const record: SkillRecordFile = {
    schema: SKILL_RECORD_SCHEMA,
    name: draft.name,
    description: draft.description,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    birthScenes: draft.birthScenes ?? [],
    parent: draft.parent ?? null,
    provenance: draft.provenance ?? [],
    versions: existing?.versions ?? [],
  };
  await writeFileAtomic(join(dir, 'skill.json'), `${JSON.stringify(record, null, 2)}\n`);
  return (await readSkill(skillsDir, draft.name))!;
}

// Freeze the current draft as a minted version (called by minting, #16).
// Idempotent per fingerprint: re-recording the same mint is a no-op, so a
// retried mint converges.
export async function recordMintedVersion(
  skillsDir: string,
  name: string,
  { fingerprint, mint }: { fingerprint: string; mint: SkillMint },
): Promise<SkillView> {
  const dir = skillDir(skillsDir, name);
  const record = await readRecordFile(dir);
  if (!record) fail(`Skill not found in the local library: ${name}`);
  const draftMd = await readOptional(join(dir, 'draft', 'SKILL.md'));
  if (draftMd === null) fail(`Skill ${name} has no draft to mint`);
  const draftFingerprint = skillFingerprint(skillBodyFromMarkdown(draftMd));
  if (draftFingerprint !== fingerprint) {
    fail(`Skill ${name} draft fingerprint is ${draftFingerprint}, not the minted ${fingerprint}; the draft changed after the mint preview`);
  }
  const existing = record.versions.find((version) => version.fingerprint === fingerprint);
  if (existing?.mint && JSON.stringify(existing.mint) !== JSON.stringify(mint)) {
    fail(`Skill ${name} version ${fingerprint} is already recorded as minted with different chain data`);
  }
  await mkdir(join(dir, 'versions', fingerprint), { recursive: true });
  await writeFileAtomic(join(dir, 'versions', fingerprint, 'SKILL.md'), draftMd);
  const entry: SkillVersionEntry = {
    fingerprint,
    createdAt: existing?.createdAt ?? mint.mintedAt,
    description: record.description,
    birthScenes: record.birthScenes,
    parent: record.parent,
    provenance: record.provenance,
    mint,
  };
  const versions = existing
    ? record.versions.map((version) => (version.fingerprint === fingerprint ? entry : version))
    : [...record.versions, entry];
  await writeFileAtomic(join(dir, 'skill.json'), `${JSON.stringify({ ...record, versions }, null, 2)}\n`);
  return (await readSkill(skillsDir, name))!;
}

export async function readSkill(skillsDir: string, name: string): Promise<SkillView | null> {
  const dir = skillDir(skillsDir, name);
  const record = await readRecordFile(dir);
  if (!record) return null;
  const draftPath = join(dir, 'draft', 'SKILL.md');
  const draftMd = await readOptional(draftPath);
  const versions: SkillVersionView[] = await Promise.all(record.versions.map(async (version) => {
    const path = join(dir, 'versions', version.fingerprint, 'SKILL.md');
    const text = await readOptional(path);
    return { ...version, path, verified: text !== null && skillFingerprint(skillBodyFromMarkdown(text)) === version.fingerprint };
  }));
  let draft: SkillView['draft'] = null;
  if (draftMd !== null) {
    const body = skillBodyFromMarkdown(draftMd);
    const fingerprint = skillFingerprint(body);
    draft = { fingerprint, path: draftPath, body, skillMd: draftMd, minted: versions.some((v) => v.fingerprint === fingerprint) };
  }
  const { versions: _versions, ...rest } = record;
  return { ...rest, dir, status: versions.some((v) => v.mint) ? 'minted' : 'draft', draft, versions };
}

export function summarizeSkill(skill: SkillView): SkillSummary {
  const latest = skill.versions.at(-1) ?? null;
  return {
    name: skill.name,
    description: skill.description,
    status: skill.status,
    draftFingerprint: skill.draft?.fingerprint ?? null,
    draftMinted: skill.draft?.minted ?? false,
    versionCount: skill.versions.length,
    latestVersion: latest ? { fingerprint: latest.fingerprint, mint: latest.mint } : null,
    birthScenes: skill.birthScenes,
    parent: skill.parent,
    provenanceSessions: new Set(skill.provenance.map((p) => p.sessionId)).size,
    updatedAt: skill.updatedAt,
  };
}

// Newest first. Directory entries without a skill.json are not Skills and are
// skipped; an unreadable skill.json throws so a broken record stays visible.
export async function listSkills(skillsDir: string): Promise<SkillSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const skills = await Promise.all(entries.filter((entry) => NAME_RE.test(entry)).map((entry) => readSkill(skillsDir, entry)));
  return skills
    .filter((skill): skill is SkillView => skill !== null)
    .map(summarizeSkill)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
