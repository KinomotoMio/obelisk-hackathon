// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk resume facts | render` (AI 能力履历, #28, docs/vision/06 R1/R2).
//
// `facts` shows what a résumé can state: the history in a period, counted
// from the index, and the holder's minted Skills with their usage and
// derived Skills from the chain. `render` turns the résumé Skill's choices
// (dimensions as scene tags with session ids, problems backed by a session)
// into a self-contained HTML page; every number on it is counted here, not
// taken from the request.

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { readHistory } from '../../core/src/core.ts';
import { resolveObeliskPaths } from '../../core/src/paths.ts';
import {
  buildResumeModel,
  collectResumeChainFacts,
  parseResumeSpec,
  renderResumeHtml,
  RESUME_UNAVAILABLE,
} from '../../core/src/resume.ts';
import { skillService, type SkillChainDeps } from './skill-mint-command.ts';

export const RESUME_USAGE = 'Usage: obelisk resume facts [--since <date>] [--until <date>] | render <spec.json> [--out <file.html>]';

const SHARE_COMMAND = '/obelisk-share';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value. ${RESUME_USAGE}`);
  return value;
}

function unavailable() {
  return RESUME_UNAVAILABLE.map(({ field, reason }) => ({ field, reason }));
}

async function facts(args: string[], deps: SkillChainDeps) {
  const spec = parseResumeSpec({ since: flag(args, '--since'), until: flag(args, '--until') });
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const { summary } = readHistory(spec.period);
  const chain = await collectResumeChainFacts(paths, skillService(deps));
  return {
    holder: chain.holder,
    network: chain.network,
    networkName: chain.networkName,
    ...(chain.serviceError ? { serviceError: chain.serviceError } : {}),
    history: summary,
    skills: chain.skills,
    explorer: chain.explorer,
    unavailable: unavailable(),
    next: 'Classify the sessions of this period into résumé dimensions and pick the representative problems, then write a spec and run `obelisk resume render <spec.json> --out <file.html>`. Every number on the page comes from render; do not restate figures that are not in its output.',
  };
}

function evidencePrompt(problem: { title: string; session: { id: string; title: string | null }; messages: { from: number; to: number } | null }): string {
  const name = problem.session.title?.trim() || problem.title;
  const range = problem.messages ? (problem.messages.from === problem.messages.to ? `第 ${problem.messages.from} 条` : `第 ${problem.messages.from}–${problem.messages.to} 条`) : '';
  return `${SHARE_COMMAND} 把 session「${name}」（${problem.session.id}）${range}分享给 <招聘方的钱包地址>，限 1 次，24 小时内有效`;
}

async function render(args: string[], deps: SkillChainDeps) {
  const file = args[0];
  if (!file || file.startsWith('--')) throw new Error(RESUME_USAGE);
  const cwd = deps.cwd ?? process.cwd();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(cwd, file), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read the résumé spec ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const spec = parseResumeSpec(raw);
  const out = resolve(cwd, flag(args, '--out') ?? 'ai-capability-resume.html');
  if (!out.endsWith('.html')) throw new Error(`--out must name an .html file, got ${out}`);

  const ids = [...spec.dimensions.flatMap((dimension) => dimension.sessions), ...spec.problems.map((problem) => problem.sessionId)];
  const { summary, sessions } = readHistory(spec.period, ids);
  const paths = resolveObeliskPaths({ env: deps.env ?? process.env });
  const chain = await collectResumeChainFacts(paths, skillService(deps), spec.skills);
  const model = buildResumeModel(spec, chain, summary, sessions, deps.now?.() ?? new Date());
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, renderResumeHtml(model));

  return {
    path: out,
    holder: chain.holder,
    network: chain.network,
    networkName: chain.networkName,
    ...(chain.serviceError ? { serviceError: chain.serviceError } : {}),
    history: { sessions: summary.sessions, activeDays: summary.activeDays, projects: summary.projects, period: summary.period },
    dimensions: model.dimensions.map(({ label, dimensionLabel, created, sessions: count }) => ({ label, dimension: dimensionLabel, sessions: count, ...(created ? { created: true } : {}) })),
    problems: model.problems.map((problem) => ({ title: problem.title, sessionId: problem.session.id })),
    skills: chain.skills.map((skill) => ({
      name: skill.name,
      skillId: skill.skillId,
      invocations: skill.usage?.totalInvocations ?? null,
      wallets: skill.usage?.uniqueWallets ?? null,
      smoothRate: skill.usage?.smoothRate ?? null,
      judged: skill.usage?.judged ?? null,
      derived: skill.derived?.length ?? null,
      explorer: skill.explorer.mint,
      ...(skill.usageError || skill.lineageError ? { error: skill.usageError ?? skill.lineageError } : {}),
    })),
    ...(model.dropped.length ? { dropped: model.dropped } : {}),
    unavailable: unavailable(),
    evidence: model.problems.map((problem) => ({ title: problem.title, prompt: evidencePrompt(problem) })),
    next: `Tell the user the page is at ${out} and summarize it with the numbers above only, naming the network by \`networkName\`. Name what is unavailable and why; a dimension marked \`created\` uses a tag this run made up, so say so. Each problem's evidence can be shown privately with its \`evidence\` prompt once the user has the recruiter's wallet address.`,
  };
}

export async function runResumeCommand(args: string[], deps: SkillChainDeps = {}): Promise<unknown> {
  const [action, ...rest] = args;
  if (action === 'facts') return facts(rest, deps);
  if (action === 'render') return render(rest, deps);
  throw new Error(RESUME_USAGE);
}
