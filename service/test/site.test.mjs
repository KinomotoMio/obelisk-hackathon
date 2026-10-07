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
  assert.deepEqual(Object.keys(SITE_PAGES), ['market', 'preview', 'runs', 'operations']);
});

test('the shared shell builds no markup from strings and loads nothing from elsewhere', () => {
  for (const file of readdirSync(new URL('../public/site/', import.meta.url))) {
    const source = readFileSync(new URL(`../public/site/${file}`, import.meta.url), 'utf8');
    if (file.endsWith('.js')) assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, file);
    assert.doesNotMatch(source, /https?:\/\/(?!www\.w3\.org)/, `${file} loads nothing from another origin`);
  }
});

test('the market page uses the shared shell, builds no markup from strings, and labels every stage 2 figure', () => {
  const dir = new URL('../public/market/', import.meta.url);
  const html = readFileSync(new URL('index.html', dir), 'utf8');
  assert.match(html, /<link rel="stylesheet" href="\/site\/site\.css">\s*<link rel="stylesheet" href="\/market\/market\.css">/);
  assert.match(html, /<script type="module" src="\/market\/app\.js"><\/script>/);
  assert.match(html, /<a href="\/market" aria-current="page">Skill 市场<\/a>/);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    if (file.endsWith('.js')) assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, file);
    assert.doesNotMatch(source, /(?:src|href)=["']https?:|fetch\(['"`]https?:|url\(['"]?https?:/, `${file} loads nothing from another origin`);
  }
  const stage2 = readFileSync(new URL('stage2.js', dir), 'utf8');
  assert.match(stage2, /'阶段 2 预览'/);
  assert.match(stage2, /h\('div', \{ class: 'kpi-label' \}, label, example\(\)\)/, 'each income card is labeled 示例');
  assert.match(stage2, /'0\.5 BOT \/ 次', example\(\)/, 'the example price is labeled');
  assert.match(stage2, /表中金额和时间都是示例，没有对应的真实交易/, 'the income table says its rows are examples');
  assert.doesNotMatch(stage2, /href: [^)]*tx\//, 'no example row links to a transaction');
  assert.match(readFileSync(new URL('split.js', dir), 'utf8'), /'示例'/);
  assert.match(readFileSync(new URL('api.js', dir), 'utf8'), /fetch\(path, \{ headers: \{ accept: 'application\/json' \} \}\)/, 'reads go to this service only');
});
