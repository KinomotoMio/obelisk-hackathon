// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The operating system's secret store, reached through its own command-line
// tool so the CLI stays free of native modules:
//
//   macOS  `security` (login Keychain). Items it creates trust `security`
//          itself, so reading them back does not prompt after Node upgrades.
//   Linux  `secret-tool` (libsecret: GNOME Keyring, KWallet).
//
// Secrets go in through stdin, never argv, so they do not show up in the
// process list, and they never appear in error messages.

import { spawn } from 'node:child_process';

export interface SecretStore {
  /** Human-readable name of the backing store, for CLI output. */
  readonly description: string;
  /** The stored secret, or null when there is no such entry. */
  get(service: string, account: string): Promise<string | null>;
  /** Add a new entry. Fails if one already exists; never overwrites. */
  add(service: string, account: string, label: string, secret: string): Promise<void>;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input: string | null, missingHint: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new Error(`${command} was not found. ${missingHint}`) : error);
    });
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

// `security -i` reads one command per line and splits on whitespace, with
// double quotes grouping. Values that would need escaping are refused rather
// than guessed at.
function quoteForSecurity(value: string, what: string): string {
  if (/["\\\r\n]/.test(value)) throw new Error(`Cannot store a Keychain entry whose ${what} contains a quote, backslash, or newline`);
  return `"${value}"`;
}

const MACOS_HINT = 'It ships with macOS at /usr/bin/security.';

export const macosKeychain: SecretStore = {
  description: 'macOS Keychain',
  async get(service, account) {
    const result = await run('security', ['find-generic-password', '-s', service, '-a', account, '-w'], null, MACOS_HINT);
    if (result.code === 0) return result.stdout.replace(/\n$/, '');
    // 44: errSecItemNotFound
    if (result.code === 44) return null;
    throw new Error(`Reading from the macOS Keychain failed: ${firstLine(result.stderr) || `security exited with ${result.code}`}`);
  },
  async add(service, account, label, secret) {
    const line = [
      'add-generic-password',
      '-s', quoteForSecurity(service, 'service'),
      '-a', quoteForSecurity(account, 'account'),
      '-l', quoteForSecurity(label, 'label'),
      '-w', quoteForSecurity(secret, 'secret'),
    ].join(' ');
    const result = await run('security', ['-i'], `${line}\n`, MACOS_HINT);
    if (result.code !== 0) {
      const reason = firstLine(result.stderr).replace(/^security: /, '') || `security exited with ${result.code}`;
      throw new Error(`Saving to the macOS Keychain failed: ${reason}`);
    }
  },
};

const LINUX_HINT = 'Install libsecret-tools (Debian/Ubuntu: `sudo apt install libsecret-tools`) and make sure a Secret Service such as GNOME Keyring is running.';

export const linuxSecretService: SecretStore = {
  description: 'Secret Service keyring',
  async get(service, account) {
    const result = await run('secret-tool', ['lookup', 'service', service, 'account', account], null, LINUX_HINT);
    if (result.code === 0) return result.stdout.replace(/\n$/, '');
    if (result.code === 1 && result.stderr.trim() === '') return null;
    throw new Error(`Reading from the Secret Service keyring failed: ${firstLine(result.stderr) || `secret-tool exited with ${result.code}`}`);
  },
  async add(service, account, label, secret) {
    if ((await this.get(service, account)) !== null) {
      throw new Error('Saving to the Secret Service keyring failed: an entry for this data directory already exists');
    }
    const result = await run('secret-tool', ['store', `--label=${label}`, 'service', service, 'account', account], secret, LINUX_HINT);
    if (result.code !== 0) {
      throw new Error(`Saving to the Secret Service keyring failed: ${firstLine(result.stderr) || `secret-tool exited with ${result.code}`}`);
    }
  },
};

export function systemSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === 'darwin') return macosKeychain;
  if (platform === 'linux') return linuxSecretService;
  throw new Error(`Keeping the wallet key in the system keychain is not supported on ${platform} yet (macOS and Linux are)`);
}
