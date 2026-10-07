// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Headless capture: one App page as a PNG, for the Playground's key
// screenshots (#32, docs/vision/09 G4) and anything else that needs a picture
// of a page without a person at the screen.
//
//   electron . --capture --route '#/share' --out shot.png
//              [--width 1440] [--height 900] [--scale 2] [--theme dark]   (PNG is width×scale by height×scale)
//              [--wait-for '<css selector>'] [--scroll-to '<css selector>']
//              [--timeout 20000]
//
// The App runs with whatever OBELISK_HOME it is given and opens no window on
// screen, starts no indexer and no watcher: it reads that data directory's
// index and files as they are. Like the recap export, the page is rendered in
// an offscreen window and captured with capturePage().
//
// "Rendered its data" is detected, not slept for: the route must be the one
// asked for (an unknown route redirects and fails), every IPC call the page
// made must have settled, and the DOM must have stopped changing for a quiet
// interval; --wait-for adds a selector that must be present. Exit codes: 0
// written, 1 the page did not render in time or could not be written, 2 bad
// arguments.

import fs from 'node:fs';
import path from 'node:path';

export interface CaptureRequest {
  route: string;
  out: string;
  width: number;
  height: number;
  scale: number;
  theme: 'dark';
  waitFor: string | null;
  scrollTo: string | null;
  timeoutMs: number;
}

export class CaptureUsageError extends Error {}

const FLAGS = new Set(['--route', '--out', '--width', '--height', '--scale', '--theme', '--wait-for', '--scroll-to', '--timeout']);

function int(value: string | undefined, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new CaptureUsageError(`${flag} must be an integer from ${min} to ${max}`);
  return n;
}

/** The capture request in argv, or null when the App was not started with --capture. */
export function parseCaptureArgs(argv: string[], cwd = process.cwd()): CaptureRequest | null {
  const start = argv.indexOf('--capture');
  if (start === -1) return null;
  const values = new Map<string, string>();
  for (let i = start + 1; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (!FLAGS.has(flag)) {
      if (arg.startsWith('--')) throw new CaptureUsageError(`unknown option ${arg}`);
      continue;
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined || value === '') throw new CaptureUsageError(`${flag} needs a value`);
    values.set(flag, value);
  }
  const rawRoute = values.get('--route');
  if (!rawRoute) throw new CaptureUsageError('--route is required, e.g. --route "#/share"');
  const route = `/${rawRoute.replace(/^#?\/?/, '')}`;
  if (!/^\/[A-Za-z0-9/_.~:%@!$&'()*+,;=?-]*$/.test(route)) throw new CaptureUsageError(`--route is not an App route: ${rawRoute}`);
  const rawOut = values.get('--out');
  if (!rawOut) throw new CaptureUsageError('--out is required, e.g. --out screenshots/03-share.png');
  if (!rawOut.toLowerCase().endsWith('.png')) throw new CaptureUsageError('--out must name a .png file');
  const theme = values.get('--theme') ?? 'dark';
  if (theme !== 'dark') throw new CaptureUsageError('--theme: the App has one theme, dark');
  return {
    route,
    out: path.resolve(cwd, rawOut),
    width: values.has('--width') ? int(values.get('--width'), '--width', 800, 3840) : 1440,
    height: values.has('--height') ? int(values.get('--height'), '--height', 500, 2400) : 900,
    scale: values.has('--scale') ? int(values.get('--scale'), '--scale', 1, 3) : 2,
    theme,
    waitFor: values.get('--wait-for') ?? null,
    scrollTo: values.get('--scroll-to') ?? null,
    timeoutMs: values.has('--timeout') ? int(values.get('--timeout'), '--timeout', 1000, 300_000) : 20_000,
  };
}

/** How long the page's IPC and DOM must both be quiet before it counts as rendered. */
export const QUIET_MS = 500;

// Evaluated in the page: whether it shows the requested route with its data.
// window.obelisk.captureState() counts the page's IPC calls (preload).
export function readinessScript(request: Pick<CaptureRequest, 'route' | 'waitFor'>, quietMs = QUIET_MS): string {
  return `(() => {
    const want = ${JSON.stringify(request.route.split('?')[0])};
    const hash = decodeURIComponent(location.hash.replace(/^#/, '').split('?')[0]);
    if (!window.__obeliskCaptureDom) {
      window.__obeliskCaptureDom = { changedAt: Date.now() };
      new MutationObserver(() => { window.__obeliskCaptureDom.changedAt = Date.now(); })
        .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    if (hash !== decodeURIComponent(want)) return { ready: false, reason: 'route', hash };
    if (!document.querySelector('#app')?.children.length) return { ready: false, reason: 'mount' };
    const ipc = window.obelisk?.captureState?.() ?? { pending: 0, settledAt: 0 };
    const now = Date.now();
    if (ipc.pending > 0) return { ready: false, reason: 'ipc', pending: ipc.pending };
    if (now - ipc.settledAt < ${quietMs}) return { ready: false, reason: 'ipc-quiet' };
    if (now - window.__obeliskCaptureDom.changedAt < ${quietMs}) return { ready: false, reason: 'dom-quiet' };
    ${request.waitFor ? `if (!document.querySelector(${JSON.stringify(request.waitFor)})) return { ready: false, reason: 'wait-for' };` : ''}
    if (document.fonts && document.fonts.status !== 'loaded') return { ready: false, reason: 'fonts' };
    return { ready: true };
  })()`;
}

const REASONS: Record<string, string> = {
  route: 'the App did not stay on the route (unknown routes redirect)',
  mount: 'the App did not mount',
  ipc: 'the page was still loading data',
  'ipc-quiet': 'the page kept loading data',
  'dom-quiet': 'the page kept changing',
  'wait-for': 'the --wait-for selector never appeared',
  fonts: 'fonts were still loading',
};

interface CapturedImage {
  toPNG(): Buffer;
  isEmpty(): boolean;
  getSize?(): { width: number; height: number };
  resize?(options: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): CapturedImage;
}

interface CaptureWindow {
  loadURL(url: string): Promise<void>;
  webContents: {
    invalidate?(): void;
    once?(event: 'paint', listener: () => void): unknown;
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
    capturePage(rect?: { x: number; y: number; width: number; height: number }): Promise<CapturedImage>;
  };
  destroy(): void;
}

async function freshPaint(win: CaptureWindow, sleep: (ms: number) => Promise<unknown>) {
  const contents = win.webContents;
  if (!contents.invalidate || !contents.once) return;
  // Two paints: the first may still carry the frame that was in flight.
  for (let i = 0; i < 2; i++) {
    const painted = new Promise<void>((resolve) => contents.once!('paint', () => resolve()));
    contents.invalidate();
    await Promise.race([painted, sleep(1000)]);
  }
}

/**
 * Render `request.route` in `win` (loaded from `pageUrl`, the renderer's
 * index.html) and write the PNG. Resolves to an exit code and a message.
 */
export async function runCapture(
  win: CaptureWindow,
  pageUrl: string,
  request: CaptureRequest,
  { now = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)) } = {},
): Promise<{ code: number; message: string }> {
  try {
    await win.loadURL(`${pageUrl}#${request.route}`);
    const deadline = now() + request.timeoutMs;
    const script = readinessScript(request);
    let last: { ready?: boolean; reason?: string; hash?: string } = {};
    while (now() < deadline) {
      last = (await win.webContents.executeJavaScript(script, true)) as typeof last;
      if (last.ready) break;
      await sleep(100);
    }
    if (!last.ready) {
      const why = REASONS[last.reason ?? ''] ?? 'the page did not render';
      const where = last.reason === 'route' ? ` (ended at #${last.hash})` : '';
      return { code: 1, message: `capture failed: ${why}${where} within ${request.timeoutMs} ms` };
    }
    if (request.scrollTo) {
      const found = await win.webContents.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(request.scrollTo)});
        if (!el) return false;
        el.scrollIntoView({ block: 'start' });
        return true;
      })()`, true);
      if (!found) return { code: 1, message: `capture failed: --scroll-to ${request.scrollTo} matched nothing` };
      // One frame for the scroll to paint.
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))', true);
    }
    // An offscreen window keeps its last painted frame; ask for a fresh one so
    // the capture shows the page as it is now, not as it first painted.
    await freshPaint(win, sleep);
    let image = await win.webContents.capturePage({ x: 0, y: 0, width: request.width, height: request.height });
    if (image.isEmpty()) return { code: 1, message: 'capture failed: the page captured empty' };
    // capturePage() follows the display's scale; the PNG follows --scale.
    const size = { width: request.width * request.scale, height: request.height * request.scale };
    const actual = image.getSize?.();
    if (actual && image.resize && (actual.width !== size.width || actual.height !== size.height)) {
      image = image.resize({ ...size, quality: 'best' });
    }
    fs.mkdirSync(path.dirname(request.out), { recursive: true });
    fs.writeFileSync(request.out, image.toPNG());
    return { code: 0, message: request.out };
  } catch (error) {
    return { code: 1, message: `capture failed: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    win.destroy();
  }
}
