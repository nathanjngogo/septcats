/*
 * render-svg-png.mjs —— 渲染 SVG 为多尺寸 PNG（零新依赖、零网络）。
 *
 * 方案：纯 stdlib 解析 SVG 里的基本形状（rect fill / polygon points+fill），
 * 在 RGBA 像素缓冲上做扫描线填充（4× 超采样抗锯齿），编码 PNG（zlib + 手写 CRC32）。
 * 专为本仓像素图标 SVG 定制（viewBox 0 0 256 256 + rect/polygon 即足够）；
 * 比起一个 Electron 离屏窗口更可控（无单实例锁、无渲染时序问题）。
 *
 * 用法：node scripts/render-svg-png.mjs <svg...> --out <dir> --sizes 16,48,256
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, basename } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const flagIdx = new Set();
for (const f of ['--out', '--sizes']) {
  const i = args.indexOf(f);
  if (i >= 0) { flagIdx.add(i); flagIdx.add(i + 1); }
}
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const outDir = val('--out', '.');
const sizes = val('--sizes', '256').split(',').map(Number);
const svgPaths = args.filter((a, i) => !flagIdx.has(i) && a.endsWith('.svg') && existsSync(a));
if (svgPaths.length === 0) { console.error('无 SVG 参数'); process.exit(2); }

/* ---------- 解析 SVG：rect / polygon ---------- */
function parseSvg(text) {
  const shapes = [];
  const rectRe = /<rect\b([^>]*)\/?>/g;
  let m;
  while ((m = rectRe.exec(text))) {
    const at = (k, d = 0) => {
      const r = new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]);
      return r ? parseFloat(r[1]) : d;
    };
    const fill = parseColor(/fill="([^"]*)"/.exec(m[1])?.[1] ?? '#000');
    const rx = at('rx');
    shapes.push({ kind: 'rect', x: at('x'), y: at('y'), w: at('width'), h: at('height'), rx, fill });
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

function parseColor(s) {
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

/* ---------- 光栅化（SS=4 超采样） ---------- */
const VB = 256;
const SS = 1; // 像素图标：无超采样 = 硬边（判读实证 SS=4 会把 16px 托盘图糊掉）

function rasterize(shapes) {
  const W = VB * SS;
  const buf = new Float64Array(W * W * 4); // RGBA（SS=1：硬边像素画）
  // 背景透明黑 0 alpha；逐 shape 按 painter 算法写入（含 alpha 混合近似：源覆盖）
  const px = (x, y) => buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4);

  function blend(x, y, r, g, b, a) {
    const d = px(x, y);
    const na = d[3] / 255;
    const cov = a;
    const outA = cov + na * (1 - cov);
    if (outA === 0) { d[0] = d[1] = d[2] = d[3] = 0; return; }
    d[0] = (r * cov + d[0] * na * (1 - cov)) / outA;
    d[1] = (g * cov + d[1] * na * (1 - cov)) / outA;
    d[2] = (b * cov + d[2] * na * (1 - cov)) / outA;
    d[3] = outA * 255;
  }

  function rasterShape(s) {
    const [r, g, b, ai] = s.fill;
    const alpha = ai / 255;
    if (s.kind === 'rect') {
      const x0 = Math.max(0, Math.floor(s.x * SS));
      const x1 = Math.min(W - 1, Math.ceil((s.x + s.w) * SS));
      const y0 = Math.max(0, Math.floor(s.y * SS));
      const y1 = Math.min(W - 1, Math.ceil((s.y + s.h) * SS));
      const rx = s.rx * SS;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (rx > 0) {
            // 圆角：四角外则按圆弧处理
            const cxL = x0 + rx, cxR = x1 - rx, cyT = y0 + rx, cyB = y1 - rx;
            let corner = null;
            if (x < cxL && y < cyT) corner = [cxL, cyT];
            else if (x > cxR && y < cyT) corner = [cxR, cyT];
            else if (x < cxL && y > cyB) corner = [cxL, cyB];
            else if (x > cxR && y > cyB) corner = [cxR, cyB];
            if (corner && ((x - corner[0]) ** 2 + (y - corner[1]) ** 2 > rx * rx)) continue;
          }
          blend(x, y, r, g, b, alpha);
        }
      }
      return;
    }
    // polygon 扫描线（子像素 4 采样行 → 这里逐像素行 + 中心点，SS 已提供精度）
    const pts = s.pts.map(([x, y]) => [x * SS, y * SS]);
    let minY = Infinity, maxY = -Infinity;
    for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const ya = Math.max(0, Math.floor(minY));
    const yb = Math.min(W - 1, Math.ceil(maxY));
    const n = pts.length;
    for (let y = ya; y <= yb; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let i = 0; i < n; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % n];
        if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
          xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k]));
        const xb = Math.min(W - 1, Math.round(xs[k + 1]));
        for (let x = xa; x < xb; x++) blend(x, y, r, g, b, alpha);
      }
    }
  }

  // 预置：把 rect 背景（第一形状常为全幅白底）放最前
  for (const s of shapes) rasterShape(s);

  // 降采样 SS×SS → 1 像素
  const out = Buffer.alloc(VB * VB * 4);
  for (let y = 0; y < VB; y++) {
    for (let x = 0; x < VB; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const d = px(x * SS + sx, y * SS + sy);
          r += d[0]; g += d[1]; b += d[2]; a += d[3];
        }
      }
      const n2 = SS * SS;
      const o = (y * VB + x) * 4;
      out[o] = Math.round(r / n2); out[o + 1] = Math.round(g / n2);
      out[o + 2] = Math.round(b / n2); out[o + 3] = Math.round(a / n2);
    }
  }
  return out;
}

/** 原生分辨率光栅化：形状坐标按 S/256 直接映射到目标像素网格（无超采样、无缩放=硬边）。 */
function rasterizeAt(shapes, S) {
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
      const x0 = Math.max(0, Math.floor(s.x * sc));
      const x1 = Math.min(S - 1, Math.ceil((s.x + s.w) * sc) - 1);
      const y0 = Math.max(0, Math.floor(s.y * sc));
      const y1 = Math.min(S - 1, Math.ceil((s.y + s.h) * sc) - 1);
      const rx = s.rx * sc;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (rx > 0) {
            const cxL = x0 + rx, cxR = x1 - rx, cyT = y0 + rx, cyB = y1 - rx;
            let corner = null;
            if (x < cxL && y < cyT) corner = [cxL, cyT];
            else if (x > cxR && y < cyT) corner = [cxR, cyT];
            else if (x < cxL && y > cyB) corner = [cxL, cyB];
            else if (x > cxR && y > cyB) corner = [cxR, cyB];
            if (corner && ((x - corner[0]) ** 2 + (y - corner[1]) ** 2 > rx * rx)) continue;
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

/* ---------- PNG 编码（stdlib） ---------- */
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
function encodePng(rgba, w, h) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- 缩放（盒式，整数倍友好） ---------- */
function scale(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor((y * sh) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor((x * sw) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, cnt = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * sw + sx) * 4;
          // 预乘平均（保持边缘不发白）
          const af = src[o + 3] / 255;
          r += src[o] * af; g += src[o + 1] * af; b += src[o + 2] * af; a += src[o + 3];
          cnt++;
        }
      }
      const o2 = (y * dw + x) * 4;
      const av = a / cnt;
      if (av > 0) {
        out[o2] = Math.round((r / cnt) / (av / 255));
        out[o2 + 1] = Math.round((g / cnt) / (av / 255));
        out[o2 + 2] = Math.round((b / cnt) / (av / 255));
      }
      out[o2 + 3] = Math.round(av);
    }
  }
  return out;
}

/* ---------- main ---------- */
mkdirSync(outDir, { recursive: true });
for (const svgPath of svgPaths) {
  const shapes = parseSvg(readFileSync(svgPath, 'utf8'));
  for (const size of sizes) {
    // 原生分辨率直画（零重采样，像素图标铁律）
    const small = size === VB ? rasterize(shapes) : rasterizeAt(shapes, size);
    const png = encodePng(small, size, size);
    const name = `${basename(svgPath, '.svg')}-${size}.png`;
    writeFileSync(join(outDir, name), png);
    console.log('wrote', name, png.length, 'bytes');
  }
}
console.log('DONE');
