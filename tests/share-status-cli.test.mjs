// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk share list | status | revoke` (#11) through the built CLI. Shares
// are sent with `obelisk share send` first; the keychain and online service
// are the fakes in chain-cli-fakes.mjs, and service/test covers the real
// service's revoke.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { deriveEncryptionKey } from '../packages/core/src/wallet.ts';
import { cliEnv, installFakeKeychain, runCliAsync, startFakeService, supported } from './chain-cli-fakes.mjs';
import { makeTempDir } from './temp-dirs.mjs';

const skip = !supported && 'system keychain not supported here';
const sessionId = '195ff3f4-85c3-44e8-9a45-05a27f305e1c';

async function activated(service) {
  const account = privateKeyToAccount(generatePrivateKey());
  service.registerKey(account.address, (await deriveEncryptionKey(account)).registeredKey);
  return account;
}

async function setup(t) {
  const root = makeTempDir('obelisk-share-status-cli-');
  const projects = join(root, '.claude', 'projects', '-private-tmp-obelisk-share-capture');
  mkdirSync(projects, { recursive: true });
  copyFileSync(new URL('./fixtures/claude/share-secrets-session.jsonl', import.meta.url), join(projects, `${sessionId}.jsonl`));
  const keychain = installFakeKeychain(root);
  const service = await startFakeService();
  t.after(() => service.close());
  const homeEnv = (name, serviceUrl = service.url) => cliEnv(root, keychain, join(root, name), serviceUrl);
  const as = (name, serviceUrl) => (...args) => runCliAsync(args, homeEnv(name, serviceUrl));
  const run = as('alice');
  const created = await run('wallet', 'create');
  assert.equal(created.status, 0, created.stdout);

  /** Send messages 1–2 to `to` and return the draft and share ids. */
  const share = async (to, ...rules) => {
    const draft = (await run('share', 'draft', sessionId, '--to', to.address, '--messages', '1-2', ...rules)).json.draft;
    await run('share', 'send', draft, '--redact', 'all');
    const sent = await run('share', 'send', draft, '--confirm');
    assert.equal(sent.json.status, 'shared', sent.stdout);
    return { draft, shareId: sent.json.shareId };
  };
  return { service, run, as, share, sender: created.json.address };
}

test('分享状态：未读 / 已读及时间 / 已过期，附链上记录', { skip }, async (t) => {
  const { service, run, share } = await setup(t);
  const empty = await run('share', 'list');
  assert.equal(empty.status, 0, empty.stdout);
  assert.deepEqual(empty.json.shares, []);
  assert.match(empty.json.next, /No shares have been sent/);

  const b = await activated(service);
  const c = await activated(service);
  const read = await share(b, '--opens', '1');
  const expired = await share(b, '--opens', '3', '--expires', '1h');
  const unread = await share(c);

  service.recordOpen(read.shareId, '2026-10-07T13:03:00.000Z');
  service.expire(expired.shareId);

  const listed = await run('share', 'list');
  assert.equal(listed.status, 0, listed.stdout);
  assert.equal(listed.json.network, 'BOT Chain testnet (968)');
  const byId = new Map(listed.json.shares.map((s) => [s.shareId, s]));
  assert.equal(byId.size, 3);

  const r = byId.get(read.shareId);
  assert.equal(r.draft, read.draft);
  assert.equal(r.recipient, b.address);
  assert.deepEqual(r.messages, { from: 1, to: 2 });
  assert.equal(r.session.id, sessionId);
  assert.equal(r.state, 'read');
  assert.equal(r.canOpen, false);
  assert.deepEqual(r.opens, { count: 1, max: 1, lastOpenedAt: '2026-10-07T13:03:00.000Z' });
  assert.equal(r.record.kind, 'open');
  assert.match(r.record.explorerUrl, /^https:\/\/scan\.bohr\.life\/tx\/0x8888/);
  assert.equal(r.link, `${service.url}/s/${read.shareId}`);

  const e = byId.get(expired.shareId);
  assert.deepEqual([e.state, e.canOpen, e.opens.count, e.record.kind], ['expired', false, 0, 'create']);
  const u = byId.get(unread.shareId);
  assert.deepEqual([u.state, u.canOpen, u.opens.max, u.record.kind], ['unread', true, 1, 'create']);

  const toC = await run('share', 'list', '--to', c.address.toLowerCase());
  assert.deepEqual(toC.json.shares.map((s) => s.shareId), [unread.shareId]);

  const status = await run('share', 'status', read.draft);
  assert.equal(status.status, 0, status.stdout);
  assert.equal(status.json.state, 'read');
  assert.deepEqual(status.json.receipts, [{ open: 1, openedAt: '2026-10-07T13:03:00.000Z', explorerUrl: r.record.explorerUrl }]);
  assert.equal((await run('share', 'status', read.shareId)).json.draft, read.draft, 'a share id finds the same record');
});

test('撤回：先预览、确认后上链；已撤回的不再重复；别人的钱包不能撤回', { skip }, async (t) => {
  const { service, run, as, share, sender } = await setup(t);
  const b = await activated(service);
  const first = await share(b);

  const preview = await run('share', 'revoke', first.draft);
  assert.equal(preview.status, 0, preview.stdout);
  assert.equal(preview.json.preview, true);
  assert.match(preview.json.action, /nobody can open it, including the recipient\. This cannot be undone\./);
  assert.equal(preview.json.share.state, 'unread');
  assert.equal(preview.json.from, sender);
  assert.match(preview.json.next, /Only after they confirm, run `obelisk share revoke [0-9a-f]{8} --confirm`/);
  assert.equal((await run('share', 'status', first.draft)).json.state, 'unread', 'a preview revokes nothing');

  const revoked = await run('share', 'revoke', first.draft, '--confirm');
  assert.equal(revoked.status, 0, revoked.stdout);
  assert.equal(revoked.json.status, 'revoked');
  assert.equal(revoked.json.state, 'revoked');
  assert.equal(revoked.json.canOpen, false);
  assert.equal(revoked.json.record.kind, 'revoke');
  assert.equal(revoked.json.record.explorerUrl, revoked.json.explorer);
  assert.equal((await run('share', 'revoke', first.draft)).json.status, 'already_revoked');
  assert.equal((await run('share', 'revoke', first.draft, '--confirm')).json.status, 'already_revoked');
  assert.equal((await run('share', 'list')).json.shares[0].state, 'revoked');

  // Not confirmed yet: running it again waits for that revoke instead of sending another.
  const second = await share(b);
  service.respond.revoke = 'pending';
  const pending = await run('share', 'revoke', second.shareId, '--confirm');
  assert.equal(pending.json.status, 'submitted', pending.stdout);
  assert.match(pending.json.next, /obelisk share status 0x[0-9a-f]{64}/);
  const again = await run('share', 'revoke', second.shareId, '--confirm');
  assert.equal(again.json.status, 'submitted', again.stdout);
  assert.equal(again.json.transaction, pending.json.transaction);
  service.confirmRevoke(second.shareId);
  assert.equal((await run('share', 'status', second.draft)).json.state, 'revoked');

  const third = await share(b);
  const bob = as('bob');
  assert.equal((await bob('wallet', 'create')).status, 0);
  const notMine = await bob('share', 'revoke', third.shareId, '--confirm');
  assert.equal(notMine.status, 1);
  assert.match(notMine.json.error, new RegExp(`^Share ${third.shareId} was sent from ${sender}; this wallet \\(0x[0-9a-fA-F]{40}\\) cannot revoke it$`));
  assert.equal((await run('share', 'status', third.draft)).json.state, 'unread');
});

test('list and status explain an unreachable service and unknown shares', { skip }, async (t) => {
  const { service, run, as, share } = await setup(t);
  const b = await activated(service);
  const sent = await share(b);

  const offline = await as('alice', 'http://127.0.0.1:9')('share', 'list');
  assert.equal(offline.status, 0, offline.stdout);
  assert.equal(offline.json.shares[0].state, 'unknown');
  assert.match(offline.json.shares[0].error, /^Could not reach the Obelisk online service at http:\/\/127\.0\.0\.1:9/);
  assert.equal(offline.json.shares[0].shareId, sent.shareId, 'the local record is still listed');

  const unsent = (await run('share', 'draft', sessionId, '--to', b.address)).json.draft;
  const cases = [
    [['share', 'status', unsent], /^Share draft [0-9a-f]{8} has not been sent, so there is no share to look up/],
    [['share', 'status', `0x${'ab'.repeat(32)}`], /^BOT Chain testnet \(968\) has no share 0x(ab){32}$/],
    [['share', 'revoke', 'deadbeef'], /No share draft deadbeef/],
    [['share', 'list', '--to', '0x1234'], /--to must be a wallet address/],
    [['share', 'status'], /Usage:/],
  ];
  for (const [args, pattern] of cases) {
    const result = await run(...args);
    assert.equal(result.status, 1, `${args.join(' ')} should fail`);
    assert.match(result.json.error, pattern);
  }
});
