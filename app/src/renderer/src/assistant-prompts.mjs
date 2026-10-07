// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The one place copied prompts take their final form (docs/vision/README.md,
// "CLI 优先，App 负责展示"). Every prompt the App copies names the agent skill
// that should run it and what to ask; the user's assistant decides how that
// reads:
//
//   Claude Code   /obelisk-distill 继续修改草稿「X」：
//                 the skill's slash command, so pasting it always runs that skill
//   Codex         用 obelisk-distill 继续修改草稿「X」：
//                 Codex has no slash entry for skills; a sentence that names
//                 the skill makes it load that skill
//
// Prompt builders (skill-prompts.mjs, share-prompts.mjs) return a prompt from
// skillPrompt(); the copy button and toast render it for the chosen assistant
// with renderPrompt(), so both forms always say the same thing.

export const PROMPT_ASSISTANTS = Object.freeze([
  Object.freeze({ id: 'claude-code', label: 'Claude Code' }),
  Object.freeze({ id: 'codex', label: 'Codex' }),
]);

export const DEFAULT_PROMPT_ASSISTANT = 'claude-code';

export function isPromptAssistant(value) {
  return PROMPT_ASSISTANTS.some(assistant => assistant.id === value);
}

export function assistantLabel(id) {
  return PROMPT_ASSISTANTS.find(assistant => assistant.id === id)?.label ?? 'Claude Code';
}

/**
 * A prompt for `skill` asking `text`. `codexText` replaces `text` in the
 * sentence form when the slash form's wording would not read as a sentence
 * (e.g. `recap this week`).
 */
export function skillPrompt(skill, text, { codexText = null } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(skill)) throw new Error(`Not an agent skill name: ${skill}`);
  return Object.freeze({ skill, text, codexText });
}

export function isSkillPrompt(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.skill === 'string' && typeof value.text === 'string';
}

/** The text to copy for `assistant`. A plain string is copied as it is. */
export function renderPrompt(prompt, assistant = DEFAULT_PROMPT_ASSISTANT) {
  if (!isSkillPrompt(prompt)) return typeof prompt === 'string' ? prompt : '';
  if (assistant === 'codex') return `用 ${prompt.skill} ${prompt.codexText ?? prompt.text}`;
  return `/${prompt.skill} ${prompt.text}`;
}
