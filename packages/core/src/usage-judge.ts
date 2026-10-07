// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The outcome judge (#25, vision 04 "结果判断" layer 2 and "由谁来执行"):
// the user's own AI coding assistant reads what followed each Skill
// invocation and returns its scenes (from the scene vocabulary) and an
// outcome: smooth (顺利), rework (有返工), failed (失败), or unknown (无法判断).
//
// It runs through the local harness, never a hosted API: `codex exec`
// (preferred, the harness background runs use) or `claude -p`, on the user's
// own subscription. Several invocations go in one run, each as a compact
// rendering of its slice only. The run keeps no session of its own
// (`--ephemeral` / `--no-session-persistence`), has no tools or Skills, and
// starts in <data dir>/judge, so it does not show up in the history Obelisk
// indexes.
//
// Codex runs with `--ignore-user-config` (no MCP servers, hooks, notify
// scripts or profiles from config.toml; auth still comes from CODEX_HOME, so
// an isolated CODEX_HOME in the environment is honoured), with its shell,
// memories, apps, plugins and sub-agents off, and with `--output-schema` so
// the answer has the judge's JSON shape.

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { InvocationSlice, SliceEvent } from './invocation-slices.ts';
import { migrateSceneTag, parseSceneTag, SCENES } from './scenes.ts';
import { OUTCOMES, type Outcome } from './usage-buckets.ts';
import type { JudgeHarness } from './usage-annotations.ts';

/** Bump when the prompt or the output contract changes. */
export const JUDGE_PROMPT_VERSION = 1;
export const MAX_JUDGED_SCENES = 3;
const SLICE_CHARS = 5000;
const LINE_CHARS = 300;

export interface JudgeItem {
  /** Short id used inside the prompt (i1, i2, …). */
  id: string;
  skill: { name: string; description: string };
  slice: InvocationSlice;
}

export interface JudgeVerdict {
  outcome: Outcome;
  scenes: string[];
  reason: string;
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function renderEvent(event: SliceEvent): string[] {
  const lines: string[] = [];
  if (event.toolResults.length > 0) {
    for (const result of event.toolResults) if (result.isError) lines.push(`  ← tool error: ${clip(result.text, 200)}`);
    return lines;
  }
  if (event.text.trim()) lines.push(`[${event.role === 'user' ? (event.human ? 'user' : 'context') : 'assistant'}] ${clip(event.text, LINE_CHARS)}`);
  for (const call of event.toolCalls) lines.push(`  → ${call.name}${call.filePath ? ` ${call.filePath}` : ''}`);
  return lines;
}

/** What the judge reads for one invocation: the request, then what followed, cut to SLICE_CHARS. */
export function renderSlice(slice: InvocationSlice): string {
  const lines = slice.request ? [`[user, before the Skill] ${clip(slice.request, LINE_CHARS)}`] : [];
  let used = lines.join('\n').length;
  for (const event of slice.events) {
    for (const line of renderEvent(event)) {
      if (used + line.length + 1 > SLICE_CHARS) {
        lines.push('[… cut]');
        return lines.join('\n');
      }
      lines.push(line);
      used += line.length + 1;
    }
  }
  if (slice.events.length === 0) lines.push('[nothing followed the Skill load]');
  return lines.join('\n');
}

export function buildJudgePrompt(items: readonly JudgeItem[]): string {
  const vocabulary = SCENES.map((scene) => `${scene.id} (${scene.label})`).join(', ');
  return [
    'You judge how well an AI coding assistant did after it loaded a Skill. Do not use tools; answer from the text below only.',
    '',
    'For each item, give:',
    `- outcome: "smooth" (the task went through without redoing work), "rework" (it got there but had to redo or fix things the person pointed out), "failed" (the task was abandoned or ended broken), or "unknown" (the text does not show how it ended). Prefer "unknown" over guessing.`,
    `- scenes: up to ${MAX_JUDGED_SCENES} scene ids from this list that describe what the Skill was used for (not what the Skill says it is for): ${vocabulary}. Use [] if none fits.`,
    '- reason: one short sentence.',
    '',
    'Answer with JSON only, no prose and no code fence:',
    '{"judgments":[{"id":"i1","outcome":"smooth","scenes":["task/debug"],"reason":"…"}]}',
    '',
    ...items.flatMap((item) => [
      `=== ${item.id} · Skill "${item.skill.name}": ${clip(item.skill.description, 200)}`,
      renderSlice(item.slice),
      '',
    ]),
  ].join('\n');
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The judge did not answer with JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/** Verdicts by item id; items the judge skipped or answered badly are left out. */
export function parseJudgeOutput(text: string, ids: readonly string[]): Map<string, JudgeVerdict> {
  const parsed = extractJson(text) as { judgments?: unknown };
  const out = new Map<string, JudgeVerdict>();
  if (!Array.isArray(parsed.judgments)) return out;
  for (const raw of parsed.judgments as Record<string, unknown>[]) {
    const id = typeof raw?.['id'] === 'string' ? raw['id'] : null;
    const outcome = raw?.['outcome'];
    if (!id || !ids.includes(id) || out.has(id) || !OUTCOMES.includes(outcome as Outcome)) continue;
    const scenes: string[] = [];
    for (const tag of Array.isArray(raw['scenes']) ? raw['scenes'] : []) {
      try {
        const parsedTag = parseSceneTag(tag);
        const versioned = parsedTag.kind === 'vocabulary' ? migrateSceneTag(parsedTag.tag) : null;
        if (versioned && !scenes.includes(versioned)) scenes.push(versioned);
      } catch {
        // Not a vocabulary scene: dropped, the vocabulary is the contract.
      }
    }
    out.set(id, {
      outcome: outcome as Outcome,
      scenes: scenes.slice(0, MAX_JUDGED_SCENES),
      reason: typeof raw['reason'] === 'string' ? clip(raw['reason'], 200) : '',
    });
  }
  return out;
}

export interface HarnessRun {
  harness: JudgeHarness;
  prompt: string;
  /** Where the harness starts; created if missing. */
  cwd: string;
  model?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** The JSON Schema the judge's answer must follow (Codex `--output-schema`, strict mode). */
export function judgeOutputSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['judgments'],
    properties: {
      judgments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'outcome', 'scenes', 'reason'],
          properties: {
            id: { type: 'string' },
            outcome: { type: 'string', enum: [...OUTCOMES] },
            scenes: { type: 'array', items: { type: 'string', enum: SCENES.map((scene) => scene.id) } },
            reason: { type: 'string' },
          },
        },
      },
    },
  };
}

/** Codex features a judge run has no use for; unknown keys are ignored by older or newer Codex. */
const CODEX_FEATURES_OFF = ['shell_tool', 'unified_exec', 'memories', 'apps', 'plugins', 'multi_agent', 'browser_use', 'computer_use'];

/** The command line for one judge run; the prompt goes to stdin. */
export function harnessCommand(run: HarnessRun, files: { lastMessage: string; schema: string }): { command: string; args: string[] } {
  if (run.harness === 'claude') {
    return {
      command: 'claude',
      args: ['-p', '--output-format', 'json', '--no-session-persistence', '--tools', '', '--disable-slash-commands', '--strict-mcp-config', '--max-turns', '1', ...(run.model ? ['--model', run.model] : [])],
    };
  }
  return {
    command: 'codex',
    args: [
      'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules',
      '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', '-C', run.cwd,
      ...CODEX_FEATURES_OFF.flatMap((feature) => ['-c', `features.${feature}=false`]),
      '-c', 'web_search="disabled"',
      '--output-schema', files.schema, '-o', files.lastMessage,
      ...(run.model ? ['-m', run.model] : []),
      '-',
    ],
  };
}

/** Run the judge once through the local harness and return its answer text. */
export async function runJudgeHarness(run: HarnessRun): Promise<string> {
  await mkdir(run.cwd, { recursive: true });
  const scratch = await mkdtemp(join(run.cwd, 'run-'));
  const files = { lastMessage: join(scratch, 'last-message.txt'), schema: join(scratch, 'judgment.schema.json') };
  const { command, args } = harnessCommand(run, files);
  try {
    if (run.harness === 'codex') await writeFile(files.schema, JSON.stringify(judgeOutputSchema()));
    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(command, args, { cwd: run.cwd, env: run.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), run.timeoutMs ?? 5 * 60_000);
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ code: status, stdout: out, stderr: err }); });
      child.stdin.end(run.prompt);
    });
    if (code !== 0) throw new Error(`${command} exited with ${code}: ${(stderr || stdout).trim().slice(-500)}`);
    if (run.harness === 'claude') {
      const result = JSON.parse(stdout) as { is_error?: boolean; result?: string; subtype?: string };
      if (result.is_error || typeof result.result !== 'string') throw new Error(`claude did not finish the judgment (${result.subtype ?? 'error'})`);
      return result.result;
    }
    const answer = await readFile(files.lastMessage, 'utf8').catch(() => '');
    if (!answer.trim()) throw new Error(`codex finished without an answer: ${(stderr || stdout).trim().slice(-500)}`);
    return answer;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && String((error as NodeJS.ErrnoException).syscall).startsWith('spawn')) {
      throw new Error(`${command} is not installed or not on PATH; install it or pick the other harness with --harness`, { cause: error });
    }
    throw error;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
