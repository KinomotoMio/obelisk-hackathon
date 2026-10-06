// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  parseLoadedSkill,
  recordMintedVersion,
  saveSkillDraft,
  skillBodyFromMarkdown,
  skillFingerprint,
} from '../packages/core/src/skills.ts';
import { createBuiltinProviderRegistry } from '../packages/core/src/providers/builtins.ts';
import {
  recognizeSkillInvocations,
  skillUsageFor,
  skillVersionsByFingerprint,
  summarizeSkillUsage,
} from '../packages/core/src/skill-invocations.ts';
import { runCli } from './cli-test-helpers.mjs';
import { makeTempDir } from './temp-dirs.mjs';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

const fixtures = new URL('./fixtures/', import.meta.url);
const read = (path) => readFileSync(new URL(path, fixtures), 'utf8');
const jsonLines = (path) => read(path).trim().split('\n').map((line) => JSON.parse(line));
const claudeText = (record) => record.message.content.map((block) => block.text).join('\n');
const codexText = (record) => record.payload.content.map((block) => block.text).join('\n');

const probeMd = read('claude/skills/fingerprint-probe/SKILL.md');
const longMd = read('claude/skills/long-probe/SKILL.md');
const probeFp = skillFingerprint(skillBodyFromMarkdown(probeMd));
const longFp = skillFingerprint(skillBodyFromMarkdown(longMd));
const claudeLoads = jsonLines('claude/skill-load-session.jsonl');
const [longLoad] = jsonLines('claude/long-skill-load-session.jsonl');
const codexRollout = jsonLines('codex/skill-load-rollout.jsonl');
const codexLoad = codexRollout.find((record) => record.payload?.role === 'user' && codexText(record).startsWith('<skill>'));

test('a real Codex Skill load hashes to the same fingerprint as the SKILL.md it loaded', () => {
  const loaded = parseLoadedSkill(codexText(codexLoad));
  assert.deepEqual({ format: loaded.format, name: loaded.name }, { format: 'codex', name: 'fingerprint-probe' });
  assert.equal(skillFingerprint(loaded.body), probeFp);
});

test('a real Claude Code Skill load keeps the name it was loaded under', () => {
  for (const record of claudeLoads) {
    const loaded = parseLoadedSkill(claudeText(record));
    assert.deepEqual({ format: loaded.format, name: loaded.name }, { format: 'claude', name: 'fingerprint-probe' });
    assert.equal(skillFingerprint(loaded.body), probeFp);
  }
  assert.equal(parseLoadedSkill('<skill>\n<name>x</name>\nno path or closing tag'), null);
  assert.equal(parseLoadedSkill('please load the skill'), null);
});

function writeHistory(home) {
  // Claude Code: one transcript file per captured session.
  for (const record of [...claudeLoads, longLoad]) {
    const dir = join(home, '.claude', 'projects', '-tmp-probe');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${record.sessionId}.jsonl`), `${JSON.stringify(record)}\n`);
  }
  // Codex: the captured rollout, under its own thread id.
  const id = codexRollout[0].payload.id;
  const dir = join(home, '.codex', 'sessions', '2026', '10', '07');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `rollout-2026-10-07T04-25-39-${id}.jsonl`), read('codex/skill-load-rollout.jsonl'));
}

function cli(home, args) {
  const result = runCli(args, { home });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('超过 1 万字的 Skill 通过原始记录取全文再算指纹', () => {
  const home = makeTempDir('obelisk-skill-usage-long-');
  writeHistory(home);
  cli(home, ['--build']);
  assert.ok(claudeText(longLoad).length > 10000, 'the captured load is longer than the index keeps');
  const db = new DatabaseSync(join(home, '.obelisk', 'obelisk.sqlite'), { readOnly: true });
  try {
    const indexed = db.prepare('SELECT length(text) AS n FROM messages WHERE uuid = ?').get(longLoad.uuid).n;
    assert.equal(indexed, 10000, 'the indexed copy is truncated');
    const registry = createBuiltinProviderRegistry({ claude: join(home, '.claude'), codex: join(home, '.codex') });
    const invocations = recognizeSkillInvocations(db, registry);
    const long = invocations.find((item) => item.messageUuid === longLoad.uuid);
    assert.deepEqual({ fingerprint: long.fingerprint, textFrom: long.textFrom }, { fingerprint: longFp, textFrom: 'raw' });
    assert.deepEqual(
      invocations.filter((item) => item.fingerprint === probeFp).map((item) => `${item.source}:${item.textFrom}`).sort(),
      ['claude:index', 'claude:index', 'codex:index'],
    );
  } finally {
    db.close();
  }
});

test('Skill versions map by fingerprint: minted versions and unminted drafts', async () => {
  const home = makeTempDir('obelisk-skill-usage-map-');
  const skillsDir = join(home, 'skills');
  await saveSkillDraft(skillsDir, { name: 'fingerprint-probe', description: 'probe', body: probeMd });
  const mint = { chainId: 968, skillId: '1', versionIndex: 0, author: '0x00000000000000000000000000000000000000a1', txHash: '0x01', mintedAt: '2026-10-07T00:00:00.000Z' };
  await recordMintedVersion(skillsDir, 'fingerprint-probe', { fingerprint: probeFp, mint });
  await saveSkillDraft(skillsDir, { name: 'fingerprint-probe', description: 'probe', body: `${probeMd}\nEdited after minting.` });
  await saveSkillDraft(skillsDir, { name: 'same-body', description: 'copy', body: probeMd });
  const versions = await skillVersionsByFingerprint(skillsDir);
  assert.deepEqual(
    versions.get(probeFp).map(({ name, state }) => `${name}:${state}`).sort(),
    ['fingerprint-probe:minted', 'same-body:draft'],
  );
  const invocations = [
    { messageUuid: 'm1', sessionId: 's1', source: 'claude', timestamp: '2026-10-07T01:00:00Z', agentId: null, loadedAs: 'fingerprint-probe', fingerprint: probeFp, textFrom: 'index' },
    { messageUuid: 'm2', sessionId: 's2', source: 'codex', timestamp: '2026-10-07T02:00:00Z', agentId: null, loadedAs: 'fingerprint-probe', fingerprint: probeFp, textFrom: 'index' },
    { messageUuid: 'm3', sessionId: 's2', source: 'codex', timestamp: '2026-10-07T03:00:00Z', agentId: null, loadedAs: 'other', fingerprint: 'f'.repeat(64), textFrom: 'raw' },
  ];
  const overview = summarizeSkillUsage(invocations, versions);
  const minted = overview.library.find((entry) => entry.name === 'fingerprint-probe');
  assert.deepEqual(
    { state: minted.state, skillId: minted.mint.skillId, invocations: minted.invocations, sessions: minted.sessions, lastAt: minted.lastAt },
    { state: 'minted', skillId: '1', invocations: 2, sessions: 2, lastAt: '2026-10-07T02:00:00Z' },
  );
  assert.deepEqual(overview.other.map(({ loadedAs, invocations: n }) => ({ loadedAs, n })), [{ loadedAs: ['other'], n: 1 }]);
  const detail = skillUsageFor('fingerprint-probe', invocations, versions);
  assert.equal(detail.invocations, 2);
  assert.deepEqual(detail.versions.map(({ state, invocations: n }) => `${state}:${n}`).sort(), ['draft:0', 'minted:2']);
});

test('a truncated load whose source record is gone stays visible as unresolved', () => {
  const home = makeTempDir('obelisk-skill-usage-gone-');
  writeHistory(home);
  cli(home, ['--build']);
  // The index still holds the truncated copy, but the transcript is gone (the
  // index has not been refreshed since): no fingerprint is guessed from it.
  rmSync(join(home, '.claude', 'projects', '-tmp-probe', `${longLoad.sessionId}.jsonl`));
  const db = new DatabaseSync(join(home, '.obelisk', 'obelisk.sqlite'), { readOnly: true });
  try {
    const registry = createBuiltinProviderRegistry({ claude: join(home, '.claude'), codex: join(home, '.codex') });
    const invocations = recognizeSkillInvocations(db, registry);
    const gone = invocations.find((item) => item.messageUuid === longLoad.uuid);
    assert.deepEqual(
      { fingerprint: gone.fingerprint, unresolved: gone.unresolved },
      { fingerprint: null, unresolved: 'source_unavailable' },
    );
    const overview = summarizeSkillUsage(invocations, new Map());
    assert.deepEqual(overview.unresolved, [{ messageUuid: longLoad.uuid, sessionId: longLoad.sessionId, reason: 'source_unavailable' }]);
    assert.equal(overview.other.find((entry) => entry.fingerprint === probeFp).invocations, 3);
  } finally {
    db.close();
  }
});

test('one load recorded under two index rows counts once', () => {
  const home = makeTempDir('obelisk-skill-usage-dup-');
  writeHistory(home);
  cli(home, ['--build']);
  // Real Codex histories hold some loads twice: same session, timestamp, and
  // text under a second line-numbered uuid that no longer points at the record.
  const db = new DatabaseSync(join(home, '.obelisk', 'obelisk.sqlite'));
  try {
    const row = db.prepare("SELECT * FROM messages WHERE source = 'codex' AND text LIKE '<skill>%'").get();
    const stale = row.uuid.replace(/:(\d+)$/, (_, n) => `:${String(Number(n) + 900).padStart(n.length, '0')}`);
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO messages (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...columns.map((column) => (column === 'uuid' ? stale : row[column])));
    const registry = createBuiltinProviderRegistry({ claude: join(home, '.claude'), codex: join(home, '.codex') });
    const codex = recognizeSkillInvocations(db, registry).filter((item) => item.source === 'codex');
    assert.equal(codex.length, 1);
    assert.deepEqual(codex[0].alsoRecordedAs, [stale]);
    assert.equal(codex[0].fingerprint, probeFp);
  } finally {
    db.close();
  }
});
