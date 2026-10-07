// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CaptureUsageError, parseCaptureArgs, readinessScript, runCapture } from '../app/src/main/capture.ts';

const argv = (...args) => ['/path/to/electron', '.', '--capture', ...args];

test('capture is off unless --capture is given', () => {
  assert.equal(parseCaptureArgs(['/path/to/electron', '.']), null);
});

test('capture arguments are read with their defaults', () => {
  const request = parseCaptureArgs(argv('--route', '#/share', '--out', 'shots/a.png'), '/work');
  assert.deepEqual(request, {
    route: '/share', out: '/work/shots/a.png', width: 1440, height: 900, scale: 2, theme: 'dark',
    waitFor: null, scrollTo: null, timeoutMs: 20_000,
  });
  const full = parseCaptureArgs(argv('--route=/skills/minted/12', '--out=/tmp/b.png', '--width', '1280', '--height=800',
    '--scale', '1', '--wait-for', '[data-panel="scenes"]', '--scroll-to', '.trend', '--timeout', '5000'));
  assert.equal(full.route, '/skills/minted/12');
  assert.equal(full.width, 1280);
  assert.equal(full.scale, 1);
  assert.equal(full.waitFor, '[data-panel="scenes"]');
  assert.equal(full.scrollTo, '.trend');
  assert.equal(full.timeoutMs, 5000);
  assert.equal(parseCaptureArgs(argv('--route', 'playground', '--out', 'c.png')).route, '/playground');
});

test('bad capture arguments are refused with a reason', () => {
  for (const [args, message] of [
    [[], /--route is required/],
    [['--route', '#/share'], /--out is required/],
    [['--route', '#/share', '--out', 'a.jpg'], /\.png/],
    [['--route', '#/share', '--out', 'a.png', '--width', '20'], /--width/],
    [['--route', '#/share', '--out', 'a.png', '--theme', 'light'], /one theme/],
    [['--route', '#/share', '--out', 'a.png', '--colour', 'x'], /unknown option --colour/],
    [['--route', '#/a b', '--out', 'a.png'], /not an App route/],
    [['--route'], /--route needs a value/],
  ]) {
    assert.throws(() => parseCaptureArgs(argv(...args)), (error) => error instanceof CaptureUsageError && message.test(error.message), args.join(' '));
  }
});

test('the readiness check names the route and the selector it waits for', () => {
  const script = readinessScript({ route: '/skills/minted/12', waitFor: '.minted-detail' });
  assert.match(script, /"\/skills\/minted\/12"/);
  assert.match(script, /"\.minted-detail"/);
  assert.doesNotMatch(readinessScript({ route: '/share', waitFor: null }), /wait-for'/);
});

function fakeWindow(states, { png = Buffer.from('png'), empty = false } = {}) {
  const calls = { loaded: null, destroyed: false, scripts: 0 };
  return {
    calls,
    async loadURL(url) { calls.loaded = url; },
    webContents: {
      async executeJavaScript(code) {
        if (code.includes('captureState')) return states[Math.min(calls.scripts++, states.length - 1)];
        return true;
      },
      async capturePage() { return { toPNG: () => png, isEmpty: () => empty }; },
    },
    destroy() { calls.destroyed = true; },
  };
}

const request = (out, extra = {}) => ({ route: '/share', out, width: 1440, height: 900, scale: 2, theme: 'dark', waitFor: null, scrollTo: null, timeoutMs: 2000, ...extra });
const instant = { sleep: async () => {} };

test('a page is captured once it has rendered its data, and the PNG is written', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'obelisk-capture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const win = fakeWindow([{ ready: false, reason: 'ipc' }, { ready: false, reason: 'dom-quiet' }, { ready: true }]);
  const out = join(dir, 'nested', 'share.png');
  const result = await runCapture(win, 'file:///app/index.html', request(out), instant);
  assert.deepEqual(result, { code: 0, message: out });
  assert.equal(win.calls.loaded, 'file:///app/index.html#/share');
  assert.equal(win.calls.scripts, 3);
  assert.equal(readFileSync(out, 'utf8'), 'png');
  assert.equal(win.calls.destroyed, true);
});

test('a page that never renders fails with the reason, and writes nothing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'obelisk-capture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = 0;
  const timing = { now: () => clock, sleep: async (ms) => { clock += ms; } };
  const out = join(dir, 'x.png');
  const redirected = await runCapture(fakeWindow([{ ready: false, reason: 'route', hash: '/memory' }]), 'file:///app/index.html', request(out), timing);
  assert.equal(redirected.code, 1);
  assert.match(redirected.message, /did not stay on the route.*#\/memory/);
  clock = 0;
  const waiting = await runCapture(fakeWindow([{ ready: false, reason: 'wait-for' }]), 'file:///app/index.html', request(out, { waitFor: '.x' }), timing);
  assert.match(waiting.message, /--wait-for selector never appeared within 2000 ms/);
  const blank = await runCapture(fakeWindow([{ ready: true }], { empty: true }), 'file:///app/index.html', request(out), instant);
  assert.equal(blank.code, 1);
  assert.equal(existsSync(out), false);
});
