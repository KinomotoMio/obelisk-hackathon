// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// Builds the App icons from icon.svg (Obelisk's mark on a dark rounded
// square): icon.png at 1024×1024, used by the Linux packages and as the dock
// icon in development, and, with --icns on macOS, icon.icns for the macOS
// package. Run from app/:  npm run icons  (add -- --icns to rebuild the .icns)
//
// It runs under Electron, which renders the SVG; iconutil and sips (macOS)
// make the .icns.

import { app, BrowserWindow, nativeImage } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SIZE = 1024;
const withIcns = process.argv.includes('--icns');

/** icon.svg drawn on `background`, as raw BGRA at SIZE × SIZE. */
async function renderOn(background) {
  const work = mkdtempSync(join(tmpdir(), 'obelisk-icon-'));
  const page = join(work, 'icon.html');
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:${background}">
    <img src="${pathToFileURL(join(here, 'icon.svg')).href}" width="${SIZE}" height="${SIZE}" style="display:block">
  </body></html>`);
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, webPreferences: { offscreen: true } });
  try {
    await win.loadFile(page);
    await win.webContents.executeJavaScript('document.images[0].decode()');
    // The first frames can come before the image is drawn; take the first full one.
    let image = null;
    for (let attempt = 0; attempt < 40 && (!image || image.isEmpty()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      image = await new Promise((resolve) => {
        win.webContents.once('paint', (_event, _dirty, frame) => resolve(frame));
        win.webContents.invalidate();
      });
    }
    if (!image || image.isEmpty()) throw new Error('Electron did not render icon.svg');
    // An offscreen frame follows the display's scale; the icon is exactly SIZE.
    return image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toBitmap();
  } finally {
    win.destroy();
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * The icon with its real transparency (the margin and the soft shadow): drawn
 * once on black and once on white, a pixel's alpha is how much of the
 * background shows through, and its colour is what it adds on black.
 */
async function renderPng() {
  const black = await renderOn('#000');
  const white = await renderOn('#fff');
  const out = Buffer.alloc(black.length);
  for (let i = 0; i < black.length; i += 4) {
    const seen = ((white[i] - black[i]) + (white[i + 1] - black[i + 1]) + (white[i + 2] - black[i + 2])) / 3;
    const alpha = Math.max(0, Math.min(255, 255 - seen));
    for (let c = 0; c < 3; c += 1) out[i + c] = alpha === 0 ? 0 : Math.min(255, Math.round((black[i + c] * 255) / alpha));
    out[i + 3] = Math.round(alpha);
  }
  return nativeImage.createFromBitmap(out, { width: SIZE, height: SIZE }).toPNG();
}

function buildIcns(png) {
  const work = mkdtempSync(join(tmpdir(), 'obelisk-icon-'));
  try {
    const source = join(work, 'source.png');
    writeFileSync(source, png);
    const iconset = join(work, 'icon.iconset');
    execFileSync('mkdir', [iconset]);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const px = size * scale;
        const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        execFileSync('sips', ['-z', String(px), String(px), source, '--out', join(iconset, name)], { stdio: 'ignore' });
      }
    }
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(here, 'icon.icns')]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const png = await renderPng();
    writeFileSync(join(here, 'icon.png'), png);
    console.log(`wrote build/icon.png (${SIZE}×${SIZE})`);
    if (withIcns) {
      if (process.platform !== 'darwin') throw new Error('--icns needs macOS (iconutil)');
      buildIcns(png);
      console.log('wrote build/icon.icns');
    }
    app.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    app.exit(1);
  }
});
