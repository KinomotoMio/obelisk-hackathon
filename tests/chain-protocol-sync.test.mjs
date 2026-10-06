// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pinnedDeployments } from '../packages/core/src/chain-protocol.ts';
import { chainProtocolPath, renderChainProtocol } from '../scripts/sync-chain-protocol.mjs';

test('core carries an up-to-date copy of chain/eip712.ts and the complete deployments', () => {
  assert.equal(readFileSync(chainProtocolPath, 'utf8'), renderChainProtocol(), 'run `npm run sync:chain`');
  const testnet = JSON.parse(readFileSync(new URL('../chain/deployments/968.json', import.meta.url), 'utf8'));
  assert.equal(pinnedDeployments[968].contracts.KeyRegistry, testnet.contracts.KeyRegistry.address);
});
