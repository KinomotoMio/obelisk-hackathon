// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// HTTP surface of the online service. Kept free of Cloudflare runtime imports
// so the same routing runs under `node --test` with in-memory bindings.
//
//   GET  /v1/health                     chain, relay wallet balance, storage bindings
//   GET  /v1/chain                      chain id, explorer, public RPC, currency, contract addresses, relay wallet
//   GET  /v1/keys/:address              KeyRegistry record + next RegisterKey nonce
//   GET  /v1/nonces/:contract/:address  next signature nonce on any Obelisk contract
//   GET  /v1/tx/:hash                   status of a relayed transaction
//   POST /v1/relay                      { action, message, signature } -> submitted on chain
//   POST /v1/shares                     upload a share's ciphertext + key package, relay CreateShare
//   GET  /v1/shares/:id                 a share's on-chain rules, status, and receipts
//   POST /v1/shares/:id/open            recipient-signed RecordOpen -> receipt on chain, then the key package
//   POST /v1/shares/:id/revoke          sender-signed RevokeShare -> relayed, transaction kept with the share
//   GET  /s/:shareId, /activate         the web reader page (public/reader, #10)
//   GET  /market/…, /preview/…          public web pages (public/<page>/index.html; SITE_PAGES)
//   GET  /v1/skills                     minted Skills, newest first, for the market (market.ts)
//   GET  /v1/skills/:ref                minted Skill version + stored body (skills.ts)
//   POST /v1/skills/:fingerprint/content store a minted version's body (skills.ts)
//   GET  /v1/skills/:id/lineage         the family tree a Skill belongs to (skills.ts)
//   GET  /v1/skills/:id/usage           a Skill's usage across its versions (usage.ts)
//   GET  /v1/usage/:fingerprint         one version's usage; ?wallet= adds that wallet's report (usage.ts)
//
// The service never sees plaintext content and does nothing that needs AI.

import { formatEther, type Address, type PublicClient } from 'viem';

import { RequestError } from './actions.ts';
import { localDevChain, type ServiceChainConfig } from './chains.ts';
import { parseAddressParam, parseContractParam, readKey, readNonce, readTransaction } from './reads.ts';
import type { Relayer, RelayRecord } from './relayer.ts';
import { createShare, MAX_SHARE_BODY_BYTES, openShare, parseShareId, readShare, revokeShare, type ShareDeps, type ShareStore } from './shares.ts';
import { readSkillList } from './market.ts';
import { handleSkillRoute, type SkillContentStore } from './skills.ts';
import { handleUsageRoute, type UsageTrendStore } from './usage.ts';

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
  /** Minted Skill bodies (R2); null when no bucket is bound. */
  skillContent?: SkillContentStore | null;
  /** What relayed usage reports added, for trends (KV); null when unbound. */
  usageTrend?: UsageTrendStore | null;
  /** The web reader's HTML (public/reader/index.html); absent when assets are not bound. */
  readerPage?: () => Promise<Response>;
  /** A public page's HTML from the assets binding, by asset path (SITE_PAGES); absent when assets are not bound. */
  sitePage?: (path: string) => Promise<Response>;
}

/**
 * The reader handles shared content and wallet signatures, so it gets a
 * strict policy: only its own scripts and styles, requests only to this
 * service, never framed, and no referrer, so a share link does not leak to
 * the block explorer it links to.
 */
export const READER_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function isReaderPath(parts: string[]): boolean {
  return (parts.length === 2 && parts[0] === 's') || (parts.length === 1 && parts[0] === 'activate');
}

/**
 * Public pages for people outside the App (judges, investors, buyers): the
 * Skill market (#35) and the investor preview (#33). Each owns one path
 * segment; every extension-less path under it returns the page's index.html,
 * which routes on the client. Their scripts, styles, and the shared shell in
 * public/site/ are files, so the assets binding serves them before the Worker
 * runs. They read only this service's public GET API (same origin).
 */
export const SITE_PAGES: Readonly<Record<string, string>> = {
  market: '/market/index.html',
  preview: '/preview/index.html',
};

/** The reader's policy (same origin only, never framed), revalidated on each visit. */
export const SITE_HEADERS = { ...READER_HEADERS, 'cache-control': 'no-cache' };

function sitePagePath(parts: string[]): string | null {
  const page = parts[0] !== undefined && Object.hasOwn(SITE_PAGES, parts[0]) ? SITE_PAGES[parts[0]]! : null;
  if (!page || parts.slice(1).some((part) => part.includes('.'))) return null;
  return page;
}

async function sitePageResponse(deps: AppDeps, path: string): Promise<Response> {
  if (!deps.sitePage) throw new RequestError(503, 'page_unavailable', 'This service has no web page assets bound (ASSETS)');
  const page = await deps.sitePage(path);
  if (page.status === 404) throw new RequestError(404, 'not_found', `This service has no page at ${path.replace(/\/index\.html$/, '')}`);
  if (!page.ok) throw new RequestError(502, 'page_unavailable', `The page could not be loaded (HTTP ${page.status})`);
  return new Response(page.body, { status: 200, headers: SITE_HEADERS });
}

async function readerResponse(deps: AppDeps): Promise<Response> {
  if (!deps.readerPage) throw new RequestError(503, 'reader_unavailable', 'This service has no web reader assets bound (ASSETS)');
  const page = await deps.readerPage();
  if (!page.ok) throw new RequestError(502, 'reader_unavailable', `The web reader page could not be loaded (HTTP ${page.status})`);
  return new Response(page.body, { status: 200, headers: READER_HEADERS });
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
    if ((request.method === 'GET' || request.method === 'HEAD') && isReaderPath(parts)) return await readerResponse(deps);
    const sitePath = request.method === 'GET' || request.method === 'HEAD' ? sitePagePath(parts) : null;
    if (sitePath) return await sitePageResponse(deps, sitePath);
    if (parts[0] !== 'v1') throw new RequestError(404, 'not_found', `No route for ${request.method} ${pathname}`);
    const route = parts.slice(1);

    if (request.method === 'GET' && route.length === 1 && route[0] === 'skills') return json(await readSkillList(deps, new URL(request.url).searchParams));
    const usageResult = await handleUsageRoute(request, route, deps);
    if (usageResult !== null) return json(usageResult);
    const skillResult = await handleSkillRoute(request, route, deps);
    if (skillResult !== null) return json(skillResult);

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
    if (request.method === 'POST' && route.length === 3 && route[0] === 'shares' && route[2] === 'revoke') {
      const reply = await revokeShare(shareDeps(request, deps), parseShareId(route[1]!), await readJsonBody(request));
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
        // For a browser wallet to add the network. Never RPC_URL, which may carry a key.
        rpcUrl: config.chain.id === localDevChain.id ? config.rpcUrl : config.chain.rpcUrls.default.http[0],
        nativeCurrency: config.chain.nativeCurrency,
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
