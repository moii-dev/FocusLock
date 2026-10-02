// Development helper only. Chrome loads the generated files; no build is needed.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'scripts/config'), { recursive: true });
await mkdir(path.join(root, 'icons'), { recursive: true });
for (let mask = 0; mask < 16; mask++) {
  const config = { enabled: true, hideVisibility: !!(mask & 1), preventBlur: !!(mask & 2),
    keepTimers: !!(mask & 4), diagnostics: !!(mask & 8) };
  await writeFile(path.join(root, 'scripts/config', `${mask}.js`),
    `// Static MAIN-world bootstrap: configuration is available synchronously.\n` +
    `window[Symbol.for('focuslock.config.v1')] = ${JSON.stringify(config)};\n`);
}

// Deterministic, antialiased shield/check icon. PNG encoder uses only Node built-ins.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, crc]);
}
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i], [c, d] = points[j];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
function distance(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function color(x, y) {
  if (Math.hypot(Math.max(0, Math.abs(x - .5) - .27), Math.max(0, Math.abs(y - .5) - .27)) > .21) return [0, 0, 0, 0];
  const shield = [[.5,.16],[.79,.27],[.77,.56],[.69,.71],[.5,.84],[.31,.71],[.23,.56],[.21,.27]];
  const check = [[.36,.49],[.46,.59],[.65,.39]];
  const stroke = shield.some((point, i) => distance(x,y,point,shield[(i+1)%shield.length]) < .027);
  const tick = distance(x,y,check[0],check[1]) < .028 || distance(x,y,check[1],check[2]) < .028;
  if (stroke || tick) return [22,134,106,255];
  return inPolygon(x,y,shield) ? [245,253,248,255] : [230,246,238,255];
}
for (const size of [16,32,48,128]) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0,0,0,0];
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const rgba = color((x + (sx+.5)/4)/size, (y + (sy+.5)/4)/size);
        sum[3] += rgba[3];
        for (let k = 0; k < 3; k++) sum[k] += rgba[k] * rgba[3] / 255;
      }
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      for (let k = 0; k < 3; k++) data[offset+k] = sum[3] ? Math.round(sum[k] * 255 / sum[3]) : 0;
      data[offset+3] = Math.round(sum[3] / 16);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0); ihdr.writeUInt32BE(size,4); ihdr[8] = 8; ihdr[9] = 6;
  await writeFile(path.join(root,'icons',`icon${size}.png`), Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr), chunk('IDAT',deflateSync(data)), chunk('IEND',Buffer.alloc(0))
  ]));
}
console.log('Created 16 configuration bootstraps and four PNG icons.');
