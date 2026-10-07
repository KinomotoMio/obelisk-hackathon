<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { promptToast, dismissPromptToast, recopyFor } from '../prompt-copy.js';
import { assistantLabel, isSkillPrompt, PROMPT_ASSISTANTS } from '../assistant-prompts.mjs';

const other = () => PROMPT_ASSISTANTS.find(assistant => assistant.id !== promptToast.assistant);
</script>

<template>
  <Transition name="prompt-toast-fade">
    <div
      v-if="promptToast.visible"
      :key="promptToast.serial"
      class="prompt-toast"
      :class="{ failed: promptToast.failed }"
      role="status"
    >
      <div class="prompt-toast-head">
        <svg v-if="!promptToast.failed" class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 8l3 3 7-7"/>
        </svg>
        <span v-if="!promptToast.failed">
          已复制「{{ promptToast.label }}」的 prompt<span class="hint"> · 粘贴到 <strong data-assistant>{{ assistantLabel(promptToast.assistant) }}</strong> 执行</span>
        </span>
        <span v-else>没能写入剪贴板 · 请手动选中下面的 prompt 复制</span>
        <button class="prompt-toast-close" aria-label="关闭" @click="dismissPromptToast">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M3 3l6 6M9 3l-6 6"/>
          </svg>
        </button>
      </div>
      <pre class="prompt-toast-text">{{ promptToast.prompt }}</pre>
      <div v-if="isSkillPrompt(promptToast.source)" class="prompt-toast-foot">
        <span>用的是 {{ other().label }}？</span>
        <button class="prompt-toast-switch" data-switch-assistant @click="recopyFor(other().id)">改成 {{ other().label }} 的写法并重新复制</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.prompt-toast {
  position: fixed; bottom: 24px; left: calc(50% + var(--col-sidebar) / 2);
  transform: translateX(-50%); z-index: 400;
  width: min(560px, calc(100vw - var(--col-sidebar) - 48px));
  background: linear-gradient(165deg, rgba(20,22,38,0.96) 0%, rgba(13,15,28,0.96) 100%);
  border: 1px solid var(--hairline-strong); border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06);
  padding: 10px 12px 12px 14px;
  font-size: var(--text-sm); color: var(--fg-2);
}
.prompt-toast.failed { border-color: rgba(251,191,36,0.3); }
.prompt-toast-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.prompt-toast-head > span { flex: 1; min-width: 0; }
.prompt-toast-head .ic { width: 13px; height: 13px; color: var(--accent-2); flex-shrink: 0; }
.prompt-toast-head .hint { color: var(--muted); }
.prompt-toast-head .hint strong { color: var(--fg-2); font-weight: 600; }
.prompt-toast-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--muted); }
.prompt-toast-switch { font: inherit; color: var(--accent-2); }
.prompt-toast-switch:hover { text-decoration: underline; text-underline-offset: 2px; }
.prompt-toast.failed .prompt-toast-head { color: var(--warn); }
.prompt-toast-close {
  width: 22px; height: 22px; display: grid; place-items: center;
  color: var(--muted); border-radius: 4px; flex-shrink: 0;
}
.prompt-toast-close:hover { color: var(--fg-2); background: var(--surface-strong); }
.prompt-toast-close svg { width: 10px; height: 10px; }
.prompt-toast-text {
  margin: 0; padding: 8px 10px;
  background: rgba(0,0,0,0.35); border: 1px solid var(--hairline);
  border-radius: 5px;
  font-family: var(--font-mono); font-size: 11.5px; line-height: 1.6;
  color: var(--fg); white-space: pre-wrap; word-break: break-word;
  max-height: 128px; overflow-y: auto; user-select: text;
}

.prompt-toast-fade-enter-active, .prompt-toast-fade-leave-active { transition: opacity 0.18s, transform 0.18s; }
.prompt-toast-fade-enter-from, .prompt-toast-fade-leave-to { opacity: 0; transform: translate(-50%, 6px); }
</style>
