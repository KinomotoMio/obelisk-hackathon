// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// A stand-in for `claude -p` used by tests and `playground run --dry-run`. It
// speaks the Claude Code stream-json format, runs the step's obelisk commands
// through the role's PATH (so the recording shim sees them exactly as it
// would see a real agent's), and leaves a small transcript in the role's
// CLAUDE_CONFIG_DIR so the role's own index has a session to find. No model
// is called.
//
//   node fake-harness.ts --prompt <text> --commands '[["skill","scenes"]]'

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const prompt = arg('--prompt') ?? '';
const commands = JSON.parse(arg('--commands') ?? '[]') as string[][];
const sessionId = randomUUID();
const print = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);

let transcript: string | null = null;
let parent: string | null = null;
const configDir = process.env['CLAUDE_CONFIG_DIR'];
if (configDir) {
  const dir = join(configDir, 'projects', process.env['CLAUDE_CODE_PROJECT_DIR_NAME'] || 'workspace');
  mkdirSync(dir, { recursive: true });
  transcript = join(dir, `${sessionId}.jsonl`);
}
const record = (type: 'user' | 'assistant', text: string) => {
  if (!transcript) return;
  const uuid = randomUUID();
  appendFileSync(transcript, `${JSON.stringify({
    type, uuid, parentUuid: parent, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString(),
    message: type === 'user' ? { role: 'user', content: text } : { role: 'assistant', model: 'fake', content: [{ type: 'text', text }] },
  })}\n`);
  parent = uuid;
};

print({ type: 'system', subtype: 'init', session_id: sessionId, model: 'fake', cwd: process.cwd() });
record('user', prompt);
let failed: string | null = null;
for (const command of commands) {
  const run = spawnSync('obelisk', command, { encoding: 'utf8', env: process.env });
  const ok = run.status === 0;
  print({ type: 'assistant', session_id: sessionId, message: { role: 'assistant', content: [{ type: 'text', text: `obelisk ${command.join(' ')} → exit ${run.status}` }] } });
  if (!ok && !failed) failed = `obelisk ${command.join(' ')} exited with ${run.status ?? run.error?.message}`;
}
record('assistant', failed ?? 'done');
print({ type: 'result', subtype: failed ? 'error_during_execution' : 'success', is_error: Boolean(failed), session_id: sessionId, num_turns: commands.length + 1, result: failed ?? 'done' });
