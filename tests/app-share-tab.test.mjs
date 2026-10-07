// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The App's Share tab and share dialog (#12): the prompts they copy and how
// they present `obelisk share list` records and message ranges.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as sharePrompts from '../app/src/renderer/src/share-prompts.mjs';
import { renderPrompt } from '../app/src/renderer/src/assistant-prompts.mjs';
import {
  canRevoke, describeRange, fmtShareTime, serviceProblem, shareRecord, shareRules, shareStatus, shortAddress,
} from '../app/src/renderer/src/share-view.mjs';
import { isShareNumber, sentSharesByNumber, shareNumber } from '../packages/core/src/share-status.ts';

// The prompts as copied for Claude Code (the default); the Codex form is
// covered in app-assistant-prompts.test.mjs.
const sharePrompt = (...args) => renderPrompt(sharePrompts.sharePrompt(...args), 'claude-code');
const revokePrompt = (...args) => renderPrompt(sharePrompts.revokePrompt(...args), 'claude-code');

const B = '0x7a3F00000000000000000000000000000000C21e';
const SHARE_ID = `0x3f2a${'0'.repeat(60)}`;
const NOW = new Date(2026, 9, 7, 22, 0);
const local = (month, day, hour, minute) => new Date(2026, month - 1, day, hour, minute).toISOString();

function share(overrides = {}) {
  return {
    draft: 'a1b2c3d4',
    shareId: SHARE_ID,
    number: 'S-3F2A',
    title: '修复支付回调重复扣款',
    session: { id: 'sess-1', provider: 'claude' },
    messages: { from: 12, to: 17 },
    recipient: B,
    rules: { opens: 1, expiresAt: local(10, 8, 21, 3) },
    state: 'unread',
    canOpen: true,
    opens: { count: 0, max: 1, lastOpenedAt: null },
    expiresAt: local(10, 8, 21, 3),
    revokedAt: null,
    record: { kind: 'create', txHash: '0x01', explorerUrl: 'https://scan.example/tx/0x01' },
    sentAt: local(10, 7, 21, 3),
    link: `https://service.example/s/${SHARE_ID}`,
    ...overrides,
  };
}

test('分享 prompt 以 /obelisk-share 开头，写全接收者地址、范围和规则', () => {
  const session = { id: 'sess-1', title: ' 修复支付回调重复扣款 ' };
  assert.equal(
    sharePrompt({ session, from: 12, to: 17, recipient: ` ${B} `, opens: 1, expires: '24h' }),
    `/obelisk-share 把 session「修复支付回调重复扣款」（sess-1）第 12–17 条分享给 ${B}，限 1 次，24 小时内有效`,
  );
  assert.equal(
    sharePrompt({ session: { id: 'sess-2', title: '' }, from: 3, to: 3, recipient: B, opens: 'unlimited', expires: '7d' }),
    `/obelisk-share 把 session sess-2 第 3 条分享给 ${B}，不限次数，7 天内有效`,
  );
  assert.match(sharePrompt({ session, from: 1, to: 2, recipient: B, opens: 3, expires: '1h' }), /，限 3 次，1 小时内有效$/);
  assert.throws(() => sharePrompt({ session, from: 1, to: 2, recipient: '0x7a3f…c21e', opens: 1, expires: '24h' }), /wallet address/);
  assert.throws(() => sharePrompt({ session, from: 5, to: 2, recipient: B, opens: 1, expires: '24h' }), /Not a message range/);
  assert.ok(renderPrompt(sharePrompts.SHARE_EXAMPLE_PROMPT).startsWith('/obelisk-share '));
});

test('撤回 prompt 用分享编号指明是哪一条', () => {
  assert.equal(revokePrompt(share()), `/obelisk-share 撤回我发给 ${B} 的分享 #S-3F2A「修复支付回调重复扣款」`);
  assert.equal(revokePrompt(share({ title: null })), `/obelisk-share 撤回我发给 ${B} 的分享 #S-3F2A`);
});

test('分享编号：与阅读页水印相同，CLI 按前缀找回', () => {
  assert.equal(shareNumber(SHARE_ID), 'S-3F2A');
  for (const ref of ['S-3F2A', '#S-3f2a', ' s-3F2A ']) assert.ok(isShareNumber(ref), ref);
  for (const ref of ['S-3F2', '#S-3F2AB', '3F2A', 'S-XYZW']) assert.ok(!isShareNumber(ref), ref);
  const records = [{ shareId: SHARE_ID }, { shareId: `0x3f2b${'1'.repeat(60)}` }, { shareId: `0x3F2A${'2'.repeat(60)}` }];
  assert.equal(sentSharesByNumber(records, '#S-3F2A').length, 2, 'two shares can share a number; the CLI refuses then');
  assert.equal(sentSharesByNumber(records, 'S-3F2B').length, 1);
  assert.deepEqual(sentSharesByNumber(records, 'not a number'), []);
});

test('状态：未读 / 已读及时间 / 已过期 / 已撤回 / 未知，各附链上记录', () => {
  assert.deepEqual(
    [shareStatus(share(), NOW).label, shareStatus(share(), NOW).tone],
    ['未读', 'dim'],
  );
  assert.match(shareStatus(share(), NOW).detail, /10-08 21:03 前有效/);
  const read = share({ state: 'read', canOpen: false, opens: { count: 1, max: 1, lastOpenedAt: local(10, 7, 21, 3) }, record: { kind: 'open', txHash: '0x02', explorerUrl: 'https://scan.example/tx/0x02' } });
  assert.deepEqual([shareStatus(read, NOW).label, shareStatus(read, NOW).tone], ['已读 · 10-07 21:03', 'ok']);
  assert.equal(shareStatus({ ...read, opens: { count: 3, max: null, lastOpenedAt: local(10, 7, 21, 3) } }, NOW).label, '已读 3 次 · 10-07 21:03');
  assert.deepEqual(shareRecord(read), { label: '打开回执', url: 'https://scan.example/tx/0x02' });
  assert.equal(canRevoke(read), false, 'used up: nothing left to revoke');
  assert.equal(canRevoke({ ...read, canOpen: true }), true, 'read but still openable');

  const expired = share({ state: 'expired', canOpen: false });
  assert.deepEqual([shareStatus(expired, NOW).label, shareStatus(expired, NOW).tone], ['已过期', 'warn']);
  assert.deepEqual(shareRecord(expired), { label: '分享授权', url: 'https://scan.example/tx/0x01' });

  const revoked = share({ state: 'revoked', canOpen: false, revokedAt: local(10, 7, 21, 30), record: { kind: 'revoke', txHash: '0x03', explorerUrl: 'https://scan.example/tx/0x03' } });
  assert.deepEqual([shareStatus(revoked, NOW).label, shareStatus(revoked, NOW).tone], ['已撤回', 'danger']);
  assert.deepEqual(shareRecord(revoked), { label: '撤回记录', url: 'https://scan.example/tx/0x03' });
  assert.equal(canRevoke(revoked), false);

  // Offline: no chain state, only the local record.
  const unknown = share({ state: 'unknown', error: 'Could not reach the Obelisk online service', canOpen: undefined, opens: undefined, expiresAt: undefined, record: undefined });
  assert.deepEqual([shareStatus(unknown, NOW).label, shareStatus(unknown, NOW).detail], ['状态未知', 'Could not reach the Obelisk online service']);
  assert.equal(shareRules(unknown, NOW), '1 次 · 至 10-08 21:03', 'rules fall back to the local record');
  assert.equal(shareRecord(unknown), null);
  assert.equal(canRevoke(unknown), false);
  assert.equal(serviceProblem([unknown, unknown]), 'Could not reach the Obelisk online service');
  assert.equal(serviceProblem([unknown, share()]), null, 'one row is unknown: say so on that row only');
  assert.equal(serviceProblem([]), null);
});

test('规则、时间和地址的写法', () => {
  assert.equal(shareRules(share(), NOW), '1 次 · 至 10-08 21:03');
  assert.equal(shareRules(share({ opens: { count: 0, max: null, lastOpenedAt: null } }), NOW), '不限 · 至 10-08 21:03');
  assert.equal(shareRules(share({ opens: undefined, rules: { opens: 'unlimited', expiresAt: local(10, 8, 21, 3) } }), NOW), '不限 · 至 10-08 21:03');
  assert.equal(fmtShareTime(new Date(2025, 11, 31, 9, 5).toISOString(), NOW), '2025-12-31 09:05');
  assert.equal(fmtShareTime(null, NOW), '');
  assert.equal(shortAddress(B), '0x7a3F…C21e');
});

test('分享范围：条数、工具调用数，以及首尾两条的摘要', () => {
  const messages = [
    { type: 'user', text: '支付回调为什么会重复扣款？' },
    { type: 'assistant', text: '先看一下回调处理器。', tool_calls: [{ name: 'Read' }, { name: 'Grep' }] },
    { type: 'assistant', text: '', tool_calls: [{ name: 'Edit' }] },
    { type: 'user', text: `${'很长的一段话'.repeat(20)}` },
  ];
  const all = describeRange(messages, 1, 4);
  assert.deepEqual([all.valid, all.count, all.toolCalls], [true, 4, 3]);
  assert.deepEqual(all.first, { n: 1, role: '你', excerpt: '支付回调为什么会重复扣款？' });
  assert.equal(all.last.n, 4);
  assert.ok(all.last.excerpt.endsWith('…') && all.last.excerpt.length === 73);
  const one = describeRange(messages, 3, 3);
  assert.deepEqual([one.count, one.first.role, one.first.excerpt, one.last], [1, 'AI', '（工具调用：Edit）', null]);
  for (const [from, to] of [[0, 2], [3, 2], [1, 5], [1.5, 2]]) assert.equal(describeRange(messages, from, to).valid, false, `${from}–${to}`);
});
