// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Copied prompts in both forms (assistant-prompts.mjs): a slash command for
// Claude Code, a sentence that names the skill for Codex.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assistantLabel, isPromptAssistant, PROMPT_ASSISTANTS, renderPrompt, skillPrompt,
} from '../app/src/renderer/src/assistant-prompts.mjs';
import * as skillPrompts from '../app/src/renderer/src/skill-prompts.mjs';
import * as sharePrompts from '../app/src/renderer/src/share-prompts.mjs';

const FP = 'a'.repeat(60) + 'e07a';
const B = '0x7a3F00000000000000000000000000000000C21e';
const draft = { name: 'job-application-materials', draft: { fingerprint: FP, minted: false }, versions: [] };

test('the assistants are Claude Code (default) and Codex', () => {
  assert.deepEqual(PROMPT_ASSISTANTS.map(a => a.id), ['claude-code', 'codex']);
  assert.equal(assistantLabel('codex'), 'Codex');
  assert.equal(assistantLabel('nope'), 'Claude Code');
  assert.ok(isPromptAssistant('codex'));
  assert.ok(!isPromptAssistant('cursor'));
});

test('one prompt renders as a slash command for Claude Code and a sentence naming the skill for Codex', () => {
  const prompt = skillPrompts.continueEditingPrompt(draft);
  assert.equal(renderPrompt(prompt), '/obelisk-distill 继续修改草稿「job-application-materials」：');
  assert.equal(renderPrompt(prompt, 'claude-code'), '/obelisk-distill 继续修改草稿「job-application-materials」：');
  assert.equal(renderPrompt(prompt, 'codex'), '用 obelisk-distill 继续修改草稿「job-application-materials」：');
  assert.equal(renderPrompt('plain text', 'codex'), 'plain text', 'plain text is copied as it is');
  assert.equal(renderPrompt(null), '');
  assert.throws(() => skillPrompt('/obelisk-distill', 'x'), /Not an agent skill name/);
});

test('every Skill and Share prompt says the same thing in both forms', () => {
  const minted = { skillId: '7', name: 'ai-resume' };
  const share = { recipient: B, number: 'S-3F2A', title: '修复支付回调重复扣款' };
  const prompts = [
    ['obelisk-distill', skillPrompts.DISTILL_EXAMPLE_PROMPT],
    ['obelisk-distill', skillPrompts.continueEditingPrompt(draft)],
    ['obelisk-distill', skillPrompts.dropEvidencePrompt(draft, { sessionId: 's-1', title: 't' })],
    ['obelisk-skill-assets', skillPrompts.mintPrompt(draft)],
    ['obelisk-skill-assets', skillPrompts.fetchPrompt(minted, 1)],
    ['obelisk-distill', skillPrompts.derivePrompt(minted, 0)],
    ['obelisk-share', sharePrompts.SHARE_EXAMPLE_PROMPT],
    ['obelisk-share', sharePrompts.sharePrompt({ session: { id: 's', title: 't' }, from: 1, to: 2, recipient: B, opens: 1, expires: '24h' })],
    ['obelisk-share', sharePrompts.revokePrompt(share)],
  ];
  for (const [skill, prompt] of prompts) {
    const claude = renderPrompt(prompt, 'claude-code');
    const codex = renderPrompt(prompt, 'codex');
    assert.ok(claude.startsWith(`/${skill} `), claude);
    assert.ok(codex.startsWith(`用 ${skill} `), codex);
    assert.equal(claude.slice(skill.length + 2), codex.slice(skill.length + 3), `${skill}: same request in both forms`);
    assert.ok(!codex.includes(`/${skill}`), `Codex gets no slash command: ${codex}`);
  }
  assert.equal(
    renderPrompt(skillPrompts.fetchPrompt(minted, 1), 'codex'),
    '用 obelisk-skill-assets 取用 Skill #7「ai-resume」v2，帮我：',
  );
});

test('a prompt can word its sentence form differently when the slash form is not a sentence', () => {
  const recap = skillPrompt('obelisk', 'recap this week', { codexText: '生成本周的 recap' });
  assert.equal(renderPrompt(recap, 'claude-code'), '/obelisk recap this week');
  assert.equal(renderPrompt(recap, 'codex'), '用 obelisk 生成本周的 recap');
});
