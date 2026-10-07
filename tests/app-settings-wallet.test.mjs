// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Settings → 钱包 (#6): what the main process tells the renderer about the
// wallet, and the prompts and wording the page uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import { pinnedDeployments } from '../packages/core/src/chain-protocol.ts';
import { explorerAddressUrl, ObeliskServiceClient } from '../packages/core/src/obelisk-service.ts';
import { resolveObeliskPaths } from '../packages/core/src/paths.ts';
import { createWallet, deriveEncryptionKey, WALLET_KEYCHAIN_SERVICE } from '../packages/core/src/wallet.ts';
import { importWalletFromApp, MAX_SECRET_LENGTH, readWalletActivation, readWalletOverview } from '../app/src/main/wallet.ts';
import { ACTIVATE_WALLET_PROMPT, CREATE_WALLET_PROMPT } from '../app/src/renderer/src/wallet-prompts.mjs';
import { activationPill, importErrorText, keyStoreLabel } from '../app/src/renderer/src/wallet-view.mjs';
import { renderPrompt } from '../app/src/renderer/src/assistant-prompts.mjs';
import { makeTempDir } from './temp-dirs.mjs';

// Hardhat's public development wallet #0. Never holds real funds.
const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const MNEMONIC = 'test test test test test test test test test test test junk';
const ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

function memorySecrets() {
  const entries = new Map();
  return {
    description: 'macOS Keychain',
    entries,
    async get(service, account) { return entries.get(`${service}\n${account}`) ?? null; },
    async add(service, account, _label, secret) {
      const key = `${service}\n${account}`;
      if (entries.has(key)) throw new Error('already exists');
      entries.set(key, secret);
    },
  };
}

function setup() {
  const home = makeTempDir('obelisk-app-wallet-');
  const secrets = memorySecrets();
  const paths = resolveObeliskPaths({ env: { OBELISK_HOME: home } });
  return { home, secrets, paths, context: () => ({ paths, secrets }) };
}

// A stand-in for the online service's /v1/chain and /v1/keys routes.
function service(answer) {
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const body = path === '/v1/chain' ? answer.chain : path.startsWith('/v1/keys/') ? answer.key : null;
    if (answer.fail) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(body ?? { error: { code: 'not_found', message: 'not found' } }), { status: body ? 200 : 404 });
  };
  return () => new ObeliskServiceClient('https://service.example', fetchImpl);
}

const testnetChain = (extra = {}) => ({ chainId: 968, name: 'BOT Chain Testnet', explorerUrl: 'https://scan.bohr.life', contracts: pinnedDeployments[968].contracts, relayer: null, ...extra });

test('Settings shows no wallet, a wallet, or a wallet whose key is missing, from the keychain and wallet.json', async () => {
  const { home, secrets, paths, context } = setup();
  assert.deepEqual(await readWalletOverview(context, home), { state: 'none', dataDir: home, storedIn: 'macOS Keychain' });

  const { address } = await createWallet(context());
  assert.deepEqual(await readWalletOverview(context, home), { state: 'ready', address, dataDir: home, storedIn: 'macOS Keychain' });

  secrets.entries.clear();
  const missing = await readWalletOverview(context, home);
  assert.equal(missing.state, 'key_missing');
  assert.equal(missing.address, address);

  rmSync(paths.walletPath);
  const unsupported = await readWalletOverview(() => { throw new Error('Keeping the wallet key in the system keychain is not supported on win32 yet'); }, home);
  assert.deepEqual(unsupported, { state: 'error', dataDir: home, message: 'Keeping the wallet key in the system keychain is not supported on win32 yet' });
});

test('activation is read like `obelisk wallet show`, with the explorer link built from the chain id', async () => {
  const { context } = setup();
  await importWalletFromApp(context, KEY);
  const { registeredKey } = await deriveEncryptionKey((await import('viem/accounts')).privateKeyToAccount(KEY));

  const fresh = await readWalletActivation(context, service({ chain: testnetChain(), key: { address: ADDRESS, registered: false, pubKey: null, version: 0, updatedAt: null, nonce: '0' } }));
  assert.deepEqual(fresh, {
    activation: 'not_activated',
    address: ADDRESS,
    chainId: 968,
    network: 'BOT Chain 测试网',
    explorerUrl: `https://scan.bohr.life/address/${ADDRESS}`,
    activatedAt: null,
    keyVersion: null,
  });

  const active = await readWalletActivation(context, service({
    // A service that names another explorer does not choose where the link goes.
    chain: testnetChain({ explorerUrl: 'https://phish.example' }),
    key: { address: ADDRESS, registered: true, pubKey: registeredKey, version: 1, updatedAt: '2026-10-07T13:03:00.000Z', nonce: '1' },
  }));
  assert.equal(active.activation, 'active');
  assert.equal(active.explorerUrl, `https://scan.bohr.life/address/${ADDRESS}`);
  assert.equal(active.activatedAt, '2026-10-07T13:03:00.000Z');
  assert.equal(active.keyVersion, 1);

  const other = await readWalletActivation(context, service({ chain: testnetChain(), key: { address: ADDRESS, registered: true, pubKey: `0x01${'22'.repeat(32)}`, version: 2, updatedAt: '2026-10-07T13:03:00.000Z', nonce: '2' } }));
  assert.equal(other.activation, 'different_key');
  assert.equal(other.activatedAt, null, 'a key that is not this wallet\'s has no activation date');

  const junk = await readWalletActivation(context, service({ chain: testnetChain(), key: { address: ADDRESS, registered: true, pubKey: '<script>', version: 1, updatedAt: 'tomorrow', nonce: '1' } }));
  assert.equal(junk.activation, 'not_activated', 'a malformed key from the service is not taken as registered');
});

test('without the online service the activation is unknown, with the reason, and the address still known', async () => {
  const { context } = setup();
  await importWalletFromApp(context, KEY);
  const offline = await readWalletActivation(context, service({ fail: true }));
  assert.equal(offline.activation, 'unknown');
  assert.equal(offline.address, ADDRESS);
  assert.equal(offline.error.code, 'unreachable');
  assert.match(offline.error.message, /Could not reach the Obelisk online service/);

  const misconfigured = await readWalletActivation(context, () => { throw new Error('OBELISK_SERVICE_URL is not a URL: nope'); });
  assert.deepEqual(misconfigured.error, { code: 'error', message: 'OBELISK_SERVICE_URL is not a URL: nope' });

  const hostile = await readWalletActivation(context, service({ chain: testnetChain({ contracts: { ...pinnedDeployments[968].contracts, KeyRegistry: '0x0000000000000000000000000000000000000001' } }) }));
  assert.equal(hostile.activation, 'unknown', 'a service reporting other contracts is not trusted for the reading');
  assert.match(hostile.error.message, /refusing to sign/);

  const { context: empty } = setup();
  assert.equal((await readWalletActivation(empty, service({ fail: true }))).error.code, 'no_wallet');
});

test('导入钱包 stores the key and never hands it, or the phrase, back to the renderer', async () => {
  const { home, secrets, context } = setup();
  const result = await importWalletFromApp(context, MNEMONIC);
  assert.deepEqual(result, { ok: true, status: 'imported', address: ADDRESS, kind: 'mnemonic' });
  assert.equal(secrets.entries.get(`${WALLET_KEYCHAIN_SERVICE}\n${home}`), KEY);
  const overview = await readWalletOverview(context, home);
  for (const answer of [result, overview]) {
    const text = JSON.stringify(answer);
    assert.ok(!text.includes(KEY.slice(2)) && !text.includes('junk'), 'no key or phrase in what the renderer receives');
  }

  const again = await importWalletFromApp(context, KEY);
  assert.deepEqual(again, { ok: true, status: 'exists', address: ADDRESS, kind: 'private-key' });
  const other = await importWalletFromApp(context, `0x${'11'.repeat(32)}`);
  assert.deepEqual(other.ok, false);
  assert.equal(other.error.code, 'wallet_exists');
  assert.equal(other.error.address, ADDRESS);
  assert.ok(!JSON.stringify(other).includes('11'.repeat(32)), 'a refused secret is not echoed');
});

test('a secret the App cannot use is refused with a code the page words in Chinese', async () => {
  const { context } = setup();
  const typo = await importWalletFromApp(context, 'test test test test tset test test test test test test junk');
  assert.deepEqual(typo, { ok: false, error: { code: 'mnemonic-word', message: 'Word 5 of the recovery phrase is not in the BIP-39 English word list', wordIndex: 5 } });
  assert.equal(importErrorText(typo.error), '第 5 个词不在 BIP-39 英文词表里，请检查拼写。');
  assert.equal((await importWalletFromApp(context, 'test '.repeat(11) + 'test')).error.code, 'mnemonic-checksum');
  assert.equal((await importWalletFromApp(context, '0xabc')).error.code, 'private-key-format');
  assert.equal((await importWalletFromApp(context, 'x'.repeat(MAX_SECRET_LENGTH + 1))).error.code, 'unrecognized');
  assert.equal((await importWalletFromApp(context, { secret: KEY })).error.code, 'unrecognized', 'only a string is accepted over IPC');
  for (const code of ['empty', 'private-key-format', 'mnemonic-length', 'mnemonic-checksum', 'unrecognized', 'busy']) {
    assert.match(importErrorText({ code }), /[一-鿿]/, `${code} has Chinese wording`);
  }
  assert.match(importErrorText({ code: 'wallet_exists', address: ADDRESS }), /0xf39F…2266.*不会替换已有钱包/);
  assert.match(importErrorText({ code: 'error', message: 'Saving to the macOS Keychain failed: denied' }), /^导入失败：Saving to the macOS Keychain failed/);
});

test('生成钱包 and 激活 copy prompts for the obelisk-wallet skill, in the words docs/vision/01 uses', () => {
  assert.equal(renderPrompt(CREATE_WALLET_PROMPT, 'claude-code'), '/obelisk-wallet 帮我创建 Obelisk 钱包');
  assert.equal(renderPrompt(CREATE_WALLET_PROMPT, 'codex'), '用 obelisk-wallet 帮我创建 Obelisk 钱包');
  assert.equal(renderPrompt(ACTIVATE_WALLET_PROMPT, 'claude-code'), '/obelisk-wallet 激活我的 Obelisk 钱包');
  assert.deepEqual(['active', 'not_activated', 'different_key', 'unknown'].map((activation) => activationPill({ activation }).text), ['已激活', '未激活', '需要重新激活', '激活状态未知']);
  assert.equal(activationPill(null).text, '正在查询激活状态…');
  assert.equal(keyStoreLabel('macOS Keychain'), 'macOS 钥匙串');
  assert.equal(keyStoreLabel('Secret Service keyring'), '系统密钥环');
});

test('explorer links come from the chain id: BOT Chain mainnet and testnet, none for the local chain', () => {
  assert.equal(explorerAddressUrl(677, ADDRESS), `https://scan.botchain.ai/address/${ADDRESS}`);
  assert.equal(explorerAddressUrl(968, ADDRESS), `https://scan.bohr.life/address/${ADDRESS}`);
  assert.equal(explorerAddressUrl(31337, ADDRESS), null);
});
