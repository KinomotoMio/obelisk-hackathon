// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Minted Skills this data directory fetched and installed (#17, vision 03 K5).
//
// Every `obelisk skill fetch --confirm` appends one record to
// <skills dir>/fetched-skills.json: which minted version (chain, Skill id,
// version, fingerprint, author), the name it was installed under, and where.
// Usage recognition (#22) maps invocations to these records by fingerprint,
// so a fetched Skill's later loads count as uses of that minted version.
// The file name is not a valid Skill name, so library listings skip it.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FETCHED_SKILLS_FILE = 'fetched-skills.json';
const FETCHED_SKILLS_SCHEMA = 1;

export interface SkillFetchRecord {
  name: string;
  /** Description captured at fetch time; absent in older records. */
  description?: string;
  fingerprint: string;
  chainId: number;
  skillId: string;
  versionIndex: number;
  author: string;
  installedTo: string;
  fetchedAt: string;
}

interface FetchedSkillsFile {
  schema: number;
  fetches: SkillFetchRecord[];
}

async function readFetchedFile(skillsDir: string): Promise<FetchedSkillsFile> {
  const path = join(skillsDir, FETCHED_SKILLS_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: FETCHED_SKILLS_SCHEMA, fetches: [] };
    throw error;
  }
  const parsed = JSON.parse(text) as FetchedSkillsFile;
  if (parsed.schema !== FETCHED_SKILLS_SCHEMA || !Array.isArray(parsed.fetches)) {
    throw new Error(`Unsupported fetched Skills record in ${path}`);
  }
  return parsed;
}

/** Every recorded fetch, oldest first. */
export async function listSkillFetches(skillsDir: string): Promise<SkillFetchRecord[]> {
  return (await readFetchedFile(skillsDir)).fetches;
}

/** The latest fetch installed at `installedTo`, if any. */
export async function fetchInstalledAt(skillsDir: string, installedTo: string): Promise<SkillFetchRecord | null> {
  return (await listSkillFetches(skillsDir)).findLast((record) => record.installedTo === installedTo) ?? null;
}

export async function recordSkillFetch(skillsDir: string, record: SkillFetchRecord): Promise<void> {
  await mkdir(skillsDir, { recursive: true });
  const file = await readFetchedFile(skillsDir);
  file.fetches.push(record);
  const path = join(skillsDir, FETCHED_SKILLS_FILE);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
