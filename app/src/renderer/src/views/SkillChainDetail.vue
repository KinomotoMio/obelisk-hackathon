<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { state } from '../store.js';
import { fmtListTime } from '../utils.js';
import {
  chainLabel,
  formatShortDate,
  lineageRows,
  localMintOf,
  percent,
  shortAddress,
  shortFingerprint,
  trendPoints,
  versionLabel,
} from '../skill-library.mjs';
import { derivePrompt, fetchPrompt } from '../skill-prompts.mjs';
import PromptCopyButton from '../components/PromptCopyButton.vue';

// A minted Skill as anyone sees it (#19, mockups/skill-detail.html 画面 2):
// real usage reported on chain, the scenes it is used in, its versions, and
// its family tree. Everything comes from the main process (skills:chain-detail).
defineOptions({ name: 'SkillChainDetail' });
const props = defineProps({ skillId: { type: String, required: true } });

const router = useRouter();
const skill = ref(null);
const error = ref(null);
const loading = ref(false);

let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  loading.value = true;
  try {
    const result = await window.obelisk.skillsChainDetail(props.skillId);
    if (version !== loadVersion) return;
    skill.value = result.ok ? result.skill : null;
    error.value = result.ok ? null : result.error;
  } catch (failure) {
    if (version !== loadVersion) return;
    skill.value = null;
    error.value = { code: 'error', message: String(failure?.message || failure) };
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

watch(() => props.skillId, () => {
  skill.value = null;
  error.value = null;
  load();
}, { immediate: true });

const usage = computed(() => skill.value?.usage ?? null);
const results = computed(() => usage.value?.results ?? null);
const local = computed(() => (skill.value ? localMintOf(state.skills, skill.value.chainId, skill.value.skillId) : null));
const title = computed(() => skill.value?.name || `Skill #${skill.value?.skillId}`);
const promptSkill = computed(() => ({ skillId: skill.value.skillId, name: skill.value.name }));
const authorUrl = computed(() => (skill.value?.explorerUrl ? `${skill.value.explorerUrl}/address/${skill.value.author}` : null));
const serviceHost = computed(() => {
  try { return new URL(skill.value.serviceUrl).host; } catch { return skill.value?.serviceUrl ?? ''; }
});

// Scene and outcome buckets are filled by #25; until a report carries them
// the page says so instead of showing zeros as if they were measured.
const outcomesOn = computed(() => Boolean(usage.value?.outcomesReported));
const scenesOn = computed(() => Boolean(usage.value?.scenes.length));
const sceneTotal = computed(() => usage.value?.scenes.reduce((sum, scene) => sum + scene.invocations, 0) ?? 0);
const topScene = computed(() => usage.value?.scenes[0] ?? null);

const TREND = { width: 800, height: 110, pad: 14 };
const trend = computed(() => trendPoints(usage.value?.trend.weeks ?? [], TREND));
const trendLine = computed(() => trend.value.map(point => `${point.x},${point.y}`).join(' '));
const trendQuiet = computed(() => trend.value.every(point => point.invocations === 0));

const lineage = computed(() => (skill.value?.lineage ? lineageRows(skill.value.lineage.nodes) : []));
const versions = computed(() => [...(usage.value?.versions ?? [])].sort((a, b) => b.index - a.index));

function sceneName(scene) {
  return scene.label || '未命名的新标签';
}

function openSkill(skillId) {
  if (skillId !== skill.value?.skillId) router.push({ name: 'MintedSkill', params: { skillId } });
}

function errorText(failure) {
  if (failure.code === 'unknown_skill') return `链上没有 Skill #${props.skillId}。`;
  if (failure.code === 'invalid_skill_id') return 'Skill 编号是一个正整数。';
  if (failure.code === 'unreachable') return `连不上 Obelisk 在线服务。${failure.message}`;
  return failure.message;
}
</script>

<template>
  <div class="skill-wrap">
    <div v-if="skill" class="minted-detail" :data-skill-id="skill.skillId">
      <header class="minted-header">
        <div class="minted-heading">
          <div class="detail-eyebrow">
            <svg class="project-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M4.5 2.5h7L14 6l-6 7.5L2 6z"/><path d="M2 6h12M6.5 2.5L5.5 6 8 13.5 10.5 6l-1-3.5"/>
            </svg>
            <span class="project-name">Skill #{{ skill.skillId }}</span>
            <span class="sep">/</span>
            <span class="pill version">{{ versionLabel(skill.version.index) }}</span>
            <span class="pill chain"><span class="dot"></span>已铸造 · {{ chainLabel(skill.chainId) }}</span>
            <span v-if="local" class="pill mine">我的 Skill</span>
          </div>
          <div class="detail-path">{{ title }}</div>
          <div class="detail-meta">
            <span>作者
              <a v-if="authorUrl" class="chain-link mono" :href="authorUrl" target="_blank" rel="noopener noreferrer" :title="skill.author">{{ shortAddress(skill.author) }} ↗</a>
              <span v-else class="mono" :title="skill.author">{{ shortAddress(skill.author) }}</span>
            </span>
            <span class="dot"></span>
            <span :title="skill.version.fingerprint">指纹 <span class="mono">{{ shortFingerprint(skill.version.fingerprint) }}</span></span>
            <template v-if="local">
              <span class="dot"></span>
              <router-link class="local-link" :to="{ name: 'SkillDetail', params: { name: local.name } }">
                由 {{ local.provenanceSessions }} 个 session 沉淀 · 查看草稿与出处
              </router-link>
            </template>
            <template v-if="skill.parentSkillId">
              <span class="dot"></span>
              <button class="local-link" @click="openSkill(skill.parentSkillId)">基于 Skill #{{ skill.parentSkillId }}</button>
            </template>
          </div>
        </div>
        <div class="minted-actions">
          <PromptCopyButton label="在此基础上修改" :prompt="derivePrompt(promptSkill, skill.version.index)" />
          <PromptCopyButton label="取用" variant="primary" :prompt="fetchPrompt(promptSkill, skill.version.index)" />
        </div>
      </header>

      <div v-if="!usage" class="detail-banner partial">
        <div class="detail-banner-body"><strong>调用数据暂时读不到</strong><div>{{ skill.usageError }}</div></div>
      </div>

      <div class="kpis">
        <section class="skill-panel kpi" data-kpi="invocations">
          <h3 class="skill-panel-title">真实调用</h3>
          <div class="big">{{ usage ? usage.totalInvocations.toLocaleString() : '—' }}</div>
          <div class="note" v-if="usage">来自 {{ usage.uniqueWalletsExact ? '' : '至少 ' }}{{ usage.uniqueWallets.toLocaleString() }} 个钱包</div>
        </section>
        <section class="skill-panel kpi" data-kpi="smooth">
          <h3 class="skill-panel-title">顺利率</h3>
          <template v-if="results && results.judged > 0">
            <div class="big">{{ percent(results.smooth, results.judged) }}</div>
            <div class="note">基于 {{ results.judged }} 次可判断的调用，另有 {{ results.unknown }} 次无法判断</div>
          </template>
          <template v-else>
            <div class="big off">—</div>
            <div class="note">{{ outcomesOn ? '还没有可判断的调用' : '场景与顺利率统计尚未开启' }}</div>
          </template>
        </section>
        <section class="skill-panel kpi" data-kpi="tool-errors">
          <h3 class="skill-panel-title">调用后报错</h3>
          <div class="big" :class="{ off: !outcomesOn }">{{ outcomesOn ? (percent(results.toolErrors, usage.totalInvocations) ?? '—') : '—' }}</div>
          <div class="note">{{ outcomesOn ? '事实信号，直接统计' : '尚未开启' }}</div>
        </section>
        <section class="skill-panel kpi" data-kpi="corrections">
          <h3 class="skill-panel-title">被用户纠正</h3>
          <div class="big" :class="{ off: !outcomesOn }">{{ outcomesOn ? (percent(results.userCorrections, usage.totalInvocations) ?? '—') : '—' }}</div>
          <div class="note">{{ outcomesOn ? '事实信号，直接统计' : '尚未开启' }}</div>
        </section>
      </div>

      <section v-if="usage" class="skill-panel trend-panel">
        <h3 class="skill-panel-title">
          <span>近 {{ usage.trend.weeks.length || 8 }} 周上报的调用</span>
          <span class="count">按上报时间统计 · 次 / 周</span>
        </h3>
        <div v-if="!usage.trend.available" class="skill-panel-empty">这个在线服务没有记录上报历史，暂时画不出趋势。</div>
        <template v-else-if="trend.length">
          <svg class="trend" :viewBox="`0 0 ${TREND.width} ${TREND.height + 18}`" preserveAspectRatio="none" role="img"
            :aria-label="`近 ${trend.length} 周上报的调用：${trend.map(point => point.invocations).join('、')}`">
            <line class="trend-base" :x1="TREND.pad" :x2="TREND.width - TREND.pad" :y1="TREND.height - TREND.pad" :y2="TREND.height - TREND.pad" />
            <polyline class="trend-line" :points="trendLine" />
            <g v-for="point in trend" :key="point.start">
              <circle class="trend-dot" :cx="point.x" :cy="point.y" r="3.5"><title>{{ point.start }} 这周：{{ point.invocations }} 次</title></circle>
            </g>
          </svg>
          <div class="trend-axis">
            <span>{{ formatShortDate(trend[0].start) }}</span>
            <span v-if="trendQuiet" class="note">近 {{ trend.length }} 周没有新的上报</span>
            <span>本周 <strong class="mono">{{ trend[trend.length - 1].invocations }}</strong></span>
          </div>
        </template>
      </section>

      <div class="grid-2">
        <section class="skill-panel">
          <h3 class="skill-panel-title">作者的描述</h3>
          <p v-if="skill.description" class="author-description">"{{ skill.description }}"</p>
          <p v-else class="skill-panel-empty">作者还没有上传正文和描述。</p>
          <div class="callout">
            <template v-if="scenesOn && topScene">
              实测 {{ percent(topScene.invocations, sceneTotal) }} 的调用来自「{{ sceneName(topScene) }}」，共 {{ usage.scenes.length }} 类场景。
            </template>
            <template v-else>实测场景统计尚未开启，还不能和作者的描述对照。</template>
          </div>
        </section>
        <section class="skill-panel" data-panel="scenes">
          <h3 class="skill-panel-title"><span>实测场景</span><span class="count">来自真实调用</span></h3>
          <template v-if="scenesOn">
            <div v-for="scene in usage.scenes" :key="scene.tag || sceneName(scene)" class="scene-row" :title="scene.tag || ''">
              <span class="scene-name" :class="{ user: scene.kind === 'user' }">{{ sceneName(scene) }}</span>
              <div class="bar"><i :style="{ width: percent(scene.invocations, topScene.invocations) }"></i></div>
              <span class="mono scene-count">{{ scene.invocations }} 次</span>
            </div>
          </template>
          <p v-else class="skill-panel-empty">场景与顺利率统计尚未开启。开启后，这里按真实调用所在的场景显示分布，和作者的描述并排对照。</p>
        </section>
      </div>

      <div class="grid-2">
        <section class="skill-panel">
          <h3 class="skill-panel-title">出生场景</h3>
          <span v-if="skill.birthScenes.length" class="scene-tags">
            <span v-for="scene in skill.birthScenes" :key="scene.tag" class="scene-tag" :class="scene.kind" :title="scene.tag">
              <span v-if="scene.kind === 'user'" class="scene-tag-new">新建</span>{{ scene.label || scene.tag }}
            </span>
          </span>
          <p v-else class="skill-panel-empty">铸造时没有标注出生场景。</p>
          <p class="note">铸造时写入链上，之后不可修改。</p>
        </section>
        <section class="skill-panel" data-panel="lineage">
          <h3 class="skill-panel-title"><span>族谱</span><span v-if="lineage.length" class="count">{{ lineage.length }} 个 Skill</span></h3>
          <div v-if="lineage.length" class="lineage">
            <button
              v-for="node in lineage"
              :key="node.skillId"
              class="lineage-node"
              :class="{ current: node.skillId === skill.skillId }"
              :style="{ '--depth': node.depth }"
              :data-lineage="node.skillId"
              @click="openSkill(node.skillId)"
            >
              <span class="lineage-name">{{ node.name || `Skill #${node.skillId}` }}</span>
              <span class="lineage-meta mono">#{{ node.skillId }} · {{ shortAddress(node.author) }}</span>
              <span v-if="node.skillId === skill.skillId" class="lineage-here">本页</span>
            </button>
            <p v-if="skill.lineage.truncated" class="note">族谱太大，只显示了一部分。</p>
          </div>
          <p v-else class="skill-panel-empty">{{ skill.lineageError ? `族谱暂时读不到：${skill.lineageError}` : '还没有衍生的 Skill。' }}</p>
        </section>
      </div>

      <section v-if="versions.length" class="skill-panel" data-panel="versions">
        <h3 class="skill-panel-title"><span>版本</span><span class="count">{{ versions.length }}</span></h3>
        <table class="versions">
          <thead><tr><th>版本</th><th>指纹</th><th>发布</th><th class="num">真实调用</th><th class="num">钱包</th></tr></thead>
          <tbody>
            <tr v-for="version in versions" :key="version.fingerprint" :class="{ current: version.index === skill.version.index }">
              <td class="mono version-label">{{ versionLabel(version.index) }}</td>
              <td class="mono" :title="version.fingerprint">{{ shortFingerprint(version.fingerprint) }}</td>
              <td class="mono">{{ fmtListTime(version.publishedAt) }}</td>
              <td class="mono num">{{ version.totalInvocations.toLocaleString() }}</td>
              <td class="mono num">{{ version.uniqueWallets.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p class="source-note">
        数据来自 Obelisk 在线服务 <span class="mono">{{ serviceHost }}</span> · {{ chainLabel(skill.chainId) }}
        <template v-if="usage?.lastReportAt"> · 最近一次上报 {{ fmtListTime(usage.lastReportAt) }}</template>
        <button class="source-toggle" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button>
      </p>
    </div>

    <div v-else-if="error" class="empty">
      {{ errorText(error) }}
      <span class="hint"><button class="source-toggle" @click="load">重试</button> · <router-link to="/skills">返回 Skill 列表</router-link></span>
    </div>
    <div v-else class="empty">正在读取 Skill #{{ skillId }}…</div>
  </div>
</template>

<style scoped>
.skill-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.minted-detail {
  max-width: 1120px; margin: 0 auto; padding: 32px 32px 60px;
  display: flex; flex-direction: column; gap: 16px;
  container-type: inline-size;
}
.mono { font-family: var(--font-mono); }

.minted-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 8px; }
.minted-heading { min-width: 0; }
.minted-heading .detail-path { margin-bottom: 10px; }
.minted-heading .detail-eyebrow .project-icon { color: var(--accent-2); }
.minted-heading .detail-meta { border-bottom: 0; padding-bottom: 0; font-family: var(--font-sans); }
.minted-actions { display: flex; gap: 8px; flex-shrink: 0; padding-top: 26px; }
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 8px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 500; line-height: 1.6; white-space: nowrap;
}
.pill .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.pill.version { background: var(--surface-strong); color: var(--fg-2); font-family: var(--font-mono); }
.pill.chain { background: var(--chain-soft); color: var(--chain); }
.pill.mine { background: var(--accent-soft); color: var(--accent-2); }
.chain-link { color: var(--chain); text-decoration: none; }
.chain-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.local-link { color: var(--accent-2); text-decoration: none; font: inherit; }
.local-link:hover { text-decoration: underline; text-underline-offset: 2px; }

.skill-panel {
  padding: 16px 16px 14px;
  border: 1px solid var(--hairline); border-radius: 10px;
  background: rgba(255,255,255,0.02); min-width: 0;
}
.skill-panel-title {
  display: flex; align-items: baseline; gap: 8px;
  font-size: var(--text-base); font-weight: 600; color: var(--fg-2);
  letter-spacing: 0.01em; margin-bottom: 12px;
}
.skill-panel-title .count { font-size: var(--text-sm); font-weight: 400; color: var(--muted); }
.skill-panel-empty { font-size: var(--text-base); color: var(--muted); line-height: 1.6; }
.note { font-size: var(--text-sm); color: var(--muted); line-height: 1.5; margin-top: 6px; }

.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.kpi .skill-panel-title { margin-bottom: 6px; }
.big { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg); font-variant-numeric: tabular-nums; }
.big.off { color: var(--muted-2); }

.trend { display: block; width: 100%; height: 128px; }
.trend-base { stroke: var(--hairline-strong); stroke-width: 1; }
.trend-line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.trend-dot { fill: var(--accent); }
.trend-axis { display: flex; justify-content: space-between; align-items: baseline; font-size: var(--text-sm); color: var(--muted); }
.trend-axis strong { color: var(--fg); font-weight: 600; }

.grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@container (max-width: 820px) {
  .grid-2 { grid-template-columns: minmax(0, 1fr); }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .minted-header { flex-direction: column; }
  .minted-actions { padding-top: 0; }
}

.author-description { font-size: var(--text-md); color: var(--fg-2); line-height: 1.6; }
.callout {
  margin-top: 14px; padding: 10px 14px;
  border-left: 3px solid var(--accent); background: var(--accent-soft);
  border-radius: 0 8px 8px 0; font-size: var(--text-base); color: var(--fg-2); line-height: 1.55;
}

.scene-row { display: grid; grid-template-columns: minmax(80px, 140px) minmax(0, 1fr) 64px; gap: 12px; align-items: center; padding: 6px 0; }
.scene-name { font-size: var(--text-base); color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-name.user { color: var(--fg-2); }
.scene-count { font-size: 11.5px; color: var(--fg-2); text-align: right; }
.bar { height: 8px; border-radius: 999px; background: var(--surface-strong); overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: 999px; background: var(--accent); }

.scene-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.scene-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 999px;
  font-size: var(--text-sm); font-weight: 500; line-height: 1.5;
  background: var(--accent-soft); color: var(--accent-2); border: 1px solid transparent;
}
.scene-tag.user { background: transparent; color: var(--fg-2); border: 1px dashed rgba(167,139,250,0.45); }
.scene-tag.unknown { background: var(--surface-strong); color: var(--muted); }
.scene-tag-new { font-size: 10px; letter-spacing: 0.04em; color: var(--accent-2); }

.lineage { display: flex; flex-direction: column; gap: 4px; }
.lineage-node {
  position: relative; display: flex; align-items: baseline; gap: 10px;
  margin-left: calc(var(--depth) * 22px);
  padding: 7px 10px; border-radius: 8px; text-align: left;
  border: 1px solid var(--hairline); background: rgba(255,255,255,0.025);
  transition: background 0.1s, border-color 0.1s;
}
.lineage-node:not(:first-child)::before {
  content: ''; position: absolute; left: -14px; top: -6px; width: 10px; height: 22px;
  border-left: 1px solid var(--hairline-strong); border-bottom: 1px solid var(--hairline-strong);
  border-bottom-left-radius: 4px;
}
.lineage-node:hover { background: var(--surface-strong); border-color: var(--hairline-strong); }
.lineage-node.current { background: var(--accent-soft); border-color: rgba(167,139,250,0.45); cursor: default; }
.lineage-name { font-size: var(--text-base); color: var(--fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lineage-meta { font-size: 11px; color: var(--muted); white-space: nowrap; }
.lineage-here { margin-left: auto; font-size: var(--text-xs); color: var(--accent-2); }

.versions { width: 100%; border-collapse: collapse; font-size: var(--text-base); }
.versions th { text-align: left; color: var(--muted); font-weight: 500; font-size: var(--text-sm); padding: 6px 10px; border-bottom: 1px solid var(--hairline); }
.versions td { padding: 8px 10px; border-bottom: 1px solid var(--hairline); color: var(--fg-2); font-size: 12px; }
.versions tr:last-child td { border-bottom: 0; }
.versions .num { text-align: right; }
.versions .version-label { color: var(--chain); font-weight: 600; }
.versions tr.current td { color: var(--fg); }

.source-note { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--text-sm); color: var(--muted); }
.source-note .source-toggle { margin-left: 6px; }
.empty .hint { display: inline-flex; gap: 6px; align-items: center; }
.empty .hint a { color: var(--accent-2); text-decoration: none; }
</style>
