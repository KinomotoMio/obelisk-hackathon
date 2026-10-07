// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Playground run reads (#32). The runner writes each run's files while it
// runs; the main process lists and checks them (playground:runs, :run). Pages
// that show a running run poll, since the runner gives no other signal.

import { reactive } from 'vue';

export const LIVE_POLL_MS = 1500;
export const LIST_POLL_MS = 5000;

export const playgroundState = reactive({
  /** The Playground directory for display (~/…), or null when the page is off. */
  dir: null,
  configured: false,
  runs: [],
  loaded: false,
  error: null,
});

function errorMessage(error) {
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/** Whether the page is on: asked again until it is, since the runner may write its first run any time. */
export async function loadPlaygroundInfo() {
  if (playgroundState.configured) return;
  try {
    const info = await window.obelisk?.playgroundInfo?.();
    playgroundState.dir = info?.dir ?? null;
  } catch {
    playgroundState.dir = null;
  }
  playgroundState.configured = Boolean(playgroundState.dir);
}

let listRequest = 0;
/** Reload the run list. Overlapping reloads keep the latest. */
export async function loadPlaygroundRuns() {
  await loadPlaygroundInfo();
  const request = ++listRequest;
  if (!playgroundState.configured) {
    playgroundState.loaded = true;
    return;
  }
  try {
    const runs = await window.obelisk.playgroundRuns();
    if (request !== listRequest) return;
    playgroundState.runs = runs;
    playgroundState.error = null;
  } catch (error) {
    if (request === listRequest) playgroundState.error = errorMessage(error);
  } finally {
    if (request === listRequest) playgroundState.loaded = true;
  }
}

export const runningCount = () => playgroundState.runs.filter(run => run.record?.run.status === 'running').length;
