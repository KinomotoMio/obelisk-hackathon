// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// How each role's harness signs in. A role runs its harness with its own
// CLAUDE_CONFIG_DIR / CODEX_HOME so its sessions stay out of the owner's
// history, and both CLIs keep credentials per config directory, so a role
// starts signed out. <home>/config.json picks one of these per harness:
//
//   { "mode": "keychain", "secret": "claude-oauth-token" }
//       A token or API key the owner stored once with `playground auth set`
//       (hidden input) in the system keychain, service "obelisk-playground".
//       The runner passes it to the harness as an environment variable:
//       claude-oauth-token → CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`),
//       anthropic-api-key → ANTHROPIC_API_KEY, codex-api-key → CODEX_API_KEY.
//   { "mode": "role-file", "source": "/abs/path/auth.json" }      (Codex)
//       Each role's CODEX_HOME/auth.json is a symlink to one auth file the
//       owner created for the Playground (`playground auth codex-login` sets
//       this up and prints the login command); with "source": null each role
//       must already have its own auth.json (signed in per role). Codex
//       refreshes tokens by truncating and rewriting auth.json in place, which
//       writes through the link, and the runner checks the link after every
//       Codex step. Roles run one at a time, so refreshes never race.
//   { "mode": "role-login" }
//       Nothing is injected; the owner signed in once per role directory.
//
// This module never reads, copies or prints the owner's own credentials
// (~/.claude, ~/.codex/auth.json, their keychain entries); it only reads
// entries it stored itself, and only to hand them to the harness.

import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import type { SecretStore } from '../../packages/core/src/keychain.ts';
import type { RolePaths } from './home.ts';
import type { RealHarness } from './scenario.ts';

export const KEYCHAIN_SERVICE = 'obelisk-playground';

export const SECRETS = {
  'claude-oauth-token': { harness: 'claude-code', env: 'CLAUDE_CODE_OAUTH_TOKEN', how: 'run `claude setup-token` and paste the token it prints' },
  'anthropic-api-key': { harness: 'claude-code', env: 'ANTHROPIC_API_KEY', how: 'paste an Anthropic API key' },
  'codex-api-key': { harness: 'codex', env: 'CODEX_API_KEY', how: 'paste an OpenAI API key' },
} as const;
export type SecretName = keyof typeof SECRETS;

export type AuthMode =
  | { mode: 'keychain'; secret: SecretName }
  | { mode: 'role-file'; source: string | null }
  | { mode: 'role-login' };

export interface PlaygroundConfig {
  auth: Partial<Record<RealHarness, AuthMode>>;
}

export const configPath = (home: string) => join(home, 'config.json');

/** The CODEX_HOME the owner signs in to once for the Playground; roles link to its auth.json. */
export const codexLoginDir = (home: string) => join(home, 'codex-login');

// Codex may keep its sign-in in the OS keyring instead of auth.json; the
// keyring entry is per CODEX_HOME, so sharing one sign-in needs the file.
export const CODEX_FILE_STORE = 'cli_auth_credentials_store = "file"';

/** Make sure a CODEX_HOME keeps its sign-in in auth.json. */
export function ensureCodexFileStore(codexHome: string) {
  mkdirSync(codexHome, { recursive: true });
  const file = join(codexHome, 'config.toml');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (/^\s*cli_auth_credentials_store\s*=/m.test(current)) {
    if (!current.includes(CODEX_FILE_STORE)) throw new Error(`${file} sets cli_auth_credentials_store to something other than "file"; the Playground needs the file store to share one sign-in.`);
    return;
  }
  // Top-level keys must come before any [table].
  writeFileSync(file, `${CODEX_FILE_STORE}\n${current}`);
}

/**
 * Prepare the shared Codex sign-in: its CODEX_HOME with the file store, and
 * the config pointing every role at its auth.json. Returns the command the
 * owner runs in their own terminal; the Playground never handles the login.
 */
export function prepareCodexLogin(home: string): { dir: string; authFile: string; command: string; signedIn: boolean } {
  const dir = codexLoginDir(home);
  ensureCodexFileStore(dir);
  const authFile = join(dir, 'auth.json');
  const config = readConfig(home);
  config.auth.codex = { mode: 'role-file', source: authFile };
  writeConfig(home, config);
  const shown = dir.startsWith(`${homedir()}/`) ? `~/${dir.slice(homedir().length + 1)}` : dir;
  return { dir, authFile, command: `CODEX_HOME=${shown} codex login`, signedIn: existsSync(authFile) };
}

/** After a run: the role's auth.json must still be the link (Codex rewrites it in place on refresh). */
export function checkCodexLink(role: RolePaths, config: PlaygroundConfig): string | null {
  const mode = config.auth.codex;
  if (!mode || mode.mode !== 'role-file' || mode.source === null) return null;
  const target = join(role.codexDir, 'auth.json');
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() && readlinkSync(target) === mode.source) return null;
  } catch { /* missing */ }
  return `${target} is no longer a link to the shared sign-in ${mode.source}; Codex replaced it. Move it aside and rerun.`;
}

export function readConfig(home: string): PlaygroundConfig {
  const file = configPath(home);
  if (!existsSync(file)) return { auth: {} };
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<PlaygroundConfig>;
  return { auth: parsed.auth ?? {} };
}

export function writeConfig(home: string, config: PlaygroundConfig) {
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), `${JSON.stringify(config, null, 2)}\n`);
}

/** Validate a mode for a harness; returns it or throws with what is allowed. */
export function checkAuthMode(harness: RealHarness, mode: AuthMode): AuthMode {
  if (mode.mode === 'keychain') {
    const secret = SECRETS[mode.secret];
    if (!secret) throw new Error(`Unknown secret ${mode.secret}; use one of ${Object.keys(SECRETS).join(', ')}`);
    if (secret.harness !== harness) throw new Error(`${mode.secret} is for ${secret.harness}, not ${harness}`);
  } else if (mode.mode === 'role-file') {
    if (harness !== 'codex') throw new Error('role-file auth is for Codex only; Claude Code keeps its sign-in in the system keychain, not in a file (use role-login or keychain)');
    if (mode.source !== null && !isAbsolute(mode.source)) throw new Error(`role-file source must be an absolute path: ${mode.source}`);
  } else if (mode.mode !== 'role-login') {
    throw new Error(`Unknown auth mode ${(mode as { mode: string }).mode}`);
  }
  return mode;
}

export function setupHint(harness: RealHarness): string {
  return harness === 'claude-code'
    ? 'Choose how roles sign in to Claude Code: `playground auth set claude-oauth-token` then `playground auth use claude-code keychain claude-oauth-token`, or sign in per role and `playground auth use claude-code role-login`.'
    : 'Choose how roles sign in to Codex: `playground auth set codex-api-key` then `playground auth use codex keychain codex-api-key`, or `playground auth use codex role-file <shared auth.json>`, or sign in per role and `playground auth use codex role-login`.';
}

/** Store a secret the owner typed. Never overwrites an existing entry. */
export async function storeSecret(store: SecretStore, name: SecretName, value: string) {
  if (!SECRETS[name]) throw new Error(`Unknown secret ${name}; use one of ${Object.keys(SECRETS).join(', ')}`);
  const secret = value.trim();
  if (!secret) throw new Error('Nothing was entered; nothing was stored');
  if ((await store.get(KEYCHAIN_SERVICE, name)) !== null) {
    throw new Error(`The ${store.description} already has ${name} for the Playground (service ${KEYCHAIN_SERVICE}). Delete that entry first to replace it.`);
  }
  await store.add(KEYCHAIN_SERVICE, name, `Obelisk Playground ${name}`, secret);
}

/**
 * Prepare a role's harness to sign in and return the environment variables to
 * add. Throws with a setup hint when the harness has no auth configured or the
 * configured credential is missing.
 */
export async function harnessAuthEnv(
  harness: RealHarness,
  role: RolePaths,
  config: PlaygroundConfig,
  store: SecretStore,
): Promise<Record<string, string>> {
  const mode = config.auth[harness];
  if (!mode) throw new Error(`No sign-in is configured for ${harness}. ${setupHint(harness)}`);
  checkAuthMode(harness, mode);
  if (mode.mode === 'keychain') {
    const value = await store.get(KEYCHAIN_SERVICE, mode.secret);
    if (value === null) throw new Error(`${mode.secret} is not in the ${store.description} yet: ${SECRETS[mode.secret].how} into \`playground auth set ${mode.secret}\`.`);
    return { [SECRETS[mode.secret].env]: value };
  }
  if (mode.mode === 'role-file') {
    const target = join(role.codexDir, 'auth.json');
    if (mode.source === null) {
      ensureCodexFileStore(role.codexDir);
      if (!existsSync(target)) throw new Error(`${target} does not exist: sign this role in with \`CODEX_HOME=${role.codexDir} codex login\`, or use a shared auth file.`);
      return {};
    }
    if (!existsSync(mode.source)) throw new Error(`The shared Codex sign-in ${mode.source} does not exist yet; run \`CODEX_HOME=${dirname(mode.source)} codex login\` in your own terminal (\`playground auth codex-login\` prints it).`);
    let stat = null;
    try { stat = lstatSync(target); } catch { /* missing */ }
    ensureCodexFileStore(role.codexDir);
    if (stat === null) {
      symlinkSync(mode.source, target);
    } else if (!stat.isSymbolicLink() || readlinkSync(target) !== mode.source) {
      throw new Error(`${target} already exists and is not a link to ${mode.source}; move it aside to use the shared auth file.`);
    }
    return {};
  }
  return {};
}
