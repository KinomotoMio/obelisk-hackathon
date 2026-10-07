import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, sha256, stringToBytes } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { handleRequest } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';
import { obeliskDomain, privateSkillContentTypes, skillAccessTypes } from '../../chain/eip712.ts';
import { skillMarketAbi } from '../../chain/abi/index.ts';

test('licensed body stays out of public reads; buyer needs own version receipt and retry never spends again', async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const buyer = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const market = `0x${'22'.repeat(20)}`;
  const tx = `0x${'aa'.repeat(32)}`;
  const body = '# Private method\n\nA useful process.';
  const fingerprint = sha256(stringToBytes(body));
  const config = { ...resolveChainConfig({ CHAIN_ID: '968' }), market };
  const objects = new Map();
  let receiptStatus = 'success';
  const deps = { config, storage: {}, shares: null, relayerAddress: null, txIndex: null,
    skillContent: { get: async key => objects.get(key) ?? null, putIfAbsent: async (key, value) => {
      if (objects.has(key)) return false; objects.set(key, value); return true;
    } },
    publicClient: {
      readContract: async ({ functionName }) => {
        if (functionName === 'skillOfFingerprint') return [1n, 0n];
        if (functionName === 'skillCount') return 1n;
        if (functionName === 'getSkill') return [author.address, 0n, 1n, 1n, []];
        if (functionName === 'versionAt') return [fingerprint, 1n];
        if (functionName === 'getOffer') return { fingerprint };
        throw new Error(functionName);
      },
      getTransactionReceipt: async () => ({ status: receiptStatus }),
      getTransaction: async () => ({ to: market, input: encodeFunctionData({ abi: skillMarketAbi, functionName: 'useBySig', args: [buyer.address, 1n, 9999999999n, '0x'] }) }),
    },
  };
  const call = async (method, path, payload) => {
    const response = await handleRequest(new Request(`https://example.test/v1/${path}`, { method, ...(payload ? { body: JSON.stringify(payload) } : {}) }), deps);
    return { status: response.status, body: await response.json() };
  };
  const message = { author: author.address, fingerprint, name: 'private-method', description: 'A useful process', visibility: 'licensed' };
  const signature = await author.signTypedData({ domain: obeliskDomain('SkillRegistry', 968, config.contracts.SkillRegistry), types: privateSkillContentTypes, primaryType: 'PrivateSkillContent', message });
  // Removing the visibility bit invalidates the signed message instead of publishing plaintext.
  assert.equal((await call('POST', `skills/${fingerprint}/content`, { ...message, visibility: 'public', body, signature })).status, 401);
  assert.equal((await call('POST', `skills/${fingerprint}/content`, { ...message, body, signature })).status, 200);
  const publicRead = await call('GET', `skills/${fingerprint}`);
  assert.equal(publicRead.body.content.locked, true);
  assert.equal('body' in publicRead.body.content, false);
  const access = async account => {
    const message = { buyer: account.address, fingerprint, useTransaction: tx, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    const signature = await account.signTypedData({ domain: { name: 'ObeliskSkillMarket', version: '1', chainId: 968, verifyingContract: market }, types: skillAccessTypes, primaryType: 'SkillAccess', message });
    return call('POST', `market/content/${fingerprint}`, { ...message, deadline: message.deadline.toString(), signature });
  };
  assert.equal((await access(stranger)).status, 403);
  assert.equal((await access(buyer)).body.content.body, body);
  assert.equal((await access(buyer)).body.content.body, body, 'retry uses existing receipt; no transaction writer exists in deps');
  receiptStatus = 'reverted';
  assert.equal((await access(buyer)).status, 403);
  assert.equal((await access(author)).body.content.body, body, 'author retains own content access');
});
