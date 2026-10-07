// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// What happened after a Skill invocation (#25, vision 04 U2/U3).
//
// A slice is the part of the session that the invocation shaped: the
// messages after the Skill load, in the same agent context, up to the next
// Skill load or SLICE_MAX_MESSAGES. It also keeps the user request that came
// right before the load, so a judge can tell what the Skill was used for.
// Fact signals (invocation-signals.ts) count from it by rule; the outcome
// judge (usage-judge.ts) reads a compact rendering of it. Slices are read
// from the local index and never leave the machine except as the judge's
// prompt to the user's own AI coding assistant.

import type { SkillInvocation } from './skill-invocations.ts';
import { commandEvidence, type CommandEvidence } from './tool-execution-evidence.ts';
import type { SqliteDb } from './sqlite-types.ts';

export const SLICE_MAX_MESSAGES = 120;

export interface SliceToolCall {
  name: string;
  filePath: string | null;
}

export interface SliceToolResult {
  /** Outer tool status, distinct from command exit codes. */
  isError: boolean;
  commands?: CommandEvidence[];
  text: string;
}

export interface SliceEvent {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string | null;
  /** Typed by a person (not a tool result, not injected context). */
  human: boolean;
  text: string;
  toolCalls: SliceToolCall[];
  toolResults: SliceToolResult[];
}

export interface InvocationSlice {
  /** The person's last message before the load, if any. */
  request: string | null;
  events: SliceEvent[];
  /** Ended at the next Skill load rather than the session's end or the cap. */
  endedByNextLoad: boolean;
  /** Newest message of the whole session; a session still in use is not judged. */
  sessionLastAt: string | null;
}

interface Row {
  uuid: string;
  type: string | null;
  role: string | null;
  timestamp: string | null;
  text: string | null;
  content_type: string | null;
  is_meta: number | null;
  source: string | null;
}

const LOAD_CONDITION = `(m.content_type = 'skill_instructions' OR (m.source = 'codex' AND m.type = 'user' AND m.text LIKE '<skill>%'))`;

export function readInvocationSlice(db: SqliteDb, invocation: SkillInvocation): InvocationSlice {
  const load = db.prepare('SELECT rowid, timestamp FROM messages WHERE uuid = ?').get(invocation.messageUuid) as { rowid: number; timestamp: string | null } | undefined;
  const sessionLastAt = (db.prepare('SELECT MAX(timestamp) AS last FROM messages WHERE session_id = ?').get(invocation.sessionId) as { last: string | null } | undefined)?.last ?? null;
  if (!load) return { request: null, events: [], endedByNextLoad: false, sessionLastAt };
  const agent = invocation.agentId ?? '';
  const order = '(m.timestamp > ? OR (m.timestamp = ? AND m.rowid > ?))';
  const rows = db.prepare(`
    SELECT m.uuid, m.type, m.role, m.timestamp, m.text, m.content_type, m.is_meta, m.source,
           ${LOAD_CONDITION} AS is_load
    FROM messages m
    WHERE m.session_id = ? AND COALESCE(m.agent_id, '') = ? AND COALESCE(m.visibility, 'visible') = 'visible'
      AND COALESCE(m.content_type, '') <> 'thinking'
      AND m.uuid NOT IN (SELECT value FROM json_each(?))
      AND ${order}
    ORDER BY m.timestamp, m.rowid
    LIMIT ?
  `).all(invocation.sessionId, agent, JSON.stringify(invocation.alsoRecordedAs ?? []), load.timestamp, load.timestamp, load.rowid, SLICE_MAX_MESSAGES + 1) as unknown as (Row & { is_load: number })[];

  const request = (db.prepare(`
    SELECT m.text FROM messages m
    WHERE m.session_id = ? AND COALESCE(m.agent_id, '') = ? AND COALESCE(m.visibility, 'visible') = 'visible'
      AND m.type = 'user' AND COALESCE(m.is_meta, 0) = 0 AND COALESCE(m.content_type, 'text') = 'text'
      AND NOT ${LOAD_CONDITION}
      AND (m.timestamp < ? OR (m.timestamp = ? AND m.rowid < ?))
    ORDER BY m.timestamp DESC, m.rowid DESC LIMIT 1
  `).get(invocation.sessionId, agent, load.timestamp, load.timestamp, load.rowid) as { text: string | null } | undefined)?.text ?? null;

  const nextLoad = rows.findIndex((row) => row.is_load === 1);
  const kept = (nextLoad >= 0 ? rows.slice(0, nextLoad) : rows).slice(0, SLICE_MAX_MESSAGES);
  const calls = db.prepare('SELECT name, file_path FROM tool_calls WHERE message_uuid = ?');
  const results = db.prepare('SELECT tr.is_error, tr.content, tc.name FROM tool_results tr LEFT JOIN tool_calls tc ON tc.id = tr.tool_use_id WHERE tr.message_uuid = ?');
  const events = kept.map((row): SliceEvent => {
    const role = row.type === 'assistant' || row.role === 'assistant' ? 'assistant' : 'user';
    const toolResults = (results.all(row.uuid) as { is_error: number | null; content: string | null; name: string | null }[])
      .map((result) => ({ isError: result.is_error === 1, text: result.content ?? '', commands: commandEvidence(row.source, result.name, result.content ?? '') }));
    return {
      uuid: row.uuid,
      role,
      timestamp: row.timestamp,
      human: role === 'user' && (row.is_meta ?? 0) === 0 && (row.content_type ?? 'text') === 'text' && toolResults.length === 0,
      text: row.text ?? '',
      toolCalls: (calls.all(row.uuid) as { name: string | null; file_path: string | null }[])
        .map((call) => ({ name: call.name ?? 'unknown', filePath: call.file_path })),
      toolResults,
    };
  });
  return { request, events, endedByNextLoad: nextLoad >= 0, sessionLastAt };
}
