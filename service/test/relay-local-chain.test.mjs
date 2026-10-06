// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// End to end against real contracts: a Hardhat node from chain/, the four
// contracts deployed from chain/artifacts, and the service's routing and
// relay code driven through HTTP-shaped requests. Needs `npm ci` and
// `npx hardhat build` in chain/ (CI runs the chain job first); skipped
// otherwise.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, keccak256, parseEther, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { handleRequest, relayResponse } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { HourlyRateLimiter } from '../src/limits.ts';
import { Relayer } from '../src/relayer.ts';
import {
  keyRegistryTypes,
  obeliskDomain,
  shareRegistryTypes,
  skillRegistryTypes,
  usageStatsTypes,
} from '../../chain/eip712.ts';

const chainDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'chain');
const artifact = (name) => join(chainDir, 'artifacts', 'contracts', `${name}.sol`, `${name}.json`);
const ready = existsSync(join(chainDir, 'node_modules', 'hardhat')) && existsSync(artifact('KeyRegistry'));

// Hardhat's well-known development account #0; worthless outside a local node.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const RELAYER_KEY = generatePrivateKey();

let node;
let env;
let publicClient;
let relayerWallet;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startNode(port) {
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['hardhat', 'node', '--port', String(port)], {
    cwd: chainDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hardhat node did not start within 60s')), 60_000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Started HTTP')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`hardhat node exited (${code}): ${output}`)); });
  });
  return child;
}

async function deploy(wallet, name, args = []) {
  const { abi, bytecode } = JSON.parse(readFileSync(artifact(name), 'utf8'));
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.contractAddress;
}

function makeApp({ relayerKey = RELAYER_KEY, limits = {} } = {}) {
  const config = resolveChainConfig(env);
  const transport = http(config.rpcUrl);
  const account = relayerKey ? privateKeyToAccount(relayerKey) : null;
  const store = new Map();
  const txRecords = new Map();
  const relayer = new Relayer({
    config,
    publicClient,
    walletClient: account ? createWalletClient({ account, chain: config.chain, transport }) : null,
    limits: new HourlyRateLimiter({ get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); } }, limits),
    recordTx: async (hash, record) => { txRecords.set(hash, record); },
    pollingIntervalMs: 50,
  });
  const deps = {
    config,
    publicClient,
    relayerAddress: account?.address ?? null,
    txIndex: { get: async (hash) => txRecords.get(hash) ?? null, put: async (hash, record) => { txRecords.set(hash, record); } },
    storage: { kv: true, r2: true },
    relay: (request) => relayResponse(relayer, request),
  };
  return {
    config,
    async call(method, path, body) {
      const response = await handleRequest(new Request(`http://service.test${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      }), deps);
      return { status: response.status, body: await response.json() };
    },
  };
}

const deadline = () => String(Math.floor(Date.now() / 1000) + 600);

async function signAction(app, account, contract, types, action, message) {
  const domain = obeliskDomain(contract, app.config.chain.id, app.config.contracts[contract]);
  return account.signTypedData({ domain, types, primaryType: action, message });
}

before(async () => {
  if (!ready) return;
  const port = await freePort();
  node = await startNode(port);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const config = resolveChainConfig({ CHAIN_ID: '31337', RPC_URL: rpcUrl, LOCAL_CONTRACTS: JSON.stringify({ KeyRegistry: '0x0000000000000000000000000000000000000001', ShareRegistry: '0x0000000000000000000000000000000000000001', SkillRegistry: '0x0000000000000000000000000000000000000001', UsageStats: '0x0000000000000000000000000000000000000001' }) });
  publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) });
  const deployer = createWalletClient({ account: privateKeyToAccount(DEPLOYER_KEY), chain: config.chain, transport: http(rpcUrl) });
  relayerWallet = privateKeyToAccount(RELAYER_KEY);
  await publicClient.waitForTransactionReceipt({
    hash: await deployer.sendTransaction({ to: relayerWallet.address, value: parseEther('10') }),
  });
  const skillRegistry = await deploy(deployer, 'SkillRegistry');
  const contracts = {
    KeyRegistry: await deploy(deployer, 'KeyRegistry'),
    ShareRegistry: await deploy(deployer, 'ShareRegistry'),
    SkillRegistry: skillRegistry,
    UsageStats: await deploy(deployer, 'UsageStats', [skillRegistry]),
  };
  env = { CHAIN_ID: '31337', RPC_URL: rpcUrl, LOCAL_CONTRACTS: JSON.stringify(contracts) };
});

after(() => { node?.kill(); });

test('a signed RegisterKey is relayed on chain and can be read back', { skip: !ready && 'chain/ not built' }, async () => {
  const app = makeApp();
  const user = privateKeyToAccount(generatePrivateKey());
  const pubKey = `0x01${'5a'.repeat(32)}`;

  const before = await app.call('GET', `/v1/keys/${user.address}`);
  assert.equal(before.status, 200);
  assert.equal(before.body.registered, false);
  assert.equal(before.body.nonce, '0');

  const message = { user: user.address, pubKey, nonce: before.body.nonce, deadline: deadline() };
  const signature = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
  const relayed = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  assert.equal(relayed.status, 200, JSON.stringify(relayed.body));
  assert.equal(relayed.body.status, 'confirmed');
  assert.equal(relayed.body.signer, user.address);

  const transaction = await publicClient.getTransaction({ hash: relayed.body.txHash });
  assert.equal(transaction.from.toLowerCase(), relayerWallet.address.toLowerCase(), 'the relay wallet pays');

  const afterRead = await app.call('GET', `/v1/keys/${user.address}`);
  assert.deepEqual(
    { registered: afterRead.body.registered, pubKey: afterRead.body.pubKey, version: afterRead.body.version, nonce: afterRead.body.nonce },
    { registered: true, pubKey, version: 1, nonce: '1' },
  );

  const tx = await app.call('GET', `/v1/tx/${relayed.body.txHash}`);
  assert.equal(tx.body.status, 'confirmed');
  assert.equal(tx.body.relay.action, 'RegisterKey');

  const replay = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  assert.equal(replay.status, 409, 'a replayed signature is stale');
  assert.equal(replay.body.error.code, 'stale_nonce');
});

test('forged, expired, and contract-invalid requests are refused before spending gas', { skip: !ready && 'chain/ not built' }, async () => {
  const app = makeApp();
  const user = privateKeyToAccount(generatePrivateKey());
  const attacker = privateKeyToAccount(generatePrivateKey());
  const balanceBefore = await publicClient.getBalance({ address: relayerWallet.address });

  const message = { user: user.address, pubKey: `0x01${'77'.repeat(32)}`, nonce: '0', deadline: deadline() };
  const forged = await signAction(app, attacker, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
  const forgedResult = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature: forged });
  assert.equal(forgedResult.status, 401);
  assert.equal(forgedResult.body.error.code, 'invalid_signature');

  const signed = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
  const altered = await app.call('POST', '/v1/relay', { action: 'RegisterKey', message: { ...message, pubKey: `0x01${'78'.repeat(32)}` }, signature: signed });
  assert.equal(altered.status, 401, 'a field changed after signing');

  const expiredMessage = { ...message, deadline: String(Math.floor(Date.now() / 1000) - 1) };
  const expired = await app.call('POST', '/v1/relay', {
    action: 'RegisterKey',
    message: expiredMessage,
    signature: await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', expiredMessage),
  });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error.code, 'deadline_too_soon');

  const emptyKey = { ...message, pubKey: '0x' };
  const rejected = await app.call('POST', '/v1/relay', {
    action: 'RegisterKey',
    message: emptyKey,
    signature: await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', emptyKey),
  });
  assert.equal(rejected.status, 422);
  assert.match(rejected.body.error.message, /KeyRegistry rejected RegisterKey: InvalidPublicKeyLength\(0\)/);

  assert.equal(await publicClient.getBalance({ address: relayerWallet.address }), balanceBefore, 'no gas was spent');
});

test('share, Skill, and usage actions relay through the same endpoint', { skip: !ready && 'chain/ not built' }, async () => {
  const app = makeApp();
  const author = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey());
  const relay = async (contract, types, action, message) => {
    const signature = await signAction(app, author, contract, types, action, message);
    const result = await app.call('POST', '/v1/relay', { action, message, signature });
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
    return result.body;
  };
  const nonceOf = async (contract) => (await app.call('GET', `/v1/nonces/${contract}/${author.address}`)).body.nonce;

  const fingerprint = keccak256(toHex('skill body v1'));
  await relay('SkillRegistry', skillRegistryTypes, 'MintSkill', {
    author: author.address, fingerprint, birthScenes: ['debugging/payments'], parentSkillId: '0', nonce: await nonceOf('SkillRegistry'), deadline: deadline(),
  });
  await relay('SkillRegistry', skillRegistryTypes, 'PublishVersion', {
    author: author.address, skillId: '1', fingerprint: keccak256(toHex('skill body v2')), nonce: await nonceOf('SkillRegistry'), deadline: deadline(),
  });
  await relay('UsageStats', usageStatsTypes, 'ReportUsage', {
    reporter: author.address, fingerprint, cumulativeInvocations: '4', scenes: [], outcomes: [], nonce: await nonceOf('UsageStats'), deadline: deadline(),
  });
  const shareId = keccak256(toHex('share-1'));
  await relay('ShareRegistry', shareRegistryTypes, 'CreateShare', {
    sender: author.address, shareId, recipient: recipient.address, contentHash: fingerprint, maxOpens: '1',
    expiresAt: String(Math.floor(Date.now() / 1000) + 3600), nonce: await nonceOf('ShareRegistry'), deadline: deadline(),
  });
  await relay('ShareRegistry', shareRegistryTypes, 'RevokeShare', {
    sender: author.address, shareId, nonce: await nonceOf('ShareRegistry'), deadline: deadline(),
  });
  assert.equal(await nonceOf('SkillRegistry'), '2');
  assert.equal(await nonceOf('ShareRegistry'), '2');
});

test('the relay reports a missing or empty relay wallet and enforces its limits', { skip: !ready && 'chain/ not built' }, async () => {
  const user = privateKeyToAccount(generatePrivateKey());
  const send = async (app) => {
    const message = { user: user.address, pubKey: `0x01${'42'.repeat(32)}`, nonce: (await app.call('GET', `/v1/keys/${user.address}`)).body.nonce, deadline: deadline() };
    const signature = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
    return app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  };

  const unconfigured = await send(makeApp({ relayerKey: null }));
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.body.error.code, 'relay_unavailable');

  const broke = await send(makeApp({ relayerKey: generatePrivateKey() }));
  assert.equal(broke.status, 503);
  assert.equal(broke.body.error.code, 'relay_out_of_funds');
  assert.match(broke.body.error.message, /top it up/);

  const limited = makeApp({ limits: { perSigner: 1 } });
  assert.equal((await send(limited)).status, 200);
  const second = await send(limited);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'rate_limited');

  const health = await makeApp().call('GET', '/v1/health');
  assert.equal(health.body.relayer.address, relayerWallet.address);
  assert.equal(health.body.chainId, 31337);
});

test('concurrent relays from different users all land without relay-nonce collisions', { skip: !ready && 'chain/ not built' }, async () => {
  const app = makeApp();
  const users = Array.from({ length: 4 }, () => privateKeyToAccount(generatePrivateKey()));
  const results = await Promise.all(users.map(async (user, index) => {
    const message = { user: user.address, pubKey: `0x01${String(index).padStart(2, '0').repeat(32)}`, nonce: '0', deadline: deadline() };
    const signature = await signAction(app, user, 'KeyRegistry', keyRegistryTypes, 'RegisterKey', message);
    return app.call('POST', '/v1/relay', { action: 'RegisterKey', message, signature });
  }));
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));
  const nonces = await Promise.all(results.map(async (result) => (await publicClient.getTransaction({ hash: result.body.txHash })).nonce));
  assert.equal(new Set(nonces).size, users.length, 'each relayed transaction used its own relay-wallet nonce');
});
