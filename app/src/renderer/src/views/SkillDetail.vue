<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { state } from '../store.js';
import { fmtListTime, renderMarkdown } from '../utils.js';
import { sourceColor, sourceLabel } from '../source-catalog.mjs';
import { loadSkillDetail } from '../skill-data.js';
import {
  chainLabel,
  mintedVersions,
  provenanceCard,
  shortAddress,
  shortFingerprint,
  skillStage,
} from '../skill-library.mjs';
import { continueEditingPrompt, dropEvidencePrompt, mintPrompt } from '../skill-prompts.mjs';
import PromptCopyButton from '../components/PromptCopyButton.vue';
import SkillSceneTags from '../components/SkillSceneTags.vue';
import SkillStage from '../components/SkillStage.vue';

defineOptions({ name: 'SkillDetail' });
const props = defineProps({ name: { type: String, required: true } });

const router = useRouter();
const skill = ref(null);
const sessions = ref(new Map());
const loaded = ref(false);
const loadError = ref(null);
const showSource = ref(false);
const flashedEvidence = ref(null);

let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  try {
    const detail = await loadSkillDetail(props.name);
    if (version !== loadVersion) return;
    skill.value = detail?.skill ?? null;
    sessions.value = detail?.sessions ?? new Map();
    loadError.value = null;
  } catch (error) {
    if (version !== loadVersion) return;
    loadError.value = error.message;
  } finally {
    if (version === loadVersion) loaded.value = true;
  }
}

watch(() => props.name, () => {
  loaded.value = false;
  skill.value = null;
  showSource.value = false;
  load();
}, { immediate: true });

const stage = computed(() => (skill.value ? skillStage(skill.value) : null));
// The draft can be revised or minted only while it holds changes not minted yet.
const reviewing = computed(() => stage.value === 'draft' || stage.value === 'revision');
const card = computed(() => provenanceCard(
  skill.value?.provenance ?? [],
  sessions.value,
  source => sourceLabel(source, state.sources),
));
const versions = computed(() => (skill.value ? mintedVersions(skill.value) : []));
const bodyHTML = computed(() => (skill.value?.draft ? renderMarkdown(skill.value.draft.body, { variant: 'body' }) : ''));
const bodyLabel = computed(() => {
  if (!skill.value?.draft) return '正文';
  if (stage.value === 'minted') {
    const current = versions.value.find(version => version.fingerprint === skill.value.draft.fingerprint);
    return current ? `正文 · ${current.label}` : '正文';
  }
  return '正文 · 草稿';
});
const parentLabel = computed(() => {
  const parent = skill.value?.parent;
  if (!parent) return null;
  if (parent.name) return parent.name;
  if (parent.skillId) return `Skill #${parent.skillId}`;
  return parent.fingerprint ? `指纹 ${shortFingerprint(parent.fingerprint)}` : null;
});

function openSession(entry, messageUuid) {
  if (!entry.session) return;
  router.push(messageUuid
    ? { path: `/sessions/${entry.sessionId}`, query: { focus: messageUuid } }
    : `/sessions/${entry.sessionId}`);
}

let flashTimer = null;
async function showEvidence(number) {
  flashedEvidence.value = number;
  await nextTick();
  document.querySelector(`[data-evidence="${number}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashedEvidence.value = null; }, 1400);
}

function onKeydown(event) {
  const tagName = event.target?.tagName;
  if (event.key !== 'Escape' || tagName === 'INPUT' || tagName === 'TEXTAREA') return;
  event.preventDefault();
  router.push({ name: 'SkillList' });
}

let unsubscribe = null;
onMounted(() => {
  document.addEventListener('keydown', onKeydown);
  unsubscribe = window.obelisk?.onSkillsUpdated?.(() => load()) ?? null;
});
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
  unsubscribe?.();
  clearTimeout(flashTimer);
});
</script>

<template>
  <div class="skill-wrap">
    <div v-if="skill" class="skill-detail" :data-stage="stage">
      <header class="detail-header">
        <div class="detail-eyebrow">
          <svg class="project-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
            <path d="M4.5 2.5h7L14 6l-6 7.5L2 6z"/><path d="M2 6h12M6.5 2.5L5.5 6 8 13.5 10.5 6l-1-3.5"/>
          </svg>
          <span class="project-name">Skill</span>
          <span class="sep">/</span>
          <SkillStage :skill="skill" />
        </div>
        <div class="detail-path">{{ skill.name }}</div>
        <div class="detail-summary">{{ skill.description }}</div>
        <div class="detail-meta">
          <span>由 {{ card.sessionCount }} 个 session 沉淀</span>
          <template v-if="skill.draft">
            <span class="dot"></span>
            <span :title="skill.draft.fingerprint">{{ reviewing ? '草稿指纹' : '指纹' }} <span class="mono">{{ shortFingerprint(skill.draft.fingerprint) }}</span></span>
          </template>
          <template v-if="parentLabel">
            <span class="dot"></span>
            <span>基于 {{ parentLabel }}</span>
          </template>
          <span class="dot"></span>
          <span :title="skill.updatedAt">更新于 <span class="mono">{{ fmtListTime(skill.updatedAt) }}</span></span>
        </div>
      </header>

      <div class="skill-grid">
        <div class="skill-col">
          <section class="skill-panel evidence-panel">
            <h3 class="skill-panel-title">
              <span>Obelisk 找到的直接证据</span>
              <span class="count">{{ card.sessionCount }} 个 session</span>
            </h3>
            <div v-if="!card.evidence.length" class="skill-panel-empty">这个草稿没有记录出处。</div>
            <div
              v-for="entry in card.evidence"
              :key="`${entry.number}:${entry.sessionId}`"
              class="evidence"
              :class="{ flash: flashedEvidence === entry.number, missing: !entry.session }"
              :data-evidence="entry.number"
            >
              <span class="evidence-num">{{ entry.number }}</span>
              <div class="evidence-body">
                <div class="evidence-head">
                  <button
                    class="evidence-title"
                    :disabled="!entry.session"
                    :title="entry.session ? '打开这个 session' : '本机索引中没有这个 session'"
                    @click="openSession(entry)"
                  >{{ entry.title || entry.sessionId }}</button>
                  <PromptCopyButton
                    v-if="reviewing"
                    class="evidence-drop"
                    label="去掉"
                    variant="inline"
                    title="复制 prompt：从证据中去掉这个 session 并重新起草"
                    :prompt="dropEvidencePrompt(skill, { sessionId: entry.sessionId, title: entry.title })"
                  />
                </div>
                <div class="evidence-why"><span class="evidence-why-label">命中</span>{{ entry.reason }}</div>
                <div class="evidence-meta">
                  <template v-if="entry.session">
                    <span class="src-dot" :style="{ '--source-color': sourceColor(entry.session.source, state.sources) }"></span>
                    <span>{{ entry.source }}</span>
                    <template v-if="entry.date"><span class="dot"></span><span>{{ entry.date }}</span></template>
                  </template>
                  <span v-else class="evidence-missing">本机索引中没有这个 session</span>
                </div>
                <div v-if="entry.excerpts.length" class="evidence-excerpts">
                  <button
                    v-for="(excerpt, index) in entry.excerpts"
                    :key="index"
                    class="excerpt"
                    :disabled="!entry.session"
                    :title="entry.session ? (excerpt.messageUuid ? '跳到这条消息' : '打开这个 session') : ''"
                    @click="openSession(entry, excerpt.messageUuid)"
                  >{{ excerpt.text }}</button>
                </div>
              </div>
            </div>
            <p v-if="card.evidence.length" class="skill-note">
              这些 session 是出处卡的依据。点击标题或引文，回到原始 session。
            </p>
          </section>

          <section v-if="versions.length" class="skill-panel versions-panel">
            <h3 class="skill-panel-title">
              <span>已铸造的版本</span>
              <span class="count">{{ versions.length }}</span>
            </h3>
            <div v-for="version in versions" :key="version.fingerprint" class="version" :data-version="version.label">
              <div class="version-head">
                <span class="version-label">{{ version.label }}</span>
                <span class="version-skill">Skill #{{ version.mint.skillId }} · {{ chainLabel(version.mint.chainId) }}</span>
                <span class="version-time" :title="version.mint.mintedAt">{{ fmtListTime(version.mint.mintedAt) }}</span>
              </div>
              <div class="version-meta">
                <span :title="version.fingerprint">指纹 {{ shortFingerprint(version.fingerprint) }}</span>
                <span class="dot"></span>
                <span :title="version.mint.author">作者 {{ shortAddress(version.mint.author) }}</span>
                <template v-if="version.txUrl">
                  <span class="dot"></span>
                  <a class="chain-link" :href="version.txUrl" target="_blank" rel="noopener noreferrer">链上记录 ↗</a>
                </template>
              </div>
              <div v-if="!version.verified" class="version-warning">本机保存的这个版本与它的指纹对不上</div>
            </div>
          </section>
        </div>

        <div class="skill-col">
          <section class="skill-panel body-panel">
            <div class="markdown-toolbar">
              <span class="skill-panel-title inline">{{ bodyLabel }}</span>
              <button
                class="source-toggle"
                :class="{ active: showSource }"
                :disabled="!skill.draft"
                @click="showSource = !showSource"
              >{{ showSource ? '显示渲染' : '显示 SKILL.md' }}</button>
            </div>
            <div v-if="!skill.draft" class="skill-panel-empty">草稿文件不见了。</div>
            <pre v-else-if="showSource" class="markdown-source skill-body">{{ skill.draft.skillMd }}</pre>
            <div v-else class="skill-body" v-html="bodyHTML"></div>
          </section>

          <section class="skill-panel provenance-panel">
            <h3 class="skill-panel-title"><span>出处卡</span></h3>
            <ul class="provenance-facts">
              <li>
                来自 {{ card.sessionCount }} 个 session<template v-if="card.span">，时间跨度 {{ card.span }}</template>
                <span v-if="card.sources.length" class="provenance-sources">
                  （{{ card.sources.map(source => `${source.name} ${source.count}`).join(' · ') }}）
                </span>
              </li>
            </ul>
            <div v-if="card.pitfalls.length" class="provenance-group" data-group="pitfalls">
              <div class="provenance-group-title">踩过的坑</div>
              <ul>
                <li v-for="(item, index) in card.pitfalls" :key="index">
                  <span>{{ item.text }}</span>
                  <button class="evidence-ref" :title="`来自证据 ${item.number}`" @click="showEvidence(item.number)">{{ item.number }}</button>
                </li>
              </ul>
            </div>
            <div v-if="card.corrections.length" class="provenance-group" data-group="corrections">
              <div class="provenance-group-title">被纠正过</div>
              <ul>
                <li v-for="(item, index) in card.corrections" :key="index">
                  <span>{{ item.text }}</span>
                  <button class="evidence-ref" :title="`来自证据 ${item.number}`" @click="showEvidence(item.number)">{{ item.number }}</button>
                </li>
              </ul>
            </div>
            <div class="provenance-scenes">
              <span class="provenance-scenes-label">出生场景</span>
              <SkillSceneTags v-if="skill.birthScenes.length" :tags="skill.birthScenes" />
              <span v-else class="provenance-none">还没有标注</span>
            </div>
          </section>

          <div class="skill-actions">
            <PromptCopyButton label="继续修改" :prompt="continueEditingPrompt(skill)" />
            <PromptCopyButton
              v-if="reviewing && skill.draft"
              :label="stage === 'revision' ? '确认并铸造新版本' : '确认并铸造'"
              variant="primary"
              :prompt="mintPrompt(skill)"
            />
          </div>
          <p class="skill-note right">按钮会复制一段 prompt，粘贴到 Claude Code 执行<template v-if="reviewing">；铸造前会先给你看预览</template>。</p>
        </div>
      </div>
    </div>

    <div v-else-if="loaded" class="empty">
      <template v-if="loadError">Skill 读取失败：{{ loadError }}</template>
      <template v-else>Skill 库里没有「{{ name }}」。</template>
      <router-link class="hint" to="/skills">返回 Skill 列表</router-link>
    </div>
    <div v-else class="empty">Loading...</div>
  </div>
</template>

<style scoped>
.skill-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.skill-detail {
  max-width: 1120px; margin: 0 auto; padding: 32px 32px 60px;
  container-type: inline-size;
}
.skill-detail .detail-header { max-width: 760px; }
.skill-detail .detail-eyebrow .project-icon { color: var(--accent-2); }
.skill-detail .detail-meta { border-bottom: 0; padding-bottom: 0; font-family: var(--font-sans); }
.mono { font-family: var(--font-mono); }

.skill-grid {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 16px; align-items: start;
}
@container (max-width: 820px) {
  .skill-grid { grid-template-columns: minmax(0, 1fr); }
}
.skill-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

.skill-panel {
  padding: 16px 16px 14px;
  border: 1px solid var(--hairline); border-radius: 10px;
  background: rgba(255,255,255,0.02);
}
.skill-panel-title {
  display: flex; align-items: baseline; gap: 8px;
  font-size: var(--text-base); font-weight: 600; color: var(--fg-2);
  letter-spacing: 0.01em; margin-bottom: 12px;
}
.skill-panel-title.inline { margin-bottom: 0; flex: 1; }
.skill-panel-title .count { font-size: var(--text-sm); font-weight: 400; color: var(--muted); }
.skill-panel-empty { font-size: var(--text-sm); color: var(--muted); padding: 6px 0; }
.skill-note { margin-top: 12px; font-size: var(--text-sm); color: var(--muted); line-height: 1.5; }
.skill-note.right { margin-top: -6px; text-align: right; }

/* Evidence */
.evidence {
  display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px;
  padding: 12px 6px 12px 0; margin: 0 -6px 0 0;
  border-top: 1px solid var(--hairline);
  border-radius: 6px; transition: background 0.3s;
}
.evidence:first-of-type { border-top: 0; padding-top: 2px; }
.evidence.flash { background: var(--accent-soft); }
.evidence-num {
  width: 20px; height: 20px; margin-top: 1px; border-radius: 50%;
  display: grid; place-items: center;
  font-family: var(--font-mono); font-size: 10.5px; color: var(--accent-2);
  background: var(--accent-soft);
}
.evidence.missing .evidence-num { color: var(--muted); background: var(--surface-strong); }
.evidence-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.evidence-head { display: flex; align-items: flex-start; gap: 8px; }
.evidence-title {
  flex: 1; min-width: 0; text-align: left;
  font-size: var(--text-md); font-weight: 500; color: var(--fg); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px;
  transition: color 0.1s, text-decoration-color 0.1s;
}
.evidence-title:not(:disabled):hover { color: var(--accent-2); text-decoration-color: var(--accent-2); }
.evidence-title:disabled { color: var(--fg-2); font-family: var(--font-mono); font-size: var(--text-sm); }
.evidence-drop { margin-top: -2px; flex-shrink: 0; }
.evidence-why { font-size: var(--text-base); color: var(--fg-2); line-height: 1.5; }
.evidence-why-label {
  font-size: 10.5px; color: var(--accent-2); letter-spacing: 0.04em;
  margin-right: 6px;
}
.evidence-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 11px; color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.evidence-meta .dot { width: 2px; height: 2px; background: var(--muted-2); border-radius: 50%; }
.src-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--source-color); box-shadow: 0 0 4px var(--source-color); }
.evidence-missing { color: var(--muted-2); overflow-wrap: anywhere; }
.evidence-excerpts { display: flex; flex-direction: column; gap: 4px; margin-top: 3px; }
.excerpt {
  text-align: left; padding: 2px 0 2px 12px;
  border-left: 2px solid var(--accent-soft);
  font-size: var(--text-sm); color: var(--fg-2); line-height: 1.55;
  white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
  transition: border-color 0.1s, color 0.1s;
}
.excerpt:not(:disabled):hover { border-left-color: var(--accent); color: var(--fg); }
.excerpt:disabled { cursor: default; }

/* Minted versions */
.version { padding: 10px 0; border-top: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 5px; }
.version:first-of-type { border-top: 0; padding-top: 0; }
.version-head { display: flex; align-items: baseline; gap: 10px; }
.version-label { font-family: var(--font-mono); font-size: var(--text-md); font-weight: 600; color: var(--chain); }
.version-skill { flex: 1; min-width: 0; font-size: var(--text-base); color: var(--fg-2); }
.version-time { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); }
.version-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-family: var(--font-mono); font-size: 11px; color: var(--muted);
}
.version-meta .dot { width: 2px; height: 2px; background: var(--muted-2); border-radius: 50%; }
.chain-link { color: var(--chain); text-decoration: none; }
.chain-link:hover { text-decoration: underline; text-underline-offset: 2px; }
.version-warning { font-size: var(--text-sm); color: var(--warn); }

/* Body */
.body-panel .markdown-toolbar { margin-bottom: 10px; }
.skill-body {
  max-height: 460px; overflow-y: auto;
  padding: 12px 14px; border-radius: 6px;
  background: rgba(0,0,0,0.22); border: 1px solid var(--hairline);
}
.skill-body :deep(.markdown-body) { font-size: var(--text-base); }
.skill-body.markdown-source { margin: 0; }

/* Provenance card */
.provenance-facts { list-style: none; font-size: var(--text-base); color: var(--fg-2); line-height: 1.6; }
.provenance-sources { color: var(--muted); }
.provenance-group { margin-top: 12px; }
.provenance-group-title { font-size: 10.5px; color: var(--muted); letter-spacing: 0.04em; margin-bottom: 4px; }
.provenance-group ul { list-style: none; display: flex; flex-direction: column; gap: 4px; }
.provenance-group li {
  position: relative; padding-left: 14px;
  font-size: var(--text-base); color: var(--fg-2); line-height: 1.55;
}
.provenance-group li::before {
  content: ''; position: absolute; left: 2px; top: 0.68em;
  width: 4px; height: 4px; border-radius: 50%; background: var(--muted-2);
}
.provenance-group[data-group="corrections"] li::before { background: var(--accent); }
.evidence-ref {
  display: inline-grid; place-items: center; vertical-align: 1px;
  min-width: 16px; height: 16px; padding: 0 4px; margin-left: 6px;
  border-radius: 8px; background: var(--surface-strong);
  font-family: var(--font-mono); font-size: 10px; color: var(--muted);
  transition: all 0.1s;
}
.evidence-ref:hover { background: var(--accent-soft); color: var(--accent-2); }
.provenance-scenes {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--hairline);
}
.provenance-scenes-label { font-size: var(--text-sm); color: var(--muted); }
.provenance-none { font-size: var(--text-sm); color: var(--muted-2); }

.skill-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.empty .hint { color: var(--accent-2); text-decoration: none; }
</style>
