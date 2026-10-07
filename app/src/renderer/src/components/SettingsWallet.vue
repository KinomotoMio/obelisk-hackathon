<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import PromptCopyButton from './PromptCopyButton.vue';
import { promptAssistant } from '../prompt-copy.js';
import { assistantLabel } from '../assistant-prompts.mjs';
import { ACTIVATE_WALLET_PROMPT, CREATE_WALLET_PROMPT } from '../wallet-prompts.mjs';
import { activationPill, formatActivatedAt, importDoneText, importErrorText, keyStoreLabel, shortAddress } from '../wallet-view.mjs';

// Settings → 钱包 (#6, docs/vision/01 I1). Shows this data directory's wallet
// address and whether it is activated. 生成钱包 and 激活 copy prompts for the
// obelisk-wallet skill; 导入 happens here, because a private key or recovery
// phrase must not pass through an AI conversation. The secret is sent to the
// main process once and cleared from the page; nothing sends it back.

const overview = ref(null);
const activation = ref(null);
const loadError = ref('');
const copied = ref(false);
const notice = ref('');

const importOpen = ref(false);
const secret = ref('');
const revealSecret = ref(false);
const importing = ref(false);
const importError = ref(null);
const secretField = ref(null);

let request = 0;
let lastLoad = 0;
let copiedTimer = null;

const storeLabel = computed(() => keyStoreLabel(overview.value?.storedIn));
// "存入 macOS 钥匙串" but "存入系统钥匙串": a space only before Latin text.
const storeSpaced = computed(() => (/^[A-Za-z]/.test(storeLabel.value) ? ` ${storeLabel.value}` : storeLabel.value));
const pill = computed(() => activationPill(activation.value));
const explorerUrl = computed(() => (activation.value?.address === overview.value?.address ? activation.value?.explorerUrl ?? null : null));
const assistant = computed(() => assistantLabel(promptAssistant.id));

function errorMessage(error) {
  // ipcRenderer.invoke prefixes the main-process message; keep only the cause.
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

async function load() {
  if (!window.obelisk?.walletGet) return;
  const current = ++request;
  lastLoad = Date.now();
  try {
    const result = await window.obelisk.walletGet();
    if (current !== request) return;
    overview.value = result;
    loadError.value = '';
    if (result?.state !== 'ready') {
      activation.value = null;
      return;
    }
    if (activation.value?.address !== result.address) activation.value = null;
    const reading = await window.obelisk.walletActivation();
    if (current === request) activation.value = reading;
  } catch (error) {
    if (current === request) loadError.value = errorMessage(error);
  }
}

// Coming back from the assistant (after 生成钱包 or 激活) refreshes the section.
function onFocus() {
  if (Date.now() - lastLoad > 1500 && !importing.value) void load();
}

async function copyAddress() {
  const address = overview.value?.address;
  if (!address) return;
  try {
    await navigator.clipboard.writeText(address);
    copied.value = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 1600);
  } catch {}
}

async function openImport() {
  importOpen.value = true;
  importError.value = null;
  notice.value = '';
  await nextTick();
  secretField.value?.focus();
}

function closeImport() {
  importOpen.value = false;
  secret.value = '';
  revealSecret.value = false;
  importError.value = null;
}

async function submitImport() {
  if (importing.value || !window.obelisk?.walletImport) return;
  if (!secret.value.trim()) {
    importError.value = { code: 'empty' };
    return;
  }
  importing.value = true;
  importError.value = null;
  try {
    const result = await window.obelisk.walletImport(secret.value);
    if (result?.ok) {
      closeImport();
      notice.value = importDoneText(result);
      activation.value = null;
      await load();
    } else {
      importError.value = result?.error ?? { code: 'error' };
    }
  } catch (error) {
    importError.value = { code: 'error', message: errorMessage(error) };
  } finally {
    importing.value = false;
  }
}

function onSecretKeydown(event) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void submitImport();
  } else if (event.key === 'Escape') {
    closeImport();
  }
}

onMounted(() => {
  window.addEventListener('focus', onFocus);
  void load();
});

onBeforeUnmount(() => {
  window.removeEventListener('focus', onFocus);
  clearTimeout(copiedTimer);
  secret.value = '';
});
</script>

<template>
  <section class="settings-section" data-section="wallet">
    <div class="settings-section-head">
      <h2>钱包</h2>
      <p>你在 BOT Chain 上的身份：分享、铸造 Skill、上报使用统计都用这个地址签名。</p>
    </div>

    <div v-if="loadError" class="wallet-card error" data-wallet-state="load-error">
      <div class="wallet-line">读不到钱包信息：<span class="mono">{{ loadError }}</span></div>
      <div class="wallet-actions"><button class="btn" @click="load">重试</button></div>
    </div>

    <div v-else-if="!overview" class="wallet-card" data-wallet-state="loading">
      <div class="wallet-line muted">正在读取钱包…</div>
    </div>

    <!-- No wallet yet -->
    <div v-else-if="overview.state === 'none'" class="wallet-card" data-wallet-state="none">
      <div class="wallet-head">
        <div class="wallet-title">还没有钱包</div>
        <span class="pill dim">未创建</span>
      </div>
      <p class="wallet-text">点「生成钱包」会复制一句 prompt，粘贴到 {{ assistant }} 执行。Obelisk 在本机生成私钥并存入{{ storeSpaced }}，私钥不会出现在对话里。已经有钱包的话，可以直接导入。</p>
      <div class="wallet-actions">
        <PromptCopyButton label="生成钱包" purpose="创建 Obelisk 钱包" variant="primary" :prompt="CREATE_WALLET_PROMPT" />
        <button v-if="!importOpen" class="btn" data-wallet-action="import" @click="openImport">导入已有钱包</button>
      </div>
    </div>

    <!-- wallet.json without its key -->
    <div v-else-if="overview.state === 'key_missing'" class="wallet-card error" data-wallet-state="key-missing">
      <div class="wallet-head">
        <div class="wallet-title">钱包私钥缺失</div>
        <span class="pill danger">不可用</span>
      </div>
      <div class="address-row">
        <input class="path-field mono" type="text" :value="overview.address" readonly spellcheck="false" aria-label="钱包地址">
      </div>
      <p class="wallet-text">
        本机记录了这个钱包地址，但{{ storeSpaced }}里没有它的私钥。导入这个地址的私钥或助记词就能恢复；Obelisk 不会在它之上新建钱包。
      </p>
      <div class="wallet-actions">
        <button v-if="!importOpen" class="btn" data-wallet-action="import" @click="openImport">导入私钥或助记词</button>
      </div>
    </div>

    <!-- Unreadable -->
    <div v-else-if="overview.state === 'error'" class="wallet-card error" data-wallet-state="error">
      <div class="wallet-head">
        <div class="wallet-title">读不到钱包</div>
        <span class="pill danger">出错</span>
      </div>
      <div class="wallet-reason mono">{{ overview.message }}</div>
      <div class="wallet-actions"><button class="btn" @click="load">重试</button></div>
    </div>

    <!-- The wallet -->
    <div v-else class="wallet-card" :class="pill.tone" data-wallet-state="ready" :data-activation="activation?.activation ?? 'checking'">
      <div class="wallet-head">
        <div class="wallet-title">钱包地址</div>
        <span class="pill" :class="pill.tone" data-wallet-pill>{{ pill.text }}</span>
        <button class="btn subtle refresh" title="重新查询激活状态" :disabled="!activation" @click="load">刷新</button>
      </div>
      <div class="address-row">
        <input class="path-field mono" type="text" :value="overview.address" readonly spellcheck="false" aria-label="钱包地址" data-wallet-address>
        <button class="btn" :class="{ copied }" data-wallet-action="copy" @click="copyAddress">
          <svg v-if="!copied" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="9" height="9" rx="1.5"/>
            <path d="M6 4V3a1 1 0 0 1 1-1h5.5A1.5 1.5 0 0 1 14 3.5V9a1 1 0 0 1-1 1h-1"/>
          </svg>
          <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8l3 3 7-7"/>
          </svg>
          {{ copied ? '已复制' : '复制地址' }}
        </button>
      </div>
      <div class="wallet-meta">
        <template v-if="activation && activation.activation !== 'unknown'">
          <span data-wallet-network>{{ activation.network }}</span>
          <span class="sep">·</span>
        </template>
        <span>私钥保存在{{ storeSpaced }}</span>
        <template v-if="activation?.activation === 'active' && activation.activatedAt">
          <span class="sep">·</span>
          <span>激活于 {{ formatActivatedAt(activation.activatedAt) }}</span>
        </template>
        <template v-if="explorerUrl">
          <span class="sep">·</span>
          <a class="chain-link" :href="explorerUrl" target="_blank" rel="noopener noreferrer" data-wallet-explorer>在区块浏览器查看 ↗</a>
        </template>
      </div>

      <div v-if="activation?.activation === 'active'" class="wallet-callout ok" data-wallet-callout="active">
        已激活：别人可以把内容加密分享给这个地址。
      </div>
      <div v-else-if="activation?.activation === 'not_activated'" class="wallet-callout warn" data-wallet-callout="not-activated">
        <div>还没激活。激活要签名一次，把这个钱包的加密公钥登记到链上，之后别人才能把内容加密分享给你；手续费由 Obelisk 在线服务代付。</div>
        <div class="wallet-actions">
          <PromptCopyButton label="激活钱包" purpose="激活 Obelisk 钱包" variant="primary" :prompt="ACTIVATE_WALLET_PROMPT" />
        </div>
      </div>
      <div v-else-if="activation?.activation === 'different_key'" class="wallet-callout warn" data-wallet-callout="different-key">
        <div>链上登记的加密公钥和这个钱包派生的不一致，别人加密分享给你的内容可能打不开。重新激活会替换链上的登记。</div>
        <div class="wallet-actions">
          <PromptCopyButton label="重新激活" purpose="重新激活 Obelisk 钱包" variant="primary" :prompt="ACTIVATE_WALLET_PROMPT" />
        </div>
      </div>
      <div v-else-if="activation?.activation === 'unknown'" class="wallet-callout dim" data-wallet-callout="unknown">
        <div>连不上 Obelisk 在线服务，暂时查不到是否已激活。地址和私钥都在本机，不受影响。</div>
        <div class="wallet-reason mono">{{ activation.error?.message }}</div>
        <div class="wallet-actions"><button class="btn" data-wallet-action="retry" @click="load">重试</button></div>
      </div>
    </div>

    <div v-if="notice" class="wallet-notice" data-wallet-notice>{{ notice }}</div>

    <!-- Import: directly in the App, never through a prompt -->
    <div v-if="importOpen" class="wallet-import" data-wallet-import>
      <div class="wallet-head">
        <div class="wallet-title">{{ overview?.state === 'key_missing' ? '导入私钥或助记词' : '导入已有钱包' }}</div>
      </div>
      <div class="secret-wrap">
        <textarea
          ref="secretField"
          v-model="secret"
          class="secret-field mono"
          :class="{ masked: !revealSecret, invalid: importError }"
          rows="3"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          placeholder="私钥（64 位十六进制，可带 0x），或 12–24 个英文助记词，用空格分开"
          aria-label="私钥或助记词"
          :disabled="importing"
          @input="importError = null"
          @keydown="onSecretKeydown"
        ></textarea>
        <button class="btn subtle reveal" type="button" :aria-pressed="String(revealSecret)" @click="revealSecret = !revealSecret">
          {{ revealSecret ? '隐藏' : '显示' }}
        </button>
      </div>
      <div v-if="importError" class="field-error" data-wallet-import-error>{{ importErrorText(importError, { keyMissing: overview?.state === 'key_missing' }) }}</div>
      <div class="secret-note">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="7" width="10" height="7" rx="1.5"/>
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>
        </svg>
        <span>只在这台电脑上使用：直接存入{{ storeSpaced }}，不经过 AI 对话，也不会发给 Obelisk 在线服务。助记词导入第一个账户（m/44'/60'/0'/0/0，与 MetaMask 默认一致）。</span>
      </div>
      <div class="wallet-actions">
        <button class="btn primary" data-wallet-action="import-submit" :disabled="importing || !secret.trim()" @click="submitImport">
          {{ importing ? '正在导入…' : '导入' }}
        </button>
        <button class="btn" :disabled="importing" @click="closeImport">取消</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Same section frame as the other Settings sections (Settings.vue's styles are scoped). */
.settings-section { margin-bottom: 44px; }
.settings-section-head {
  margin-bottom: 16px; padding-bottom: 10px;
  border-bottom: 1px solid var(--hairline);
}
.settings-section-head h2 {
  font-size: 18px; font-weight: 600;
  color: var(--fg); letter-spacing: -0.01em; margin-bottom: 2px;
}
.settings-section-head p { font-size: 13px; color: var(--muted); }

.wallet-card, .wallet-import {
  padding: 18px; border: 1px solid var(--hairline); border-radius: 8px;
  background: rgba(0,0,0,0.18); display: flex; flex-direction: column; gap: 12px;
  transition: border-color 0.15s;
}
.wallet-card:hover { border-color: var(--hairline-strong); }
.wallet-card.ok { border-color: rgba(52,211,153,0.20); }
.wallet-card.warn { border-color: rgba(251,191,36,0.20); }
.wallet-card.error { border-color: rgba(248,113,113,0.25); }
.wallet-import { margin-top: 12px; border-color: rgba(167,139,250,0.25); }

.wallet-head { display: flex; align-items: center; gap: 10px; }
.wallet-title { font-size: 14px; color: var(--fg); font-weight: 600; letter-spacing: -0.005em; }
.wallet-head .refresh { margin-left: auto; height: 24px; padding: 0 8px; }
.wallet-text { font-size: 12.5px; line-height: 1.65; color: var(--fg-2); }
.wallet-line { font-size: 12.5px; color: var(--fg-2); }
.wallet-line.muted { color: var(--muted); }
.wallet-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.wallet-reason {
  font-size: 11px; color: var(--muted); overflow-wrap: anywhere;
  background: rgba(0,0,0,0.25); border: 1px solid var(--hairline); border-radius: 5px; padding: 6px 10px;
}

.pill {
  display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap;
}
.pill.ok { background: rgba(74,222,128,0.14); color: #4ade80; }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.dim { background: var(--surface-strong); color: var(--fg-2); }
.pill.danger { background: var(--danger-soft); color: var(--danger); }

.address-row { display: flex; gap: 6px; }
.path-field {
  flex: 1; height: 30px; padding: 0 10px;
  background: rgba(0,0,0,0.3); border: 1px solid var(--hairline-strong);
  border-radius: 5px; font-family: var(--font-mono); font-size: 12.5px; letter-spacing: 0.01em;
  color: var(--fg); min-width: 0;
}
.path-field:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(167,139,250,0.12); }

.wallet-meta {
  font-family: var(--font-mono); font-size: 10.5px; color: var(--muted);
  display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
}
.wallet-meta .sep { color: var(--muted-2); }
.chain-link { color: var(--chain); text-decoration: none; }
.chain-link:hover { text-decoration: underline; text-underline-offset: 2px; }

.wallet-callout {
  font-size: 12.5px; line-height: 1.65; color: var(--fg-2);
  padding: 10px 12px; border-radius: 6px; border: 1px solid var(--hairline);
  display: flex; flex-direction: column; gap: 10px;
}
.wallet-callout.ok { border-color: rgba(52,211,153,0.18); background: rgba(52,211,153,0.04); }
.wallet-callout.warn { border-color: rgba(251,191,36,0.20); background: rgba(251,191,36,0.04); }
.wallet-callout.dim { background: rgba(0,0,0,0.15); }

.wallet-notice {
  margin-top: 10px; font-size: 12px; color: #4ade80;
}

.secret-wrap { position: relative; }
.secret-field {
  width: 100%; resize: vertical; min-height: 64px; padding: 8px 56px 8px 10px;
  background: rgba(0,0,0,0.3); border: 1px solid var(--hairline-strong); border-radius: 5px;
  font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--fg);
}
.secret-field::placeholder { color: var(--muted-2); }
.secret-field:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(167,139,250,0.12); }
.secret-field.invalid { border-color: rgba(248,113,113,0.4); }
.secret-field.masked { -webkit-text-security: disc; }
.secret-wrap .reveal { position: absolute; top: 6px; right: 6px; height: 22px; padding: 0 8px; }
.field-error { font-size: 11.5px; color: var(--danger); }
.secret-note { display: flex; gap: 8px; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
.secret-note svg { width: 13px; height: 13px; flex-shrink: 0; margin-top: 2px; color: var(--accent-2); }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 14px;
  border: 1px solid var(--hairline-strong); border-radius: 6px;
  background: var(--surface); color: var(--fg-2);
  font-size: var(--text-base); font-weight: 500; cursor: pointer;
  transition: all 0.12s; white-space: nowrap;
}
.btn:hover { background: var(--surface-strong); color: var(--fg); border-color: var(--hairline-vivid); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.copied { color: var(--accent-2); }
.btn.subtle { background: transparent; border-color: transparent; color: var(--muted); font-size: 12px; }
.btn.subtle:hover:not(:disabled) { background: var(--surface); color: var(--fg-2); }
.btn.primary { color: var(--accent-2); background: var(--accent-soft); border-color: rgba(167,139,250,0.35); }
.btn.primary:hover:not(:disabled) { background: rgba(167,139,250,0.18); border-color: var(--accent); color: var(--fg); }
.btn svg { width: 13px; height: 13px; }
.mono { font-family: var(--font-mono); }
</style>
