// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk resume facts | render` (AI 能力履历, #28) through the built CLI,
// with fixture sessions in the holder's history and the in-memory Skill
// service from skill-chain-fakes.mjs (never the live service).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runCliAsync, supported } from './chain-cli-fakes.mjs';
import { setupPeople, startFakeSkillService } from './skill-chain-fakes.mjs';
import { outcomeBucketKey } from '../packages/core/src/usage-buckets.ts';

const skip = !supported && 'system keychain not supported here';
const OCT = '195ff3f4-85c3-44e8-9a45-05a27f305e1c'; // share-secrets-session, 2026-10-06
const SEP = 'e3d532d5-1980-4b10-92dc-34bd2af2ea8f'; // custom-title-session, 2026-09-14
const draft = (name, body, extra = {}) => ({
  name,
  description: `${name} fixture`,
  body,
  birthScenes: ['v1:artifact/resume', 'v1:task/writing'],
  provenance: [],
  ...extra,
});

function addSession(home, project, fixture, sessionId) {
  const dir = join(home, '.claude', 'projects', project);
  mkdirSync(dir, { recursive: true });
  copyFileSync(new URL(`./fixtures/claude/${fixture}.jsonl`, import.meta.url), join(dir, `${sessionId}.jsonl`));
}

async function setup(t) {
  const service = await startFakeSkillService();
  t.after(() => service.close());
  const { alice, bob } = setupPeople(service);
  addSession(alice.home, '-work-payments', 'share-secrets-session', OCT);
  addSession(alice.home, '-work-portfolio', 'custom-title-session', SEP);
  await alice.ok('wallet', 'create');
  const minted = await alice.mint(draft('ai-resume', '# AI resume\n\nCollect the evidence first.'));
  await alice.mint(draft('release-checklist', '# Release checklist\n\nCheck the rollback plan.'));
  await bob.ok('wallet', 'create');
  await bob.mint(draft('ai-resume-designer-portfolio', '# Portfolio\n\nLead with the work samples.', { parent: { skillId: '1' } }));
  // Two wallets reported uses of alice's first version; one of them with
  // judged outcomes (#25): one smooth, one rework, one the judge could not tell.
  const fingerprint = service.skills[0].versions[0].fingerprint;
  const outcomes = Object.fromEntries([['smooth', 1], ['rework', 1], ['unknown', 1]].map(([id, n]) => [outcomeBucketKey(`outcome/${id}`), n]));
  service.usage.set(`${fingerprint}:0x00000000000000000000000000000000000000a1`, { cumulative: 3, scenes: {}, outcomes: {} });
  service.usage.set(`${fingerprint}:0x00000000000000000000000000000000000000b2`, { cumulative: 2, scenes: {}, outcomes });
  return { service, alice, bob, author: minted.author };
}

test('resume facts: the period counted from history, and the holder\'s minted Skills with usage and derived Skills from the chain', { skip }, async (t) => {
  const { alice, author } = await setup(t);
  const all = await alice.ok('resume', 'facts', '--since', '2026-09-01');
  assert.equal(all.holder.wallet, author);
  assert.match(all.holder.explorerUrl, /\/address\/0x/);
  assert.equal(all.network, 'BOT Chain testnet (968)');
  assert.deepEqual({ sessions: all.history.sessions, projects: all.history.projects, days: all.history.activeDays }, { sessions: 2, projects: 2, days: 2 });
  assert.deepEqual(all.history.sources, [{ source: 'claude', sessions: 2 }]);
  const resume = all.skills.find((skill) => skill.name === 'ai-resume');
  assert.deepEqual({ id: resume.skillId, calls: resume.usage.totalInvocations, wallets: resume.usage.uniqueWallets }, { id: '1', calls: 5, wallets: 2 });
  assert.deepEqual({ rate: resume.usage.smoothRate, judged: resume.usage.judged }, { rate: 0.5, judged: 2 }, 'smooth / judged, unknown left out');
  assert.equal(all.skills.find((skill) => skill.name === 'release-checklist').usage.smoothRate, null, 'no judged outcomes, no success rate');
  assert.deepEqual(resume.derived.map((skill) => skill.skillId), ['3'], "bob's Skill is derived from it");
  assert.match(resume.explorer.mint, /\/tx\/0x/);
  assert.equal(all.skills.length, 2, "only the holder's own minted Skills");
  assert.deepEqual(all.unavailable.map((entry) => entry.field), ['dimensions', 'smoothRate']);

  const october = await alice.ok('resume', 'facts', '--since', '2026-10-01');
  assert.equal(october.history.sessions, 1);
});

test('resume render: numbers come from the index and the chain, ids that do not check out are dropped, text is escaped', { skip }, async (t) => {
  const { alice } = await setup(t);
  const spec = {
    since: '2026-09-01',
    headline: '用 AI 定位并修复线上问题 <b>bold</b>',
    dimensions: [
      { tag: 'v1:task/debug', sessions: [OCT, SEP, 'not-a-session'] },
      { tag: 'v1:domain/backend', sessions: [OCT] },
      { tag: 'v1:artifact/report', sessions: ['not-a-session'] },
    ],
    problems: [{ title: '找出部署笔记里的数据库主机', summary: '读配置并给出一句话结论 <script>alert(1)</script>', tags: ['v1:task/debug'], sessionId: OCT, messages: { from: 1, to: 2 } }],
    skills: ['ai-resume'],
  };
  const file = join(alice.home, 'spec.json');
  writeFileSync(file, JSON.stringify(spec));
  const out = join(alice.home, 'out', 'resume.html');
  const rendered = await alice.ok('resume', 'render', file, '--out', out);
  assert.equal(rendered.path, out);
  assert.deepEqual(rendered.dimensions, [{ label: '调试与排障', dimension: '任务类型', sessions: 2 }, { label: '后端与数据', dimension: '技术领域', sessions: 1 }]);
  assert.deepEqual(rendered.dropped.map((entry) => entry.sessionId), ['not-a-session', 'not-a-session']);
  assert.deepEqual(rendered.skills.map((skill) => [skill.name, skill.invocations, skill.derived, skill.smoothRate, skill.judged]), [['ai-resume', 5, 1, 0.5, 2]]);
  assert.equal(rendered.evidence[0].prompt, `/obelisk-share 把 session「找出部署笔记里的数据库主机」（${OCT}）第 1–2 条分享给 <招聘方的钱包地址>，限 1 次，24 小时内有效`);

  const html = readFileSync(out, 'utf8');
  assert.match(html, /<title>AI 能力履历<\/title>/);
  assert.match(html, /2 个 session/);
  assert.match(html, />5<\/td>/, 'real invocations from the chain');
  assert.match(html, /铸造记录 ↗/);
  assert.match(html, /50%<div class="muted small">判断 2 次/, 'the success rate from judged reports');
  assert.match(html, /各能力维度不显示顺利率/, 'and why dimensions have none');
  assert.ok(!html.includes('<script>alert'), 'agent-written text is escaped');
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(!/<script|src=["']http/.test(html), 'no scripts or remote resources');
  assert.ok(!html.includes('release-checklist'), 'only the Skills the spec named');
});

test('resume refuses specs it cannot back, and says when the chain cannot be read', { skip }, async (t) => {
  const { alice } = await setup(t);
  const write = (spec) => {
    const file = join(alice.home, `bad-${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(spec));
    return file;
  };
  const context = await alice.run('resume', 'render', write({ dimensions: [{ tag: 'v1:context/job-search', sessions: [OCT] }] }));
  assert.equal(context.status, 1);
  assert.match(context.json.error, /is a context tag; résumé dimensions are domain, task, or artifact tags/);
  const unknown = await alice.run('resume', 'render', write({ dimensions: [{ tag: 'v1:task/juggling', sessions: [OCT] }] }));
  assert.match(unknown.json.error, /is not a scene tag/);
  const missing = await alice.run('resume', 'render', write({ skills: ['never-saved'] }));
  assert.match(missing.json.error, /never-saved, which is not in the Skill library/);
  const usage = await alice.run('resume', 'nope');
  assert.match(usage.json.error, /Usage: obelisk resume facts/);

  const offline = await alice.ok('resume', 'facts');
  assert.ok(offline.skills.length > 0);
  const env = { ...alice.env, OBELISK_SERVICE_URL: 'http://127.0.0.1:9' };
  const down = await runCliAsync(['resume', 'facts'], env);
  assert.equal(down.status, 0, down.stdout);
  assert.match(down.json.serviceError, /Could not reach the Obelisk online service/);
  assert.ok(down.json.skills.every((skill) => skill.usage === null && skill.usageError), 'no figures without the chain');
  assert.equal(down.json.history.sessions, 2, 'the history still counts');
});
