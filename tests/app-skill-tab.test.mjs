// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as skillPrompts from '../app/src/renderer/src/skill-prompts.mjs';
import { renderPrompt } from '../app/src/renderer/src/assistant-prompts.mjs';

// The prompts as copied for Claude Code (the default); the Codex form is
// covered in app-assistant-prompts.test.mjs.
const forClaude = build => (...args) => renderPrompt(build(...args), 'claude-code');
const continueEditingPrompt = forClaude(skillPrompts.continueEditingPrompt);
const derivePrompt = forClaude(skillPrompts.derivePrompt);
const dropEvidencePrompt = forClaude(skillPrompts.dropEvidencePrompt);
const fetchPrompt = forClaude(skillPrompts.fetchPrompt);
const mintPrompt = forClaude(skillPrompts.mintPrompt);
import {
  explorerTxUrl,
  formatSpan,
  groupSkills,
  mintedVersions,
  provenanceCard,
  shortFingerprint,
  skillStage,
} from '../app/src/renderer/src/skill-library.mjs';

const FP = 'a'.repeat(60) + 'e07a';
const TX = `0x${'b7'.repeat(32)}`;

function mint(versionIndex, overrides = {}) {
  return { chainId: 968, skillId: '12', versionIndex, author: '0xA1c9', txHash: TX, mintedAt: '2026-10-05T10:00:00.000Z', ...overrides };
}

function view({ versions = [], draftMinted = false } = {}) {
  return {
    name: 'job-application-materials',
    draft: { fingerprint: FP, body: '# x', minted: draftMinted },
    versions,
  };
}

test('the mint prompt previews first and confirms only the fingerprint reviewed in the App', () => {
  const prompt = mintPrompt(view());
  assert.match(prompt, /^\/obelisk-skill-assets 铸造 Skill 草稿「job-application-materials」，先给我看铸造预览。/);
  const reviewed = prompt.indexOf(`审阅的版本指纹是 ${FP}`);
  const confirm = prompt.indexOf(`\`obelisk skill mint job-application-materials --confirm ${FP}\``);
  assert.ok(reviewed > 0 && confirm > reviewed, prompt);
  assert.match(prompt, /等我确认/);
});

test('a Skill minted before is minted again as a new version', () => {
  const prompt = mintPrompt(view({ versions: [{ fingerprint: 'c'.repeat(64), mint: mint(0) }] }));
  assert.match(prompt, /^\/obelisk-skill-assets 铸造 Skill「job-application-materials」的新版本，先给我看铸造预览。/);
});

test('a Skill without a draft has nothing to mint', () => {
  assert.throws(() => mintPrompt({ name: 'gone', draft: null, versions: [] }), /no draft/);
});

test('"去掉" names the draft and the session, by title and id', () => {
  assert.equal(
    dropEvidencePrompt(view(), { sessionId: 's-1', title: '为面试准备系统设计案例' }),
    '/obelisk-distill 从草稿「job-application-materials」的证据中去掉 session「为面试准备系统设计案例」（s-1），重新起草',
  );
  assert.equal(
    dropEvidencePrompt(view(), { sessionId: 's-2', title: null }),
    '/obelisk-distill 从草稿「job-application-materials」的证据中去掉 session s-2，重新起草',
  );
});

test('"继续修改" edits the draft, or starts a new draft from a minted Skill', () => {
  assert.equal(continueEditingPrompt(view()), '/obelisk-distill 继续修改草稿「job-application-materials」：');
  assert.equal(
    continueEditingPrompt(view({ versions: [{ fingerprint: FP, mint: mint(0) }], draftMinted: true })),
    '/obelisk-distill 继续修改 Skill「job-application-materials」，改好后保存成新的草稿：',
  );
});

test('drafts waiting for review are told apart from minted Skills, from summaries and views alike', () => {
  const summaries = [
    { name: 'a', draftFingerprint: FP, draftMinted: false, versionCount: 0 },
    { name: 'b', draftFingerprint: FP, draftMinted: false, versionCount: 1 },
    { name: 'c', draftFingerprint: FP, draftMinted: true, versionCount: 2 },
  ];
  assert.deepEqual(summaries.map(skillStage), ['draft', 'revision', 'minted']);
  const { pending, minted } = groupSkills(summaries);
  assert.deepEqual(pending.map(s => s.name), ['a', 'b']);
  assert.deepEqual(minted.map(s => s.name), ['c']);
  assert.equal(skillStage(view()), 'draft');
  assert.equal(skillStage(view({ versions: [{ fingerprint: 'c'.repeat(64), mint: mint(0) }] })), 'revision');
  assert.equal(skillStage(view({ versions: [{ fingerprint: FP, mint: mint(0) }], draftMinted: true })), 'minted');
});

test('minted versions are listed newest first with a link to their transaction', () => {
  const versions = mintedVersions(view({ versions: [
    { fingerprint: 'c'.repeat(64), mint: mint(0) },
    { fingerprint: FP, mint: mint(1) },
  ] }));
  assert.deepEqual(versions.map(v => v.label), ['v2', 'v1']);
  assert.equal(versions[0].txUrl, `https://scan.bohr.life/tx/${TX}`);
  assert.equal(explorerTxUrl(mint(0, { chainId: 677 })), `https://scan.botchain.ai/tx/${TX}`);
  assert.equal(explorerTxUrl(mint(0, { txHash: null })), null);
  assert.equal(explorerTxUrl(mint(0, { chainId: 31337 })), null);
  assert.equal(explorerTxUrl(mint(0, { txHash: 'javascript:alert(1)' })), null);
});

test('prompts about a minted Skill name it by Skill id and version, never by a shortened fingerprint', () => {
  const minted = { skillId: '7', name: 'ai-resume' };
  assert.equal(fetchPrompt(minted, 1), '/obelisk-skill-assets 取用 Skill #7「ai-resume」v2，帮我：');
  assert.equal(
    derivePrompt(minted, 0),
    '/obelisk-distill 在 Skill #7「ai-resume」v1 的基础上改出一个新版本，铸造时记录父 Skill。我想改成：',
  );
  assert.equal(fetchPrompt({ skillId: '9', name: null }, 0), '/obelisk-skill-assets 取用 Skill #9 v1，帮我：');
});

test('the shortened fingerprint is for display only', () => {
  assert.equal(shortFingerprint(FP), 'aaaa…e07a');
});

test('the provenance card counts sessions over a span and keeps each note tied to its evidence', () => {
  const sessions = new Map([
    ['s-1', { id: 's-1', title: '整理项目经历', source: 'claude', started_at: '2026-09-12T09:00:00.000Z' }],
    ['s-2', { id: 's-2', title: '技术复盘', source: 'codex', started_at: '2026-10-02T09:00:00.000Z' }],
  ]);
  const card = provenanceCard([
    { sessionId: 's-1', reason: '按问题归纳', pitfalls: ['直接罗列提交记录'] },
    { sessionId: 's-2', reason: '复盘结构', corrections: ['不要夸大职责'], excerpts: [{ messageUuid: 'm-1', text: '<b>原样</b>' }] },
    { sessionId: 's-missing', reason: '不在索引里' },
  ], sessions, source => ({ claude: 'Claude Code', codex: 'Codex' }[source]));

  assert.equal(card.sessionCount, 3);
  assert.equal(card.span, '3 周');
  assert.deepEqual(card.sources, [{ name: 'Claude Code', count: 1 }, { name: 'Codex', count: 1 }]);
  assert.deepEqual(card.pitfalls, [{ text: '直接罗列提交记录', number: 1 }]);
  assert.deepEqual(card.corrections, [{ text: '不要夸大职责', number: 2 }]);
  assert.equal(card.evidence[1].excerpts[0].text, '<b>原样</b>', 'excerpts stay as written; the view renders them as text');
  assert.equal(card.evidence[2].session, null);
  assert.equal(card.evidence[2].title, null);
});

test('time spans read naturally', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.equal(formatSpan(2 * 60 * 60 * 1000), '同一天');
  assert.equal(formatSpan(5 * day), '5 天');
  assert.equal(formatSpan(20 * day), '3 周');
  assert.equal(formatSpan(90 * day), '3 个月');
});

test('a family tree lists each parent before its children', async () => {
  const { lineageRows } = await import('../app/src/renderer/src/skill-library.mjs');
  const node = (skillId, parentSkillId, depth) => ({ skillId, parentSkillId, depth });
  const rows = lineageRows([node('1', null, 0), node('3', '1', 1), node('7', '1', 1), node('12', '3', 2)]);
  assert.deepEqual(rows.map(row => [row.skillId, row.depth]), [['1', 0], ['3', 1], ['12', 2], ['7', 1]]);
});

test('the weekly trend scales to its tallest week, and an empty week sits on the baseline', async () => {
  const { trendPoints, percent } = await import('../app/src/renderer/src/skill-library.mjs');
  const points = trendPoints([{ start: 'a', invocations: 0 }, { start: 'b', invocations: 5 }, { start: 'c', invocations: 10 }], { width: 120, height: 60, pad: 10 });
  assert.deepEqual(points.map(point => [point.x, point.y]), [[10, 50], [60, 30], [110, 10]]);
  assert.deepEqual(trendPoints([{ start: 'a', invocations: 0 }], { width: 120, height: 60, pad: 10 }).map(point => point.y), [50]);
  assert.equal(percent(1, 8), '13%');
  assert.equal(percent(1, 0), null);
});

test('a measured scene shows its own 顺利率 only with enough judged calls, and low scenes are called out', async () => {
  const { sceneRow, sceneFinding, SCENE_SAMPLE_MIN } = await import('../app/src/renderer/src/skill-library.mjs');
  const scene = (invocations, smooth, rework, failed, unknown) => ({
    invocations,
    results: { smooth, rework, failed, unknown, judged: smooth + rework + failed, smoothRate: smooth + rework + failed ? smooth / (smooth + rework + failed) : null },
  });
  const overall = 0.86;
  const mobile = sceneRow(scene(918, 690, 60, 18, 150), 918, overall);
  const release = sceneRow(scene(201, 120, 30, 20, 31), 918, overall);
  const few = sceneRow(scene(68, 2, 1, 0, 1), 918, overall);
  const plain = sceneRow({ invocations: 12, results: null }, 918, overall);
  assert.equal(mobile.length, 1);
  assert.deepEqual(mobile.segments.map(s => [s.key, Math.round(s.share * 1000)]), [['smooth', 752], ['rework', 65], ['failed', 20], ['unknown', 163]]);
  assert.equal(mobile.low, false);
  assert.equal(Math.round(release.rate * 100), 71);
  assert.equal(release.low, true, '71% against 86% overall is clearly lower');
  assert.equal(few.enough, false);
  assert.equal(few.rate, null, `fewer than ${SCENE_SAMPLE_MIN} judged calls show no rate`);
  assert.equal(plain.hasResults, false);
  assert.deepEqual(plain.segments, []);
  assert.deepEqual(sceneFinding([mobile, release, few], overall).rows, [release]);
  assert.equal(sceneFinding([mobile, sceneRow(scene(100, 85, 10, 5, 0), 918, overall)], overall).kind, 'even');
  assert.equal(sceneFinding([few], overall).kind, 'few');
  assert.equal(sceneFinding([plain], overall), null, 'no per-scene outcomes, nothing to compare');
});
