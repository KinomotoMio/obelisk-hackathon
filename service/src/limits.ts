// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Hourly relay limits, so a script cannot drain the relay wallet. Kept in the
// relay queue's Durable Object storage: one key per signer plus one global
// key, each overwritten when its hour rolls over, so storage stays bounded.

import type { Address } from 'viem';

import type { RateLimiter } from './relayer.ts';

export interface CounterStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface Window {
  hour: number;
  count: number;
}

export const DEFAULT_PER_SIGNER_HOURLY = 20;
export const DEFAULT_GLOBAL_HOURLY = 300;

export class HourlyRateLimiter implements RateLimiter {
  readonly #storage: CounterStorage;
  readonly #perSigner: number;
  readonly #global: number;
  readonly #now: () => number;

  constructor(storage: CounterStorage, limits: { perSigner?: number; global?: number } = {}, now: () => number = Date.now) {
    this.#storage = storage;
    this.#perSigner = limits.perSigner ?? DEFAULT_PER_SIGNER_HOURLY;
    this.#global = limits.global ?? DEFAULT_GLOBAL_HOURLY;
    this.#now = now;
  }

  async take(signer: Address): Promise<boolean> {
    const hour = Math.floor(this.#now() / 3_600_000);
    const signerKey = `limit:${signer.toLowerCase()}`;
    const [mine, all] = await Promise.all([
      this.#storage.get<Window>(signerKey),
      this.#storage.get<Window>('limit:*'),
    ]);
    const mineCount = mine?.hour === hour ? mine.count : 0;
    const allCount = all?.hour === hour ? all.count : 0;
    if (mineCount >= this.#perSigner || allCount >= this.#global) return false;
    await Promise.all([
      this.#storage.put<Window>(signerKey, { hour, count: mineCount + 1 }),
      this.#storage.put<Window>('limit:*', { hour, count: allCount + 1 }),
    ]);
    return true;
  }
}

export function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Relay limit must be a non-negative integer (got ${JSON.stringify(value)})`);
  return parsed;
}
