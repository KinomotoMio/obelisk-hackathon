// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Whether this data directory reports Skill usage (#23), and what it last
// reported. Kept in <data dir>/usage-reporting.json; reporting is off until
// the user turns it on after seeing a preview (`obelisk usage enable`).
//
// The last reported totals are kept because UsageStats exposes a wallet's
// running invocation total but not its per-bucket totals, and it rejects a
// bucket that goes down. The next report never sends less than this record.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const USAGE_SETTINGS_FILE = 'usage-reporting.json';
const SCHEMA = 1;

export interface ReportedTotals {
  cumulativeInvocations: number;
  /** bytes32 key -> running total, as last sent. */
  scenes: Record<string, number>;
  outcomes: Record<string, number>;
  reportedAt: string;
  txHash: string | null;
}

export interface UsageSettings {
  enabled: boolean;
  enabledAt: string | null;
  disabledAt: string | null;
  lastRunAt: string | null;
  /** `<chainId>:<0x fingerprint>` -> what this wallet last reported. */
  reported: Record<string, ReportedTotals>;
}

export function usageSettingsPath(dataDir: string): string {
  return join(dataDir, USAGE_SETTINGS_FILE);
}

export function reportedKey(chainId: number, fingerprint: string): string {
  return `${chainId}:0x${fingerprint.replace(/^0x/, '').toLowerCase()}`;
}

export async function readUsageSettings(dataDir: string): Promise<UsageSettings> {
  const path = usageSettingsPath(dataDir);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { enabled: false, enabledAt: null, disabledAt: null, lastRunAt: null, reported: {} };
    }
    throw error;
  }
  const parsed = JSON.parse(text) as UsageSettings & { schema?: number };
  if (parsed.schema !== SCHEMA || typeof parsed.enabled !== 'boolean' || typeof parsed.reported !== 'object' || parsed.reported === null) {
    throw new Error(`Unsupported usage reporting settings in ${path}`);
  }
  const { schema: _schema, ...settings } = parsed;
  return settings;
}

export async function writeUsageSettings(dataDir: string, settings: UsageSettings): Promise<void> {
  const path = usageSettingsPath(dataDir);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ schema: SCHEMA, ...settings }, null, 2)}\n`);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
