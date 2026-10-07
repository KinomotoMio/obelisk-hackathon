// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Playground run fixtures (#32) in the runner's schema
// (playground/src/provenance.ts): runs/<run id>/provenance.json,
// runs/<run id>/events.jsonl, runs/<run id>/screenshots/. Shared by the unit
// tests and the Electron suite. Times are relative to `now` so a running run
// looks live.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { EVENT_SCHEMA, PROVENANCE_SCHEMA, summarizeTotals } from '../playground/src/provenance.ts';

// A 1x1 PNG, enough for anything that does not look at the picture.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const hex = (seed, length) => createHash('sha256').update(seed).digest('hex').repeat(2).slice(0, length);
export const wallet = role => `0x${hex(`wallet:${role}`, 40)}`;
export const txHash = seed => `0x${hex(`tx:${seed}`, 64)}`;
const sessionId = seed => `${hex(`session:${seed}`, 8)}-${hex(`s2:${seed}`, 4)}-4${hex(`s3:${seed}`, 3)}-8${hex(`s4:${seed}`, 3)}-${hex(`s5:${seed}`, 12)}`;

export const LIVE_RUN = 'run-20261007T211000Z-demo';
export const SKILL_ID = '12';
export const SKILL_NAME = 'job-application-materials';
const CHAIN_ID = 968;
const SERVICE_URL = 'https://obelisk-service.example.workers.dev';

const CLAUDE = { kind: 'claude-code', version: '2.1.292 (Claude Code)', model: 'claude-sonnet-5-5' };
const CODEX = { kind: 'codex', version: 'codex-cli 0.160.0', model: 'gpt-6-astra' };
const FAKE = { kind: 'fake', version: null, model: null };

const role = (id, label, harness) => ({ id, label, wallet: { address: wallet(id) }, harness });
const ROLES = [
  role('A', '作者 A', CLAUDE),
  role('B', '接收方 B', CLAUDE),
  role('C', '转发对象 C', CLAUDE),
  role('U1', '用户 1', CLAUDE),
  role('U2', '用户 2', CODEX),
  role('U3', '用户 3', CLAUDE),
  role('U4', '用户 4', CODEX),
];

function session(seed, source = 'claude') {
  const id = sessionId(seed);
  return { source, id, obeliskId: source === 'codex' ? `codex:${id}` : id };
}

function step(index, id, roleId, title, fields = {}) {
  const action = fields.action ?? 'prompt';
  const harness = ROLES.find(r => r.id === roleId)?.harness ?? FAKE;
  return {
    id,
    index,
    title,
    role: roleId,
    action,
    scenes: [],
    status: 'pending',
    startedAt: null,
    endedAt: null,
    harness: action === 'prompt' ? { ...harness, maxTurns: 30 } : null,
    prompt: null,
    sessions: [],
    commands: [],
    transactions: [],
    artifacts: [],
    screenshots: [],
    error: null,
    ...fields,
  };
}

function command(argv, startedAt, endedAt, transactions = [], exitCode = 0) {
  return { argv, exitCode, startedAt, endedAt, transactions };
}

function tx(hash, command) {
  return { hash, chainId: CHAIN_ID, explorerUrl: null, command };
}

function record(run, roles, steps) {
  return { schema: PROVENANCE_SCHEMA, run, roles, steps, totals: summarizeTotals(roles, steps) };
}

function events(runId, list) {
  return list.map((event, index) => ({
    schema: EVENT_SCHEMA,
    runId,
    seq: index + 1,
    stepId: null,
    role: null,
    data: {},
    ...event,
  }));
}

/**
 * The 演示闭环 scenario, caught while 用户 3 works on its task. `elapsedMs` is
 * how long ago it started; `quietMs` how long ago the last event was written.
 */
export function liveRun({ now = Date.now(), elapsedMs = 222_000, quietMs = 4_000 } = {}) {
  const start = now - elapsedMs;
  const at = offsetMs => new Date(start + offsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
  const last = elapsedMs - quietMs;
  const s = {
    share: session('a-share'),
    distill: session('a-distill'),
    u1: session('u1-task'),
    u2: session('u2-task', 'codex'),
  };
  const t = {
    share: txHash('share'),
    receipt: txHash('receipt'),
    mint: txHash('mint'),
    report1: txHash('report-u1'),
    report2: txHash('report-u2'),
  };
  const jobScenes = ['v1:context/job-search', 'v1:role/engineer', 'v1:artifact/resume'];
  const steps = [
    step(0, 'a-share', 'A', 'A 把一个 session 分享给 B，只能打开 1 次', {
      status: 'succeeded', startedAt: at(1_000), endedAt: at(33_000),
      prompt: '/obelisk-share 把最近整理履历的 session 分享给 B，只能打开 1 次',
      sessions: [s.share],
      commands: [command(['share', 'send', '--to', wallet('B'), '--max-opens', '1'], at(24_000), at(31_000), [t.share])],
      transactions: [tx(t.share, 'share send')],
      artifacts: [{ kind: 'share', ref: 'sh_7Qm2' }],
    }),
    step(1, 'c-open', 'C', 'C 打开 B 转发的链接', {
      action: 'cli', status: 'succeeded', startedAt: at(40_000), endedAt: at(45_000),
      commands: [command(['share', 'open', 'sh_7Qm2'], at(40_000), at(44_000), [], 1)],
    }),
    step(2, 'b-open', 'B', 'B 打开分享；A 收到已读回执', {
      action: 'cli', status: 'succeeded', startedAt: at(50_000), endedAt: at(62_000),
      commands: [command(['share', 'open', 'sh_7Qm2'], at(50_000), at(58_000), [t.receipt])],
      transactions: [tx(t.receipt, 'share open')],
      artifacts: [{ kind: 'share-receipt', ref: 'sh_7Qm2' }],
      screenshots: [{ file: 'screenshots/b-open.png', caption: 'A 的 Share tab · 已读回执' }],
    }),
    step(3, 'a-distill-mint', 'A', `A 说一句话沉淀「${SKILL_NAME}」，确认后铸造`, {
      status: 'succeeded', startedAt: at(66_000), endedAt: at(141_000), scenes: jobScenes,
      prompt: '/obelisk-distill 把我最近准备求职材料的做法沉淀成一个 Skill，然后铸造',
      sessions: [s.distill],
      commands: [
        command(['skill', 'save', SKILL_NAME], at(118_000), at(122_000)),
        command(['skill', 'mint', SKILL_NAME, '--confirm', hex('fp', 64)], at(126_000), at(139_000), [t.mint]),
      ],
      transactions: [tx(t.mint, 'skill mint')],
      artifacts: [{ kind: 'skill-draft', ref: SKILL_NAME }, { kind: 'skill-mint', ref: SKILL_NAME }],
      screenshots: [{ file: 'screenshots/a-distill-mint.png', caption: 'Skill 详情 · 铸造成功' }],
    }),
    step(4, 'u1-task', 'U1', '用户 1 取用这个 Skill，整理后端岗位的项目经历', {
      status: 'succeeded', startedAt: at(145_000), endedAt: at(172_000), scenes: jobScenes,
      prompt: `/obelisk-skill-assets 取用 Skill #${SKILL_ID}「${SKILL_NAME}」v1，帮我：整理后端岗位的项目经历`,
      sessions: [s.u1],
      commands: [
        command(['skill', 'fetch', SKILL_ID], at(146_000), at(149_000)),
        command(['usage', 'report'], at(166_000), at(171_000), [t.report1]),
      ],
      transactions: [tx(t.report1, 'usage report')],
      artifacts: [{ kind: 'skill-fetch', ref: SKILL_ID }, { kind: 'usage-report', ref: t.report1 }],
    }),
    step(5, 'u2-task', 'U2', '用户 2 取用这个 Skill，为设计岗位整理作品集说明', {
      status: 'succeeded', startedAt: at(174_000), endedAt: at(196_000),
      scenes: ['v1:role/designer', 'v1:artifact/portfolio'],
      prompt: `/obelisk-skill-assets 取用 Skill #${SKILL_ID}「${SKILL_NAME}」v1，帮我：为设计岗位整理作品集说明`,
      sessions: [s.u2],
      commands: [
        command(['skill', 'fetch', SKILL_ID], at(175_000), at(177_000)),
        command(['usage', 'report'], at(190_000), at(195_000), [t.report2]),
      ],
      transactions: [tx(t.report2, 'usage report')],
      artifacts: [{ kind: 'skill-fetch', ref: SKILL_ID }, { kind: 'usage-report', ref: t.report2 }],
    }),
    step(6, 'u3-task', 'U3', '用户 3 取用这个 Skill，按岗位要求改写履历要点', {
      status: 'running', startedAt: at(198_000), scenes: ['v1:context/job-search', 'v1:artifact/resume'],
      prompt: `/obelisk-skill-assets 取用 Skill #${SKILL_ID}「${SKILL_NAME}」v1，帮我：按岗位要求改写履历要点`,
      commands: [command(['skill', 'fetch', SKILL_ID], at(199_000), at(201_000))],
      artifacts: [{ kind: 'skill-fetch', ref: SKILL_ID }],
    }),
    step(7, 'u4-task', 'U4', '用户 4 取用这个 Skill，准备系统设计面试案例', { scenes: ['v1:context/job-search', 'v1:role/engineer'] }),
    step(8, 'c-derive', 'C', 'C 在它的基础上衍生「设计师作品集版」'),
    step(9, 'a-summary', 'A', '汇总调用量与族谱', { action: 'cli' }),
  ];
  const r = record({
    id: LIVE_RUN,
    scenario: { name: 'demo-loop', title: '演示闭环', file: 'playground/scenarios/demo-loop.json', sha256: hex('scenario', 64) },
    network: { serviceUrl: SERVICE_URL, chainId: CHAIN_ID },
    startedAt: at(0), endedAt: null, status: 'running', dryRun: false,
    obelisk: { gitCommit: '3515592' },
  }, ROLES, steps);
  const ev = events(LIVE_RUN, [
    { at: at(0), type: 'run.started', text: '运行开始 · 剧本「演示闭环」', data: { scenario: 'demo-loop', chainId: CHAIN_ID } },
    { at: at(1_000), type: 'step.started', stepId: 'a-share', role: 'A', text: 'A 把一个 session 分享给 B，只能打开 1 次' },
    { at: at(22_000), type: 'session', stepId: 'a-share', role: 'A', text: 'A 在 Claude Code 中说出分享的 prompt', data: s.share },
    { at: at(31_000), type: 'transaction', stepId: 'a-share', role: 'A', text: 'A 创建分享，接收方 B，只能打开 1 次', data: tx(t.share, 'share send') },
    { at: at(33_000), type: 'step.finished', stepId: 'a-share', role: 'A', text: '完成', data: { status: 'succeeded', error: null } },
    { at: at(44_000), type: 'command', stepId: 'c-open', role: 'C', text: 'C 打开转发的链接：钱包不匹配，打不开（符合预期）', data: steps[1].commands[0] },
    { at: at(58_000), type: 'transaction', stepId: 'b-open', role: 'B', text: 'B 打开分享，已读回执上链', data: tx(t.receipt, 'share open') },
    { at: at(62_000), type: 'screenshot', stepId: 'b-open', role: 'A', text: '截图：A 的 Share tab · 已读回执', data: steps[2].screenshots[0] },
    { at: at(70_000), type: 'session', stepId: 'a-distill-mint', role: 'A', text: 'A 在 Claude Code 中说「把我最近准备求职材料的做法沉淀成一个 Skill」', data: s.distill },
    { at: at(122_000), type: 'artifact', stepId: 'a-distill-mint', role: 'A', text: `草稿「${SKILL_NAME}」已保存`, data: { kind: 'skill-draft', ref: SKILL_NAME } },
    { at: at(139_000), type: 'transaction', stepId: 'a-distill-mint', role: 'A', text: `A 铸造 Skill #${SKILL_ID}「${SKILL_NAME}」v1`, data: tx(t.mint, 'skill mint') },
    { at: at(141_000), type: 'screenshot', stepId: 'a-distill-mint', role: 'A', text: '截图：Skill 详情 · 铸造成功', data: steps[3].screenshots[0] },
    { at: at(163_000), type: 'session', stepId: 'u1-task', role: 'U1', text: '用户 1 在 Claude Code 中用这个 Skill 整理后端岗位的项目经历', data: s.u1 },
    { at: at(171_000), type: 'transaction', stepId: 'u1-task', role: 'U1', text: '用户 1 上报 1 次调用', data: tx(t.report1, 'usage report') },
    { at: at(188_000), type: 'session', stepId: 'u2-task', role: 'U2', text: '用户 2 在 Codex 中用这个 Skill 整理作品集说明', data: s.u2 },
    { at: at(195_000), type: 'transaction', stepId: 'u2-task', role: 'U2', text: '用户 2 上报 1 次调用', data: tx(t.report2, 'usage report') },
    { at: at(198_000), type: 'step.started', stepId: 'u3-task', role: 'U3', text: '用户 3 取用这个 Skill，按岗位要求改写履历要点' },
    { at: at(last), type: 'note', stepId: 'u3-task', role: 'U3', text: 'Claude Code 已运行 6 轮，等待它完成任务' },
  ]);
  return { record: r, events: ev };
}

/** A dry run that finished, and a run that failed at its first step. */
export function pastRuns({ now = Date.now() } = {}) {
  const day = 86_400_000;
  const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const dryStart = now - day;
  const dryRoles = [role('A', '作者 A', FAKE), role('U', '用户 U', FAKE)];
  const drySteps = [
    step(0, 'a-distill-mint', 'A', 'A 沉淀并铸造一个 Skill', {
      status: 'succeeded', startedAt: iso(dryStart + 1_000), endedAt: iso(dryStart + 9_000),
      harness: { ...FAKE, maxTurns: null },
      sessions: [session('dry-a')],
      artifacts: [{ kind: 'skill-draft', ref: SKILL_NAME }],
    }),
    step(1, 'u-report', 'U', 'U 上报调用统计', { action: 'cli', status: 'succeeded', startedAt: iso(dryStart + 9_000), endedAt: iso(dryStart + 12_000) }),
  ];
  const dryId = 'run-20261006T090000Z-dry';
  const dry = {
    record: record({
      id: dryId,
      scenario: { name: 'smoke', title: '冒烟：沉淀并铸造一个 Skill', file: 'playground/scenarios/smoke.json', sha256: hex('smoke', 64) },
      network: { serviceUrl: null, chainId: null },
      startedAt: iso(dryStart), endedAt: iso(dryStart + 12_000), status: 'succeeded', dryRun: true,
      obelisk: { gitCommit: '3515592' },
    }, dryRoles, drySteps),
    events: events(dryId, [
      { at: iso(dryStart), type: 'run.started', text: '运行开始 · 剧本「冒烟：沉淀并铸造一个 Skill」（空跑）' },
      { at: iso(dryStart + 12_000), type: 'run.finished', text: '运行结束 · 成功', data: { status: 'succeeded', error: null } },
    ]),
  };
  const failStart = now - 2 * day;
  const failId = 'run-20261005T140000Z-fail';
  const failRoles = ROLES.slice(0, 2);
  const failSteps = [
    step(0, 'a-share', 'A', 'A 把一个 session 分享给 B', {
      status: 'failed', startedAt: iso(failStart + 1_000), endedAt: iso(failStart + 48_000),
      sessions: [session('fail-a')],
      commands: [command(['share', 'send', '--to', wallet('B')], iso(failStart + 40_000), iso(failStart + 47_000), [], 2)],
      error: 'B 的钱包还没有激活，分享无法加密',
    }),
    step(1, 'b-open', 'B', 'B 打开分享', { action: 'cli', status: 'skipped' }),
  ];
  const failed = {
    record: record({
      id: failId,
      scenario: { name: 'share', title: '私密分享', file: 'playground/scenarios/share.json', sha256: hex('share', 64) },
      network: { serviceUrl: SERVICE_URL, chainId: CHAIN_ID },
      startedAt: iso(failStart), endedAt: iso(failStart + 48_000), status: 'failed', dryRun: false,
      obelisk: { gitCommit: '3515592' },
    }, failRoles, failSteps),
    events: events(failId, [
      { at: iso(failStart), type: 'run.started', text: '运行开始 · 剧本「私密分享」' },
      { at: iso(failStart + 48_000), type: 'step.finished', stepId: 'a-share', role: 'A', text: '失败', data: { status: 'failed', error: 'B 的钱包还没有激活，分享无法加密' } },
      { at: iso(failStart + 48_000), type: 'run.finished', text: '运行结束 · 失败', data: { status: 'failed', error: 'B 的钱包还没有激活，分享无法加密' } },
    ]),
  };
  return { [dryId]: dry, [failId]: failed };
}

export function writeRun(dir, runId, { record, events }, screenshots = {}) {
  const runDir = join(dir, 'runs', runId);
  mkdirSync(join(runDir, 'screenshots'), { recursive: true });
  writeFileSync(join(runDir, 'provenance.json'), typeof record === 'string' ? record : JSON.stringify(record, null, 2));
  writeFileSync(join(runDir, 'events.jsonl'), events.map(event => `${JSON.stringify(event)}\n`).join(''));
  for (const [file, bytes] of Object.entries(screenshots)) writeFileSync(join(runDir, file), bytes);
  return runDir;
}

export const BROKEN_RUN = 'run-20261004T100000Z-broken';

/** The whole fixture: the live run, a dry run, a failed run, and an unreadable record. */
export function writePlaygroundFixture(dir, { now = Date.now(), live = liveRun({ now }), screenshots } = {}) {
  const files = live.record.steps.flatMap(s => s.screenshots.map(shot => shot.file));
  writeRun(dir, LIVE_RUN, live, screenshots ?? Object.fromEntries(files.map(file => [file, TINY_PNG])));
  for (const [runId, run] of Object.entries(pastRuns({ now }))) writeRun(dir, runId, run);
  writeRun(dir, BROKEN_RUN, { record: '{"schema": "obelisk.playground.provenance/1", "run": {', events: [] });
  return dir;
}
