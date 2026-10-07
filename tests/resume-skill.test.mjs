// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The 「AI 能力履历」 Skill (#28) ships as a draft to save and mint, not inside
// the Obelisk skill bundle: it is a Skill asset whose uses count on chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { describeSceneTag } from '../packages/core/src/scenes.ts';
import { findDynamicSkillContent, parseSkillDraft, skillBodyFromMarkdown } from '../packages/core/src/skills.ts';

const dir = new URL('../minted-skills/ai-capability-resume/', import.meta.url);

test('the AI 能力履历 draft saves as written and leaves every number to obelisk resume', () => {
  const draft = JSON.parse(readFileSync(new URL('draft.json', dir), 'utf8'));
  const body = readFileSync(new URL(draft.bodyFile, dir), 'utf8');
  const parsed = parseSkillDraft({ ...draft, body });
  assert.equal(parsed.name, 'ai-capability-resume');
  assert.ok(parsed.description.length <= 1024);
  assert.deepEqual(findDynamicSkillContent(skillBodyFromMarkdown(body)), [], 'loads exactly as minted, so its uses are recognized');
  for (const tag of parsed.birthScenes) assert.equal(describeSceneTag(tag).kind, 'vocabulary', tag);
  assert.match(body, /obelisk resume facts/);
  assert.match(body, /obelisk resume render/);
  assert.match(body, /不要估算顺利率/);
  assert.doesNotMatch(body, /\/Users\/|\/home\/[a-z]/, 'no absolute home paths');
});

test('the AI 能力履历 is not bundled with the Obelisk skills', () => {
  assert.ok(!readdirSync(new URL('../agent-skills/', import.meta.url)).includes('ai-capability-resume'));
});
