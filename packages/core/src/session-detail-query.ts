// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// One session's detail read from the index, for consumers outside the App
// (sharing, #8). The queries mirror the App main process's
// querySessionSnapshot (app/src/main/index.ts): main thread, visible rows
// only, assembled through the single assembleSessionDetail seam (ADR 0007),
// so message N here is message N in the App's session detail.

import { assembleSessionDetail, type AssembledMessage, type SessionDetailSessionRow } from './session-detail.ts';
import type { SqliteDb } from './sqlite-types.ts';

export interface SessionDetailForRead {
  session: SessionDetailSessionRow;
  messages: AssembledMessage[];
}

const SESSION_COLUMNS = 'id, title, project, started_at, ended_at, git_branch, message_count, source';

/** A session by exact id or unique id prefix (at least 6 characters). */
export function resolveSessionRow(db: SqliteDb, ref: string): SessionDetailSessionRow {
  const wanted = ref.trim();
  const exact = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`).get(wanted) as SessionDetailSessionRow | undefined;
  if (exact) return exact;
  if (wanted.length >= 6) {
    const escaped = wanted.replace(/[\\%_]/g, (c) => `\\${c}`);
    const matches = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id LIKE ? ESCAPE '\\' LIMIT 3`).all(`${escaped}%`) as SessionDetailSessionRow[];
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) throw new Error(`Session id prefix ${wanted} matches more than one session; give more of the id`);
  }
  throw new Error(`No indexed session has id ${wanted}`);
}

export function querySessionDetail(db: SqliteDb, ref: string): SessionDetailForRead {
  const session = resolveSessionRow(db, ref);
  const id = session.id;
  const visibleMain = `m.session_id = ? AND m.agent_id IS NULL AND COALESCE(m.visibility, 'visible') = 'visible'`;
  const messages = db.prepare(`
    SELECT m.uuid, m.session_id, m.type, m.parent_uuid, m.timestamp, m.role, m.text, m.model,
           m.is_sidechain, m.agent_id, m.input_tokens, m.output_tokens, m.cwd, m.skill, m.turn_duration_ms,
           m.content_type, m.is_meta, m.visibility, m.source
    FROM messages m
    WHERE ${visibleMain}
    ORDER BY m.timestamp, m.uuid
  `).all(id) as never[];
  const toolCalls = db.prepare(`
    SELECT tc.* FROM messages m CROSS JOIN tool_calls tc ON tc.message_uuid = m.uuid
    WHERE ${visibleMain} AND tc.session_id = ?
  `).all(id, id) as never[];
  const toolResults = db.prepare(`
    SELECT tr.* FROM messages m CROSS JOIN tool_results tr ON tr.message_uuid = m.uuid
    WHERE ${visibleMain} AND tr.session_id = ?
  `).all(id, id) as never[];
  const subagents = db.prepare('SELECT * FROM subagents WHERE session_id = ?').all(id) as never[];
  const detail = assembleSessionDetail({ messages, toolCalls, toolResults, subagents, workflows: [], summaries: [] });
  return { session, messages: detail.messages };
}
