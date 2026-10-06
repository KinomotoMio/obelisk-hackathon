// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * A user who only holds a signing key. These accounts are never funded and
 * never send a transaction: every write in the tests is submitted by a
 * separate relayer wallet, which is how the online service will operate.
 */
export function offchainUser(label: string): PrivateKeyAccount {
  return privateKeyToAccount(keccak256(toHex(`obelisk-test-user:${label}`)));
}

/** Deterministic bytes32 for ids, fingerprints, and content hashes. */
export function b32(label: string): Hex {
  return keccak256(toHex(label));
}

/** A deadline comfortably in the future relative to `now` (seconds). */
export function deadlineAfter(now: bigint, seconds = 3600n): bigint {
  return now + seconds;
}
