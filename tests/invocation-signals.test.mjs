// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Fact signals of a Skill invocation, counted by rule (#25).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { invocationSignals, isCorrection } from '../packages/core/src/invocation-signals.ts';

const event = (role, text, extra = {}) => ({
  uuid: `${role}-${text.length}-${Math.random()}`, role, timestamp: null, human: role === 'user', text, toolCalls: [], toolResults: [], ...extra,
});
const edit = (file) => event('assistant', '', { toolCalls: [{ name: 'Edit', filePath: file }] });
const slice = (events, request = 'fix the login bug') => ({ request, events, endedByNextLoad: false, sessionLastAt: '2026-10-01T00:00:00Z' });

test('corrections are recognized by how the person\'s message opens, in Chinese and English', () => {
  for (const text of ['不对，应该改另一个文件', '错了', '还是不行', 'No, use the other API', 'wrong file', "that's not what I asked", 'stop', '[Request interrupted by user]']) {
    assert.equal(isCorrection(text), true, text);
  }
  for (const text of ['好的，继续', 'no problem, thanks', 'Now add tests', '不错，继续下一步', 'nothing else']) {
    assert.equal(isCorrection(text), false, text);
  }
});

test('fact signals: tool errors, corrections, a file edited three times, and the same Skill loaded again', () => {
  const rough = slice([
    edit('/p/a.ts'),
    event('user', '', { human: false, toolResults: [{ isError: true, text: 'old_string not found' }] }),
    event('user', '不对，应该改 b.ts'),
    edit('/p/a.ts'),
    edit('/p/a.ts'),
    event('user', '[Request interrupted by user]', { human: false }),
  ]);
  assert.deepEqual(invocationSignals(rough, true), ['tool-error', 'user-correction', 'repeated-edit', 'repeated-invocation']);

  const smooth = slice([edit('/p/a.ts'), edit('/p/b.ts'), event('user', 'Great, now commit it'), event('assistant', 'Committed.')]);
  assert.deepEqual(invocationSignals(smooth, false), []);
  const quotedByTool = slice([event('user', 'wrong', { human: false, toolResults: [{ isError: false, text: 'wrong' }] })]);
  assert.deepEqual(invocationSignals(quotedByTool, false), [], 'a tool result that reads like a correction is not one');
});
