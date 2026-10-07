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
import { networkLabel, networkNameZh, type ChainInfo, type ObeliskServiceClient, type SkillLineageInfo, type SkillUsageInfo } from './obelisk-service.ts';
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
  /** For agents and logs, e.g. "BOT Chain testnet (968)". */
  network: string | null;
  /** For the page and the user, e.g. "BOT Chain 测试网". */
  networkName: string | null;
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
    networkName: chain ? networkNameZh(chain.chainId) : null,
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
  /** `created`: a tag the run made up (user:…), not one from the scene vocabulary. */
  dimensions: { tag: string; label: string; dimensionLabel: string; created: boolean; sessions: number }[];
  problems: { title: string; summary: string; tags: ResumeTagView[]; session: HistorySession; messages: { from: number; to: number } | null }[];
  /** Ids the spec named that are not sessions the holder took part in, or fall outside the period. */
  dropped: { field: string; sessionId: string; why: string }[];
}

export interface ResumeTagView {
  label: string;
  created: boolean;
}

const DIMENSION_LABELS: Record<string, string> = { domain: '技术领域', task: '任务类型', artifact: '产出物' };

function tagView(tag: string): ResumeTagView {
  const described = describeSceneTag(tag);
  return { label: described.label, created: described.kind === 'user' };
}

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
      return { tag, label: described.label, dimensionLabel: DIMENSION_LABELS[described.dimension ?? ''] ?? '', created: described.kind === 'user', sessions: counted };
    })
    .filter((dimension) => dimension.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
  const problems = spec.problems.flatMap((problem, index) => {
    const session = valid(`problems[${index}]`, problem.sessionId);
    return session ? [{ ...problem, tags: problem.tags.map(tagView), session }] : [];
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

// A tag the run made up rather than took from the scene vocabulary is marked
// 新建, as in the App: it is not comparable across holders.
const NEW_BADGE = '<span class="new">新建</span>';

function tagPill(tag: ResumeTagView): string {
  return `<span class="pill acc">${tag.created ? NEW_BADGE : ''}${escapeHtml(tag.label)}</span>`;
}

const fixed = (value: number): string => value.toFixed(1);

/** The dimensions as a radar of session counts; needs three to have a shape. */
function radar(dimensions: ResumeModel['dimensions']): string {
  const n = dimensions.length;
  if (n < 3) return '';
  const cx = 200;
  const cy = 170;
  const r = 112;
  const max = Math.max(...dimensions.map((dimension) => dimension.sessions));
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const at = (i: number, scale: number) => [cx + r * scale * Math.cos(angle(i)), cy + r * scale * Math.sin(angle(i))] as const;
  const polygon = (scale: (i: number) => number) => dimensions.map((_, i) => at(i, scale(i)).map(fixed).join(',')).join(' ');
  const rings = [1, 2 / 3, 1 / 3].map((scale) => `<polygon points="${polygon(() => scale)}"/>`).join('');
  const spokes = dimensions.map((_, i) => `M${cx} ${cy} L${at(i, 1).map(fixed).join(' ')}`).join(' ');
  const shape = polygon((i) => Math.max(0.06, dimensions[i]!.sessions / max));
  const dots = dimensions.map((dimension, i) => {
    const [x, y] = at(i, Math.max(0.06, dimension.sessions / max));
    return `<circle cx="${fixed(x)}" cy="${fixed(y)}" r="3"/>`;
  }).join('');
  const labels = dimensions.map((dimension, i) => {
    const cos = Math.cos(angle(i));
    const sin = Math.sin(angle(i));
    const x = cx + (r + 14) * cos;
    const y = cy + (r + 14) * sin;
    const anchor = Math.abs(cos) < 0.2 ? 'middle' : cos > 0 ? 'start' : 'end';
    const top = sin < -0.8 ? y - 22 : sin > 0.8 ? y + 14 : y - 4;
    return `<text x="${fixed(x)}" y="${fixed(top)}" text-anchor="${anchor}">${escapeHtml(dimension.label)}${dimension.created ? '（新建）' : ''}</text>`
      + `<text class="v" x="${fixed(x)}" y="${fixed(top + 19)}" text-anchor="${anchor}">${count(dimension.sessions)} 个 session</text>`;
  }).join('');
  const described = dimensions.map((dimension) => `${dimension.label} ${dimension.sessions} 个 session`).join('，');
  return `<svg class="radar" viewBox="-55 0 510 345" role="img" aria-label="能力维度：${escapeHtml(described)}">
            <g class="grid">${rings}<path d="${spokes}"/></g>
            <polygon class="shape" points="${shape}"/>
            <g class="dots">${dots}</g>
            <g class="labels">${labels}</g>
          </svg>`;
}

function rateCell(usage: ResumeSkill['usage']): string {
  if (usage?.smoothRate === null || usage?.smoothRate === undefined) return '<span class="muted">—</span>';
  const percent = Math.round(usage.smoothRate * 100);
  return `<span class="pill ${percent >= 80 ? 'ok' : 'dim'}">${percent}%</span><div class="note">判断 ${count(usage.judged)} 次</div>`;
}

/** A self-contained page: no scripts, no remote resources. */
export function renderResumeHtml(model: ResumeModel): string {
  const { facts, history } = model;
  // Set apart from the Chinese around it without hard spaces.
  const network = `<span class="net">${escapeHtml(facts.networkName ?? 'BOT Chain')}</span>`;
  const period = `${day(history.period.since ?? history.firstAt)} 至 ${day(history.period.until ?? model.generatedAt)}`;
  const holder = facts.holder.wallet
    ? `持有人 <span class="mono">${escapeHtml(shortAddress(facts.holder.wallet))}</span>${facts.holder.explorerUrl ? ` ${link(facts.holder.explorerUrl, '钱包')}` : ''}`
    : '持有人未创建 Obelisk 钱包';
  const chainPill = facts.chain
    ? `<span class="pill chain">数据可在${network}核对</span>`
    : '<span class="pill warn">链上数据暂时无法读取</span>';

  const max = Math.max(1, ...model.dimensions.map((dimension) => dimension.sessions));
  const dimensionRows = model.dimensions.map((dimension) => `
          <div class="dim">
            <div class="dim-label">${dimension.created ? NEW_BADGE : ''}${escapeHtml(dimension.label)}<span class="muted"> · ${escapeHtml(dimension.dimensionLabel)}</span></div>
            <div class="dim-n mono">${count(dimension.sessions)}</div>
            <div class="bar"><i style="width:${Math.max(4, Math.round((dimension.sessions / max) * 100))}%"></i></div>
          </div>`).join('');
  const dimensionsCard = `
      <section class="card">
        <h2>能力维度 <span class="muted">· session 数</span></h2>
        ${model.dimensions.length ? `${radar(model.dimensions)}<div class="dims">${dimensionRows}</div>` : '<p class="note">这次生成没有列出能力维度。</p>'}
        <p class="note">${escapeHtml(RESUME_UNAVAILABLE[0].label)}${escapeHtml(RESUME_UNAVAILABLE[1].label)}</p>
      </section>`;

  const problems = model.problems.map((problem) => `
          <div class="ev">
            <div>
              <div class="ev-title">${escapeHtml(problem.title)}</div>
              <div class="ev-summary">${escapeHtml(problem.summary)}</div>
              <div class="ev-meta">${problem.tags.map(tagPill).join('')}<span class="note">${escapeHtml(SOURCE_LABELS[problem.session.source ?? ''] ?? problem.session.source ?? '')} · ${day(problem.session.startedAt)}</span></div>
            </div>
            <span class="pill dim">佐证可私密出示</span>
          </div>`).join('');
  const problemsCard = `
      <section class="card">
        <h2>解决过的代表性问题</h2>
        ${problems || '<p class="note">这次生成没有列出代表性问题。</p>'}
      </section>`;

  const skillRows = facts.skills.map((skill) => {
    const usage = skill.usage;
    const scenes = usage?.scenes.length ? `<div class="note">实测场景：${usage.scenes.map((scene) => `${escapeHtml(scene.label)} ${count(scene.invocations)}`).join(' · ')}</div>` : '';
    const problem = skill.usageError ?? skill.lineageError;
    return `
            <tr>
              <td><div class="skill-name">${escapeHtml(skill.name)} <span class="muted mono">#${escapeHtml(skill.skillId)} · v${skill.versions}</span></div>${scenes}${problem ? `<div class="warn note">读取失败：${escapeHtml(problem)}</div>` : ''}</td>
              <td class="num mono" data-label="真实调用">${usage ? count(usage.totalInvocations) : '—'}</td>
              <td class="num mono" data-label="钱包数">${usage ? `${count(usage.uniqueWallets)}${usage.uniqueWalletsExact ? '' : '+'}` : '—'}</td>
              <td class="num" data-label="顺利率">${rateCell(usage)}</td>
              <td class="num mono" data-label="衍生">${skill.derived ? count(skill.derived.length) : '—'}</td>
              <td class="record" data-label="链上记录">${link(skill.explorer.mint, '铸造记录') || '<span class="muted">—</span>'}</td>
            </tr>`;
  }).join('');
  const skillsCard = `
      <section class="card">
        <h2>沉淀的 Skill <span class="muted">· 链上可核对</span></h2>
        ${facts.skills.length
          ? `<div class="table-wrap"><table>
            <thead><tr><th>Skill</th><th class="num">真实调用</th><th class="num">钱包数</th><th class="num">顺利率</th><th class="num">衍生</th><th>链上记录</th></tr></thead>
            <tbody>${skillRows}</tbody>
          </table></div>
          <p class="note">调用量和钱包数由各钱包签名上报、按钱包去重；"衍生"是在它基础上铸造的 Skill 数；顺利率是经 AI 判断的调用里顺利完成的比例（不含判断不了的）。</p>`
          : `<p class="note">${facts.holder.wallet ? '这个钱包还没有铸造 Skill。' : '没有钱包，无法关联链上的 Skill。'}${facts.serviceError ? ` 在线服务暂时无法读取：${escapeHtml(facts.serviceError)}` : ''}</p>`}
      </section>`;

  const verifiable = facts.skills.some((skill) => skill.explorer.mint);
  const callout = `
      <div class="callout">${verifiable
        ? `招聘方点「铸造记录 ↗」即可在区块浏览器核对 Skill 的铸造；调用量来自${network}上的${link(facts.explorer.usageStats, '使用统计合约') || '使用统计'}。`
        : `Skill 的铸造和调用统计记录在${network}上。`}代表性问题的佐证 session 由持有人私密分享给招聘方的钱包：可限定打开次数和有效期，阅读页带水印，持有人会收到已读回执。</div>`;

  const sources = history.sources.map((source) => `${escapeHtml(SOURCE_LABELS[source.source] ?? source.source)} ${count(source.sessions)}`).join(' · ');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>AI 能力履历</title>
<style>
  /* Colours and type follow the Obelisk App (app/src/renderer/styles/base.css). */
  :root {
    --bg:#0a0b14; --bg-2:#11131f; --surface:rgba(255,255,255,0.03); --surface-strong:rgba(255,255,255,0.06);
    --fg:rgba(255,255,255,0.92); --fg-2:rgba(255,255,255,0.72); --muted:rgba(255,255,255,0.5); --hairline:rgba(255,255,255,0.08);
    --accent:#a78bfa; --accent-2:#c4b5fd; --accent-soft:rgba(167,139,250,0.12);
    --ok:#4ade80; --ok-soft:rgba(74,222,128,0.12); --warn:#fbbf24; --warn-soft:rgba(251,191,36,0.14);
    --chain:#38bdf8; --chain-soft:rgba(56,189,248,0.12);
    --font-sans:-apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Noto Sans SC", "Segoe UI", system-ui, sans-serif;
    --font-mono:ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    color:var(--fg); font:14px/1.6 var(--font-sans); min-height:100vh; padding:40px 24px 64px;
    background-color:var(--bg);
    background-image:radial-gradient(80% 60% at 100% 0%, rgba(236,72,153,0.10), transparent 55%),
      radial-gradient(70% 60% at 0% 100%, rgba(99,102,241,0.12), transparent 60%),
      linear-gradient(to bottom, var(--bg) 0%, var(--bg-2) 100%);
  }
  a { color:var(--accent-2); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .page { max-width:1120px; margin:0 auto; display:flex; flex-direction:column; gap:16px; }
  .mono { font-family:var(--font-mono); font-size:12.5px; }
  .muted { color:var(--muted); font-weight:400; }
  .note { font-size:12.5px; color:var(--muted); }
  .warn { color:var(--warn); }
  .net { margin:0 0.25em; }
  .pill.chain { gap:0; }
  .pill .net { margin:0 0.2em; }
  .card { background:var(--surface); border:1px solid var(--hairline); border-radius:14px; padding:18px 20px; }
  .card h2 { font-size:13px; font-weight:600; color:var(--fg-2); letter-spacing:0.02em; margin-bottom:12px; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
  .pill.ok { background:var(--ok-soft); color:var(--ok); }
  .pill.warn { background:var(--warn-soft); color:var(--warn); }
  .pill.acc { background:var(--accent-soft); color:var(--accent-2); }
  .pill.chain { background:var(--chain-soft); color:var(--chain); }
  .pill.dim { background:var(--surface-strong); color:var(--fg-2); }
  .new { display:inline-block; margin-right:5px; padding:0 5px; border-radius:4px; font-size:10.5px; font-weight:700; line-height:16px; background:var(--warn-soft); color:var(--warn); vertical-align:1px; }
  .head { display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; align-items:flex-start; padding:24px; }
  /* Obelisk's mark and wordmark, from the official landing page (as service/public/site/brand.css). */
  .brand { display:inline-flex; align-items:center; gap:9px; margin-bottom:14px; }
  .brand-mark { display:block; width:15px; height:19px; }
  .brand-word { display:inline-flex; align-items:flex-end; font-family:'Iowan Old Style','Charter','Georgia','Source Han Serif SC','Noto Serif CJK SC','Songti SC',serif; font-size:16px; font-weight:500; letter-spacing:0.01em; line-height:1; }
  .brand-word .a, .brand-word .b { -webkit-background-clip:text; background-clip:text; color:transparent; }
  .brand-word .a { background-image:linear-gradient(90deg, rgba(245,243,238,0.45), #f5f3ee); }
  .brand-word .b { background-image:linear-gradient(90deg, #f5f3ee, rgba(245,243,238,0.45)); }
  .brand-word svg { display:block; width:5px; height:17px; margin:0 1px; }
  .head h1 { font-size:24px; font-weight:700; letter-spacing:-0.01em; }
  .headline { color:var(--fg-2); font-size:15px; margin-top:4px; max-width:720px; }
  .meta { margin-top:10px; font-size:12.5px; color:var(--muted); }
  .head .pills { display:flex; gap:8px; flex-wrap:wrap; }
  .stats { display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; }
  .stat { padding:14px 18px; }
  .stat b { display:block; font-size:28px; font-weight:700; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:12.5px; }
  .stats-note { margin-top:-6px; padding:0 4px; }
  .columns { display:grid; grid-template-columns:420px 1fr; gap:16px; align-items:start; }
  .stack { display:flex; flex-direction:column; gap:16px; min-width:0; }
  .radar { width:100%; height:auto; display:block; margin:-4px 0 6px; }
  .radar .grid { fill:none; stroke:rgba(255,255,255,0.12); }
  .radar .shape { fill:rgba(167,139,250,0.25); stroke:var(--accent); stroke-width:2; stroke-linejoin:round; }
  .radar .dots { fill:var(--accent-2); }
  .radar .labels { font-family:var(--font-sans); font-size:17px; fill:rgba(255,255,255,0.86); }
  .radar .labels .v { font-size:14px; fill:var(--muted); }
  .dims { display:flex; flex-direction:column; gap:9px; margin:4px 0 12px; }
  .dim { display:grid; grid-template-columns:1fr auto; gap:4px 10px; align-items:baseline; font-size:13px; }
  .dim-n { color:var(--fg-2); }
  .bar { grid-column:1 / -1; height:6px; border-radius:999px; background:var(--surface-strong); overflow:hidden; }
  .bar > i { display:block; height:100%; border-radius:999px; background:var(--accent); }
  .ev { display:grid; grid-template-columns:1fr auto; gap:6px 14px; align-items:start; padding:12px 0; border-bottom:1px solid var(--hairline); }
  .ev:first-of-type { padding-top:0; }
  .ev:last-child { border-bottom:none; padding-bottom:0; }
  .ev-title { font-weight:600; font-size:14px; }
  .ev-summary { color:var(--fg-2); font-size:13px; margin-top:2px; }
  .ev-meta { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-top:8px; }
  .table-wrap { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--muted); font-weight:500; font-size:12px; padding:8px 10px; border-bottom:1px solid var(--hairline); white-space:nowrap; }
  td { padding:10px; border-bottom:1px solid var(--hairline); vertical-align:middle; }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; white-space:nowrap; }
  .skill-name { font-weight:600; min-width:10em; overflow-wrap:anywhere; }
  td.record { white-space:nowrap; }
  .table-wrap + .note { margin-top:10px; }
  .callout { border-left:3px solid var(--accent); background:var(--accent-soft); padding:12px 16px; border-radius:0 10px 10px 0; font-size:13px; color:var(--fg-2); }
  .sources { list-style:none; display:flex; flex-direction:column; gap:6px; font-size:12.5px; color:var(--fg-2); }
  .sources li::before { content:"·"; color:var(--accent-2); margin-right:8px; }
  @media (max-width:900px) { .columns { grid-template-columns:1fr; } }
  @media (max-width:640px) {
    body { padding:20px 16px 48px; }
    .stats { grid-template-columns:repeat(2, 1fr); }
    .head { padding:18px; }
    .ev { grid-template-columns:1fr; }
    .ev > .pill { justify-self:start; }
    /* The Skill table as one block per Skill, each figure with its label. */
    .table-wrap thead { display:none; }
    .table-wrap table, .table-wrap tbody { display:block; }
    .table-wrap tr { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px 12px; padding:12px 0; border-bottom:1px solid var(--hairline); }
    .table-wrap tr:last-child { border-bottom:none; }
    .table-wrap td { display:block; padding:0; border:none; text-align:left; }
    .table-wrap td:first-child { grid-column:1 / -1; }
    .table-wrap td[data-label]::before { content:attr(data-label); display:block; font-size:11.5px; color:var(--muted); font-family:var(--font-sans); }
  }
  @media print {
    :root { --fg:#16181d; --fg-2:#3c4049; --muted:#6b7180; --hairline:#e4e6eb; --surface:#fff; --surface-strong:#f1f2f5; --accent-soft:#efeafd; --accent-2:#6d4fd6; --chain:#0b78b5; --ok:#15803d; --warn:#a15c00; }
    body { background:#fff; padding:0; }
    .radar .labels { fill:#16181d; }
    .radar .grid { stroke:#d6d8de; }
    .card { break-inside:avoid; }
    .brand-word .a, .brand-word .b { background:none; color:#16181d; }
    .brand-mark .needle { fill:#16181d; }
  }
</style>
</head>
<body>
<main class="page">
  <header class="card head">
    <div>
      <div class="brand" role="img" aria-label="Obelisk">
        <svg class="brand-mark" viewBox="13 0 51 64" fill="none" aria-hidden="true"><path d="M 17 63 L 51.9 1.5 A 15 15 0 0 1 62.5 12.1 Z" fill="#c4b5fd" opacity="0.55"/><polygon points="17,63 63,24 63,40" fill="#a78bfa" opacity="0.5"/><path d="M 17 63 L 62.5 51.9 A 15 15 0 0 1 48 63 Z" fill="#6366f1" opacity="0.5"/><polygon class="needle" points="17,9 15.2,15 14.3,63 19.7,63 18.8,15" fill="#f5f3ee"/></svg>
        <span class="brand-word" aria-hidden="true"><span class="a">Obe</span><svg viewBox="0 0 14 46"><polygon points="7,1 5,6 4.5,45 9.5,45 9,6" fill="#c4b5fd"/></svg><span class="b">isk</span></span>
      </div>
      <h1>AI 能力履历</h1>
      ${model.headline ? `<p class="headline">${escapeHtml(model.headline)}</p>` : ''}
      <div class="meta">${holder} · 统计范围 ${escapeHtml(period)} · 生成于 ${escapeHtml(day(model.generatedAt))}</div>
    </div>
    <div class="pills">${chainPill}<span class="pill dim">由 Obelisk 从本机历史统计</span></div>
  </header>

  <div class="stats">
    <div class="card stat"><b>${count(history.sessions)}</b><span>个 session</span></div>
    <div class="card stat"><b>${count(history.activeDays)}</b><span>个活跃日</span></div>
    <div class="card stat"><b>${count(history.projects)}</b><span>个项目目录</span></div>
    <div class="card stat"><b>${count(facts.skills.length)}</b><span>个已铸造 Skill</span></div>
  </div>
  <p class="note stats-note">${sources ? `${sources}。` : ''}只计入持有人亲自参与（有自己输入）的 session。</p>

  <div class="columns">
    ${dimensionsCard}
    <div class="stack">
      ${problemsCard}
      ${skillsCard}
      ${callout}
    </div>
  </div>

  <section class="card">
    <h2>数据从哪里来</h2>
    <ul class="sources">
      <li>session、活跃日、项目目录和能力维度的计数：由 Obelisk 在持有人电脑上从本机历史统计，内容本身没有离开这台电脑。</li>
      <li>Skill、调用量、钱包数、顺利率和衍生关系：${network}上的公开记录，经 Obelisk 在线服务读取${facts.explorer.skillRegistry ? `，${link(facts.explorer.skillRegistry, 'Skill 资产合约')}` : ''}。</li>
      <li>能力维度的归类和代表性问题的文字由生成时的 AI 根据对应 session 撰写；佐证 session 由持有人决定是否私密出示。</li>
    </ul>
  </section>
</main>
</body>
</html>
`;
}
