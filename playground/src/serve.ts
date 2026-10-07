// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// The run page on this machine while a run is in progress (#32), for screen
// recording:
//
//   npm run playground -- serve [--port 4318] [--service-url <url>]
//
// serves the same page the service publishes (service/public/runs/ and the
// shared shell in service/public/site/) at http://127.0.0.1:<port>/runs/<id>,
// with each run's files read from <playground home>/runs/<id>/ as the runner
// writes them. The page reads them again every few seconds while the record
// says the run is going, so one page is both the live view and, once
// published, the record.
//
// What it serves goes through the publisher's replacement of local paths and
// the user name (publish.ts), with anything else that looks private masked,
// so the recording shows what the published page would. The on-chain check
// (GET /v1/chain, /v1/txs) is forwarded to the online service; /market and
// /preview redirect there. It listens on 127.0.0.1 only and answers GET only.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { repoRoot } from './home.ts';
import { isPng, stripPngMetadata } from './png.ts';
import { maskForDisplay, privacyContext, type PrivacyContext } from './publish.ts';
import { validateProvenance, type PlaygroundProvenance } from './provenance.ts';

/** The service's policy for its public pages (service/src/app.ts SITE_HEADERS). */
export const PAGE_HEADERS: Record<string, string> = {
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

const PUBLIC_DIR = join(repoRoot, 'service', 'public');
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
};

export interface ServeOptions {
  home: string;
  port?: number;
  /** The online service for the on-chain check; null to answer it with 503. */
  serviceUrl: string | null;
  ctx?: PrivacyContext;
  fetchImpl?: typeof fetch;
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...PAGE_HEADERS, ...extra });
  res.end(body);
}

const json = (res: ServerResponse, status: number, value: unknown) => send(res, status, JSON.stringify(value), TYPES['.json']!);
const notFound = (res: ServerResponse, what: string) => json(res, 404, { error: { code: 'not_found', message: what } });

/** A file under service/public, or null when the path leaves it or is missing. */
function publicFile(pathname: string): string | null {
  const file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(`${PUBLIC_DIR}/`) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function readRecord(home: string, runId: string): PlaygroundProvenance | null {
  try {
    const record = JSON.parse(readFileSync(join(home, 'runs', runId, 'provenance.json'), 'utf8'));
    return validateProvenance(record).length ? null : record;
  } catch {
    return null;
  }
}

/** Local runs, newest first, in the shape of the published index.json. */
export function localRunsIndex(home: string, ctx: PrivacyContext) {
  const dir = join(home, 'runs');
  const ids = existsSync(dir) ? readdirSync(dir).filter((id) => RUN_ID.test(id)) : [];
  const runs = ids.flatMap((id) => {
    const record = readRecord(home, id);
    if (!record) return [];
    const run = maskForDisplay(record.run, ctx);
    return [{
      id, title: run.scenario.title, startedAt: run.startedAt, endedAt: run.endedAt, status: run.status,
      chainId: run.network.chainId, dryRun: run.dryRun, fixture: id.startsWith('fixture-'), totals: record.totals,
    }];
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { schema: 'obelisk.playground.runs/1', runs };
}

/** events.jsonl as written so far, each complete line masked; a line still being written is left out. */
function maskedEvents(file: string, ctx: PrivacyContext): string {
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split('\n').slice(0, -1);
  return lines.map((line) => {
    try {
      return `${JSON.stringify(maskForDisplay(JSON.parse(line), ctx))}\n`;
    } catch {
      return '\n';
    }
  }).join('');
}

async function forward(res: ServerResponse, options: ServeOptions, path: string) {
  if (!options.serviceUrl) return json(res, 503, { error: { code: 'service_unavailable', message: 'No online service configured for the on-chain check' } });
  try {
    const upstream = await (options.fetchImpl ?? fetch)(`${options.serviceUrl}${path}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    send(res, upstream.status, Buffer.from(await upstream.arrayBuffer()), TYPES['.json']!);
  } catch (error) {
    json(res, 502, { error: { code: 'upstream_error', message: `The online service did not answer: ${(error as Error).message}` } });
  }
}

export async function handleLive(req: IncomingMessage, res: ServerResponse, options: ServeOptions) {
  const ctx = options.ctx ?? privacyContext(options.home);
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: { code: 'method_not_allowed', message: 'GET only' } });

  if (path === '/') return send(res, 302, '', 'text/plain', { location: '/runs' });
  if (path === '/v1/chain') return forward(res, options, '/v1/chain');
  if (path === '/v1/txs') return forward(res, options, `/v1/txs${url.search}`);
  if (/^\/(market|preview)(\/|$)/.test(path)) {
    return options.serviceUrl ? send(res, 302, '', 'text/plain', { location: `${options.serviceUrl}${path}` }) : notFound(res, path);
  }

  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'runs') {
    // The page itself for /runs and /runs/<id>.
    if (parts.length === 1 || (parts.length === 2 && !parts[1]!.includes('.'))) {
      return send(res, 200, readFileSync(join(PUBLIC_DIR, 'runs', 'index.html')), TYPES['.html']!);
    }
    if (parts.length === 2 && parts[1] === 'index.json') return json(res, 200, localRunsIndex(options.home, ctx));
    const runId = parts[1]!;
    if (parts.length >= 3 && RUN_ID.test(runId)) {
      const runDir = join(options.home, 'runs', runId);
      const rest = parts.slice(2).join('/');
      if (rest === 'provenance.json') {
        const record = readRecord(options.home, runId);
        return record ? json(res, 200, maskForDisplay(record, ctx)) : notFound(res, `run ${runId}`);
      }
      if (rest === 'events.jsonl') return send(res, 200, maskedEvents(join(runDir, 'events.jsonl'), ctx), TYPES['.jsonl']!);
      if (rest === 'published.json') return notFound(res, 'not published');
      if (/^screenshots\/[A-Za-z0-9][\w.-]*\.png$/.test(rest)) {
        // Only screenshots the record lists, and without their metadata.
        const record = readRecord(options.home, runId);
        const listed = record?.steps.some((step) => step.screenshots.some((shot) => shot.file === rest));
        const file = join(runDir, rest);
        if (!listed || !existsSync(file)) return notFound(res, rest);
        const bytes = readFileSync(file);
        return isPng(bytes) ? send(res, 200, stripPngMetadata(bytes).png, TYPES['.png']!) : notFound(res, rest);
      }
      return notFound(res, path);
    }
  }
  // The page's scripts and styles and the shared shell.
  if (/^\/(runs|site)\/[\w.-]+$/.test(path)) {
    const file = publicFile(path);
    if (file && TYPES[extname(file)]) return send(res, 200, readFileSync(file), TYPES[extname(file)]!);
  }
  return notFound(res, path);
}

export function startLiveServer(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    handleLive(req, res, options).catch((error: Error) => json(res, 500, { error: { code: 'internal', message: error.message } }));
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4318, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      resolveStart({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}
