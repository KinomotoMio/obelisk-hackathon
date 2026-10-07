// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Client for the Obelisk online service (service/, #3): chain reads, the fee
// relay, private shares (#8), minted Skill bodies (#16), and Skill usage
// (#23). The service decides which chain it serves; this client checks that
// the contract addresses it reports match the deployments pinned in
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

const NETWORK_NAMES_ZH: Record<number, string> = {
  677: 'BOT Chain 主网',
  968: 'BOT Chain 测试网',
  [LOCAL_DEV_CHAIN_ID]: '本地开发链',
};

/** The network's name for Chinese user-facing text, such as a page a user hands on. */
export function networkNameZh(chainId: number): string {
  return NETWORK_NAMES_ZH[chainId] ?? `未知网络（${chainId}）`;
}

// The block explorers of the BOT Chain networks, as service/src/chains.ts
// defines them. Links are built from the chain id rather than taken from
// whatever URL a service reports, so a page never sends the user to a site
// the service chose.
const NETWORK_EXPLORERS: Record<number, string> = {
  677: 'https://scan.botchain.ai',
  968: 'https://scan.bohr.life',
};

/** The explorer page of `address` on `chainId`, or null for a chain without an explorer. */
export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = NETWORK_EXPLORERS[chainId];
  return base ? `${base}/address/${address}` : null;
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

/** `GET /v1/skills/:ref`: a minted Skill version and its stored content. */
export interface MintedSkillInfo {
  chainId: number;
  contract: Address;
  skillId: string;
  author: Address;
  parentSkillId: string | null;
  createdAt: string;
  birthScenes: string[];
  versionCount: number;
  version: { index: number; fingerprint: Hex; publishedAt: string };
  content: { name: string; description: string; body: string } | null;
  explorer: { author: string | null };
}

/** `GET /v1/usage/:fingerprint`: one Skill version's reported usage (#24). */
export interface VersionUsageInfo {
  chainId: number;
  fingerprint: Hex;
  skillId: string;
  versionIndex: number;
  totalInvocations: number;
  uniqueWallets: number;
  lastReportAt: string | null;
  wallet?: { address: Address; cumulative: number; reportedAt: string | null };
}

/** One usage bucket as the service names it; `tag` is null for a key it cannot name. */
export interface UsageSceneBucket {
  key: Hex;
  tag: string | null;
  label: string | null;
  dimension: string | null;
  invocations: number;
}

/** `GET /v1/skills/:skillId/usage`: a Skill's usage across all its versions (#24). */
export interface SkillUsageInfo {
  chainId: number;
  contract: Address;
  skillId: string;
  author: Address;
  parentSkillId: string | null;
  birthScenes: { tag: string; label: string | null; dimension: string | null }[];
  totalInvocations: number;
  uniqueWallets: number;
  uniqueWalletsExact: boolean;
  lastReportAt: string | null;
  scenes: UsageSceneBucket[];
  outcomes: { key: Hex; id: string | null; invocations: number }[];
  results: {
    smooth: number;
    rework: number;
    failed: number;
    unknown: number;
    judged: number;
    smoothRate: number | null;
    signals: Record<string, number>;
  };
  trend: { unit: 'week'; source: string; available: boolean; weeks: { start: string; invocations: number }[] };
  versions: { index: number; fingerprint: Hex; publishedAt: string; totalInvocations: number; uniqueWallets: number; lastReportAt: string | null }[];
}

/** `GET /v1/skills/:skillId/lineage`: the family tree a Skill belongs to (族谱). */
export interface SkillLineageInfo {
  chainId: number;
  contract: Address;
  skillId: string;
  rootSkillId: string;
  path: string[];
  nodes: {
    skillId: string;
    parentSkillId: string | null;
    depth: number;
    author: Address;
    name: string | null;
    versionCount: number;
    latestFingerprint: Hex;
    createdAt: string;
    childSkillIds: string[];
  }[];
  truncated: boolean;
}

export type RelayOutcome =
  | { status: 'confirmed'; action: string; signer: Address; txHash: Hex; blockNumber: string; explorerUrl: string | null }
  | { status: 'pending'; action: string; signer: Address; txHash: Hex; explorerUrl: string | null };

export interface ShareInfo {
  shareId: Hex;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
  sender: Address;
  recipient: Address;
  contentHash: Hex;
  /** null means no limit. */
  maxOpens: number | null;
  openCount: number;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  revokedAt: string | null;
  receipts: { openCount: number; openedAt: string; blockNumber: string; txHash: Hex | null; explorerUrl: string | null }[];
  transactions: { create: { txHash: Hex; explorerUrl: string | null } | null; revoke: { txHash: Hex; explorerUrl: string | null } | null };
  contentStored: boolean;
}

export interface TxInfo {
  txHash: Hex;
  status: 'confirmed' | 'reverted' | 'pending';
  explorerUrl: string | null;
}

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

  async nonce(contract: ObeliskContractName, address: Address): Promise<bigint> {
    const { nonce } = await this.#request<{ nonce: string }>(`/v1/nonces/${contract}/${address}`);
    return BigInt(nonce);
  }

  /** A share's on-chain record, or null when the chain has no such share. */
  async share(shareId: Hex): Promise<ShareInfo | null> {
    try {
      return await this.#request<ShareInfo>(`/v1/shares/${shareId}`);
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'unknown_share') return null;
      throw error;
    }
  }

  tx(hash: Hex): Promise<TxInfo> {
    return this.#request<TxInfo>(`/v1/tx/${hash}`);
  }

  /** Upload a share's ciphertext and key package and relay its CreateShare. */
  createShare(body: { message: Record<string, unknown>; signature: Hex; keyPackage: unknown; ciphertext: string }): Promise<RelayOutcome & { shareId: Hex }> {
    return this.#request<RelayOutcome & { shareId: Hex }>('/v1/shares', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      timeoutMs: 120_000,
    });
  }

  /** Relay the sender's signed RevokeShare; the service keeps the transaction with the share. */
  revokeShare(shareId: Hex, body: { message: Record<string, unknown>; signature: Hex }): Promise<RelayOutcome & { shareId: Hex }> {
    return this.#request<RelayOutcome & { shareId: Hex }>(`/v1/shares/${shareId}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
      timeoutMs: 60_000,
    });
  }

  /** Where a share is opened; the web reader (#10) serves it. */
  shareLink(shareId: Hex): string {
    return `${this.baseUrl}/s/${shareId}`;
  }

  /** A minted Skill by id (latest version, or `versionIndex`) or by 0x fingerprint. */
  skill(ref: string, { versionIndex }: { versionIndex?: number } = {}): Promise<MintedSkillInfo> {
    const query = versionIndex === undefined ? '' : `?versionIndex=${versionIndex}`;
    return this.#request<MintedSkillInfo>(`/v1/skills/${encodeURIComponent(ref)}${query}`);
  }

  /** A minted version's usage; with `wallet`, that wallet's own running total too. */
  usage(fingerprint: Hex, { wallet }: { wallet?: Address } = {}): Promise<VersionUsageInfo> {
    const query = wallet ? `?wallet=${wallet}` : '';
    return this.#request<VersionUsageInfo>(`/v1/usage/${fingerprint}${query}`);
  }

  /** A Skill's usage across all its versions, with a weekly trend of `weeks` weeks. */
  skillUsage(skillId: string, { weeks }: { weeks?: number } = {}): Promise<SkillUsageInfo> {
    const query = weeks === undefined ? '' : `?weeks=${weeks}`;
    return this.#request<SkillUsageInfo>(`/v1/skills/${encodeURIComponent(skillId)}/usage${query}`);
  }

  /** The family tree (族谱) the Skill belongs to, from its root ancestor down. */
  skillLineage(skillId: string): Promise<SkillLineageInfo> {
    return this.#request<SkillLineageInfo>(`/v1/skills/${encodeURIComponent(skillId)}/lineage`);
  }

  storeSkillContent(
    fingerprint: Hex,
    content: { author: Address; name: string; description: string; body: string; signature: Hex },
  ): Promise<{ stored: true; created: boolean; skillId: string; versionIndex: number }> {
    return this.#request(`/v1/skills/${fingerprint}/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(content),
      timeoutMs: 30_000,
    });
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
