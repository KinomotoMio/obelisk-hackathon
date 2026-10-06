// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Skill invocations recognized from the index (#22, vision 04 U1).
//
// Agents record every Skill load as a message carrying the full loaded text.
// Claude Code's loads are indexed as content_type='skill_instructions'. Codex's
// `<skill>` loads are matched by their envelope as well: the Codex adapter only
// classifies Claude-style "Base directory for this skill" text, so real Codex
// loads are still indexed as plain user text.
//
// One load can sit in the index more than once: real Codex histories carry
// rows for the same record under two line-numbered uuids (same session, same
// timestamp, same text), and only one of them still points at the record in the
// rollout. Rows with the same session, timestamp, and indexed text are one
// load; the others are listed in alsoRecordedAs instead of being counted.
//
// Each load is hashed with exactly the Skill library rule (skills.ts), so a
// fingerprint here equals the version fingerprint of the SKILL.md that was
// loaded. Indexed text is cut at TEXT_LIMIT characters; a load that reached the
// limit is re-read from its provider source record before hashing, otherwise a
// long Skill could never match its version.

import { TEXT_LIMIT } from './parsing.ts';
import { storedSessionCursor } from './provider-indexing.ts';
import type { ProviderRegistry } from './providers/registry.ts';
import { listSkillFetches } from './skill-fetches.ts';
import { listSkills, parseLoadedSkill, readSkill, skillFingerprint } from './skills.ts';
import type { SkillMint } from './skills.ts';
import type { SqliteDb } from './sqlite-types.ts';

export interface SkillInvocation {
  messageUuid: string;
  sessionId: string;
  source: string;
  timestamp: string | null;
  // Set when the Skill was loaded inside a subagent or workflow agent.
  agentId: string | null;
  // The name the agent loaded it under (directory or <name> tag). Local
  // naming only; the fingerprint is the identity.
  loadedAs: string | null;
  fingerprint: string | null;
  // Where the hashed text came from: the index, or the provider source record
  // because the indexed copy was truncated.
  textFrom: 'index' | 'raw' | null;
  // Why fingerprint is null.
  unresolved?: 'source_unavailable' | 'unrecognized_format';
  // Other index rows that hold this same load (see the header).
  alsoRecordedAs?: string[];
}

export interface SkillInvocationFilter {
  sessionId?: string;
  after?: string;
  before?: string;
}

interface CandidateRow {
  uuid: string;
  session_id: string;
  source: string;
  timestamp: string | null;
  agent_id: string | null;
  text: string | null;
  text_length: number | null;
}

function fullLoadedText(
  db: SqliteDb,
  providerRegistry: ProviderRegistry,
  row: CandidateRow,
): { text: string; from: 'index' | 'raw' } | null {
  if (row.text !== null && (row.text_length ?? 0) < TEXT_LIMIT) return { text: row.text, from: 'index' };
  const session = db.prepare('SELECT * FROM sessions WHERE id=?').get(row.session_id) ?? null;
  const subagent = row.agent_id
    ? db.prepare('SELECT * FROM subagents WHERE agent_id=?').get(row.agent_id) ?? null
    : null;
  const workflowAgent = row.agent_id
    ? db.prepare('SELECT * FROM workflow_agents WHERE agent_id=?').get(row.agent_id) ?? null
    : null;
  const raw = providerRegistry.raw({
    source: row.source,
    messageUuid: row.uuid,
    session,
    agentId: row.agent_id,
    cursor: storedSessionCursor(db, providerRegistry, session),
    subagent,
    workflowAgent,
  });
  return typeof raw?.messageText === 'string' ? { text: raw.messageText, from: 'raw' } : null;
}

// Every visible Skill load in the index, oldest first.
export function recognizeSkillInvocations(
  db: SqliteDb,
  providerRegistry: ProviderRegistry,
  { sessionId, after, before }: SkillInvocationFilter = {},
): SkillInvocation[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (sessionId) { where.push('m.session_id = ?'); params.push(sessionId); }
  if (after) { where.push('m.timestamp > ?'); params.push(after); }
  if (before) { where.push('m.timestamp < ?'); params.push(before); }
  const rows = db.prepare(`
    SELECT m.uuid, m.session_id, COALESCE(m.source, s.source, 'claude') AS source, m.timestamp,
           m.agent_id, m.text, length(m.text) AS text_length
    FROM messages m
    LEFT JOIN sessions s ON s.id = m.session_id
    WHERE (m.content_type = 'skill_instructions'
           OR (m.source = 'codex' AND m.type = 'user' AND m.text LIKE '<skill>%'))
      AND COALESCE(m.visibility, 'visible') = 'visible'
      ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY m.timestamp, m.rowid
  `).all(...params) as unknown as CandidateRow[];

  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const key = row.timestamp === null
      ? `uuid\u0000${row.uuid}`
      : `${row.session_id}\u0000${row.timestamp}\u0000${row.text ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.values()].map((group) => {
    // Prefer the row whose source record still resolves.
    let row = group[0]!;
    let full: ReturnType<typeof fullLoadedText> = null;
    for (const candidate of group) {
      full = fullLoadedText(db, providerRegistry, candidate);
      if (full !== null) { row = candidate; break; }
    }
    const others = group.filter((candidate) => candidate !== row).map((candidate) => candidate.uuid);
    const base = {
      messageUuid: row.uuid,
      sessionId: row.session_id,
      source: row.source,
      timestamp: row.timestamp,
      agentId: row.agent_id,
      ...(others.length > 0 ? { alsoRecordedAs: others } : {}),
    };
    if (full === null) {
      return { ...base, loadedAs: null, fingerprint: null, textFrom: null, unresolved: 'source_unavailable' as const };
    }
    const loaded = parseLoadedSkill(full.text);
    if (loaded === null) {
      return { ...base, loadedAs: null, fingerprint: null, textFrom: full.from, unresolved: 'unrecognized_format' as const };
    }
    return { ...base, loadedAs: loaded.name, fingerprint: skillFingerprint(loaded.body), textFrom: full.from };
  });
}

// --- Mapping to the local Skill library -------------------------------------

export interface SkillVersionMatch {
  name: string;
  fingerprint: string;
  // minted: a frozen, minted version; draft: the current unminted draft;
  // fetched: another author's minted version installed by `obelisk skill fetch`.
  state: 'minted' | 'draft' | 'fetched';
  mint: SkillMint | null;
  fetched?: { chainId: number; skillId: string; versionIndex: number; author: string; installedTo: string };
}

// fingerprint -> the library Skill versions with that body, plus fetched
// minted versions (#17). Several Skills can share one body, so every match is
// kept; a fetched version whose body is already in the library under the
// same name is counted once, as the library version.
export async function skillVersionsByFingerprint(skillsDir: string): Promise<Map<string, SkillVersionMatch[]>> {
  const out = new Map<string, SkillVersionMatch[]>();
  const add = (match: SkillVersionMatch): void => {
    const list = out.get(match.fingerprint) ?? [];
    list.push(match);
    out.set(match.fingerprint, list);
  };
  for (const summary of await listSkills(skillsDir)) {
    const skill = await readSkill(skillsDir, summary.name);
    if (!skill) continue;
    for (const version of skill.versions) {
      add({ name: skill.name, fingerprint: version.fingerprint, state: 'minted', mint: version.mint });
    }
    if (skill.draft && !skill.draft.minted) {
      add({ name: skill.name, fingerprint: skill.draft.fingerprint, state: 'draft', mint: null });
    }
  }
  // Latest fetch per (name, fingerprint).
  const fetches = new Map<string, Awaited<ReturnType<typeof listSkillFetches>>[number]>();
  for (const record of await listSkillFetches(skillsDir)) fetches.set(`${record.name}\u0000${record.fingerprint}`, record);
  for (const record of fetches.values()) {
    if (out.get(record.fingerprint)?.some((match) => match.name === record.name)) continue;
    const { chainId, skillId, versionIndex, author, installedTo } = record;
    add({ name: record.name, fingerprint: record.fingerprint, state: 'fetched', mint: null, fetched: { chainId, skillId, versionIndex, author, installedTo } });
  }
  return out;
}

// --- Summaries -----------------------------------------------------------------

interface UsageCount {
  invocations: number;
  sessions: number;
  lastAt: string | null;
}

function countUsage(items: SkillInvocation[]): UsageCount {
  const timestamps = items.map((item) => item.timestamp).filter((ts): ts is string => ts !== null).sort();
  return {
    invocations: items.length,
    sessions: new Set(items.map((item) => item.sessionId)).size,
    lastAt: timestamps.at(-1) ?? null,
  };
}

function groupByFingerprint(items: SkillInvocation[]): Map<string, SkillInvocation[]> {
  const out = new Map<string, SkillInvocation[]>();
  for (const item of items) {
    if (item.fingerprint === null) continue;
    const list = out.get(item.fingerprint) ?? [];
    list.push(item);
    out.set(item.fingerprint, list);
  }
  return out;
}

export interface SkillUsageOverview {
  total: number;
  unresolved: Array<{ messageUuid: string; sessionId: string; reason: string }>;
  // Library Skill versions that were invoked, most used first.
  library: Array<SkillVersionMatch & UsageCount>;
  // Loaded Skills whose body is not in the library, most used first.
  other: Array<{ loadedAs: string[]; fingerprint: string } & UsageCount>;
}

export function summarizeSkillUsage(
  invocations: SkillInvocation[],
  versions: Map<string, SkillVersionMatch[]>,
): SkillUsageOverview {
  const library: SkillUsageOverview['library'] = [];
  const other: SkillUsageOverview['other'] = [];
  for (const [fingerprint, items] of groupByFingerprint(invocations)) {
    const usage = countUsage(items);
    const matches = versions.get(fingerprint);
    if (matches) {
      for (const match of matches) library.push({ ...match, ...usage });
    } else {
      const loadedAs = [...new Set(items.map((item) => item.loadedAs).filter((name): name is string => name !== null))];
      other.push({ loadedAs, fingerprint, ...usage });
    }
  }
  const byUse = (a: UsageCount, b: UsageCount): number => b.invocations - a.invocations;
  return {
    total: invocations.length,
    unresolved: invocations
      .filter((item) => item.fingerprint === null)
      .map((item) => ({ messageUuid: item.messageUuid, sessionId: item.sessionId, reason: item.unresolved ?? 'unknown' })),
    library: library.sort(byUse),
    other: other.sort(byUse),
  };
}

export interface SkillUsageDetail {
  name: string;
  invocations: number;
  // Every version of the Skill (minted versions and an unminted draft), with
  // its own count; a version nobody invoked shows 0.
  versions: Array<SkillVersionMatch & UsageCount>;
  items: Array<Omit<SkillInvocation, 'unresolved'>>;
}

export function skillUsageFor(
  name: string,
  invocations: SkillInvocation[],
  versions: Map<string, SkillVersionMatch[]>,
): SkillUsageDetail {
  const own = [...versions.values()].flat().filter((match) => match.name === name);
  const fingerprints = new Set(own.map((match) => match.fingerprint));
  const items = invocations.filter((item) => item.fingerprint !== null && fingerprints.has(item.fingerprint));
  const grouped = groupByFingerprint(items);
  return {
    name,
    invocations: items.length,
    versions: own.map((match) => ({ ...match, ...countUsage(grouped.get(match.fingerprint) ?? []) })),
    items: items.map(({ unresolved: _unresolved, ...item }) => item),
  };
}
