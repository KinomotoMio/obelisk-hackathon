// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Where the Playground keeps its simulated users and runs (#31).
//
//   <home>/config.json                 how each harness authenticates (see auth.ts)
//   <home>/codex-login/                CODEX_HOME of the one Codex sign-in all roles share
//   <home>/roles/<id>/role.json        label, wallet address
//   <home>/roles/<id>/obelisk/         the role's OBELISK_HOME (index, Skill library, wallet record)
//   <home>/roles/<id>/claude/          the role's CLAUDE_CONFIG_DIR (sessions, skills)
//   <home>/roles/<id>/codex/           the role's CODEX_HOME (sessions, skills)
//   <home>/roles/<id>/workspace/       the harness's working directory
//   <home>/roles/<id>/bin/obelisk      recording shim, first on the harness's PATH
//   <home>/runs/<run id>/              provenance.json, events.jsonl, steps/<step id>/…
//
// The default home is ~/.obelisk-hackathon/playground, next to the hackathon
// environment (scripts/hackathon-env.sh); OBELISK_PLAYGROUND_HOME moves it.

import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function playgroundHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['OBELISK_PLAYGROUND_HOME']?.trim();
  if (!raw) return join(homedir(), '.obelisk-hackathon', 'playground');
  const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw;
  if (!isAbsolute(expanded)) throw new Error(`OBELISK_PLAYGROUND_HOME must be an absolute path: ${raw}`);
  return expanded;
}

export interface RolePaths {
  root: string;
  record: string;
  obeliskHome: string;
  claudeDir: string;
  codexDir: string;
  workspace: string;
  bin: string;
}

const ROLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export function rolePaths(home: string, id: string): RolePaths {
  if (!ROLE_ID.test(id)) throw new Error(`Role id must be 1-32 letters, digits, - or _: ${id}`);
  const root = join(home, 'roles', id);
  return {
    root,
    record: join(root, 'role.json'),
    obeliskHome: join(root, 'obelisk'),
    claudeDir: join(root, 'claude'),
    codexDir: join(root, 'codex'),
    workspace: join(root, 'workspace'),
    bin: join(root, 'bin'),
  };
}

/** The obelisk CLI the roles run: OBELISK_PLAYGROUND_CLI, else this checkout's build. */
export function obeliskCliEntry(env: NodeJS.ProcessEnv = process.env): string {
  return env['OBELISK_PLAYGROUND_CLI']?.trim() || join(repoRoot, 'packages', 'cli', 'dist', 'cli', 'src', 'obelisk.js');
}

/** Built skills to install into each role: OBELISK_PLAYGROUND_SKILLS, else this checkout's staged skill repo. */
export function skillsSource(env: NodeJS.ProcessEnv = process.env): string {
  return env['OBELISK_PLAYGROUND_SKILLS']?.trim() || join(repoRoot, 'dist', 'obelisk-skill-repo', 'skills');
}
