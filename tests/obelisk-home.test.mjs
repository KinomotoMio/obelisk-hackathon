// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveObeliskPaths } from '../packages/core/src/paths.ts';
import { runCli } from './cli-test-helpers.mjs';
import { makeTempDir } from './temp-dirs.mjs';

test('without OBELISK_HOME the data directory stays ~/.obelisk', () => {
  const paths = resolveObeliskPaths({ env: {}, homeDir: '/home/alice' });
  assert.equal(paths.layout, 'legacy');
  assert.equal(paths.dataDir, join('/home/alice', '.obelisk'));
  assert.equal(paths.dbPath, join('/home/alice', '.obelisk', 'obelisk.sqlite'));
  assert.equal(paths.settingsPath, join('/home/alice', '.obelisk', 'settings.json'));
  assert.equal(paths.recapDir, join('/home/alice', '.obelisk', 'recap'));
});

test('OBELISK_HOME moves the database, settings, and recaps together', () => {
  const root = join('/srv', 'roles', 'alice');
  const paths = resolveObeliskPaths({ env: { OBELISK_HOME: root }, homeDir: '/home/alice' });
  assert.equal(paths.layout, 'custom');
  assert.equal(paths.dataDir, root);
  assert.equal(paths.configDir, root);
  assert.equal(paths.dbPath, join(root, 'obelisk.sqlite'));
  assert.equal(paths.settingsPath, join(root, 'settings.json'));
  assert.equal(paths.recapDir, join(root, 'recap'));
});

test('OBELISK_HOME expands a leading ~ and ignores a blank value', () => {
  assert.equal(
    resolveObeliskPaths({ env: { OBELISK_HOME: '~/roles/bob' }, homeDir: '/home/bob' }).dataDir,
    join('/home/bob', 'roles', 'bob'),
  );
  assert.equal(
    resolveObeliskPaths({ env: { OBELISK_HOME: '   ' }, homeDir: '/home/bob' }).layout,
    'legacy',
  );
});

test('a relative OBELISK_HOME is rejected instead of depending on the cwd', () => {
  assert.throws(
    () => resolveObeliskPaths({ env: { OBELISK_HOME: 'roles/carol' }, homeDir: '/home/carol' }),
    /OBELISK_HOME must be an absolute path or begin with ~/,
  );
});

function writeTranscript(claudeDir, uuid, text) {
  const projectDir = join(claudeDir, 'projects', `-tmp-${uuid}`);
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${uuid}.jsonl`), `${JSON.stringify({
    uuid,
    type: 'user',
    timestamp: '2026-10-07T08:00:00.000Z',
    cwd: `/tmp/${uuid}`,
    sessionId: uuid,
    message: { role: 'user', content: text },
  })}\n`);
}

test('two data directories keep their indexes and memories apart under the CLI', () => {
  const home = makeTempDir('obelisk-home-cli-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  // A real legacy index must not leak into an isolated data directory.
  writeFileSync(join(home, '.claude', 'obelisk.sqlite'), '');

  const roles = ['alice', 'bob'].map((name) => {
    const dataDir = join(home, 'roles', name, 'obelisk');
    const claudeDir = join(home, 'roles', name, 'claude');
    writeTranscript(claudeDir, `${name}-session`, `${name} private evidence`);
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ providerRoots: { claude: claudeDir } }));
    return { name, dataDir, env: { OBELISK_HOME: dataDir } };
  });

  for (const role of roles) {
    const built = runCli(['--build'], { home, env: role.env });
    assert.equal(built.status, 0, built.stderr || built.stdout);
    assert.equal(JSON.parse(built.stdout).db, join(role.dataDir, 'obelisk.sqlite'));
  }
  assert.equal(existsSync(join(home, '.obelisk')), false, 'default ~/.obelisk must stay untouched');

  const [alice, bob] = roles;
  const memoryPath = join(home, 'alice-memory.md');
  const attunePath = join(home, 'attune.mjs');
  writeFileSync(memoryPath, '# Alice memory\n');
  writeFileSync(attunePath, `return remember({ path: ${JSON.stringify(memoryPath)}, project: 'alice', summary: 'Decision: alice keeps her own memory.' });`);
  const remembered = runCli(['--attune', attunePath], { home, env: alice.env });
  assert.equal(remembered.status, 0, remembered.stderr || remembered.stdout);

  const queryPath = join(home, 'query.mjs');
  writeFileSync(queryPath, `
    return {
      alice: search('alice private evidence', { limit: 5 }).length,
      bob: search('bob private evidence', { limit: 5 }).length,
      memories: sql('SELECT COUNT(*) AS n FROM memories')[0].n,
    };
  `);
  const seenByAlice = runCli(['--query', queryPath], { home, env: alice.env });
  const seenByBob = runCli(['--query', queryPath], { home, env: bob.env });
  assert.equal(seenByAlice.status, 0, seenByAlice.stderr || seenByAlice.stdout);
  assert.equal(seenByBob.status, 0, seenByBob.stderr || seenByBob.stdout);
  const a = JSON.parse(seenByAlice.stdout);
  const b = JSON.parse(seenByBob.stdout);
  assert.ok(a.alice > 0 && a.bob === 0, `alice sees only her history: ${seenByAlice.stdout}`);
  assert.ok(b.bob > 0 && b.alice === 0, `bob sees only his history: ${seenByBob.stdout}`);
  assert.equal(a.memories, 1);
  assert.equal(b.memories, 0);
  assert.equal(readFileSync(join(home, '.claude', 'obelisk.sqlite'), 'utf8'), '');
});

test('a relative OBELISK_HOME fails the CLI with the cause', () => {
  const home = makeTempDir('obelisk-home-relative-');
  const result = runCli(['--build'], { home, env: { OBELISK_HOME: 'relative/dir' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /OBELISK_HOME must be an absolute path or begin with ~/);
});
