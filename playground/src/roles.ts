// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Simulated users (#31, G1). Each role is a directory with its own Obelisk
// data (OBELISK_HOME, so its own index, Skill library and wallet key), its own
// Claude Code and Codex homes (so its sessions never land in the owner's
// history), a workspace to run in, and a bin/obelisk shim that records every
// obelisk call it makes.
//
// The role's Obelisk settings point every provider at the role's own
// directories (#30: OBELISK_HOME alone still indexes the real ~/.codex), so
// its index only ever sees its own sessions.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureCodexFileStore } from './auth.ts';
import { obeliskCliEntry, repoRoot, rolePaths, skillsSource, type RolePaths } from './home.ts';
import type { ScenarioRole } from './scenario.ts';

export interface RoleRecordFile {
  id: string;
  label: string;
  address: string | null;
  preparedAt: string;
}

/** Providers Obelisk can index; every one gets a root inside the role. */
export const PROVIDER_IDS = ['claude', 'codex', 'deepseek', 'kimi', 'omp', 'pi'] as const;

const PASSTHROUGH_ENV = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TMPDIR', 'NODE_EXTRA_CA_CERTS', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'];

export function providerRoots(role: RolePaths): Record<string, string> {
  const none = join(role.root, 'none');
  return Object.fromEntries(PROVIDER_IDS.map((id) => [
    id,
    id === 'claude' ? role.claudeDir : id === 'codex' ? role.codexDir : join(none, id),
  ]));
}

/**
 * The environment a role's harness and obelisk run in. It starts from a short
 * allowlist rather than the runner's own environment, so nothing from the
 * shell that started the runner (an outer Claude Code session's markers, a
 * DSH_HOME, the owner's OBELISK_HOME) leaks into the simulated user.
 */
export function roleEnv(
  role: RolePaths,
  { id, cli, serviceUrl = null, commandLog = null, base = process.env }:
  { id: string; cli: string; serviceUrl?: string | null; commandLog?: string | null; base?: NodeJS.ProcessEnv },
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) if (base[key]) env[key] = base[key] as string;
  env['PATH'] = [role.bin, base['PATH'] ?? '/usr/bin:/bin'].join(':');
  env['OBELISK_HOME'] = role.obeliskHome;
  env['CLAUDE_CONFIG_DIR'] = role.claudeDir;
  // Keeps the role's Claude Code sessions under projects/workspace instead of
  // a name derived from the absolute workspace path.
  env['CLAUDE_CODE_PROJECT_DIR_NAME'] = 'workspace';
  env['CODEX_HOME'] = role.codexDir;
  env['OBELISK_PLAYGROUND_ROLE'] = id;
  env['OBELISK_PLAYGROUND_CLI'] = cli;
  if (commandLog) env['OBELISK_PLAYGROUND_COMMAND_LOG'] = commandLog;
  if (serviceUrl) env['OBELISK_SERVICE_URL'] = serviceUrl;
  return env;
}

function writeShim(role: RolePaths) {
  mkdirSync(role.bin, { recursive: true });
  const recorder = join(repoRoot, 'playground', 'src', 'record-command.ts');
  const shim = join(role.bin, 'obelisk');
  writeFileSync(shim, [
    '#!/bin/sh',
    '# Obelisk Playground: records this call for the run\'s provenance, then runs the real obelisk.',
    `exec node --disable-warning=ExperimentalWarning '${recorder.replace(/'/g, `'\\''`)}' "$@"`,
    '',
  ].join('\n'));
  chmodSync(shim, 0o755);
}

function writeSettings(role: RolePaths) {
  mkdirSync(role.obeliskHome, { recursive: true });
  const file = join(role.obeliskHome, 'settings.json');
  const current = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
  writeFileSync(file, `${JSON.stringify({ ...current, providerRoots: providerRoots(role) }, null, 2)}\n`);
}

/** Copy built skills into the role's Claude Code and Codex skill directories. */
export function installSkills(role: RolePaths, wanted: string[] | null, source = skillsSource()): string[] {
  if (!existsSync(source)) throw new Error(`No built skills at ${source}; run \`npm run build:skill && bash packaging/stage-skill-repo.sh dist/obelisk-skill-repo\` first, or set OBELISK_PLAYGROUND_SKILLS.`);
  const available = readdirSync(source, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const names = wanted ?? available;
  const missing = names.filter((name) => !available.includes(name));
  if (missing.length) throw new Error(`Skills not found in ${source}: ${missing.join(', ')}`);
  for (const dir of [join(role.claudeDir, 'skills'), join(role.codexDir, 'skills')]) {
    for (const name of names) {
      rmSync(join(dir, name), { recursive: true, force: true });
      cpSync(join(source, name), join(dir, name), { recursive: true });
    }
  }
  return names;
}

export function readRole(home: string, id: string): RoleRecordFile | null {
  const file = rolePaths(home, id).record;
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as RoleRecordFile : null;
}

/**
 * Create or refresh a role: directories, Obelisk settings, shim, skills, and a
 * wallet (`obelisk wallet create`, which keeps an existing one). Safe to rerun.
 */
export function prepareRole(
  home: string,
  role: ScenarioRole,
  { cli = obeliskCliEntry(), skills = skillsSource(), now = () => new Date() }: { cli?: string; skills?: string; now?: () => Date } = {},
): RoleRecordFile & { skills: string[] } {
  const paths = rolePaths(home, role.id);
  for (const dir of [paths.obeliskHome, paths.claudeDir, paths.codexDir, paths.workspace]) mkdirSync(dir, { recursive: true });
  writeSettings(paths);
  ensureCodexFileStore(paths.codexDir);
  writeShim(paths);
  const installed = installSkills(paths, role.skills, skills);

  const env = roleEnv(paths, { id: role.id, cli });
  const [command, args] = /\.(?:c|m)?[jt]s$/.test(cli)
    ? [process.execPath, ['--disable-warning=ExperimentalWarning', cli, 'wallet', 'create']]
    : [cli, ['wallet', 'create']];
  const result = spawnSync(command, args, { cwd: paths.workspace, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`obelisk wallet create failed for role ${role.id}: ${(result.stderr || result.stdout || '').trim().split('\n')[0]}`);
  }
  const address = (JSON.parse(result.stdout) as { address?: string }).address ?? null;
  const record: RoleRecordFile = { id: role.id, label: role.label, address, preparedAt: now().toISOString() };
  writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`);
  return { ...record, skills: installed };
}

/** `export …` lines that switch a shell into a role (G1 one-click switch). */
export function roleShellExports(home: string, id: string, cli = obeliskCliEntry()): string {
  const paths = rolePaths(home, id);
  const env = roleEnv(paths, { id, cli, base: { PATH: '$PATH' } });
  const quote = (v: string) => (v === `${paths.bin}:$PATH` ? `"${v.replace(/"/g, '\\"')}"` : `'${v.replace(/'/g, `'\\''`)}'`);
  return Object.entries(env)
    .filter(([key]) => key !== 'OBELISK_PLAYGROUND_COMMAND_LOG')
    .map(([key, value]) => `export ${key}=${quote(value)}`)
    .join('\n');
}
