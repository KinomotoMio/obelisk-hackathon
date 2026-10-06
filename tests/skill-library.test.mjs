// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  listSkills,
  listUserSceneTags,
  readSkill,
  recordMintedVersion,
  saveSkillDraft,
  skillBodyFromLoadedText,
  skillBodyFromMarkdown,
  skillFingerprint,
} from '../packages/core/src/skills.ts';
import {
  SCENE_DIMENSIONS,
  SCENES,
  findScene,
  migrateSceneTag,
  normalizeSceneTag,
  sceneBucketKey,
  vocabularyTag,
} from '../packages/core/src/scenes.ts';
import { keccak256, stringToBytes } from 'viem';
import { makeTempDir } from './temp-dirs.mjs';

const fixtureDir = new URL('./fixtures/claude/', import.meta.url);
const probeSkillMd = readFileSync(new URL('skills/fingerprint-probe/SKILL.md', fixtureDir), 'utf8');
const loadRecords = readFileSync(new URL('skill-load-session.jsonl', fixtureDir), 'utf8')
  .trim().split('\n').map((line) => JSON.parse(line));
const loadedText = (record) => record.message.content.map((block) => block.text).join('');

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

test('版本指纹是正文的 sha256: SKILL.md without frontmatter, trimmed', () => {
  const body = '# Fingerprint probe\n\nReply with the single word PROBED and nothing else.\n\nThis line keeps a second paragraph in the body.';
  assert.equal(skillBodyFromMarkdown(probeSkillMd), body);
  assert.equal(skillFingerprint(skillBodyFromMarkdown(probeSkillMd)), sha256(body));
});

test('the fingerprint matches what Claude Code actually loads, with and without arguments', () => {
  const expected = skillFingerprint(skillBodyFromMarkdown(probeSkillMd));
  assert.equal(loadRecords.length, 2);
  for (const record of loadRecords) {
    const body = skillBodyFromLoadedText(loadedText(record));
    assert.notEqual(body, null);
    assert.equal(skillFingerprint(body), expected, JSON.stringify(loadedText(record)));
  }
  assert.match(loadedText(loadRecords[1]), /ARGUMENTS: alpha beta$/);
});

test('fingerprints ignore line endings and surrounding whitespace but not content', () => {
  const lf = skillFingerprint(skillBodyFromMarkdown(probeSkillMd));
  assert.equal(skillFingerprint(skillBodyFromMarkdown(probeSkillMd.replace(/\n/g, '\r\n'))), lf);
  assert.equal(skillFingerprint(`\n\n${skillBodyFromMarkdown(probeSkillMd)}\n\n`), lf);
  assert.notEqual(skillFingerprint(skillBodyFromMarkdown(probeSkillMd).replace('PROBED', 'PROBED.')), lf);
});

test('text that is not a Skill load has no Skill body', () => {
  assert.equal(skillBodyFromLoadedText('Reply with the single word PROBED'), null);
});

function draft(overrides = {}) {
  return {
    name: 'ai-capability-resume',
    description: 'Draft an evidence-backed AI capability resume: "use when" job hunting.',
    body: '# AI capability resume\n\nCollect evidence from real sessions before writing claims.\n',
    birthScenes: ['context/job-search', 'artifact/resume'],
    parent: null,
    provenance: [
      { sessionId: 'session-a', reason: 'User rejected unsupported claims', excerpts: [{ messageUuid: 'm-1', text: '不要写没有证据的能力' }] },
      { sessionId: 'session-b', reason: 'Resume structure settled here' },
    ],
    ...overrides,
  };
}

test('a saved draft keeps provenance, birth scenes, and parent under the data directory', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  const saved = await saveSkillDraft(skillsDir, draft({ parent: { name: 'resume-base', chainId: 968, skillId: '3' } }), { now: () => '2026-10-07T01:00:00.000Z' });
  assert.equal(saved.dir, join(skillsDir, 'ai-capability-resume'));
  assert.equal(saved.status, 'draft');
  assert.deepEqual(saved.birthScenes, ['v1:context/job-search', 'v1:artifact/resume']);
  assert.deepEqual(saved.parent, { name: 'resume-base', chainId: 968, skillId: '3' });
  assert.equal(saved.provenance[0].excerpts[0].text, '不要写没有证据的能力');
  assert.equal(saved.draft.fingerprint, sha256('# AI capability resume\n\nCollect evidence from real sessions before writing claims.'));

  const skillMd = readFileSync(join(skillsDir, 'ai-capability-resume', 'draft', 'SKILL.md'), 'utf8');
  assert.match(skillMd, /^---\nname: ai-capability-resume\ndescription: "Draft an evidence-backed AI capability resume: \\"use when\\" job hunting."\n---\n\n# AI capability resume/);
  assert.equal(skillFingerprint(skillBodyFromMarkdown(skillMd)), saved.draft.fingerprint);

  const updated = await saveSkillDraft(skillsDir, draft({ body: '# AI capability resume\n\nv2' }), { now: () => '2026-10-07T02:00:00.000Z' });
  assert.equal(updated.createdAt, '2026-10-07T01:00:00.000Z');
  assert.equal(updated.updatedAt, '2026-10-07T02:00:00.000Z');
  assert.notEqual(updated.draft.fingerprint, saved.draft.fingerprint);
});

test('a minted version is frozen with its chain record and survives later draft edits', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  const saved = await saveSkillDraft(skillsDir, draft());
  const mint = { chainId: 968, skillId: '7', versionIndex: 0, author: '0x00000000000000000000000000000000000000a1', txHash: '0xabc', mintedAt: '2026-10-07T03:00:00.000Z' };
  const minted = await recordMintedVersion(skillsDir, 'ai-capability-resume', { fingerprint: saved.draft.fingerprint, mint });
  assert.equal(minted.status, 'minted');
  assert.equal(minted.draft.minted, true);
  assert.equal(minted.versions.length, 1);
  assert.deepEqual(minted.versions[0].mint, mint);
  assert.equal(minted.versions[0].verified, true);
  assert.deepEqual(minted.versions[0].provenance, saved.provenance);

  // Retrying the same mint converges; a different chain record is refused.
  const again = await recordMintedVersion(skillsDir, 'ai-capability-resume', { fingerprint: saved.draft.fingerprint, mint });
  assert.equal(again.versions.length, 1);
  await assert.rejects(
    recordMintedVersion(skillsDir, 'ai-capability-resume', { fingerprint: saved.draft.fingerprint, mint: { ...mint, skillId: '8' } }),
    /already recorded as minted with different chain data/,
  );

  const edited = await saveSkillDraft(skillsDir, draft({ body: '# AI capability resume\n\nedited after mint' }));
  assert.equal(edited.draft.minted, false);
  assert.equal(edited.versions[0].verified, true);
  await assert.rejects(
    recordMintedVersion(skillsDir, 'ai-capability-resume', { fingerprint: saved.draft.fingerprint, mint }),
    /draft changed after the mint preview/,
  );

  writeFileSync(minted.versions[0].path, '---\nname: x\n---\ntampered');
  assert.equal((await readSkill(skillsDir, 'ai-capability-resume')).versions[0].verified, false);
});

test('drafts whose loaded text Claude Code would rewrite are refused', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  for (const body of ['Fix issue $ARGUMENTS', 'Use $0 first', 'Run ${CLAUDE_SKILL_DIR}/x.sh', '## Diff\n\n!`git diff`']) {
    await assert.rejects(saveSkillDraft(skillsDir, draft({ body })), /Claude Code rewrites when loading a Skill/, body);
  }
});

test('出生场景写成"词表版本 + 标签": vocabulary ids are stored with their version, duplicates collapse', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  const saved = await saveSkillDraft(skillsDir, draft({ birthScenes: ['task/writing', ' v1:artifact/resume ', 'v1:task/writing'] }));
  assert.deepEqual(saved.birthScenes, ['v1:task/writing', 'v1:artifact/resume']);
  for (const birthScenes of [['writing/resume'], ['v1:domain/nope'], ['v9:artifact/resume'], 'v1:context/job-search', [42]]) {
    await assert.rejects(saveSkillDraft(skillsDir, draft({ birthScenes })), /birthScenes/, JSON.stringify(birthScenes));
  }
  await assert.rejects(
    saveSkillDraft(skillsDir, draft({ birthScenes: ['v1:task/writing', '求职材料'] })),
    /birthScenes\[1\] "求职材料" is not a tag in scene vocabulary v1; use a tag from `obelisk skill scenes`, or create one as user:<dimension>\/<label>/,
  );
});

test('a new tag outside the vocabulary is stored as user:<dimension>/<label> within 64 bytes', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  const saved = await saveSkillDraft(skillsDir, draft({ birthScenes: ['user:artifact/插画 作品集', 'user:Task/Cover Letter'] }));
  assert.deepEqual(saved.birthScenes, ['user:artifact/插画-作品集', 'user:task/cover-letter']);
  assert.ok(saved.birthScenes.every((tag) => Buffer.byteLength(tag) <= 64));
  for (const tag of ['user:artifact/', 'user:nope/x', 'user:artifact/a:b', 'user:artifact/a/b', `user:artifact/${'插'.repeat(17)}`]) {
    await assert.rejects(saveSkillDraft(skillsDir, draft({ birthScenes: [tag] })), /birthScenes\[0\]/, tag);
  }
});

test('user-created tags are recorded locally as candidates for the next vocabulary version', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  await saveSkillDraft(skillsDir, draft({ name: 'first', birthScenes: ['v1:role/designer', 'user:artifact/插画作品集'] }), { now: () => '2026-10-07T01:00:00.000Z' });
  await saveSkillDraft(skillsDir, draft({ name: 'second', birthScenes: ['user:artifact/插画作品集', 'user:task/分镜'] }), { now: () => '2026-10-07T02:00:00.000Z' });
  await saveSkillDraft(skillsDir, draft({ name: 'first', birthScenes: ['v1:role/designer'] }), { now: () => '2026-10-07T03:00:00.000Z' });
  assert.deepEqual(await listUserSceneTags(skillsDir), [
    { tag: 'user:artifact/插画作品集', dimension: 'artifact', label: '插画作品集', firstUsedAt: '2026-10-07T01:00:00.000Z', lastUsedAt: '2026-10-07T02:00:00.000Z', skills: ['first', 'second'] },
    { tag: 'user:task/分镜', dimension: 'task', label: '分镜', firstUsedAt: '2026-10-07T02:00:00.000Z', lastUsedAt: '2026-10-07T02:00:00.000Z', skills: ['second'] },
  ], 'the record keeps a tag after the Skill that created it drops it');
  assert.deepEqual((await listSkills(skillsDir)).map((skill) => skill.name).sort(), ['first', 'second']);
});

test('scene vocabulary versions translate old tags through synonyms; bucket keys follow the translation', () => {
  const scene = (dimension, slug) => ({ id: `${dimension}/${slug}`, dimension, label: slug, labelEn: slug });
  const dimensions = [{ id: 'task', label: '任务类型', labelEn: 'Task' }];
  const catalogue = {
    vocabularies: [
      { version: 1, dimensions, scenes: [scene('task', 'debug'), scene('task', 'analysis'), scene('task', 'learning')] },
      { version: 2, dimensions, scenes: [scene('task', 'debug'), scene('task', 'research')] },
    ],
    synonyms: { 1: { 'task/analysis': 'task/research' } },
  };
  assert.equal(migrateSceneTag('v1:task/debug', { catalogue }), 'v2:task/debug');
  assert.equal(migrateSceneTag('v1:task/analysis', { catalogue }), 'v2:task/research');
  assert.equal(migrateSceneTag('task/analysis', { catalogue }), 'v2:task/research', 'bare ids from old records read as v1');
  assert.equal(migrateSceneTag('v1:task/learning', { catalogue }), null, 'retired');
  assert.equal(migrateSceneTag('v1:task/analysis', { catalogue, to: 1 }), 'v1:task/analysis');
  assert.equal(migrateSceneTag('user:task/漫画分镜', { catalogue }), 'user:task/漫画分镜');
  assert.equal(normalizeSceneTag('task/research', catalogue), 'v2:task/research', 'input without a version means the current one');
  assert.equal(normalizeSceneTag('v1:task/analysis', catalogue), 'v1:task/analysis', 'older tags stay as written');

  const key = (text) => keccak256(stringToBytes(text));
  assert.equal(sceneBucketKey('v1:task/analysis', catalogue), key('v2:task/research'));
  assert.equal(sceneBucketKey('v2:task/research', catalogue), key('v2:task/research'));
  assert.equal(sceneBucketKey('v1:task/learning', catalogue), key('v1:task/learning'), 'retired tags keep their own bucket');
  assert.equal(sceneBucketKey('user:task/漫画分镜', catalogue), key('user:task/漫画分镜'));
  assert.match(sceneBucketKey('v1:artifact/resume'), /^0x[0-9a-f]{64}$/);
});

test('词表 v1 覆盖演示里出现的每个场景', () => {
  // Scenes named in docs/vision (03, 04, 06, README) and the mockups.
  const demo = {
    '工程师求职': ['context/job-search', 'role/engineer'],
    '年终述职': ['context/performance-review'],
    '设计作品集': ['role/designer', 'artifact/portfolio'],
    '学生实习': ['context/job-search', 'role/student'],
    '插画作品集': ['role/illustrator', 'artifact/portfolio'],
    '求职材料 / 工程师 / 文档写作': ['context/job-search', 'role/engineer', 'task/writing'],
    '创意 PPT': ['context/creative-visual', 'artifact/slides'],
    '电商后台': ['context/ecommerce', 'artifact/admin-dashboard'],
    'React / 落地页 / 商业官网': ['domain/frontend', 'artifact/web-page', 'context/corporate-site'],
    '修复支付回调重复扣款': ['domain/backend', 'task/debug', 'context/payments'],
    '慢查询': ['domain/backend', 'task/performance'],
    '发布流程脚本化': ['domain/automation', 'task/release', 'artifact/script'],
  };
  for (const [name, ids] of Object.entries(demo)) {
    for (const id of ids) assert.ok(findScene(id), `${name}: ${id}`);
  }
  // 创意 PPT and 电商后台 front-end Skills differ by more than the artifact.
  assert.notEqual(findScene('context/creative-visual').dimension, findScene('artifact/slides').dimension);
  // The AI capability resume dimension chart reads straight off tag labels.
  const chart = { 调试与排障: 'task/debug', 后端与数据: 'domain/backend', 前端与交互: 'domain/frontend', 自动化与脚本: 'domain/automation', 系统设计: 'task/architecture' };
  for (const [label, id] of Object.entries(chart)) assert.equal(findScene(id).label, label);
  assert.match(findScene('task/writing').label, /文档.*沟通/);
});

test('the current vocabulary is chain-compatible and every id is unique', () => {
  const ids = SCENES.map((scene) => scene.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const scene of SCENES) {
    assert.match(scene.id, /^[a-z]+\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(scene.id.split('/')[0], scene.dimension);
    assert.ok(Buffer.byteLength(vocabularyTag(scene.id)) <= 64, scene.id);
    assert.ok(scene.label && scene.labelEn, scene.id);
    assert.equal(findScene(scene.id), scene);
  }
  for (const dimension of SCENE_DIMENSIONS) {
    assert.ok(SCENES.some((scene) => scene.dimension === dimension.id), dimension.id);
  }
});

test('Skill names cannot escape the library directory', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  for (const name of ['../escape', 'Upper', 'a/b', '', 'x'.repeat(65)]) {
    await assert.rejects(saveSkillDraft(skillsDir, draft({ name })), /Skill name must be/);
  }
  await assert.rejects(readSkill(skillsDir, '../escape'), /Skill name must be/);
});

test('listing shows every Skill newest first and skips stray entries', async () => {
  const skillsDir = join(makeTempDir('obelisk-skills-'), 'skills');
  assert.deepEqual(await listSkills(skillsDir), []);
  await saveSkillDraft(skillsDir, draft({ name: 'older' }), { now: () => '2026-10-07T01:00:00.000Z' });
  await saveSkillDraft(skillsDir, draft({ name: 'newer' }), { now: () => '2026-10-07T02:00:00.000Z' });
  mkdirSync(join(skillsDir, 'not-a-skill'));
  writeFileSync(join(skillsDir, '.DS_Store'), '');
  const listed = await listSkills(skillsDir);
  assert.deepEqual(listed.map((s) => s.name), ['newer', 'older']);
  assert.equal(listed[0].provenanceSessions, 2);
  assert.equal(listed[0].status, 'draft');
});
