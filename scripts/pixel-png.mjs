/*
 * pixel-png.mjs —— 像素图标渲染核心（纯 stdlib，零依赖、零网络）。
 * 供 render-svg-png.mjs（CLI）与 build-pixel-ico.mjs（组 ico）共用。
 *
 * 能力：解析 SVG 基本形状（rect/polygon）→ 任意目标分辨率**原生直画**（无超采样、
 * 无重采样=硬边像素画铁律）→ RGBA 缓冲 / PNG 编码。
 */
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const VB = 256;

/* ---------- SVG 解析（rect / polygon） ---------- */
export function parseSvg(text) {
  const shapes = [];
  let m;
  const rectRe = /<rect\b([^>]*)\/?>/g;
  while ((m = rectRe.exec(text))) {
    const at = (k, d = 0) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]);
      return r ? parseFloat(r[1]) : d;
    };
    const fill = parseColor(/fill="([^"]*)"/.exec(m[1])?.[1] ?? '#000');
    shapes.push({ kind: 'rect', x: at('x'), y: at('y'), w: at('width'), h: at('height'), rx: at('rx'), fill });
  }
  const polyRe = /<polygon\b([^>]*)\/?>/g;
  while ((m = polyRe.exec(text))) {
    const ptsStr = /points="([^"]*)"/.exec(m[1])?.[1] ?? '';
    const nums = ptsStr.trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const fill = parseColor(/fill="([^"]*)"/.exec(m[1])?.[1] ?? '#000');
    if (pts.length >= 3) shapes.push({ kind: 'poly', pts, fill });
  }
  return shapes;
}

export function parseColor(s) {
  if (!s) return [0, 0, 0, 255];
  s = s.trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] === undefined ? 255 : Math.round(p[3] * 255)];
  }
  return [0, 0, 0, 255];
}

/* ---------- 目标分辨率原生直画（零插值） ---------- */
/** 把 shapes（256 viewBox 坐标）直接光栅化到 S×S RGBA Buffer。 */
export function rasterizeAt(shapes, S) {
  const sc = S / VB;
  const buf = new Float64Array(S * S * 4);
  const px = (x, y) => buf.subarray((y * S + x) * 4, (y * S + x) * 4 + 4);
  function blend(x, y, r, g, b, a) {
    const d = px(x, y);
    const na = d[3] / 255;
    const outA = a + na * (1 - a);
    if (outA === 0) { d[0] = d[1] = d[2] = d[3] = 0; return; }
    d[0] = (r * a + d[0] * na * (1 - a)) / outA;
    d[1] = (g * a + d[1] * na * (1 - a)) / outA;
    d[2] = (b * a + d[2] * na * (1 - a)) / outA;
    d[3] = outA * 255;
  }
  for (const s of shapes) {
    const [cr, cg, cb, ai] = s.fill;
    const alpha = ai / 255;
    if (s.kind === 'rect') {
      // 边界用「包含采样中心」的原生取整（不是 ceil-1，避免小尺寸整行丢失）
      const x0 = Math.max(0, Math.floor(s.x * sc));
      const x1 = Math.min(S - 1, Math.ceil((s.x + s.w) * sc) - 1);
      const y0 = Math.max(0, Math.floor(s.y * sc));
      const y1 = Math.min(S - 1, Math.ceil((s.y + s.h) * sc) - 1);
      const rx = s.rx * sc;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (rx > 0) {
            const cxL = s.x * sc + rx, cxR = (s.x + s.w) * sc - rx;
            const cyT = s.y * sc + rx, cyB = (s.y + s.h) * sc - rx;
            let corner = null;
            const fx = x + 0.5, fy = y + 0.5;
            if (fx < cxL && fy < cyT) corner = [cxL, cyT];
            else if (fx > cxR && fy < cyT) corner = [cxR, cyT];
            else if (fx < cxL && fy > cyB) corner = [cxL, cyB];
            else if (fx > cxR && fy > cyB) corner = [cxR, cyB];
            if (corner && ((fx - corner[0]) ** 2 + (fy - corner[1]) ** 2 > rx * rx)) continue;
          }
          blend(x, y, cr, cg, cb, alpha);
        }
      }
      continue;
    }
    const pts = s.pts.map(([x, y]) => [x * sc, y * sc]);
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const ya = Math.max(0, Math.floor(minY));
    const yb = Math.min(S - 1, Math.ceil(maxY));
    const n = pts.length;
    for (let y = ya; y <= yb; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % n];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k]));
        const xb = Math.min(S - 1, Math.round(xs[k + 1]) - 1);
        for (let x = xa; x <= xb; x++) blend(x, y, cr, cg, cb, alpha);
      }
    }
  }
  const out = Buffer.alloc(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    out[i * 4] = Math.round(buf[i * 4]);
    out[i * 4 + 1] = Math.round(buf[i * 4 + 1]);
    out[i * 4 + 2] = Math.round(buf[i * 4 + 2]);
    out[i * 4 + 3] = Math.round(buf[i * 4 + 3]);
  }
  return out;
}

/** 从 SVG 文件直画 S×S RGBA。 */
export function renderSvgToRgba(svgPath, S) {
  return rasterizeAt(parseSvg(readFileSync(svgPath, 'utf8')), S);
}

/* ---------- PNG 编码 ---------- */
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
