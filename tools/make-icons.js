/**
 * Basit PNG uretici: harici kutuphane olmadan 192/512 uygulama ikonu.
 * Kullanim: node tools/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.resolve(__dirname, '..', 'public');

/* --- CRC32 --- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;
  const r = S * 0.22;
  const bars = [
    { x0: 0.21, x1: 0.33, y0: 0.56, y1: 0.82 },
    { x0: 0.39, x1: 0.51, y0: 0.42, y1: 0.82 },
    { x0: 0.57, x1: 0.69, y0: 0.28, y1: 0.82 },
  ];
  const put = (x, y, cr, cg, cb, a) => {
    const i = (y * S + x) * 4;
    buf[i] = cr; buf[i + 1] = cg; buf[i + 2] = cb; buf[i + 3] = a;
  };
  const inRound = (x, y) => {
    const cx = Math.min(Math.max(x, r), S - r);
    const cy = Math.min(Math.max(y, r), S - r);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRound(x + 0.5, y + 0.5)) { put(x, y, 0, 0, 0, 0); continue; }
      // zemin
      let cr = 10, cg = 14, cb = 20;
      // ince cerceve
      const t = 0.035;
      if (x < S * t || x > S * (1 - t) || y < S * t || y > S * (1 - t)) {
        cr = 30; cg = 42; cb = 56;
      }
      // barlar (yesil -> camgobegi gradyan)
      for (const b of bars) {
        const bx0 = b.x0 * S, bx1 = b.x1 * S, by0 = b.y0 * S, by1 = b.y1 * S;
        const rad = S * 0.035;
        const insideX = x >= bx0 && x <= bx1;
        const insideY = y >= by0 && y <= by1;
        if (insideX && insideY) {
          const k = (y - by0) / Math.max(1, by1 - by0);
          cr = Math.round(46 + (76 - 46) * k);
          cg = Math.round(230 + (201 - 230) * k);
          cb = Math.round(168 + (255 - 168) * k);
        }
        void rad;
      }
      put(x, y, cr, cg, cb, 255);
    }
  }
  return png(S, S, buf);
}

for (const size of [192, 512]) {
  const file = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(file, draw(size));
  console.log(`${file}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}

/* Android launcher ikonlari (varsa) */
const androidRes = path.resolve(__dirname, '..', 'android', 'res');
if (fs.existsSync(androidRes)) {
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [name, size] of Object.entries(densities)) {
    const dir = path.join(androidRes, `mipmap-${name}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), draw(size));
  }
  console.log('android/res/mipmap-* ikonlari yazildi (48–192 px)');
}
