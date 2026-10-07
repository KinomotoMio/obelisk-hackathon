// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk usage judge [--harness codex|claude] [--limit <n>] [--batch <n>] [--model <name>] [--completed-run <provenance.json>] [--confirm]` (#25).
//
// Has the user's own AI coding assistant judge the scenes and outcome of
// Skill invocations that will be reported (minted or fetched versions), a
// few per run. Without --confirm it only previews: how many invocations, how
// many runs of which harness, and what text each run reads. Judgments are
// stored locally (usage-annotations.ts) and never redone, so the command can
// be run again after an interruption; `obelisk usage report` then carries
// their scenes and outcomes.

import { accessSync, constants, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { withSkillInvocations } from '../../core/src/core.ts';
import { readInvocationSlice } from '../../core/src/invocation-slices.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import { skillVersionsByFingerprint } from '../../core/src/skill-invocations.ts';
import { listSkillFetches } from '../../core/src/skill-fetches.ts';
import { readSkill } from '../../core/src/skills.ts';
import {
  countSettledSignals,
  isSettled,
  readUsageAnnotations,
  writeUsageAnnotations,
  type JudgeHarness,
} from '../../core/src/usage-annotations.ts';
import { buildJudgePrompt, JUDGE_PROMPT_VERSION, parseJudgeOutput, runJudgeHarness, type JudgeItem } from '../../core/src/usage-judge.ts';
import { reportableFingerprints } from '../../core/src/usage-report.ts';
import type { UsageDeps } from './usage-command.ts';

export const USAGE_JUDGE_USAGE = 'Usage: obelisk usage judge [--harness codex|claude] [--limit <n>] [--batch <n>] [--model <name>] [--completed-run <provenance.json>] [--confirm]';

const DEFAULT_LIMIT = 20;
const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;

interface JudgeOptions {
  harness: JudgeHarness | null;
  limit: number;
  batch: number;
  model: string | null;
  confirm: boolean;
  completedRun: string | null;
}

function onPath(command: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

function pickHarness(requested: JudgeHarness | null, env: NodeJS.ProcessEnv): JudgeHarness {
  if (requested) return requested;
  if (onPath('codex', env)) return 'codex';
  if (onPath('claude', env)) return 'claude';
  throw new Error('Neither Codex (`codex`) nor Claude Code (`claude`) is on PATH; the judge runs through one of them on this computer');
}

const HARNESS_NAME: Record<JudgeHarness, string> = { claude: 'Claude Code', codex: 'Codex' };

/** A finished headless run can be judged without the interactive quiet window. */
function completedSessions(file: string | null): Map<string, number> {
  if (!file) return new Map();
  const proof = JSON.parse(readFileSync(file, 'utf8'));
  if (proof?.schema !== 'obelisk.playground.provenance/1' || proof.run?.dryRun !== false ||
      proof.run?.status !== 'succeeded' || !Number.isFinite(Date.parse(proof.run?.endedAt)) || !Array.isArray(proof.steps)) {
    throw new Error('--completed-run requires a successfully finished, real Playground run');
  }
  const sessions = new Map<string, number>();
  for (const step of proof.steps) {
    if (step.status !== 'succeeded' || !Number.isFinite(Date.parse(step.endedAt))) continue;
    for (const session of step.sessions ?? []) {
      if (typeof session.obeliskId === 'string') sessions.set(session.obeliskId, Date.parse(step.endedAt) + 999);
    }
  }
  return sessions;
}

async function judge(options: JudgeOptions, deps: UsageDeps) {
  const completed = completedSessions(options.completedRun);
  const env = deps.env ?? process.env;
  const paths = resolveObeliskPaths({ env });
  const harness = pickHarness(options.harness, env);
  const now = deps.now?.() ?? new Date();
  const versions = await skillVersionsByFingerprint(paths.skillsDir);
  const reportable = reportableFingerprints(versions);
  const annotations = await readUsageAnnotations(paths.dataDir);
  const descriptions = new Map<string, string>();
  const fetched = await listSkillFetches(paths.skillsDir);
  for (const matches of versions.values()) {
    for (const match of matches) {
      const key = `${match.name}:${match.fingerprint}`;
      if (!descriptions.has(key)) descriptions.set(key, match.state === 'fetched'
        ? fetched.findLast((record) => record.name === match.name && record.fingerprint === match.fingerprint)?.description ?? ''
        : (await readSkill(paths.skillsDir, match.name))?.description ?? '');
    }
  }

  // Read the slices while the index is open; the harness runs after it closes.
  const { pending, items } = await withSkillInvocations(async (db, invocations) => {
    if (countSettledSignals(db, invocations, annotations, now, (item) => reportable.has(item.fingerprint ?? '')) > 0) {
      await writeUsageAnnotations(paths.dataDir, annotations);
    }
    const candidates: { invocation: (typeof invocations)[number]; slice: ReturnType<typeof readInvocationSlice> }[] = [];
    let waiting = 0;
    for (const invocation of invocations) {
      if (invocation.fingerprint === null || !reportable.has(invocation.fingerprint)) continue;
      const record = annotations.invocations[invocation.messageUuid];
      if (record?.judgment?.promptVersion === JUDGE_PROMPT_VERSION && record.fingerprint === invocation.fingerprint) continue;
      const slice = readInvocationSlice(db, invocation);
      const endedAt = completed.get(invocation.sessionId);
      const completedHere = endedAt !== undefined && slice.sessionLastAt !== null && Date.parse(slice.sessionLastAt) <= endedAt;
      if (!isSettled(slice.sessionLastAt, now) && !completedHere) continue;
      waiting += 1;
      if (candidates.length < options.limit) candidates.push({ invocation, slice });
    }
    return { pending: waiting, items: candidates };
  });

  const bySkill = new Map<string, number>();
  for (const { invocation } of items) {
    const name = versions.get(invocation.fingerprint!)?.[0]?.name ?? 'unknown';
    bySkill.set(name, (bySkill.get(name) ?? 0) + 1);
  }
  const runs = Math.ceil(items.length / options.batch);
  const flags = [
    options.harness ? ` --harness ${harness}` : '',
    options.limit !== DEFAULT_LIMIT ? ` --limit ${options.limit}` : '',
    options.batch !== DEFAULT_BATCH ? ` --batch ${options.batch}` : '',
    options.model ? ` --model ${options.model}` : '',
    options.completedRun ? ` --completed-run '${options.completedRun.replace(/'/g, "'\\''")}'` : '',
  ].join('');

  if (items.length === 0) {
    return { status: 'nothing_to_judge', harness, pending, next: 'Every settled invocation of a minted or fetched Skill is judged. Sessions used in the last 30 minutes wait until they are quiet.' };
  }
  if (!options.confirm) {
    return {
      preview: true,
      action: `Judge ${items.length} Skill invocation(s) with ${HARNESS_NAME[harness]} on this computer`,
      harness,
      invocations: items.length,
      completedRun: options.completedRun,
      pending,
      runs,
      skills: Object.fromEntries(bySkill),
      reads: `${HARNESS_NAME[harness]} reads, for each invocation, your request just before the Skill load and what followed it until the next Skill load (replies, tool names, tool errors), cut to about 5,000 characters. It runs without tools, without Skills, and without saving a session.`,
      cost: `About ${runs} ${HARNESS_NAME[harness]} run(s) on your own subscription; no other model service is used.`,
      stays: 'The text and the judge\'s reasons stay on this computer. Only scene and result counts go into usage reports, and only while reporting is on.',
      next: `Show this preview to the user. Only after they confirm, run \`obelisk usage judge --confirm${flags}\`.`,
    };
  }

  const results: { skill: string; outcome: string; scenes: string[]; reason: string }[] = [];
  let failure: string | null = null;
  let skipped = 0;
  for (let start = 0; start < items.length; start += options.batch) {
    const batch: (JudgeItem & { messageUuid: string; fingerprint: string })[] = items.slice(start, start + options.batch).map(({ invocation, slice }, index) => {
      const name = versions.get(invocation.fingerprint!)?.[0]?.name ?? 'unknown';
      return {
        id: `i${index + 1}`,
        skill: { name, description: descriptions.get(`${name}:${invocation.fingerprint}`) ?? '' },
        slice,
        messageUuid: invocation.messageUuid,
        fingerprint: invocation.fingerprint!,
      };
    });
    let verdicts;
    try {
      const answer = await runJudgeHarness({
        harness,
        prompt: buildJudgePrompt(batch),
        cwd: join(paths.dataDir, 'judge'),
        ...(options.model ? { model: options.model } : {}),
        env,
      });
      verdicts = parseJudgeOutput(answer, batch.map((item) => item.id));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      break;
    }
    const judgedAt = (deps.now?.() ?? new Date()).toISOString();
    for (const item of batch) {
      const verdict = verdicts.get(item.id);
      if (!verdict) { skipped += 1; continue; }
      const record = annotations.invocations[item.messageUuid];
      annotations.invocations[item.messageUuid] = {
        ...(record?.fingerprint === item.fingerprint ? record : {}),
        fingerprint: item.fingerprint,
        sessionId: items.find((entry) => entry.invocation.messageUuid === item.messageUuid)!.invocation.sessionId,
        judgment: { ...verdict, harness, promptVersion: JUDGE_PROMPT_VERSION, judgedAt },
      };
      results.push({ skill: item.skill.name, ...verdict });
    }
    await writeUsageAnnotations(paths.dataDir, annotations);
  }
  const remaining = pending - results.length;
  return {
    status: failure ? 'partial' : results.length === 0 ? 'nothing_judged' : 'judged',
    harness,
    judged: results.length,
    completedRun: options.completedRun,
    ...(skipped > 0 ? { skipped } : {}),
    remaining,
    results,
    ...(failure ? { error: failure } : {}),
    next: failure
      ? `The judge stopped: ${failure}. What was judged is kept; run the same command again to continue.`
      : remaining > 0
        ? `${remaining} invocation(s) are still unjudged; run \`obelisk usage judge\` again to preview the next batch.`
        : 'All settled invocations are judged. `obelisk usage report` carries their scenes and results while reporting is on.',
  };
}

export async function runUsageJudgeCommand(args: string[], deps: UsageDeps = {}): Promise<unknown> {
  const options: JudgeOptions = { harness: null, limit: DEFAULT_LIMIT, batch: DEFAULT_BATCH, model: null, confirm: false, completedRun: null };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--confirm') { options.confirm = true; continue; }
    const value = args[i + 1];
    if (value === undefined) throw new Error(USAGE_JUDGE_USAGE);
    if (flag === '--harness' && (value === 'claude' || value === 'codex')) options.harness = value;
    else if (flag === '--limit' && /^[1-9]\d{0,3}$/.test(value)) options.limit = Number(value);
    else if (flag === '--batch' && /^[1-9]\d?$/.test(value) && Number(value) <= MAX_BATCH) options.batch = Number(value);
    else if (flag === '--completed-run') options.completedRun = value;
    else if (flag === '--model' && /^[\w.:/-]{1,80}$/.test(value)) options.model = value;
    else throw new Error(USAGE_JUDGE_USAGE);
    i++;
  }
  return judge(options, deps);
}
