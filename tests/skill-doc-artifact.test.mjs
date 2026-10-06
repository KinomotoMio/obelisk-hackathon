// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findDynamicSkillContent } from '../packages/core/src/skills.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const artifact = join(repoRoot, 'dist', 'obelisk-skill');

test('build:skill produces a docs-only skill that delegates execution to the CLI', () => {
  execFileSync(npmCommand, ['run', 'build:skill'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  assert.equal(existsSync(join(artifact, 'SKILL.md')), true);
  assert.equal(existsSync(join(artifact, 'references', 'api-reference.md')), true);
  assert.equal(existsSync(join(artifact, 'package.json')), true);
  assert.equal(existsSync(join(artifact, 'scripts')), false, 'skill must not ship a second runtime');

  const skill = readFileSync(join(artifact, 'SKILL.md'), 'utf8');
  const schema = readFileSync(join(artifact, 'references', 'schema.md'), 'utf8');
  assert.match(skill, /Bash\(obelisk:\*\)/);
  assert.match(skill, /obelisk --query "\$qfile"/);
  assert.match(skill, /obelisk --attune \/tmp\/register-memory\.mjs/);
  assert.match(skill, /sandbox_permissions: "require_escalated"/);
  assert.match(skill, /Never\s+degrade to a stale, read-only index/);
  assert.doesNotMatch(skill, /\$SKILL_DIR\/scripts\/runtime\.js/);
  assert.doesNotMatch(`${skill}\n${schema}`, /scripts\//);
});

test('build:skill ships the standalone 沉淀 Skill as a docs-only skill that delegates to the CLI', () => {
  execFileSync(npmCommand, ['run', 'build:skill'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  const distill = join(repoRoot, 'dist', 'agent-skills', 'obelisk-distill');
  assert.equal(existsSync(join(distill, 'SKILL.md')), true);
  assert.equal(existsSync(join(distill, 'scripts')), false, 'skill must not ship a second runtime');
  const skill = readFileSync(join(distill, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: obelisk-distill\n/);
  assert.match(skill, /Bash\(obelisk:\*\)/);
  assert.match(skill, /obelisk skill save/);
  assert.match(skill, /obelisk skill scenes/);
  // Claude Code rewrites these on load; the skill must load exactly as written.
  assert.deepEqual(findDynamicSkillContent(skill), []);
});

test('build:skill ships the standalone wallet skill, which previews before writing on chain', () => {
  execFileSync(npmCommand, ['run', 'build:skill'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  const wallet = join(repoRoot, 'dist', 'agent-skills', 'obelisk-wallet');
  assert.equal(existsSync(join(wallet, 'scripts')), false, 'skill must not ship a second runtime');
  const skill = readFileSync(join(wallet, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: obelisk-wallet\n/);
  assert.match(skill, /帮我创建 Obelisk 钱包/);
  assert.match(skill, /Bash\(obelisk:\*\)/);
  assert.match(skill, /obelisk wallet activate --confirm/);
  assert.match(skill, /Do not add `--confirm` on your own/);
  assert.deepEqual(findDynamicSkillContent(skill), []);
});

test('build:skill ships the standalone share skill, which keeps privacy findings out of the conversation', () => {
  execFileSync(npmCommand, ['run', 'build:skill'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  const share = join(repoRoot, 'dist', 'agent-skills', 'obelisk-share');
  assert.equal(existsSync(join(share, 'scripts')), false, 'skill must not ship a second runtime');
  const skill = readFileSync(join(share, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: obelisk-share\n/);
  assert.match(skill, /分享 session/);
  assert.match(skill, /Bash\(obelisk:\*\)/);
  assert.match(skill, /obelisk share send <draft-id> --confirm/);
  assert.match(skill, /Do not add `--confirm` on your own/);
  assert.match(skill, /never print or look up the values/);
  assert.match(skill, /撤回我发给 0x… 的分享/);
  assert.match(skill, /obelisk share revoke <draft> --confirm/);
  assert.match(skill, /`unread` \| 未读/);
  assert.deepEqual(findDynamicSkillContent(skill), []);
});

test('build:skill ships the standalone Skill mint and fetch skill, which previews before writing', () => {
  execFileSync(npmCommand, ['run', 'build:skill'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: 'pipe',
  });

  const assets = join(repoRoot, 'dist', 'agent-skills', 'obelisk-skill-assets');
  assert.equal(existsSync(join(assets, 'scripts')), false, 'skill must not ship a second runtime');
  const skill = readFileSync(join(assets, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: obelisk-skill-assets\n/);
  assert.match(skill, /铸造 Skill/);
  assert.match(skill, /取用 Skill/);
  assert.match(skill, /Bash\(obelisk:\*\)/);
  assert.match(skill, /obelisk skill mint <name> --confirm <fingerprint>/);
  assert.match(skill, /obelisk skill fetch <fingerprint> --confirm/);
  assert.match(skill, /Do not add `--confirm` on your own/);
  assert.deepEqual(findDynamicSkillContent(skill), []);
});
