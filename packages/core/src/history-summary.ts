// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// What a period of the user's history adds up to (AI 能力履历, #28,
// docs/vision/06 R1): how many sessions, in which tools and projects, on how
// many days, with which tools called most. Counted from the index, so every
// number in a résumé traces back to rows anyone with the data could recount.

import type { SqliteDb } from './sqlite-types.ts';

export interface HistoryPeriod {
  /** ISO lower bound (inclusive) on a session's start, or null for all history. */
  since: string | null;
  /** ISO upper bound (exclusive), or null for now. */
  until: string | null;
}

export interface HistorySummary {
  period: HistoryPeriod;
  sessions: number;
  /** Turns the user typed (not tool results, meta, or subagent turns). */
  userTurns: number;
  activeDays: number;
  projects: number;
  firstAt: string | null;
  lastAt: string | null;
  sources: { source: string; sessions: number }[];
  tools: { name: string; calls: number }[];
}

export interface HistorySession {
  id: string;
  title: string | null;
  source: string | null;
  project: string | null;
  startedAt: string | null;
  userTurns: number;
}

const TOP_TOOLS = 8;

function periodClause(period: HistoryPeriod, column: string): { sql: string; bindings: string[] } {
  const parts: string[] = [];
  const bindings: string[] = [];
  if (period.since) {
    parts.push(`${column} >= ?`);
    bindings.push(period.since);
  }
  if (period.until) {
    parts.push(`${column} < ?`);
    bindings.push(period.until);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1=1', bindings };
}

// Sessions the user took part in: at least one turn they typed. Automated
// runs and empty sessions are not work they can claim.
const USER_TURN = `m.type = 'user' AND m.content_type = 'text'
  AND COALESCE(m.is_meta, 0) = 0 AND COALESCE(m.is_sidechain, 0) = 0
  AND COALESCE(m.visibility, 'visible') = 'visible'`;

export function summarizeHistory(db: SqliteDb, period: HistoryPeriod): HistorySummary {
  const where = periodClause(period, 's.started_at');
  const scoped = `WITH scoped AS (
    SELECT s.id, s.source, s.project, s.started_at, count(m.uuid) AS turns
    FROM sessions s JOIN messages m ON m.session_id = s.id AND ${USER_TURN}
    WHERE ${where.sql}
    GROUP BY s.id)`;
  const totals = db.prepare(`${scoped}
    SELECT count(*) AS sessions, COALESCE(sum(turns), 0) AS turns,
      count(DISTINCT substr(started_at, 1, 10)) AS days, count(DISTINCT project) AS projects,
      min(started_at) AS first, max(started_at) AS last
    FROM scoped`).get(...where.bindings) ?? {};
  const sources = db.prepare(`${scoped}
    SELECT COALESCE(source, 'unknown') AS source, count(*) AS sessions FROM scoped
    GROUP BY source ORDER BY sessions DESC, source`).all(...where.bindings);
  const tools = db.prepare(`${scoped}
    SELECT t.name AS name, count(*) AS calls FROM tool_calls t JOIN scoped ON scoped.id = t.session_id
    WHERE t.name IS NOT NULL AND t.name != ''
    GROUP BY t.name ORDER BY calls DESC, t.name LIMIT ${TOP_TOOLS}`).all(...where.bindings);
  return {
    period,
    sessions: Number(totals['sessions'] ?? 0),
    userTurns: Number(totals['turns'] ?? 0),
    activeDays: Number(totals['days'] ?? 0),
    projects: Number(totals['projects'] ?? 0),
    firstAt: (totals['first'] as string | null) ?? null,
    lastAt: (totals['last'] as string | null) ?? null,
    sources: sources.map((row) => ({ source: String(row['source']), sessions: Number(row['sessions']) })),
    tools: tools.map((row) => ({ name: String(row['name']), calls: Number(row['calls']) })),
  };
}

/** The sessions with these ids that the user took part in, keyed by id. */
export function historySessions(db: SqliteDb, ids: string[]): Map<string, HistorySession> {
  const unique = [...new Set(ids)];
  const found = new Map<string, HistorySession>();
  const statement = db.prepare(`SELECT s.id, s.title, s.source, s.project, s.started_at,
      (SELECT count(*) FROM messages m WHERE m.session_id = s.id AND ${USER_TURN}) AS turns
    FROM sessions s WHERE s.id = ?`);
  for (const id of unique) {
    const row = statement.get(id);
    if (!row || Number(row['turns']) === 0) continue;
    found.set(id, {
      id,
      title: (row['title'] as string | null) ?? null,
      source: (row['source'] as string | null) ?? null,
      project: (row['project'] as string | null) ?? null,
      startedAt: (row['started_at'] as string | null) ?? null,
      userTurns: Number(row['turns']),
    });
  }
  return found;
}
