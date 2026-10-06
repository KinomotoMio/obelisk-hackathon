<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed } from 'vue';
import { skillStage, versionLabel } from '../skill-library.mjs';

// Where a Skill stands: a draft waiting for review, minted, or minted with a
// newer draft waiting. Accepts a summary (skills:list) or a view (skills:get).
const props = defineProps({ skill: { type: Object, required: true } });

const stage = computed(() => skillStage(props.skill));
const latestMint = computed(() => {
  if ('latestVersion' in props.skill) return props.skill.latestVersion?.mint ?? null;
  const minted = props.skill.versions.filter(version => version.mint);
  return minted.length ? minted.reduce((a, b) => (a.mint.versionIndex > b.mint.versionIndex ? a : b)).mint : null;
});
</script>

<template>
  <span class="skill-stage">
    <span v-if="latestMint" class="stage-pill chain" :title="`Skill #${latestMint.skillId}`">
      <span class="dot"></span>已铸造 {{ versionLabel(latestMint.versionIndex) }}
    </span>
    <span v-if="stage === 'draft'" class="stage-pill draft"><span class="dot"></span>草稿 · 待确认</span>
    <span v-else-if="stage === 'revision'" class="stage-pill draft"><span class="dot"></span>新草稿 · 待确认</span>
  </span>
</template>

<style scoped>
.skill-stage { display: inline-flex; gap: 6px; flex-shrink: 0; }
.stage-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 8px; border-radius: 999px;
  font-size: var(--text-xs); font-weight: 500; line-height: 1.6;
  white-space: nowrap; font-family: var(--font-sans);
}
.stage-pill .dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.stage-pill.draft { background: var(--accent-soft); color: var(--accent-2); }
.stage-pill.draft .dot { box-shadow: 0 0 6px var(--accent-glow); }
.stage-pill.chain { background: var(--chain-soft); color: var(--chain); }
</style>
