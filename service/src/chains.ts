// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Which chain this deployment of the service talks to, and where the Obelisk
// contracts live on it. viem has no built-in BOT Chain, so both networks are
// defined here. Contract addresses are never hard-coded: they come from the
// committed `chain/deployments/<chainId>.json` records (only `complete` ones).

import { defineChain, getAddress, type Address, type Chain } from 'viem';

import testnetDeployment from '../../chain/deployments/968.json' with { type: 'json' };

export const CONTRACT_NAMES = ['KeyRegistry', 'ShareRegistry', 'SkillRegistry', 'UsageStats'] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];
export type ContractAddresses = Record<ContractName, Address>;

export const botMainnet = defineChain({
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.botchain.ai'] } },
  blockExplorers: { default: { name: 'BOT Chain Explorer', url: 'https://scan.botchain.ai' } },
});

export const botTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.bohr.life'] } },
  blockExplorers: { default: { name: 'BOT Chain Testnet Explorer', url: 'https://scan.bohr.life' } },
  testnet: true,
});

/** Hardhat's local node, for development against `npx hardhat node` only. */
export const localDevChain = defineChain({
  id: 31337,
  name: 'Local development chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
});

interface DeploymentRecord {
  chainId: number;
  complete: boolean;
  contracts: Partial<Record<string, { address: string }>>;
}

// Mainnet (677) joins this list once #5 commits chain/deployments/677.json.
const committedDeployments: readonly DeploymentRecord[] = [testnetDeployment];

const knownChains: readonly Chain[] = [botMainnet, botTestnet];

export interface ServiceChainConfig {
  chain: Chain;
  rpcUrl: string;
  contracts: ContractAddresses;
  /** Base URL of the block explorer, without a trailing slash; null for the local chain. */
  explorerUrl: string | null;
}

export interface ChainEnv {
  CHAIN_ID?: string;
  RPC_URL?: string;
  /** JSON `{ "<ContractName>": "0x…" }`; accepted only for the local development chain. */
  LOCAL_CONTRACTS?: string;
}

function contractsFromRecord(record: DeploymentRecord): ContractAddresses {
  const out = {} as ContractAddresses;
  for (const name of CONTRACT_NAMES) {
    const address = record.contracts[name]?.address;
    if (!address) throw new Error(`Deployment record for chain ${record.chainId} has no ${name} address`);
    out[name] = getAddress(address);
  }
  return out;
}

export function resolveChainConfig(env: ChainEnv): ServiceChainConfig {
  const chainId = Number(env.CHAIN_ID ?? '968');
  if (chainId === localDevChain.id) {
    if (!env.LOCAL_CONTRACTS) throw new Error('CHAIN_ID 31337 requires LOCAL_CONTRACTS with the locally deployed addresses');
    const parsed = JSON.parse(env.LOCAL_CONTRACTS) as Record<string, string>;
    const contracts = contractsFromRecord({
      chainId,
      complete: true,
      contracts: Object.fromEntries(Object.entries(parsed).map(([name, address]) => [name, { address }])),
    });
    return {
      chain: localDevChain,
      rpcUrl: env.RPC_URL || localDevChain.rpcUrls.default.http[0]!,
      contracts,
      explorerUrl: null,
    };
  }
  const chain = knownChains.find((candidate) => candidate.id === chainId);
  if (!chain) throw new Error(`Unsupported CHAIN_ID ${env.CHAIN_ID}; expected 968 (testnet) or 677 (mainnet)`);
  const record = committedDeployments.find((candidate) => candidate.chainId === chainId && candidate.complete);
  if (!record) throw new Error(`No complete deployment of the Obelisk contracts is committed for chain ${chainId}`);
  return {
    chain,
    rpcUrl: env.RPC_URL || chain.rpcUrls.default.http[0]!,
    contracts: contractsFromRecord(record),
    explorerUrl: chain.blockExplorers?.default.url ?? null,
  };
}

export function explorerTxUrl(config: ServiceChainConfig, hash: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl}/tx/${hash}` : null;
}

export function explorerAddressUrl(config: ServiceChainConfig, address: string): string | null {
  return config.explorerUrl ? `${config.explorerUrl}/address/${address}` : null;
}
