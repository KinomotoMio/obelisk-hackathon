// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// EIP-712 typed-data definitions for every user action the Obelisk contracts
// accept. The online service and the CLI sign and verify with these exact
// shapes; the contract tests sign through them too, so a drift between this
// file and a contract's typehash fails the test suite.
//
// Every action carries the signer's current `nonce` (read it from the
// contract's `nonces(address)` view) and a unix-seconds `deadline`. The domain
// is `{ name, version: "1", chainId, verifyingContract }`.

export const EIP712_VERSION = "1";

export const domainNames = {
  KeyRegistry: "ObeliskKeyRegistry",
  ShareRegistry: "ObeliskShareRegistry",
} as const;

export type ObeliskContractName = keyof typeof domainNames;

export function obeliskDomain(
  contract: ObeliskContractName,
  chainId: number,
  verifyingContract: `0x${string}`,
) {
  return { name: domainNames[contract], version: EIP712_VERSION, chainId, verifyingContract } as const;
}

export const keyRegistryTypes = {
  RegisterKey: [
    { name: "user", type: "address" },
    { name: "pubKey", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const shareRegistryTypes = {
  CreateShare: [
    { name: "sender", type: "address" },
    { name: "shareId", type: "bytes32" },
    { name: "recipient", type: "address" },
    { name: "contentHash", type: "bytes32" },
    { name: "maxOpens", type: "uint32" },
    { name: "expiresAt", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  RecordOpen: [
    { name: "recipient", type: "address" },
    { name: "shareId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
  RevokeShare: [
    { name: "sender", type: "address" },
    { name: "shareId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** `ShareRegistry.checkOpen` result codes. */
export const OpenStatus = {
  Ok: 0,
  Unknown: 1,
  NotRecipient: 2,
  Exhausted: 3,
  Expired: 4,
  Revoked: 5,
} as const;
