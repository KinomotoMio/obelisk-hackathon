// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Publishing a finished run to the web (#32):
//
//   npm run playground -- publish <run id> [--out <dir>] [--force] [--check]
//
// copies <playground home>/runs/<id>/ into the service's static files,
// service/public/runs/<id>/ by default, where the run page (/runs/<id>) reads
// it once the Worker is deployed:
//
//   provenance.json   the record, with local paths and the user name replaced
//   events.jsonl      the events, the same way
//   screenshots/…     the screenshots the record lists, without PNG metadata
//   published.json    when, what was replaced, and a sha256 of every file
//
// and lists the run in service/public/runs/index.json. Nothing else in the
// run directory leaves the machine (steps/ holds raw harness output).
//
// Before writing anything the publisher replaces what it knows is private
// (home and temp paths, the Playground and repo directories, the user name,
// local service URLs), then scans the result again; if anything still looks
// private (an e-mail address, a token, an absolute user path, a field named
// like a credential), it refuses and says where. The live server
// (serve.ts) shows runs through the same replacement, masking what the scan
// finds instead of refusing.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { isFixtureRun } from './fixture.ts';
import { repoRoot } from './home.ts';
import { isPng, stripPngMetadata } from './png.ts';
import { validateEvent, validateProvenance, type PlaygroundEvent, type PlaygroundProvenance } from './provenance.ts';

export const PUBLISHED_SCHEMA = 'obelisk.playground.published/1';
export const RUNS_INDEX_SCHEMA = 'obelisk.playground.runs/1';
export const DEFAULT_PUBLISH_DIR = join(repoRoot, 'service', 'public', 'runs');
export const MASK = '‹已隐去›';

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const SHOT = /^screenshots\/[A-Za-z0-9][\w.-]*\.png$/;

// --- What is private -----------------------------------------------------------

export interface PrivacyContext {
  /** Exact local paths and what to write instead, e.g. [home, '~']. */
  paths: [string, string][];
  /** The local user name; replaced wherever it stands as a word. */
  user: string | null;
}

export function privacyContext(playgroundHome: string, { home = homedir(), user = safeUser() }: { home?: string; user?: string | null } = {}): PrivacyContext {
  const paths: [string, string][] = [];
  const add = (path: string, label: string) => {
    for (const variant of new Set([path, realOrSelf(path)])) if (variant && variant !== sep) paths.push([variant, label]);
  };
  add(playgroundHome, '<playground>');
  add(repoRoot, '<repo>');
  add(home, '~');
  // Longest first, so the Playground home inside ~ becomes <playground>, not ~/….
  paths.sort((a, b) => b[0].length - a[0].length);
  return { paths, user: user && user.length >= 3 ? user : null };
}

function safeUser(): string | null {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
}

function realOrSelf(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATH_END = String.raw`(?=$|[\s"'\`),;:\]}>/\\])`;

/** Replacements applied to every string, in order. */
function replacements(ctx: PrivacyContext): [RegExp, string][] {
  return [
    ...ctx.paths.map(([path, label]): [RegExp, string] => [new RegExp(`${escape(path)}${PATH_END}`, 'g'), label]),
    [/(?:\/private)?\/var\/folders\/[^\s"'`),;]+/g, '<tmp>'],
    [/(?<![\w.])\/tmp\/[^\s"'`),;]+/g, '<tmp>'],
    [/\/Users\/[^/\s"'`),;]+/g, '~'],
    [/\/home\/[^/\s"'`),;]+/g, '~'],
    [/[A-Za-z]:\\Users\\[^\\\s"'`),;]+/g, '~'],
    [/\bhttps?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.local)(?::\d+)?[^\s"'`),;]*/g, '<本机服务>'],
    ...(ctx.user ? [[new RegExp(`(?<![\\w.-])${escape(ctx.user)}(?![\\w-])`, 'gi'), '<user>'] as [RegExp, string]] : []),
  ];
}

/** Things that must not be published, looked for after the replacements. */
const FINDINGS: [string, RegExp][] = [
  ['user path', /(?:^|[^\w<])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/],
  ['e-mail address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
  ['API key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['bearer token', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i],
  ['secret assignment', /\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[=:]\s*\S{6,}/],
];
const SECRET_KEY = /^(?:auth|authorization|token|access_?token|refresh_?token|id_?token|secret|client_?secret|password|passwd|cookie|cookies|api_?key|private_?key|credentials?|mnemonic|seed_?phrase)$/i;
const SECRET_FLAG = /^--(?:private-key|key|secret|password|token|api-key|mnemonic)$/;

export interface Finding {
  /** Where, as a JSON path: steps[3].prompt, events[12].data.argv[4], … */
  path: string;
  rule: string;
}

/** A copy of `value` with every string passed through the replacements, and how many strings changed. */
export function scrub<T>(value: T, ctx: PrivacyContext): { value: T; redactions: number } {
  const rules = replacements(ctx);
  let redactions = 0;
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      let out = node;
      for (const [re, label] of rules) out = out.replace(re, label);
      if (out !== node) redactions += 1;
      return out;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return { value: walk(value) as T, redactions };
}

/** Everything in `value` that still looks private. */
export function privacyFindings(value: unknown, root = ''): Finding[] {
  const found: Finding[] = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === 'string') {
      for (const [rule, re] of FINDINGS) if (re.test(node)) found.push({ path, rule });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        if (typeof item === 'string' && i > 0 && SECRET_FLAG.test(String(node[i - 1]))) found.push({ path: `${path}[${i}]`, rule: `value of ${node[i - 1]}` });
        walk(item, `${path}[${i}]`);
      });
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        const at = path ? `${path}.${key}` : key;
        if (SECRET_KEY.test(key)) found.push({ path: at, rule: `field named ${key}` });
        walk(child, at);
      }
    }
  };
  walk(value, root);
  return found;
}

/** `scrub`, then whatever the scan still finds replaced by MASK: for showing a run live, never for publishing. */
export function maskForDisplay<T>(value: T, ctx: PrivacyContext): T {
  const { value: clean } = scrub(value, ctx);
  const walk = (node: unknown, key = ''): unknown => {
    if (typeof node === 'string') {
      let out = node;
      for (const [, re] of FINDINGS) out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), MASK);
      return SECRET_KEY.test(key) ? MASK : out;
    }
    if (Array.isArray(node)) return node.map((item, i) => (i > 0 && SECRET_FLAG.test(String(node[i - 1])) ? MASK : walk(item)));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    return node;
  };
  return walk(clean) as T;
}

/** A local service URL in the record says nothing to a reader and names this machine. */
function publicServiceUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|\[::1\]|0\.0\.0\.0)|\.local$/.test(parsed.hostname) ? parsed.origin : null;
  } catch {
    return null;
  }
}

// --- Reading a run ---------------------------------------------------------------

export class PublishError extends Error {
  readonly findings: Finding[];
  constructor(message: string, findings: Finding[] = []) {
    super(message);
    this.findings = findings;
    this.name = 'PublishError';
  }
}

export function readRunFiles(home: string, runId: string): { runDir: string; record: PlaygroundProvenance; events: PlaygroundEvent[] } {
  if (!RUN_ID.test(runId)) throw new PublishError(`Not a run id: ${runId}`);
  const runDir = join(home, 'runs', runId);
  const recordFile = join(runDir, 'provenance.json');
  if (!existsSync(recordFile)) throw new PublishError(`No run ${runId} in ${join(home, 'runs')}`);
  let record: unknown;
  try {
    record = JSON.parse(readFileSync(recordFile, 'utf8'));
  } catch (error) {
    throw new PublishError(`${runId}/provenance.json is not valid JSON: ${(error as Error).message}`, []);
  }
  const problems = validateProvenance(record);
  if (problems.length) throw new PublishError(`${runId}/provenance.json does not follow the schema: ${problems.slice(0, 5).join('; ')}`);
  const events: PlaygroundEvent[] = [];
  const eventsFile = join(runDir, 'events.jsonl');
  const lines = existsSync(eventsFile) ? readFileSync(eventsFile, 'utf8').split('\n') : [];
  for (const [i, line] of lines.entries()) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new PublishError(`${runId}/events.jsonl line ${i + 1} is not valid JSON`);
    }
    const bad = validateEvent(event);
    if (bad.length) throw new PublishError(`${runId}/events.jsonl line ${i + 1}: ${bad[0]}`);
    if ((event as PlaygroundEvent).runId !== runId) throw new PublishError(`${runId}/events.jsonl line ${i + 1} belongs to run ${(event as PlaygroundEvent).runId}`);
    events.push(event as PlaygroundEvent);
  }
  return { runDir, record: record as PlaygroundProvenance, events };
}

/** The record and events as they may leave the machine, or a PublishError saying what is still private. */
export function sanitizeRun(record: PlaygroundProvenance, events: PlaygroundEvent[], ctx: PrivacyContext) {
  const cleanRecord = scrub(record, ctx);
  const cleanEvents = scrub(events, ctx);
  const value = { ...cleanRecord.value, run: { ...cleanRecord.value.run, network: { ...cleanRecord.value.run.network, serviceUrl: publicServiceUrl(record.run.network.serviceUrl) } } };
  const findings = [...privacyFindings(value), ...privacyFindings(cleanEvents.value, 'events')];
  return { record: value, events: cleanEvents.value, redactions: cleanRecord.redactions + cleanEvents.redactions, findings };
}

// --- Publishing ------------------------------------------------------------------

export interface PublishOptions {
  home: string;
  runId: string;
  outDir?: string;
  force?: boolean;
  /** Check only; write nothing. */
  check?: boolean;
  now?: Date;
  ctx?: PrivacyContext;
}

export interface RunSummary {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  chainId: number | null;
  dryRun: boolean;
  fixture: boolean;
  totals: PlaygroundProvenance['totals'];
  publishedAt: string;
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

export function publishRun(options: PublishOptions) {
  const { home, runId, force = false, check = false, now = new Date() } = options;
  const outDir = resolve(options.outDir ?? DEFAULT_PUBLISH_DIR);
  const ctx = options.ctx ?? privacyContext(home);
  const { runDir, record, events } = readRunFiles(home, runId);
  const fixture = isFixtureRun(runId);
  const intoService = realOrSelf(outDir) === realOrSelf(DEFAULT_PUBLISH_DIR);

  if (record.run.status === 'running') throw new PublishError(`Run ${runId} is still running; publish it once it has finished`);
  if (fixture && intoService) throw new PublishError(`${runId} is the fixture run; it is not evidence and never goes into service/public/runs (use --out <dir> to try the page with it)`);
  if (record.run.dryRun && intoService) throw new PublishError(`${runId} is a dry run: no model and no chain were used, so it is not evidence (use --out <dir> to look at it)`);

  const clean = sanitizeRun(record, events, ctx);
  if (clean.findings.length) {
    throw new PublishError(
      `Run ${runId} still has private-looking data after replacing local paths; nothing was written:\n${clean.findings.map((f) => `  ${f.path}: ${f.rule}`).join('\n')}`,
      clean.findings,
    );
  }

  const files = new Map<string, Buffer>();
  files.set('provenance.json', Buffer.from(`${JSON.stringify(clean.record, null, 2)}\n`));
  files.set('events.jsonl', Buffer.from(clean.events.map((event) => `${JSON.stringify(event)}\n`).join('')));
  const dropped: string[] = [];
  for (const shot of clean.record.steps.flatMap((step) => step.screenshots)) {
    if (!SHOT.test(shot.file)) throw new PublishError(`Screenshot ${shot.file} is not a PNG under screenshots/; nothing was written`);
    const source = join(runDir, shot.file);
    if (!existsSync(source)) throw new PublishError(`Screenshot ${shot.file} is listed in the record but missing; nothing was written`);
    const bytes = readFileSync(source);
    if (!isPng(bytes)) throw new PublishError(`Screenshot ${shot.file} is not a PNG file; nothing was written`);
    const stripped = stripPngMetadata(bytes);
    dropped.push(...stripped.dropped.map((type) => `${shot.file}: ${type}`));
    files.set(shot.file, stripped.png);
  }
  const published = {
    schema: PUBLISHED_SCHEMA,
    runId,
    publishedAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
    fixture,
    redactions: clean.redactions,
    files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) })),
  };
  const target = join(outDir, runId);
  const result = { runId, target, fixture, redactions: clean.redactions, droppedMetadata: dropped, files: published.files, written: false };
  if (check) return result;

  if (existsSync(target) && !force) throw new PublishError(`${target} already exists; pass --force to replace it`);
  mkdirSync(outDir, { recursive: true });
  const staging = join(outDir, `.${runId}.publishing-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'screenshots'), { recursive: true });
  for (const [path, bytes] of files) writeFileSync(join(staging, path), bytes);
  writeFileSync(join(staging, 'published.json'), `${JSON.stringify(published, null, 2)}\n`);
  rmSync(target, { recursive: true, force: true });
  renameSync(staging, target);

  const summary: RunSummary = {
    id: runId,
    title: clean.record.run.scenario.title,
    startedAt: clean.record.run.startedAt,
    endedAt: clean.record.run.endedAt,
    status: clean.record.run.status,
    chainId: clean.record.run.network.chainId,
    dryRun: clean.record.run.dryRun,
    fixture,
    totals: clean.record.totals,
    publishedAt: published.publishedAt,
  };
  writeRunsIndex(outDir, summary);
  return { ...result, written: true };
}

/** service/public/runs/index.json: published runs, newest first. */
export function writeRunsIndex(outDir: string, summary: RunSummary) {
  const file = join(outDir, 'index.json');
  let runs: RunSummary[] = [];
  try {
    const current = JSON.parse(readFileSync(file, 'utf8'));
    if (current?.schema === RUNS_INDEX_SCHEMA && Array.isArray(current.runs)) runs = current.runs;
  } catch {
    runs = [];
  }
  runs = [summary, ...runs.filter((run) => run.id !== summary.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  writeFileSync(file, `${JSON.stringify({ schema: RUNS_INDEX_SCHEMA, runs }, null, 2)}\n`);
}
