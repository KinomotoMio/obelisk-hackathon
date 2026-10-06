// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk wallet` end to end through the built CLI: the system keychain tool
// (`security` on macOS, `secret-tool` on Linux) is replaced on PATH by a fake
// that keeps entries in a JSON file and logs its argv, and the online service
// by an in-process server that verifies RegisterKey signatures the way the
// contract does. The real relay is covered in service/test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_SERVICE_URL, resolveServiceUrl } from '../packages/core/src/obelisk-service.ts';
import { cliEnv, installFakeKeychain, runCliAsync, startFakeService, supported, testnet } from './chain-cli-fakes.mjs';
import { makeTempDir } from './temp-dirs.mjs';

test('"create my Obelisk wallet": create, preview, confirm activation, without ever printing the key', { skip: !supported && 'system keychain not supported here' }, async () => {
  const root = makeTempDir('obelisk-wallet-cli-');
  const keychain = installFakeKeychain(root);
  const service = await startFakeService();
  try {
    const env = cliEnv(root, keychain, join(root, 'alice'), service.url);
    const outputs = [];
    const run = async (...args) => {
      const result = await runCliAsync(['wallet', ...args], env);
      outputs.push(result.stdout, result.stderr);
      return result;
    };

    const created = await run('create');
    assert.equal(created.status, 0, created.stdout + created.stderr);
    assert.equal(created.json.status, 'created');
    assert.match(created.json.next, /obelisk wallet activate/);
    const address = created.json.address;

    const preview = await run('activate');
    assert.equal(preview.status, 0, preview.stdout);
    assert.equal(preview.json.preview, true);
    assert.equal(preview.json.contract, testnet.contracts.KeyRegistry);
    assert.equal(preview.json.network, 'BOT Chain testnet (968)');
    assert.match(preview.json.next, /--confirm/);
    assert.equal(service.relays.length, 0, 'a preview submits nothing');

    const activated = await run('activate', '--confirm');
    assert.equal(activated.status, 0, activated.stdout);
    assert.equal(activated.json.status, 'activated');
    assert.equal(activated.json.encryptionPublicKey, preview.json.encryptionPublicKey);
    assert.match(activated.json.explorer, /^https:\/\/scan\.bohr\.life\/tx\/0x/);
    assert.equal(service.relays.length, 1);

    const shown = await run('show');
    assert.equal(shown.json.activation, 'active');
    assert.equal(shown.json.address, address);

    const again = await run('activate', '--confirm');
    assert.equal(again.json.status, 'already_active');
    assert.equal(service.relays.length, 1, 'activating twice does not submit twice');

    const secrets = Object.values(JSON.parse(readFileSync(keychain.store, 'utf8')));
    assert.equal(secrets.length, 1);
    const [privateKey] = secrets;
    assert.match(privateKey, /^0x[0-9a-f]{64}$/);
    for (const text of outputs) assert.ok(!text.includes(privateKey.slice(2)), 'the private key never appears in CLI output');
    assert.ok(!readFileSync(keychain.log, 'utf8').includes(privateKey.slice(2)), 'the private key never appears in a command line');
    assert.ok(!readFileSync(join(root, 'alice', 'wallet.json'), 'utf8').includes(privateKey.slice(2)));
  } finally {
    service.close();
  }
});

test('two data directories on one machine get separate keychain entries and wallets', { skip: !supported && 'system keychain not supported here' }, async () => {
  const root = makeTempDir('obelisk-wallet-cli-iso-');
  const keychain = installFakeKeychain(root);
  const alice = await runCliAsync(['wallet', 'create'], cliEnv(root, keychain, join(root, 'alice')));
  const bob = await runCliAsync(['wallet', 'create'], cliEnv(root, keychain, join(root, 'bob')));
  assert.equal(alice.status, 0, alice.stdout);
  assert.equal(bob.status, 0, bob.stdout);
  assert.notEqual(alice.json.address, bob.json.address);
  assert.deepEqual(
    Object.keys(JSON.parse(readFileSync(keychain.store, 'utf8'))).sort(),
    [`obelisk-wallet\n${join(root, 'alice')}`, `obelisk-wallet\n${join(root, 'bob')}`],
  );
  const aliceAgain = await runCliAsync(['wallet', 'create'], cliEnv(root, keychain, join(root, 'alice')));
  assert.equal(aliceAgain.json.status, 'exists');
  assert.equal(aliceAgain.json.address, alice.json.address);
});

test('wallet commands explain what is missing', { skip: !supported && 'system keychain not supported here' }, async () => {
  const root = makeTempDir('obelisk-wallet-cli-errors-');
  const keychain = installFakeKeychain(root);

  const none = await runCliAsync(['wallet', 'show'], cliEnv(root, keychain, join(root, 'nobody')));
  assert.equal(none.status, 1);
  assert.match(none.json.error, /No Obelisk wallet for .*; create one with `obelisk wallet create`/);
  assert.equal(existsSync(join(root, 'nobody', 'wallet.json')), false);

  await runCliAsync(['wallet', 'create'], cliEnv(root, keychain, join(root, 'dave')));
  assert.equal(resolveServiceUrl({}), DEFAULT_SERVICE_URL);
  assert.equal(resolveServiceUrl({ OBELISK_SERVICE_URL: 'http://127.0.0.1:8787/' }), 'http://127.0.0.1:8787');

  const hostile = await startFakeService({ contracts: { ...testnet.contracts, KeyRegistry: '0x000000000000000000000000000000000000dEaD' } });
  try {
    const refused = await runCliAsync(['wallet', 'activate', '--confirm'], cliEnv(root, keychain, join(root, 'dave'), hostile.url));
    assert.equal(refused.status, 1);
    assert.match(refused.json.error, /reports KeyRegistry at 0x000000000000000000000000000000000000dEaD.*refusing to sign/);
    assert.equal(hostile.relays.length, 0);
  } finally {
    hostile.close();
  }

  const usage = await runCliAsync(['wallet', 'activate', '--yes'], cliEnv(root, keychain, join(root, 'dave')));
  assert.equal(usage.status, 1);
  assert.match(usage.json.error, /Usage: obelisk wallet create \| show \| activate \[--confirm\]/);
});
