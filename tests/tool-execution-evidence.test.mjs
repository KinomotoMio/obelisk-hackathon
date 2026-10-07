// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commandEvidence } from '../packages/core/src/tool-execution-evidence.ts';
import { renderSlice } from '../packages/core/src/usage-judge.ts';
import { invocationSignals } from '../packages/core/src/invocation-signals.ts';

const captured = JSON.parse(readFileSync(new URL('./fixtures/codex/exec-command-evidence.json', import.meta.url), 'utf8'));
const contents = captured.map(r => JSON.stringify(r.payload.output));

test('real Codex failure and successful retry both reach the judge without changing outer status', () => {
  const events = contents.map((text, i) => ({
    uuid: String(i), role: 'assistant', human: false, timestamp: null, text: '',
    toolCalls: [{ name: 'exec', filePath: null }],
    toolResults: [{ isError: false, text, commands: commandEvidence('codex', 'exec', text) }],
  }));
  assert.deepEqual(events.map(e => e.toolResults[0].commands.map(c => c.exitCode)), [[0, 0], [2], [0]]);
  const slice = {request: 'Verify the ledger', events, endedByNextLoad: false, sessionLastAt: null};
  assert.deepEqual(invocationSignals(slice, false), ['tool-error']);
  const rendered = renderSlice(slice);
  assert.equal(rendered.match(/→ exec/g).length, 3);
  assert.match(rendered, /command exit 2: error: Failed to initialize cache/);
  assert.match(rendered, /command exit 0: .*Verified output-2.json: count=4, sum=24/);
  assert.doesNotMatch(rendered, /tool error:/, 'outer execution succeeded');
});

test('arbitrary exit_code text, nested stdout and other tools are not command status', () => {
  for (const text of ['exit_code=2', '{"exit_code":2}', JSON.stringify([{type:'input_text',text:'{"exit_code":2}'}])]) {
    assert.deepEqual(commandEvidence('codex', 'exec', text), []);
  }
  assert.deepEqual(commandEvidence('claude', 'exec', contents[1]), []);
  assert.deepEqual(commandEvidence('codex', 'Read', contents[1]), []);
  const blocks = structuredClone(captured[2].payload.output);
  const command = JSON.parse(blocks[1].text);
  command.output = contents[1]; // Deliberate adversarial mutation of a captured success.
  blocks[1].text = JSON.stringify(command);
  assert.deepEqual(commandEvidence('codex', 'exec', JSON.stringify(blocks)).map(c => c.exitCode), [0]);
});
