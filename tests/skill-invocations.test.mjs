// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parseLoadedSkill,
  skillBodyFromMarkdown,
  skillFingerprint,
} from '../packages/core/src/skills.ts';

const fixtures = new URL('./fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const jsonLines = (path) => read(path).trim().split('\n').map((line) => JSON.parse(line));
const claudeText = (record) => record.message.content.map((block) => block.text).join('\n');
const codexText = (record) => record.payload.content.map((block) => block.text).join('\n');

const probeMd = read('claude/skills/fingerprint-probe/SKILL.md');
const probeFp = skillFingerprint(skillBodyFromMarkdown(probeMd));
const claudeLoads = jsonLines('claude/skill-load-session.jsonl');
const codexRollout = jsonLines('codex/skill-load-rollout.jsonl');
const codexLoad = codexRollout.find((record) => record.payload?.role === 'user' && codexText(record).startsWith('<skill>'));

test('a real Codex Skill load hashes to the same fingerprint as the SKILL.md it loaded', () => {
  const loaded = parseLoadedSkill(codexText(codexLoad));
  assert.deepEqual({ format: loaded.format, name: loaded.name }, { format: 'codex', name: 'fingerprint-probe' });
  assert.equal(skillFingerprint(loaded.body), probeFp);
});

test('a real Claude Code Skill load keeps the name it was loaded under', () => {
  for (const record of claudeLoads) {
    const loaded = parseLoadedSkill(claudeText(record));
    assert.deepEqual({ format: loaded.format, name: loaded.name }, { format: 'claude', name: 'fingerprint-probe' });
    assert.equal(skillFingerprint(loaded.body), probeFp);
  }
  assert.equal(parseLoadedSkill('<skill>\n<name>x</name>\nno path or closing tag'), null);
  assert.equal(parseLoadedSkill('please load the skill'), null);
});
