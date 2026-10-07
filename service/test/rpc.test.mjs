// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient } from 'viem';

import { requestScopedHttp } from '../src/rpc.ts';

function fakeRpc() {
  const batches = [];
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    const calls = Array.isArray(body) ? body : [body];
    batches.push(calls.map((call) => call.params[0]));
    const answer = (call) => ({ jsonrpc: '2.0', id: call.id, result: `0x${call.params[0].toString(16)}` });
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), { headers: { 'content-type': 'application/json' } });
  };
  return { batches, fetchFn };
}

test('concurrent calls batch within one Worker request, never across requests', async () => {
  const rpc = fakeRpc();
  // Two Worker requests served at once in one isolate, each with its own client.
  const clients = [1, 2].map(() => createPublicClient({ transport: requestScopedHttp('http://rpc.test', { fetchFn: rpc.fetchFn }) }));
  const call = (client, n) => client.request({ method: 'eth_getBalance', params: [n] });
  const results = await Promise.all([call(clients[0], 1), call(clients[1], 2), call(clients[0], 3), call(clients[1], 4)]);
  assert.deepEqual(results, ['0x1', '0x2', '0x3', '0x4']);
  assert.deepEqual(rpc.batches.map((batch) => batch.sort()), [[1, 3], [2, 4]], 'one batch per request, each only its own calls');
});
