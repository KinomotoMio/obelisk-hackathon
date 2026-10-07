// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.

// Public web pages (#35 market, #33 investor preview): routing and the shared
// shell in public/site/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import { handleRequest, SITE_PAGES } from '../src/app.ts';
import { resolveChainConfig } from '../src/chains.ts';

const deps = (sitePage) => ({
  config: resolveChainConfig({ CHAIN_ID: '968' }), publicClient: null, relayerAddress: null, txIndex: null,
  storage: { kv: false, r2: false }, shares: null, relay: null, sitePage,
});

test('every path under a public page returns its index.html with the strict headers; files and unknown pages do not', async () => {
  const served = [];
  const assets = async (path) => {
    served.push(path);
    return path === '/market/index.html' ? new Response('<!doctype html><title>market</title>') : new Response('missing', { status: 404 });
  };
  for (const path of ['/market', '/market/', '/market/skills/7', '/market/skills/7/']) {
    const response = await handleRequest(new Request(`http://service.test${path}`), deps(assets));
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.equal(await response.text(), '<!doctype html><title>market</title>');
  }
  assert.deepEqual([...new Set(served)], ['/market/index.html']);

  const absent = await handleRequest(new Request('http://service.test/preview'), deps(assets));
  assert.equal(absent.status, 404, 'a page whose files are not deployed yet');
  assert.equal((await absent.json()).error.code, 'not_found');
  assert.equal((await handleRequest(new Request('http://service.test/market/app.js'), deps(assets))).status, 404, 'files are the assets binding’s, not pages');
  assert.equal((await handleRequest(new Request('http://service.test/marketplace'), deps(assets))).status, 404);
  assert.equal((await handleRequest(new Request('http://service.test/market', { method: 'POST' }), deps(assets))).status, 404);
  const unbound = await handleRequest(new Request('http://service.test/market'), deps(undefined));
  assert.equal(unbound.status, 503);
  assert.equal((await unbound.json()).error.code, 'page_unavailable');
  assert.deepEqual(Object.keys(SITE_PAGES), ['market', 'preview']);
});

test('the shared shell builds no markup from strings and loads nothing from elsewhere', () => {
  for (const file of readdirSync(new URL('../public/site/', import.meta.url))) {
    const source = readFileSync(new URL(`../public/site/${file}`, import.meta.url), 'utf8');
    if (file.endsWith('.js')) assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, file);
    assert.doesNotMatch(source, /https?:\/\/(?!www\.w3\.org)/, `${file} loads nothing from another origin`);
  }
});
