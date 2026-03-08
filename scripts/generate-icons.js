#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates PNG icon files required by the Chrome extension manifest from the
 * master SVG source at public/icons/icon.svg.
 *
 * Run once before loading the extension in Chrome:
 *   node scripts/generate-icons.js
 *
 * Dependencies: none (uses Node built-ins to create minimal PNGs without
 * external packages).  For pixel-perfect rendering from the SVG, install
 * 'sharp' and the script will use it automatically:
 *   npm install --save-dev sharp
 *
 * Output: public/icons/icon16.png, icon32.png, icon48.png, icon128.png
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');
const SIZES     = [16, 32, 48, 128];

// ---------------------------------------------------------------------------
// Try to use sharp if available (high-quality SVG rendering)
// ---------------------------------------------------------------------------

async function generateWithSharp() {
  const sharp = require('sharp');
  const svgPath = path.join(ICONS_DIR, 'icon.svg');
  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`✓ Generated ${outPath}`);
  }
}

// ---------------------------------------------------------------------------
// Fallback: generate minimal valid PNG programmatically (solid colour)
// ---------------------------------------------------------------------------

/**
 * Creates a PNG file buffer for a solid-colour square using only Node built-ins.
 * Colours match the SVG design: indigo background with a white microphone.
 *
 * @param {number} size       - Pixel dimension (square).
 * @param {number[]} bg       - Background RGB [r, g, b].
 */
function createSolidPng(size, bg) {
  const [r, g, b] = bg;

  // Build raw image data: one filter byte (0 = None) + RGB pixels per row.
  const rowSize   = 1 + size * 3;
  const rawData   = Buffer.allocUnsafe(size * rowSize);

  for (let y = 0; y < size; y++) {
    const base = y * rowSize;
    rawData[base] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const offset = base + 1 + x * 3;
      rawData[offset]     = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // --- PNG chunks ---
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(size, 0);   // width
  ihdrData.writeUInt32BE(size, 4);   // height
  ihdrData.writeUInt8(8,  8);        // bit depth
  ihdrData.writeUInt8(2,  9);        // colour type: RGB
  ihdrData.writeUInt8(0, 10);        // compression
  ihdrData.writeUInt8(0, 11);        // filter
  ihdrData.writeUInt8(0, 12);        // interlace

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const lenBuf  = Buffer.allocUnsafe(4);
  const typeBuf = Buffer.from(type, 'ascii');
  lenBuf.writeUInt32BE(data.length);
  const crcVal  = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf  = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crcVal >>> 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// CRC-32 implementation (IEEE polynomial) — no external deps.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  // Attempt high-quality generation via sharp first.
  try {
    await generateWithSharp();
    console.log('\nAll icons generated using sharp (high quality).');
    return;
  } catch {
    console.log(
      'sharp not available — generating placeholder PNG icons.\n' +
      'Run `npm install --save-dev sharp` and re-run this script for SVG-quality icons.\n'
    );
  }

  // Fallback: indigo solid-colour PNGs that match the brand.
  const INDIGO = [79, 70, 229]; // #4f46e5
  for (const size of SIZES) {
    const outPath = path.join(ICONS_DIR, `icon${size}.png`);
    const buffer  = createSolidPng(size, INDIGO);
    fs.writeFileSync(outPath, buffer);
    console.log(`✓ Generated placeholder ${outPath} (${size}×${size})`);
  }

  console.log(
    '\nPlaceholder icons written.\n' +
    'Install sharp and re-run to get the actual microphone icon.'
  );
}

main().catch((err) => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
