// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pinnedDeployments } from '../packages/core/src/chain-protocol.ts';
import { ObeliskServiceClient } from '../packages/core/src/obelisk-service.ts';
import { makeTempDir } from './temp-dirs.mjs';
import { chainProtocolPath, renderChainProtocol } from '../scripts/sync-chain-protocol.mjs';

test('core carries an up-to-date copy of chain/eip712.ts and the complete deployments', () => {
  assert.equal(readFileSync(chainProtocolPath, 'utf8'), renderChainProtocol(), 'run `npm run sync:chain`');
  const testnet = JSON.parse(readFileSync(new URL('../chain/deployments/968.json', import.meta.url), 'utf8'));
  assert.equal(pinnedDeployments[968].contracts.KeyRegistry, testnet.contracts.KeyRegistry.address);
});

test('mainnet (#5): a complete deployments/677.json is pinned by sync:chain, and the client then accepts a service on 677', async () => {
  const chain = makeTempDir('obelisk-chain-677-');
  mkdirSync(join(chain, 'deployments'));
  cpSync(new URL('../chain/eip712.ts', import.meta.url), join(chain, 'eip712.ts'));
  cpSync(new URL('../chain/deployments/968.json', import.meta.url), join(chain, 'deployments', '968.json'));
  const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
  const contracts = { KeyRegistry: address(0xa01), ShareRegistry: address(0xa02), SkillRegistry: address(0xa03), UsageStats: address(0xa04) };
  const record = (complete) => ({ chainId: 677, network: 'botMainnet', complete, updatedAt: '', contracts: Object.fromEntries(Object.entries(contracts).map(([name, value]) => [name, { address: value }])) });

  writeFileSync(join(chain, 'deployments', '677.json'), JSON.stringify(record(false)));
  assert.doesNotMatch(renderChainProtocol(chain), /"677"/, 'an interrupted deployment is not pinned');
  writeFileSync(join(chain, 'deployments', '677.json'), JSON.stringify(record(true)));
  assert.match(renderChainProtocol(chain), /"677": \{\s+"chainId": 677,\s+"contracts": \{\s+"KeyRegistry": "0x0+a01"/);

  const service = (chainId) => new ObeliskServiceClient('http://service.test', async () => Response.json({ chainId, contracts, rpcUrl: 'https://rpc.botchain.ai' }));
  await assert.rejects(service(677).chain(), /chain 677, which this CLI has no deployment for/, 'before the sync');
  pinnedDeployments[677] = { chainId: 677, contracts };
  try {
    assert.equal((await service(677).chain()).chainId, 677, 'after the sync');
  } finally {
    delete pinnedDeployments[677];
  }
});
