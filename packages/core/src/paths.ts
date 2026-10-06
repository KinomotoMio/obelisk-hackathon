// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Where Obelisk keeps its own state. Core, CLI, and the Electron main process
// all resolve through here so one OBELISK_HOME moves every piece together.
//
// Shape and precedence follow the opt-in storage design in
// tommy0103/obelisk#108 (OBELISK_HOME wins; otherwise ~/.obelisk). Only the
// OBELISK_HOME half is implemented; the XDG layout from that PR can slot in as
// another `layout` without changing callers.

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export type ObeliskStorageLayout = 'custom' | 'legacy';

export interface ObeliskPaths {
  readonly layout: ObeliskStorageLayout;
  readonly configDir: string;
  readonly dataDir: string;
  readonly settingsPath: string;
  readonly dbPath: string;
  readonly recapDir: string;
  // Pre-~/.obelisk database location, copied forward only in the legacy layout.
  readonly legacyDbPath: string;
}

export interface ResolveObeliskPathsOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function expandTilde(value: string, homeDir: string): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homeDir, value.slice(2));
  return value;
}

export function resolveObeliskPaths({
  env = process.env,
  homeDir = homedir(),
}: ResolveObeliskPathsOptions = {}): ObeliskPaths {
  const home = resolve(homeDir);
  const legacyDbPath = join(home, '.claude', 'obelisk.sqlite');
  const raw = env['OBELISK_HOME'];
  let layout: ObeliskStorageLayout = 'legacy';
  let dataDir = join(home, '.obelisk');
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const expanded = expandTilde(raw.trim(), home);
    if (!isAbsolute(expanded)) {
      throw new Error(`OBELISK_HOME must be an absolute path or begin with ~ (got ${JSON.stringify(raw)})`);
    }
    layout = 'custom';
    dataDir = resolve(expanded);
  }
  return {
    layout,
    configDir: dataDir,
    dataDir,
    settingsPath: join(dataDir, 'settings.json'),
    dbPath: join(dataDir, 'obelisk.sqlite'),
    recapDir: join(dataDir, 'recap'),
    legacyDbPath,
  };
}
