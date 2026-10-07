// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// `obelisk usage judge` and fact signals (#25) through the built CLI. Bob
// fetched Alice's minted Skill and used it twice in one Claude Code session;
// the judge is a fake `codex` / `claude` on PATH that logs how it was run and
// answers in the judge's JSON contract. No real harness or service is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sceneBucketKey, SCENES } from '../packages/core/src/scenes.ts';
import { skillBodyFromMarkdown, skillFingerprint } from '../packages/core/src/skills.ts';
import { outcomeBucketKey, sceneOutcomeBucketKey } from '../packages/core/src/usage-buckets.ts';
import { supported } from './chain-cli-fakes.mjs';
import { setupPeople, startFakeSkillService } from './skill-chain-fakes.mjs';

const fixtures = new URL('./fixtures/', import.meta.url);
const probeMd = readFileSync(new URL('claude/skills/fingerprint-probe/SKILL.md', fixtures), 'utf8');
const probeFp = skillFingerprint(skillBodyFromMarkdown(probeMd));
const [load] = readFileSync(new URL('claude/skill-load-session.jsonl', fixtures), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const skip = !supported && 'system keychain not supported here';

const probeDraft = {
  name: 'fingerprint-probe',
  description: 'Fixture skill for Obelisk fingerprint tests. Use only when explicitly asked to run fingerprint-probe.',
  body: probeMd,
  birthScenes: ['v1:task/testing'],
};

const FAKE_HARNESS = `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const tool = basename(process.argv[1], '.mjs');
const argv = process.argv.slice(2);
const dir = process.env.FAKE_JUDGE_DIR;
const prompt = readFileSync(0, 'utf8');
const schemaFile = argv.includes('--output-schema') ? argv[argv.indexOf('--output-schema') + 1] : null;
const schema = schemaFile && existsSync(schemaFile) ? JSON.parse(readFileSync(schemaFile, 'utf8')) : null;
appendFileSync(join(dir, 'runs.log'), JSON.stringify({ tool, argv, cwd: process.cwd(), schema }) + '\\n');
writeFileSync(join(dir, 'last-prompt.txt'), prompt);
if (existsSync(join(dir, 'fail'))) { process.stderr.write('usage limit reached\\n'); process.exit(1); }
const ids = [...prompt.matchAll(/^=== (i\\d+) /gm)].map((match) => match[1]);
const answer = JSON.stringify({ judgments: ids.map((id) => ({ id, outcome: 'rework', scenes: ['task/debug', 'not/a-scene'], reason: 'fixed after the person corrected it' })) });
if (tool === 'claude') {
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: answer }));
} else {
  writeFileSync(argv[argv.indexOf('-o') + 1], answer);
}
`;

function installFakeHarness(person) {
  const dir = join(person.home, 'fake-judge');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const tool of ['claude', 'codex']) {
    writeFileSync(join(bin, `${tool}.mjs`), FAKE_HARNESS);
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${join(bin, `${tool}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  person.env.PATH = `${bin}:${person.env.PATH}`;
  person.env.FAKE_JUDGE_DIR = dir;
  return {
    runs: () => (existsSync(join(dir, 'runs.log')) ? readFileSync(join(dir, 'runs.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : []),
    prompt: () => readFileSync(join(dir, 'last-prompt.txt'), 'utf8'),
    fail: (on) => (on ? writeFileSync(join(dir, 'fail'), '') : rmSync(join(dir, 'fail'), { force: true })),
    dir,
  };
}

/** A finished Claude Code session: request, load, a rough fix, then the same Skill loaded again. */
function writeRoughSession(home) {
  const sessionId = '7d1c2e30-0000-4000-8000-00000000a001';
  const at = (second) => `2026-10-06T10:00:${String(second).padStart(2, '0')}.000Z`;
  const base = { sessionId, cwd: '/tmp/probe', userType: 'external', isSidechain: false };
  const user = (uuid, second, content) => ({ ...base, uuid, type: 'user', timestamp: at(second), message: { role: 'user', content } });
  const assistant = (uuid, second, content) => ({ ...base, uuid, type: 'assistant', timestamp: at(second), message: { role: 'assistant', model: 'claude-opus', content } });
  const toolUse = (id, file) => ({ type: 'tool_use', id, name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } });
  const toolResult = (id, isError, content) => [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }];
  const records = [
    user('a0000000-0000-4000-8000-000000000001', 1, '帮我修一下登录页的报错'),
    { ...load, ...base, uuid: 'a0000000-0000-4000-8000-000000000002', timestamp: at(2) },
    assistant('a0000000-0000-4000-8000-000000000003', 3, [toolUse('tc1', '/p/login.ts')]),
    user('a0000000-0000-4000-8000-000000000004', 4, toolResult('tc1', true, 'String to replace not found')),
    user('a0000000-0000-4000-8000-000000000005', 5, '不对，应该改 auth.ts'),
    assistant('a0000000-0000-4000-8000-000000000006', 6, [toolUse('tc2', '/p/login.ts')]),
    user('a0000000-0000-4000-8000-000000000007', 7, toolResult('tc2', false, 'ok')),
    assistant('a0000000-0000-4000-8000-000000000008', 8, [toolUse('tc3', '/p/login.ts')]),
    user('a0000000-0000-4000-8000-000000000009', 9, toolResult('tc3', false, 'ok')),
    { ...load, ...base, uuid: 'a0000000-0000-4000-8000-000000000010', timestamp: at(10) },
    assistant('a0000000-0000-4000-8000-000000000011', 11, [{ type: 'text', text: 'Done, the login page loads again.' }]),
  ];
  const dir = join(home, '.claude', 'projects', '-tmp-probe');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

async function bobWithHistory(service) {
  const { alice, bob } = setupPeople(service);
  await alice.ok('wallet', 'create');
  await alice.mint(probeDraft);
  await bob.ok('wallet', 'create');
  await bob.ok('skill', 'fetch', probeFp, '--confirm');
  writeRoughSession(bob.home);
  return bob;
}

test('"判断 Skill 调用的结果": preview, one batched run of the local harness, stored and never redone, then reported as buckets', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const bob = await bobWithHistory(service);
    const harness = installFakeHarness(bob);

    const preview = await bob.ok('usage', 'judge');
    assert.equal(preview.preview, true);
    assert.deepEqual({ harness: preview.harness, invocations: preview.invocations, runs: preview.runs }, { harness: 'codex', invocations: 2, runs: 1 });
    assert.match(preview.reads, /without tools, without Skills, and without saving a session/);
    assert.match(preview.stays, /stay on this computer/);
    assert.match(preview.next, /Only after they confirm, run `obelisk usage judge --confirm`/);
    assert.deepEqual(harness.runs(), [], 'a preview runs nothing');

    const judged = await bob.ok('usage', 'judge', '--confirm');
    assert.equal(judged.status, 'judged');
    assert.equal(judged.judged, 2);
    assert.deepEqual(judged.results.map(({ outcome, scenes }) => ({ outcome, scenes })), [
      { outcome: 'rework', scenes: ['v1:task/debug'] },
      { outcome: 'rework', scenes: ['v1:task/debug'] },
    ], 'a scene outside the vocabulary is dropped');
    const [run] = harness.runs();
    assert.equal(run.tool, 'codex', 'Codex is preferred when both are installed');
    for (const flag of ['--ephemeral', '--ignore-user-config']) assert.ok(run.argv.includes(flag), flag);
    assert.deepEqual(run.schema.required, ['judgments'], 'the answer shape is given to Codex as a schema file');
    assert.equal(run.cwd.endsWith(join('.obelisk', 'judge')), true, 'the judge starts in the data directory, away from projects');
    const prompt = harness.prompt();
    assert.match(prompt, /\[user, before the Skill\] 帮我修一下登录页的报错/);
    assert.match(prompt, /← tool error: String to replace not found/);
    assert.match(prompt, /\[user\] 不对，应该改 auth\.ts/);
    assert.doesNotMatch(prompt, /Base directory for this skill/, 'the Skill body itself is not sent');

    assert.equal((await bob.ok('usage', 'judge')).status, 'nothing_to_judge');
    assert.equal(harness.runs().length, 1, 'judged invocations are never judged again');

    const annotations = JSON.parse(readFileSync(join(bob.home, '.obelisk', 'usage-annotations.json'), 'utf8'));
    const records = Object.values(annotations.invocations);
    assert.deepEqual(records.map((record) => record.signals.values), [
      ['tool-error', 'user-correction', 'repeated-edit', 'repeated-invocation'],
      [],
    ]);

    const status = await bob.ok('usage', 'status');
    const [version] = status.versions;
    assert.deepEqual(version.scenes, [{ tag: 'v1:task/debug', invocations: 2 }]);
    assert.deepEqual(
      Object.fromEntries(version.outcomes.map((bucket) => [bucket.id, bucket.invocations])),
      { 'outcome/rework': 2, 'signal/tool-error': 1, 'signal/user-correction': 1, 'signal/repeated-edit': 1, 'signal/repeated-invocation': 1 },
    );
    assert.deepEqual(version.sceneOutcomes, [{ tag: 'v1:task/debug', outcome: 'rework', invocations: 2 }], 'each scene carries its own results');
    assert.equal(version.transactions, 1);

    const enabled = await bob.ok('usage', 'enable', '--confirm');
    const reported = service.usage.get(`0x${probeFp}:${enabled.wallet}`);
    assert.deepEqual(reported.scenes, { [sceneBucketKey('v1:task/debug')]: 2 });
    assert.equal(reported.outcomes[outcomeBucketKey('outcome/rework')], 2);
    assert.equal(reported.outcomes[outcomeBucketKey('signal/tool-error')], 1);
    assert.equal(reported.outcomes[sceneOutcomeBucketKey('v1:task/debug', 'rework')], 2);
  } finally {
    service.close();
  }
});

test('the judge also runs through Claude Code, and a failed run keeps nothing and can be run again', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const bob = await bobWithHistory(service);
    const harness = installFakeHarness(bob);

    harness.fail(true);
    const failed = await bob.ok('usage', 'judge', '--harness', 'claude', '--batch', '1', '--confirm');
    assert.equal(failed.status, 'partial');
    assert.match(failed.error, /claude exited with 1: usage limit reached/);
    assert.match(failed.next, /run the same command again/);
    assert.equal(harness.runs().length, 1, 'it stops at the first failed run');

    harness.fail(false);
    const judged = await bob.ok('usage', 'judge', '--harness', 'claude', '--batch', '1', '--confirm');
    assert.deepEqual({ status: judged.status, judged: judged.judged, harness: judged.harness }, { status: 'judged', judged: 2, harness: 'claude' });
    const claudeRuns = harness.runs().slice(1);
    assert.equal(claudeRuns.length, 2, 'one run per batch of one');
    for (const run of claudeRuns) {
      assert.equal(run.argv[0], '-p');
      assert.ok(run.argv.includes('--no-session-persistence'));
    }

    const bad = await bob.run('usage', 'judge', '--harness', 'gemini');
    assert.equal(bad.status, 1);
    assert.match(bad.json.error, /Usage: obelisk usage judge \[--harness codex\|claude\]/);
  } finally {
    service.close();
  }
});

test('per-scene results for many scenes are sent whole, over several reports, and never again', { skip }, async () => {
  const service = await startFakeSkillService();
  try {
    const { alice, bob } = setupPeople(service);
    await alice.ok('wallet', 'create');
    await alice.mint(probeDraft);
    await bob.ok('wallet', 'create');
    await bob.ok('skill', 'fetch', probeFp, '--confirm');

    // Twelve settled invocations, each already judged with three scenes of its own.
    const sessionId = '7d1c2e30-0000-4000-8000-00000000b002';
    const base = { sessionId, cwd: '/tmp/probe', userType: 'external', isSidechain: false };
    const uuid = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const records = Array.from({ length: 12 }, (_, n) => ({ ...load, ...base, uuid: uuid(n + 1), timestamp: `2026-10-06T10:00:${String(n + 10)}.000Z` }));
    const dir = join(bob.home, '.claude', 'projects', '-tmp-probe');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sessionId}.jsonl`), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    const tags = SCENES.slice(0, 36).map((scene) => `v1:${scene.id}`);
    const invocations = Object.fromEntries(records.map((record, n) => [record.uuid, {
      fingerprint: probeFp, sessionId,
      signals: { rulesVersion: 1, values: [], countedAt: '2026-10-07T00:00:00.000Z' },
      judgment: { outcome: n % 2 ? 'rework' : 'smooth', scenes: tags.slice(n * 3, n * 3 + 3), reason: '', harness: 'codex', promptVersion: 1, judgedAt: '2026-10-07T00:00:00.000Z' },
    }]));
    mkdirSync(join(bob.home, '.obelisk'), { recursive: true });
    writeFileSync(join(bob.home, '.obelisk', 'usage-annotations.json'), JSON.stringify({ schema: 1, invocations }));

    const preview = await bob.ok('usage', 'enable');
    const [version] = preview.versions;
    assert.deepEqual({ scenes: version.scenes.length, pairs: version.sceneOutcomes.length, transactions: version.transactions }, { scenes: 36, pairs: 36, transactions: 2 });

    const enabled = await bob.ok('usage', 'enable', '--confirm');
    const [result] = enabled.reports;
    assert.deepEqual({ status: result.status, reports: result.reports, transactions: result.transactions.length }, { status: 'reported', reports: 2, transactions: 2 });
    const reports = service.relays.filter((relay) => relay.action === 'ReportUsage');
    assert.equal(reports.length, 2);
    assert.ok(reports.every((relay) => relay.message.cumulativeInvocations === '12' && relay.message.outcomes.length <= 32 && relay.message.scenes.length <= 32));

    const onChain = service.usage.get(`0x${probeFp}:${enabled.wallet}`);
    assert.equal(Object.keys(onChain.scenes).length, 36, 'every scene arrived');
    for (const [n, tag] of tags.entries()) {
      assert.equal(onChain.outcomes[sceneOutcomeBucketKey(tag, Math.floor(n / 3) % 2 ? 'rework' : 'smooth')], 1, tag);
    }
    assert.equal(onChain.outcomes[outcomeBucketKey('outcome/smooth')], 6);

    assert.equal((await bob.ok('usage', 'report')).status, 'nothing_new');
    assert.equal(service.relays.filter((relay) => relay.action === 'ReportUsage').length, 2);
  } finally {
    service.close();
  }
});
