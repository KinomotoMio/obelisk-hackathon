<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fmtListTime } from '../utils.js';
import { LIST_POLL_MS, loadPlaygroundRuns, playgroundState } from '../playground-data.js';
import { currentStep, elapsedMs, formatElapsed, networkLabel, runStatus, shortRunId, stepProgress } from '../playground.mjs';

// Every Playground run (#32): the one running now first, then past runs, each
// opening its live page and provenance record.
defineOptions({ name: 'PlaygroundList' });

const router = useRouter();
const now = ref(Date.now());

const running = computed(() => playgroundState.runs.filter(run => run.record?.run.status === 'running'));
const past = computed(() => playgroundState.runs.filter(run => run.record?.run.status !== 'running'));
const sections = computed(() => [
  { key: 'running', title: '运行中', runs: running.value },
  { key: 'past', title: '过去的运行', runs: past.value },
].filter(section => section.runs.length));

function openRun(run) {
  router.push({ name: 'PlaygroundRun', params: { runId: run.id } });
}

function failureOf(run) {
  return run.record.steps.find(step => step.status === 'failed')?.error ?? null;
}

let pollTimer = null;
let clockTimer = null;
onMounted(() => {
  loadPlaygroundRuns();
  pollTimer = setInterval(loadPlaygroundRuns, LIST_POLL_MS);
  clockTimer = setInterval(() => { now.value = Date.now(); }, 1000);
});
onBeforeUnmount(() => {
  clearInterval(pollTimer);
  clearInterval(clockTimer);
});
</script>

<template>
  <div class="pg-wrap">
    <div class="pg-list">
      <p class="pg-lead">
        模拟用户在本机走 Obelisk 的真实流程。每次运行都留下一份出处记录：哪个角色、用哪个 AI 编程助手和模型、产生了哪些 session 和链上交易。
      </p>

      <div v-if="playgroundState.error" class="detail-banner broken">
        <div class="detail-banner-body"><strong>运行记录读取失败</strong><div>{{ playgroundState.error }}</div></div>
      </div>

      <div v-if="playgroundState.loaded && !playgroundState.configured" class="pg-empty" data-empty="off">
        <div class="pg-empty-eyebrow"><span class="diamond"></span><span>还没有 Playground 运行</span></div>
        <div class="pg-empty-body">
          Playground 执行器把运行记录写在 <code>~/.obelisk-hackathon/playground</code>（或环境变量 <code>OBELISK_PLAYGROUND_HOME</code> 指定的目录）。
          第一次运行剧本后，这里会出现它的实时页面和出处记录。
        </div>
      </div>

      <section v-for="section in sections" :key="section.key" class="pg-section" :data-section="section.key">
        <div class="detail-section-divider"><span>{{ section.title }}</span><span class="count">{{ section.runs.length }}</span></div>
        <div class="pg-cards">
          <div
            v-for="run in section.runs"
            :key="run.id"
            class="pg-card"
            :data-run="run.id"
            role="link"
            tabindex="0"
            @click="openRun(run)"
            @keydown.enter="openRun(run)"
          >
            <template v-if="run.record">
              <span class="pg-dot" :class="runStatus(run.record, run.updatedAt, now).tone"></span>
              <div class="pg-card-main">
                <div class="pg-card-title">
                  <span class="pg-name">{{ run.record.run.scenario.title }}</span>
                  <span class="pill" :class="run.record.run.dryRun ? 'dim' : 'chain'">{{ networkLabel(run.record) }}</span>
                  <span class="pill" :class="runStatus(run.record, run.updatedAt, now).tone">
                    {{ runStatus(run.record, run.updatedAt, now).label }}<template v-if="run.record.run.status === 'running'"> · {{ formatElapsed(elapsedMs(run.record, now)) }}</template>
                  </span>
                </div>
                <div v-if="currentStep(run.record)" class="pg-card-now">
                  第 {{ currentStep(run.record).index + 1 }} 步 · {{ currentStep(run.record).title }}
                </div>
                <div v-else-if="failureOf(run)" class="pg-card-now failed">{{ failureOf(run) }}</div>
                <div class="pg-card-meta">
                  <span>{{ stepProgress(run.record).done }} / {{ stepProgress(run.record).total }} 步</span>
                  <span class="dot"></span>
                  <span>{{ run.record.totals.roles }} 个模拟用户</span>
                  <span class="dot"></span>
                  <span>{{ run.record.totals.sessions }} 个 session</span>
                  <span class="dot"></span>
                  <span>{{ run.record.totals.transactions }} 笔链上交易</span>
                  <template v-if="run.record.run.status !== 'running'">
                    <span class="dot"></span>
                    <span>用时 <span class="mono">{{ formatElapsed(elapsedMs(run.record, now)) }}</span></span>
                  </template>
                </div>
              </div>
              <div class="pg-card-right">
                <span class="pg-card-time" :title="run.id">{{ fmtListTime(run.record.run.startedAt) }}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
              </div>
            </template>
            <template v-else>
              <span class="pg-dot danger"></span>
              <div class="pg-card-main">
                <div class="pg-card-title"><span class="pg-name mono">{{ shortRunId(run.id) }}</span><span class="pill danger">出处记录读不出来</span></div>
                <div class="pg-card-now failed">{{ run.error }}</div>
              </div>
              <div class="pg-card-right">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>
              </div>
            </template>
          </div>
        </div>
      </section>

      <div v-if="playgroundState.loaded && playgroundState.configured && !playgroundState.runs.length" class="pg-empty" data-empty="none">
        <div class="pg-empty-eyebrow"><span class="diamond"></span><span>还没有运行</span></div>
        <div class="pg-empty-title">让模拟用户走一遍真实流程，数据从这里开始有出处。</div>
        <div class="pg-empty-body">
          Playground 执行器按剧本运行时，会把进度、事件、关键截图和出处记录写到 <code>{{ playgroundState.dir }}/runs/</code>，这里会实时显示。
        </div>
      </div>

      <p v-if="playgroundState.configured" class="pg-source">
        运行记录来自 <span class="mono">{{ playgroundState.dir }}</span> · 每 {{ LIST_POLL_MS / 1000 }} 秒刷新
      </p>
    </div>
  </div>
</template>

<style scoped>
.pg-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.pg-list { max-width: 860px; margin: 0 auto; padding: 20px 32px 80px; }
.mono { font-family: var(--font-mono); }
.pg-lead { font-size: var(--text-base); color: var(--fg-2); line-height: 1.65; max-width: 640px; }
.pg-section .detail-section-divider { margin-top: 28px; }
.pg-cards { display: flex; flex-direction: column; gap: 10px; }

.pg-card {
  display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--hairline); border-radius: 8px; background: rgba(255,255,255,0.02);
  cursor: pointer; transition: background 0.12s, border-color 0.12s, transform 0.12s;
}
.pg-card:hover, .pg-card:focus-visible { background: rgba(255,255,255,0.035); border-color: var(--hairline-strong); outline: none; transform: translateX(2px); }
.pg-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted-2); align-self: start; margin-top: 7px; }
.pg-dot.live { background: #4ade80; box-shadow: 0 0 0 3px rgba(74,222,128,0.16); animation: pg-pulse 1.6s ease-in-out infinite; }
.pg-dot.ok { background: #4ade80; }
.pg-dot.danger { background: var(--danger); }
.pg-dot.warn { background: var(--warn); }
@keyframes pg-pulse { 50% { box-shadow: 0 0 0 6px rgba(74,222,128,0.04); } }

.pg-card-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pg-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.pg-name { font-size: var(--text-md); font-weight: 600; color: var(--fg); }
.pg-name.mono { font-weight: 500; font-size: 13px; }
.pg-card-now { font-size: var(--text-base); color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pg-card-now.failed { color: var(--danger); }
.pg-card-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: var(--text-sm); color: var(--muted); font-variant-numeric: tabular-nums; }
.pg-card-meta .dot { width: 2px; height: 2px; background: var(--muted-2); border-radius: 50%; }
.pg-card-meta .mono { font-size: 11px; }
.pg-card-right { display: flex; align-items: center; gap: 10px; color: var(--muted-2); }
.pg-card:hover .pg-card-right { color: var(--fg-2); }
.pg-card-time { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.pg-card-right svg { width: 14px; height: 14px; }

.pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 500; line-height: 1.6; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.pill.chain { background: var(--chain-soft); color: var(--chain); }
.pill.dim { background: var(--surface-strong); color: var(--fg-2); }
.pill.live, .pill.ok { background: rgba(74,222,128,0.12); color: #4ade80; }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }

.pg-empty {
  margin-top: 32px; padding: 26px 22px;
  border: 1px dashed var(--hairline-strong); border-radius: 10px; background: rgba(255,255,255,0.015);
  display: flex; flex-direction: column; gap: 14px;
}
.pg-empty-eyebrow { font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.pg-empty-eyebrow .diamond { width: 6px; height: 6px; background: var(--muted-2); transform: rotate(45deg); }
.pg-empty-title {
  font-family: 'Iowan Old Style', 'Charter', 'Source Serif Pro', Georgia, serif;
  font-size: 22px; font-weight: 500; color: var(--fg); letter-spacing: -0.015em; line-height: 1.35; max-width: 560px;
}
.pg-empty-body { font-size: var(--text-md); color: var(--fg-2); line-height: 1.7; max-width: 600px; }
.pg-empty-body code { font-family: var(--font-mono); font-size: 12px; color: var(--accent-2); background: var(--accent-soft); padding: 1px 6px; border-radius: 3px; }
.pg-source { margin-top: 28px; font-size: var(--text-sm); color: var(--muted); }
</style>
