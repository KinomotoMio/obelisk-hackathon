// Copyright (C) 2026 tommy0103 and contributors.
// SPDX-License-Identifier: AGPL-3.0-only

// PNG helpers for publishing a run (#32): drop the metadata chunks a
// screenshot could carry (text, EXIF, time) before it leaves the machine, and
// draw the stand-in screenshots of the fixture run.

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Chunks a picture needs; everything else (tEXt, zTXt, iTXt, eXIf, tIME, …) is dropped. */
const KEEP = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs']);

export function isPng(bytes: Buffer): boolean {
  return bytes.length > 8 && bytes.subarray(0, 8).equals(SIGNATURE);
}

/** The PNG with only the chunks in KEEP, and the names of the chunks it dropped. */
export function stripPngMetadata(bytes: Buffer): { png: Buffer; dropped: string[] } {
  if (!isPng(bytes)) throw new Error('not a PNG file');
  const parts: Buffer[] = [SIGNATURE];
  const dropped: string[] = [];
  let at = 8;
  let ended = false;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length) throw new Error(`PNG chunk ${type} runs past the end of the file`);
    if (KEEP.has(type)) parts.push(bytes.subarray(at, end));
    else dropped.push(type);
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Error('PNG file has no IEND chunk');
  if (at < bytes.length) dropped.push('trailing bytes');
  return { png: Buffer.concat(parts), dropped };
}

// --- Encoding ----------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

type Rgb = [number, number, number];

/** A canvas of RGB pixels with filled rectangles; encodes to PNG. */
export class Canvas {
  readonly pixels: Buffer;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number, background: Rgb) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, background);
  }

  rect(x: number, y: number, w: number, h: number, [r, g, b]: Rgb) {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row++) {
      for (let col = Math.max(0, x); col < Math.min(this.width, x + w); col++) {
        const i = (row * this.width + col) * 3;
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
      }
    }
  }

  /** Upper-case letters, digits and spaces in a 5×7 bitmap font, `scale` pixels per dot. */
  text(x: number, y: number, value: string, scale: number, color: Rgb) {
    let left = x;
    for (const ch of value.toUpperCase()) {
      const glyph = FONT[ch];
      if (glyph) {
        glyph.forEach((line, row) => {
          for (let col = 0; col < 5; col++) if (line & (1 << (4 - col))) this.rect(left + col * scale, y + row * scale, scale, scale, color);
        });
      }
      left += 6 * scale;
    }
  }

  png(): Buffer {
    const raw = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let row = 0; row < this.height; row++) {
      raw[row * (this.width * 3 + 1)] = 0;
      this.pixels.copy(raw, row * (this.width * 3 + 1) + 1, row * this.width * 3, (row + 1) * this.width * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
}

export function pngWithText(png: Buffer, keyword: string, value: string): Buffer {
  const at = png.length - 12; // before IEND
  return Buffer.concat([png.subarray(0, at), chunk('tEXt', Buffer.from(`${keyword}\u0000${value}`, 'latin1')), png.subarray(at)]);
}

// 5×7 glyphs, one number per row, high bit on the left.
const FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31], M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12], '-': [0, 0, 0, 31, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10],
};

const BG: Rgb = [13, 14, 24];
const PANEL: Rgb = [24, 26, 40];
const LINE: Rgb = [38, 41, 60];
const ACCENT: Rgb = [167, 139, 250];
const WARN: Rgb = [251, 191, 36];

/**
 * A stand-in screenshot for the fixture run: an App-shaped layout with
 * FIXTURE written across it, so it cannot pass for a real capture.
 */
export function fixtureScreenshot(label: string, variant = 0): Buffer {
  const c = new Canvas(1280, 800, BG);
  c.rect(0, 0, 232, 800, [17, 18, 30]);
  c.rect(232, 0, 1, 800, LINE);
  for (let i = 0; i < 7; i++) c.rect(24, 92 + i * 40, i === variant % 7 ? 184 : 120 + ((i * 37) % 60), 14, i === variant % 7 ? ACCENT : LINE);
  c.rect(24, 32, 120, 22, [60, 52, 98]);
  c.rect(272, 40, 420, 22, [70, 72, 96]);
  c.rect(272, 76, 260, 12, LINE);
  for (let i = 0; i < 3; i++) {
    c.rect(272 + i * 316, 120, 296, 120, PANEL);
    c.rect(292 + i * 316, 144, 90, 10, LINE);
    c.rect(292 + i * 316, 176, 60 + ((variant + i) * 29) % 120, 34, i === 1 ? [56, 189, 248] : [92, 94, 120]);
  }
  for (let i = 0; i < 6; i++) {
    c.rect(272, 272 + i * 56, 928, 44, PANEL);
    c.rect(292, 288 + i * 56, 200 + ((variant * 53 + i * 71) % 380), 12, i === 0 ? ACCENT : [70, 72, 96]);
    c.rect(1100, 286 + i * 56, 80, 16, i % 3 === 0 ? [40, 90, 60] : LINE);
  }
  // The band that says what this is.
  c.rect(272, 640, 928, 120, [58, 46, 12]);
  c.rect(272, 640, 928, 4, WARN);
  c.text(300, 668, 'FIXTURE', 9, WARN);
  c.text(760, 676, label.slice(0, 14), 5, [250, 235, 190]);
  c.text(760, 722, 'NOT A REAL RUN', 3, [220, 190, 120]);
  return c.png();
}
