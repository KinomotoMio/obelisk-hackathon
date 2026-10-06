// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Shared harness for the end-to-end tests: a Hardhat node from chain/, the
// four contracts deployed from chain/artifacts, and the service's routing and
// relay code driven through HTTP-shaped requests. Needs `npm ci` and
// `npx hardhat build` in chain/ (CI runs the chain job first); callers skip
// their tests when `ready` is false.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { handleRequest, relayResponse } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { HourlyRateLimiter } from '../src/limits.ts';
import { Relayer } from '../src/relayer.ts';
import { usageTrendRecorder } from '../src/usage.ts';
import { obeliskDomain } from '../../chain/eip712.ts';

const chainDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'chain');
const artifact = (name) => join(chainDir, 'artifacts', 'contracts', `${name}.sol`, `${name}.json`);
export const ready = existsSync(join(chainDir, 'node_modules', 'hardhat')) && existsSync(artifact('KeyRegistry'));

// Hardhat's well-known development account #0; worthless outside a local node.
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
export const RELAYER_KEY = generatePrivateKey();

let node;
export let env;
export let publicClient;
export let relayerWallet;

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

/** In-memory stand-in for the R2/KV share store in src/index.ts. */
export function memoryShareStore() {
  const content = new Map();
  const transactions = new Map();
  return {
    content,
    async putContent(id, ciphertext, keyPackage) { content.set(id, { ciphertext, keyPackage }); },
    async getContent(id) { return content.get(id) ?? null; },
    async hasContent(id) { return content.has(id); },
    async deleteContent(id) { content.delete(id); },
    async getTransactions(id) { return structuredClone(transactions.get(id) ?? {}); },
    async putTransactions(id, value) { transactions.set(id, structuredClone(value)); },
  };
}

/** In-memory stand-in for the R2 Skill body store in src/index.ts. */
export function memorySkillContent() {
  const objects = new Map();
  return {
    objects,
    async get(key) { return objects.get(key) ?? null; },
    async putIfAbsent(key, value) { return objects.has(key) ? false : (objects.set(key, value), true); },
  };
}

/** In-memory stand-in for the KV usage trend store in src/index.ts. */
export function memoryUsageTrend() {
  const entries = new Map();
  return {
    entries,
    async add(chainId, fingerprint, id, entry) { entries.set(`${chainId}:${fingerprint}:${id}`, entry); },
    async list(chainId, fingerprint) {
      return [...entries].filter(([key]) => key.startsWith(`${chainId}:${fingerprint}:`)).map(([, entry]) => entry);
    },
  };
}

export function makeApp({ relayerKey = RELAYER_KEY, limits = {}, shares = memoryShareStore(), skillContent = memorySkillContent(), usageTrend = memoryUsageTrend() } = {}) {
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
    onConfirmed: usageTrendRecorder(config, usageTrend),
    pollingIntervalMs: 50,
  });
  const deps = {
    config,
    publicClient,
    relayerAddress: account?.address ?? null,
    txIndex: { get: async (hash) => txRecords.get(hash) ?? null, put: async (hash, record) => { txRecords.set(hash, record); } },
    storage: { kv: true, r2: true },
    shares,
    skillContent,
    relay: (request) => relayResponse(relayer, request),
  };
  return {
    config,
    shares,
    skillContent,
    usageTrend,
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

export const deadline = () => String(Math.floor(Date.now() / 1000) + 600);

export async function signAction(app, account, contract, types, action, message) {
  const domain = obeliskDomain(contract, app.config.chain.id, app.config.contracts[contract]);
  return account.signTypedData({ domain, types, primaryType: action, message });
}

export async function startLocalChain() {
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
}

export function stopLocalChain() {
  node?.kill();
}

