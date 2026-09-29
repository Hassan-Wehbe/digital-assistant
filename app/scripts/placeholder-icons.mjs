// Draw the placeholder app icons (a white "W" on Wilma blue) as PNGs, with no
// image libraries: pixels by hand, PNG chunks by hand, zlib from Node.
//   node scripts/placeholder-icons.mjs
// Replace the files in assets/images with a designed icon before a public release.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x27, 0x54, 0xc5];
// The "W" as a polyline in unit coordinates, drawn with round ends.
const W = [[0.2, 0.3], [0.35, 0.72], [0.5, 0.4], [0.65, 0.72], [0.8, 0.3]];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size, size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Coverage (0..1) of the "W", scaled by `scale` around the centre, stroke `width`. */
function wCoverage(x, y, size, scale, width) {
  const u = (x - 0.5) / scale + 0.5, v = (y - 0.5) / scale + 0.5;
  let d = Infinity;
  for (let i = 0; i < W.length - 1; i++) d = Math.min(d, distToSegment(u, v, W[i], W[i + 1]));
  const px = ((width / 2 - d) * scale) * size; // signed distance in pixels
  return Math.max(0, Math.min(1, px + 0.5));
}

const out = (name, size, pixel) => {
  writeFileSync(new URL(`../assets/images/${name}`, import.meta.url), png(size, pixel));
  console.log(`wrote assets/images/${name} (${size}x${size})`);
};
const onBlue = (scale) => (x, y, size) => {
  const a = wCoverage(x, y, size, scale, 0.09);
  return [...BLUE.map((c) => Math.round(c + (255 - c) * a)), 255];
};
const whiteOnClear = (scale) => (x, y, size) => [255, 255, 255, Math.round(255 * wCoverage(x, y, size, scale, 0.09))];

out('icon.png', 1024, onBlue(1));
out('android-icon-foreground.png', 1024, whiteOnClear(0.6)); // inside Android's safe zone
out('android-icon-monochrome.png', 1024, whiteOnClear(0.6));
out('splash-icon.png', 512, whiteOnClear(1));
out('favicon.png', 48, onBlue(1));
