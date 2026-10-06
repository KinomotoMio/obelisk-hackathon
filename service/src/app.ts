// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// HTTP surface of the online service. Kept free of Cloudflare runtime imports
// so the same routing runs under `node --test` with in-memory bindings.
//
//   GET  /v1/health                     chain, relay wallet balance, storage bindings
//   GET  /v1/chain                      chain id, explorer, contract addresses, relay wallet
//   GET  /v1/keys/:address              KeyRegistry record + next RegisterKey nonce
//   GET  /v1/nonces/:contract/:address  next signature nonce on any Obelisk contract
//   GET  /v1/tx/:hash                   status of a relayed transaction
//   POST /v1/relay                      { action, message, signature } -> submitted on chain
//   POST /v1/shares                     upload a share's ciphertext + key package, relay CreateShare
//   GET  /v1/shares/:id                 a share's on-chain rules, status, and receipts
//   POST /v1/shares/:id/open            recipient-signed RecordOpen -> receipt on chain, then the key package
//
// The service never sees plaintext content and does nothing that needs AI.

import { formatEther, type Address, type PublicClient } from 'viem';

import { RequestError } from './actions.ts';
import type { ServiceChainConfig } from './chains.ts';
import { parseAddressParam, parseContractParam, readKey, readNonce, readTransaction } from './reads.ts';
import type { Relayer, RelayRecord } from './relayer.ts';
import { createShare, MAX_SHARE_BODY_BYTES, openShare, parseShareId, readShare, type ShareDeps, type ShareStore } from './shares.ts';

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Path the service uses to hand the relay queue its own actions (RecordOpen).
 * `handleRequest` only ever forwards `POST /v1/relay`, so no outside request
 * reaches the queue with this path.
 */
export const INTERNAL_RELAY_PATH = '/internal/relay';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS_HEADERS },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }, error.status);
  }
  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
  return json({ error: { code: 'upstream_error', message: `Chain or storage request failed: ${message}` } }, 502);
}

export interface TxIndex {
  get(hash: string): Promise<RelayRecord | null>;
  put(hash: string, record: RelayRecord): Promise<void>;
}

export interface AppDeps {
  config: ServiceChainConfig;
  publicClient: PublicClient;
  relayerAddress: Address | null;
  txIndex: TxIndex | null;
  storage: { kv: boolean; r2: boolean };
  /** Share ciphertext, key packages, and share transaction records; null when unbound. */
  shares: ShareStore | null;
  /** Forward a relay request to the single serialized relay queue. */
  relay(request: Request): Promise<Response>;
}

export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new RequestError(413, 'body_too_large', `Request body exceeds ${maxBytes} bytes`);
  const text = await request.text();
  if (text.length > maxBytes) throw new RequestError(413, 'body_too_large', `Request body exceeds ${maxBytes} bytes`);
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

/** Body of the relay queue: run one relay request through `relayer`. */
export async function relayResponse(relayer: Relayer | (() => Relayer), request: Request): Promise<Response> {
  try {
    const instance = typeof relayer === 'function' ? relayer() : relayer;
    const internal = new URL(request.url).pathname === INTERNAL_RELAY_PATH;
    const result = await instance.relay(await readJsonBody(request), { internal });
    return json(result, result.status === 'confirmed' ? 200 : 202);
  } catch (error) {
    return errorResponse(error);
  }
}

function shareDeps(request: Request, deps: AppDeps): ShareDeps {
  const forward = (path: string) => (body: unknown) => deps.relay(new Request(new URL(path, request.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return {
    config: deps.config,
    publicClient: deps.publicClient,
    store: deps.shares,
    relay: forward('/v1/relay'),
    relayInternal: forward(INTERNAL_RELAY_PATH),
  };
}

export async function handleRequest(request: Request, deps: AppDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const { pathname } = new URL(request.url);
  const parts = pathname.split('/').filter(Boolean);
  const { config, publicClient } = deps;
  try {
    if (parts[0] !== 'v1') throw new RequestError(404, 'not_found', `No route for ${request.method} ${pathname}`);
    const route = parts.slice(1);

    if (request.method === 'POST' && route.length === 1 && route[0] === 'relay') {
      return await deps.relay(request);
    }
    if (request.method === 'POST' && route.length === 1 && route[0] === 'shares') {
      return await createShare(shareDeps(request, deps), await readJsonBody(request, MAX_SHARE_BODY_BYTES));
    }
    if (request.method === 'POST' && route.length === 3 && route[0] === 'shares' && route[2] === 'open') {
      const reply = await openShare(shareDeps(request, deps), parseShareId(route[1]!), await readJsonBody(request));
      return json(reply.body, reply.status);
    }
    if (request.method !== 'GET') throw new RequestError(405, 'method_not_allowed', `${request.method} is not supported on ${pathname}`);

    if (route.length === 1 && route[0] === 'health') {
      const balance = deps.relayerAddress ? await publicClient.getBalance({ address: deps.relayerAddress }) : null;
      return json({
        ok: true,
        chainId: config.chain.id,
        chain: config.chain.name,
        relayer: deps.relayerAddress
          ? { address: deps.relayerAddress, balance: formatEther(balance!), symbol: config.chain.nativeCurrency.symbol }
          : null,
        storage: deps.storage,
      });
    }
    if (route.length === 1 && route[0] === 'chain') {
      return json({
        chainId: config.chain.id,
        name: config.chain.name,
        explorerUrl: config.explorerUrl,
        contracts: config.contracts,
        relayer: deps.relayerAddress,
      });
    }
    if (route.length === 2 && route[0] === 'keys') {
      return json(await readKey(publicClient, config, parseAddressParam(route[1]!)));
    }
    if (route.length === 3 && route[0] === 'nonces') {
      return json(await readNonce(publicClient, config, parseContractParam(route[1]!), parseAddressParam(route[2]!)));
    }
    if (route.length === 2 && route[0] === 'shares') {
      return json(await readShare(shareDeps(request, deps), parseShareId(route[1]!)));
    }
    if (route.length === 2 && route[0] === 'tx') {
      const record = deps.txIndex ? await deps.txIndex.get(route[1]!.toLowerCase()) : null;
      return json(await readTransaction(publicClient, config, route[1]!, record));
    }
    throw new RequestError(404, 'not_found', `No route for ${request.method} ${pathname}`);
  } catch (error) {
    return errorResponse(error);
  }
}
