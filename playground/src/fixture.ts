// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The fixture run (#32): a made-up run of the 演示闭环 scenario for building
// and testing the run page, the publisher and the live server without a real
// run. Everything in it is marked: the run id starts with `fixture-`, the
// scenario title says 示例数据, the screenshots have FIXTURE written across
// them, and its transaction hashes are derived from text, so the on-chain
// check reports them 未找到. Never publish it as evidence; `publish` refuses to
// put a fixture into the service's public directory.
//
//   npm run playground -- fixture <dir> [--live] [--seconds <n>]
//
// writes <dir>/runs/fixture-demo-loop/ finished, or with --live replays it
// into <dir>/runs/fixture-demo-loop-live/ over n seconds (default 90), for
// `OBELISK_PLAYGROUND_HOME=<dir> npm run playground -- serve`.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { fixtureScreenshot } from './png.ts';
import {
  EVENT_SCHEMA, PROVENANCE_SCHEMA, summarizeTotals,
  type EventType, type HarnessInfo, type PlaygroundEvent, type PlaygroundProvenance, type RoleRecord, type StepRecord,
} from './provenance.ts';

export const FIXTURE_PREFIX = 'fixture-';
export const FIXTURE_RUN = 'fixture-demo-loop';
export const FIXTURE_LIVE_RUN = 'fixture-demo-loop-live';

export const isFixtureRun = (id: string) => id.startsWith(FIXTURE_PREFIX);

const CHAIN_ID = 968;
const SKILL_ID = '12';
const SKILL = 'job-application-materials';

const hex = (seed: string, length: number) => createHash('sha256').update(`fixture:${seed}`).digest('hex').repeat(2).slice(0, length);
const address = (seed: string) => `0x${hex(`wallet:${seed}`, 40)}`;
const txHash = (seed: string) => `0x${hex(`tx:${seed}`, 64)}`;
const uuid = (seed: string) => `${hex(`${seed}:1`, 8)}-${hex(`${seed}:2`, 4)}-4${hex(`${seed}:3`, 3)}-8${hex(`${seed}:4`, 3)}-${hex(`${seed}:5`, 12)}`;

const CLAUDE: HarnessInfo = { kind: 'claude-code', version: '2.1.292 (Claude Code)', model: 'claude-sonnet-5-5' };
const CODEX: HarnessInfo = { kind: 'codex', version: 'codex-cli 0.160.0', model: 'gpt-6.1-sol' };

const ROLES: RoleRecord[] = [
  ['A', '作者 A', CLAUDE], ['B', '接收方 B', CODEX], ['C', '转发对象 C', CODEX],
  ['U1', '用户 1', CLAUDE], ['U2', '用户 2', CODEX], ['U3', '用户 3', CLAUDE],
].map(([id, label, harness]) => ({ id: id as string, label: label as string, wallet: { address: address(id as string) }, harness: harness as HarnessInfo }));

/** One thing that happens at `t` seconds into the run, inside a step. */
interface Moment {
  t: number;
  type: EventType;
  text: string;
  apply?: (step: StepRecord, at: string) => Record<string, unknown>;
}

interface StepPlan {
  id: string;
  role: string;
  title: string;
  action: StepRecord['action'];
  scenes?: string[];
  prompt?: string;
  start: number;
  end: number;
  moments: Moment[];
}

const harnessOf = (role: string) => ROLES.find((r) => r.id === role)!.harness;

function session(step: StepRecord, seed: string) {
  const id = uuid(seed);
  const source = harnessOf(step.role).kind === 'codex' ? 'codex' : 'claude';
  const ref = { source, id, obeliskId: source === 'codex' ? `codex:${id}` : id };
  step.sessions.push(ref);
  return { ...ref };
}

function command(step: StepRecord, argv: string[], startedAt: string, at: string, sends: string | null, exitCode = 0) {
  const hash = sends ? txHash(sends) : null;
  const record = { argv, exitCode, startedAt, endedAt: at, transactions: hash ? [hash] : [] };
  step.commands.push(record);
  return { ...record };
}

function transaction(step: StepRecord, seed: string, sent: string) {
  const ref = { hash: txHash(seed), chainId: CHAIN_ID, explorerUrl: null, command: sent };
  step.transactions.push(ref);
  return { ...ref };
}

function artifact(step: StepRecord, kind: string, ref: string) {
  step.artifacts.push({ kind, ref });
  return { kind, ref };
}

function screenshot(step: StepRecord, caption: string) {
  const ref = { file: `screenshots/${step.id}.png`, caption };
  step.screenshots.push(ref);
  return { ...ref };
}

const JOB = ['v1:context/job-search', 'v1:role/engineer', 'v1:artifact/resume'];

const PLAN: StepPlan[] = [
  {
    id: 'a-share', role: 'A', title: 'A 把一个 session 分享给 B，只能打开 1 次', action: 'prompt', start: 2, end: 14,
    prompt: '/obelisk-share 把最近整理履历的 session 分享给 B，只能打开 1 次',
    moments: [
      { t: 8, type: 'session', text: 'A 在 Claude Code 中说出分享的 prompt', apply: (s) => session(s, 'a-share') },
      { t: 12, type: 'command', text: 'obelisk share send', apply: (s, at) => command(s, ['share', 'send', '--to', address('B'), '--max-opens', '1'], at, at, 'share') },
      { t: 12, type: 'transaction', text: 'A 创建分享：接收方 B，只能打开 1 次', apply: (s) => transaction(s, 'share', 'share send') },
      { t: 13, type: 'artifact', text: '分享 sh_7Qm2 已创建', apply: (s) => artifact(s, 'share', 'sh_7Qm2') },
    ],
  },
  {
    id: 'c-open', role: 'C', title: 'C 打开 B 转发的链接', action: 'cli', start: 15, end: 19,
    moments: [
      { t: 18, type: 'command', text: 'C 打开转发的链接：钱包不匹配，打不开（符合预期）', apply: (s, at) => command(s, ['share', 'open', 'sh_7Qm2'], at, at, null, 1) },
    ],
  },
  {
    id: 'b-open', role: 'B', title: 'B 打开分享；A 收到已读回执', action: 'cli', start: 20, end: 26,
    moments: [
      { t: 24, type: 'command', text: 'obelisk share open', apply: (s, at) => command(s, ['share', 'open', 'sh_7Qm2'], at, at, 'receipt') },
      { t: 24, type: 'transaction', text: 'B 打开分享，已读回执上链', apply: (s) => transaction(s, 'receipt', 'share open') },
      { t: 25, type: 'artifact', text: '已读回执', apply: (s) => artifact(s, 'share-receipt', 'sh_7Qm2') },
    ],
  },
  {
    id: 'a-receipt-shot', role: 'A', title: '截取 A 的 Share tab：已读回执', action: 'capture', start: 27, end: 30,
    moments: [{ t: 30, type: 'screenshot', text: '截图：A 的 Share tab · 已读回执', apply: (s) => screenshot(s, 'A 的 Share tab · 已读回执') }],
  },
  {
    id: 'a-distill-mint', role: 'A', title: `A 说一句话沉淀「${SKILL}」，确认后铸造`, action: 'prompt', start: 31, end: 52, scenes: JOB,
    prompt: '/obelisk-distill 把我最近准备求职材料的做法沉淀成一个 Skill，然后铸造',
    moments: [
      { t: 36, type: 'session', text: 'A 在 Claude Code 中说「把我最近准备求职材料的做法沉淀成一个 Skill」', apply: (s) => session(s, 'a-distill') },
      { t: 44, type: 'command', text: 'obelisk skill save', apply: (s, at) => command(s, ['skill', 'save', SKILL], at, at, null) },
      { t: 44, type: 'artifact', text: `草稿「${SKILL}」已保存`, apply: (s) => artifact(s, 'skill-draft', SKILL) },
      { t: 50, type: 'command', text: 'obelisk skill mint', apply: (s, at) => command(s, ['skill', 'mint', SKILL, '--confirm', hex('fingerprint', 64)], at, at, 'mint') },
      { t: 50, type: 'transaction', text: `A 铸造 Skill #${SKILL_ID}「${SKILL}」v1`, apply: (s) => transaction(s, 'mint', 'skill mint') },
      { t: 51, type: 'artifact', text: `Skill #${SKILL_ID} 已铸造`, apply: (s) => artifact(s, 'skill-mint', SKILL_ID) },
    ],
  },
  {
    id: 'a-mint-shot', role: 'A', title: '截取 Skill 详情：铸造成功', action: 'capture', start: 53, end: 56,
    moments: [{ t: 56, type: 'screenshot', text: '截图：Skill 详情 · 铸造成功', apply: (s) => screenshot(s, 'Skill 详情 · 铸造成功') }],
  },
  ...['U1', 'U2', 'U3'].map((role, i): StepPlan => {
    const task = ['整理后端岗位的项目经历', '为设计岗位整理作品集说明', '按岗位要求改写履历要点'][i]!;
    const start = 57 + i * 9;
    return {
      id: `${role.toLowerCase()}-task`, role, title: `用户 ${i + 1} 取用这个 Skill，${task}`, action: 'prompt', start, end: start + 8,
      scenes: i === 1 ? ['v1:role/designer', 'v1:artifact/portfolio'] : JOB,
      prompt: `/obelisk-skill-assets 取用 Skill #${SKILL_ID}「${SKILL}」v1，帮我：${task}`,
      moments: [
        { t: start + 1, type: 'command', text: 'obelisk skill fetch', apply: (s, at) => command(s, ['skill', 'fetch', SKILL_ID], at, at, null) },
        { t: start + 1, type: 'artifact', text: `取用 Skill #${SKILL_ID}`, apply: (s) => artifact(s, 'skill-fetch', SKILL_ID) },
        { t: start + 5, type: 'session', text: `用户 ${i + 1} 在 ${harnessOf(role).kind === 'codex' ? 'Codex' : 'Claude Code'} 中用这个 Skill ${task}`, apply: (s) => session(s, `${role}-task`) },
        { t: start + 7, type: 'command', text: 'obelisk usage report', apply: (s, at) => command(s, ['usage', 'report'], at, at, `report-${role}`) },
        { t: start + 7, type: 'transaction', text: `用户 ${i + 1} 上报 1 次调用`, apply: (s) => transaction(s, `report-${role}`, 'usage report') },
      ],
    };
  }),
  {
    id: 'a-usage-shot', role: 'A', title: '截取 Skill 详情：调用量更新', action: 'capture', start: 84, end: 88,
    moments: [{ t: 88, type: 'screenshot', text: '截图：Skill 详情 · 3 次真实调用', apply: (s) => screenshot(s, 'Skill 详情 · 3 次真实调用') }],
  },
];

export const FIXTURE_LENGTH_S = 90;

/**
 * The fixture run as it stands `elapsed` seconds in (whole run when omitted):
 * finished steps, the one in progress, and the events written so far.
 */
export function fixtureRun(id = FIXTURE_RUN, { startedAt = '2026-10-06T13:10:00Z', elapsed = Infinity }: { startedAt?: string; elapsed?: number } = {}) {
  const t0 = Date.parse(startedAt);
  const iso = (s: number) => new Date(t0 + s * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const events: Omit<PlaygroundEvent, 'seq'>[] = [];
  const event = (t: number, type: EventType, text: string, fields: Partial<PlaygroundEvent> = {}) => {
    if (t <= elapsed) events.push({ schema: EVENT_SCHEMA, runId: id, at: iso(t), type, stepId: null, role: null, text, data: {}, ...fields });
  };
  const title = '示例数据 · 演示闭环（fixture，不是真实运行）';
  event(0, 'run.started', `运行开始 · 剧本「${title}」`, { data: { scenario: 'demo-loop-fixture', chainId: CHAIN_ID } });

  const steps: StepRecord[] = PLAN.map((plan, index) => {
    const step: StepRecord = {
      id: plan.id, index, title: plan.title, role: plan.role, action: plan.action, scenes: plan.scenes ?? [],
      status: 'pending', startedAt: null, endedAt: null,
      harness: plan.action === 'prompt' ? { ...harnessOf(plan.role), maxTurns: 30 } : null,
      prompt: plan.prompt ?? null,
      sessions: [], commands: [], transactions: [], artifacts: [], screenshots: [], error: null,
    };
    if (plan.start > elapsed) return step;
    step.status = 'running';
    step.startedAt = iso(plan.start);
    event(plan.start, 'step.started', plan.title, { stepId: plan.id, role: plan.role });
    for (const moment of plan.moments) {
      if (moment.t > elapsed) continue;
      const data = moment.apply ? moment.apply(step, iso(moment.t)) : {};
      event(moment.t, moment.type, moment.text, { stepId: plan.id, role: plan.role, data });
    }
    if (plan.end <= elapsed) {
      step.status = 'succeeded';
      step.endedAt = iso(plan.end);
      event(plan.end, 'step.finished', '完成', { stepId: plan.id, role: plan.role, data: { status: 'succeeded', error: null } });
    }
    return step;
  });
  const done = elapsed >= FIXTURE_LENGTH_S;
  event(FIXTURE_LENGTH_S, 'run.finished', '运行结束 · 成功', { data: { status: 'succeeded', error: null } });

  const record: PlaygroundProvenance = {
    schema: PROVENANCE_SCHEMA,
    run: {
      id,
      scenario: { name: 'demo-loop-fixture', title, file: 'playground/scenarios/demo-loop.json', sha256: hex('scenario', 64) },
      network: { serviceUrl: 'https://obelisk-service.kinomotomiovo.workers.dev', chainId: CHAIN_ID },
      startedAt: iso(0),
      endedAt: done ? iso(FIXTURE_LENGTH_S) : null,
      status: done ? 'succeeded' : 'running',
      dryRun: false,
      obelisk: { gitCommit: 'f1x7ure' },
    },
    roles: ROLES,
    steps,
    totals: summarizeTotals(ROLES, steps),
  };
  // Events are numbered in time order, as the runner appends them.
  const ordered = events
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.i - b.i)
    .map(({ entry }, i) => ({ ...entry, seq: i + 1 }) as PlaygroundEvent);
  return { record, events: ordered };
}

function writeShots(runDir: string, record: PlaygroundProvenance, written: Set<string>) {
  for (const [i, shot] of record.steps.flatMap((step) => step.screenshots).entries()) {
    if (written.has(shot.file)) continue;
    writeFileSync(join(runDir, shot.file), fixtureScreenshot(`STEP ${record.steps.find((s) => s.screenshots.includes(shot))!.index + 1}`, i * 2 + 1));
    written.add(shot.file);
  }
}

/** Writes the finished fixture run under `<home>/runs/`; returns its directory. */
export function writeFixture(home: string, id = FIXTURE_RUN): string {
  const runDir = join(home, 'runs', id);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  const { record, events } = fixtureRun(id);
  writeFileSync(join(runDir, 'provenance.json'), `${JSON.stringify(record, null, 2)}\n`);
  writeFileSync(join(runDir, 'events.jsonl'), events.map((e) => `${JSON.stringify(e)}\n`).join(''));
  writeShots(runDir, record, new Set());
  return runDir;
}

/**
 * Replays the fixture into `<home>/runs/<id>/` as a runner would write it:
 * events appended, the record rewritten, screenshots saved as their steps end.
 */
export async function replayFixture(home: string, { seconds = FIXTURE_LENGTH_S, id = FIXTURE_LIVE_RUN, onTick }: { seconds?: number; id?: string; onTick?: (elapsed: number) => void } = {}) {
  const runDir = join(home, 'runs', id);
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  const startedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const scale = FIXTURE_LENGTH_S / seconds;
  const written = new Set<string>();
  let seq = 0;
  for (let elapsed = 0; ; elapsed += scale) {
    const { record, events } = fixtureRun(id, { startedAt, elapsed: Math.min(elapsed, FIXTURE_LENGTH_S) });
    writeShots(runDir, record, written);
    for (const e of events.slice(seq)) appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(e)}\n`);
    seq = events.length;
    writeFileSync(join(runDir, 'provenance.json.tmp'), `${JSON.stringify(record, null, 2)}\n`);
    renameSync(join(runDir, 'provenance.json.tmp'), join(runDir, 'provenance.json'));
    onTick?.(elapsed);
    if (elapsed >= FIXTURE_LENGTH_S) return runDir;
    await sleep(1000);
  }
}
