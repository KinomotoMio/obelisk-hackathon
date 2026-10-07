// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Skill usage end to end on a local Hardhat node (see local-chain.mjs, #24):
// Skills minted and usage reported through the relay, then read back through
// the usage routes.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { skillRegistryTypes, usageStatsTypes } from '../../chain/eip712.ts';
import { sceneBucketKey, SCENES, vocabularyTag } from '../../packages/core/src/scenes.ts';
import { MAX_REPORT_BUCKETS, outcomeBucketKey, sceneOutcomeBucketKey } from '../../packages/core/src/usage-buckets.ts';
import { weeklyTrend } from '../src/usage.ts';
import { deadline, makeApp, ready, signAction, startLocalChain, stopLocalChain } from './local-chain.mjs';

const skip = !ready && 'chain/ not built';
let app;

before(async () => {
  await startLocalChain();
  if (ready) app = makeApp();
});
after(stopLocalChain);

const fingerprintOf = (body) => `0x${createHash('sha256').update(body, 'utf8').digest('hex')}`;

async function relay(account, contract, types, action, message) {
  const signature = await signAction(app, account, contract, types, action, message);
  const result = await app.call('POST', '/v1/relay', { action, message, signature });
  assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.body)}`);
  return result.body;
}

const nonceOf = async (contract, account) => (await app.call('GET', `/v1/nonces/${contract}/${account.address}`)).body.nonce;

async function mint(author, body, { parentSkillId = '0', birthScenes = [] } = {}) {
  await relay(author, 'SkillRegistry', skillRegistryTypes, 'MintSkill', {
    author: author.address, fingerprint: fingerprintOf(body), birthScenes, parentSkillId, nonce: await nonceOf('SkillRegistry', author), deadline: deadline(),
  });
  return fingerprintOf(body);
}

async function report(reporter, fingerprint, cumulativeInvocations, { scenes = [], outcomes = [] } = {}) {
  return relay(reporter, 'UsageStats', usageStatsTypes, 'ReportUsage', {
    reporter: reporter.address, fingerprint, cumulativeInvocations: String(cumulativeInvocations), scenes, outcomes,
    nonce: await nonceOf('UsageStats', reporter), deadline: deadline(),
  });
}

test('a relayed usage report is remembered with what it added, for the trend', { skip }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const reporter = privateKeyToAccount(generatePrivateKey());
  const fingerprint = await mint(author, '# trend probe');
  await report(reporter, fingerprint, 3);
  await report(reporter, fingerprint, 3);
  await report(reporter, fingerprint, 5);
  const entries = await app.usageTrend.list(app.config.chain.id, fingerprint);
  assert.deepEqual(entries.map((entry) => entry.added), [3, 2], 'a re-sent report adds nothing and is not recorded');
  assert.ok(entries.every((entry) => !Number.isNaN(Date.parse(entry.at))));
});

const bucket = (key, cumulative) => ({ key, cumulative: String(cumulative) });
const ascending = (buckets) => [...buckets].sort((a, b) => (a.key < b.key ? -1 : 1));

test('usage reads: totals, distinct wallets across versions, labeled scenes and outcomes, and the weekly trend', { skip }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const alice = privateKeyToAccount(generatePrivateKey());
  const bob = privateKeyToAccount(generatePrivateKey());
  const v1 = await mint(author, '# usage probe', { birthScenes: ['v1:artifact/resume', 'user:context/求职季'] });
  const skillId = (await app.call('GET', `/v1/skills/${v1}`)).body.skillId;
  const v2Body = '# usage probe\n\nv2';
  await relay(author, 'SkillRegistry', skillRegistryTypes, 'PublishVersion', {
    author: author.address, skillId, fingerprint: fingerprintOf(v2Body), nonce: await nonceOf('SkillRegistry', author), deadline: deadline(),
  });
  const v2 = fingerprintOf(v2Body);

  const resume = sceneBucketKey('v1:artifact/resume');
  const season = sceneBucketKey('user:context/求职季');
  const mystery = sceneBucketKey('user:context/nobody-knows');
  const smooth = outcomeBucketKey('outcome/smooth');
  const failed = outcomeBucketKey('outcome/failed');
  const unknown = outcomeBucketKey('outcome/unknown');
  const toolError = outcomeBucketKey('signal/tool-error');
  await report(alice, v1, 4, {
    scenes: ascending([bucket(resume, 3), bucket(season, 1)]),
    outcomes: ascending([bucket(smooth, 2), bucket(failed, 1), bucket(unknown, 1), bucket(toolError, 1)]),
  });
  await report(bob, v1, 2, { scenes: ascending([bucket(resume, 1), bucket(mystery, 1)]), outcomes: [bucket(smooth, 1)] });
  await report(alice, v2, 3);

  const version = await app.call('GET', `/v1/usage/${v1}?wallet=${alice.address}`);
  assert.equal(version.status, 200, JSON.stringify(version.body));
  assert.deepEqual(
    { skillId: version.body.skillId, versionIndex: version.body.versionIndex, total: version.body.totalInvocations, wallets: version.body.uniqueWallets },
    { skillId, versionIndex: 0, total: 6, wallets: 2 },
  );
  assert.deepEqual(version.body.wallet.cumulative, 4);
  const scenes = version.body.scenes.map(({ tag, label, invocations }) => ({ tag, label, invocations }));
  assert.deepEqual(scenes[0], { tag: 'v1:artifact/resume', label: '简历与履历', invocations: 4 }, 'largest first');
  assert.deepEqual(
    new Set(scenes.slice(1).map((scene) => JSON.stringify(scene))),
    new Set([{ tag: 'user:context/求职季', label: '求职季', invocations: 1 }, { tag: null, label: null, invocations: 1 }].map((scene) => JSON.stringify(scene))),
    'vocabulary tags and the Skill\'s own birth scenes are named; other user tags stay keys',
  );
  assert.deepEqual(version.body.results, {
    smooth: 3, rework: 0, failed: 1, unknown: 1, judged: 4, smoothRate: 0.75,
    signals: { 'tool-error': 1, 'user-correction': 0, 'repeated-edit': 0, 'repeated-invocation': 0 },
  });
  assert.equal(version.body.trend.weeks.length, 8);
  assert.equal(version.body.trend.weeks.at(-1).invocations, 6, 'this week holds every report made in this test');

  const skill = await app.call('GET', `/v1/skills/${skillId}/usage?weeks=4`);
  assert.equal(skill.status, 200, JSON.stringify(skill.body));
  assert.deepEqual(
    { total: skill.body.totalInvocations, wallets: skill.body.uniqueWallets, exact: skill.body.uniqueWalletsExact },
    { total: 9, wallets: 2, exact: true },
    'alice reported both versions and counts once',
  );
  assert.deepEqual(skill.body.versions.map((item) => [item.index, item.totalInvocations, item.uniqueWallets]), [[0, 6, 2], [1, 3, 1]]);
  assert.deepEqual(skill.body.birthScenes.map((scene) => scene.label), ['简历与履历', '求职季']);
  assert.equal(skill.body.trend.weeks.length, 4);
  assert.equal(skill.body.trend.weeks.at(-1).invocations, 9);

  const unused = await app.call('GET', `/v1/usage/${fingerprintOf('never minted')}`);
  assert.equal(unused.status, 404);
  assert.equal((await app.call('GET', `/v1/usage/${v1}?weeks=0`)).status, 400);
});

test('per-scene results: scene-outcome pairs are read back under each scene, across several reports', { skip }, async () => {
  const author = privateKeyToAccount(generatePrivateKey());
  const alice = privateKeyToAccount(generatePrivateKey());
  const fingerprint = await mint(author, '# per-scene probe', { birthScenes: ['user:context/求职季'] });

  // Every vocabulary scene judged once, smooth: more pairs than one report holds.
  const tags = SCENES.map((scene) => vocabularyTag(scene.id));
  assert.ok(tags.length > MAX_REPORT_BUCKETS);
  const debug = 'v1:task/debug';
  const counts = new Map(tags.map((tag) => [tag, tag === debug ? 4 : 1]));
  const pairs = tags.map((tag) => bucket(sceneOutcomeBucketKey(tag, 'smooth'), tag === debug ? 2 : 1));
  pairs.push(bucket(sceneOutcomeBucketKey(debug, 'rework'), 1), bucket(sceneOutcomeBucketKey(debug, 'unknown'), 1));
  pairs.push(bucket(sceneOutcomeBucketKey('user:context/求职季', 'failed'), 1), bucket(sceneOutcomeBucketKey('user:context/nobody-knows', 'smooth'), 1));
  const scenes = [...counts].map(([tag, value]) => bucket(sceneBucketKey(tag), value));
  scenes.push(bucket(sceneBucketKey('user:context/求职季'), 1), bucket(sceneBucketKey('user:context/nobody-knows'), 1));
  const sortedScenes = ascending(scenes);
  const sortedPairs = ascending([...pairs, bucket(outcomeBucketKey('outcome/smooth'), tags.length + 2), bucket(outcomeBucketKey('outcome/rework'), 1)]);
  // As splitReportCalls sends them: the same total each time, at most 32 keys per array, the rest kept.
  for (let start = 0; start < Math.max(sortedScenes.length, sortedPairs.length); start += MAX_REPORT_BUCKETS) {
    await report(alice, fingerprint, 50, {
      scenes: sortedScenes.slice(start, start + MAX_REPORT_BUCKETS),
      outcomes: sortedPairs.slice(start, start + MAX_REPORT_BUCKETS),
    });
  }

  const usage = await app.call('GET', `/v1/usage/${fingerprint}`);
  assert.equal(usage.status, 200, JSON.stringify(usage.body));
  const byTag = new Map(usage.body.scenes.map((scene) => [scene.tag, scene]));
  assert.equal(byTag.size, tags.length + 2, 'every scene is read back, the unnamed one under null');
  const pick = ({ invocations, smooth, rework, failed, unknown, judged, smoothRate }) => ({ invocations, smooth, rework, failed, unknown, judged, smoothRate });
  assert.deepEqual(pick(byTag.get(debug)), { invocations: 4, smooth: 2, rework: 1, failed: 0, unknown: 1, judged: 3, smoothRate: 2 / 3 });
  assert.deepEqual(pick(byTag.get('v1:artifact/resume')), { invocations: 1, smooth: 1, rework: 0, failed: 0, unknown: 0, judged: 1, smoothRate: 1 });
  assert.deepEqual(pick(byTag.get('user:context/求职季')), { invocations: 1, smooth: 0, rework: 0, failed: 1, unknown: 0, judged: 1, smoothRate: 0 }, 'a birth user tag is named');
  assert.deepEqual(byTag.get(null).invocations, 1);
  assert.deepEqual(Object.keys(byTag.get(null)).sort(), ['dimension', 'invocations', 'key', 'label', 'tag'], 'an unnamed user tag has its count only');
  assert.deepEqual(
    new Set(usage.body.outcomes.map((item) => item.id)),
    new Set(['outcome/smooth', 'outcome/rework', null]),
    'pairs are shown under their scene; only the unnamed pair stays here, without an id',
  );
  assert.equal(usage.body.results.smooth, tags.length + 2);
});

test('weekly trend buckets start on Monday UTC and drop reports older than the window', () => {
  const now = new Date('2026-10-07T12:00:00Z'); // a Wednesday
  const weeks = weeklyTrend([
    { at: '2026-10-05T00:00:00Z', added: 2 }, // Monday of this week
    { at: '2026-10-04T23:59:59Z', added: 3 }, // Sunday: last week
    { at: '2026-08-01T00:00:00Z', added: 9 }, // outside a 3-week window
  ], 3, now);
  assert.deepEqual(weeks, [
    { start: '2026-09-21', invocations: 0 },
    { start: '2026-09-28', invocations: 3 },
    { start: '2026-10-05', invocations: 2 },
  ]);
});
