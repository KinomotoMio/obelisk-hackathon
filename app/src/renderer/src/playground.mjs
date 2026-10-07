// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Display helpers for Playground runs (#32). The records are read and checked
// by the main process (app/src/main/playground-runs.ts) in the runner's schema
// (playground/src/provenance.ts); these functions only shape them for the page.

import { chainExplorer, chainLabel } from './skill-library.mjs';

/** A running run with no new record or event for this long may have stopped. */
export const QUIET_MS = 120_000;

const RUN_STATUS = {
  running: { label: '运行中', tone: 'live' },
  succeeded: { label: '已完成', tone: 'ok' },
  failed: { label: '失败', tone: 'danger' },
  aborted: { label: '已中止', tone: 'warn' },
};

const STEP_STATUS = {
  pending: '待执行',
  running: '进行中',
  succeeded: '完成',
  failed: '失败',
  skipped: '跳过',
};

const HARNESS = { 'claude-code': 'Claude Code', codex: 'Codex', fake: '模拟助手' };

const ARTIFACT = {
  'skill-draft': 'Skill 草稿',
  'skill-mint': '铸造 Skill',
  'skill-fetch': '取用 Skill',
  share: '分享',
  'share-receipt': '已读回执',
  'usage-report': '调用上报',
  wallet: '钱包',
};

export const stepStatusLabel = status => STEP_STATUS[status] ?? status;
export const harnessLabel = kind => HARNESS[kind] ?? kind;
export const artifactLabel = kind => ARTIFACT[kind] ?? kind;

/** `03:42`, or `1:03:42` past an hour. */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** `21:15:31` in local time. */
export function formatClock(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function elapsedMs(record, now = Date.now()) {
  const start = Date.parse(record.run.startedAt);
  const end = record.run.endedAt ? Date.parse(record.run.endedAt) : now;
  return Math.max(0, end - start);
}

/**
 * The status pill of a run. A running run that has gone quiet says so rather
 * than claiming it is still running.
 */
export function runStatus(record, updatedAt, now = Date.now()) {
  const status = RUN_STATUS[record.run.status] ?? { label: record.run.status, tone: 'dim' };
  if (record.run.status === 'running' && updatedAt && now - updatedAt > QUIET_MS) {
    return { key: 'quiet', label: `${Math.floor((now - updatedAt) / 60_000)} 分钟没有新动静`, tone: 'warn' };
  }
  return { key: record.run.status, ...status };
}

/** The network pill: the chain, or why there is none. */
export function networkLabel(record) {
  if (record.run.dryRun) return '空跑 · 未上链';
  return record.run.network.chainId ? chainLabel(record.run.network.chainId) : '未连链';
}

export function shortRunId(id) {
  const value = String(id || '');
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

export function shortHash(hash) {
  const value = String(hash || '');
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

export function txUrl(chainId, hash) {
  const explorer = chainExplorer(chainId);
  return explorer && /^0x[0-9a-fA-F]{64}$/.test(String(hash || '')) ? `${explorer}/tx/${hash}` : null;
}

export function addressUrl(chainId, address) {
  const explorer = chainExplorer(chainId);
  return explorer && /^0x[0-9a-fA-F]{40}$/.test(String(address || '')) ? `${explorer}/address/${address}` : null;
}

export function roleLabels(record) {
  return new Map((record?.roles ?? []).map(role => [role.id, role.label]));
}

/** Steps finished (whatever the outcome) out of all steps. */
export function stepProgress(record) {
  const steps = record.steps;
  return { done: steps.filter(step => ['succeeded', 'failed', 'skipped'].includes(step.status)).length, total: steps.length };
}

export function currentStep(record) {
  return record.steps.find(step => step.status === 'running') ?? null;
}

/** The first thing that went wrong, for the banner of a failed run. */
export function runFailure(record, events = []) {
  const step = record.steps.find(entry => entry.status === 'failed');
  if (step) return { step, error: step.error };
  const finished = [...events].reverse().find(event => event.type === 'run.finished' && event.error);
  return finished ? { step: null, error: finished.error } : null;
}

/**
 * Everything the run produced, flattened from its steps, each entry keeping the
 * step it came from: the lists behind every number on the page.
 */
export function runArtifacts(record) {
  const flat = pick => record.steps.flatMap(step => pick(step).map(item => ({ ...item, step })));
  const tasks = record.steps.filter(step => step.scenes.length);
  const scenes = new Map();
  for (const task of tasks) for (const scene of task.scenes) scenes.set(scene.tag ?? scene.label, scene);
  const harnesses = new Map();
  for (const role of record.roles) {
    const key = `${role.harness.kind}|${role.harness.version ?? ''}|${role.harness.model ?? ''}`;
    if (!harnesses.has(key)) harnesses.set(key, { ...role.harness, roles: [] });
    harnesses.get(key).roles.push(role.label);
  }
  return {
    sessions: flat(step => step.sessions),
    commands: flat(step => step.commands),
    transactions: flat(step => step.transactions),
    artifacts: flat(step => step.artifacts),
    screenshots: flat(step => step.screenshots),
    prompts: record.steps.filter(step => step.prompt),
    tasks,
    scenes: [...scenes.values()],
    harnesses: [...harnesses.values()],
  };
}

export function skillArtifacts(artifacts) {
  return artifacts.filter(item => item.kind.startsWith('skill-'));
}

/** `obelisk skill mint job-application-materials --confirm 9c41…e07a` */
export function commandLine(command) {
  return ['obelisk', ...command.argv.map(arg => (/^[0-9a-fA-F]{40,}$|^0x[0-9a-fA-F]{40,}$/.test(arg) ? shortHash(arg) : arg))].join(' ');
}

/** The newest events first, optionally only one step's. */
export function eventFeed(events, stepId = null) {
  return [...events].filter(event => !stepId || event.stepId === stepId).reverse();
}

/** The data reference of an event, as the 产物 column shows it. */
export function eventProduct(event) {
  if (event.session) return { kind: 'session', session: event.session };
  if (event.transaction) return { kind: 'transaction', transaction: event.transaction };
  if (event.screenshot) return { kind: 'screenshot', screenshot: event.screenshot };
  if (event.type === 'command' && event.exitCode) return { kind: 'exit', exitCode: event.exitCode };
  if (event.type === 'step.finished' && event.status === 'failed') return { kind: 'failed' };
  return { kind: 'local' };
}

export function eventTone(event) {
  if (event.type === 'step.finished' || event.type === 'run.finished') {
    if (event.status === 'failed') return 'danger';
    if (event.status === 'aborted') return 'warn';
  }
  return event.type === 'run.started' || event.type === 'run.finished' || event.type === 'step.started' ? 'milestone' : '';
}

/** The runs behind a Skill for its 「来源：Playground」 note. */
export function sourceSummary(sources) {
  const mintedBy = [...new Set(sources.flatMap(source => source.mintedBy))];
  return {
    runs: sources.length,
    mintedBy,
    roles: sources.reduce((sum, source) => sum + source.roles, 0),
    sessions: sources.reduce((sum, source) => sum + source.sessions, 0),
  };
}
