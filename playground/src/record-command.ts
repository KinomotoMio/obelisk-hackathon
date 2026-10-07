// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The `obelisk` a simulated user runs. Each role's bin/obelisk shim execs this
// file; it runs the real CLI with the same arguments, passes its output
// through unchanged, and appends one line to OBELISK_PLAYGROUND_COMMAND_LOG:
// the arguments, exit code, times, and the transactions and artifacts found
// in the JSON output. The output itself is never stored: it can hold session
// content (share outline) that does not belong in a provenance record.

import { spawn } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ArtifactRef } from './provenance.ts';

export interface RecordedTransaction {
  hash: string;
  explorerUrl: string | null;
  chainId: number | null;
}

export interface CommandLogEntry {
  argv: string[];
  exitCode: number;
  startedAt: string;
  endedAt: string;
  transactions: RecordedTransaction[];
  artifacts: ArtifactRef[];
}

const TX = /^0x[0-9a-fA-F]{64}$/;
const MAX_CAPTURE = 4 * 1024 * 1024;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function walk(value: unknown, visit: (obj: Obj) => void) {
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else if (isObject(value)) {
    visit(value);
    Object.values(value).forEach((item) => walk(item, visit));
  }
}

/** Transaction hashes in an obelisk command's JSON output (`transaction` / `txHash` fields). */
export function extractTransactions(output: unknown): RecordedTransaction[] {
  const found = new Map<string, RecordedTransaction>();
  walk(output, (obj) => {
    for (const key of ['transaction', 'txHash']) {
      const hash = obj[key];
      if (typeof hash !== 'string' || !TX.test(hash) || found.has(hash.toLowerCase())) continue;
      const explorer = obj['explorer'];
      const explorerUrl = typeof explorer === 'string' ? explorer
        : isObject(explorer) && typeof explorer['transaction'] === 'string' ? explorer['transaction'] : null;
      const chainId = Number.isInteger(obj['chainId']) ? (obj['chainId'] as number) : null;
      found.set(hash.toLowerCase(), { hash, explorerUrl, chainId });
    }
  });
  return [...found.values()];
}

/** What a successful command produced, by subcommand. */
export function extractArtifacts(argv: string[], output: unknown): ArtifactRef[] {
  if (!isObject(output)) return [];
  const str = (key: string) => (typeof output[key] === 'string' && output[key] !== '' ? (output[key] as string) : null);
  const [group, action] = argv;
  const one = (kind: string, ref: string | null): ArtifactRef[] => (ref ? [{ kind, ref }] : []);
  // Previews can expose useful content, but are not a mint/install/share.
  if (output['preview'] === true) return one(`${group}-${action}-preview`, str('name') ?? str('skill') ?? str('skillId') ?? str('address'));
  if (group === 'skill' && action === 'save') return one('skill-draft', str('name'));
  if (group === 'skill' && action === 'mint') return one('skill-mint', str('skillId') ?? str('skill'));
  if (group === 'skill' && action === 'fetch') return one('skill-fetch', str('name') ?? str('skillId'));
  if (group === 'share' && action === 'send') return one('share', str('shareId'));
  if (group === 'wallet') return one('wallet', str('address'));
  if (group === 'usage' && action === 'report') return extractTransactions(output).map((tx) => ({ kind: 'usage-report', ref: tx.hash }));
  return [];
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function main(argv: string[]) {
  const cli = process.env['OBELISK_PLAYGROUND_CLI'];
  const log = process.env['OBELISK_PLAYGROUND_COMMAND_LOG'];
  if (!cli) {
    process.stderr.write('OBELISK_PLAYGROUND_CLI is not set; this shim only runs inside an Obelisk Playground role.\n');
    process.exit(2);
  }
  const startedAt = new Date().toISOString();
  const [command, args] = /\.(?:c|m)?[jt]s$/.test(cli)
    ? [process.execPath, ['--disable-warning=ExperimentalWarning', cli, ...argv]]
    : [cli, argv];
  const realHome = process.env['OBELISK_PLAYGROUND_REAL_HOME'];
  const env = realHome ? { ...process.env, HOME: realHome } : process.env;
  const child = spawn(command, args, { env, stdio: ['inherit', 'pipe', 'inherit'] });
  let captured = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    process.stdout.write(chunk);
    if (captured.length < MAX_CAPTURE) captured += chunk;
  });
  const exitCode: number = await new Promise((resolve) => {
    child.once('error', (error) => { process.stderr.write(`${error.message}\n`); resolve(127); });
    child.once('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  if (log) {
    const output = parseJson(captured);
    const entry: CommandLogEntry = {
      argv,
      exitCode,
      startedAt,
      endedAt: new Date().toISOString(),
      transactions: extractTransactions(output),
      artifacts: exitCode === 0 ? extractArtifacts(argv, output) : [],
    };
    appendFileSync(log, `${JSON.stringify(entry)}\n`);
  }
  process.exitCode = exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  void main(process.argv.slice(2));
}
