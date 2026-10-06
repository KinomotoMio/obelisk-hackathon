// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  listSkills,
  readSkill,
  recordMintedVersion,
  saveSkillDraft,
  skillBodyFromLoadedText,
  skillBodyFromMarkdown,
  skillFingerprint,
} from '../packages/core/src/skills.ts';
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
    birthScenes: ['求职材料', 'writing/resume'],
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
  assert.deepEqual(saved.birthScenes, ['求职材料', 'writing/resume']);
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
