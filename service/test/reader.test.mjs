// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// The web reader (#10). Its browser module (public/reader/core.js) must
// derive the same encryption key as `obelisk wallet activate` and open what
// `obelisk share send` encrypts, using only WebCrypto; and the service must
// serve the page with its security headers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hexToBytes, bytesToHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { keyRegistryTypes, obeliskDomain, shareRegistryTypes } from '../../chain/eip712.ts';
import { encryptShareContent, newShareId, sealContentKey } from '../../packages/core/src/share-crypto.ts';
import { deriveEncryptionKey as coreDerive, ENCRYPTION_KEY_MESSAGE as CORE_MESSAGE } from '../../packages/core/src/wallet.ts';
import * as reader from '../public/reader/core.js';
import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

test('the reader derives the same encryption key as the CLI, from the same wallet signature', async () => {
  assert.equal(reader.ENCRYPTION_KEY_MESSAGE, CORE_MESSAGE);
  const account = privateKeyToAccount(generatePrivateKey());
  const signature = await account.signMessage({ message: { raw: hexToBytes(reader.personalSignPayload()) } });
  assert.equal(signature, await account.signMessage({ message: CORE_MESSAGE }), 'personal_sign payload is the message bytes');
  const fromCore = await coreDerive(account);
  const fromBrowser = await reader.deriveEncryptionKey(signature);
  assert.equal(fromBrowser.registeredKey, fromCore.registeredKey);

  // A wallet may return the high-s form of the same signature; the key must not change.
  const bytes = hexToBytes(signature);
  const s = BigInt(bytesToHex(bytes.slice(32, 64)));
  const high = new Uint8Array(bytes);
  high.set(hexToBytes(`0x${(SECP256K1_N - s).toString(16).padStart(64, '0')}`), 32);
  high[64] = bytes[64] === 27 ? 28 : 27;
  assert.equal((await reader.deriveEncryptionKey(bytesToHex(high))).registeredKey, fromCore.registeredKey);
});

test('the reader opens what `obelisk share send` encrypts, with WebCrypto only', async () => {
  assert.equal(await reader.supportsX25519(), true);
  const account = privateKeyToAccount(generatePrivateKey());
  const signature = await account.signMessage({ message: CORE_MESSAGE });
  const { registeredKey } = await coreDerive(account);
  const snapshot = { format: 'obelisk.share.snapshot/v1', title: '修复支付回调', messages: [{ n: 1, role: 'user', text: '你好 [redacted: API key]', toolCalls: [] }] };
  const shareId = newShareId();
  const { contentKey, blob } = encryptShareContent(new TextEncoder().encode(JSON.stringify(snapshot)), shareId);
  const keyPackage = sealContentKey(contentKey, registeredKey, shareId);

  const key = await reader.deriveEncryptionKey(signature);
  const opened = await reader.openKeyPackage(keyPackage, key, shareId);
  assert.deepEqual(Buffer.from(opened), Buffer.from(contentKey));
  const ciphertext = reader.base64ToBytes(Buffer.from(blob).toString('base64'));
  assert.deepEqual(await reader.decryptSnapshot(ciphertext, opened, shareId), snapshot);

  // Another wallet's key, or another share's id, does not open it.
  const other = await reader.deriveEncryptionKey(await privateKeyToAccount(generatePrivateKey()).signMessage({ message: CORE_MESSAGE }));
  await assert.rejects(reader.openKeyPackage(keyPackage, other, shareId));
  await assert.rejects(reader.decryptSnapshot(ciphertext, opened, newShareId()));
});

test('the typed data the reader asks the wallet to sign matches chain/eip712.ts', () => {
  const config = resolveChainConfig({ CHAIN_ID: '968' });
  const chain = { chainId: config.chain.id, contracts: config.contracts };
  const open = reader.typedData('RecordOpen', 'ShareRegistry', chain, {});
  assert.deepEqual(open.types.RecordOpen, shareRegistryTypes.RecordOpen);
  assert.deepEqual(open.domain, obeliskDomain('ShareRegistry', 968, config.contracts.ShareRegistry));
  const register = reader.typedData('RegisterKey', 'KeyRegistry', chain, {});
  assert.deepEqual(register.types.RegisterKey, keyRegistryTypes.RegisterKey);
  assert.deepEqual(register.domain, obeliskDomain('KeyRegistry', 968, config.contracts.KeyRegistry));
});

test('snapshot text is split into parts the page renders as text, with redactions marked', () => {
  assert.deepEqual(reader.splitRedactions('key=[redacted: API key] at ~/x'), ['key=', { redacted: 'API 密钥' }, ' at ~/x']);
  assert.deepEqual(reader.splitBlocks('intro\n\n```ts\nconst a = 1;\n```\nafter'), [
    { kind: 'text', text: 'intro' },
    { kind: 'code', lang: 'ts', text: 'const a = 1;' },
    { kind: 'text', text: 'after' },
  ]);
  assert.deepEqual(reader.splitInline('run `npm test` **now**'), [
    { kind: 'text', text: 'run ' }, { kind: 'code', text: 'npm test' }, { kind: 'text', text: ' ' }, { kind: 'bold', text: 'now' },
  ]);
  assert.deepEqual(reader.summarizeToolCall({ name: 'Bash', input: '{"command":"grep -rn payment src/"}' }), { verb: '运行', detail: 'grep -rn payment src/' });
  assert.equal(reader.shareNumber(`0x0142${'0'.repeat(60)}`), 'S-0142');
  assert.equal(reader.shortAddress('0x7a3f000000000000000000000000000000c21e'), '0x7a3f…c21e');
  // Every time is shown in the viewer's zone, and the label names that zone.
  const offset = -new Date().getTimezoneOffset();
  assert.match(reader.timeZoneLabel(), /^UTC[+-]\d{1,2}(:\d{2})?$/);
  assert.equal(reader.timeZoneLabel().startsWith(offset >= 0 ? 'UTC+' : 'UTC-'), true);
  assert.equal(reader.formatDateTime('2026-10-07T10:20:00.000Z').slice(11), new Date('2026-10-07T10:20:00.000Z').toTimeString().slice(0, 5));

  // Snapshot content is untrusted: the page never parses anything as HTML.
  for (const file of readdirSync(new URL('../public/reader/', import.meta.url))) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(new URL(`../public/reader/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, `${file} must build the page from text nodes`);
  }
});

test('the service serves the reader at /s/<shareId> and /activate with its security headers', async () => {
  const html = readFileSync(new URL('../public/reader/index.html', import.meta.url), 'utf8');
  const deps = (readerPage) => ({
    config: resolveChainConfig({ CHAIN_ID: '968' }), publicClient: null, relayerAddress: null, txIndex: null,
    storage: { kv: false, r2: false }, shares: null, relay: null, readerPage,
  });
  const page = async () => new Response(html);
  for (const path of [`/s/${newShareId()}`, '/activate']) {
    const response = await handleRequest(new Request(`http://service.test${path}`), deps(page));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(await response.text(), html);
  }
  assert.doesNotMatch(html, /private key|seed phrase|mnemonic|私钥：|助记词：/i, 'the page asks for no key material');
  assert.equal((await handleRequest(new Request('http://service.test/s/x/y'), deps(page))).status, 404);
  const unbound = await handleRequest(new Request('http://service.test/activate'), deps(undefined));
  assert.equal(unbound.status, 503);
  assert.equal((await unbound.json()).error.code, 'reader_unavailable');
});
