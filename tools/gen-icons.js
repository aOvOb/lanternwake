// 앱 아이콘 생성: 올빼미 얼굴 실루엣과 등불 불꽃 (DESIGN.md 6.2)
// 사용법: node tools/gen-icons.js   (Node 기본 모듈만 쓴다. 결과 PNG는 icons/ 에 쓰고 저장소에 커밋한다)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ===== PNG 쓰기 =====
const CRC_TABLE = (function () {
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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// RGBA 8비트, 필터 0
function writePng(file, size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
}

// ===== 도형 =====
function hex(s) { return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; }
const C = {
  bgIn: hex('#16303a'), bgOut: hex('#0b1418'), glow: hex('#ff9a3c'), brown: hex('#8a5a34'),
  eye: hex('#ffe9a8'), pupil: hex('#111111'), beak: hex('#e07a2e'), flame: hex('#ffd34d'), core: hex('#fff6d0')
};
function inCircle(u, v, cx, cy, r) { const dx = u - cx, dy = v - cy; return dx * dx + dy * dy <= r * r; }
function inTri(u, v, a, b, c) {
  const s1 = (u - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (v - b[1]);
  const s2 = (u - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (v - c[1]);
  const s3 = (u - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (v - a[1]);
  const neg = s1 < 0 || s2 < 0 || s3 < 0, pos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(neg && pos);
}
// 물방울: 아래 둥글고 위로 갈수록 오목하게 좁아지는 불꽃. bottomY는 맨 아래, h는 높이, w는 폭.
function inDrop(u, v, cx, bottomY, h, w) {
  const r = w / 2, top = bottomY - h, cy = bottomY - r;
  if (v < top || v > bottomY) return false;
  if (v >= cy) return inCircle(u, v, cx, cy, r);
  const t = (v - top) / (cy - top);
  return Math.abs(u - cx) <= r * Math.pow(t, 1.25);
}

// 한 점의 색. 계층을 뒤에서부터 덮는다. 반환은 [r, g, b] (배경이 불투명이라 알파는 항상 1)
// opts.simple: 32px용 단순화(빛 번짐, 부리, 불꽃 심 생략), opts.fit: 계층 2~8을 가운데 기준으로 줄이는 비율
function shade(u, v, opts) {
  // 1. 배경: 가운데가 약간 밝은 방사형
  const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) / 0.72);
  let r = C.bgIn[0] + (C.bgOut[0] - C.bgIn[0]) * d;
  let g = C.bgIn[1] + (C.bgOut[1] - C.bgIn[1]) * d;
  let b = C.bgIn[2] + (C.bgOut[2] - C.bgIn[2]) * d;
  function paint(c, a) { r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a; }

  // 계층 2~8 좌표: maskable은 가운데 기준으로 줄인 크기로 그린다
  const k = opts.fit || 1;
  const x = 0.5 + (u - 0.5) / k, y = 0.5 + (v - 0.5) / k;

  // 2. 불꽃 빛 번짐
  if (!opts.simple) {
    const gd = Math.hypot(x - 0.5, y - 0.76) / 0.22;
    if (gd < 1) paint(C.glow, 0.35 * (1 - gd) * (1 - gd));
  }
  // 3. 머리
  if (inCircle(x, y, 0.5, 0.5, 0.31)) paint(C.brown, 1);
  // 4. 귀깃
  if (inTri(x, y, [0.24, 0.16], [0.27, 0.36], [0.46, 0.22]) || inTri(x, y, [0.76, 0.16], [0.73, 0.36], [0.54, 0.22])) paint(C.brown, 1);
  // 5. 눈, 6. 동공
  if (inCircle(x, y, 0.38, 0.47, 0.11) || inCircle(x, y, 0.62, 0.47, 0.11)) paint(C.eye, 1);
  if (inCircle(x, y, 0.38, 0.47, 0.05) || inCircle(x, y, 0.62, 0.47, 0.05)) paint(C.pupil, 1);
  // 7. 부리: 두 눈 사이 아래의 작은 역삼각형
  if (!opts.simple && inTri(x, y, [0.47, 0.55], [0.53, 0.55], [0.5, 0.61])) paint(C.beak, 1);
  // 8. 등불 불꽃과 밝은 심(심의 크기는 50%, 같은 바닥)
  if (inDrop(x, y, 0.5, 0.84, 0.20, 0.12)) paint(C.flame, 1);
  if (!opts.simple && inDrop(x, y, 0.5, 0.84, 0.10, 0.06)) paint(C.core, 1);
  return [r, g, b];
}

// 4x4 슈퍼샘플링으로 평균
function render(size, opts) {
  const out = Buffer.alloc(size * size * 4), SS = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, opts);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = (py * size + px) * 4, n = SS * SS;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return out;
}

const dir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(dir, { recursive: true });
const FILES = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { fit: 0.72 }],
  ['apple-touch-icon-180.png', 180, {}],
  ['favicon-32.png', 32, { simple: true }]
];
for (const [name, size, opts] of FILES) {
  writePng(path.join(dir, name), size, render(size, opts));
  console.log('icons/' + name);
}
