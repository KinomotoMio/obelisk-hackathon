<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { recipientStatus } from '../share-data.js';
import { EXPIRY_CHOICES, isWalletAddress, OPENS_CHOICES, sharePrompt } from '../share-prompts.mjs';
import { describeRange } from '../share-view.mjs';
import PromptCopyButton from './PromptCopyButton.vue';

// 分享 session 片段 (#12, docs/vision/02 S1, mockup 1a). The user picks the
// range, the recipient, and the rules here; "生成分享链接" copies a prompt
// for the AI coding assistant, where the privacy check and the confirmation
// happen before anything leaves this computer.

const props = defineProps({
  session: { type: Object, required: true },
  // The session detail's messages; share message numbers are positions in it.
  messages: { type: Array, required: true },
});
const emit = defineEmits(['close']);

const total = computed(() => props.messages.length);
const from = ref(1);
const to = ref(Math.max(1, props.messages.length));
const recipient = ref('');
const opens = ref(1);
const expires = ref('24h');

const range = computed(() => describeRange(props.messages, Number(from.value), Number(to.value)));
const address = computed(() => recipient.value.trim());
const addressValid = computed(() => isWalletAddress(address.value));

// Whether the recipient has activated a wallet, checked as the address is typed.
const check = ref({ address: null, status: null, activateUrl: null, error: null });
let checkTimer = null;
watch(address, (value) => {
  clearTimeout(checkTimer);
  check.value = { address: null, status: null, activateUrl: null, error: null };
  if (!isWalletAddress(value)) return;
  check.value = { address: value, status: 'checking', activateUrl: null, error: null };
  checkTimer = setTimeout(async () => {
    const result = await recipientStatus(value);
    if (address.value === value) check.value = { address: value, activateUrl: null, error: null, ...result };
  }, 250);
});

const recipientHint = computed(() => {
  if (!address.value) return null;
  if (!addressValid.value) return { tone: 'warn', text: '钱包地址是 0x 加 40 位十六进制字符' };
  switch (check.value.status) {
    case 'activated': return { tone: 'ok', text: '已激活，可加密发送' };
    case 'not_activated': return { tone: 'warn', text: '对方还没激活 Obelisk 钱包，暂时无法加密给 TA' };
    case 'invalid': return { tone: 'warn', text: '这不是有效的钱包地址' };
    case 'unreachable': return { tone: 'dim', text: '暂时查不到是否已激活；AI 编程助手会在发送前再确认' };
    default: return { tone: 'dim', text: '正在查询是否已激活…' };
  }
});

// A recipient known not to have activated a wallet cannot be encrypted to;
// the CLI would refuse, so the prompt is not offered until they activate.
const notActivated = computed(() => check.value.status === 'not_activated' || check.value.status === 'invalid');
const ready = computed(() => range.value.valid && addressValid.value && !notActivated.value);
const prompt = computed(() => (ready.value
  ? sharePrompt({ session: props.session, from: Number(from.value), to: Number(to.value), recipient: address.value, opens: opens.value, expires: expires.value })
  : ''));

const missing = computed(() => {
  if (!range.value.valid) return `消息范围要在 1–${total.value} 之间，且起点不大于终点`;
  if (!address.value) return '填写接收者的钱包地址后即可生成';
  if (!addressValid.value) return '接收者的钱包地址格式不对';
  if (notActivated.value) return '对方激活钱包后才能分享给 TA；激活后重新打开这个对话框即可';
  return null;
});

const recipientInput = ref(null);
function onKeydown(event) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  recipientInput.value?.focus();
});
onBeforeUnmount(() => {
  clearTimeout(checkTimer);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
      <div class="share-modal-head">
        <div class="head-text">
          <div id="share-dialog-title" class="head-title">分享 session 片段</div>
          <div class="head-sub">{{ session.title || '(untitled)' }}</div>
        </div>
        <span class="pill acc">只给 TA 看</span>
        <button class="modal-close" title="关闭" @click="emit('close')">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
            <path d="M3 3l6 6M9 3l-6 6"/>
          </svg>
        </button>
      </div>

      <div class="step" data-step="range">
        <div class="step-t">1 · 选择范围</div>
        <div class="sd-row between">
          <label class="range-inputs">
            <span>第</span>
            <input v-model.number="from" class="num" type="number" min="1" :max="total" aria-label="起始消息">
            <span>–</span>
            <input v-model.number="to" class="num" type="number" min="1" :max="total" aria-label="结束消息">
            <span>条消息</span>
            <span class="muted">（共 {{ total }} 条）</span>
          </label>
          <span v-if="range.valid" class="note">{{ range.count }} 条消息 · {{ range.toolCalls }} 次工具调用</span>
        </div>
        <div v-if="range.valid" class="edges">
          <div class="edge"><span class="edge-n">#{{ range.first.n }}</span><span class="edge-role">{{ range.first.role }}</span><span class="edge-text">{{ range.first.excerpt }}</span></div>
          <div v-if="range.last" class="edge"><span class="edge-n">#{{ range.last.n }}</span><span class="edge-role">{{ range.last.role }}</span><span class="edge-text">{{ range.last.excerpt }}</span></div>
        </div>
        <div v-else class="field-error">消息范围要在 1–{{ total }} 之间，且起点不大于终点。</div>
      </div>

      <div class="step" data-step="recipient">
        <div class="step-t">2 · 接收者</div>
        <div class="sd-row">
          <input
            ref="recipientInput"
            v-model="recipient"
            class="text-input mono"
            :class="{ invalid: address && !addressValid }"
            placeholder="对方的钱包地址 0x…"
            spellcheck="false"
            autocomplete="off"
            aria-label="接收者的钱包地址"
          >
        </div>
        <div v-if="recipientHint" class="recipient-hint">
          <span class="pill" :class="recipientHint.tone" data-recipient-hint>{{ recipientHint.text }}</span>
          <span v-if="check.status === 'not_activated' && check.activateUrl" class="note">
            请对方用这个钱包在浏览器打开 <span class="mono">{{ check.activateUrl }}</span> 激活，不需要安装 Obelisk。
          </span>
        </div>
      </div>

      <div class="step" data-step="rules">
        <div class="step-t">3 · 打开规则</div>
        <div class="rules-grid">
          <div class="field">
            <label>打开次数</label>
            <div class="seg" role="radiogroup" aria-label="打开次数">
              <button v-for="choice in OPENS_CHOICES" :key="choice.value" role="radio" :aria-checked="opens === choice.value" :class="{ on: opens === choice.value }" @click="opens = choice.value">{{ choice.label }}</button>
            </div>
          </div>
          <div class="field">
            <label>有效期</label>
            <div class="seg" role="radiogroup" aria-label="有效期">
              <button v-for="choice in EXPIRY_CHOICES" :key="choice.value" role="radio" :aria-checked="expires === choice.value" :class="{ on: expires === choice.value }" @click="expires = choice.value">{{ choice.label }}</button>
            </div>
          </div>
          <div class="field">
            <label>水印</label>
            <div class="sd-row"><span class="check">✓</span><span class="fg2">阅读页总会印上接收者地址、分享编号和打开时间</span></div>
          </div>
        </div>
      </div>

      <div class="share-modal-foot">
        <span class="note">{{ missing || '隐私体检和最终确认在 AI 编程助手里完成；确认前什么都不会发出。' }}</span>
        <PromptCopyButton
          label="生成分享链接"
          variant="primary"
          :prompt="prompt"
          :disabled="!ready"
          purpose="分享这段 session"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed; inset: 0;
  background: rgba(5, 6, 12, 0.65);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  z-index: 500;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
.share-modal {
  width: 100%; max-width: 640px; max-height: calc(100vh - 48px); overflow-y: auto;
  background: linear-gradient(165deg, rgba(20,22,38,0.97) 0%, rgba(13,15,28,0.97) 100%);
  border: 1px solid var(--hairline-strong); border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 12px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08);
}
.share-modal-head {
  padding: 16px 20px; border-bottom: 1px solid var(--hairline);
  display: flex; align-items: center; gap: 12px;
}
.head-text { flex: 1; min-width: 0; }
.head-title { font-weight: 600; font-size: var(--text-md); color: var(--fg); }
.head-sub { margin-top: 3px; font-size: var(--text-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.modal-close {
  color: var(--muted); width: 24px; height: 24px;
  display: grid; place-items: center; border-radius: 4px; transition: all 0.1s;
}
.modal-close:hover { color: var(--fg-2); background: var(--surface); }
.modal-close svg { width: 12px; height: 12px; }

.step { padding: 14px 20px; border-bottom: 1px solid var(--hairline); }
.step-t { font-size: var(--text-sm); color: var(--muted); margin-bottom: 10px; font-weight: 600; letter-spacing: 0.04em; }
.sd-row { display: flex; align-items: center; gap: 10px; }
.sd-row.between { justify-content: space-between; flex-wrap: wrap; }
.note { font-size: var(--text-sm); color: var(--muted); line-height: 1.5; }
.muted { color: var(--muted); }
.fg2 { color: var(--fg-2); font-size: var(--text-sm); }
.mono { font-family: var(--font-mono); }

.range-inputs { display: inline-flex; align-items: center; gap: 6px; color: var(--fg-2); }
.num {
  width: 64px; height: 28px; padding: 0 8px; text-align: center;
  font-family: var(--font-mono); font-size: 12.5px; color: var(--fg);
  background: rgba(0,0,0,0.3); border: 1px solid var(--hairline-strong); border-radius: 5px;
  font-variant-numeric: tabular-nums;
}
.num:focus, .text-input:focus { outline: none; border-color: rgba(167,139,250,0.55); box-shadow: 0 0 0 3px rgba(167,139,250,0.12); }
.edges { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.edge {
  display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline;
  padding: 6px 10px; border-radius: 5px; background: rgba(255,255,255,0.025);
  font-size: var(--text-sm); color: var(--fg-2);
}
.edge-n { font-family: var(--font-mono); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
.edge-role { font-size: 11px; color: var(--accent-2); }
.edge-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.field-error { margin-top: 8px; font-size: var(--text-sm); color: var(--warn); }

.text-input {
  flex: 1; height: 32px; padding: 0 10px;
  font-size: 12.5px; color: var(--fg);
  background: rgba(0,0,0,0.3); border: 1px solid var(--hairline-strong); border-radius: 6px;
}
.text-input.invalid { border-color: rgba(251,191,36,0.45); }
.text-input::placeholder { color: var(--muted-2); font-family: var(--font-sans); }
.recipient-hint { margin-top: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 600; white-space: nowrap;
}
.pill.ok { background: rgba(74,222,128,0.14); color: #4ade80; }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.dim { background: var(--surface-strong); color: var(--fg-2); }
.pill.acc { background: var(--accent-soft); color: var(--accent-2); }

.rules-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.rules-grid .field:last-child { grid-column: 1 / -1; }
.field label { display: block; font-size: var(--text-xs); color: var(--muted); margin-bottom: 6px; }
.seg {
  display: inline-flex; gap: 2px; padding: 2px;
  border: 1px solid var(--hairline-strong); border-radius: 7px; background: rgba(0,0,0,0.25);
}
.seg button {
  height: 26px; padding: 0 12px; border-radius: 5px;
  font-size: var(--text-sm); color: var(--muted); transition: all 0.1s;
}
.seg button:hover:not(.on) { color: var(--fg-2); }
.seg button.on { background: var(--accent-soft); color: var(--accent-2); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.3); }
.check {
  width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0;
  display: grid; place-items: center; font-size: 11px;
  background: var(--accent-soft); color: var(--accent-2);
}

.share-modal-foot { padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; gap: 14px; }
.share-modal-foot :deep(.prompt-copy:disabled) { opacity: 0.45; box-shadow: none; }
.share-modal-foot :deep(.prompt-copy:disabled:hover) { background: var(--accent-soft); border-color: rgba(167,139,250,0.35); color: var(--accent-2); }
</style>
