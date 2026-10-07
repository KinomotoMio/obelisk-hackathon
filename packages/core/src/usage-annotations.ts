// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// What this data directory knows about each Skill invocation beyond the
// load itself (#25): fact signals counted by rule and the AI judge's scenes
// and outcome. Kept in <data dir>/usage-annotations.json, keyed by the load's
// message uuid, so a run never recounts or re-judges what it already has.
// The judge's short reasons stay here and are never reported.
//
// Signals are counted once a session has been quiet for SETTLE_MS, so the
// slice after the load is complete; they are then frozen.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readInvocationSlice } from './invocation-slices.ts';
import { invocationSignals, SIGNAL_RULES_VERSION } from './invocation-signals.ts';
import type { SkillInvocation } from './skill-invocations.ts';
import type { SqliteDb } from './sqlite-types.ts';
import type { Outcome, Signal } from './usage-buckets.ts';
import type { InvocationAnnotator } from './usage-report.ts';

export const USAGE_ANNOTATIONS_FILE = 'usage-annotations.json';
const SCHEMA = 1;
/** A session quiet this long is finished enough to count and judge. */
export const SETTLE_MS = 30 * 60 * 1000;

export type JudgeHarness = 'claude' | 'codex';

export interface InvocationJudgment {
  outcome: Outcome;
  /** Scene tags from the vocabulary, written in its version (v1:…). */
  scenes: string[];
  /** One short sentence from the judge; local only. */
  reason: string;
  harness: JudgeHarness;
  promptVersion: number;
  judgedAt: string;
}

export interface InvocationAnnotationRecord {
  fingerprint: string;
  sessionId: string;
  signals?: { rulesVersion: number; values: Signal[]; countedAt: string };
  judgment?: InvocationJudgment;
}

export interface UsageAnnotations {
  invocations: Record<string, InvocationAnnotationRecord>;
}

export function usageAnnotationsPath(dataDir: string): string {
  return join(dataDir, USAGE_ANNOTATIONS_FILE);
}

export async function readUsageAnnotations(dataDir: string): Promise<UsageAnnotations> {
  const path = usageAnnotationsPath(dataDir);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { invocations: {} };
    throw error;
  }
  const parsed = JSON.parse(text) as UsageAnnotations & { schema?: number };
  if (parsed.schema !== SCHEMA || typeof parsed.invocations !== 'object' || parsed.invocations === null) {
    throw new Error(`Unsupported usage annotations in ${path}`);
  }
  return { invocations: parsed.invocations };
}

export async function writeUsageAnnotations(dataDir: string, annotations: UsageAnnotations): Promise<void> {
  const path = usageAnnotationsPath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ schema: SCHEMA, ...annotations }, null, 2)}\n`);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function isSettled(sessionLastAt: string | null, now: Date): boolean {
  return sessionLastAt !== null && now.getTime() - Date.parse(sessionLastAt) >= SETTLE_MS;
}

/** Same version loaded again later in the same session, per invocation. */
function loadedAgain(invocations: readonly SkillInvocation[]): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, SkillInvocation>();
  for (const invocation of invocations) {
    if (invocation.fingerprint === null) continue;
    const key = `${invocation.sessionId}\u0000${invocation.agentId ?? ''}\u0000${invocation.fingerprint}`;
    const earlier = seen.get(key);
    if (earlier) out.add(earlier.messageUuid);
    seen.set(key, invocation);
  }
  return out;
}

/**
 * Count fact signals for settled invocations that have none yet (or were
 * counted by older rules). Returns how many were counted. `invocations` must
 * be in index order, as recognizeSkillInvocations returns them.
 */
export function countSettledSignals(
  db: SqliteDb,
  invocations: readonly SkillInvocation[],
  annotations: UsageAnnotations,
  now: Date,
  include: (invocation: SkillInvocation) => boolean = () => true,
): number {
  const again = loadedAgain(invocations);
  let counted = 0;
  for (const invocation of invocations) {
    if (invocation.fingerprint === null || !include(invocation)) continue;
    const record = annotations.invocations[invocation.messageUuid];
    if (record?.signals?.rulesVersion === SIGNAL_RULES_VERSION && record.fingerprint === invocation.fingerprint) continue;
    const slice = readInvocationSlice(db, invocation);
    if (!isSettled(slice.sessionLastAt, now)) continue;
    annotations.invocations[invocation.messageUuid] = {
      ...(record?.fingerprint === invocation.fingerprint ? record : {}),
      fingerprint: invocation.fingerprint,
      sessionId: invocation.sessionId,
      signals: { rulesVersion: SIGNAL_RULES_VERSION, values: invocationSignals(slice, again.has(invocation.messageUuid)), countedAt: now.toISOString() },
    };
    counted += 1;
  }
  return counted;
}

/** Report annotations (usage-report.ts) from what is stored. */
export function storedAnnotator(annotations: UsageAnnotations): InvocationAnnotator {
  return (invocation) => {
    const record = annotations.invocations[invocation.messageUuid];
    if (!record || record.fingerprint !== invocation.fingerprint) return null;
    return {
      signals: record.signals?.values ?? [],
      outcome: record.judgment?.outcome ?? null,
      scenes: record.judgment?.scenes ?? [],
    };
  };
}
