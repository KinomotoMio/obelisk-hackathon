// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(repoRoot, 'skill-doc');
const target = resolve(repoRoot, 'dist/obelisk-skill');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(resolve(source, 'SKILL.md'), resolve(target, 'SKILL.md'));
cpSync(resolve(source, 'references'), resolve(target, 'references'), { recursive: true });
cpSync(resolve(repoRoot, 'packaging/skill-package.json'), resolve(target, 'package.json'));

// Standalone skills (agent-skills/<name>/) are docs-only too and ship next to
// the obelisk skill, one directory each, so the same skills repository installs
// them under skills/<name>/.
const standaloneSource = resolve(repoRoot, 'agent-skills');
const standaloneTarget = resolve(repoRoot, 'dist/agent-skills');
rmSync(standaloneTarget, { recursive: true, force: true });
if (existsSync(standaloneSource)) {
  for (const entry of readdirSync(standaloneSource, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!existsSync(resolve(standaloneSource, entry.name, 'SKILL.md'))) continue;
    cpSync(resolve(standaloneSource, entry.name), resolve(standaloneTarget, entry.name), { recursive: true });
  }
}
