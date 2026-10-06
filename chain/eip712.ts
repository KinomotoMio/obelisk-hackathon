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
