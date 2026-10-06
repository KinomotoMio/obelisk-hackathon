// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Chain reads for the CLI, the App, and the web reader. BOT Chain does not
// serve eth_getLogs, so everything here goes through the contracts' view
// functions.

import { getAddress, isAddress, isHash, type Address, type Hex, type PublicClient } from 'viem';

import { RequestError } from './actions.ts';
import { CONTRACT_NAMES, explorerAddressUrl, explorerTxUrl, type ContractName, type ServiceChainConfig } from './chains.ts';
import { CONTRACT_ABIS, type RelayRecord } from './relayer.ts';

export function parseAddressParam(value: string): Address {
  if (!isAddress(value, { strict: false })) throw new RequestError(400, 'invalid_address', `Not an address: ${value}`);
  return getAddress(value);
}

export function parseContractParam(value: string): ContractName {
  const match = CONTRACT_NAMES.find((name) => name.toLowerCase() === value.toLowerCase());
  if (!match) throw new RequestError(400, 'unknown_contract', `contract must be one of: ${CONTRACT_NAMES.join(', ')}`);
  return match;
}

export async function readNonce(client: PublicClient, config: ServiceChainConfig, contract: ContractName, user: Address) {
  const nonce = await client.readContract({
    address: config.contracts[contract],
    abi: CONTRACT_ABIS[contract],
    functionName: 'nonces',
    args: [user],
  }) as bigint;
  return { contract, address: user, nonce: nonce.toString() };
}

/** KeyRegistry record for `user` plus the nonce its next RegisterKey must sign. */
export async function readKey(client: PublicClient, config: ServiceChainConfig, user: Address) {
  const address = config.contracts.KeyRegistry;
  const abi = CONTRACT_ABIS.KeyRegistry;
  const [[pubKey, updatedAt, version], nonce] = await Promise.all([
    client.readContract({ address, abi, functionName: 'keyOf', args: [user] }) as Promise<readonly [Hex, bigint, number]>,
    client.readContract({ address, abi, functionName: 'nonces', args: [user] }) as Promise<bigint>,
  ]);
  const registered = version > 0;
  return {
    address: user,
    registered,
    pubKey: registered ? pubKey : null,
    version,
    updatedAt: registered ? new Date(Number(updatedAt) * 1000).toISOString() : null,
    nonce: nonce.toString(),
    explorerUrl: explorerAddressUrl(config, user),
  };
}

export async function readTransaction(
  client: PublicClient,
  config: ServiceChainConfig,
  hashParam: string,
  record: RelayRecord | null,
) {
  if (!isHash(hashParam)) throw new RequestError(400, 'invalid_hash', `Not a transaction hash: ${hashParam}`);
  const hash = hashParam.toLowerCase() as Hex;
  const base = { txHash: hash, explorerUrl: explorerTxUrl(config, hash), relay: record };
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  if (receipt) {
    return { ...base, status: receipt.status === 'success' ? 'confirmed' : 'reverted', blockNumber: receipt.blockNumber.toString() };
  }
  const transaction = await client.getTransaction({ hash }).catch(() => null);
  if (transaction || record) return { ...base, status: 'pending' };
  throw new RequestError(404, 'unknown_transaction', `Transaction ${hash} is not known to this chain`);
}
