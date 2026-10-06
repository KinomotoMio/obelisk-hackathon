<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { ref, onUnmounted } from 'vue';
import { copyPrompt } from '../prompt-copy.js';

// A button that copies a prompt for the AI coding assistant (复制成 prompt).
// The copy icon marks it as such everywhere in the App.
const props = defineProps({
  label: { type: String, required: true },
  prompt: { type: String, required: true },
  // 'btn' | 'primary' (detail actions), 'inline' (next to a list entry, muted), 'toolbar'
  variant: { type: String, default: 'btn' },
  title: { type: String, default: '' },
});

const copied = ref(false);
let resetTimer = null;

async function onClick() {
  const ok = await copyPrompt(props.label, props.prompt);
  copied.value = ok;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => { copied.value = false; }, 1600);
}

onUnmounted(() => clearTimeout(resetTimer));
</script>

<template>
  <button
    class="prompt-copy"
    :class="[`is-${variant}`, { copied }]"
    :title="title || '复制一段 prompt，粘贴到 Claude Code 执行'"
    :data-prompt-label="label"
    @click.stop="onClick"
  >
    <svg v-if="!copied" class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="9" height="9" rx="1.5"/>
      <path d="M6 4V3a1 1 0 0 1 1-1h5.5A1.5 1.5 0 0 1 14 3.5V9a1 1 0 0 1-1 1h-1"/>
    </svg>
    <svg v-else class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8l3 3 7-7"/>
    </svg>
    <span>{{ copied ? '已复制' : label }}</span>
  </button>
</template>

<style scoped>
.prompt-copy {
  display: inline-flex; align-items: center; gap: 7px;
  white-space: nowrap; transition: all 0.1s;
}
.prompt-copy .ic { width: 13px; height: 13px; flex-shrink: 0; opacity: 0.85; }

/* Detail actions: same shape as .detail-actions .btn */
.prompt-copy.is-btn, .prompt-copy.is-primary {
  height: 30px; padding: 0 14px; border-radius: 6px;
  font-size: var(--text-base); font-weight: 500;
  border: 1px solid var(--hairline-strong);
  color: var(--fg-2); background: var(--surface);
}
.prompt-copy.is-btn:hover { background: var(--surface-strong); color: var(--fg); }
.prompt-copy.is-primary {
  color: var(--accent-2); background: var(--accent-soft);
  border-color: rgba(167,139,250,0.35);
}
.prompt-copy.is-primary:hover {
  background: rgba(167,139,250,0.18); border-color: var(--accent);
  color: var(--fg); box-shadow: 0 0 12px rgba(167,139,250,0.20);
}

/* Inline, next to a list entry: same shape as .row-action */
.prompt-copy.is-inline {
  height: 24px; padding: 0 8px; border-radius: 4px; gap: 5px;
  color: var(--muted); font-size: var(--text-sm);
  border: 1px solid transparent;
}
.prompt-copy.is-inline .ic { width: 11px; height: 11px; }
.prompt-copy.is-inline:hover { background: var(--surface-hi); color: var(--fg); border-color: var(--hairline-strong); }

/* Toolbar: same shape as .toolbar-action-primary */
.prompt-copy.is-toolbar {
  height: 26px; padding: 0 12px; gap: 6px;
  border: 1px solid rgba(167,139,250,0.35); border-radius: 5px;
  background: var(--accent-soft); color: var(--accent-2);
  font-size: 12px; font-weight: 500;
}
.prompt-copy.is-toolbar:hover {
  background: rgba(167,139,250,0.18); border-color: var(--accent);
  color: var(--fg); box-shadow: 0 0 12px rgba(167,139,250,0.20);
}

.prompt-copy.copied { color: var(--accent-2); }
.prompt-copy.copied .ic { opacity: 1; }
</style>
