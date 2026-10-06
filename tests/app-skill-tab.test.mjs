// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  continueEditingPrompt,
  dropEvidencePrompt,
  mintPrompt,
} from '../app/src/renderer/src/skill-prompts.mjs';
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
  assert.match(prompt, /^用 Obelisk 铸造 Skill 草稿「job-application-materials」。/);
  const preview = prompt.indexOf('`obelisk skill mint job-application-materials`');
  const confirm = prompt.indexOf(`\`obelisk skill mint job-application-materials --confirm ${FP}\``);
  assert.ok(preview > 0 && confirm > preview, prompt);
  assert.match(prompt, /我确认之后/);
});

test('a Skill minted before is minted again as a new version', () => {
  const prompt = mintPrompt(view({ versions: [{ fingerprint: 'c'.repeat(64), mint: mint(0) }] }));
  assert.match(prompt, /^用 Obelisk 铸造 Skill「job-application-materials」的新版本。/);
});

test('a Skill without a draft has nothing to mint', () => {
  assert.throws(() => mintPrompt({ name: 'gone', draft: null, versions: [] }), /no draft/);
});

test('"去掉" names the draft and the session, by title and id', () => {
  assert.equal(
    dropEvidencePrompt(view(), { sessionId: 's-1', title: '为面试准备系统设计案例' }),
    '用「沉淀 Skill」从草稿「job-application-materials」的证据中去掉 session「为面试准备系统设计案例」（s-1），重新起草',
  );
  assert.equal(
    dropEvidencePrompt(view(), { sessionId: 's-2', title: null }),
    '用「沉淀 Skill」从草稿「job-application-materials」的证据中去掉 session s-2，重新起草',
  );
});

test('"继续修改" edits the draft, or starts a new draft from a minted Skill', () => {
  assert.equal(continueEditingPrompt(view()), '用「沉淀 Skill」继续修改草稿「job-application-materials」：');
  assert.equal(
    continueEditingPrompt(view({ versions: [{ fingerprint: FP, mint: mint(0) }], draftMinted: true })),
    '用「沉淀 Skill」继续修改 Skill「job-application-materials」，改好后保存成新的草稿：',
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
