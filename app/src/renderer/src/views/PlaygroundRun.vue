<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { state } from '../store.js';
import { fmtListTime } from '../utils.js';
import { chainLabel, shortAddress } from '../skill-library.mjs';
import { LIVE_POLL_MS } from '../playground-data.js';
import {
  addressUrl,
  artifactLabel,
  commandLine,
  currentStep,
  elapsedMs,
  eventFeed,
  eventProduct,
  eventTone,
  formatClock,
  formatElapsed,
  harnessLabel,
  networkLabel,
  roleLabels,
  runArtifacts,
  runFailure,
  runStatus,
  shortHash,
  shortRunId,
  stepProgress,
  stepStatusLabel,
  txUrl,
} from '../playground.mjs';

// One Playground run (#32, docs/vision/09 G3–G5): the live page while it runs
// (progress, events, chain transactions), its key screenshots, and its
// provenance record. Every number on the page opens the list it counts.
defineOptions({ name: 'PlaygroundRun' });
const props = defineProps({ runId: { type: String, required: true } });

const run = ref(null);
const missing = ref(false);
const loadError = ref(null);
const now = ref(Date.now());

const record = computed(() => run.value?.record ?? null);
const live = computed(() => !run.value || !record.value || record.value.run.status === 'running');
const labels = computed(() => roleLabels(record.value));
const status = computed(() => (record.value ? runStatus(record.value, run.value.updatedAt, now.value) : null));
const progress = computed(() => (record.value ? stepProgress(record.value) : null));
const nowStep = computed(() => (record.value ? currentStep(record.value) : null));
const failure = computed(() => (record.value ? runFailure(record.value, run.value.events) : null));
const products = computed(() => (record.value ? runArtifacts(record.value) : null));
const chainId = computed(() => record.value?.run.network.chainId ?? null);
const stepsById = computed(() => new Map((record.value?.steps ?? []).map(step => [step.id, step])));
const roleName = id => (id ? labels.value.get(id) ?? id : '—');

// --- Loading: poll while the run is live ------------------------------------

let loadVersion = 0;
const seenSeq = ref(0);
const freshFrom = ref(Infinity);
async function load() {
  const version = ++loadVersion;
  try {
    const result = await window.obelisk.playgroundRun(props.runId);
    if (version !== loadVersion) return;
    missing.value = !result;
    loadError.value = null;
    if (result) {
      const newest = result.events.at(-1)?.seq ?? 0;
      // Rows that arrived since the last read are highlighted; the first read is not.
      freshFrom.value = seenSeq.value ? seenSeq.value + 1 : Infinity;
      seenSeq.value = newest;
    }
    run.value = result;
  } catch (error) {
    if (version === loadVersion) loadError.value = String(error?.message || error);
  }
}

let pollTimer = null;
let clockTimer = null;
function schedule() {
  clearInterval(pollTimer);
  pollTimer = live.value ? setInterval(load, LIVE_POLL_MS) : null;
}
watch(live, schedule);
clockTimer = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => {
  clearInterval(pollTimer);
  clearInterval(clockTimer);
});

// --- Sessions: link the ones this App's index has --------------------------

const indexed = ref(new Set());
const sessionIds = computed(() => (products.value?.sessions ?? []).map(entry => entry.obeliskId));
watch(() => sessionIds.value.join('\n'), async () => {
  if (!sessionIds.value.length || !window.obelisk?.getSessionsByIds) return;
  try {
    const rows = await window.obelisk.getSessionsByIds(sessionIds.value);
    indexed.value = new Set(rows.map(row => row.id));
  } catch {
    indexed.value = new Set();
  }
});
const sessionRole = session => products.value?.sessions.find(entry => entry.obeliskId === session.obeliskId)?.step.role ?? null;

// --- Events ------------------------------------------------------------------

const selectedStep = ref(null);
const feed = computed(() => eventFeed(run.value?.events ?? [], selectedStep.value));
function toggleStep(step) {
  selectedStep.value = selectedStep.value === step.id ? null : step.id;
}
function stepOf(event) {
  return event.stepId ? stepsById.value.get(event.stepId) ?? null : null;
}

// --- Screenshots -------------------------------------------------------------

const screenshots = reactive({});
const lightbox = ref(null);
watch(() => (products.value?.screenshots ?? []).map(shot => shot.file).join('\n'), async () => {
  for (const shot of products.value?.screenshots ?? []) {
    if (screenshots[shot.file]) continue;
    screenshots[shot.file] = { loading: true };
    try {
      const result = await window.obelisk.playgroundScreenshot(props.runId, shot.file);
      screenshots[shot.file] = result.ok ? { url: result.dataUrl } : { error: result.error };
    } catch (error) {
      screenshots[shot.file] = { error: String(error?.message || error) };
    }
  }
});
function closeOnEscape(event) {
  if (event.key === 'Escape') lightbox.value = null;
}
window.addEventListener('keydown', closeOnEscape);
onBeforeUnmount(() => window.removeEventListener('keydown', closeOnEscape));
function openShot(file) {
  const shot = products.value?.screenshots.find(entry => entry.file === file);
  if (shot && screenshots[file]?.url) lightbox.value = shot;
  else scrollTo('[data-section="screenshots"]');
}

// --- Provenance: every count opens the list behind it ------------------------

const open = reactive({ roles: false, tasks: false, ai: false, products: false, screenshots: false });
async function scrollTo(selector) {
  await nextTick();
  document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function showProvenance(row) {
  open[row] = true;
  scrollTo(`[data-prov="${row}"]`);
}

function skillRoute(artifact) {
  if (/^[1-9][0-9]*$/.test(artifact.ref)) return { name: 'MintedSkill', params: { skillId: artifact.ref } };
  if (state.skills.some(skill => skill.name === artifact.ref)) return { name: 'SkillDetail', params: { name: artifact.ref } };
  return null;
}

function revealRecord() {
  window.obelisk?.playgroundRevealRecord?.(props.runId);
}

watch(() => props.runId, () => {
  run.value = null;
  missing.value = false;
  seenSeq.value = 0;
  selectedStep.value = null;
  lightbox.value = null;
  for (const key of Object.keys(open)) open[key] = false;
  for (const key of Object.keys(screenshots)) delete screenshots[key];
  load().then(schedule);
}, { immediate: true });

const serviceHost = computed(() => {
  try { return new URL(record.value.run.network.serviceUrl).host; } catch { return record.value?.run.network.serviceUrl ?? null; }
});
</script>

<template>
  <div class="pg-wrap">
    <div v-if="run" class="pg-run" :data-run="run.id">
      <header class="pg-header">
        <div class="pg-heading">
          <div class="detail-eyebrow">
            <svg class="project-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="8" cy="8" r="5.5"/><path d="M6.6 5.6l3.6 2.4-3.6 2.4z"/>
            </svg>
            <span class="project-name">Playground</span>
            <span class="sep">/</span>
            <span class="mono run-id" :title="run.id">{{ shortRunId(run.id) }}</span>
            <template v-if="record">
              <span class="pill" :class="record.run.dryRun ? 'dim' : 'chain'">{{ networkLabel(record) }}</span>
              <span class="pill" :class="status.tone" data-run-status>
                <span v-if="status.key === 'running'" class="live-dot"></span>
                {{ status.label }}
                <span class="mono">{{ formatElapsed(elapsedMs(record, now)) }}</span>
              </span>
            </template>
          </div>
          <div class="detail-path">{{ record ? record.run.scenario.title : '出处记录读不出来' }}</div>
          <div v-if="record" class="detail-meta">
            <span>开始 {{ fmtListTime(record.run.startedAt) }}</span>
            <template v-if="record.run.endedAt"><span class="dot"></span><span>结束 {{ fmtListTime(record.run.endedAt) }}</span></template>
            <span class="dot"></span>
            <span>剧本 <span class="mono">{{ record.run.scenario.file }}</span></span>
            <template v-if="record.run.gitCommit"><span class="dot"></span><span>Obelisk <span class="mono">{{ record.run.gitCommit }}</span></span></template>
          </div>
        </div>
        <div class="pg-actions">
          <button class="banner-action" :disabled="!record" @click="revealRecord">在访达中显示出处记录</button>
        </div>
      </header>

      <div v-if="!record" class="detail-banner broken">
        <div class="detail-banner-body"><strong>这次运行的出处记录读不出来</strong><div>{{ run.error }}</div></div>
      </div>
      <div v-else-if="record.run.dryRun" class="detail-banner partial" data-banner="dry-run">
        <div class="detail-banner-body"><strong>空跑</strong><div>所有角色都用模拟助手：没有调用模型，也没有上链。这次运行只验证流水线，它的数据不是真实数据。</div></div>
      </div>
      <div v-if="record && status.key === 'quiet'" class="detail-banner partial" data-banner="quiet">
        <div class="detail-banner-body"><strong>已经 {{ status.label }}</strong><div>出处记录还写着"运行中"，但执行器可能已经退出。</div></div>
      </div>
      <div v-if="failure" class="detail-banner broken" data-banner="failed">
        <div class="detail-banner-body">
          <strong>{{ failure.step ? `第 ${failure.step.index + 1} 步失败：${failure.step.title}` : '运行失败' }}</strong>
          <div>{{ failure.error || '执行器没有记录原因。' }}</div>
        </div>
      </div>

      <!-- Live: progress · events · counters -->
      <div class="pg-live">
        <section v-if="record" class="pg-panel" data-panel="steps">
          <h3 class="pg-panel-title"><span>剧本进度</span><span class="count mono">{{ progress.done }} / {{ progress.total }}</span></h3>
          <ol class="steps">
            <li
              v-for="step in record.steps"
              :key="step.id"
              class="step"
              :class="[step.status, { selected: selectedStep === step.id }]"
              :data-step="step.id"
            >
              <button class="step-button" :title="selectedStep === step.id ? '显示全部事件' : '只看这一步的事件'" @click="toggleStep(step)">
                <span class="k">
                  <svg v-if="step.status === 'succeeded'" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>
                  <template v-else>{{ step.index + 1 }}</template>
                </span>
                <span class="step-body">
                  <span class="step-title">{{ step.title }}</span>
                  <span class="step-meta">
                    <span>{{ roleName(step.role) }}</span>
                    <span v-if="step.status !== 'succeeded' && step.status !== 'pending'" class="step-status">{{ stepStatusLabel(step.status) }}</span>
                    <span v-if="step.sessions.length" class="mono">{{ step.sessions.length }} session</span>
                    <span v-if="step.transactions.length" class="mono tx">{{ step.transactions.length }} 交易</span>
                    <span v-if="step.action === 'capture'" class="shot-tag">截图</span>
                  </span>
                </span>
              </button>
              <button
                v-for="shot in step.screenshots.filter(entry => screenshots[entry.file]?.url)"
                :key="shot.file"
                class="step-shot"
                :data-step-shot="shot.file"
                :title="`${shot.caption} · 点开看大图`"
                @click="openShot(shot.file)"
              >
                <img :src="screenshots[shot.file].url" :alt="shot.caption" />
                <span>{{ shot.caption }}</span>
              </button>
            </li>
          </ol>
        </section>

        <section class="pg-panel events-panel" data-panel="events">
          <h3 class="pg-panel-title">
            <span>事件 · 最新在上</span>
            <button v-if="selectedStep" class="filter-chip" data-filter @click="selectedStep = null">
              只看第 {{ stepsById.get(selectedStep).index + 1 }} 步 <span aria-hidden="true">×</span>
            </button>
            <span v-else class="count">{{ run.events.length }} 条</span>
          </h3>
          <div class="events-scroll">
            <table v-if="feed.length" class="events">
              <thead><tr><th>时间</th><th>角色</th><th>发生了什么</th><th class="product">产物</th></tr></thead>
              <tbody>
                <tr v-for="event in feed" :key="event.seq" :class="[eventTone(event), { fresh: event.seq >= freshFrom }]" :data-seq="event.seq">
                  <td class="mono time">{{ formatClock(event.at) }}</td>
                  <td class="role">{{ event.role ? roleName(event.role) : '' }}</td>
                  <td class="what">
                    {{ event.text }}
                    <span v-if="event.error" class="what-error">{{ event.error }}</span>
                    <span v-if="!selectedStep && stepOf(event) && event.type !== 'step.started'" class="what-step">第 {{ stepOf(event).index + 1 }} 步</span>
                  </td>
                  <td class="product">
                    <template v-if="eventProduct(event).kind === 'session'">
                      <router-link v-if="indexed.has(event.session.obeliskId)" class="product-link" :to="`/sessions/${encodeURIComponent(event.session.obeliskId)}`">session ↗</router-link>
                      <span v-else class="product-off" :title="`${event.session.obeliskId}\n在${roleName(event.role)}的 Obelisk 数据里（roles/${event.role}/obelisk）；用这个目录作为 OBELISK_HOME 打开 App 才能查看。`">session</span>
                    </template>
                    <template v-else-if="eventProduct(event).kind === 'transaction'">
                      <a v-if="txUrl(event.transaction.chainId ?? chainId, event.transaction.hash)" class="product-link chain" :href="txUrl(event.transaction.chainId ?? chainId, event.transaction.hash)" target="_blank" rel="noopener noreferrer" :title="event.transaction.hash">交易 ↗</a>
                      <span v-else class="product-off mono" :title="event.transaction.hash">{{ shortHash(event.transaction.hash) }}</span>
                    </template>
                    <button v-else-if="eventProduct(event).kind === 'screenshot'" class="product-link" @click="openShot(event.screenshot.file)">截图</button>
                    <span v-else-if="eventProduct(event).kind === 'exit'" class="product-warn mono">退出码 {{ event.exitCode }}</span>
                    <span v-else-if="eventProduct(event).kind === 'failed'" class="product-warn">失败</span>
                    <span v-else class="product-off">本机</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="pg-empty-line">{{ selectedStep ? '这一步还没有事件。' : '还没有事件。执行器写下第一条事件后，这里会实时更新。' }}</p>
          </div>
          <p v-if="run.skipped || run.truncated" class="note">
            <template v-if="run.truncated">只显示最近的事件。</template>
            <template v-if="run.skipped">另有 {{ run.skipped }} 行不是有效的事件，没有显示。</template>
          </p>
        </section>

        <section v-if="record" class="pg-panel" data-panel="totals">
          <h3 class="pg-panel-title">本次运行</h3>
          <button class="counter" data-count="roles" @click="showProvenance('roles')"><span class="note">模拟用户</span><span class="big">{{ record.totals.roles }}</span></button>
          <button class="counter" data-count="sessions" @click="showProvenance('products')"><span class="note">产生的 session</span><span class="big">{{ record.totals.sessions }}</span></button>
          <button class="counter" data-count="commands" @click="showProvenance('products')"><span class="note">Obelisk 命令</span><span class="big">{{ record.totals.commands }}</span></button>
          <button class="counter" data-count="transactions" @click="showProvenance('products')"><span class="note">链上交易</span><span class="big">{{ record.totals.transactions }}</span></button>
          <button class="counter" data-count="screenshots" @click="scrollTo('[data-section=&quot;screenshots&quot;]')"><span class="note">关键截图</span><span class="big">{{ record.totals.screenshots }}</span></button>
        </section>
      </div>

      <template v-if="record">
        <!-- Key screenshots -->
        <section class="pg-section" data-section="screenshots">
          <div class="detail-section-divider"><span>关键截图</span><span class="count">{{ products.screenshots.length }}</span></div>
          <div v-if="products.screenshots.length" class="shots">
            <figure v-for="shot in products.screenshots" :key="shot.file" class="shot" :data-shot="shot.file">
              <button class="shot-pic" :disabled="!screenshots[shot.file]?.url" @click="openShot(shot.file)">
                <img v-if="screenshots[shot.file]?.url" :src="screenshots[shot.file].url" :alt="shot.caption" />
                <span v-else-if="screenshots[shot.file]?.error" class="shot-missing">截图文件读不出来</span>
                <span v-else class="shot-missing">读取中…</span>
              </button>
              <figcaption>
                <span class="shot-caption">{{ shot.caption }}</span>
                <button class="shot-step" @click="toggleStep(shot.step); scrollTo('[data-panel=&quot;events&quot;]')">第 {{ shot.step.index + 1 }} 步 · {{ roleName(shot.step.role) }}</button>
              </figcaption>
            </figure>
          </div>
          <p v-else class="pg-empty-line">{{ live ? '剧本标记的步骤完成时会自动截图，截好的画面出现在这里。' : '这次运行没有截图。' }}</p>
        </section>

        <!-- Provenance record -->
        <section class="pg-section" data-section="provenance">
          <div class="detail-section-divider"><span>出处记录</span><span class="count">每次运行自动生成</span></div>
          <table class="prov">
            <tbody>
              <tr data-prov="run">
                <th>运行</th>
                <td>
                  <span class="mono">{{ run.id }}</span> · {{ fmtListTime(record.run.startedAt) }} 开始{{ record.run.endedAt ? ` · ${fmtListTime(record.run.endedAt)} 结束` : ' · 仍在运行' }}
                  · 剧本「{{ record.run.scenario.title }}」<span class="mono muted" :title="record.run.scenario.sha256">{{ record.run.scenario.file }} · sha256 {{ record.run.scenario.sha256.slice(0, 8) }}</span>
                  <div class="prov-sub">
                    {{ record.run.network.chainId ? chainLabel(record.run.network.chainId) : '没有连接链' }}<template v-if="serviceHost"> · 在线服务 <span class="mono">{{ serviceHost }}</span></template>
                  </div>
                </td>
              </tr>
              <tr data-prov="roles">
                <th>模拟用户</th>
                <td>
                  {{ record.roles.length }} 个钱包 · <button class="prov-toggle" @click="open.roles = !open.roles">{{ open.roles ? '收起' : '查看地址列表' }}</button>
                  <table v-if="open.roles" class="prov-list">
                    <tr v-for="role in record.roles" :key="role.id">
                      <td>{{ role.label }}</td>
                      <td class="mono">
                        <template v-if="role.wallet">
                          <a v-if="addressUrl(chainId, role.wallet)" class="chain-link" :href="addressUrl(chainId, role.wallet)" target="_blank" rel="noopener noreferrer" :title="role.wallet">{{ shortAddress(role.wallet) }} ↗</a>
                          <span v-else :title="role.wallet">{{ shortAddress(role.wallet) }}</span>
                        </template>
                        <span v-else class="muted">还没有钱包</span>
                      </td>
                      <td class="muted">{{ harnessLabel(role.harness.kind) }}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr data-prov="tasks">
                <th>任务</th>
                <td>
                  {{ products.tasks.length }} 个任务，覆盖 {{ products.scenes.length }} 个场景 ·
                  <button class="prov-toggle" @click="open.tasks = !open.tasks">{{ open.tasks ? '收起' : '查看任务清单' }}</button>
                  <ul v-if="open.tasks" class="prov-items">
                    <li v-for="task in products.tasks" :key="task.id">
                      <span class="task-title">{{ task.title }}</span>
                      <span class="muted">第 {{ task.index + 1 }} 步 · {{ roleName(task.role) }}</span>
                      <span class="scene-tags">
                        <span v-for="scene in task.scenes" :key="scene.tag || scene.label" class="scene-tag" :class="scene.kind" :title="scene.tag">{{ scene.label }}</span>
                      </span>
                    </li>
                  </ul>
                </td>
              </tr>
              <tr data-prov="ai">
                <th>AI 运行</th>
                <td>
                  <div v-for="(harness, i) in products.harnesses" :key="i" class="harness">
                    <span class="harness-name">{{ harnessLabel(harness.kind) }}</span>
                    <span v-if="harness.model" class="mono">{{ harness.model }}</span>
                    <span v-if="harness.version" class="mono muted">{{ harness.version }}</span>
                    <span class="muted">{{ harness.roles.join('、') }}</span>
                  </div>
                  <button v-if="products.prompts.length" class="prov-toggle" @click="open.ai = !open.ai">{{ open.ai ? '收起' : `查看 ${products.prompts.length} 条 prompt` }}</button>
                  <ul v-if="open.ai" class="prov-items">
                    <li v-for="step in products.prompts" :key="step.id">
                      <span class="muted">第 {{ step.index + 1 }} 步 · {{ roleName(step.role) }} · {{ harnessLabel(step.harness?.kind) }}<template v-if="step.harness?.model"> · <span class="mono">{{ step.harness.model }}</span></template><template v-if="step.harness?.maxTurns"> · 最多 {{ step.harness.maxTurns }} 轮</template></span>
                      <div class="prompt">{{ step.prompt }}</div>
                    </li>
                  </ul>
                </td>
              </tr>
              <tr data-prov="products">
                <th>产物</th>
                <td>
                  {{ products.sessions.length }} 个 session · {{ products.artifacts.length }} 个 Obelisk 产物 · {{ products.transactions.length }} 笔链上交易 · {{ products.commands.length }} 条 Obelisk 命令 ·
                  <button class="prov-toggle" @click="open.products = !open.products">{{ open.products ? '收起' : '逐条查看' }}</button>
                  <div v-if="open.products" class="prov-groups">
                    <div class="prov-group" data-group="sessions">
                      <h4>session</h4>
                      <p v-if="!products.sessions.length" class="muted">还没有。</p>
                      <div v-for="entry in products.sessions" :key="entry.obeliskId" class="prov-row">
                        <span class="muted">第 {{ entry.step.index + 1 }} 步 · {{ roleName(entry.step.role) }} · {{ entry.source }}</span>
                        <router-link v-if="indexed.has(entry.obeliskId)" class="mono product-link" :to="`/sessions/${encodeURIComponent(entry.obeliskId)}`">{{ entry.obeliskId }} ↗</router-link>
                        <span v-else class="mono" :title="`在${roleName(entry.step.role)}的 Obelisk 数据里（roles/${entry.step.role}/obelisk）`">{{ entry.obeliskId }}</span>
                      </div>
                    </div>
                    <div class="prov-group" data-group="artifacts">
                      <h4>Obelisk 产物</h4>
                      <p v-if="!products.artifacts.length" class="muted">还没有。</p>
                      <div v-for="(entry, i) in products.artifacts" :key="i" class="prov-row">
                        <span class="muted">第 {{ entry.step.index + 1 }} 步 · {{ roleName(entry.step.role) }} · {{ artifactLabel(entry.kind) }}</span>
                        <router-link v-if="skillRoute(entry)" class="mono product-link" :to="skillRoute(entry)">{{ /^\d+$/.test(entry.ref) ? `Skill #${entry.ref}` : entry.ref }} ↗</router-link>
                        <span v-else class="mono" :title="entry.ref">{{ entry.ref.length > 40 ? shortHash(entry.ref) : entry.ref }}</span>
                      </div>
                    </div>
                    <div class="prov-group" data-group="transactions">
                      <h4>链上交易</h4>
                      <p v-if="!products.transactions.length" class="muted">还没有。</p>
                      <div v-for="entry in products.transactions" :key="entry.hash" class="prov-row">
                        <span class="muted">第 {{ entry.step.index + 1 }} 步 · {{ roleName(entry.step.role) }} · <span class="mono">obelisk {{ entry.command }}</span></span>
                        <a v-if="txUrl(entry.chainId ?? chainId, entry.hash)" class="mono chain-link" :href="txUrl(entry.chainId ?? chainId, entry.hash)" target="_blank" rel="noopener noreferrer" :title="entry.hash">{{ shortHash(entry.hash) }} ↗</a>
                        <span v-else class="mono" :title="entry.hash">{{ shortHash(entry.hash) }}</span>
                      </div>
                    </div>
                    <div class="prov-group" data-group="commands">
                      <h4>Obelisk 命令</h4>
                      <p v-if="!products.commands.length" class="muted">还没有。</p>
                      <div v-for="(entry, i) in products.commands" :key="i" class="prov-row">
                        <span class="muted">第 {{ entry.step.index + 1 }} 步 · {{ roleName(entry.step.role) }}</span>
                        <span class="mono command" :title="['obelisk', ...entry.argv].join(' ')">{{ commandLine(entry) }}</span>
                        <span v-if="entry.exitCode !== 0" class="product-warn mono">退出码 {{ entry.exitCode }}</span>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
              <tr data-prov="screenshots">
                <th>截图</th>
                <td>
                  {{ products.screenshots.length }} 张，与剧本步骤对应
                  <template v-if="products.screenshots.length"> · <button class="prov-toggle" @click="scrollTo('[data-section=&quot;screenshots&quot;]')">查看</button></template>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="note">出处记录只保存 id、地址和哈希，不保存对话内容和命令输出。文件是这次运行目录里的 <span class="mono">provenance.json</span>，可以和它说明的数据一起导出。</p>
        </section>
      </template>

      <p class="pg-source">
        <template v-if="live">运行中每 {{ LIVE_POLL_MS / 1000 }} 秒刷新</template>
        <template v-else>运行已结束</template>
        <button class="source-toggle" @click="load">刷新</button>
      </p>
    </div>

    <div v-else-if="missing" class="empty">
      没有这次运行：<span class="mono">{{ runId }}</span>
      <span class="hint"><router-link to="/playground">返回 Playground</router-link></span>
    </div>
    <div v-else-if="loadError" class="empty">{{ loadError }}</div>
    <div v-else class="empty">正在读取运行记录…</div>

    <div v-if="lightbox" class="lightbox" role="dialog" aria-modal="true" @click="lightbox = null">
      <figure @click.stop>
        <img :src="screenshots[lightbox.file]?.url" :alt="lightbox.caption" />
        <figcaption>{{ lightbox.caption }} · 第 {{ lightbox.step.index + 1 }} 步 · {{ roleName(lightbox.step.role) }}</figcaption>
      </figure>
      <button class="lightbox-close" aria-label="关闭" @click="lightbox = null">×</button>
    </div>
  </div>
</template>

<style scoped>
.pg-wrap { flex: 1; overflow-y: auto; min-height: 0; position: relative; }
.pg-run {
  max-width: 1240px; margin: 0 auto; padding: 28px 32px 60px;
  display: flex; flex-direction: column; gap: 16px; container-type: inline-size;
}
.mono { font-family: var(--font-mono); }
.muted { color: var(--muted); }
.note { font-size: var(--text-sm); color: var(--muted); line-height: 1.5; margin-top: 8px; }

.pg-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.pg-heading { min-width: 0; }
.pg-heading .detail-eyebrow { flex-wrap: wrap; }
.pg-heading .detail-eyebrow .project-icon { color: var(--accent-2); }
.pg-heading .detail-path { margin-bottom: 10px; }
.pg-heading .detail-meta { border-bottom: 0; padding-bottom: 0; font-family: var(--font-sans); }
.pg-heading .detail-meta .mono { font-size: 11.5px; }
.run-id { font-size: 12px; color: var(--fg-2); }
.pg-actions { padding-top: 26px; flex-shrink: 0; }
.pg-header + .detail-banner, .detail-banner { margin-bottom: 0; }

.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 1px 9px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 500; line-height: 1.6; white-space: nowrap;
}
.pill .mono { font-size: 11px; font-variant-numeric: tabular-nums; }
.pill.chain { background: var(--chain-soft); color: var(--chain); }
.pill.dim { background: var(--surface-strong); color: var(--fg-2); }
.pill.live, .pill.ok { background: rgba(74,222,128,0.12); color: #4ade80; }
.pill.danger { background: var(--danger-soft); color: var(--danger); }
.pill.warn { background: var(--warn-soft); color: var(--warn); }
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pg-blink 1.4s ease-in-out infinite; }
@keyframes pg-blink { 50% { opacity: 0.35; } }

.pg-live { display: grid; grid-template-columns: 270px minmax(0, 1fr) 168px; gap: 16px; align-items: start; }
@container (max-width: 980px) {
  .pg-live { grid-template-columns: minmax(0, 1fr); }
  [data-panel="totals"] { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  [data-panel="totals"] .pg-panel-title { grid-column: 1 / -1; margin-bottom: 0; }
}
.pg-panel { padding: 16px 16px 14px; border: 1px solid var(--hairline); border-radius: 10px; background: rgba(255,255,255,0.02); min-width: 0; }
.pg-panel-title { display: flex; align-items: center; gap: 8px; font-size: var(--text-base); font-weight: 600; color: var(--fg-2); margin-bottom: 12px; }
.pg-panel-title .count { margin-left: auto; font-size: var(--text-sm); font-weight: 400; color: var(--muted); }

/* Script progress */
.steps { list-style: none; display: flex; flex-direction: column; gap: 2px; }
.step-button {
  display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; width: 100%;
  padding: 7px 8px; border-radius: 7px; text-align: left; font: inherit; color: inherit;
  transition: background 0.1s;
}
.step-button:hover { background: var(--surface-strong); }
.step.selected .step-button { background: var(--accent-soft); }
.k {
  width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center;
  font-family: var(--font-mono); font-size: 11px; color: var(--muted);
  border: 1px solid var(--hairline-strong);
}
.k svg { width: 12px; height: 12px; }
.step.succeeded .k { background: rgba(74,222,128,0.12); border-color: transparent; color: #4ade80; }
.step.running .k { background: var(--accent); border-color: var(--accent); color: #140f26; font-weight: 700; box-shadow: 0 0 0 4px var(--accent-soft); }
.step.failed .k { background: var(--danger-soft); border-color: transparent; color: var(--danger); }
.step.skipped .k { border-style: dashed; }
.step-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.step-title { font-size: var(--text-base); color: var(--fg-2); line-height: 1.45; }
.step.running .step-title { color: var(--fg); font-weight: 600; }
.step.pending .step-title, .step.skipped .step-title { color: var(--muted); }
.step-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; font-size: 11px; color: var(--muted); }
.step-meta .mono { font-size: 10.5px; }
.step-meta .tx { color: var(--chain); }
.step-status { color: var(--accent-2); }
.shot-tag { color: var(--accent-2); }
.step-shot {
  display: flex; align-items: center; gap: 8px; width: calc(100% - 40px); margin: 2px 0 6px 40px;
  padding: 4px; border-radius: 6px; border: 1px solid var(--hairline); background: rgba(255,255,255,0.02);
  text-align: left; font: inherit; font-size: 11px; color: var(--fg-2); transition: border-color 0.1s, background 0.1s;
}
.step-shot:hover { border-color: var(--hairline-strong); background: var(--surface-strong); }
.step-shot img { width: 64px; height: 40px; object-fit: cover; object-position: top left; border-radius: 4px; flex-shrink: 0; }
.step-shot span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step.failed .step-status { color: var(--danger); }
.step.skipped .step-status { color: var(--muted); }

/* Events */
.filter-chip {
  margin-left: auto; display: inline-flex; gap: 6px; align-items: center;
  padding: 1px 10px; border-radius: 999px; font-size: var(--text-sm); font-weight: 500;
  background: var(--accent-soft); color: var(--accent-2);
}
.events-scroll { max-height: 520px; overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
.events { width: 100%; border-collapse: collapse; font-size: var(--text-base); }
.events th { position: sticky; top: 0; background: var(--bg-2); text-align: left; color: var(--muted); font-weight: 500; font-size: var(--text-sm); padding: 6px 8px; border-bottom: 1px solid var(--hairline); z-index: 1; }
.events td { padding: 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; color: var(--fg-2); line-height: 1.5; }
.events tr:last-child td { border-bottom: 0; }
.events .time { font-size: 11.5px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.events .role { white-space: nowrap; color: var(--fg); }
.events .what { color: var(--fg-2); }
.events .product { text-align: right; white-space: nowrap; }
.events tr.milestone td.what { color: var(--fg); font-weight: 500; }
.events tr.danger td.what { color: var(--danger); }
.events tr.fresh td { animation: pg-fresh 2.4s ease-out; }
@keyframes pg-fresh { from { background: var(--accent-soft); } to { background: transparent; } }
.what-step { margin-left: 6px; font-size: 11px; color: var(--muted-2); white-space: nowrap; }
.what-error { display: block; font-size: var(--text-sm); color: var(--danger); }
.product-link { color: var(--accent-2); text-decoration: none; font: inherit; font-size: var(--text-sm); }
.product-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.product-link.chain, .chain-link { color: var(--chain); text-decoration: none; }
.chain-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.product-off { font-size: var(--text-sm); color: var(--muted); }
.product-off.mono { font-size: 11px; }
.product-warn { font-size: var(--text-sm); color: var(--warn); }
.product-warn.mono { font-size: 11px; }
.pg-empty-line { font-size: var(--text-base); color: var(--muted); line-height: 1.6; }

/* Counters */
.counter {
  display: flex; flex-direction: column; align-items: flex-start; gap: 0; width: 100%;
  padding: 6px 8px; margin: 0 -8px 2px; border-radius: 8px; text-align: left; font: inherit; color: inherit;
  transition: background 0.1s; box-sizing: content-box;
}
.counter:hover { background: var(--surface-strong); }
.counter .note { margin-top: 0; }
.big { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg); font-variant-numeric: tabular-nums; line-height: 1.2; }
.counter:hover .big { color: var(--accent-2); }

/* Screenshots */
.pg-section .detail-section-divider { margin-top: 12px; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
.shot { margin: 0; border: 1px solid var(--hairline); border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.02); }
.shot-pic { display: grid; place-items: center; width: 100%; aspect-ratio: 16 / 10; background: rgba(0,0,0,0.3); overflow: hidden; }
.shot-pic img { width: 100%; height: 100%; object-fit: cover; object-position: top left; transition: transform 0.2s; }
.shot-pic:not(:disabled):hover img { transform: scale(1.02); }
.shot-missing { font-size: var(--text-sm); color: var(--muted); }
.shot figcaption { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; }
.shot-caption { font-size: var(--text-base); color: var(--fg); }
.shot-step { align-self: flex-start; font: inherit; font-size: var(--text-sm); color: var(--muted); }
.shot-step:hover { color: var(--accent-2); }

/* Provenance */
.prov { width: 100%; border-collapse: collapse; font-size: var(--text-base); border: 1px solid var(--hairline); border-radius: 10px; }
.prov > tbody > tr > th { width: 92px; text-align: left; vertical-align: top; color: var(--muted); font-weight: 500; font-size: var(--text-sm); padding: 12px 14px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
.prov > tbody > tr > td { padding: 11px 14px; border-bottom: 1px solid var(--hairline); color: var(--fg-2); line-height: 1.6; }
.prov > tbody > tr:last-child > th, .prov > tbody > tr:last-child > td { border-bottom: 0; }
.prov .mono { font-size: 11.5px; }
.prov-sub { font-size: var(--text-sm); color: var(--muted); }
.prov-toggle { font: inherit; color: var(--accent-2); }
.prov-toggle:hover { text-decoration: underline; text-underline-offset: 2px; }
.prov-list { margin-top: 8px; border-collapse: collapse; font-size: var(--text-sm); }
.prov-list td { padding: 4px 18px 4px 0; }
.prov-items { list-style: none; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; font-size: var(--text-sm); }
.prompt { margin-top: 3px; padding: 6px 10px; border-radius: 6px; background: var(--user-bubble); border: 1px solid var(--user-bubble-border); color: var(--fg); white-space: pre-wrap; word-break: break-word; }
.harness { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
.harness-name { color: var(--fg); min-width: 84px; }
.prov-items li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.prov-items li .prompt { flex-basis: 100%; }
.task-title { color: var(--fg); }
.prov-groups { margin-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; }
@container (max-width: 820px) { .prov-groups { grid-template-columns: minmax(0, 1fr); } }
.prov-group h4 { font-size: var(--text-sm); font-weight: 600; color: var(--fg-2); margin-bottom: 4px; }
.prov-group .muted { font-size: var(--text-sm); }
.prov-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; padding: 3px 0; font-size: var(--text-sm); }
.prov-row .mono { font-size: 11px; word-break: break-all; }
.prov-row .command { color: var(--fg); }
.scene-tags { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; vertical-align: middle; }
.scene-tag { padding: 0 8px; border-radius: 999px; font-size: 11px; line-height: 1.7; background: var(--accent-soft); color: var(--accent-2); }
.scene-tag.user { background: transparent; border: 1px dashed rgba(167,139,250,0.45); color: var(--fg-2); }
.scene-tag.unknown { background: var(--surface-strong); color: var(--muted); }

.pg-source { display: flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--muted); }
.empty .hint { margin-left: 8px; }
.empty .hint a { color: var(--accent-2); text-decoration: none; }

.lightbox {
  position: fixed; inset: 0; z-index: 50; display: grid; place-items: center;
  background: rgba(5,6,12,0.82); backdrop-filter: blur(6px); padding: 40px;
}
.lightbox figure { margin: 0; max-width: min(1200px, 100%); max-height: 100%; display: flex; flex-direction: column; gap: 10px; }
.lightbox img { max-width: 100%; max-height: calc(100vh - 140px); object-fit: contain; border-radius: 8px; border: 1px solid var(--hairline-strong); }
.lightbox figcaption { font-size: var(--text-base); color: var(--fg-2); text-align: center; }
.lightbox-close { position: absolute; top: 16px; right: 20px; font-size: 22px; color: var(--fg-2); width: 32px; height: 32px; border-radius: 50%; }
.lightbox-close:hover { background: var(--surface-strong); }
</style>
