// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Client for the Obelisk online service (service/, #3): chain reads and the
// fee relay. The service decides which chain it serves; this client checks
// that the contract addresses it reports match the deployments pinned in
// chain-protocol.ts before anything is signed for them.

import { getAddress, type Address, type Hex } from 'viem';

import { pinnedDeployments, type ObeliskContractName } from './chain-protocol.ts';

/** The deployed service. Override with OBELISK_SERVICE_URL. */
export const DEFAULT_SERVICE_URL: string | null = 'https://obelisk-service.kinomotomiovo.workers.dev';

/** Hardhat's local chain; accepted without pinning for development. */
export const LOCAL_DEV_CHAIN_ID = 31337;

const NETWORK_NAMES: Record<number, string> = {
  677: 'BOT Chain mainnet',
  968: 'BOT Chain testnet',
  [LOCAL_DEV_CHAIN_ID]: 'local development chain',
};

export function networkLabel(chainId: number): string {
  return `${NETWORK_NAMES[chainId] ?? 'unknown chain'} (${chainId})`;
}

export function resolveServiceUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env['OBELISK_SERVICE_URL']?.trim() || DEFAULT_SERVICE_URL;
  if (!raw) {
    throw new Error('The Obelisk online service URL is not configured; set OBELISK_SERVICE_URL (for example https://obelisk-service.<subdomain>.workers.dev)');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OBELISK_SERVICE_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error(`OBELISK_SERVICE_URL must use https (http is allowed only for localhost): ${raw}`);
  }
  return url.toString().replace(/\/+$/, '');
}

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ChainInfo {
  chainId: number;
  name: string;
  explorerUrl: string | null;
  contracts: Record<ObeliskContractName, Address>;
  relayer: Address | null;
}

export interface KeyInfo {
  address: Address;
  registered: boolean;
  pubKey: Hex | null;
  version: number;
  updatedAt: string | null;
  nonce: string;
  explorerUrl: string | null;
}

export type RelayOutcome =
  | { status: 'confirmed'; action: string; signer: Address; txHash: Hex; blockNumber: string; explorerUrl: string | null }
  | { status: 'pending'; action: string; signer: Address; txHash: Hex; explorerUrl: string | null };

export class ObeliskServiceClient {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.#fetch = fetchImpl;
  }

  async #request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
    } catch (error) {
      const reason = error instanceof Error ? (error.name === 'TimeoutError' ? 'timed out' : error.message) : String(error);
      throw new ServiceError(0, 'unreachable', `Could not reach the Obelisk online service at ${this.baseUrl}: ${reason}`);
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ServiceError(response.status, 'invalid_response', `The Obelisk online service returned non-JSON (HTTP ${response.status}) for ${path}`);
    }
    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string; details?: Record<string, unknown> } }).error;
      throw new ServiceError(response.status, error?.code ?? 'http_error', error?.message ?? `HTTP ${response.status} from ${path}`, error?.details);
    }
    return body as T;
  }

  /**
   * The chain the service serves. Its contract addresses must match the
   * deployment pinned for that chain, so a misconfigured or hostile service
   * cannot get signatures for other contracts.
   */
  async chain(): Promise<ChainInfo> {
    const info = await this.#request<ChainInfo>('/v1/chain');
    const pinned = pinnedDeployments[info.chainId];
    if (!pinned) {
      if (info.chainId !== LOCAL_DEV_CHAIN_ID) {
        throw new Error(`The Obelisk online service is on chain ${info.chainId}, which this CLI has no deployment for`);
      }
      return info;
    }
    for (const [name, address] of Object.entries(pinned.contracts) as [ObeliskContractName, Address][]) {
      const reported = info.contracts?.[name];
      if (!reported || getAddress(reported) !== getAddress(address)) {
        throw new Error(`The Obelisk online service reports ${name} at ${reported ?? 'nothing'}, but ${networkLabel(info.chainId)} has it at ${address}; refusing to sign for it`);
      }
    }
    return info;
  }

  key(address: Address): Promise<KeyInfo> {
    return this.#request<KeyInfo>(`/v1/keys/${address}`);
  }

  relay(body: { action: string; message: Record<string, unknown>; signature: Hex }): Promise<RelayOutcome> {
    return this.#request<RelayOutcome>('/v1/relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      timeoutMs: 60_000,
    });
  }
}
