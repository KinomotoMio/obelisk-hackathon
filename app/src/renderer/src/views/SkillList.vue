<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { state } from '../store.js';
import { fmtListTime } from '../utils.js';
import { groupSkills, shortFingerprint } from '../skill-library.mjs';
import { DISTILL_EXAMPLE_PROMPT } from '../skill-prompts.mjs';
import PromptCopyButton from '../components/PromptCopyButton.vue';
import SkillSceneTags from '../components/SkillSceneTags.vue';
import SkillStage from '../components/SkillStage.vue';

defineOptions({ name: 'SkillList' });

const router = useRouter();
const groups = computed(() => groupSkills(state.skills));
const sections = computed(() => [
  { key: 'pending', title: '待确认的草稿', skills: groups.value.pending },
  { key: 'minted', title: '我的 Skill · 已铸造', skills: groups.value.minted },
].filter(section => section.skills.length));

function openSkill(skill) {
  router.push({ name: 'SkillDetail', params: { name: skill.name } });
}

// Minimal market browsing: open anyone's minted Skill by its id.
const chainSkillId = ref('');
const chainSkillIdValid = computed(() => /^[1-9][0-9]{0,30}$/.test(chainSkillId.value.trim().replace(/^#/, '')));
function openChainSkill() {
  if (!chainSkillIdValid.value) return;
  router.push({ name: 'MintedSkill', params: { skillId: chainSkillId.value.trim().replace(/^#/, '') } });
}

function fingerprintOf(skill) {
  return skill.draftFingerprint || skill.latestVersion?.fingerprint || '';
}
</script>

<template>
  <div class="skill-wrap">
    <div class="skill-list">
      <div v-if="state.skillsError" class="detail-banner broken">
        <svg class="detail-banner-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 2l6.5 11.5h-13z M8 6.5v3M8 11.6v.4"/>
        </svg>
        <div class="detail-banner-body">
          <strong>Skill 库读取失败</strong>
          <div>{{ state.skillsError }}</div>
        </div>
      </div>

      <template v-if="sections.length">
        <section v-for="section in sections" :key="section.key" class="skill-section" :data-section="section.key">
          <div class="detail-section-divider">
            <span>{{ section.title }}</span><span class="count">{{ section.skills.length }}</span>
          </div>
          <div class="skill-cards">
            <div
              v-for="skill in section.skills"
              :key="skill.name"
              class="skill-card-row"
              :data-skill="skill.name"
              role="link"
              tabindex="0"
              @click="openSkill(skill)"
              @keydown.enter="openSkill(skill)"
            >
              <div class="skill-card-main">
                <div class="skill-card-title">
                  <span class="skill-name">{{ skill.name }}</span>
                  <SkillStage :skill="skill" />
                </div>
                <div class="skill-card-desc">{{ skill.description }}</div>
                <div class="skill-card-meta">
                  <SkillSceneTags v-if="skill.birthScenes.length" :tags="skill.birthScenes" :max="3" size="sm" />
                  <span v-if="skill.birthScenes.length" class="dot"></span>
                  <span>由 <span class="mono">{{ skill.provenanceSessions }}</span> 个 session 沉淀</span>
                  <template v-if="fingerprintOf(skill)">
                    <span class="dot"></span>
                    <span :title="fingerprintOf(skill)">指纹 <span class="mono">{{ shortFingerprint(fingerprintOf(skill)) }}</span></span>
                  </template>
                </div>
              </div>
              <div class="skill-card-right">
                <span class="skill-card-time">{{ fmtListTime(skill.updatedAt) }}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M6 4l4 4-4 4"/>
                </svg>
              </div>
            </div>
          </div>
        </section>
      </template>

      <div v-if="!sections.length && state.skillsLoaded && !state.skillsError" class="skill-empty">
        <div class="skill-empty-eyebrow"><span class="diamond"></span><span>还没有 Skill</span></div>
        <div class="skill-empty-title">好的 Skill 是从已经发生的工作里沉淀出来的。</div>
        <div class="skill-empty-body">
          在 Claude Code 里说一句话，例如 <code>把我最近准备求职材料的做法沉淀成一个 Skill</code>。
          「沉淀 Skill」会从你的全部历史里找出直接证据，起草正文和出处卡；草稿会出现在这里，等你审阅。
        </div>
        <div class="skill-empty-actions">
          <PromptCopyButton label="复制沉淀 Skill 的 prompt" :prompt="DISTILL_EXAMPLE_PROMPT" variant="primary" />
        </div>
      </div>

      <section v-if="state.skillsLoaded" class="skill-section chain-open" data-section="chain">
        <div class="detail-section-divider"><span>链上的 Skill</span></div>
        <form class="chain-open-form" @submit.prevent="openChainSkill">
          <span class="chain-open-hint">按 Skill 编号查看任何人铸造的 Skill：真实调用、实测场景和族谱。</span>
          <label class="chain-open-field">
            <span class="hash">#</span>
            <input v-model="chainSkillId" inputmode="numeric" placeholder="Skill 编号" aria-label="Skill 编号" />
          </label>
          <button class="chain-open-btn" type="submit" :disabled="!chainSkillIdValid">打开</button>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
.skill-wrap { flex: 1; overflow-y: auto; min-height: 0; }
.skill-list { max-width: 860px; margin: 0 auto; padding: 8px 32px 80px; }

.skill-section .detail-section-divider { margin-top: 28px; }
.skill-cards { display: flex; flex-direction: column; gap: 10px; }

.skill-card-row {
  display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--hairline); border-radius: 8px;
  background: rgba(255,255,255,0.02);
  cursor: pointer; transition: background 0.12s, border-color 0.12s, transform 0.12s;
}
.skill-card-row:hover, .skill-card-row:focus-visible {
  background: rgba(255,255,255,0.035); border-color: var(--hairline-strong);
  outline: none; transform: translateX(2px);
}
.skill-card-main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.skill-card-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.skill-name {
  font-family: var(--font-mono); font-size: var(--text-md); font-weight: 500;
  color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.skill-card-desc {
  font-size: var(--text-base); color: var(--fg-2); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; word-break: break-word;
}
.skill-card-meta {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: var(--text-sm); color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.skill-card-meta .mono { font-family: var(--font-mono); font-size: 11px; }
.skill-card-meta .dot { width: 2px; height: 2px; background: var(--muted-2); border-radius: 50%; flex-shrink: 0; }
.skill-card-right {
  display: flex; align-items: center; gap: 10px; flex-shrink: 0;
  color: var(--muted-2); transition: color 0.12s;
}
.skill-card-row:hover .skill-card-right { color: var(--fg-2); }
.skill-card-time { font-family: var(--font-mono); font-size: 10.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.skill-card-right svg { width: 14px; height: 14px; }

/* Open a minted Skill by id */
.chain-open-form { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.chain-open-hint { flex: 1; min-width: 220px; font-size: var(--text-sm); color: var(--muted); }
.chain-open-field {
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 10px; width: 140px;
  background: rgba(0,0,0,0.3); border: 1px solid var(--hairline-strong); border-radius: 5px;
  transition: all 0.12s;
}
.chain-open-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(167,139,250,0.12); }
.chain-open-field .hash { font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.chain-open-field input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font-family: var(--font-mono); font-size: 12px; color: var(--fg);
}
.chain-open-field input::placeholder { color: var(--muted-2); font-family: var(--font-sans); }
.chain-open-btn {
  height: 28px; padding: 0 12px; border-radius: 5px;
  border: 1px solid var(--hairline-strong); background: var(--surface);
  color: var(--fg-2); font-size: var(--text-sm); transition: all 0.1s;
}
.chain-open-btn:not(:disabled):hover { background: var(--surface-strong); color: var(--fg); }
.chain-open-btn:disabled { opacity: 0.5; }

/* Empty state: the same voice as the Recap empty state */
.skill-empty {
  margin-top: 40px; padding: 28px 22px;
  border: 1px dashed var(--hairline-strong); border-radius: 10px;
  background: rgba(255,255,255,0.015);
  display: flex; flex-direction: column; gap: 16px;
}
.skill-empty-eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em; color: var(--muted);
  display: flex; align-items: center; gap: 8px;
}
.skill-empty-eyebrow .diamond { width: 6px; height: 6px; background: var(--muted-2); transform: rotate(45deg); flex-shrink: 0; }
.skill-empty-title {
  font-family: 'Iowan Old Style', 'Charter', 'Source Serif Pro', Georgia, serif;
  font-size: 24px; font-weight: 500; color: var(--fg);
  letter-spacing: -0.015em; line-height: 1.35; max-width: 520px;
}
.skill-empty-body { font-size: var(--text-md); color: var(--fg-2); line-height: 1.7; max-width: 560px; }
.skill-empty-body code {
  font-family: var(--font-mono); font-size: 12.5px; color: var(--accent-2);
  background: var(--accent-soft); padding: 2px 8px; border-radius: 3px;
}
.skill-empty-actions { display: flex; gap: 8px; margin-top: 4px; }
</style>
