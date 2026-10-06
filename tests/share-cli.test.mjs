// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk share` end to end through the built CLI, over a real Claude Code
// session whose Read output holds planted, worthless secrets
// (tests/fixtures/claude/README.md). Keychain and online service are the
// fakes in chain-cli-fakes.mjs; service/test covers the real service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { decryptShareContent, openContentKey } from '../packages/core/src/share-crypto.ts';
import { deriveEncryptionKey } from '../packages/core/src/wallet.ts';
import { cliEnv, installFakeKeychain, runCliAsync, startFakeService, supported, testnet } from './chain-cli-fakes.mjs';
import { makeTempDir } from './temp-dirs.mjs';

const skip = !supported && 'system keychain not supported here';
const sessionId = '195ff3f4-85c3-44e8-9a45-05a27f305e1c';
const planted = [
  '/Users/zhouli',
  'Wq8rT2staging',
  'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  'zhou.li@acme-pay.cn',
  '13812345678',
];

async function setup(t) {
  const root = makeTempDir('obelisk-share-cli-');
  const projects = join(root, '.claude', 'projects', '-private-tmp-obelisk-share-capture');
  mkdirSync(projects, { recursive: true });
  copyFileSync(new URL('./fixtures/claude/share-secrets-session.jsonl', import.meta.url), join(projects, `${sessionId}.jsonl`));
  const keychain = installFakeKeychain(root);
  const service = await startFakeService();
  t.after(() => service.close());
  const env = cliEnv(root, keychain, join(root, 'alice'), service.url);
  const outputs = [];
  const run = async (...args) => {
    const result = await runCliAsync(args, env);
    outputs.push(result.stdout + result.stderr);
    return result;
  };
  const created = await run('wallet', 'create');
  assert.equal(created.status, 0, created.stdout);
  const recipient = privateKeyToAccount(generatePrivateKey());
  const keys = await deriveEncryptionKey(recipient);
  return { root, service, run, outputs, sender: created.json.address, recipient, keys };
}

function assertNoPlantedValues(outputs) {
  for (const output of outputs) {
    for (const value of planted) assert.ok(!output.includes(value), `CLI output must not show ${value}`);
  }
}

test('分享 session 给 0x…：隐私体检只给类型和位置，预览后确认，加密上传并写入分享授权', { skip }, async (t) => {
  const { root, service, run, outputs, sender, recipient, keys } = await setup(t);
  service.registerKey(recipient.address, keys.registeredKey);

  const outline = await run('share', 'outline', sessionId);
  assert.equal(outline.status, 0, outline.stdout);
  const total = outline.json.messages.length;
  assert.ok(total >= 3);
  assert.deepEqual(outline.json.messages.map((m) => m.n), Array.from({ length: total }, (_, i) => i + 1));

  const drafted = await run('share', 'draft', sessionId.slice(0, 8), '--to', recipient.address.toLowerCase(), '--messages', `1-${total}`, '--opens', '1', '--expires', '24h');
  assert.equal(drafted.status, 0, drafted.stdout);
  const draft = drafted.json.draft;
  assert.match(draft, /^[0-9a-f]{8}$/);
  assert.equal(drafted.json.from, sender);
  assert.deepEqual(drafted.json.recipient, { address: recipient.address, activated: true, network: 'BOT Chain testnet (968)' });
  assert.deepEqual(drafted.json.rules, { opens: 1, expires: '24 hours after sending' });
  assert.deepEqual(drafted.json.messages, { from: 1, to: total, count: total, toolCalls: 1, sessionHas: total });
  assert.equal(drafted.json.privacyCheck.found, 5);
  assert.deepEqual(drafted.json.privacyCheck.findings.map((f) => f.label), [
    'Local path with username', 'Connection string with credentials', 'Private key', 'Email address', 'Phone number',
  ]);
  for (const finding of drafted.json.privacyCheck.findings) assert.match(finding.where, /^message \d+ \(tool output\)$/);
  assert.match(drafted.json.next, /--redact all/);

  const undecided = await run('share', 'send', draft);
  assert.equal(undecided.json.preview, false);
  assert.equal(undecided.json.needs, 'a redaction choice');
  const early = await run('share', 'send', draft, '--confirm');
  assert.equal(early.status, 1);
  assert.match(early.json.error, /Preview the share first/);

  const preview = await run('share', 'send', draft, '--redact', 'all');
  assert.equal(preview.status, 0, preview.stdout);
  assert.equal(preview.json.preview, true);
  assert.equal(preview.json.redaction.summary, '5 of 5 findings will be redacted.');
  assert.equal(preview.json.contract, testnet.contracts.ShareRegistry);
  assert.match(preview.json.next, /Only after they confirm, run `obelisk share send [0-9a-f]{8} --confirm`/);
  assert.equal(service.uploads.length, 0, 'a preview uploads nothing');

  const changed = await run('share', 'send', draft, '--redact', '1', '--confirm');
  assert.equal(changed.status, 1);
  assert.match(changed.json.error, /differs from the last preview/);

  const sent = await run('share', 'send', draft, '--confirm');
  assert.equal(sent.status, 0, sent.stdout);
  assert.equal(sent.json.status, 'shared');
  assert.equal(sent.json.link, `${service.url}/s/${sent.json.shareId}`);
  assert.equal(sent.json.recipient, recipient.address);
  assert.equal(sent.json.rules.opens, 1);
  assert.equal(sent.json.redacted, 5);
  assert.match(sent.json.explorer, /^https:\/\/scan\.bohr\.life\/tx\/0x/);
  assert.equal(service.uploads.length, 1);

  // What left the machine: only the recipient's key opens it, and it is redacted.
  const [upload] = service.uploads;
  assert.equal(upload.message.sender, sender);
  assert.equal(upload.message.maxOpens, 1);
  const ciphertext = Buffer.from(upload.ciphertext, 'base64');
  for (const value of planted) assert.ok(!ciphertext.includes(value));
  const contentKey = openContentKey(upload.keyPackage, keys.privateKey, sent.json.shareId);
  const snapshot = JSON.parse(new TextDecoder().decode(decryptShareContent(ciphertext, contentKey, sent.json.shareId)));
  assert.equal(snapshot.format, 'obelisk.share.snapshot/v1');
  assert.equal(snapshot.source.sessionId, sessionId);
  assert.deepEqual(snapshot.range, { from: 1, to: total, total });
  assert.equal(snapshot.redactions.length, 5);
  const text = JSON.stringify(snapshot);
  for (const value of planted) assert.ok(!text.includes(value), `${value} must be redacted in the shared snapshot`);
  assert.ok(text.includes('db.staging.internal'));

  const again = await run('share', 'send', draft, '--confirm');
  assert.equal(again.json.status, 'already_shared');
  assert.equal(service.uploads.length, 1, 'confirming twice does not share twice');

  const dir = join(root, 'alice', 'shares', draft);
  assert.equal(JSON.parse(readFileSync(join(dir, 'sent.json'), 'utf8')).shareId, sent.json.shareId);
  assert.equal(existsSync(join(dir, 'outbox.json')), false);
  for (const file of ['draft.json', 'sent.json', 'snapshot.json']) {
    const content = readFileSync(join(dir, file), 'utf8');
    for (const value of planted) assert.ok(!content.includes(value), `${file} keeps no unredacted value once sent`);
  }
  assertNoPlantedValues(outputs);
});

test('逐条决定: only the chosen findings are redacted', { skip }, async (t) => {
  const { service, run, recipient, keys } = await setup(t);
  service.registerKey(recipient.address, keys.registeredKey);
  const draft = (await run('share', 'draft', sessionId, '--to', recipient.address)).json.draft;
  const preview = await run('share', 'send', draft, '--redact', '2,3');
  assert.deepEqual(preview.json.redaction.redacted.map((f) => f.id), [2, 3]);
  assert.deepEqual(preview.json.redaction.kept.map((f) => f.id), [1, 4, 5]);
  const sent = await run('share', 'send', draft, '--redact', '2,3', '--confirm');
  assert.equal(sent.json.status, 'shared', sent.stdout);
  const [upload] = service.uploads;
  const ciphertext = Buffer.from(upload.ciphertext, 'base64');
  const contentKey = openContentKey(upload.keyPackage, keys.privateKey, sent.json.shareId);
  const text = new TextDecoder().decode(decryptShareContent(ciphertext, contentKey, sent.json.shareId));
  assert.ok(!text.includes(planted[1]) && !text.includes(planted[2]));
  assert.ok(text.includes(planted[3]), 'a finding the user kept is shared as is');
});

test('a recipient who has not activated is shown in the preview and cannot be sent to', { skip }, async (t) => {
  const { service, run, recipient } = await setup(t);
  const drafted = await run('share', 'draft', sessionId, '--to', recipient.address);
  assert.equal(drafted.json.recipient.activated, false);
  assert.match(drafted.json.next, /has not activated an Obelisk wallet yet/);
  const preview = await run('share', 'send', drafted.json.draft, '--redact', 'all');
  assert.equal(preview.json.recipient.activated, false);
  assert.match(preview.json.next, /obelisk wallet activate/);
  const refused = await run('share', 'send', drafted.json.draft, '--confirm');
  assert.equal(refused.status, 1);
  assert.match(refused.json.error, /^The share was not created: 0x[0-9a-fA-F]{40} has not activated/);
  assert.equal(service.uploads.length, 0);
});

test('a send interrupted before confirmation finishes the same share when run again', { skip }, async (t) => {
  const { root, service, run, recipient, keys } = await setup(t);
  service.registerKey(recipient.address, keys.registeredKey);
  const draft = (await run('share', 'draft', sessionId, '--to', recipient.address)).json.draft;
  await run('share', 'send', draft, '--redact', 'all');

  service.respond.share = 'pending';
  const pending = await run('share', 'send', draft, '--confirm');
  assert.equal(pending.json.status, 'submitted', pending.stdout);
  assert.match(pending.json.next, /will not create a second share/);
  assert.ok(existsSync(join(root, 'alice', 'shares', draft, 'outbox.json')));

  const finished = await run('share', 'send', draft, '--confirm');
  assert.equal(finished.json.status, 'shared', finished.stdout);
  assert.equal(finished.json.shareId, pending.json.shareId);
  assert.equal(service.uploads.length, 1);

  // A refusal before any transaction leaves the draft ready to retry.
  const second = (await run('share', 'draft', sessionId, '--to', recipient.address)).json.draft;
  await run('share', 'send', second, '--redact', 'none');
  service.respond.share = { status: 503, body: { error: { code: 'relay_out_of_funds', message: 'The relay wallet 0x… has 0 BOT; top it up' } } };
  const refused = await run('share', 'send', second, '--confirm');
  assert.equal(refused.status, 1);
  assert.match(refused.json.error, /^The share was not created: The relay wallet .* top it up/);
  const retried = await run('share', 'send', second, '--confirm');
  assert.equal(retried.json.status, 'shared', retried.stdout);
});

test('share commands explain bad input', { skip }, async (t) => {
  const { run } = await setup(t);
  const cases = [
    [['share', 'draft', sessionId], /--to <0x address> is required/],
    [['share', 'draft', sessionId, '--to', '0x1234'], /--to must be a wallet address/],
    [['share', 'draft', sessionId, '--to', testnet.contracts.KeyRegistry, '--messages', '2-999'], /Message range 2–999 is outside this session, which has messages 1–\d+/],
    [['share', 'draft', sessionId, '--to', testnet.contracts.KeyRegistry, '--expires', 'tomorrow'], /--expires must be a duration such as 30m, 24h, or 7d/],
    [['share', 'draft', sessionId, '--to', testnet.contracts.KeyRegistry, '--opens', '0'], /--opens must be a positive whole number or unlimited/],
    [['share', 'draft', 'no-such-session', '--to', testnet.contracts.KeyRegistry], /No indexed session has id no-such-session/],
    [['share', 'send', 'deadbeef'], /No share draft deadbeef/],
    [['share', 'send', '../x'], /Not a share draft id/],
    [['share', 'frobnicate'], /Usage:\n {2}obelisk share outline/],
  ];
  for (const [args, pattern] of cases) {
    const result = await run(...args);
    assert.equal(result.status, 1, `${args.join(' ')} should fail`);
    assert.match(result.json.error, pattern);
  }
});
