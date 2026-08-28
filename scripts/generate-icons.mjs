// Generates the PWA / favicon PNGs into app/ as static metadata files.
//
// Written by hand rather than with @vercel/og (which crashes on Windows during
// `next build`) or an image dependency. Run it only when the mark changes:
//
//   node scripts/generate-icons.mjs
//
// Output: app/icon.png (512, favicon + manifest) and app/apple-icon.png (180,
// iOS home screen). Both are committed — the build does not run this.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

const BG = [0x0a, 0x0a, 0x0a]; // --background
const FG = [0x00, 0xe6, 0x76]; // --accent

// ── PNG encoding ──────────────────────────────────────────────
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  // 10-12: compression, filter, interlace — all 0

  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 3;
      const dst = rowStart + 1 + x * 3;
      raw[dst] = rgb[src];
      raw[dst + 1] = rgb[src + 1];
      raw[dst + 2] = rgb[src + 2];
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── The mark ──────────────────────────────────────────────────
// A "U": two vertical bars joined by a semicircular annulus at the bottom.
// Coordinates are normalised to [-1, 1] with y pointing up, so the shape
// scales to any icon size. Sampled 4x4 per pixel for antialiasing.
function insideU(x, y) {
  const OUTER = 0.5; // outer half-width of the U
  const INNER = 0.28; // inner half-width — the difference is the stroke
  const TOP = 0.62; // where the bars stop
  const ARC_Y = -0.16; // centre of the bottom arc

  if (y > TOP) return false;
  if (y >= ARC_Y) {
    const ax = Math.abs(x);
    return ax >= INNER && ax <= OUTER;
  }
  const d = Math.hypot(x, y - ARC_Y);
  return d >= INNER && d <= OUTER;
}

function render(size) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 4; // supersampling factor
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // Map pixel to [-1, 1], flipping y so positive is up.
          const x = ((px + (sx + 0.5) / SS) / size) * 2 - 1;
          const y = 1 - ((py + (sy + 0.5) / SS) / size) * 2;
          if (insideU(x, y)) hits++;
        }
      }
      const a = hits / (SS * SS);
      const i = (py * size + px) * 3;
      for (let c = 0; c < 3; c++) {
        rgb[i + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
      }
    }
  }
  return rgb;
}

for (const [name, size] of [["icon.png", 512], ["apple-icon.png", 180]]) {
  const file = join(OUT_DIR, name);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${name} (${size}x${size})`);
}
