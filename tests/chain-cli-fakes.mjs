// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Stand-ins for running the built CLI's chain commands in tests: the system
// keychain tool (`security` on macOS, `secret-tool` on Linux) is replaced on
// PATH by a fake that keeps entries in a JSON file and logs its argv, and the
// online service by an in-process server that verifies signatures the way the
// contracts do. The real relay is covered in service/test.

import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, join } from 'node:path';

import { createHash } from 'node:crypto';

import { getAddress, recoverTypedDataAddress } from 'viem';

import { keyRegistryTypes, obeliskDomain, pinnedDeployments, shareRegistryTypes } from '../packages/core/src/chain-protocol.ts';
import { cliEntry, repoRoot } from './cli-test-helpers.mjs';

export const supported = process.platform === 'darwin' || process.platform === 'linux';
export const testnet = pinnedDeployments[968];

const FAKE_KEYCHAIN = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const file = process.env.FAKE_KEYCHAIN_FILE;
const tool = basename(process.argv[1], '.mjs');
const argv = process.argv.slice(2);
appendFileSync(process.env.FAKE_KEYCHAIN_LOG, JSON.stringify([tool, ...argv]) + '\\n');
const store = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const save = () => writeFileSync(file, JSON.stringify(store));
const stdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };
const flag = (args, name) => args[args.indexOf(name) + 1];
if (tool === 'security' && argv[0] === 'find-generic-password') {
  const key = flag(argv, '-s') + '\\n' + flag(argv, '-a');
  if (!(key in store)) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); process.exit(44); }
  process.stdout.write(store[key] + '\\n');
} else if (tool === 'security' && argv[0] === '-i') {
  const tokens = [...stdin().matchAll(/"([^"]*)"|(\\S+)/g)].map((m) => m[1] ?? m[2]);
  if (tokens[0] !== 'add-generic-password') process.exit(2);
  const key = flag(tokens, '-s') + '\\n' + flag(tokens, '-a');
  if (key in store) { process.stderr.write('security: SecKeychainItemCreateFromContent (<default>): The specified item already exists in the keychain.\\n'); process.exit(45); }
  store[key] = flag(tokens, '-w'); save();
} else if (tool === 'secret-tool' && argv[0] === 'lookup') {
  const key = flag(argv, 'service') + '\\n' + flag(argv, 'account');
  if (!(key in store)) process.exit(1);
  process.stdout.write(store[key]);
} else if (tool === 'secret-tool' && argv[0] === 'store') {
  store[flag(argv, 'service') + '\\n' + flag(argv, 'account')] = stdin(); save();
} else {
  process.exit(2);
}
`;

export function installFakeKeychain(root) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  // The fake tells the tools apart by its own file name (argv[1]).
  for (const tool of ['security', 'secret-tool']) {
    const script = join(bin, `${tool}.mjs`);
    writeFileSync(script, FAKE_KEYCHAIN);
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  return {
    bin,
    store: join(root, 'keychain.json'),
    log: join(root, 'keychain.log'),
  };
}

/**
 * A stand-in for service/ that checks RegisterKey, CreateShare, and
 * RevokeShare signatures like the contracts do. `respond.share` and
 * `respond.revoke` can force the next upload's or revoke's answer:
 * `{ status, body }`, or `'pending'` to accept it but report pending (a
 * pending revoke lands only when the test calls `confirmRevoke`).
 */
export async function startFakeService({ contracts = testnet.contracts } = {}) {
  const keys = new Map();
  const relays = [];
  const shareNonces = new Map();
  const shares = new Map();
  const uploads = [];
  const respond = { share: null, revoke: null };
  const confirmedTxs = new Set();
  const txUrl = (hash) => `https://scan.bohr.life/tx/${hash}`;
  const shareStatus = (share) => {
    if (share.revoked) return 'revoked';
    if (Date.now() / 1000 >= Number(share.message.expiresAt)) return 'expired';
    if (share.opens.length >= share.message.maxOpens) return 'exhausted';
    return 'active';
  };
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const send = (status, value) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/v1/chain') {
      return send(200, { chainId: 968, name: 'BOT Chain Testnet', explorerUrl: 'https://scan.bohr.life', contracts, relayer: null });
    }
    const keyMatch = /^\/v1\/keys\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname);
    if (keyMatch) {
      const address = getAddress(keyMatch[1]);
      const record = keys.get(address);
      return send(200, {
        address,
        registered: Boolean(record),
        pubKey: record?.pubKey ?? null,
        version: record?.version ?? 0,
        updatedAt: record ? '2026-10-07T00:00:00.000Z' : null,
        nonce: String(record?.version ?? 0),
        explorerUrl: `https://scan.bohr.life/address/${address}`,
      });
    }
    if (url.pathname === '/v1/relay' && request.method === 'POST') {
      const { action, message, signature } = JSON.parse(body);
      relays.push({ action, message });
      const user = getAddress(message.user);
      const expectedNonce = BigInt(keys.get(user)?.version ?? 0);
      if (action !== 'RegisterKey' || BigInt(message.nonce) !== expectedNonce) {
        return send(409, { error: { code: 'stale_nonce', message: 'stale nonce' } });
      }
      const signer = await recoverTypedDataAddress({
        domain: obeliskDomain('KeyRegistry', 968, testnet.contracts.KeyRegistry),
        types: keyRegistryTypes,
        primaryType: 'RegisterKey',
        message: { ...message, nonce: BigInt(message.nonce), deadline: BigInt(message.deadline) },
        signature,
      });
      if (signer !== user) return send(401, { error: { code: 'invalid_signature', message: `The signature was not made by ${user}` } });
      keys.set(user, { pubKey: message.pubKey, version: (keys.get(user)?.version ?? 0) + 1 });
      const txHash = `0x${String(relays.length).padStart(64, '0')}`;
      return send(200, { status: 'confirmed', action, signer: user, txHash, blockNumber: '1', explorerUrl: `https://scan.bohr.life/tx/${txHash}` });
    }
    const nonceMatch = /^\/v1\/nonces\/ShareRegistry\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname);
    if (nonceMatch) {
      return send(200, { contract: 'ShareRegistry', address: getAddress(nonceMatch[1]), nonce: String(shareNonces.get(getAddress(nonceMatch[1])) ?? 0) });
    }
    if (url.pathname === '/v1/shares' && request.method === 'POST') {
      const upload = JSON.parse(body);
      const { message, signature, keyPackage, ciphertext } = upload;
      const sender = getAddress(message.sender);
      const typed = { ...message, maxOpens: Number(message.maxOpens), expiresAt: BigInt(message.expiresAt), nonce: BigInt(message.nonce), deadline: BigInt(message.deadline) };
      const signer = await recoverTypedDataAddress({
        domain: obeliskDomain('ShareRegistry', 968, testnet.contracts.ShareRegistry),
        types: shareRegistryTypes,
        primaryType: 'CreateShare',
        message: typed,
        signature,
      });
      if (signer !== sender) return send(401, { error: { code: 'invalid_signature', message: `The signature was not made by ${sender}` } });
      if (shares.has(message.shareId)) return send(409, { error: { code: 'share_exists', message: `Share ${message.shareId} already exists on chain` } });
      if (BigInt(message.nonce) !== BigInt(shareNonces.get(sender) ?? 0)) return send(409, { error: { code: 'stale_nonce', message: 'stale nonce' } });
      const hash = `0x${createHash('sha256').update(Buffer.from(ciphertext, 'base64')).digest('hex')}`;
      if (hash !== message.contentHash) return send(400, { error: { code: 'content_hash_mismatch', message: 'content hash mismatch' } });
      const recipientKey = keys.get(getAddress(message.recipient))?.pubKey;
      if (!recipientKey) return send(422, { error: { code: 'recipient_not_activated', message: `${message.recipient} has not activated an Obelisk wallet` } });
      if (recipientKey.toLowerCase() !== keyPackage.recipientKey) return send(409, { error: { code: 'recipient_key_changed', message: 'recipient key changed' } });
      const forced = respond.share;
      respond.share = null;
      if (forced && forced !== 'pending') return send(forced.status, forced.body);
      uploads.push(upload);
      shareNonces.set(sender, (shareNonces.get(sender) ?? 0) + 1);
      const txHash = `0x${String(uploads.length).padStart(4, '0')}${'5'.repeat(60)}`;
      shares.set(message.shareId, { message: typed, txHash, opens: [], revoked: null, revokeTx: null });
      const explorerUrl = `https://scan.bohr.life/tx/${txHash}`;
      if (forced === 'pending') return send(202, { status: 'pending', action: 'CreateShare', signer: sender, txHash, explorerUrl, shareId: message.shareId });
      return send(200, { status: 'confirmed', action: 'CreateShare', signer: sender, txHash, blockNumber: '7', explorerUrl, shareId: message.shareId });
    }
    const revokeMatch = /^\/v1\/shares\/(0x[0-9a-f]{64})\/revoke$/.exec(url.pathname);
    if (revokeMatch && request.method === 'POST') {
      const share = shares.get(revokeMatch[1]);
      if (!share) return send(404, { error: { code: 'unknown_share', message: 'unknown share' } });
      const { message, signature } = JSON.parse(body);
      const sender = getAddress(message.sender);
      const signer = await recoverTypedDataAddress({
        domain: obeliskDomain('ShareRegistry', 968, testnet.contracts.ShareRegistry),
        types: shareRegistryTypes,
        primaryType: 'RevokeShare',
        message: { ...message, nonce: BigInt(message.nonce), deadline: BigInt(message.deadline) },
        signature,
      });
      if (signer !== sender) return send(401, { error: { code: 'invalid_signature', message: `The signature was not made by ${sender}` } });
      if (sender !== getAddress(share.message.sender)) return send(403, { error: { code: 'not_sender', message: `Only the sender ${getAddress(share.message.sender)} can revoke this share` } });
      if (share.revoked) return send(409, { error: { code: 'already_revoked', message: `This share was already revoked at ${share.revoked}` } });
      if (BigInt(message.nonce) !== BigInt(shareNonces.get(sender) ?? 0)) return send(409, { error: { code: 'stale_nonce', message: 'stale nonce' } });
      const forced = respond.revoke;
      respond.revoke = null;
      if (forced && forced !== 'pending') return send(forced.status, forced.body);
      shareNonces.set(sender, (shareNonces.get(sender) ?? 0) + 1);
      const txHash = `0x${'7'.repeat(4)}${message.shareId.slice(6)}`;
      share.revokeTx = txHash;
      if (forced === 'pending') return send(202, { status: 'pending', action: 'RevokeShare', signer: sender, txHash, explorerUrl: txUrl(txHash), shareId: message.shareId });
      share.revoked = '2026-10-07T12:00:00.000Z';
      confirmedTxs.add(txHash);
      return send(200, { status: 'confirmed', action: 'RevokeShare', signer: sender, txHash, blockNumber: '9', explorerUrl: txUrl(txHash), shareId: message.shareId });
    }
    const shareMatch = /^\/v1\/shares\/(0x[0-9a-f]{64})$/.exec(url.pathname);
    if (shareMatch) {
      const share = shares.get(shareMatch[1]);
      if (!share) return send(404, { error: { code: 'unknown_share', message: 'unknown share' } });
      const { message, txHash } = share;
      const link = (hash) => (hash ? { txHash: hash, explorerUrl: txUrl(hash) } : null);
      return send(200, {
        shareId: message.shareId,
        status: shareStatus(share),
        sender: getAddress(message.sender),
        recipient: getAddress(message.recipient),
        contentHash: message.contentHash,
        maxOpens: message.maxOpens === 0xffffffff ? null : message.maxOpens,
        openCount: share.opens.length,
        createdAt: '2026-10-07T00:00:00.000Z',
        expiresAt: new Date(Number(message.expiresAt) * 1000).toISOString(),
        revoked: Boolean(share.revoked),
        revokedAt: share.revoked,
        receipts: share.opens.map((open, index) => ({ openCount: index + 1, openedAt: open.openedAt, blockNumber: '8', txHash: open.txHash, explorerUrl: txUrl(open.txHash) })),
        transactions: { create: link(txHash), revoke: link(share.revokeTx) },
        contentStored: true,
      });
    }
    const txMatch = /^\/v1\/tx\/(0x[0-9a-f]{64})$/.exec(url.pathname);
    if (txMatch) {
      return send(200, { txHash: txMatch[1], status: confirmedTxs.has(txMatch[1]) ? 'confirmed' : 'pending', explorerUrl: txUrl(txMatch[1]), relay: null });
    }
    return send(404, { error: { code: 'not_found', message: 'not found' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    relays,
    uploads,
    respond,
    /** Mark a wallet as activated with `pubKey`, as a confirmed RegisterKey would. */
    registerKey: (address, pubKey) => keys.set(getAddress(address), { pubKey, version: 1 }),
    /** The recipient opened `shareId`, as a confirmed RecordOpen would record it. */
    recordOpen: (shareId, openedAt) => {
      const share = shares.get(shareId);
      share.opens.push({ openedAt, txHash: `0x${'8'.repeat(4)}${String(share.opens.length + 1).padStart(60, '0')}` });
    },
    /** Move `shareId` past its expiry. */
    expire: (shareId) => { shares.get(shareId).message.expiresAt = 1n; },
    /** A pending revoke of `shareId` lands. */
    confirmRevoke: (shareId) => {
      const share = shares.get(shareId);
      share.revoked = '2026-10-07T12:00:00.000Z';
      confirmedTxs.add(share.revokeTx);
    },
    close: () => server.close(),
  };
}

// spawnSync would block this process's event loop, and with it the fake service.
export function runCliAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', cliEntry, ...args], { cwd: repoRoot, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() }));
  });
}

export function cliEnv(root, keychain, home, serviceUrl) {
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    OBELISK_HOME: home,
    PATH: `${keychain.bin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_KEYCHAIN_FILE: keychain.store,
    FAKE_KEYCHAIN_LOG: keychain.log,
  };
  // Never fall through to the deployed service from a test.
  env.OBELISK_SERVICE_URL = serviceUrl ?? 'http://127.0.0.1:9';
  return env;
}

