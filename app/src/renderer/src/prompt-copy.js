// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// "复制成 prompt": action buttons copy a prompt for the user's AI coding
// assistant instead of acting themselves. One toast confirms what was copied,
// so the user sees the exact text before pasting it.

import { reactive } from 'vue';

export const promptToast = reactive({
  visible: false,
  label: '',
  prompt: '',
  failed: false,
  serial: 0,
});

let hideTimer = null;

export function dismissPromptToast() {
  clearTimeout(hideTimer);
  hideTimer = null;
  promptToast.visible = false;
}

/** Copy `prompt` and show it; resolves false when the clipboard refused. */
export async function copyPrompt(label, prompt) {
  let failed = false;
  try {
    await navigator.clipboard.writeText(prompt);
  } catch {
    failed = true;
  }
  Object.assign(promptToast, { visible: true, label, prompt, failed, serial: promptToast.serial + 1 });
  clearTimeout(hideTimer);
  // A failed copy stays up longer: the prompt has to be selected by hand.
  hideTimer = setTimeout(dismissPromptToast, failed ? 15000 : 6000);
  return !failed;
}
