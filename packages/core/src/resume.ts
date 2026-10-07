// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// AI 能力履历 (#28, docs/vision/06 R1/R2): the facts a résumé may state and
// the page that states them.
//
// The résumé Skill runs in the user's AI coding assistant. It decides what to
// say (which dimensions the sessions show, which problems are worth naming),
// but never types a number: `obelisk resume render` takes its choices as
// references (scene tags and session ids) and fills in every count from the
// index and every chain figure from the online service, with explorer links.
// What the data cannot support yet is stated on the page, not estimated.

import { readFile } from 'node:fs/promises';
import { getAddress, type Address } from 'viem';

import type { HistoryPeriod, HistorySession, HistorySummary } from './history-summary.ts';
import { networkLabel, type ChainInfo, type ObeliskServiceClient, type SkillLineageInfo, type SkillUsageInfo } from './obelisk-service.ts';
import { describeSceneTag } from './scenes.ts';
import { listSkills, readSkill } from './skills.ts';

// --- The résumé request -------------------------------------------------------

/** Dimensions a résumé is drawn in: what the work was about, not who it was for. */
export const RESUME_DIMENSIONS = ['domain', 'task', 'artifact'] as const;

export interface ResumeSpec {
  period: HistoryPeriod;
  headline: string | null;
  /** Scene tags with the sessions the run judged to show them. */
  dimensions: { tag: string; sessions: string[] }[];
  /** Representative problems, each backed by one session. */
  problems: { title: string; summary: string; tags: string[]; sessionId: string; messages: { from: number; to: number } | null }[];
  /** Library names of the minted Skills to show; null shows every one the holder minted. */
  skills: string[] | null;
}

const LIMITS = { headline: 80, dimensions: 10, sessionsPerDimension: 500, problems: 6, title: 60, summary: 240, tags: 4 };

function fail(message: string): never {
  throw new Error(`Résumé spec: ${message}`);
}

function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${field} is required`);
    return null;
  }
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length > max) fail(`${field} must be at most ${max} characters (got ${trimmed.length})`);
  return trimmed;
}

function isoDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${field} must be an ISO date such as 2026-07-01`);
  return new Date(value).toISOString();
}

function resumeTag(value: unknown, field: string): string {
  if (typeof value !== 'string') fail(`${field} must be a scene tag such as v1:task/debug`);
  const described = describeSceneTag(value);
  if (described.kind === 'unknown') fail(`${field} ${JSON.stringify(value)} is not a scene tag; use the forms \`obelisk skill scenes\` prints`);
  if (!(RESUME_DIMENSIONS as readonly string[]).includes(described.dimension ?? '')) {
    fail(`${field} ${value} is a ${described.dimension} tag; résumé dimensions are domain, task, or artifact tags`);
  }
  return value;
}

export function parseResumeSpec(raw: unknown): ResumeSpec {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('must be a JSON object');
  const spec = raw as Record<string, unknown>;
  const since = isoDate(spec['since'], 'since');
  const until = isoDate(spec['until'], 'until');
  if (since && until && since >= until) fail('since must be before until');

  const dimensionsRaw = spec['dimensions'] ?? [];
  if (!Array.isArray(dimensionsRaw)) fail('dimensions must be an array');
  if (dimensionsRaw.length > LIMITS.dimensions) fail(`at most ${LIMITS.dimensions} dimensions`);
  const seen = new Set<string>();
  const dimensions = dimensionsRaw.map((entry, index) => {
    const { tag, sessions } = (entry ?? {}) as Record<string, unknown>;
    const checked = resumeTag(tag, `dimensions[${index}].tag`);
    if (seen.has(checked)) fail(`dimensions[${index}].tag ${checked} is listed twice`);
    seen.add(checked);
    if (!Array.isArray(sessions) || sessions.some((id) => typeof id !== 'string' || id === '')) fail(`dimensions[${index}].sessions must be an array of session ids`);
    if (sessions.length > LIMITS.sessionsPerDimension) fail(`dimensions[${index}].sessions lists more than ${LIMITS.sessionsPerDimension} sessions`);
    return { tag: checked, sessions: [...new Set(sessions as string[])] };
  });

  const problemsRaw = spec['problems'] ?? [];
  if (!Array.isArray(problemsRaw)) fail('problems must be an array');
  if (problemsRaw.length > LIMITS.problems) fail(`at most ${LIMITS.problems} problems`);
  const problems = problemsRaw.map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const tags = raw['tags'] ?? [];
    if (!Array.isArray(tags) || tags.length > LIMITS.tags) fail(`problems[${index}].tags must be an array of at most ${LIMITS.tags} tags`);
    const sessionId = raw['sessionId'];
    if (typeof sessionId !== 'string' || sessionId === '') fail(`problems[${index}].sessionId is required`);
    let messages: { from: number; to: number } | null = null;
    if (raw['messages'] !== undefined && raw['messages'] !== null) {
      const { from, to } = raw['messages'] as Record<string, unknown>;
      if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 1 || (to as number) < (from as number)) {
        fail(`problems[${index}].messages must be { "from": n, "to": m } with 1 <= n <= m`);
      }
      messages = { from: from as number, to: to as number };
    }
    return {
      title: text(raw['title'], `problems[${index}].title`, LIMITS.title)!,
      summary: text(raw['summary'], `problems[${index}].summary`, LIMITS.summary)!,
      tags: (tags as unknown[]).map((tag, j) => resumeTag(tag, `problems[${index}].tags[${j}]`)),
      sessionId,
      messages,
    };
  });

  let skills: string[] | null = null;
  if (spec['skills'] !== undefined && spec['skills'] !== null) {
    if (!Array.isArray(spec['skills']) || spec['skills'].some((name) => typeof name !== 'string')) fail('skills must be an array of library names');
    skills = spec['skills'] as string[];
  }
  return { period: { since, until }, headline: text(spec['headline'], 'headline', LIMITS.headline, false), dimensions, problems, skills };
}

// --- Chain facts --------------------------------------------------------------

export interface ResumeSkill {
  name: string;
  description: string;
  skillId: string;
  versions: number;
  birthScenes: { tag: string; label: string }[];
  mintedAt: string;
  explorer: { mint: string | null };
  usage: {
    totalInvocations: number;
    uniqueWallets: number;
    uniqueWalletsExact: boolean;
    lastReportAt: string | null;
    /** null until reports carry judged outcomes. */
    smoothRate: number | null;
    judged: number;
    scenes: { label: string; invocations: number }[];
  } | null;
  usageError: string | null;
  /** Skills minted with this one as their parent, directly or further down. */
  derived: { skillId: string; name: string | null; author: Address }[] | null;
  lineageError: string | null;
}

export interface ResumeChainFacts {
  holder: { wallet: Address | null; explorerUrl: string | null };
  network: string | null;
  chain: ChainInfo | null;
  serviceError: string | null;
  explorer: { usageStats: string | null; skillRegistry: string | null };
  skills: ResumeSkill[];
}

function explorerLink(chain: ChainInfo | null, kind: 'tx' | 'address', value: string | null | undefined): string | null {
  return chain?.explorerUrl && value ? `${chain.explorerUrl}/${kind}/${value}` : null;
}

async function readWalletAddress(walletPath: string): Promise<Address | null> {
  try {
    const record = JSON.parse(await readFile(walletPath, 'utf8')) as { address?: string };
    return record.address ? getAddress(record.address) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function descendants(lineage: SkillLineageInfo, skillId: string): ResumeSkill['derived'] {
  const below = new Set([skillId]);
  const out: NonNullable<ResumeSkill['derived']> = [];
  for (const node of [...lineage.nodes].sort((a, b) => a.depth - b.depth)) {
    if (node.parentSkillId && below.has(node.parentSkillId) && !below.has(node.skillId)) {
      below.add(node.skillId);
      out.push({ skillId: node.skillId, name: node.name, author: getAddress(node.author) });
    }
  }
  return out;
}

function usageView(usage: SkillUsageInfo): NonNullable<ResumeSkill['usage']> {
  return {
    totalInvocations: usage.totalInvocations,
    uniqueWallets: usage.uniqueWallets,
    uniqueWalletsExact: usage.uniqueWalletsExact,
    lastReportAt: usage.lastReportAt,
    smoothRate: usage.results.judged > 0 ? usage.results.smoothRate : null,
    judged: usage.results.judged,
    scenes: usage.scenes
      .filter((bucket) => bucket.invocations > 0)
      .sort((a, b) => b.invocations - a.invocations)
      .slice(0, 5)
      .map((bucket) => ({ label: bucket.label ?? bucket.tag ?? '未命名场景', invocations: bucket.invocations })),
  };
}

/**
 * The holder's wallet and every Skill in the local library that this wallet
 * minted, with its usage and the Skills derived from it, read from the online
 * service. A read that fails is reported with its reason, never filled in.
 */
export async function collectResumeChainFacts(
  paths: { skillsDir: string; walletPath: string },
  client: ObeliskServiceClient,
  only: string[] | null = null,
): Promise<ResumeChainFacts> {
  const wallet = await readWalletAddress(paths.walletPath);
  let chain: ChainInfo | null = null;
  let serviceError: string | null = null;
  try {
    chain = await client.chain();
  } catch (error) {
    serviceError = message(error);
  }
  const library = await listSkills(paths.skillsDir);
  if (only) {
    const missing = only.filter((name) => !library.some((skill) => skill.name === name));
    if (missing.length) throw new Error(`Résumé spec: skills names ${missing.join(', ')}, which ${missing.length > 1 ? 'are' : 'is'} not in the Skill library`);
  }
  const skills: ResumeSkill[] = [];
  for (const summary of library) {
    if (only && !only.includes(summary.name)) continue;
    const view = await readSkill(paths.skillsDir, summary.name);
    const mints = (view?.versions ?? []).map((version) => version.mint).filter((mint) => mint !== null && mint !== undefined);
    const first = mints[0];
    if (!first || !wallet || getAddress(first.author) !== wallet) continue;
    if (chain && first.chainId !== chain.chainId) continue;
    const skill: ResumeSkill = {
      name: summary.name,
      description: summary.description,
      skillId: first.skillId,
      versions: mints.length,
      birthScenes: summary.birthScenes.map((tag) => ({ tag, label: describeSceneTag(tag).label })),
      mintedAt: first.mintedAt,
      explorer: { mint: explorerLink(chain, 'tx', first.txHash) },
      usage: null,
      usageError: chain ? null : serviceError,
      derived: null,
      lineageError: chain ? null : serviceError,
    };
    if (chain) {
      const [usage, lineage] = await Promise.allSettled([client.skillUsage(first.skillId), client.skillLineage(first.skillId)]);
      if (usage.status === 'fulfilled') skill.usage = usageView(usage.value);
      else skill.usageError = message(usage.reason);
      if (lineage.status === 'fulfilled') skill.derived = descendants(lineage.value, first.skillId);
      else skill.lineageError = message(lineage.reason);
    }
    skills.push(skill);
  }
  return {
    holder: { wallet, explorerUrl: explorerLink(chain, 'address', wallet) },
    network: chain ? networkLabel(chain.chainId) : null,
    chain,
    serviceError,
    explorer: {
      usageStats: explorerLink(chain, 'address', chain?.contracts.UsageStats),
      skillRegistry: explorerLink(chain, 'address', chain?.contracts.SkillRegistry),
    },
    skills,
  };
}

/** What a résumé cannot show yet, said on the page and in the CLI output. */
export const RESUME_UNAVAILABLE = [
  {
    field: 'dimensions',
    reason: 'Scene judgments (#25) cover only the invocations of minted Skills, not the whole history; each dimension counts the sessions this résumé run listed for it, from its own reading of them.',
    label: '能力维度由这次生成时 AI 阅读 session 后归类，只计列出的 session；场景判断（#25）目前只覆盖已铸造 Skill 的调用，还没有覆盖全部历史。',
  },
  {
    field: 'smoothRate',
    reason: 'Outcome judgments (#25) cover only the invocations of minted Skills and are reported per Skill, so dimensions show no success rate; a Skill shows one once reports carry judged outcomes.',
    label: '结果判断（#25）只针对已铸造 Skill 的调用、按 Skill 上链，所以各能力维度不显示顺利率；Skill 的顺利率见下表。',
  },
] as const;

// --- The page -----------------------------------------------------------------

export interface ResumeModel {
  generatedAt: string;
  headline: string | null;
  facts: ResumeChainFacts;
  history: HistorySummary;
  dimensions: { tag: string; label: string; dimensionLabel: string; sessions: number }[];
  problems: { title: string; summary: string; tags: string[]; session: HistorySession; messages: { from: number; to: number } | null }[];
  /** Ids the spec named that are not sessions the holder took part in, or fall outside the period. */
  dropped: { field: string; sessionId: string; why: string }[];
}

const DIMENSION_LABELS: Record<string, string> = { domain: '技术领域', task: '任务类型', artifact: '产出物' };

function inPeriod(session: HistorySession, period: HistoryPeriod): boolean {
  if (!session.startedAt) return false;
  if (period.since && session.startedAt < period.since) return false;
  if (period.until && session.startedAt >= period.until) return false;
  return true;
}

export function buildResumeModel(
  spec: ResumeSpec,
  facts: ResumeChainFacts,
  history: HistorySummary,
  sessions: Map<string, HistorySession>,
  now: Date = new Date(),
): ResumeModel {
  const dropped: ResumeModel['dropped'] = [];
  const valid = (field: string, id: string): HistorySession | null => {
    const session = sessions.get(id);
    if (!session) {
      dropped.push({ field, sessionId: id, why: 'not a session the holder took part in' });
      return null;
    }
    if (!inPeriod(session, spec.period)) {
      dropped.push({ field, sessionId: id, why: 'outside the résumé period' });
      return null;
    }
    return session;
  };
  const dimensions = spec.dimensions
    .map(({ tag, sessions: ids }, index) => {
      const described = describeSceneTag(tag);
      const counted = ids.filter((id) => valid(`dimensions[${index}]`, id) !== null).length;
      return { tag, label: described.label, dimensionLabel: DIMENSION_LABELS[described.dimension ?? ''] ?? '', sessions: counted };
    })
    .filter((dimension) => dimension.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const problems = spec.problems.flatMap((problem, index) => {
    const session = valid(`problems[${index}]`, problem.sessionId);
    return session ? [{ ...problem, tags: problem.tags.map((tag) => describeSceneTag(tag).label), session }] : [];
  });
  return { generatedAt: now.toISOString(), headline: spec.headline, facts, history, dimensions, problems, dropped };
}

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const SOURCE_LABELS: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', kimi: 'Kimi Code', omp: 'OMP', pi: 'Pi', deepseek: 'DeepSeek' };

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function link(url: string | null, label: string): string {
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} ↗</a>` : '';
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** A self-contained page: no scripts, no remote resources. */
export function renderResumeHtml(model: ResumeModel): string {
  const { facts, history } = model;
  const period = `${day(history.period.since ?? history.firstAt)} 至 ${day(history.period.until ?? model.generatedAt)}`;
  const holder = facts.holder.wallet
    ? `持有人 <span class="mono">${escapeHtml(shortAddress(facts.holder.wallet))}</span>${facts.holder.explorerUrl ? ` ${link(facts.holder.explorerUrl, '钱包')}` : ''}`
    : '持有人未创建 Obelisk 钱包';
  const max = Math.max(1, ...model.dimensions.map((dimension) => dimension.sessions));
  const bars = model.dimensions.map((dimension) => `
      <div class="bar-row">
        <div class="bar-label">${escapeHtml(dimension.label)}<span class="muted"> · ${escapeHtml(dimension.dimensionLabel)}</span></div>
        <div class="bar-track"><div class="bar" style="width:${Math.max(4, Math.round((dimension.sessions / max) * 100))}%"></div></div>
        <div class="bar-value">${count(dimension.sessions)} 个 session</div>
      </div>`).join('');
  const sources = history.sources.map((source) => `${escapeHtml(SOURCE_LABELS[source.source] ?? source.source)} ${count(source.sessions)}`).join(' · ');
  const problems = model.problems.map((problem) => `
      <li>
        <div class="problem-title">${escapeHtml(problem.title)}</div>
        <div class="problem-summary">${escapeHtml(problem.summary)}</div>
        <div class="problem-meta">${problem.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
          <span class="muted">${escapeHtml(SOURCE_LABELS[problem.session.source ?? ''] ?? problem.session.source ?? '')} · ${day(problem.session.startedAt)} · 佐证 session 可应要求私密出示</span></div>
      </li>`).join('');
  const skillRows = facts.skills.map((skill) => {
    const usage = skill.usage;
    const calls = usage ? count(usage.totalInvocations) : '—';
    const wallets = usage ? `${count(usage.uniqueWallets)}${usage.uniqueWalletsExact ? '' : '+'}` : '—';
    const rate = usage?.smoothRate !== null && usage?.smoothRate !== undefined
      ? `${Math.round(usage.smoothRate * 100)}%<div class="muted small">判断 ${count(usage.judged)} 次</div>`
      : '—';
    const derived = skill.derived ? count(skill.derived.length) : '—';
    const scenes = usage?.scenes.length ? `<div class="muted small">实测场景：${usage.scenes.map((scene) => `${escapeHtml(scene.label)} ${count(scene.invocations)}`).join(' · ')}</div>` : '';
    const problem = skill.usageError ?? skill.lineageError;
    return `
        <tr>
          <td><div class="skill-name">${escapeHtml(skill.name)} <span class="muted">#${escapeHtml(skill.skillId)} · v${skill.versions}</span></div>${scenes}${problem ? `<div class="warn small">读取失败：${escapeHtml(problem)}</div>` : ''}</td>
          <td class="num">${calls}</td><td class="num">${wallets}</td><td class="num">${rate}</td><td class="num">${derived}</td>
          <td class="record">${link(skill.explorer.mint, '铸造记录') || '<span class="muted">—</span>'}</td>
        </tr>`;
  }).join('');
  const skillsSection = facts.skills.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Skill</th><th class="num">真实调用</th><th class="num">钱包数</th><th class="num">顺利率</th><th class="num">衍生</th><th>链上记录</th></tr></thead>
        <tbody>${skillRows}</tbody>
      </table></div>
      <p class="note">调用量和钱包数来自 ${escapeHtml(facts.network ?? 'BOT Chain')} 上的使用统计${facts.explorer.usageStats ? `（${link(facts.explorer.usageStats, '使用统计合约')}）` : ''}，由各钱包签名上报、按钱包去重；"衍生"是在它基础上铸造的 Skill 数。顺利率是经 AI 判断的调用里顺利完成的比例（不含判断不了的），上报带有结果判断后才显示。</p>`
    : `<p class="note">${facts.holder.wallet ? '这个钱包还没有铸造 Skill。' : '没有钱包，无法关联链上的 Skill。'}${facts.serviceError ? ` 在线服务暂时无法读取：${escapeHtml(facts.serviceError)}` : ''}</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 能力履历</title>
<style>
  :root { --fg:#16181d; --fg2:#3c4049; --muted:#6b7180; --line:#e4e6eb; --soft:#f5f6f8; --accent:#6d4fd6; --accent-soft:#efeafd; --chain:#0b78b5; --warn:#a15c00; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:var(--fg); font:15px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Segoe UI", sans-serif; }
  main { max-width:860px; margin:0 auto; padding:40px 24px 64px; }
  h1 { font-size:28px; margin:0 0 6px; letter-spacing:-0.01em; }
  h2 { font-size:16px; margin:36px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  .meta { color:var(--muted); font-size:13px; }
  .headline { font-size:16px; color:var(--fg2); margin:10px 0 0; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size:13px; }
  .muted { color:var(--muted); }
  .small { font-size:12.5px; }
  .warn { color:var(--warn); }
  a { color:var(--chain); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-top:20px; }
  .stat { background:var(--soft); border-radius:10px; padding:12px 14px; }
  .stat b { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:12.5px; }
  .bar-row { display:grid; grid-template-columns:180px 1fr 96px; gap:12px; align-items:center; margin:8px 0; }
  .bar-track { background:var(--soft); border-radius:6px; height:12px; overflow:hidden; }
  .bar { background:var(--accent); height:100%; border-radius:6px; }
  .bar-value { text-align:right; color:var(--fg2); font-size:13px; font-variant-numeric:tabular-nums; }
  .note { color:var(--muted); font-size:12.5px; margin:10px 0 0; }
  ul.problems { list-style:none; padding:0; margin:0; }
  ul.problems li { padding:12px 0; border-bottom:1px solid var(--line); }
  .problem-title { font-weight:600; }
  .problem-summary { color:var(--fg2); }
  .problem-meta { margin-top:4px; font-size:12.5px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .tag { background:var(--accent-soft); color:var(--accent); border-radius:999px; padding:1px 8px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  .table-wrap { overflow-x:auto; }
  th { text-align:left; font-weight:500; color:var(--muted); font-size:12.5px; border-bottom:1px solid var(--line); padding:6px 8px; white-space:nowrap; }
  td { padding:10px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .skill-name { font-weight:600; min-width:10em; overflow-wrap:anywhere; }
  td.record { white-space:nowrap; }
  .sources li { margin:4px 0; }
  @media (max-width:640px) { .stats { grid-template-columns:repeat(2, 1fr); } .bar-row { grid-template-columns:1fr; gap:4px; } .bar-value { text-align:left; } }
  @media print { main { padding:0; } a { color:var(--fg); } }
</style>
</head>
<body>
<main>
  <h1>AI 能力履历</h1>
  <div class="meta">${holder} · 统计范围 ${escapeHtml(period)} · 生成于 ${escapeHtml(day(model.generatedAt))}</div>
  ${model.headline ? `<p class="headline">${escapeHtml(model.headline)}</p>` : ''}
  <div class="stats">
    <div class="stat"><b>${count(history.sessions)}</b><span>个 session</span></div>
    <div class="stat"><b>${count(history.activeDays)}</b><span>个活跃日</span></div>
    <div class="stat"><b>${count(history.projects)}</b><span>个项目目录</span></div>
    <div class="stat"><b>${count(facts.skills.length)}</b><span>个已铸造 Skill</span></div>
  </div>
  <p class="note">${sources ? `${sources}。` : ''}只计入持有人亲自参与（有自己输入）的 session。</p>

  <h2>能力维度</h2>
  ${bars || '<p class="note">这次生成没有列出能力维度。</p>'}
  <p class="note">${escapeHtml(RESUME_UNAVAILABLE[0].label)} ${escapeHtml(RESUME_UNAVAILABLE[1].label)}</p>

  <h2>解决过的代表性问题</h2>
  ${problems ? `<ul class="problems">${problems}</ul>` : '<p class="note">这次生成没有列出代表性问题。</p>'}

  <h2>沉淀的 Skill · 链上可核对</h2>
  ${skillsSection}

  <h2>数据从哪里来</h2>
  <ul class="sources small">
    <li>session、活跃日、项目和能力维度的计数：由 Obelisk 在持有人电脑上从本机历史统计，内容本身没有离开这台电脑。</li>
    <li>Skill、调用量、钱包数和衍生关系：${escapeHtml(facts.network ?? 'BOT Chain')} 上的公开记录，经 Obelisk 在线服务读取${facts.explorer.skillRegistry ? `，${link(facts.explorer.skillRegistry, 'Skill 资产合约')}` : ''}。</li>
    <li>代表性问题的文字由生成时的 AI 根据对应 session 撰写；佐证 session 由持有人决定是否私密出示。</li>
  </ul>
</main>
</body>
</html>
`;
}
