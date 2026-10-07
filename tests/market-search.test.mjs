import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMarketCommand } from '../packages/cli/src/market-command.ts';
import { pinnedDeployments } from '../packages/core/src/chain-protocol.ts';

test('market discovery works without a wallet or settlement, includes later pages, and keeps unmatched tasks empty', async () => {
  const calls = [];
  const deps = { env: { OBELISK_SERVICE_URL: 'https://market.example' }, fetch: async url => {
    calls.push(String(url));
    if (String(url).endsWith('/v1/chain')) return Response.json({ ...pinnedDeployments[968], market: null });
    return Response.json(String(url).includes('before=2')
      ? { chainId: 968, total: 2, skills: [{ skillId: '1', name: 'portfolio', description: '整理作品集' }], nextBefore: null }
      : { chainId: 968, total: 2, skills: [{ skillId: '2', name: 'server', description: '排障' }], nextBefore: '2' });
  } };
  const result = await runMarketCommand(['search', '作品集'], deps);
  assert.deepEqual(result.skills.map(s => s.skillId), ['1']);
  assert.equal(result.scanned, 2);
  assert.equal(result.truncated, false);
  assert.ok(calls.some(url => url.includes('before=2')));
  assert.equal((await runMarketCommand(['search', '作曲'], deps)).skills.length, 0);
});

test('market discovery rejects cross-network data and discloses bounded pagination', async () => {
  let mismatch = true;
  const deps = { env: { OBELISK_SERVICE_URL: 'https://market.example' }, fetch: async url => Response.json(
    String(url).endsWith('/v1/chain') ? pinnedDeployments[968]
      : { chainId: mismatch ? 677 : 968, total: 500, skills: [], nextBefore: '100' }) };
  await assert.rejects(runMarketCommand(['search'], deps), /does not match/);
  mismatch = false;
  assert.equal((await runMarketCommand(['search'], deps)).truncated, true);
});
