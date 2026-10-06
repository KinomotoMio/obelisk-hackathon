// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Skill library reads for the Skill tab. The library is written by the CLI;
// the main process exposes it read-only (skills:list, skills:get) and
// announces changes (onSkillsUpdated).

import { reactive } from 'vue';
import { state } from './store.js';

const sceneDescriptions = reactive(new Map());
let listRequest = 0;

function errorMessage(error) {
  // ipcRenderer.invoke prefixes the main-process message; keep only the cause.
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/** Fetch display labels for scene tags that have not been described yet. */
export async function describeScenes(tags) {
  const missing = [...new Set(tags)].filter(tag => typeof tag === 'string' && !sceneDescriptions.has(tag));
  if (!missing.length || !window.obelisk?.skillsDescribeScenes) return;
  const described = await window.obelisk.skillsDescribeScenes(missing);
  for (const scene of described || []) sceneDescriptions.set(scene.tag, scene);
}

/** A scene tag's label; tags not described (yet) are shown as written. */
export function sceneDescription(tag) {
  return sceneDescriptions.get(tag) ?? { tag, kind: 'unknown', dimension: null, dimensionLabel: null, label: tag };
}

/** Reload the library summaries into the store. Overlapping reloads keep the latest. */
export async function loadSkills() {
  const request = ++listRequest;
  if (!window.obelisk?.skillsList) {
    state.skillsLoaded = true;
    return;
  }
  try {
    const skills = await window.obelisk.skillsList();
    await describeScenes(skills.flatMap(skill => skill.birthScenes || []));
    if (request !== listRequest) return;
    state.skills = skills;
    state.skillsError = null;
  } catch (error) {
    if (request !== listRequest) return;
    state.skillsError = errorMessage(error);
  } finally {
    if (request === listRequest) state.skillsLoaded = true;
  }
}

/** One Skill with everything the detail view shows, or null when it is gone. */
export async function loadSkillDetail(name) {
  const skill = await window.obelisk.skillsGet(name).catch(error => {
    throw new Error(errorMessage(error));
  });
  if (!skill) return null;
  const sessionIds = skill.provenance.map(entry => entry.sessionId);
  const [sessions] = await Promise.all([
    window.obelisk.getSessionsByIds?.(sessionIds) ?? [],
    describeScenes([...skill.birthScenes, ...skill.versions.flatMap(version => version.birthScenes)]),
  ]);
  return { skill, sessions: new Map((sessions || []).map(session => [session.id, session])) };
}
