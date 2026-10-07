// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Playground runs for the App's live page (#32): progress, events, chain
// transactions, key screenshots, and the provenance record of every run.
//
// The runner (#31) owns these files and defines their schema
// (playground/src/provenance.ts); the App only reads them:
//
//   runs/<run id>/provenance.json   the run's record, rewritten as the run goes
//   runs/<run id>/events.jsonl      one event per line, append-only
//   runs/<run id>/screenshots/…     the key screenshots the record names
//
// Everything in them is untrusted input. A record must pass the runner's own
// validateProvenance(); on top of that, ids, addresses, hashes and paths are
// checked against tighter formats, text is length-capped, lists are bounded,
// and a screenshot is only read from inside its own run directory.

import fs from 'node:fs';
import path from 'node:path';
import { describeSceneTag, SCENE_DIMENSIONS } from '../../../packages/core/src/scenes.ts';
import { playgroundHome } from '../../../playground/src/home.ts';
import { validateEvent, validateProvenance } from '../../../playground/src/provenance.ts';

const RUNS_DIR = 'runs';
const RECORD_FILE = 'provenance.json';
const EVENTS_FILE = 'events.jsonl';
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const MAX_EVENT_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;
const MAX_RUNS = 200;
const MAX_EVENTS = 1000;
const MAX_TEXT = 1000;

const RUN_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SOURCE_RE = /^[a-z][a-z0-9-]{0,31}$/;
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const SCREENSHOT_RE = /^screenshots\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(png|jpe?g|webp)$/;
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/**
 * The Playground home the runner uses (playground/src/home.ts):
 * OBELISK_PLAYGROUND_HOME, else ~/.obelisk-hackathon/playground. The default
 * home counts only once the runner has written a run there, so the page stays
 * hidden for anyone who never ran the Playground. Null hides the page.
 */
export function resolvePlaygroundDir(env: NodeJS.ProcessEnv, exists: (file: string) => boolean = fs.existsSync): string | null {
  let dir: string;
  try {
    dir = playgroundHome(env);
  } catch {
    return null;
  }
  if (env['OBELISK_PLAYGROUND_HOME']?.trim()) return dir;
  return exists(path.join(dir, RUNS_DIR)) ? dir : null;
}

/** The directory for display, with the home directory written as ~. */
export function displayDir(dir: string, home: string): string {
  return dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

class InvalidRecord extends Error {}

function invalid(field: string): never {
  throw new InvalidRecord(`${field} is not in the expected format`);
}

type Obj = Record<string, unknown>;
const obj = (value: unknown) => value as Obj;

function matching(value: unknown, re: RegExp, field: string): string {
  return typeof value === 'string' && re.test(value) ? value : invalid(field);
}

function optionalMatching(value: unknown, re: RegExp, field: string): string | null {
  return value === null || value === undefined ? null : matching(value, re, field);
}

function text(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
}

function chainId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function bounded<T>(value: unknown, max: number, map: (item: Obj) => T): T[] {
  return (value as unknown[]).slice(0, max).map((item) => map(obj(item)));
}

function scene(tag: unknown) {
  if (typeof tag !== 'string' || tag.length > 64) return { tag: null, kind: 'unknown', label: String(tag).slice(0, 64), dimensionLabel: null };
  const described = describeSceneTag(tag);
  const dimension = SCENE_DIMENSIONS.find((entry) => entry.id === described.dimension);
  return { tag, kind: described.kind, label: described.label, dimensionLabel: dimension?.label ?? null };
}

function harness(value: unknown) {
  const body = obj(value);
  return { kind: body['kind'] as 'claude-code' | 'codex' | 'fake', version: text(body['version'], 120), model: text(body['model'], 120) };
}

function session(value: Obj) {
  return {
    source: matching(value['source'], SOURCE_RE, 'session source'),
    id: matching(value['id'], SESSION_RE, 'session id'),
    obeliskId: matching(value['obeliskId'], SESSION_RE, 'session id'),
  };
}

function transaction(value: Obj) {
  return {
    hash: matching(value['hash'], TX_RE, 'transaction hash'),
    chainId: chainId(value['chainId']),
    command: text(value['command'], 64) ?? '',
  };
}

function command(value: Obj) {
  return {
    argv: (value['argv'] as string[]).slice(0, 32).map((arg) => arg.slice(0, 200)),
    exitCode: value['exitCode'] as number,
    startedAt: value['startedAt'] as string,
    endedAt: value['endedAt'] as string,
    transactions: (value['transactions'] as string[]).slice(0, 64),
  };
}

function artifact(value: Obj) {
  return { kind: text(value['kind'], 64) ?? '', ref: text(value['ref'], 200) ?? '' };
}

function screenshot(value: Obj) {
  return { file: matching(value['file'], SCREENSHOT_RE, 'screenshot file'), caption: text(value['caption'], 120) ?? '' };
}

/**
 * The provenance record of one run: the runner's schema, validated by the
 * runner's own validator, then narrowed for display.
 */
export function checkRecord(raw: unknown) {
  const problems = validateProvenance(raw);
  if (problems.length) throw new InvalidRecord(problems[0]!);
  const body = obj(raw);
  const run = obj(body['run']);
  const scenario = obj(run['scenario']);
  const network = obj(run['network']);
  return {
    run: {
      id: text(run['id'], 128)!,
      scenario: {
        name: text(scenario['name'], 64) ?? '',
        title: text(scenario['title'], 120) ?? text(scenario['name'], 64) ?? '',
        file: text(scenario['file'], 200) ?? '',
        sha256: text(scenario['sha256'], 64) ?? '',
      },
      network: { serviceUrl: text(network['serviceUrl'], 200), chainId: chainId(network['chainId']) },
      startedAt: run['startedAt'] as string,
      endedAt: (run['endedAt'] as string | null) ?? null,
      status: run['status'] as 'running' | 'succeeded' | 'failed' | 'aborted',
      dryRun: run['dryRun'] === true,
      gitCommit: text(obj(run['obelisk'])['gitCommit'], 64),
    },
    roles: bounded(body['roles'], 256, (role) => ({
      id: matching(role['id'], ID_RE, 'role id'),
      label: text(role['label'], 32) ?? String(role['id']),
      wallet: optionalMatching(obj(role['wallet'])['address'], ADDRESS_RE, 'wallet address'),
      harness: harness(role['harness']),
    })),
    steps: bounded(body['steps'], 500, (step) => ({
      id: matching(step['id'], ID_RE, 'step id'),
      index: step['index'] as number,
      title: text(step['title'], 300) ?? String(step['id']),
      role: step['role'] as string,
      action: step['action'] as 'prompt' | 'cli',
      scenes: (step['scenes'] as unknown[]).slice(0, 16).map(scene),
      status: step['status'] as 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped',
      startedAt: (step['startedAt'] as string | null) ?? null,
      endedAt: (step['endedAt'] as string | null) ?? null,
      harness: step['harness'] ? { ...harness(step['harness']), maxTurns: (obj(step['harness'])['maxTurns'] as number | null) ?? null } : null,
      prompt: text(step['prompt'], 4000),
      sessions: bounded(step['sessions'], 1000, session),
      commands: bounded(step['commands'], 1000, command),
      transactions: bounded(step['transactions'], 1000, transaction),
      artifacts: bounded(step['artifacts'], 1000, artifact),
      screenshots: bounded(step['screenshots'], 64, screenshot),
      error: text(step['error'], 500),
    })),
    totals: obj(body['totals']) as { roles: number; steps: number; sessions: number; commands: number; transactions: number; screenshots: number },
  };
}

export type RunRecord = ReturnType<typeof checkRecord>;

// What an event points at, by type. Data that does not have the shape its type
// promises is dropped; the event's line of text is still shown.
function eventDetail(type: string, data: Obj) {
  try {
    if (type === 'session') return { session: session(data) };
    if (type === 'transaction') return { transaction: transaction(data) };
    if (type === 'screenshot') return { screenshot: screenshot(data) };
    if (type === 'artifact') return { artifact: artifact(data) };
    if (type === 'command') {
      const exitCode = data['exitCode'];
      return { exitCode: Number.isSafeInteger(exitCode) ? exitCode as number : null };
    }
    if (type === 'step.finished' || type === 'run.finished') {
      const status = data['status'];
      return { status: typeof status === 'string' ? status.slice(0, 16) : null, error: text(data['error'], 500) };
    }
  } catch (error) {
    if (!(error instanceof InvalidRecord)) throw error;
  }
  return {};
}

/** One event line; null when the line does not follow the event schema. */
export function checkEvent(raw: unknown) {
  if (validateEvent(raw).length) return null;
  const event = obj(raw);
  if (!Number.isSafeInteger(event['seq'])) return null;
  const role = event['role'];
  const stepId = event['stepId'];
  return {
    seq: event['seq'] as number,
    at: event['at'] as string,
    type: event['type'] as string,
    stepId: typeof stepId === 'string' && ID_RE.test(stepId) ? stepId : null,
    role: typeof role === 'string' && ID_RE.test(role) ? role : null,
    text: text(event['text']) ?? '',
    ...eventDetail(event['type'] as string, obj(event['data'])),
  };
}

export type RunEvent = NonNullable<ReturnType<typeof checkEvent>>;

function runDirOf(dir: string, runId: unknown): string | null {
  if (typeof runId !== 'string' || !RUN_DIR_RE.test(runId)) return null;
  return path.join(dir, RUNS_DIR, runId);
}

function mtime(file: string): number {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

type RecordResult = { ok: true; record: RunRecord } | { ok: false; error: string };
const recordCache = new Map<string, { mtimeMs: number; size: number; value: RecordResult }>();

function readRecord(runDir: string): RecordResult {
  const file = path.join(runDir, RECORD_FILE);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return { ok: false, error: '还没有出处记录' };
  }
  const cached = recordCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
  let value: RecordResult;
  if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) {
    value = { ok: false, error: '出处记录太大' };
  } else {
    try {
      value = { ok: true, record: checkRecord(JSON.parse(fs.readFileSync(file, 'utf8'))) };
    } catch (error) {
      value = { ok: false, error: error instanceof InvalidRecord ? error.message : '不是有效的 JSON' };
    }
  }
  recordCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

// The newest events in write order. A line still being appended (no trailing
// newline yet) is left for the next read; lines that do not follow the event
// schema are counted rather than shown.
function readEvents(runDir: string) {
  const file = path.join(runDir, EVENTS_FILE);
  let content = '';
  let clipped = false;
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - MAX_EVENT_BYTES);
    clipped = start > 0;
    const handle = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      content = buffer.toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return { events: [] as RunEvent[], skipped: 0, truncated: false };
  }
  const lines = content.split('\n');
  lines.pop();
  if (clipped) lines.shift();
  const events: RunEvent[] = [];
  let skipped = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { skipped++; continue; }
    const event = checkEvent(parsed);
    if (event) events.push(event); else skipped++;
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events: events.slice(-MAX_EVENTS), skipped, truncated: clipped || events.length > MAX_EVENTS };
}

function summaryOf(runId: string, runDir: string, result: RecordResult) {
  const updatedAt = Math.max(mtime(path.join(runDir, RECORD_FILE)), mtime(path.join(runDir, EVENTS_FILE)));
  return result.ok
    ? { id: runId, updatedAt, record: result.record, error: null }
    : { id: runId, updatedAt, record: null, error: result.error };
}

function runIds(dir: string): string[] {
  try {
    return fs.readdirSync(path.join(dir, RUNS_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN_DIR_RE.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Every run, newest first; a record the App cannot read is listed last with the reason. */
export function listRuns(dir: string) {
  const runs = runIds(dir).map((runId) => {
    const runDir = path.join(dir, RUNS_DIR, runId);
    return summaryOf(runId, runDir, readRecord(runDir));
  });
  const started = (run: (typeof runs)[number]) => (run.record ? Date.parse(run.record.run.startedAt) : -Infinity);
  return runs.sort((a, b) => started(b) - started(a) || b.updatedAt - a.updatedAt).slice(0, MAX_RUNS);
}

/** One run with its newest events, for the live page. */
export function readRun(dir: string, runId: unknown) {
  const runDir = runDirOf(dir, runId);
  if (!runDir || !fs.existsSync(runDir)) return null;
  return { ...summaryOf(runId as string, runDir, readRecord(runDir)), ...readEvents(runDir) };
}

/**
 * A key screenshot as a data URL. The file must be one a step of the record
 * names, and must resolve (symlinks included) to a regular file inside the run
 * directory.
 */
export function readScreenshot(dir: string, runId: unknown, file: unknown) {
  const runDir = runDirOf(dir, runId);
  if (!runDir || typeof file !== 'string' || !SCREENSHOT_RE.test(file)) return { ok: false as const, error: 'invalid' };
  const result = readRecord(runDir);
  if (!result.ok || !result.record.steps.some((step) => step.screenshots.some((shot) => shot.file === file))) {
    return { ok: false as const, error: 'unknown' };
  }
  try {
    const realRun = fs.realpathSync(runDir);
    const real = fs.realpathSync(path.join(runDir, file));
    if (!real.startsWith(realRun + path.sep)) return { ok: false as const, error: 'outside' };
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > MAX_SCREENSHOT_BYTES) return { ok: false as const, error: 'too large' };
    const type = IMAGE_TYPES[path.extname(real).slice(1).toLowerCase()] ?? 'application/octet-stream';
    return { ok: true as const, dataUrl: `data:${type};base64,${fs.readFileSync(real).toString('base64')}` };
  } catch {
    return { ok: false as const, error: 'missing' };
  }
}

/**
 * The runs a minted Skill appears in, for the 「来源：Playground」 marker on the
 * Skill detail page: runs on the same chain with a step whose skill-* artifact
 * names this Skill (by id, name, or a version fingerprint).
 */
export function skillSources(dir: string, query: unknown) {
  const q = (query && typeof query === 'object' ? query : {}) as Obj;
  const chain = chainId(q['chainId']);
  const skillId = typeof q['skillId'] === 'string' && /^[1-9][0-9]{0,77}$/.test(q['skillId']) ? q['skillId'] : null;
  if (!chain || !skillId) return [];
  const refs = new Set([skillId, `#${skillId}`]);
  if (typeof q['name'] === 'string' && q['name']) refs.add(q['name']);
  if (Array.isArray(q['fingerprints'])) {
    for (const fp of q['fingerprints'].slice(0, 64)) {
      if (typeof fp === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(fp)) {
        refs.add(fp.toLowerCase().replace(/^0x/, ''));
        refs.add(`0x${fp.toLowerCase().replace(/^0x/, '')}`);
      }
    }
  }
  return listRuns(dir).flatMap((run) => {
    const record = run.record;
    if (!record || record.run.network.chainId !== chain) return [];
    const steps = record.steps.filter((step) => step.artifacts.some((item) => item.kind.startsWith('skill-') && refs.has(item.ref)));
    if (!steps.length) return [];
    const labelOf = (roleId: string) => record.roles.find((role) => role.id === roleId)?.label ?? roleId;
    return [{
      id: run.id,
      title: record.run.scenario.title,
      status: record.run.status,
      dryRun: record.run.dryRun,
      startedAt: record.run.startedAt,
      mintedBy: [...new Set(steps
        .filter((step) => step.artifacts.some((item) => item.kind === 'skill-mint' && refs.has(item.ref)))
        .map((step) => labelOf(step.role)))],
      steps: steps.length,
      roles: new Set(steps.map((step) => step.role)).size,
      sessions: steps.reduce((sum, step) => sum + step.sessions.length, 0),
    }];
  });
}
