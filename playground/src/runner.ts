// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Run a scenario (#31, G2): each step, in order, is a simulated user either
// speaking a prompt to its own harness or typing an obelisk command. The
// runner never writes Obelisk data itself; it only starts the harness or the
// role's recording shim and writes down what happened (provenance.ts).
// The first failed step stops the run and marks the rest skipped.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { SecretStore } from '../../packages/core/src/keychain.ts';
import { checkCodexLink, harnessAuthEnv, readConfig } from './auth.ts';
import { runHarness } from './harness.ts';
import { captureCommand, obeliskCliEntry, repoRoot, rolePaths } from './home.ts';
import {
  EVENT_SCHEMA,
  PROVENANCE_SCHEMA,
  summarizeTotals,
  type EventType,
  type HarnessKind,
  type PlaygroundEvent,
  type PlaygroundProvenance,
  type StepRecord,
} from './provenance.ts';
import type { CommandLogEntry } from './record-command.ts';
import { readRole, roleEnv } from './roles.ts';
import { promptFor, type LoadedScenario, type RealHarness } from './scenario.ts';

export interface RunOptions {
  home: string;
  /** Use the fake harness for every prompt step: no model, no sign-in needed. */
  dryRun?: boolean;
  /** Overrides the scenario's network.serviceUrl. */
  serviceUrl?: string | null;
  cli?: string;
  store: SecretStore;
  /** Harness executables to use instead of `claude` / `codex` on PATH (tests). */
  bins?: Partial<Record<RealHarness, string>>;
  now?: () => Date;
  /** Called with every event as it is written (the CLI prints them). */
  onEvent?: (event: PlaygroundEvent) => void;
}

const iso = (now: () => Date) => now().toISOString().replace(/\.\d{3}Z$/, 'Z');

function gitCommit(): string | null {
  const out = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() || null : null;
}

function readCommandLog(file: string): CommandLogEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as CommandLogEntry);
}

function runShim(shim: string, argv: string[], env: Record<string, string>, cwd: string, logDir: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const out = createWriteStream(join(logDir, 'cli.out'));
    const child = spawn(shim, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', () => { clearTimeout(timer); resolve(null); });
    child.once('close', (code) => { clearTimeout(timer); out.end(() => resolve(code)); });
  });
}

/** Capture one App page of the role's data; returns why it failed, or null. */
function runCapture(
  capture: { route: string; waitFor: string | null; scrollTo: string | null },
  out: string,
  env: Record<string, string>,
  logDir: string,
  timeoutMs: number,
): Promise<string | null> {
  const { command, args, cwd } = captureCommand();
  const flags = [
    '--route', capture.route, '--out', out,
    ...(capture.waitFor ? ['--wait-for', capture.waitFor] : []),
    ...(capture.scrollTo ? ['--scroll-to', capture.scrollTo] : []),
  ];
  return new Promise((resolve) => {
    let stderr = '';
    const child = spawn(command, [...args, ...flags], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(error.code === 'ENOENT'
        ? `App capture is not available (${command}); build the App first: cd app && npm ci && npx electron-vite build`
        : error.message);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      writeFileSync(join(logDir, 'capture.err'), stderr);
      if (code === 0) return resolve(null);
      const reason = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
      resolve(`capture of ${capture.route} exited with ${code ?? 'a signal'}${reason ? `: ${reason.slice(0, 200)}` : ''}`);
    });
  });
}

export async function runScenario(loaded: LoadedScenario, options: RunOptions): Promise<{ runDir: string; provenance: PlaygroundProvenance }> {
  const { scenario } = loaded;
  const now = options.now ?? (() => new Date());
  const cli = options.cli ?? obeliskCliEntry();
  const serviceUrl = options.serviceUrl ?? scenario.network.serviceUrl;
  const dryRun = options.dryRun ?? false;
  const config = readConfig(options.home);

  // Every role must be prepared, and every harness a prompt step needs must be able to sign in, before anything runs.
  const roles = scenario.roles.map((role) => {
    const record = readRole(options.home, role.id);
    if (!record) throw new Error(`Role ${role.id} is not prepared; run \`playground roles prepare ${loaded.file}\` first.`);
    const kind: HarnessKind = dryRun ? 'fake' : role.harness;
    return { role, record, paths: rolePaths(options.home, role.id), kind };
  });
  const byId = new Map(roles.map((r) => [r.role.id, r]));
  const authEnv = new Map<string, Record<string, string>>();
  if (!dryRun) {
    for (const r of roles) {
      if (!scenario.steps.some((step) => step.role === r.role.id && step.prompt !== null)) continue;
      authEnv.set(r.role.id, await harnessAuthEnv(r.role.harness, r.paths, config, options.store));
    }
  }

  const stamp = iso(now).replace(/[-:]/g, '');
  const runId = `run-${stamp}-${randomBytes(2).toString('hex')}`;
  const runDir = join(options.home, 'runs', runId);
  mkdirSync(join(runDir, 'steps'), { recursive: true });

  const provenance: PlaygroundProvenance = {
    schema: PROVENANCE_SCHEMA,
    run: {
      id: runId,
      scenario: { name: scenario.name, title: scenario.title, file: relative(repoRoot, loaded.file).startsWith('..') ? loaded.file.split('/').pop()! : relative(repoRoot, loaded.file), sha256: loaded.sha256 },
      network: { serviceUrl, chainId: scenario.network.chainId },
      startedAt: iso(now),
      endedAt: null,
      status: 'running',
      dryRun,
      obelisk: { gitCommit: gitCommit() },
    },
    roles: roles.map(({ role, record, kind }) => ({
      id: role.id,
      label: role.label,
      wallet: { address: record.address },
      harness: { kind, version: null, model: dryRun ? 'fake' : role.model },
    })),
    steps: scenario.steps.map((step, index): StepRecord => ({
      id: step.id, index, title: step.title, role: step.role,
      action: step.prompt !== null ? 'prompt' : step.capture ? 'capture' : 'cli',
      scenes: step.scenes, status: 'pending', startedAt: null, endedAt: null,
      harness: null, prompt: null, sessions: [], commands: [], transactions: [], artifacts: [], screenshots: [], error: null,
    })),
    totals: summarizeTotals([], []),
  };

  const provenanceFile = join(runDir, 'provenance.json');
  const save = () => {
    provenance.totals = summarizeTotals(provenance.roles, provenance.steps);
    writeFileSync(`${provenanceFile}.tmp`, `${JSON.stringify(provenance, null, 2)}\n`);
    renameSync(`${provenanceFile}.tmp`, provenanceFile);
  };
  let seq = 0;
  const emit = (type: EventType, stepId: string | null, role: string | null, text: string, data: Record<string, unknown> = {}) => {
    const event: PlaygroundEvent = { schema: EVENT_SCHEMA, runId, seq: ++seq, at: iso(now), type, stepId, role, text, data };
    appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    options.onEvent?.(event);
  };

  save();
  emit('run.started', null, null, `运行开始 · 剧本「${scenario.title}」${dryRun ? '（演练：不调用模型）' : ''}`, { scenario: scenario.name, chainId: scenario.network.chainId, dryRun });

  let failed: string | null = null;
  for (const [index, step] of scenario.steps.entries()) {
    const record = provenance.steps[index]!;
    const r = byId.get(step.role)!;
    if (failed) { record.status = 'skipped'; continue; }
    const label = r.role.label;
    const logDir = join(runDir, 'steps', step.id);
    mkdirSync(logDir, { recursive: true });
    const commandLog = join(logDir, 'commands.jsonl');
    const env = { ...roleEnv(r.paths, { id: r.role.id, cli, serviceUrl, commandLog }), ...(authEnv.get(r.role.id) ?? {}) };
    record.status = 'running';
    record.startedAt = iso(now);
    save();
    emit('step.started', step.id, r.role.id, `${label}：${step.title}`);

    let error: string | null = null;
    if (step.prompt !== null) {
      const prompt = dryRun ? step.prompt : promptFor(step, r.role.harness);
      record.prompt = prompt;
      const result = await runHarness({
        kind: r.kind,
        prompt,
        model: dryRun ? null : step.model ?? r.role.model,
        maxTurns: step.maxTurns,
        timeoutMs: step.timeoutMinutes * 60_000,
        cwd: r.paths.workspace,
        env,
        obeliskHome: r.paths.obeliskHome,
        logDir,
        fakeCommands: step.fakeCommands,
        bin: dryRun ? undefined : options.bins?.[r.role.harness],
      });
      record.harness = { kind: result.kind, version: result.version, model: result.model, maxTurns: result.maxTurns };
      const roleRecord = provenance.roles.find((role) => role.id === r.role.id)!;
      roleRecord.harness = { kind: result.kind, version: result.version, model: result.model ?? roleRecord.harness.model };
      for (const session of result.sessions) {
        record.sessions.push(session);
        emit('session', step.id, r.role.id, `${label} 产生 session ${session.id.slice(0, 8)}…`, { ...session });
      }
      error = result.error;
      if (r.kind === 'codex') error = error ?? checkCodexLink(r.paths, config);
    } else if (step.capture) {
      const file = `screenshots/${step.id}.png`;
      mkdirSync(join(runDir, 'screenshots'), { recursive: true });
      error = await runCapture(step.capture, join(runDir, file), env, logDir, step.timeoutMinutes * 60_000);
      if (!error) {
        const shot = { file, caption: step.capture.caption };
        record.screenshots.push(shot);
        emit('screenshot', step.id, r.role.id, `截图：${shot.caption}`, { ...shot, route: step.capture.route });
      }
    } else {
      const code = await runShim(join(r.paths.bin, 'obelisk'), step.cli!, env, r.paths.workspace, logDir, step.timeoutMinutes * 60_000);
      if (code !== 0) error = `obelisk ${step.cli!.join(' ')} exited with ${code ?? 'an error'}`;
    }

    for (const entry of readCommandLog(commandLog)) {
      const name = entry.argv.slice(0, 2).join(' ');
      record.commands.push({ argv: entry.argv, exitCode: entry.exitCode, startedAt: entry.startedAt.replace(/\.\d{3}Z$/, 'Z'), endedAt: entry.endedAt.replace(/\.\d{3}Z$/, 'Z'), transactions: entry.transactions.map((tx) => tx.hash) });
      emit('command', step.id, r.role.id, `${label} 运行 obelisk ${name}${entry.exitCode === 0 ? '' : `（退出码 ${entry.exitCode}）`}`, { argv: entry.argv, exitCode: entry.exitCode });
      for (const tx of entry.transactions) {
        const ref = { hash: tx.hash, chainId: tx.chainId ?? scenario.network.chainId, explorerUrl: tx.explorerUrl, command: name };
        record.transactions.push(ref);
        emit('transaction', step.id, r.role.id, `${label} 发出交易（obelisk ${name}）`, { ...ref });
      }
      for (const artifact of entry.artifacts) {
        record.artifacts.push(artifact);
        emit('artifact', step.id, r.role.id, `${label} 产出 ${artifact.kind}：${artifact.ref}`, { ...artifact });
      }
    }

    record.status = error ? 'failed' : 'succeeded';
    record.error = error;
    record.endedAt = iso(now);
    if (error) failed = `${step.id}: ${error}`;
    save();
    emit('step.finished', step.id, r.role.id, error ? `失败：${error}` : '完成', { status: record.status, error });
  }

  provenance.run.status = failed ? 'failed' : 'succeeded';
  provenance.run.endedAt = iso(now);
  save();
  emit('run.finished', null, null, failed ? `运行结束 · 失败（${failed}）` : '运行结束 · 成功', { status: provenance.run.status, error: failed });
  return { runDir, provenance };
}
