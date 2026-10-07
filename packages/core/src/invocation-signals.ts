// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Fact signals of a Skill invocation (#25, vision 04 "结果判断" layer 1):
// counted by rule from what followed the load (invocation-slices.ts), never
// inferred. Each is a yes/no per invocation, reported as signal/<id> buckets
// (usage-buckets.ts):
//
//   tool-error           a tool call after the load returned an error
//   user-correction      the person interrupted the assistant, or a message
//                        of theirs opens like a correction ("不对", "wrong", …)
//   repeated-edit        one file was edited REPEATED_EDIT_THRESHOLD or more times
//   repeated-invocation  the same Skill version was loaded again in the session
//
// The correction rule only looks at how a message starts, so it misses
// polite corrections and never reads intent; the AI judge covers the rest.

import type { InvocationSlice } from './invocation-slices.ts';
import type { Signal } from './usage-buckets.ts';

/** Bump when a rule changes, so stored signals are recounted. */
export const SIGNAL_RULES_VERSION = 1;
export const REPEATED_EDIT_THRESHOLD = 3;

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'edit', 'write']);

const INTERRUPTION_RE = /^\[Request interrupted by user/;
const CORRECTION_RE = new RegExp([
  '^(?:不对|不是这样|不是的|错了|搞错|你错|不要这样|别这样|别改|停下|停一下|先停|撤销|回退|改回|还是不行|还是不对|仍然不对|没用|不行[，,。!！ ]?)',
  '^(?:no(?:[,.!]|\\s+(?!problem|worries|need|rush))|nope\\b|wrong\\b|that\'?s (?:not|wrong)|that is (?:not|wrong)|this is wrong|stop\\b|undo\\b|revert\\b|don\'?t\\b|do not\\b|still (?:broken|failing|wrong|not))',
].join('|'), 'i');

export function isCorrection(text: string): boolean {
  const start = text.trim();
  return INTERRUPTION_RE.test(start) || CORRECTION_RE.test(start);
}

/**
 * Signals of one invocation. `loadedAgainLater` says whether the same version
 * was loaded again later in the same session (from the recognized invocations).
 */
export function invocationSignals(slice: InvocationSlice, loadedAgainLater: boolean): Signal[] {
  const signals: Signal[] = [];
  if (slice.events.some((event) => event.toolResults.some((result) => result.isError))) signals.push('tool-error');
  if (slice.events.some((event) => event.role === 'user' && (event.human || INTERRUPTION_RE.test(event.text.trim())) && isCorrection(event.text))) {
    signals.push('user-correction');
  }
  const edits = new Map<string, number>();
  for (const event of slice.events) {
    for (const call of event.toolCalls) {
      if (!call.filePath || !EDIT_TOOLS.has(call.name)) continue;
      edits.set(call.filePath, (edits.get(call.filePath) ?? 0) + 1);
    }
  }
  if ([...edits.values()].some((count) => count >= REPEATED_EDIT_THRESHOLD)) signals.push('repeated-edit');
  if (loadedAgainLater) signals.push('repeated-invocation');
  return signals;
}
