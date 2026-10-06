<!-- Copyright (C) 2026 tommy0103 and contributors. -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

<script setup>
import { computed } from 'vue';
import { sceneDescription } from '../skill-data.js';

// Birth scenes by their vocabulary label. A tag created because nothing in the
// vocabulary fitted (user:…) is marked 新建, since it is not comparable across
// users until a later vocabulary version takes it in.
const props = defineProps({
  tags: { type: Array, default: () => [] },
  // Show at most this many, then "+N".
  max: { type: Number, default: Infinity },
  size: { type: String, default: 'md' },
});

const scenes = computed(() => props.tags.map(sceneDescription));
const shown = computed(() => scenes.value.slice(0, props.max));
const hidden = computed(() => scenes.value.slice(props.max));

function title(scene) {
  if (scene.kind === 'vocabulary') return `${scene.dimensionLabel} · ${scene.label}\n${scene.tag}`;
  if (scene.kind === 'user') {
    return `新建的标签：${scene.dimensionLabel ? `${scene.dimensionLabel} · ` : ''}${scene.label}\n场景词表里还没有它\n${scene.tag}`;
  }
  return `不在场景词表中\n${scene.tag}`;
}
</script>

<template>
  <span class="scene-tags" :class="size">
    <span
      v-for="scene in shown"
      :key="scene.tag"
      class="scene-tag"
      :class="scene.kind"
      :title="title(scene)"
    >
      <span v-if="scene.kind === 'user'" class="scene-tag-new">新建</span>{{ scene.label }}
    </span>
    <span v-if="hidden.length" class="scene-tag more" :title="hidden.map(scene => scene.label).join('\n')">+{{ hidden.length }}</span>
  </span>
</template>

<style scoped>
.scene-tags { display: inline-flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.scene-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 2px 10px; border-radius: 999px;
  font-size: var(--text-sm); font-weight: 500; line-height: 1.5;
  white-space: nowrap;
  background: var(--accent-soft); color: var(--accent-2);
  border: 1px solid transparent;
}
.scene-tag.user {
  background: transparent; color: var(--fg-2);
  border: 1px dashed rgba(167,139,250,0.45);
}
.scene-tag-new {
  font-size: 10px; letter-spacing: 0.04em; color: var(--accent-2);
}
.scene-tag.unknown, .scene-tag.more {
  background: var(--surface-strong); color: var(--muted);
}
.scene-tags.sm { gap: 4px; }
.scene-tags.sm .scene-tag { padding: 0 8px; font-size: var(--text-xs); }
.scene-tags.sm .scene-tag-new { font-size: 9.5px; }
</style>
