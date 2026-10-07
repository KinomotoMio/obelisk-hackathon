import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ready, startLocalChain, stopLocalChain, makeApp, publicClient } from './local-chain.mjs';
import { resolveObeliskPaths } from '../../packages/core/src/paths.ts';
import { createWallet } from '../../packages/core/src/wallet.ts';
import { saveSkillDraft } from '../../packages/core/src/skills.ts';
import { runSkillMintCommand } from '../../packages/cli/src/skill-mint-command.ts';
import { runMarketCommand } from '../../packages/cli/src/market-command.ts';
import { runSkillFetchCommand } from '../../packages/cli/src/skill-fetch-command.ts';

test('CLI licensed mint -> list -> buy -> use -> Codex install; retry buys only once', { skip: !ready, timeout: 90000 }, async () => {
  await startLocalChain({ market: true });
  try {
    const app = makeApp();
    const secretsMap = new Map();
    const secrets = { description: 'test memory', get: async (s, a) => secretsMap.get(`${s}:${a}`) ?? null,
      add: async (s, a, label, secret) => { secretsMap.set(`${s}:${a}`, secret); } };
    const fetch = async (url, init = {}) => {
      const path = new URL(url).pathname + new URL(url).search;
      const result = await app.call(init.method ?? 'GET', path, init.body ? JSON.parse(init.body) : undefined);
      return new Response(JSON.stringify(result.body), { status: result.status });
    };
    const funding = createWalletClient({ chain: app.config.chain, transport: http(app.config.rpcUrl),
      account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') });
    const actor = async () => {
      const home = await mkdtemp(join(tmpdir(), 'obelisk-market-cli-'));
      const env = { ...process.env, OBELISK_HOME: home, OBELISK_SERVICE_URL: 'https://service.test', HOME: home };
      const paths = resolveObeliskPaths({ env });
      const wallet = await createWallet({ paths, secrets });
      await publicClient.waitForTransactionReceipt({ hash: await funding.sendTransaction({ to: wallet.address, value: parseEther('1') }) });
      return { env, secrets, fetch, paths };
    };
    const author = await actor();
    const buyer = await actor();
    await saveSkillDraft(author.paths.skillsDir, { name: 'licensed-method', description: 'A paid test method', body: '# Licensed method\n\nCheck the result.', birthScenes: ['v1:task/testing'] });
    const preview = await runSkillMintCommand(['licensed-method', '--licensed'], author);
    const minted = await runSkillMintCommand(['licensed-method', '--licensed', '--confirm', preview.fingerprint], author);
    assert.equal(minted.bodyStored, true);
    const listing = ['list', minted.skillId, '--mode', 'per-use', '--license', 'commercial', '--price', '0.001', '--royalty-bps', '2000'];
    const listed = await runMarketCommand([...listing, '--confirm', 'listing-1'], author);
    assert.equal(listed.status, 'confirmed');
    const purchase = await runMarketCommand(['buy', '1', '--confirm', 'purchase-1'], buyer);
    const retry = await runMarketCommand(['buy', '1', '--confirm', 'purchase-1'], buyer);
    assert.equal(retry.transaction, purchase.transaction);
    const used = await runMarketCommand(['use', '1', '--confirm', 'use-1'], buyer);
    const installed = await runSkillFetchCommand([minted.fingerprint, '--receipt', used.transaction, '--harness', 'codex', '--confirm'], buyer);
    assert.equal(installed.status, 'installed');
    assert.match(await readFile(installed.installedTo, 'utf8'), /Check the result/);
    const income = await runMarketCommand(['income'], author);
    assert.equal(income.count, '1');
    assert.equal(income.totalWei, parseEther('0.00095').toString());
  } finally { stopLocalChain(); }
});
