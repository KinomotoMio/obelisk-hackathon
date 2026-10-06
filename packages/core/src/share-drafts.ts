// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Local state of a private share (#8), one directory per draft under
// `resolveObeliskPaths().sharesDir`:
//
//   draft.json     the unredacted snapshot, recipient, rules, and the
//                  redaction choice the user previewed
//   outbox.json    ciphertext, key package, and share id, written before
//                  anything leaves the machine so an interrupted send resumes
//                  with the same share instead of creating a second one
//   sent.json      the share record once it is on chain (#11 lists these)
//   snapshot.json  the redacted snapshot exactly as encrypted
//
// After a successful send the unredacted snapshot is dropped from draft.json.
// Files are written atomically with owner-only permissions.

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Address, Hex } from 'viem';

import type { ShareKeyPackage } from './share-crypto.ts';
import type { ShareSnapshot } from './share-snapshot.ts';

/** `maxOpens` meaning "no limit": the largest uint32 the contract accepts. */
export const UNLIMITED_OPENS = 0xffffffff;

export interface ShareDraft {
  version: 1;
  draftId: string;
  createdAt: string;
  sessionId: string;
  recipient: Address;
  maxOpens: number;
  expiresInSeconds: number;
  /** Unredacted; null once the share has been sent. */
  snapshot: ShareSnapshot | null;
  /** The redaction choice shown in the last preview; confirm sends exactly this. */
  decision: { redact: number[]; previewedAt: string } | null;
}

export interface ShareOutbox {
  version: 1;
  shareId: Hex;
  contentHash: Hex;
  recipientKey: Hex;
  keyPackage: ShareKeyPackage;
  ciphertext: string;
  redact: number[];
  /** Set once the service accepted the CreateShare transaction. */
  txHash?: Hex;
}

export interface SentShare {
  version: 1;
  draftId: string;
  shareId: Hex;
  link: string;
  chainId: number;
  sender: Address;
  recipient: Address;
  maxOpens: number;
  expiresAt: string;
  title: string | null;
  source: ShareSnapshot['source'];
  range: ShareSnapshot['range'];
  redacted: number;
  transaction: Hex | null;
  explorer: string | null;
  sentAt: string;
}

const DRAFT_ID = /^[0-9a-f]{8}$/;

export function shareDraftDir(sharesDir: string, draftId: string): string {
  if (!DRAFT_ID.test(draftId)) throw new Error(`Not a share draft id: ${draftId} (expected 8 hex characters, as printed by \`obelisk share draft\`)`);
  return join(sharesDir, draftId);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export class ShareDrafts {
  readonly sharesDir: string;

  constructor(sharesDir: string) {
    this.sharesDir = sharesDir;
  }

  async create(draft: Omit<ShareDraft, 'version' | 'draftId'>): Promise<ShareDraft> {
    await mkdir(this.sharesDir, { recursive: true, mode: 0o700 });
    for (;;) {
      const draftId = randomBytes(4).toString('hex');
      const dir = shareDraftDir(this.sharesDir, draftId);
      try {
        await mkdir(dir, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        throw error;
      }
      const record: ShareDraft = { version: 1, draftId, ...draft };
      await writeJson(join(dir, 'draft.json'), record);
      return record;
    }
  }

  async load(draftId: string): Promise<ShareDraft> {
    const draft = await readJson<ShareDraft>(join(shareDraftDir(this.sharesDir, draftId), 'draft.json'));
    if (!draft) throw new Error(`No share draft ${draftId} in ${this.sharesDir}; start one with \`obelisk share draft\``);
    return draft;
  }

  save(draft: ShareDraft): Promise<void> {
    return writeJson(join(shareDraftDir(this.sharesDir, draft.draftId), 'draft.json'), draft);
  }

  outbox(draftId: string): Promise<ShareOutbox | null> {
    return readJson<ShareOutbox>(join(shareDraftDir(this.sharesDir, draftId), 'outbox.json'));
  }

  saveOutbox(draftId: string, outbox: ShareOutbox): Promise<void> {
    return writeJson(join(shareDraftDir(this.sharesDir, draftId), 'outbox.json'), outbox);
  }

  sent(draftId: string): Promise<SentShare | null> {
    return readJson<SentShare>(join(shareDraftDir(this.sharesDir, draftId), 'sent.json'));
  }

  /** Every share sent from this data directory, newest first. */
  async listSent(): Promise<SentShare[]> {
    let names: string[];
    try {
      names = await readdir(this.sharesDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const sent = await Promise.all(names.filter((name) => DRAFT_ID.test(name)).map((name) => this.sent(name)));
    return sent.filter((record): record is SentShare => record !== null).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }

  /** Record a share as sent. Re-running after an interruption completes it. */
  async markSent(draft: ShareDraft, sent: SentShare, redactedSnapshot: ShareSnapshot): Promise<void> {
    const dir = shareDraftDir(this.sharesDir, draft.draftId);
    await writeJson(join(dir, 'snapshot.json'), redactedSnapshot);
    await writeJson(join(dir, 'sent.json'), sent);
    await this.dropUnsent(draft);
  }

  /** After sent.json exists: drop the unredacted snapshot and the outbox. */
  async dropUnsent(draft: ShareDraft): Promise<void> {
    if (draft.snapshot !== null) await this.save({ ...draft, snapshot: null });
    await rm(join(shareDraftDir(this.sharesDir, draft.draftId), 'outbox.json'), { force: true });
  }
}
