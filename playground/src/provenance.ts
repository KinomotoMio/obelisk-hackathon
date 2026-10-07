// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The record every Playground run leaves behind (#31), and the event stream
// the live page reads while it runs (#32). Both live in the run directory:
//
//   <playground home>/runs/<run id>/provenance.json   the record, rewritten as the run goes
//   <playground home>/runs/<run id>/events.jsonl      one PlaygroundEvent per line, append-only
//   <playground home>/runs/<run id>/screenshots/      files named in step.screenshots
//
// The record says how every piece of Playground data was produced: which run
// and scenario, which simulated user (wallet), which harness and model, the
// sessions it produced, the Obelisk commands it ran and the transactions those
// sent. It holds identifiers only, never transcript text or command output, so
// it can be exported next to the data it explains. Paths in it are relative to
// the run directory.

export const PROVENANCE_SCHEMA = 'obelisk.playground.provenance/1';
export const EVENT_SCHEMA = 'obelisk.playground.event/1';

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'aborted';
export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
/** `fake` is the scripted stand-in used by tests and dry runs; it never calls a model. */
export type HarnessKind = 'claude-code' | 'codex' | 'fake';
/** How the simulated user acts: speaks a prompt to its harness, or types an `obelisk` command. */
export type StepAction = 'prompt' | 'cli';

export interface HarnessInfo {
  kind: HarnessKind;
  /** `claude --version` / `codex --version` as printed, e.g. "2.1.292 (Claude Code)". */
  version: string | null;
  /** The model the harness reported using, else the one requested. */
  model: string | null;
}

export interface SessionRef {
  /** Obelisk `source` of the session: claude, codex, … */
  source: string;
  /** The harness's own id (Claude Code session id, Codex thread id). */
  id: string;
  /** The id Obelisk indexes it under (Codex ids are prefixed `codex:`). */
  obeliskId: string;
}

export interface TransactionRef {
  hash: string;
  chainId: number | null;
  explorerUrl: string | null;
  /** The obelisk subcommand that sent it, e.g. "skill mint", "share send". */
  command: string;
}

export interface CommandRecord {
  /** Arguments after `obelisk`, e.g. ["skill", "mint", "ai-resume", "--confirm", "<fingerprint>"]. */
  argv: string[];
  exitCode: number;
  startedAt: string;
  endedAt: string;
  /** Transaction hashes found in this command's JSON output. */
  transactions: string[];
}

export interface ArtifactRef {
  /** What was produced: skill-draft, skill-mint, skill-fetch, share, usage-report, wallet, … */
  kind: string;
  /** Its identifier: Skill name, fingerprint or skill id, share id, wallet address, … */
  ref: string;
}

export interface ScreenshotRef {
  /** Relative to the run directory, e.g. "screenshots/03-read-receipt.png". */
  file: string;
  caption: string;
}

export interface StepRecord {
  id: string;
  /** 0-based position in the scenario. */
  index: number;
  title: string;
  /** Role id from `roles`. */
  role: string;
  action: StepAction;
  /** Scene tags the scenario says this step covers (v1:… or user:…), for the task list. */
  scenes: string[];
  status: StepStatus;
  startedAt: string | null;
  endedAt: string | null;
  /** For prompt steps: the harness that ran it and its turn limit. */
  harness: (HarnessInfo & { maxTurns: number | null }) | null;
  /** For prompt steps: the prompt as spoken, the same text an App button copies. */
  prompt: string | null;
  sessions: SessionRef[];
  commands: CommandRecord[];
  transactions: TransactionRef[];
  artifacts: ArtifactRef[];
  screenshots: ScreenshotRef[];
  /** Why the step failed, in one line; null otherwise. */
  error: string | null;
}

export interface RoleRecord {
  id: string;
  label: string;
  wallet: { address: string | null };
  harness: HarnessInfo;
}

export interface PlaygroundProvenance {
  schema: typeof PROVENANCE_SCHEMA;
  run: {
    id: string;
    scenario: { name: string; title: string; file: string; sha256: string };
    network: { serviceUrl: string | null; chainId: number | null };
    startedAt: string;
    endedAt: string | null;
    status: RunStatus;
    /** True when every harness was `fake`: the pipeline ran, no model and no chain were used. */
    dryRun: boolean;
    obelisk: { gitCommit: string | null };
  };
  roles: RoleRecord[];
  steps: StepRecord[];
  totals: {
    roles: number;
    steps: number;
    sessions: number;
    commands: number;
    transactions: number;
    screenshots: number;
  };
}

export type EventType =
  | 'run.started'
  | 'run.finished'
  | 'step.started'
  | 'step.finished'
  | 'session'
  | 'command'
  | 'transaction'
  | 'artifact'
  | 'screenshot'
  | 'note';

export interface PlaygroundEvent {
  schema: typeof EVENT_SCHEMA;
  runId: string;
  /** 1, 2, 3 … within the run, in write order. */
  seq: number;
  at: string;
  type: EventType;
  stepId: string | null;
  role: string | null;
  /** One human-readable line for the live page, in the scenario's language. */
  text: string;
  /**
   * Type-specific details, mirroring the record: SessionRef for `session`,
   * CommandRecord for `command`, TransactionRef for `transaction`, ArtifactRef
   * for `artifact`, ScreenshotRef for `screenshot`, { status, error } for
   * `step.finished` and `run.finished`.
   */
  data: Record<string, unknown>;
}

export function summarizeTotals(roles: RoleRecord[], steps: StepRecord[]): PlaygroundProvenance['totals'] {
  const count = (pick: (step: StepRecord) => unknown[]) => steps.reduce((n, step) => n + pick(step).length, 0);
  return {
    roles: roles.length,
    steps: steps.length,
    sessions: count((step) => step.sessions),
    commands: count((step) => step.commands),
    transactions: count((step) => step.transactions),
    screenshots: count((step) => step.screenshots),
  };
}

// --- validation ------------------------------------------------------------
// Hand-rolled so the record can be checked without a schema library; returns
// every problem found as "path: message".

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const TX = /^0x[0-9a-fA-F]{64}$/;
const RUN_STATUSES: RunStatus[] = ['running', 'succeeded', 'failed', 'aborted'];
const STEP_STATUSES: StepStatus[] = ['pending', 'running', 'succeeded', 'failed', 'skipped'];
const HARNESSES: HarnessKind[] = ['claude-code', 'codex', 'fake'];
const EVENT_TYPES: EventType[] = ['run.started', 'run.finished', 'step.started', 'step.finished', 'session', 'command', 'transaction', 'artifact', 'screenshot', 'note'];

type Check = (ok: boolean, path: string, message: string) => void;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isStringOrNull = (value: unknown) => value === null || isString(value);
const isTime = (value: unknown) => isString(value) && ISO.test(value);
const isTimeOrNull = (value: unknown) => value === null || isTime(value);
const isIntOrNull = (value: unknown) => value === null || Number.isInteger(value);

function checkHarness(value: unknown, path: string, check: Check) {
  if (!isObject(value)) return check(false, path, 'must be an object');
  check(HARNESSES.includes(value['kind'] as HarnessKind), `${path}.kind`, `must be one of ${HARNESSES.join(', ')}`);
  check(isStringOrNull(value['version']), `${path}.version`, 'must be a string or null');
  check(isStringOrNull(value['model']), `${path}.model`, 'must be a string or null');
}

function checkArray(value: unknown, path: string, check: Check, each: (item: unknown, path: string) => void) {
  if (!Array.isArray(value)) return check(false, path, 'must be an array');
  value.forEach((item, i) => each(item, `${path}[${i}]`));
}

function checkStep(step: unknown, path: string, roleIds: Set<string>, check: Check) {
  if (!isObject(step)) return check(false, path, 'must be an object');
  check(isString(step['id']) && step['id'] !== '', `${path}.id`, 'must be a non-empty string');
  check(Number.isInteger(step['index']), `${path}.index`, 'must be an integer');
  check(isString(step['title']), `${path}.title`, 'must be a string');
  check(isString(step['role']) && roleIds.has(step['role']), `${path}.role`, 'must name a role in roles');
  check(step['action'] === 'prompt' || step['action'] === 'cli', `${path}.action`, 'must be prompt or cli');
  checkArray(step['scenes'], `${path}.scenes`, check, (s, p) => check(isString(s), p, 'must be a string'));
  check(STEP_STATUSES.includes(step['status'] as StepStatus), `${path}.status`, `must be one of ${STEP_STATUSES.join(', ')}`);
  check(isTimeOrNull(step['startedAt']), `${path}.startedAt`, 'must be an ISO UTC time or null');
  check(isTimeOrNull(step['endedAt']), `${path}.endedAt`, 'must be an ISO UTC time or null');
  if (step['harness'] !== null) {
    checkHarness(step['harness'], `${path}.harness`, check);
    if (isObject(step['harness'])) check(isIntOrNull(step['harness']['maxTurns']), `${path}.harness.maxTurns`, 'must be an integer or null');
  }
  check(isStringOrNull(step['prompt']), `${path}.prompt`, 'must be a string or null');
  checkArray(step['sessions'], `${path}.sessions`, check, (s, p) => {
    check(isObject(s) && isString(s['source']) && isString(s['id']) && isString(s['obeliskId']), p, 'must have string source, id and obeliskId');
  });
  checkArray(step['commands'], `${path}.commands`, check, (c, p) => {
    if (!isObject(c)) return check(false, p, 'must be an object');
    check(Array.isArray(c['argv']) && c['argv'].every(isString), `${p}.argv`, 'must be an array of strings');
    check(Number.isInteger(c['exitCode']), `${p}.exitCode`, 'must be an integer');
    check(isTime(c['startedAt']) && isTime(c['endedAt']), p, 'must have ISO UTC startedAt and endedAt');
    check(Array.isArray(c['transactions']) && c['transactions'].every((h) => isString(h) && TX.test(h)), `${p}.transactions`, 'must be an array of 0x transaction hashes');
  });
  checkArray(step['transactions'], `${path}.transactions`, check, (t, p) => {
    if (!isObject(t)) return check(false, p, 'must be an object');
    check(isString(t['hash']) && TX.test(t['hash']), `${p}.hash`, 'must be a 0x transaction hash');
    check(isIntOrNull(t['chainId']), `${p}.chainId`, 'must be an integer or null');
    check(isStringOrNull(t['explorerUrl']), `${p}.explorerUrl`, 'must be a string or null');
    check(isString(t['command']), `${p}.command`, 'must be a string');
  });
  checkArray(step['artifacts'], `${path}.artifacts`, check, (a, p) => {
    check(isObject(a) && isString(a['kind']) && isString(a['ref']), p, 'must have string kind and ref');
  });
  checkArray(step['screenshots'], `${path}.screenshots`, check, (s, p) => {
    check(isObject(s) && isString(s['file']) && !s['file'].startsWith('/') && isString(s['caption']), p, 'must have a relative file and a caption');
  });
  check(isStringOrNull(step['error']), `${path}.error`, 'must be a string or null');
}

export function validateProvenance(value: unknown): string[] {
  const problems: string[] = [];
  const check: Check = (ok, path, message) => { if (!ok) problems.push(`${path}: ${message}`); };
  if (!isObject(value)) return ['provenance: must be an object'];
  check(value['schema'] === PROVENANCE_SCHEMA, 'schema', `must be ${PROVENANCE_SCHEMA}`);

  const run = value['run'];
  if (!isObject(run)) {
    check(false, 'run', 'must be an object');
  } else {
    check(isString(run['id']) && run['id'] !== '', 'run.id', 'must be a non-empty string');
    const scenario = run['scenario'];
    check(isObject(scenario) && ['name', 'title', 'file', 'sha256'].every((k) => isString(scenario[k])), 'run.scenario', 'must have string name, title, file and sha256');
    const network = run['network'];
    check(isObject(network) && isStringOrNull(network['serviceUrl']) && isIntOrNull(network['chainId']), 'run.network', 'must have serviceUrl (string or null) and chainId (integer or null)');
    check(isTime(run['startedAt']), 'run.startedAt', 'must be an ISO UTC time');
    check(isTimeOrNull(run['endedAt']), 'run.endedAt', 'must be an ISO UTC time or null');
    check(RUN_STATUSES.includes(run['status'] as RunStatus), 'run.status', `must be one of ${RUN_STATUSES.join(', ')}`);
    check(typeof run['dryRun'] === 'boolean', 'run.dryRun', 'must be a boolean');
    check(isObject(run['obelisk']) && isStringOrNull(run['obelisk']['gitCommit']), 'run.obelisk', 'must have gitCommit (string or null)');
  }

  const roleIds = new Set<string>();
  checkArray(value['roles'], 'roles', check, (role, p) => {
    if (!isObject(role)) return check(false, p, 'must be an object');
    check(isString(role['id']) && role['id'] !== '' && !roleIds.has(role['id']), `${p}.id`, 'must be a unique non-empty string');
    if (isString(role['id'])) roleIds.add(role['id']);
    check(isString(role['label']), `${p}.label`, 'must be a string');
    check(isObject(role['wallet']) && isStringOrNull(role['wallet']['address']), `${p}.wallet`, 'must have address (string or null)');
    checkHarness(role['harness'], `${p}.harness`, check);
  });

  const stepIds = new Set<string>();
  checkArray(value['steps'], 'steps', check, (step, p) => {
    checkStep(step, p, roleIds, check);
    if (isObject(step) && isString(step['id'])) {
      check(!stepIds.has(step['id']), `${p}.id`, 'must be unique');
      stepIds.add(step['id']);
    }
  });

  const totals = value['totals'];
  check(isObject(totals) && ['roles', 'steps', 'sessions', 'commands', 'transactions', 'screenshots'].every((k) => Number.isInteger(totals[k])), 'totals', 'must have integer roles, steps, sessions, commands, transactions and screenshots');
  if (problems.length === 0) {
    const expected = summarizeTotals(value['roles'] as RoleRecord[], value['steps'] as StepRecord[]);
    check(JSON.stringify(expected) === JSON.stringify(totals), 'totals', `must match the roles and steps (${JSON.stringify(expected)})`);
  }
  return problems;
}

export function validateEvent(value: unknown): string[] {
  const problems: string[] = [];
  const check: Check = (ok, path, message) => { if (!ok) problems.push(`${path}: ${message}`); };
  if (!isObject(value)) return ['event: must be an object'];
  check(value['schema'] === EVENT_SCHEMA, 'schema', `must be ${EVENT_SCHEMA}`);
  check(isString(value['runId']) && value['runId'] !== '', 'runId', 'must be a non-empty string');
  check(Number.isInteger(value['seq']) && (value['seq'] as number) >= 1, 'seq', 'must be an integer from 1');
  check(isTime(value['at']), 'at', 'must be an ISO UTC time');
  check(EVENT_TYPES.includes(value['type'] as EventType), 'type', `must be one of ${EVENT_TYPES.join(', ')}`);
  check(isStringOrNull(value['stepId']), 'stepId', 'must be a string or null');
  check(isStringOrNull(value['role']), 'role', 'must be a string or null');
  check(isString(value['text']), 'text', 'must be a string');
  check(isObject(value['data']), 'data', 'must be an object');
  return problems;
}
