// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Share snapshots over a real Claude Code session whose Read tool output holds
// planted, worthless secrets (tests/fixtures/claude/README.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { persist } from '../packages/core/src/persist.ts';
import { parse as parseClaude } from '../packages/core/src/providers/claude.ts';
import { assembleSessionDetail } from '../packages/core/src/session-detail.ts';
import { querySessionDetail } from '../packages/core/src/session-detail-query.ts';
import {
  buildShareSnapshot,
  outlineMessages,
  redactShareSnapshot,
  scanShareSnapshot,
} from '../packages/core/src/share-snapshot.ts';
import { makeTempDir } from './temp-dirs.mjs';

const SCHEMA = readFileSync(new URL('../packages/core/src/schema.sql', import.meta.url), 'utf8');
const fixture = new URL('./fixtures/claude/share-secrets-session.jsonl', import.meta.url);
const sessionId = '195ff3f4-85c3-44e8-9a45-05a27f305e1c';
const planted = [
  '/Users/zhouli',
  'pay_admin:Wq8rT2staging',
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  'zhou.li@acme-pay.cn',
  '13812345678',
];

function indexedFixture() {
  const dir = makeTempDir('obelisk-share-snapshot-');
  const path = join(dir, `${sessionId}.jsonl`);
  copyFileSync(fixture, path);
  const unit = { key: path, sessionId };
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  persist(db, unit, parseClaude(unit, null));
  return { db, direct: assembleSessionDetail([...parseClaude(unit, null)]) };
}

test('message numbers in a share are the session detail positions the App shows', () => {
  const { db, direct } = indexedFixture();
  const { session, messages } = querySessionDetail(db, sessionId.slice(0, 8));
  assert.equal(session.id, sessionId);
  assert.deepEqual(messages.map((m) => m.uuid), direct.messages.map((m) => m.uuid));
  const snapshot = buildShareSnapshot({ session, messages, from: 1, to: messages.length, capturedAt: new Date('2026-10-07T00:00:00Z') });
  assert.deepEqual(snapshot.messages.map((m) => m.n), messages.map((_, i) => i + 1));
  assert.deepEqual(snapshot.source, { provider: 'claude', sessionId, startedAt: session.started_at, endedAt: session.ended_at });
  assert.equal(snapshot.capturedAt, '2026-10-07T00:00:00.000Z');
  assert.throws(() => buildShareSnapshot({ session, messages, from: 2, to: messages.length + 1, capturedAt: new Date() }), /outside this session, which has messages 1–/);
  assert.throws(() => querySessionDetail(db, 'nope-nope'), /No indexed session has id nope-nope/);
});

test('隐私体检只报告检出项的类型和位置，不含原值', () => {
  const { db } = indexedFixture();
  const { session, messages } = querySessionDetail(db, sessionId);
  const snapshot = buildShareSnapshot({ session, messages, from: 1, to: messages.length, capturedAt: new Date() });
  const findings = scanShareSnapshot(snapshot);
  const readMessage = snapshot.messages.find((m) => m.toolCalls.some((call) => call.name === 'Read')).n;

  assert.deepEqual(findings.map((f) => f.type), ['local_path', 'connection_string', 'private_key', 'email', 'phone']);
  for (const finding of findings) {
    assert.deepEqual(finding.locations, [{ message: readMessage, part: 'tool_result' }]);
    assert.equal(finding.where, `message ${readMessage} (tool output)`);
  }
  const reported = JSON.stringify(findings);
  for (const value of planted) assert.ok(!reported.includes(value), `findings must not carry ${value}`);
});

test('全部打码 removes every planted value and the snapshot records where it redacted', () => {
  const { db } = indexedFixture();
  const { session, messages } = querySessionDetail(db, sessionId);
  const snapshot = buildShareSnapshot({ session, messages, from: 1, to: messages.length, capturedAt: new Date() });
  const findings = scanShareSnapshot(snapshot);

  const all = redactShareSnapshot(snapshot, new Set(findings.map((f) => f.id)));
  const text = JSON.stringify(all);
  for (const value of planted) assert.ok(!text.includes(value), `${value} must be redacted`);
  assert.ok(text.includes('db.staging.internal'), 'non-sensitive context stays readable');
  assert.deepEqual(all.redactions.map((r) => r.type), findings.map((f) => f.type));
  assert.ok(JSON.stringify(snapshot).includes(planted[0]), 'redaction returns a copy');

  // 逐条决定: redact the key and the connection string, keep the rest.
  const some = redactShareSnapshot(snapshot, new Set([2, 3]));
  const someText = JSON.stringify(some);
  assert.ok(!someText.includes(planted[1]) && !someText.includes(planted[2]));
  assert.ok(someText.includes(planted[3]));
  assert.deepEqual(some.redactions.map((r) => r.type), ['connection_string', 'private_key']);
  assert.throws(() => redactShareSnapshot(snapshot, new Set([9])), /No privacy finding numbered 9; this snapshot has 5/);
});

test('the outline numbers messages and masks sensitive values in excerpts', () => {
  const outline = outlineMessages([
    { uuid: 'a', type: 'user', timestamp: null, text: 'deploy with postgres://pay_admin:Wq8rT2staging@db:5432/p please', content_type: 'text', is_meta: 0, session_id: 's', cwd: null, turn_duration_ms: null },
    { uuid: 'b', type: 'assistant', timestamp: null, text: null, content_type: 'tool_use', is_meta: 0, session_id: 's', cwd: null, turn_duration_ms: null, tool_calls: [{ id: 't', name: 'Read', presentation: 'default', input_json: '{}', result: null }] },
  ]);
  assert.deepEqual(outline.map((entry) => [entry.n, entry.role, entry.tools]), [[1, 'user', []], [2, 'assistant', ['Read']]]);
  assert.equal(outline[0].excerpt, 'deploy with postgres://[redacted: credentials]@db:5432/p please');
});
