// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { TX, makeFixture, memoryStore } from './playground-fakes.mjs';
import { harnessAuthEnv, KEYCHAIN_SERVICE, storeSecret, writeConfig } from '../playground/src/auth.ts';
import { main, readHidden } from '../playground/src/cli.ts';
import { rolePaths } from '../playground/src/home.ts';
import { validateEvent, validateProvenance } from '../playground/src/provenance.ts';
import { prepareRole, roleShellExports } from '../playground/src/roles.ts';
import { runScenario } from '../playground/src/runner.ts';
import { loadScenario, parseScenario } from '../playground/src/scenario.ts';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readEvents = (runDir) => readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

function setup(scenario) {
  const fx = makeFixture();
  const file = fx.scenarioFile(scenario);
  const loaded = loadScenario(file);
  for (const role of loaded.scenario.roles) prepareRole(fx.home, role, { cli: fx.cli, skills: fx.skills });
  return { fx, loaded };
}

const twoRoles = {
  name: 'two', title: '两个角色', network: { serviceUrl: null, chainId: 968 },
  roles: [
    { id: 'A', label: '作者 A', harness: 'claude-code', skills: ['obelisk', 'obelisk-distill'] },
    { id: 'B', label: '用户 B', harness: 'codex' },
  ],
  steps: [
    { id: 'a-mint', role: 'A', title: 'A 铸造', prompt: '/obelisk-distill 沉淀并铸造', model: 'sonnet', maxTurns: 4, fake: { commands: [['skill', 'mint', 'ai-resume']] } },
    { id: 'a-list', role: 'A', title: 'A 看 Skill 库', cli: ['skill', 'list'] },
    { id: 'b-use', role: 'B', title: 'B 使用', prompt: '用这个 Skill', prompts: { codex: '$obelisk 用这个 Skill' }, fake: { commands: [['skill', 'scenes']] } },
  ],
};

test('preparing a role gives it its own data, harness homes, provider roots, shim, skills and wallet', () => {
  const { fx } = setup(twoRoles);
  const a = rolePaths(fx.home, 'A');
  const b = rolePaths(fx.home, 'B');
  const roots = readJson(join(a.obeliskHome, 'settings.json')).providerRoots;
  assert.equal(roots.claude, a.claudeDir);
  assert.equal(roots.codex, a.codexDir);
  for (const id of ['deepseek', 'kimi', 'omp', 'pi']) assert.ok(roots[id].startsWith(join(a.root, 'none')), `${id} points inside the role`);
  assert.ok(statSync(join(a.bin, 'obelisk')).mode & 0o100, 'shim is executable');
  assert.deepEqual(readdirSync(join(a.claudeDir, 'skills')).sort(), ['obelisk', 'obelisk-distill']);
  assert.deepEqual(readdirSync(join(a.codexDir, 'skills')).sort(), ['obelisk', 'obelisk-distill']);
  assert.deepEqual(readdirSync(join(b.claudeDir, 'skills')).sort(), ['obelisk', 'obelisk-distill', 'obelisk-wallet'], 'no list installs every built skill');
  const [ra, rb] = [readJson(a.record), readJson(b.record)];
  assert.match(ra.address, /^0x[0-9a-f]{40}$/);
  assert.notEqual(ra.address, rb.address, 'each role has its own wallet');
  assert.match(roleShellExports(fx.home, 'A', fx.cli), /export OBELISK_HOME='.*\/roles\/A\/obelisk'\nexport CLAUDE_CONFIG_DIR=/);
});

test('the shim passes obelisk output through and records transactions and artifacts, not the output', () => {
  const { fx } = setup(twoRoles);
  const a = rolePaths(fx.home, 'A');
  const log = join(fx.root, 'commands.jsonl');
  const run = spawnSync(join(a.bin, 'obelisk'), ['skill', 'mint', 'ai-resume'], {
    encoding: 'utf8', env: { PATH: process.env.PATH, OBELISK_PLAYGROUND_CLI: fx.cli, OBELISK_PLAYGROUND_COMMAND_LOG: log, OBELISK_HOME: a.obeliskHome },
  });
  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).skillId, '7');
  const [entry] = readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(entry.argv, ['skill', 'mint', 'ai-resume']);
  assert.deepEqual(entry.transactions, [{ hash: TX, explorerUrl: `https://explorer.test/tx/${TX}`, chainId: null }]);
  assert.deepEqual(entry.artifacts, [{ kind: 'skill-mint', ref: '7' }]);
  assert.equal(entry.output, undefined);
});

test('a dry run walks every step with the fake harness and writes a valid record and event stream', async () => {
  const { fx, loaded } = setup(twoRoles);
  const { runDir, provenance } = await runScenario(loaded, { home: fx.home, dryRun: true, cli: fx.cli, store: memoryStore() });
  assert.deepEqual(validateProvenance(readJson(join(runDir, 'provenance.json'))), []);
  assert.equal(provenance.run.status, 'succeeded');
  assert.equal(provenance.run.dryRun, true);
  assert.deepEqual(provenance.steps.map((s) => s.status), ['succeeded', 'succeeded', 'succeeded']);
  const mint = provenance.steps[0];
  assert.equal(mint.harness.kind, 'fake');
  assert.equal(mint.sessions.length, 1);
  assert.deepEqual(mint.transactions, [{ hash: TX, chainId: 968, explorerUrl: `https://explorer.test/tx/${TX}`, command: 'skill mint' }]);
  assert.deepEqual(provenance.steps[1].commands.map((c) => c.argv), [['skill', 'list']]);
  assert.deepEqual(provenance.totals, { roles: 2, steps: 3, sessions: 2, commands: 3, transactions: 1, screenshots: 0 });
  // The fake session landed in the role's own Claude home, not anywhere shared.
  const a = rolePaths(fx.home, 'A');
  assert.ok(existsSync(join(a.claudeDir, 'projects', 'workspace', `${mint.sessions[0].id}.jsonl`)));
  const events = readEvents(runDir);
  events.forEach((event, i) => { assert.deepEqual(validateEvent(event), []); assert.equal(event.seq, i + 1); });
  assert.deepEqual(events.map((e) => e.type).filter((t) => t !== 'command' && t !== 'artifact'), [
    'run.started', 'step.started', 'session', 'transaction', 'step.finished',
    'step.started', 'step.finished', 'step.started', 'session', 'step.finished', 'run.finished',
  ]);
});

test('the first failing step stops the run and the rest are skipped', async () => {
  const { fx, loaded } = setup({
    ...twoRoles,
    steps: [
      { id: 'bad', role: 'A', title: '失败', cli: ['nonsense'] },
      { id: 'never', role: 'B', title: '不会运行', cli: ['skill', 'list'] },
    ],
  });
  const { runDir, provenance } = await runScenario(loaded, { home: fx.home, dryRun: true, cli: fx.cli, store: memoryStore() });
  assert.deepEqual(validateProvenance(readJson(join(runDir, 'provenance.json'))), []);
  assert.equal(provenance.run.status, 'failed');
  assert.deepEqual(provenance.steps.map((s) => s.status), ['failed', 'skipped']);
  assert.equal(provenance.steps[0].error, 'obelisk nonsense exited with 3');
  assert.equal(provenance.steps[0].commands[0].exitCode, 3);
});

test('Claude Code runs in the role with a keychain token, a turn limit and a clean environment', async () => {
  const { fx, loaded } = setup({ ...twoRoles, steps: [twoRoles.steps[0]] });
  writeConfig(fx.home, { auth: { 'claude-code': { mode: 'keychain', secret: 'claude-oauth-token' } } });
  const store = memoryStore({ [`${KEYCHAIN_SERVICE}/claude-oauth-token`]: 'tok-123' });
  process.env.CLAUDECODE = '1';
  try {
    const { provenance } = await runScenario(loaded, { home: fx.home, cli: fx.cli, store, bins: { 'claude-code': fx.claude } });
    const seen = readJson(join(fx.seen, 'claude.json'));
    const a = rolePaths(fx.home, 'A');
    assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, 'tok-123');
    assert.equal(seen.env.CLAUDE_CONFIG_DIR, a.claudeDir);
    assert.equal(seen.env.OBELISK_HOME, a.obeliskHome);
    assert.equal(seen.env.CLAUDE_CODE_PROJECT_DIR_NAME, 'workspace');
    assert.equal(seen.env.CLAUDECODE, null, 'outer session markers do not leak in');
    assert.equal(seen.cwd, realpathSync(a.workspace));
    assert.deepEqual(seen.argv.slice(0, 2), ['-p', '/obelisk-distill 沉淀并铸造']);
    assert.equal(seen.argv[seen.argv.indexOf('--max-turns') + 1], '4');
    assert.equal(seen.argv[seen.argv.indexOf('--model') + 1], 'sonnet');
    const step = provenance.steps[0];
    assert.equal(step.status, 'succeeded');
    assert.deepEqual(step.harness, { kind: 'claude-code', version: '9.9.9 (claude)', model: 'claude-test-model', maxTurns: 4 });
    assert.deepEqual(step.sessions, [{ source: 'claude', id: 'sess-claude-1', obeliskId: 'sess-claude-1' }]);
    assert.equal(step.transactions[0].hash, TX);
    assert.equal(JSON.stringify(provenance).includes('tok-123'), false, 'the token never reaches the record');
  } finally {
    delete process.env.CLAUDECODE;
  }
});

test('Codex runs in the role with a shared auth file linked in and its own wording', async () => {
  const { fx, loaded } = setup({ ...twoRoles, steps: [twoRoles.steps[2]] });
  const shared = join(fx.root, 'codex-auth.json');
  writeFileSync(shared, '{}');
  writeConfig(fx.home, { auth: { codex: { mode: 'role-file', source: shared } } });
  const { provenance } = await runScenario(loaded, { home: fx.home, cli: fx.cli, store: memoryStore(), bins: { codex: fx.codex } });
  const b = rolePaths(fx.home, 'B');
  assert.equal(readlinkSync(join(b.codexDir, 'auth.json')), shared);
  const seen = readJson(join(fx.seen, 'codex.json'));
  assert.equal(seen.env.CODEX_HOME, b.codexDir);
  assert.equal(seen.env.CODEX_API_KEY, null);
  assert.equal(seen.argv[0], 'exec');
  assert.equal(seen.argv[seen.argv.indexOf('--add-dir') + 1], b.obeliskHome);
  assert.equal(seen.argv.at(-1), '$obelisk 用这个 Skill');
  const step = provenance.steps[0];
  assert.equal(step.status, 'succeeded');
  assert.deepEqual(step.sessions, [{ source: 'codex', id: 'thread-codex-1', obeliskId: 'codex:thread-codex-1' }]);
  assert.equal(step.harness.maxTurns, null, 'codex exec has no turn limit; the timeout bounds it');
});

test('a run without sign-in configured stops before starting anything', async () => {
  const { fx, loaded } = setup(twoRoles);
  await assert.rejects(runScenario(loaded, { home: fx.home, cli: fx.cli, store: memoryStore() }), /No sign-in is configured for claude-code/);
  writeConfig(fx.home, { auth: { 'claude-code': { mode: 'keychain', secret: 'claude-oauth-token' }, codex: { mode: 'role-login' } } });
  await assert.rejects(runScenario(loaded, { home: fx.home, cli: fx.cli, store: memoryStore() }), /claude-oauth-token is not in the test store yet/);
  assert.equal(existsSync(join(fx.home, 'runs')), false);
});

test('auth: secrets are stored once, read hidden, and modes are checked per harness', async () => {
  const store = memoryStore();
  await storeSecret(store, 'codex-api-key', '  sk-test \n');
  assert.equal(store.entries.get(`${KEYCHAIN_SERVICE}/codex-api-key`), 'sk-test');
  await assert.rejects(storeSecret(store, 'codex-api-key', 'again'), /already has codex-api-key/);
  await assert.rejects(storeSecret(store, 'claude-oauth-token', '   '), /Nothing was entered/);
  assert.equal(await readHidden('', Readable.from(['tok-from-pipe\n'])), 'tok-from-pipe');
  const fx = makeFixture();
  const role = rolePaths(fx.home, 'A');
  await assert.rejects(harnessAuthEnv('claude-code', role, { auth: { 'claude-code': { mode: 'role-file', source: null } } }, store), /Codex only/);
  await assert.rejects(harnessAuthEnv('codex', role, { auth: { codex: { mode: 'keychain', secret: 'claude-oauth-token' } } }, store), /is for claude-code, not codex/);
  assert.deepEqual(await harnessAuthEnv('codex', role, { auth: { codex: { mode: 'keychain', secret: 'codex-api-key' } } }, store), { CODEX_API_KEY: 'sk-test' });
  await assert.rejects(harnessAuthEnv('codex', role, { auth: { codex: { mode: 'role-file', source: null } } }, store), /codex login/);
  assert.equal(lstatSync(fx.root).isDirectory(), true);
});

test('scenario files are checked before anything runs', () => {
  assert.throws(() => parseScenario({ schema: 'x', name: 'n', roles: [], steps: [] }), (error) => {
    assert.match(error.message, /schema must be obelisk\.playground\.scenario\/1/);
    assert.match(error.message, /roles must be a non-empty array/);
    return true;
  });
  assert.throws(() => parseScenario({
    schema: 'obelisk.playground.scenario/1', name: 'n',
    roles: [{ id: 'A', harness: 'cursor' }],
    steps: [{ id: 's', role: 'Z', prompt: 'p', cli: ['x'] }],
  }), (error) => {
    assert.match(error.message, /roles\[0\]\.harness must be one of claude-code, codex/);
    assert.match(error.message, /steps\[0\]\.role must name a role/);
    assert.match(error.message, /needs exactly one of prompt/);
    return true;
  });
  const smoke = loadScenario(join(import.meta.dirname, '..', 'playground', 'scenarios', 'smoke.json'));
  assert.deepEqual(smoke.scenario.roles.map((r) => r.harness), ['claude-code', 'codex']);
});

test('codex-login prepares one shared Codex sign-in and prints the command for the owner', async () => {
  const fx = makeFixture();
  const lines = [];
  const code = await main(['auth', 'codex-login'], { env: { OBELISK_PLAYGROUND_HOME: fx.home }, store: memoryStore(), print: (line) => lines.push(line) });
  assert.equal(code, 0);
  const out = JSON.parse(lines.join('\n'));
  const dir = join(fx.home, 'codex-login');
  assert.equal(out.signedIn, false);
  assert.equal(out.run, `CODEX_HOME=${dir} codex login`);
  assert.match(readFileSync(join(dir, 'config.toml'), 'utf8'), /^cli_auth_credentials_store = "file"$/m);
  assert.deepEqual(readJson(join(fx.home, 'config.json')).auth.codex, { mode: 'role-file', source: join(dir, 'auth.json') });
});

test('a Codex step fails when its auth.json link was replaced during the run', async () => {
  const { fx, loaded } = setup({ ...twoRoles, steps: [twoRoles.steps[2]] });
  const shared = join(fx.root, 'codex-auth.json');
  writeFileSync(shared, '{}');
  writeConfig(fx.home, { auth: { codex: { mode: 'role-file', source: shared } } });
  const b = rolePaths(fx.home, 'B');
  // A codex that swaps the link for a regular file, as an atomic rewrite would.
  const swapping = join(fx.root, 'bin', 'codex-swap');
  writeFileSync(swapping, `#!/bin/sh\n[ "$1" = --version ] && { echo x; exit 0; }\nrm "$CODEX_HOME/auth.json"; echo '{}' > "$CODEX_HOME/auth.json"\necho '{"type":"thread.started","thread_id":"t"}'\n`, { mode: 0o755 });
  const { provenance } = await runScenario(loaded, { home: fx.home, cli: fx.cli, store: memoryStore(), bins: { codex: swapping } });
  assert.equal(provenance.steps[0].status, 'failed');
  assert.match(provenance.steps[0].error, /no longer a link to the shared sign-in/);
  assert.equal(lstatSync(join(b.codexDir, 'auth.json')).isSymbolicLink(), false);
});
