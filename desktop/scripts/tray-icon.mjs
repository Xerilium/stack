// Writes desktop/assets/trayTemplate.png (16 px) and trayTemplate@2x.png (32 px): three stacked bars, black on transparent.
// macOS tints a "Template" image for light and dark menu bars. Run: node desktop/scripts/tray-icon.mjs
import { Buffer } from 'buffer';
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const out = join(dirname(fileURLToPath(import.meta.url)), '../assets');

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** Three bars, each `size/8` tall, with `size/8` gaps, inset `size/8` on each side. */
function png(size) {
  const u = size / 8;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter: none
    const band = Math.floor(y / u); // 0..7
    const on = band === 1 || band === 3 || band === 5;
    for (let x = 0; x < size; x++) {
      const inside = on && x >= u && x < size - u;
      row.push(0, 0, 0, inside ? 255 : 0);
    }
    rows.push(Buffer.from(row));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'trayTemplate.png'), png(16));
writeFileSync(join(out, 'trayTemplate@2x.png'), png(32));
console.log(`wrote ${out}/trayTemplate.png and trayTemplate@2x.png`);
