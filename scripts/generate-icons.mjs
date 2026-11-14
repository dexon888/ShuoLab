// Generates the PWA icons in public/icons with no image dependencies.
// The mark is a white speech bubble on cobalt with a red seal square.
// Run with `pnpm icons`; the PNG output is committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const COBALT = [27, 58, 140];
const WHITE = [255, 255, 255];
const SEAL = [196, 38, 29];

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
  return out;
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt((x + 0.5) / size, (y + 0.5) / size);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** `scale` shrinks the mark towards the centre for maskable safe zones. */
function mark(scale) {
  return (u, v) => {
    const x = (u - 0.5) / scale + 0.5;
    const y = (v - 0.5) / scale + 0.5;
    if (inRoundedRect(x, y, 0.62, 0.52, 0.76, 0.66, 0.02)) return SEAL;
    const bubble = inRoundedRect(x, y, 0.18, 0.2, 0.82, 0.7, 0.12);
    // Tail: a triangle under the bubble's lower-left.
    const tail = y >= 0.69 && y <= 0.84 && x >= 0.28 && x <= 0.28 + (0.84 - y) * 1.1;
    return bubble || tail ? WHITE : COBALT;
  };
}

const dir = fileURLToPath(new URL("../public/icons/", import.meta.url));
mkdirSync(dir, { recursive: true });
for (const [name, size, scale] of [
  ["icon-192.png", 192, 1],
  ["icon-512.png", 512, 1],
  ["icon-maskable-512.png", 512, 0.72],
  ["apple-touch-icon.png", 180, 0.9],
]) {
  writeFileSync(dir + name, encodePng(size, mark(scale)));
  console.log(`wrote public/icons/${name}`);
}
