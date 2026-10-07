import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolveChainConfig } from '../src/chains.ts';

// Read-only: never creates resources or sends a transaction.
const config = JSON.parse(readFileSync(new URL('../wrangler.mainnet.json', import.meta.url), 'utf8'));
assert.equal(config.name, 'obelisk-service-mainnet');
assert.equal(config.vars.CHAIN_ID, '677');
assert.equal(config.r2_buckets[0].bucket_name, 'obelisk-service-mainnet-blobs');
assert.ok(config.kv_namespaces.every(binding => binding.id !== '33e64093414b4c5a9177986f5c54a63b'), 'Mainnet must not bind the testnet KV');
const chain = resolveChainConfig(config.vars);
assert.ok(chain.market, 'Mainnet deployment must include SkillMarket');
const record = JSON.parse(readFileSync(new URL('../../chain/deployments/677.json', import.meta.url), 'utf8'));
assert.equal(record.chainId, 677);
assert.equal(record.complete, true);
for (const [name, address] of Object.entries({ ...chain.contracts, SkillMarket: chain.market })) {
  assert.equal(record.contracts[name]?.address?.toLowerCase(), address.toLowerCase(), `Sync ${name} before deploying`);
}
console.log(JSON.stringify({ ready: true, chainId: chain.chain.id, worker: config.name, contracts: { ...chain.contracts, SkillMarket: chain.market } }, null, 2));
