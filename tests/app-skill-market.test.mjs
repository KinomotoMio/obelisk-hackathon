// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ObeliskServiceClient } from '../packages/core/src/obelisk-service.ts';
import { readChainSkill } from '../app/src/main/skill-market.ts';

const AUTHOR = '0xA1c94E0b7D3f2b6E1a0C9d58F3e4b7A2c1d93be2';
const FP = `0x${'AB'.repeat(32)}`;

function skillBody(overrides = {}) {
  return {
    chainId: 31337,
    contract: '0x0000000000000000000000000000000000000001',
    skillId: '7',
    author: AUTHOR,
    parentSkillId: '3',
    createdAt: '2026-10-01T00:00:00.000Z',
    birthScenes: ['v1:artifact/resume', 'user:artifact/插画作品集'],
    versionCount: 2,
    version: { index: 1, fingerprint: FP, publishedAt: '2026-10-05T00:00:00.000Z' },
    content: { name: 'ai-resume', description: '适用于所有求职场景', body: '# body' },
    explorer: { author: null },
    ...overrides,
  };
}

function usageBody(overrides = {}) {
  return {
    chainId: 31337,
    skillId: '7',
    totalInvocations: 12,
    uniqueWallets: 3,
    uniqueWalletsExact: true,
    lastReportAt: '2026-10-06T00:00:00.000Z',
    scenes: [],
    outcomes: [],
    results: { smooth: 0, rework: 0, failed: 0, unknown: 0, judged: 0, smoothRate: null, signals: { 'tool-error': 0, 'user-correction': 0 } },
    trend: { unit: 'week', source: 'relayed_reports', available: true, weeks: [{ start: '2026-09-28', invocations: 4 }, { start: '2026-10-05', invocations: 8 }] },
    versions: [{ index: 0, fingerprint: FP, publishedAt: '2026-10-01T00:00:00.000Z', totalInvocations: 12, uniqueWallets: 3, lastReportAt: null }],
    ...overrides,
  };
}

const lineageBody = {
  chainId: 31337,
  skillId: '7',
  rootSkillId: '3',
  path: ['3', '7'],
  nodes: [
    { skillId: '3', parentSkillId: null, depth: 0, author: AUTHOR, name: 'resume-base', versionCount: 1, latestFingerprint: FP, createdAt: '2026-09-01T00:00:00.000Z', childSkillIds: ['7'] },
    { skillId: '7', parentSkillId: '3', depth: 1, author: AUTHOR, name: '<b>ai-resume</b>', versionCount: 2, latestFingerprint: FP, createdAt: '2026-10-01T00:00:00.000Z', childSkillIds: [] },
  ],
  truncated: false,
};

function fakeService(routes) {
  const requested = [];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname + new URL(url).search;
    requested.push(path);
    const route = Object.entries(routes).find(([pattern]) => path === pattern);
    if (!route) return new Response(JSON.stringify({ error: { code: 'not_found', message: `no route ${path}` } }), { status: 404 });
    const [status, body] = typeof route[1] === 'function' ? route[1]() : [200, route[1]];
    return new Response(JSON.stringify(body), { status });
  };
  return { client: new ObeliskServiceClient('http://127.0.0.1:9', fetchImpl), requested };
}

const chainBody = { chainId: 31337, name: 'local', explorerUrl: 'https://scan.example/', contracts: {}, relayer: null };

test('a minted Skill reads its version, usage over 8 weeks, and family tree from the service', async () => {
  const { client, requested } = fakeService({
    '/v1/skills/7': skillBody(),
    '/v1/skills/7/usage?weeks=8': usageBody(),
    '/v1/skills/7/lineage': lineageBody,
    '/v1/chain': chainBody,
  });
  const result = await readChainSkill(client, '7');
  assert.equal(result.ok, true, JSON.stringify(result));
  const { skill } = result;
  assert.ok(requested.includes('/v1/skills/7/usage?weeks=8'));
  assert.equal(skill.name, 'ai-resume');
  assert.equal(skill.parentSkillId, '3');
  assert.equal(skill.version.fingerprint, 'ab'.repeat(32), 'fingerprints are the lowercase hex the library uses');
  assert.deepEqual(skill.birthScenes.map(scene => [scene.kind, scene.label, scene.dimensionLabel]), [
    ['vocabulary', '简历与履历', '产出物'],
    ['user', '插画作品集', '产出物'],
  ]);
  assert.equal(skill.usage.totalInvocations, 12);
  assert.equal(skill.usage.uniqueWallets, 3);
  assert.equal(skill.usage.outcomesReported, false, 'no outcome buckets means the statistics are not on yet');
  assert.deepEqual(skill.usage.trend.weeks.map(week => week.invocations), [4, 8]);
  assert.deepEqual(skill.lineage.nodes.map(node => node.skillId), ['3', '7']);
  assert.equal(skill.lineage.nodes[1].name, '<b>ai-resume</b>', 'names stay text; the page escapes them');
  assert.equal(skill.explorerUrl, 'https://scan.example');
  assert.equal(skill.serviceUrl, 'http://127.0.0.1:9');
});

test('only a positive decimal Skill id is looked up', async () => {
  const { client, requested } = fakeService({});
  for (const id of ['0', '-1', '7/../keys', '0x07', 7, null]) {
    const result = await readChainSkill(client, id);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_skill_id');
  }
  assert.deepEqual(requested, []);
});

test('a Skill that is not on chain is reported as such', async () => {
  const { client } = fakeService({
    '/v1/skills/99': () => [404, { error: { code: 'unknown_skill', message: 'No minted Skill 99' } }],
  });
  assert.deepEqual(await readChainSkill(client, '99'), { ok: false, error: { code: 'unknown_skill', message: 'No minted Skill 99' } });
});

test('a service without the usage or lineage routes still shows the Skill', async () => {
  const { client } = fakeService({ '/v1/skills/7': skillBody() });
  const result = await readChainSkill(client, '7');
  assert.equal(result.ok, true);
  assert.equal(result.skill.usage, null);
  assert.match(result.skill.usageError, /no route/);
  assert.equal(result.skill.lineage, null);
  assert.equal(result.skill.explorerUrl, null);
});

test('malformed service data is refused, not shown', async () => {
  for (const [label, body] of [
    ['author', skillBody({ author: 'javascript:alert(1)' })],
    ['fingerprint', skillBody({ version: { index: 0, fingerprint: '9c41…e07a', publishedAt: '2026-10-05T00:00:00.000Z' } })],
    ['count', skillBody({ versionCount: -1 })],
  ]) {
    const { client } = fakeService({ '/v1/skills/7': body });
    const result = await readChainSkill(client, '7');
    assert.equal(result.ok, false, label);
    assert.equal(result.error.code, 'invalid_response', label);
  }
  const { client } = fakeService({
    '/v1/skills/7': skillBody(),
    '/v1/skills/7/usage?weeks=8': usageBody({ totalInvocations: 'lots' }),
    '/v1/chain': { ...chainBody, explorerUrl: 'javascript:alert(1)' },
  });
  const result = await readChainSkill(client, '7');
  assert.equal(result.skill.usage, null);
  assert.match(result.skill.usageError, /invalid invocation count/);
  assert.equal(result.skill.explorerUrl, null, 'only an https explorer is linked');
});

test('a Skill with no stored body has no name or description, and says nothing it does not know', async () => {
  const { client } = fakeService({ '/v1/skills/7': skillBody({ content: null, parentSkillId: null }) });
  const result = await readChainSkill(client, '7');
  assert.equal(result.skill.name, null);
  assert.equal(result.skill.description, null);
  assert.equal(result.skill.parentSkillId, null);
});

test('each measured scene carries its own outcomes when the service reports them', async () => {
  const scenes = [
    { key: `0x${'01'.repeat(32)}`, tag: 'v1:artifact/resume', label: '简历与履历', dimension: 'artifact', invocations: 40, smooth: 20, rework: 6, failed: 4, unknown: 8, judged: 30, smoothRate: 0.6667 },
    { key: `0x${'02'.repeat(32)}`, tag: 'v1:role/engineer', label: '工程师', dimension: 'role', invocations: 9 },
  ];
  const { client } = fakeService({
    '/v1/skills/7': skillBody(),
    '/v1/skills/7/usage?weeks=8': usageBody({ scenes }),
  });
  const { skill } = await readChainSkill(client, '7');
  assert.deepEqual(skill.usage.scenes[0].results, { smooth: 20, rework: 6, failed: 4, unknown: 8, judged: 30, smoothRate: 20 / 30 });
  assert.equal(skill.usage.scenes[1].results, null, 'a scene reported without outcomes has no rate to show');

  const bad = fakeService({
    '/v1/skills/7': skillBody(),
    '/v1/skills/7/usage?weeks=8': usageBody({ scenes: [{ ...scenes[0], judged: 99 }] }),
  });
  const refused = await readChainSkill(bad.client, '7');
  assert.equal(refused.skill.usage, null);
  assert.match(refused.skill.usageError, /scene judged count/);
});
