// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The investor preview's data (#33): the illustrative story the page ships
// with, and the swap to a real Playground run's provenance record (G6 step 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { applyProvenance, checkStory, explorerTxUrl, loadStory, runPageUrl, stepsOfRole, timelineUpTo } from '../service/public/preview/story.js';

const story = JSON.parse(readFileSync(new URL('../service/public/preview/story.json', import.meta.url), 'utf8'));
const provenance = JSON.parse(readFileSync(new URL('../playground/examples/provenance.example.json', import.meta.url), 'utf8'));

test('the shipped story is the demo loop, labeled illustrative, with several roles in every step', () => {
  checkStory(story);
  assert.equal(story.source.kind, 'illustrative');
  assert.equal(story.source.label, '示意内容');
  assert.equal(story.steps.length, 9);
  for (const step of story.steps) {
    assert.ok(new Set(step.screens.map((screen) => screen.role)).size >= 2, `${step.id} shows at least two roles side by side`);
    for (const entry of step.timeline) {
      if (entry.tx) assert.equal(entry.tx.hash, undefined, `${step.id}: illustrative transactions carry no hash, so nothing links to a made-up record`);
    }
  }
  assert.equal(timelineUpTo(story, 2).length, 5, 'the timeline grows step by step');
  assert.deepEqual([...stepsOfRole(story, 'H')], [7]);
});

test('a real run swaps in wallets, linked transactions, screenshots and per-step provenance', () => {
  const mapped = {
    ...story,
    run: { provenance: 'runs/example/provenance.json' },
    steps: story.steps.map((step) => (step.id === 'mint' ? { ...step, playgroundStep: 'a-distill-mint' } : step.id === 'resume' ? { ...step, playgroundStep: ['u-report'] } : step)),
  };
  const real = checkStory(applyProvenance(mapped, provenance, '/preview/runs/example/'));
  assert.deepEqual({ kind: real.source.kind, label: real.source.label, run: real.source.run.id, network: real.source.run.network }, { kind: 'playground-run', label: '真实运行', run: provenance.run.id, network: 'BOT Chain 测试网' });
  assert.equal(real.roles.find((role) => role.id === 'A').address, provenance.roles[0].wallet.address);
  assert.equal(real.roles.find((role) => role.id === 'A').wallet, '0x1111…1111');

  const mint = real.steps.find((step) => step.id === 'mint');
  assert.deepEqual(mint.timeline.map((entry) => [entry.role, entry.text, explorerTxUrl(entry.tx)]), [
    ['A', '铸造 Skill #12「AI 能力履历」，版本 1', `https://scan.bohr.life/tx/${'0x3f'.padEnd(66, '3f')}`],
  ]);
  assert.match(mint.timeline[0].at, /^\d\d:\d\d:\d\d$/);
  assert.deepEqual(mint.screens[0], { role: 'A', where: '铸造成功', image: '/preview/runs/example/screenshots/a-distill-mint.png', caption: '铸造成功' });
  assert.ok(mint.screens.slice(1).every((screen) => screen.illustrative && screen.role !== 'A'), 'hand-drawn screens that remain are marked, the real screenshot replaces A\'s');
  assert.deepEqual(mint.provenance.steps.map((item) => item.id), ['a-distill-mint']);
  assert.equal(mint.provenance.harness.model, 'claude-sonnet-5-5');

  const resume = real.steps.find((step) => step.id === 'resume');
  assert.equal(resume.timeline[0].text, '上报调用统计');
  const share = real.steps.find((step) => step.id === 'share');
  assert.ok(share.timeline.every((entry) => entry.illustrative) && share.screens.every((screen) => screen.illustrative), 'steps the run did not cover stay marked as illustrative');
});

test('only safe links and paths come out of the data', async () => {
  assert.equal(explorerTxUrl({ hash: `0x${'a'.repeat(64)}`, explorerUrl: 'javascript:alert(1)', chainId: 968 }), `https://scan.bohr.life/tx/0x${'a'.repeat(64)}`);
  assert.equal(explorerTxUrl({ hash: 'not-a-hash', chainId: 968 }), null);
  assert.equal(explorerTxUrl({ hash: `0x${'a'.repeat(64)}`, chainId: 1 }), null);

  const hostile = structuredClone(provenance);
  hostile.steps[1].screenshots = [{ file: '../../secret.png', caption: 'x' }, { file: 'https://evil.example/a.png', caption: 'y' }];
  const real = applyProvenance({ ...story, steps: story.steps.map((step) => (step.id === 'mint' ? { ...step, playgroundStep: 'a-distill-mint' } : step)) }, hostile, '/preview/runs/x/');
  assert.ok(real.steps.find((step) => step.id === 'mint').screens.every((screen) => !screen.image));

  const fetched = [];
  const fetchJson = async (url) => { fetched.push(url); return url.endsWith('story.json') ? { ...story, run: { provenance: '../../v1/admin.json' } } : provenance; };
  await assert.rejects(loadStory(fetchJson), /must be a path under the page directory/);
  assert.deepEqual(fetched, ['/preview/story.json']);
});

test('a run published to /runs/<id> is read from there, and each real step links to its run page (#32)', async () => {
  const mapped = { ...story, run: { provenance: `/runs/${provenance.run.id}/provenance.json` }, steps: story.steps.map((step) => (step.id === 'mint' ? { ...step, playgroundStep: 'a-distill-mint' } : step)) };
  const fetched = [];
  const real = await loadStory(async (url) => { fetched.push(url); return url.endsWith('story.json') ? mapped : provenance; });
  assert.deepEqual(fetched, ['/preview/story.json', `/runs/${provenance.run.id}/provenance.json`]);
  const mint = real.steps.find((step) => step.id === 'mint');
  assert.ok(mint.screens.filter((screen) => screen.image).every((screen) => screen.image.startsWith(`/runs/${provenance.run.id}/screenshots/`)));
  assert.equal(runPageUrl(mint.provenance), `/runs/${provenance.run.id}?step=a-distill-mint`);
  assert.equal(runPageUrl({ runId: '../x', steps: [] }), null);
  assert.equal(runPageUrl({ runId: 'run-1', steps: [{ id: 'a b' }] }), '/runs/run-1');

  for (const bad of ['/runs/../provenance.json', '/runs/x/../../v1/admin.json', '/runs/x/events.jsonl', 'https://evil.example/runs/x/provenance.json']) {
    await assert.rejects(loadStory(async (url) => (url.endsWith('story.json') ? { ...story, run: { provenance: bad } } : provenance)), /must be a path/, bad);
  }
});

test('the Playground fixture run is never presented as a real run', () => {
  const fixture = structuredClone(provenance);
  fixture.run.id = 'fixture-demo-loop';
  const shown = checkStory(applyProvenance(story, fixture, '/runs/fixture-demo-loop/'));
  assert.deepEqual([shown.source.kind, shown.source.label], ['fixture', '示例数据']);
});
