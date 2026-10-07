// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Run one prompt as a simulated user, headless, in its own harness:
//
//   claude-code  claude -p <prompt> --output-format stream-json --max-turns <n>
//                (session id and model from the `system/init` line, outcome from `result`)
//   codex        codex exec --json <prompt>
//                (session id from `thread.started`; codex exec has no turn limit,
//                so the step timeout is the only bound)
//   fake         playground/src/fake-harness.ts, which speaks the Claude Code
//                stream format and runs the step's `fake.commands` through the
//                role's obelisk shim; no model is called
//
// The raw output goes to the step directory for debugging; only ids, the
// model and the outcome reach the provenance record.

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './home.ts';
import type { HarnessKind, SessionRef } from './provenance.ts';

export interface HarnessRequest {
  kind: HarnessKind;
  prompt: string;
  model: string | null;
  maxTurns: number;
  timeoutMs: number;
  cwd: string;
  env: Record<string, string>;
  /** Codex needs write access to the role's Obelisk data directory. */
  obeliskHome: string;
  /** Raw harness stdout/stderr are written here. */
  logDir: string;
  /** For `fake`: obelisk commands to run. */
  fakeCommands?: string[][];
  /** Override the harness executable (tests). */
  bin?: string;
}

export interface HarnessResult {
  kind: HarnessKind;
  version: string | null;
  model: string | null;
  maxTurns: number | null;
  sessions: SessionRef[];
  error: string | null;
}

/** Tools a Claude Code role may use without a prompt; the obelisk skills grant the rest. */
export const CLAUDE_ALLOWED_TOOLS = ['Skill', 'Read', 'Write', 'Bash(obelisk:*)', 'Bash(mktemp:*)'];

const FAKE_HARNESS = join(repoRoot, 'playground', 'src', 'fake-harness.ts');

interface Adapter {
  command: string;
  args: string[];
  maxTurns: number | null;
  onLine(event: Record<string, unknown>, result: HarnessResult): void;
  sessionFrom(id: string): SessionRef;
}

function oneLine(text: unknown, limit = 200): string {
  return String(text ?? '').trim().split('\n')[0]!.slice(0, limit);
}

function claudeAdapter(req: HarnessRequest, command: string, args: string[]): Adapter {
  return {
    command,
    args,
    maxTurns: req.maxTurns,
    sessionFrom: (id) => ({ source: 'claude', id, obeliskId: id }),
    onLine(event, result) {
      if (event['type'] === 'system' && event['subtype'] === 'init') {
        const id = event['session_id'];
        if (typeof id === 'string' && !result.sessions.some((s) => s.id === id)) result.sessions.push(this.sessionFrom(id));
        if (typeof event['model'] === 'string') result.model = event['model'];
      }
      if (event['type'] === 'result') {
        if (event['subtype'] === 'error_max_turns') result.error = `stopped at the turn limit (${req.maxTurns})`;
        else if (event['is_error'] === true || event['subtype'] !== 'success') result.error = oneLine(event['result'] ?? event['subtype']);
      }
    },
  };
}

function adapterFor(req: HarnessRequest): Adapter {
  if (req.kind === 'claude-code') {
    const args = [
      '-p', req.prompt,
      '--output-format', 'stream-json', '--verbose',
      '--max-turns', String(req.maxTurns),
      '--permission-mode', 'default',
      '--allowedTools', CLAUDE_ALLOWED_TOOLS.join(','),
      ...(req.model ? ['--model', req.model] : []),
    ];
    return claudeAdapter(req, req.bin ?? 'claude', args);
  }
  if (req.kind === 'fake') {
    const args = ['--disable-warning=ExperimentalWarning', req.bin ?? FAKE_HARNESS, '--prompt', req.prompt, '--commands', JSON.stringify(req.fakeCommands ?? [])];
    return claudeAdapter(req, process.execPath, args);
  }
  const args = [
    'exec', '--json', '--skip-git-repo-check',
    '-C', req.cwd,
    '-s', 'workspace-write',
    '--add-dir', req.obeliskHome,
    '-c', 'sandbox_workspace_write.network_access=true',
    ...(req.model ? ['-m', req.model] : []),
    req.prompt,
  ];
  return {
    command: req.bin ?? 'codex',
    args,
    maxTurns: null,
    sessionFrom: (id) => ({ source: 'codex', id, obeliskId: `codex:${id}` }),
    onLine(event, result) {
      if (event['type'] === 'thread.started' && typeof event['thread_id'] === 'string') result.sessions.push(this.sessionFrom(event['thread_id']));
      if (event['type'] === 'turn.failed') {
        const error = event['error'] as Record<string, unknown> | undefined;
        result.error = oneLine(error?.['message'] ?? 'turn failed');
      }
    },
  };
}

const versions = new Map<string, string | null>();

export function harnessVersion(kind: HarnessKind, bin?: string): string | null {
  if (kind === 'fake') return 'fake-harness';
  const command = bin ?? (kind === 'claude-code' ? 'claude' : 'codex');
  if (!versions.has(command)) {
    const out = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 20_000 });
    versions.set(command, out.status === 0 ? oneLine(out.stdout, 80) || null : null);
  }
  return versions.get(command) ?? null;
}

export async function runHarness(req: HarnessRequest): Promise<HarnessResult> {
  const adapter = adapterFor(req);
  const result: HarnessResult = {
    kind: req.kind,
    version: harnessVersion(req.kind, req.kind === 'fake' ? undefined : req.bin),
    model: req.model,
    maxTurns: adapter.maxTurns,
    sessions: [],
    error: null,
  };
  const out = createWriteStream(join(req.logDir, 'harness.jsonl'));
  const err = createWriteStream(join(req.logDir, 'harness.err'));
  const child = spawn(adapter.command, adapter.args, { cwd: req.cwd, env: req.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try { event = JSON.parse(line); } catch { return; }
    if (event && typeof event === 'object') adapter.onLine(event as Record<string, unknown>, result);
  };
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    out.write(chunk);
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handle);
  });
  child.stderr.pipe(err);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, req.timeoutMs);
  const code: number | null = await new Promise((resolve) => {
    child.once('error', (error: NodeJS.ErrnoException) => {
      result.error = error.code === 'ENOENT' ? `${adapter.command} was not found on PATH` : error.message;
      resolve(null);
    });
    child.once('close', (exit) => resolve(exit));
  });
  clearTimeout(timer);
  handle(buffer);
  await Promise.all([new Promise((r) => out.end(r)), new Promise((r) => err.end(r))]);
  if (timedOut) result.error = `timed out after ${Math.round(req.timeoutMs / 60000)} min`;
  else if (code !== 0 && code !== null && !result.error) result.error = `${req.kind} exited with ${code}`;
  if (!result.error && result.sessions.length === 0) result.error = `${req.kind} reported no session`;
  return result;
}
