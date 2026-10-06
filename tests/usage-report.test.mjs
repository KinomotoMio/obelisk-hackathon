// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Usage report plans (#23): which versions are reported, with what counts,
// and buckets in the canonical form UsageStats accepts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { obeliskDomain, pinnedDeployments, usageStatsTypes } from '../packages/core/src/chain-protocol.ts';
import { sceneBucketKey } from '../packages/core/src/scenes.ts';
import { MAX_REPORT_BUCKETS, outcomeBucketKey } from '../packages/core/src/usage-buckets.ts';
import { planUsageReports, signReportUsage, toReportBuckets } from '../packages/core/src/usage-report.ts';

const fp = (char) => char.repeat(64);
const load = (fingerprint, sessionId, n) => ({
  messageUuid: `${sessionId}-${n}`, sessionId, source: 'claude', timestamp: null, agentId: null, loadedAs: null, fingerprint, textFrom: 'index',
});
const minted = (name, fingerprint, chainId, skillId, versionIndex = 0) => ({
  name, fingerprint, state: 'minted', mint: { chainId, skillId, versionIndex, author: '0x00000000000000000000000000000000000000a1', txHash: null, mintedAt: '' },
});
const fetched = (name, fingerprint, chainId, skillId) => ({
  name, fingerprint, state: 'fetched', mint: null,
  fetched: { chainId, skillId, versionIndex: 0, author: '0x00000000000000000000000000000000000000b2', installedTo: '/x' },
});

test('only versions minted on the service chain are reported: own minted and fetched ones, never drafts or unknown Skills', () => {
  const invocations = [
    load(fp('a'), 's1', 1), load(fp('a'), 's1', 2), load(fp('a'), 's2', 3),
    load(fp('b'), 's1', 4),
    load(fp('c'), 's3', 5), // a draft
    load(fp('d'), 's3', 6), // minted on another chain
    load(fp('e'), 's3', 7), // not in the library
    { ...load(null, 's4', 8), unresolved: 'source_unavailable' },
  ];
  const versions = new Map([
    [fp('a'), [minted('mine', fp('a'), 968, '1')]],
    [fp('b'), [fetched('theirs', fp('b'), 968, '7')]],
    [fp('c'), [{ name: 'draft', fingerprint: fp('c'), state: 'draft', mint: null }]],
    [fp('d'), [minted('elsewhere', fp('d'), 677, '2')]],
  ]);
  const plans = planUsageReports(invocations, versions, 968);
  assert.deepEqual(
    plans.map(({ fingerprint, skillId, names, state, cumulativeInvocations, sessions, scenes, outcomes }) =>
      ({ fingerprint, skillId, names, state, cumulativeInvocations, sessions, scenes, outcomes })),
    [
      { fingerprint: fp('a'), skillId: '1', names: ['mine'], state: 'minted', cumulativeInvocations: 3, sessions: 2, scenes: [], outcomes: [] },
      { fingerprint: fp('b'), skillId: '7', names: ['theirs'], state: 'fetched', cumulativeInvocations: 1, sessions: 1, scenes: [], outcomes: [] },
    ],
    'without annotations (#25) the buckets are empty',
  );
});

test('annotations become per-invocation bucket counts: scenes by vocabulary key, one outcome and any signals each', () => {
  const invocations = [load(fp('a'), 's1', 1), load(fp('a'), 's1', 2), load(fp('a'), 's2', 3)];
  const versions = new Map([[fp('a'), [minted('mine', fp('a'), 968, '1')]]]);
  const annotations = {
    's1-1': { scenes: ['artifact/resume', 'v1:artifact/resume', 'user:context/求职季'], outcome: 'smooth', signals: ['tool-error', 'tool-error'] },
    's1-2': { scenes: ['v1:artifact/resume'], outcome: 'unknown' },
    's2-3': null,
  };
  const [plan] = planUsageReports(invocations, versions, 968, (item) => annotations[item.messageUuid]);
  const resume = sceneBucketKey('v1:artifact/resume');
  const season = sceneBucketKey('user:context/求职季');
  assert.deepEqual(
    new Map(plan.scenes.map((bucket) => [bucket.key, bucket.cumulative])),
    new Map([[resume, 2], [season, 1]]),
    'a tag given twice for one invocation counts once',
  );
  assert.deepEqual(
    new Map(plan.outcomes.map((bucket) => [bucket.label, bucket.cumulative])),
    new Map([['outcome/smooth', 1], ['outcome/unknown', 1], ['signal/tool-error', 1]]),
  );
  assert.equal(plan.outcomes.find((bucket) => bucket.label === 'signal/tool-error').key, outcomeBucketKey('signal/tool-error'));
  for (const buckets of [plan.scenes, plan.outcomes]) {
    assert.deepEqual(buckets.map((bucket) => bucket.key), buckets.map((bucket) => bucket.key).sort(), 'keys ascend');
  }
});

test('more buckets than a report holds keeps the largest, still in key order', () => {
  const counts = new Map(Array.from({ length: MAX_REPORT_BUCKETS + 5 }, (_, index) => [
    sceneBucketKey(`user:context/tag-${index}`), { label: `tag-${index}`, cumulative: index + 1 },
  ]));
  const buckets = toReportBuckets(counts);
  assert.equal(buckets.length, MAX_REPORT_BUCKETS);
  assert.equal(Math.min(...buckets.map((bucket) => bucket.cumulative)), 6);
  assert.deepEqual(buckets.map((bucket) => bucket.key), buckets.map((bucket) => bucket.key).sort());
});

test('a ReportUsage signature recovers to the reporter in the UsageStats domain', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const usageStats = pinnedDeployments[968].contracts.UsageStats;
  const message = {
    reporter: account.address, fingerprint: `0x${fp('a')}`, cumulativeInvocations: 3n,
    scenes: [{ key: sceneBucketKey('v1:artifact/resume'), cumulative: 2n }], outcomes: [], nonce: 0n, deadline: 99n,
  };
  const signature = await signReportUsage(account, 968, usageStats, message);
  const signer = await recoverTypedDataAddress({
    domain: obeliskDomain('UsageStats', 968, usageStats), types: usageStatsTypes, primaryType: 'ReportUsage', message, signature,
  });
  assert.equal(signer, account.address);
});
