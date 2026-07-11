/**
 * Zero-dependency PWA icon generator.
 * Produces public/icon-192.png and public/icon-512.png
 * using raw PNG encoding (IDAT with zlib deflate via Node's built-in zlib).
 *
 * Run: bun scripts/gen-icons.mjs
 */
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

// ── Minimal PNG encoder ────────────────────────────────────────────────────
function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crc = Buffer.allocUnsafe(4);
  crc.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function encodePNG(pixels, size) {
  // IHDR
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw scanlines with filter byte 0
  const raw = Buffer.allocUnsafe(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (1 + size * 3) + 1 + x * 3;
      raw[dst]   = pixels[src];     // R
      raw[dst+1] = pixels[src + 1]; // G
      raw[dst+2] = pixels[src + 2]; // B
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Icon painter ───────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

function paintIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blend over existing
    const fa = a / 255;
    pixels[i]   = Math.round(pixels[i]   * (1 - fa) + r * fa);
    pixels[i+1] = Math.round(pixels[i+1] * (1 - fa) + g * fa);
    pixels[i+2] = Math.round(pixels[i+2] * (1 - fa) + b * fa);
    pixels[i+3] = 255;
  }

  // Background: gradient from #7c3aed (purple) to #4f46e5 (indigo)
  const rounding = size * 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * size);
      const r = Math.round(lerp(0x7c, 0x4f, t));
      const g = Math.round(lerp(0x3a, 0x46, t));
      const b = Math.round(lerp(0xed, 0xe5, t));

      // Rounded corners (simple distance check)
      const dx = Math.max(rounding - x, 0, x - (size - 1 - rounding));
      const dy = Math.max(rounding - y, 0, y - (size - 1 - rounding));
      if (Math.sqrt(dx * dx + dy * dy) > rounding) continue;

      setPixel(x, y, r, g, b);
    }
  }

  // ── Map pin shape ──────────────────────────────────────────────────────
  // Draw filled shapes by testing each pixel
  const cx = size / 2;
  const headCy = size * 0.38;
  const headR  = size * 0.22;
  const tipY   = size * 0.76;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (pixels[i+3] === 0) continue; // outside rounded rect

      const dist = Math.sqrt((x - cx) ** 2 + (y - headCy) ** 2);

      // Pin head (white circle)
      if (dist <= headR) {
        // Inner hole (gradient colour)
        if (dist <= headR * 0.42) {
          const t = (x + y) / (2 * size);
          setPixel(x, y,
            Math.round(lerp(0x7c, 0x4f, t)),
            Math.round(lerp(0x3a, 0x46, t)),
            Math.round(lerp(0xed, 0xe5, t))
          );
        } else {
          setPixel(x, y, 255, 255, 255);
        }
        continue;
      }

      // Pin body: triangle below head
      if (y > headCy && y <= tipY) {
        const progress = (y - headCy) / (tipY - headCy);
        const halfWidth = headR * 0.78 * (1 - progress);
        if (Math.abs(x - cx) <= halfWidth) {
          setPixel(x, y, 255, 255, 255);
        }
      }
    }
  }

  return pixels;
}

// ── Generate & write ──────────────────────────────────────────────────────
mkdirSync("public", { recursive: true });

for (const size of [192, 512]) {
  const pixels = paintIcon(size);
  const png = encodePNG(pixels, size);
  writeFileSync(`public/icon-${size}.png`, png);
  console.log(`✓ public/icon-${size}.png (${png.length} bytes)`);
}
