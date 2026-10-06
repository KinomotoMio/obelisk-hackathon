// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Cloudflare Worker entry point. Bindings (see wrangler.jsonc):
//   RELAY_QUEUE  Durable Object; the one place relayed transactions are sent from
//   INDEX        KV; small indexes (relayed transaction records today)
//   BLOBS        R2; share ciphertext and key packages (#8), Skill bodies (#16)
//   RELAYER_PRIVATE_KEY  secret; the relay wallet that pays gas

import { createPublicClient, createWalletClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { RequestError } from './actions.ts';
import { errorResponse, handleRequest, relayResponse, type TxIndex } from './app.ts';
import { resolveChainConfig, type ChainEnv, type ServiceChainConfig } from './chains.ts';
import { HourlyRateLimiter, parseLimit } from './limits.ts';
import { Relayer, type RelayRecord } from './relayer.ts';
import type { KeyPackage, ShareStore, ShareTransactions } from './shares.ts';

export interface Env extends ChainEnv {
  RELAYER_PRIVATE_KEY?: string;
  RELAY_LIMIT_PER_SIGNER_HOURLY?: string;
  RELAY_LIMIT_GLOBAL_HOURLY?: string;
  RELAY_QUEUE: DurableObjectNamespace;
  INDEX?: KVNamespace;
  BLOBS?: R2Bucket;
}

const TX_RECORD_TTL_SECONDS = 30 * 24 * 3600;

function relayAccount(env: Env) {
  const raw = env.RELAYER_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('RELAYER_PRIVATE_KEY is set but is not a 32-byte hex private key');
  return privateKeyToAccount(key);
}

function chainClients(env: Env) {
  let config: ServiceChainConfig;
  let account: ReturnType<typeof relayAccount>;
  try {
    config = resolveChainConfig(env);
    account = relayAccount(env);
  } catch (error) {
    throw new RequestError(500, 'service_misconfigured', error instanceof Error ? error.message : String(error));
  }
  const transport = http(config.rpcUrl, { timeout: 15_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain: config.chain, transport });
  const walletClient = account ? createWalletClient({ account, chain: config.chain, transport }) : null;
  return { config, publicClient, account, walletClient };
}

function kvTxIndex(kv: KVNamespace | undefined): TxIndex | null {
  if (!kv) return null;
  return {
    get: (hash) => kv.get<RelayRecord>(`tx:${hash.toLowerCase()}`, 'json'),
    put: (hash, record) => kv.put(`tx:${hash.toLowerCase()}`, JSON.stringify(record), { expirationTtl: TX_RECORD_TTL_SECONDS }),
  };
}

/** Share content in R2 (`shares/<id>/…`); transaction records in KV (`share:<id>`). */
function cloudflareShareStore(r2: R2Bucket | undefined, kv: KVNamespace | undefined): ShareStore | null {
  if (!r2 || !kv) return null;
  const content = (id: string) => `shares/${id}/content`;
  const keyPackage = (id: string) => `shares/${id}/key-package.json`;
  return {
    async putContent(id, ciphertext, pkg) {
      await r2.put(content(id), ciphertext, { httpMetadata: { contentType: 'application/octet-stream' } });
      await r2.put(keyPackage(id), JSON.stringify(pkg), { httpMetadata: { contentType: 'application/json' } });
    },
    async getContent(id) {
      const [blob, pkg] = await Promise.all([r2.get(content(id)), r2.get(keyPackage(id))]);
      if (!blob || !pkg) return null;
      return { ciphertext: new Uint8Array(await blob.arrayBuffer()), keyPackage: await pkg.json<KeyPackage>() };
    },
    async hasContent(id) {
      const [blob, pkg] = await Promise.all([r2.head(content(id)), r2.head(keyPackage(id))]);
      return Boolean(blob && pkg);
    },
    async deleteContent(id) {
      await r2.delete([content(id), keyPackage(id)]);
    },
    async getTransactions(id) {
      return (await kv.get<ShareTransactions>(`share:${id}`, 'json')) ?? {};
    },
    async putTransactions(id, transactions) {
      await kv.put(`share:${id}`, JSON.stringify(transactions));
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const { config, publicClient, account } = chainClients(env);
      return await handleRequest(request, {
        config,
        publicClient,
        relayerAddress: account?.address ?? null,
        txIndex: kvTxIndex(env.INDEX),
        storage: { kv: Boolean(env.INDEX), r2: Boolean(env.BLOBS) },
        shares: cloudflareShareStore(env.BLOBS, env.INDEX),
        relay: (forwarded) => env.RELAY_QUEUE.get(env.RELAY_QUEUE.idFromName('relay')).fetch(forwarded),
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * A single instance (`idFromName('relay')`) receives every relay request, so
 * the relay wallet's transactions are sent one at a time in arrival order.
 */
export class RelayQueue {
  readonly #state: DurableObjectState;
  readonly #env: Env;
  #relayer: Relayer | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
  }

  #getRelayer(): Relayer {
    if (this.#relayer) return this.#relayer;
    const env = this.#env;
    const { config, publicClient, walletClient } = chainClients(env);
    const txIndex = kvTxIndex(env.INDEX);
    this.#relayer = new Relayer({
      config,
      publicClient,
      walletClient,
      limits: new HourlyRateLimiter(this.#state.storage, {
        perSigner: parseLimit(env.RELAY_LIMIT_PER_SIGNER_HOURLY),
        global: parseLimit(env.RELAY_LIMIT_GLOBAL_HOURLY),
      }),
      recordTx: txIndex ? (hash, record) => txIndex.put(hash, record) : undefined,
    });
    return this.#relayer;
  }

  fetch(request: Request): Promise<Response> {
    return relayResponse(() => this.#getRelayer(), request);
  }
}
