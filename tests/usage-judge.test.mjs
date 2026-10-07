// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The outcome judge's prompt and answer contract, and how the local harness
// is run (#25). The harness itself is faked in tests/usage-judge-cli.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildJudgePrompt, harnessCommand, judgeOutputSchema, parseJudgeOutput, renderSlice } from '../packages/core/src/usage-judge.ts';

const event = (role, text, extra = {}) => ({
  uuid: `${role}-${text.length}-${Math.random()}`, role, timestamp: null, human: role === 'user', text, toolCalls: [], toolResults: [], ...extra,
});
const edit = (file) => event('assistant', '', { toolCalls: [{ name: 'Edit', filePath: file }] });
const slice = (events, request = 'fix the login bug') => ({ request, events, endedByNextLoad: false, sessionLastAt: '2026-10-01T00:00:00Z' });

test('the judge reads a compact slice: the request, what followed, tool names and errors, cut to a bounded size', () => {
  const long = 'x'.repeat(2000);
  const text = renderSlice(slice([
    event('assistant', 'I will edit the file'),
    edit('/p/a.ts'),
    event('user', '', { human: false, toolResults: [{ isError: false, text: 'secret file body' }, { isError: true, text: 'permission denied' }] }),
    ...Array.from({ length: 40 }, () => event('assistant', long)),
  ]));
  assert.match(text, /^\[user, before the Skill\] fix the login bug/);
  assert.match(text, /→ Edit \/p\/a\.ts/);
  assert.match(text, /← tool error: permission denied/);
  assert.doesNotMatch(text, /secret file body/, 'successful tool output is left out');
  assert.ok(text.length <= 5200, `rendered ${text.length} characters`);
  assert.match(text, /\[… cut\]$/);

  const prompt = buildJudgePrompt([
    { id: 'i1', skill: { name: 'ai-resume', description: 'Draft a resume' }, slice: slice([event('assistant', 'done')]) },
    { id: 'i2', skill: { name: 'ai-resume', description: 'Draft a resume' }, slice: slice([]) },
  ]);
  assert.match(prompt, /=== i1 · Skill "ai-resume"/);
  assert.match(prompt, /=== i2 /);
  assert.match(prompt, /task\/debug \(调试与排障\)/, 'the scene vocabulary is listed');
  assert.match(prompt, /Prefer "unknown" over guessing/);
});

test('judge answers: only known ids, known outcomes, and vocabulary scenes are kept', () => {
  const answer = 'Here you go:\n```json\n' + JSON.stringify({
    judgments: [
      { id: 'i1', outcome: 'rework', scenes: ['task/debug', 'v1:artifact/resume', 'made/up', 'user:context/x', 'task/debug'], reason: 'fixed after a correction' },
      { id: 'i2', outcome: 'great', scenes: [] },
      { id: 'i9', outcome: 'smooth', scenes: [] },
      { id: 'i3', outcome: 'unknown' },
    ],
  }) + '\n```';
  const verdicts = parseJudgeOutput(answer, ['i1', 'i2', 'i3']);
  assert.deepEqual([...verdicts.keys()], ['i1', 'i3']);
  assert.deepEqual(verdicts.get('i1'), { outcome: 'rework', scenes: ['v1:task/debug', 'v1:artifact/resume'], reason: 'fixed after a correction' });
  assert.deepEqual(verdicts.get('i3'), { outcome: 'unknown', scenes: [], reason: '' });
  assert.throws(() => parseJudgeOutput('I cannot help with that', ['i1']), /did not answer with JSON/);
});

test('judge runs keep no session, have no tools or Skills, and read the prompt from stdin', () => {
  const files = { lastMessage: '/tmp/last', schema: '/tmp/schema.json' };
  const codex = harnessCommand({ harness: 'codex', prompt: '', cwd: '/data/judge', model: 'gpt-5' }, files);
  assert.equal(codex.command, 'codex');
  for (const flag of ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) assert.ok(codex.args.includes(flag), flag);
  assert.equal(codex.args[codex.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(codex.args[codex.args.indexOf('-C') + 1], '/data/judge');
  for (const off of ['features.shell_tool=false', 'features.memories=false', 'web_search="disabled"']) assert.ok(codex.args.includes(off), off);
  assert.equal(codex.args[codex.args.indexOf('--output-schema') + 1], '/tmp/schema.json');
  assert.equal(codex.args[codex.args.indexOf('-o') + 1], '/tmp/last');
  assert.equal(codex.args[codex.args.indexOf('-m') + 1], 'gpt-5');
  assert.equal(codex.args.at(-1), '-');

  const schema = judgeOutputSchema();
  const item = schema.properties.judgments.items;
  assert.deepEqual(item.required, ['id', 'outcome', 'scenes', 'reason'], 'strict mode: every property is required');
  assert.deepEqual(item.properties.outcome.enum, ['smooth', 'rework', 'failed', 'unknown']);
  assert.ok(item.properties.scenes.items.enum.includes('task/debug'));

  const claude = harnessCommand({ harness: 'claude', prompt: '', cwd: '/data/judge' }, files);
  assert.equal(claude.command, 'claude');
  for (const flag of ['-p', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config']) assert.ok(claude.args.includes(flag), flag);
  assert.equal(claude.args[claude.args.indexOf('--tools') + 1], '');
  assert.equal(claude.args[claude.args.indexOf('--max-turns') + 1], '1');
});
