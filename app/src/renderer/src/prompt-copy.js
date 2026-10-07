// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// "复制成 prompt": action buttons copy a prompt for the user's AI coding
// assistant instead of acting themselves. One toast confirms what was copied,
// so the user sees the exact text before pasting it. Prompts are written for
// the assistant chosen in Settings (复制给), kept in the data directory's
// settings; assistant-prompts.mjs holds both forms.

import { reactive } from 'vue';
import { DEFAULT_PROMPT_ASSISTANT, isPromptAssistant, renderPrompt } from './assistant-prompts.mjs';

export const promptAssistant = reactive({ id: DEFAULT_PROMPT_ASSISTANT });

export async function loadPromptAssistant() {
  try {
    const id = await window.obelisk?.getPromptAssistant?.();
    if (isPromptAssistant(id)) promptAssistant.id = id;
  } catch {}
}

export async function setPromptAssistant(id) {
  if (!isPromptAssistant(id)) return;
  promptAssistant.id = id;
  try {
    await window.obelisk?.setSetting?.('promptAssistant', id);
  } catch {}
}

export const promptToast = reactive({
  visible: false,
  label: '',
  /** What was copied, as text. */
  prompt: '',
  /** The prompt it was rendered from, so the toast can re-copy it for the other assistant. */
  source: null,
  assistant: DEFAULT_PROMPT_ASSISTANT,
  failed: false,
  serial: 0,
});

let hideTimer = null;

export function dismissPromptToast() {
  clearTimeout(hideTimer);
  hideTimer = null;
  promptToast.visible = false;
}

/**
 * Copy `prompt` (a skill prompt or plain text) for the chosen assistant and
 * show it; resolves false when the clipboard refused.
 */
export async function copyPrompt(label, prompt, assistant = promptAssistant.id) {
  const text = renderPrompt(prompt, assistant);
  let failed = false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    failed = true;
  }
  Object.assign(promptToast, { visible: true, label, prompt: text, source: prompt, assistant, failed, serial: promptToast.serial + 1 });
  clearTimeout(hideTimer);
  // A failed copy stays up longer: the prompt has to be selected by hand.
  hideTimer = setTimeout(dismissPromptToast, failed ? 15000 : 6000);
  return !failed;
}

/** Switch the assistant from the toast and copy the same prompt again in its form. */
export async function recopyFor(assistant) {
  await setPromptAssistant(assistant);
  if (promptToast.source) await copyPrompt(promptToast.label, promptToast.source, assistant);
}
