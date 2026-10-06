// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Share snapshots (#8, docs/vision/02 S1/S6): a read-only copy of a range of
// one session's messages, with where it came from, when it was taken, and
// which spans were redacted. This JSON is what gets encrypted; the web reader
// (#10) renders it.
//
// Message numbers are 1-based positions in the session detail as the App
// shows it (see session-detail-query.ts), so "messages 12–48" means the same
// thing in the App, the CLI, and the reader.
//
// Thinking blocks and loaded Skill bodies are left out: they are not part of
// the conversation the user chose to show. Tool input and output are kept,
// cut to TOOL_TEXT_LIMIT characters each.

import type { AssembledMessage, SessionDetailSessionRow } from './session-detail.ts';
import { FINDING_LABELS, redactText, scanText, maskText, type FindingType, type ScanHints, type TextMatch } from './privacy-scan.ts';

export const SHARE_SNAPSHOT_FORMAT = 'obelisk.share.snapshot/v1';
export const TOOL_TEXT_LIMIT = 4000;

export interface ShareSnapshotToolCall {
  name: string;
  input: string | null;
  result: string | null;
  /** Present when input or result was cut to TOOL_TEXT_LIMIT characters. */
  truncated?: { input?: number; result?: number };
}

export interface ShareSnapshotMessage {
  n: number;
  role: string;
  /** Injected context or system evidence, not something a person typed. */
  meta: boolean;
  timestamp: string | null;
  text: string | null;
  toolCalls: ShareSnapshotToolCall[];
}

export interface ShareRedaction {
  type: FindingType;
  label: string;
  /** Message numbers where it was replaced; 0 means the title. */
  messages: number[];
}

export interface ShareSnapshot {
  format: typeof SHARE_SNAPSHOT_FORMAT;
  title: string | null;
  source: { provider: string | null; sessionId: string; startedAt: string | null; endedAt: string | null };
  range: { from: number; to: number; total: number };
  capturedAt: string;
  redactions: ShareRedaction[];
  messages: ShareSnapshotMessage[];
}

export type ShareTextPart = 'title' | 'text' | 'tool_input' | 'tool_result';

const PART_LABELS: Record<ShareTextPart, string> = {
  title: 'title',
  text: 'text',
  tool_input: 'tool input',
  tool_result: 'tool output',
};

export interface ShareFindingLocation {
  /** Message number; 0 for the title. */
  message: number;
  part: ShareTextPart;
}

/** One distinct sensitive value. Deliberately carries no value. */
export interface ShareFinding {
  id: number;
  type: FindingType;
  label: string;
  occurrences: number;
  locations: ShareFindingLocation[];
  where: string;
}

function cut(text: string | null | undefined, limit: number): { text: string | null; cutFrom?: number } {
  if (typeof text !== 'string') return { text: null };
  if (text.length <= limit) return { text };
  return { text: text.slice(0, limit), cutFrom: text.length };
}

export function snapshotMessage(message: AssembledMessage, n: number): ShareSnapshotMessage {
  const toolCalls = (message.tool_calls ?? []).map((call) => {
    const input = cut(call.input_json, TOOL_TEXT_LIMIT);
    const result = cut(call.result?.content as string | null | undefined, TOOL_TEXT_LIMIT);
    const truncated = {
      ...(input.cutFrom ? { input: input.cutFrom } : {}),
      ...(result.cutFrom ? { result: result.cutFrom } : {}),
    };
    return {
      name: call.name,
      input: input.text,
      result: result.text,
      ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
    };
  });
  return {
    n,
    role: message.type ?? 'unknown',
    meta: message.is_meta === 1,
    timestamp: message.timestamp,
    text: message.text,
    toolCalls,
  };
}

export function buildShareSnapshot(input: {
  session: SessionDetailSessionRow;
  messages: AssembledMessage[];
  from: number;
  to: number;
  capturedAt: Date;
}): ShareSnapshot {
  const { session, messages, from, to } = input;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > messages.length) {
    throw new Error(`Message range ${from}–${to} is outside this session, which has messages 1–${messages.length}`);
  }
  return {
    format: SHARE_SNAPSHOT_FORMAT,
    title: session.title ?? null,
    source: {
      provider: session.source ?? null,
      sessionId: session.id,
      startedAt: session.started_at ?? null,
      endedAt: session.ended_at ?? null,
    },
    range: { from, to, total: messages.length },
    capturedAt: input.capturedAt.toISOString(),
    redactions: [],
    messages: messages.slice(from - 1, to).map((message, index) => snapshotMessage(message, from + index)),
  };
}

interface TextSlot {
  location: ShareFindingLocation;
  get(): string | null;
  set(value: string): void;
}

function textSlots(snapshot: ShareSnapshot): TextSlot[] {
  const slots: TextSlot[] = [{
    location: { message: 0, part: 'title' },
    get: () => snapshot.title,
    set: (value) => { snapshot.title = value; },
  }];
  for (const message of snapshot.messages) {
    slots.push({ location: { message: message.n, part: 'text' }, get: () => message.text, set: (value) => { message.text = value; } });
    for (const call of message.toolCalls) {
      slots.push({ location: { message: message.n, part: 'tool_input' }, get: () => call.input, set: (value) => { call.input = value; } });
      slots.push({ location: { message: message.n, part: 'tool_result' }, get: () => call.result, set: (value) => { call.result = value; } });
    }
  }
  return slots;
}

function describeLocations(locations: ShareFindingLocation[]): string {
  const byMessage = new Map<number, Set<ShareTextPart>>();
  for (const { message, part } of locations) {
    if (!byMessage.has(message)) byMessage.set(message, new Set());
    byMessage.get(message)!.add(part);
  }
  const numbered = [...byMessage]
    .filter(([message]) => message !== 0)
    .map(([message, kinds]) => `${message} (${[...kinds].map((kind) => PART_LABELS[kind]).join(', ')})`);
  const pieces: string[] = [];
  if (numbered.length > 0) pieces.push(`${numbered.length === 1 ? 'message' : 'messages'} ${numbered.join(', ')}`);
  if (byMessage.has(0)) pieces.push('the title');
  return pieces.join('; ');
}

interface ScannedSlot {
  slot: TextSlot;
  text: string;
  matches: { match: TextMatch; findingId: number }[];
}

function scanSlots(snapshot: ShareSnapshot, hints: ScanHints): { findings: ShareFinding[]; scanned: ScannedSlot[] } {
  const ids = new Map<string, number>();
  const findings: ShareFinding[] = [];
  const scanned: ScannedSlot[] = [];
  for (const slot of textSlots(snapshot)) {
    const text = slot.get();
    if (!text) continue;
    const matches = scanText(text, hints).map((match) => {
      const key = `${match.type}\u0000${match.value}`;
      let id = ids.get(key);
      if (id === undefined) {
        id = findings.length + 1;
        ids.set(key, id);
        findings.push({ id, type: match.type, label: FINDING_LABELS[match.type], occurrences: 0, locations: [], where: '' });
      }
      const finding = findings[id - 1]!;
      finding.occurrences += 1;
      if (!finding.locations.some((l) => l.message === slot.location.message && l.part === slot.location.part)) {
        finding.locations.push(slot.location);
      }
      return { match, findingId: id };
    });
    if (matches.length > 0) scanned.push({ slot, text, matches });
  }
  for (const finding of findings) finding.where = describeLocations(finding.locations);
  return { findings, scanned };
}

/**
 * Privacy check over a snapshot. Ids are stable for the same snapshot: the
 * first distinct value found (title, then messages in order) is 1.
 */
export function scanShareSnapshot(snapshot: ShareSnapshot, hints: ScanHints = {}): ShareFinding[] {
  return scanSlots(snapshot, hints).findings;
}

/** A copy of `snapshot` with the findings in `redact` replaced and recorded. */
export function redactShareSnapshot(snapshot: ShareSnapshot, redact: ReadonlySet<number>, hints: ScanHints = {}): ShareSnapshot {
  const copy = structuredClone(snapshot);
  const { findings, scanned } = scanSlots(copy, hints);
  const unknown = [...redact].filter((id) => !findings[id - 1]);
  if (unknown.length > 0) throw new Error(`No privacy finding numbered ${unknown.join(', ')}; this snapshot has ${findings.length}`);
  for (const { slot, text, matches } of scanned) {
    const chosen = new Set(matches.filter(({ findingId }) => redact.has(findingId)).map(({ match }) => match));
    if (chosen.size > 0) slot.set(redactText(text, matches.map(({ match }) => match), (match) => chosen.has(match)));
  }
  copy.redactions = findings
    .filter((finding) => redact.has(finding.id))
    .map((finding) => ({
      type: finding.type,
      label: finding.label,
      messages: [...new Set(finding.locations.map((location) => location.message))],
    }));
  return copy;
}

export interface ShareOutlineEntry {
  n: number;
  role: string;
  meta: boolean;
  timestamp: string | null;
  /** The start of the text with every sensitive span masked. */
  excerpt: string | null;
  tools: string[];
}

const EXCERPT_CHARS = 100;

/** Numbered messages with masked excerpts, for choosing a range in conversation. */
export function outlineMessages(messages: AssembledMessage[], hints: ScanHints = {}): ShareOutlineEntry[] {
  return messages.map((message, index) => {
    const text = message.text?.replace(/\s+/g, ' ').trim() ?? '';
    // Mask before cutting so a cut cannot split a value past recognition.
    const masked = text ? maskText(text.slice(0, EXCERPT_CHARS * 4), hints) : '';
    return {
      n: index + 1,
      role: message.type ?? 'unknown',
      meta: message.is_meta === 1,
      timestamp: message.timestamp,
      excerpt: masked ? (masked.length > EXCERPT_CHARS ? `${masked.slice(0, EXCERPT_CHARS)}…` : masked) : null,
      tools: (message.tool_calls ?? []).map((call) => call.name),
    };
  });
}
