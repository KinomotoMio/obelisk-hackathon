<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getSessionSummary } from '../store.js';
import { loadShares, shareState } from '../share-data.js';
import { revokePrompt, SHARE_EXAMPLE_PROMPT } from '../share-prompts.mjs';
import {
  canRevoke, fmtShareTime, rangeLabel, serviceProblem, shareRecord, shareRules, shareStatus, shortAddress,
} from '../share-view.mjs';
import PromptCopyButton from '../components/PromptCopyButton.vue';
import { promptAssistant } from '../prompt-copy.js';
import { assistantLabel } from '../assistant-prompts.mjs';

// Share tab · 已发送 (#12, docs/vision/02 S3): every share sent from this
// computer with its state on chain. Sending and revoking happen in the AI
// coding assistant; the revoke button copies that prompt.

defineOptions({ name: 'ShareList' });

const router = useRouter();
const now = ref(new Date());
const copiedLink = ref(null);

const rows = computed(() => shareState.shares.map(share => ({
  share,
  status: shareStatus(share, now.value),
  rules: shareRules(share, now.value),
  record: shareRecord(share),
  revocable: canRevoke(share),
  hasSession: Boolean(share.session && getSessionSummary(share.session.id)),
})));
const footnote = computed(() => {
  const network = shareState.network || 'BOT Chain';
  // 「BOT Chain 上」 but 「BOT Chain 测试网上」: a space only after a Latin name.
  return `「已读」「已撤回」等状态来自 ${network}${/[\u3400-\u9fff]$/.test(network) ? '' : ' '}上的记录，任何人都可以在区块浏览器核对。时间均为本地时间。`;
});
const problem = computed(() => serviceProblem(shareState.shares));
const refreshedLabel = computed(() => fmtShareTime(shareState.refreshedAt, now.value).slice(-5));

function openSession(share) {
  router.push({ name: 'SessionDetail', params: { id: share.session.id } });
}

async function copyLink(share) {
  try {
    await navigator.clipboard.writeText(share.link);
    copiedLink.value = share.shareId;
    setTimeout(() => { if (copiedLink.value === share.shareId) copiedLink.value = null; }, 1600);
  } catch {
    copiedLink.value = null;
  }
}

function refresh() {
  now.value = new Date();
  return loadShares();
}

// Opens and expiry happen on chain, not in the files the watcher sees.
const REFRESH_MS = 30_000;
let timer = null;
function onFocus() { refresh(); }
onMounted(() => {
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  window.addEventListener('focus', onFocus);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener('focus', onFocus);
});
</script>

<template>
  <div class="share-wrap">
    <div class="share-page">
      <div class="share-tabs" role="tablist">
        <button class="share-tab active" role="tab" aria-selected="true">已发送</button>
        <button class="share-tab" role="tab" aria-selected="false" disabled title="阶段 2：别人分享给你的内容会出现在这里，和你自己的记忆分开存放">收到的 · 阶段 2</button>
      </div>

      <div v-if="shareState.error" class="detail-banner broken" data-banner="error">
        <svg class="detail-banner-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 2l6.5 11.5h-13z M8 6.5v3M8 11.6v.4"/>
        </svg>
        <div class="detail-banner-body">
          <strong>读取分享记录失败</strong>
          <div>{{ shareState.error }}</div>
        </div>
      </div>
      <div v-else-if="problem" class="detail-banner partial" data-banner="offline">
        <svg class="detail-banner-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 2l6.5 11.5h-13z M8 6.5v3M8 11.6v.4"/>
        </svg>
        <div class="detail-banner-body">
          <strong>暂时读不到分享的状态</strong>
          <div>下面是本机记录的分享；连上 Obelisk 在线服务后会显示是否已读。</div>
          <div class="banner-cause">{{ problem }}</div>
        </div>
      </div>

      <template v-if="rows.length">
        <div class="share-table-wrap">
          <table class="share-table">
            <thead>
              <tr><th>内容</th><th>接收者</th><th>规则</th><th>状态</th><th>链上记录</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.share.shareId" :data-share="row.share.number" :data-state="row.share.state">
                <td class="cell-content">
                  <button v-if="row.hasSession" class="share-title link" :title="'打开这个 session'" @click="openSession(row.share)">{{ row.share.title || '未命名的 session' }}</button>
                  <span v-else class="share-title">{{ row.share.title || '未命名的 session' }}</span>
                  <div class="share-sub">
                    <span class="mono">#{{ row.share.number }}</span>
                    <template v-if="row.share.messages"><span class="dot"></span><span>{{ rangeLabel(row.share.messages) }}</span></template>
                    <template v-if="row.share.sentAt"><span class="dot"></span><span>{{ fmtShareTime(row.share.sentAt, now) }} 发出</span></template>
                  </div>
                </td>
                <td class="mono cell-recipient" :title="row.share.recipient">{{ shortAddress(row.share.recipient) }}</td>
                <td class="cell-rules">{{ row.rules }}</td>
                <td>
                  <span class="pill" :class="row.status.tone" :title="row.status.detail">{{ row.status.label }}</span>
                </td>
                <td>
                  <a v-if="row.record" class="chain-link" :href="row.record.url" target="_blank" rel="noopener noreferrer">{{ row.record.label }} ↗</a>
                  <span v-else class="muted">—</span>
                </td>
                <td class="cell-actions">
                  <button
                    v-if="row.share.link && (row.share.canOpen || row.share.state === 'unknown')"
                    class="row-action"
                    :title="'复制分享链接；只有 ' + row.share.recipient + ' 的钱包能打开'"
                    @click="copyLink(row.share)"
                  >{{ copiedLink === row.share.shareId ? '已复制' : '复制链接' }}</button>
                  <PromptCopyButton
                    v-if="row.revocable"
                    label="撤回"
                    variant="inline"
                    :prompt="revokePrompt(row.share)"
                    purpose="撤回这条分享"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="share-foot">
          <span>{{ footnote }}</span>
          <span class="share-refresh">
            <span v-if="refreshedLabel">{{ refreshedLabel }} 更新</span>
            <button class="row-action" :disabled="shareState.loading" @click="refresh">{{ shareState.loading ? '更新中…' : '刷新' }}</button>
          </span>
        </div>
      </template>

      <div v-else-if="shareState.loaded && !shareState.error" class="share-empty">
        <div class="share-empty-eyebrow"><span class="diamond"></span><span>还没有发出的分享</span></div>
        <div class="share-empty-title">把一段 session 只给 TA 看。</div>
        <div class="share-empty-body">
          在 Session 详情页点「分享」，选好消息范围、接收者的钱包地址和打开规则，复制成 prompt 粘贴到 {{ assistantLabel(promptAssistant.id) }}。
          也可以直接对它说，例如 <code>{{ SHARE_EXAMPLE_PROMPT }}</code>。
          内容在本机打码、加密后才离开，只有那个钱包能打开；发出的分享和对方是否已读会出现在这里。
        </div>
        <div class="share-empty-actions">
          <button class="share-empty-btn" @click="router.push('/sessions')">去选一个 session</button>
          <PromptCopyButton label="分享一段 session" :prompt="SHARE_EXAMPLE_PROMPT" variant="btn" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.share-page { max-width: 980px; margin: 0 auto; padding: 12px 32px 80px; }

.share-tabs {
  display: inline-flex; gap: 2px; padding: 2px; margin-bottom: 18px;
  border: 1px solid var(--hairline-strong); border-radius: 7px; background: rgba(0,0,0,0.2);
}
.share-tab {
  height: 26px; padding: 0 12px; border-radius: 5px;
  font-size: var(--text-sm); color: var(--muted);
}
.share-tab.active { background: var(--surface-strong); color: var(--fg); }
.share-tab:disabled { color: var(--muted-2); }

.detail-banner { margin-bottom: 16px; }
.banner-cause { margin-top: 4px; color: var(--muted); font-size: var(--text-sm); word-break: break-word; }

.share-table-wrap {
  border: 1px solid var(--hairline); border-radius: 8px;
  background: rgba(255,255,255,0.02); overflow-x: auto;
}
.share-table { width: 100%; border-collapse: collapse; font-size: var(--text-base); }
.share-table th {
  text-align: left; font-weight: 500; font-size: var(--text-xs);
  letter-spacing: 0.04em; color: var(--muted);
  padding: 10px 12px; border-bottom: 1px solid var(--hairline-strong); white-space: nowrap;
}
.share-table td { padding: 12px 12px; border-bottom: 1px solid var(--hairline); vertical-align: middle; }
.share-table tbody tr:last-child td { border-bottom: 0; }
.share-table tbody tr:hover td { background: rgba(255,255,255,0.015); }

.cell-content { min-width: 180px; max-width: 340px; }
.share-title {
  display: block; max-width: 100%; text-align: left;
  color: var(--fg); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.share-title.link:hover { color: var(--accent-2); }
.share-sub {
  display: flex; align-items: center; gap: 7px; margin-top: 4px; white-space: nowrap;
  font-size: var(--text-xs); color: var(--muted); font-variant-numeric: tabular-nums;
}
.share-sub .dot { width: 2px; height: 2px; background: var(--muted-2); border-radius: 50%; }
.mono { font-family: var(--font-mono); font-size: 12px; }
.share-sub .mono { font-size: 11px; color: var(--fg-2); }
.cell-recipient { color: var(--fg-2); white-space: nowrap; }
.cell-rules { color: var(--fg-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted-2); }

.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 9px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 600; white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.pill.ok { background: rgba(74,222,128,0.14); color: #4ade80; }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.pill.dim { background: var(--surface-strong); color: var(--fg-2); }

.chain-link { color: var(--chain); text-decoration: none; white-space: nowrap; }
.chain-link:hover { text-decoration: underline; text-underline-offset: 2px; }

.cell-actions { white-space: nowrap; text-align: right; }
.cell-actions > * + * { margin-left: 4px; }
.row-action {
  height: 24px; padding: 0 8px; border-radius: 4px;
  color: var(--muted); font-size: var(--text-sm);
  border: 1px solid transparent; transition: all 0.1s;
}
.row-action:hover:not(:disabled) { background: var(--surface-hi); color: var(--fg); border-color: var(--hairline-strong); }
.row-action:disabled { opacity: 0.6; }

.share-foot {
  display: flex; justify-content: space-between; align-items: center; gap: 16px;
  margin-top: 12px; font-size: var(--text-sm); color: var(--muted); line-height: 1.6;
}
.share-refresh { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; font-variant-numeric: tabular-nums; }

/* Empty state: the same voice as the Skill and Recap empty states */
.share-empty {
  margin-top: 28px; padding: 28px 22px;
  border: 1px dashed var(--hairline-strong); border-radius: 10px;
  background: rgba(255,255,255,0.015);
  display: flex; flex-direction: column; gap: 16px;
}
.share-empty-eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; color: var(--muted);
  display: flex; align-items: center; gap: 8px;
}
.share-empty-eyebrow .diamond { width: 6px; height: 6px; background: var(--muted-2); transform: rotate(45deg); flex-shrink: 0; }
.share-empty-title {
  font-family: 'Iowan Old Style', 'Charter', 'Source Serif Pro', Georgia, serif;
  font-size: 24px; font-weight: 500; color: var(--fg);
  letter-spacing: -0.015em; line-height: 1.35; max-width: 520px;
}
.share-empty-body { font-size: var(--text-md); color: var(--fg-2); line-height: 1.7; max-width: 600px; }
.share-empty-body code {
  font-family: var(--font-mono); font-size: 12.5px; color: var(--accent-2);
  background: var(--accent-soft); padding: 2px 8px; border-radius: 3px;
}
.share-empty-actions { display: flex; gap: 8px; margin-top: 4px; }
.share-empty-btn {
  height: 30px; padding: 0 14px; border-radius: 6px;
  font-size: var(--text-base); font-weight: 500;
  border: 1px solid rgba(167,139,250,0.35);
  color: var(--accent-2); background: var(--accent-soft);
}
.share-empty-btn:hover { background: rgba(167,139,250,0.18); border-color: var(--accent); color: var(--fg); }
</style>
