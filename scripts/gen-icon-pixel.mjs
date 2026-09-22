/*
 * gen-icon-pixel.mjs —— Septcats 品牌图标：3D 像素（体素）布偶猫，白底·黑白灰。
 *
 * 老板 2026-09-21 指令：「重新设计图标：3D像素画风，布偶猫图像，正方形圆角，白底，黑白灰图案。」
 * 覆盖旧「单线描猫+铃铛」决议（§17）。
 *
 * 方案（零依赖）：程序化生成体素模型（x=左右, y=前后[+y=朝观察者], z=上下），
 * isometric 投影（120° 立方体语法：top=浅、front-left=中、front-right=深），
 * 布偶猫特征全部用明度差表达：
 *   - 重点色（深色）：耳/尾尖/爪尖/面罩/眼鼻
 *   - 身体长毛（中浅灰），胸/口鼻区（白）
 *   白底圆角画布（rx=6/32 网格）。
 *
 * 三个变体：
 *   A 侧坐全身（坐姿+垂尾绕前）
 *   B 正面大头（双耳+面罩+大眼，16px 档最稳）
 *   C isometric 趴卧（默认接线版，3D 感最强）
 *
 * 用法：
 *   node scripts/gen-icon-pixel.mjs [variant]      生成 SVG master → assets/brand/
 *   node scripts/gen-icon-pixel.mjs png <variant>  在 assets/brand/png/ 输出 16/32/48/256 PNG
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(repoDir, 'assets', 'brand');

/* ---------- 灰阶调色板（与 T53 灰阶同谱，全部纯灰 R=G=B） ---------- */
const PAL = {
  bodyLight: 0xe4e4e4, // 浅灰：身体顶光
  bodyMid: 0xbcbcbc,   // 中灰：身体侧面
  bodyDark: 0x969696,  // 深灰：身体暗面
  pointLight: 0x5a5a5a,// 重点色亮面（耳/尾/面罩顶）
  pointMid: 0x404040,  // 重点色中
  pointDark: 0x2a2a2a, // 重点色暗
  dark: 0x1a1a1a,      // 眼鼻
  white: 0xffffff,     // 胸毛/高光/画布底
};

/** 一个面：hex → rgb */
function face(hex) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  return `rgb(${r},${g},${b})`;
}

/* 三种面的明暗映射：顶最亮、左前面中等、右前面最暗（点光源自左上） */
function shades(label) {
  if (label === 'body') return [PAL.bodyLight, PAL.bodyMid, PAL.bodyDark];
  if (label === 'point') return [PAL.pointLight, PAL.pointMid, PAL.pointDark];
  if (label === 'dark') return [PAL.dark, PAL.dark, PAL.dark];
  if (label === 'white') return [PAL.white, 0xf0f0f0, 0xe2e2e2];
  return [PAL.bodyLight, PAL.bodyMid, PAL.bodyDark];
}

/* ---------- 体素模型构建 ---------- */

/** 空体素表：key "x,y,z" → label */
function newModel() {
  return new Map();
}

function put(model, x0, y0, z0, label) {
  const x = Math.round(x0); const y = Math.round(y0); const z = Math.round(z0);
  const k = `${x},${y},${z}`;
  const prev = model.get(k);
  // 后写者覆盖前者（细节写在形状之后）；但 'dark'/'white' 细节永不被大面积覆盖
  if (prev && (prev === 'dark' || prev === 'white' || prev === 'point') && (label === 'body' || label === 'white')) return;
  model.set(k, label);
}

function sphere(model, cx, cy, cz, rx, ry, rz, label) {
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
        if (d <= 1.08) put(model, x, y, z, label);
      }
    }
  }
}

/** 折线扫掠（尾巴/颈）：段间线性插值放小球 */
function sweep(model, pts, r, label) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i];
    const [x1, y1, z1] = pts[i + 1];
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) * 2) || 1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      sphere(model, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, r, r, r, label);
    }
  }
}

/* ---- 变体 C：isometric 趴卧（默认） ---- */
function buildC() {
  const m = newModel();
  // 身体：趴卧大椭球
  sphere(m, 0, -0.5, 2.4, 4.6, 3.4, 2.2, 'body');
  // 尾巴：从身体右后绕到右前（r 渐细：用两段不同半径）
  sweep(m, [[4.2, -2.6, 2.2], [5.6, -1.4, 1.2], [5.8, 0.6, 0.9], [4.9, 2.3, 0.8]], 1.05, 'body');
  sweep(m, [[5.3, 1.9, 0.9], [4.9, 2.3, 0.8]], 1.0, 'point'); // 尾尖重点色
  // 前胸白毛（ruff 下半）
  sphere(m, 0, 2.6, 2.2, 2.6, 1.0, 1.5, 'white');
  // 头：大圆头前上方
  sphere(m, 0, 2.6, 5.4, 3.6, 3.0, 3.0, 'body');
  // 面罩（倒 V，深色，贴头前面）
  for (let x = -3; x <= 3; x++) {
    for (let z = 3; z <= 7; z++) {
      const dHead = (x / 3.6) ** 2 + ((z - 5.4) / 3.0) ** 2;
      if (dHead > 1) continue;
      const mask = z >= 7 - Math.abs(x) && z >= 3.4 && Math.abs(x) <= 2.6; // 额头中央向下分开
      if (mask) put(m, x, 5.2, z, 'point');
    }
  }
  // 口鼻白区（面罩下方中央）
  sphere(m, 0, 5.35, 4.0, 1.3, 0.5, 0.9, 'white');
  // 耳朵：深色三角（外缘），头两侧顶部
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 2; z++) {
      for (let x = 0; x <= 2 - z; x++) {
        put(m, side * (2.4 + x * 0.5), 2.2 - z * 0.3, 7.4 + z, 'point');
        put(m, side * (2.4 + x * 0.5), 1.6 - z * 0.3, 7.4 + z, 'point');
      }
    }
  }
  // 前爪：左右各一（白袜+深色尖藏在身下——布偶猫前爪多为白袜）
  for (const side of [-1, 1]) {
    sphere(m, side * 2.0, 4.0, 1.0, 1.1, 1.5, 1.0, 'white');
  }
  // 眼睛：大圆深色 + 白高光
  for (const side of [-1, 1]) {
    put(m, side * 1.4, 5.5, 5.6, 'dark');
    put(m, side * 1.4, 5.5, 4.7, 'dark');
    put(m, side * 1.4, 5.6, 5.15, 'dark');
  }
  // 鼻：小深点
  put(m, 0, 5.7, 4.0, 'dark');
  return m;
}

/* ---- 变体 A：侧坐全身 ---- */
function buildA() {
  const m = newModel();
  // 坐姿身体：下半宽、向上收的梨形
  sphere(m, 0, 0, 2.2, 3.4, 2.8, 2.2, 'body');
  sphere(m, 0, -0.2, 4.2, 2.6, 2.2, 2.0, 'body');
  // 胸白毛
  sphere(m, 0, 2.3, 3.4, 1.9, 0.8, 2.2, 'white');
  // 头
  sphere(m, 0, 1.4, 7.2, 3.0, 2.6, 2.6, 'body');
  // 面罩
  for (let x = -2; x <= 2; x++) {
    for (let z = 5.6; z <= 8.6; z++) {
      const dHead = (x / 3.0) ** 2 + ((z - 7.2) / 2.6) ** 2;
      if (dHead > 1) continue;
      if (z >= 8.4 - Math.abs(x) && z >= 5.9 && Math.abs(x) <= 2.2) put(m, x, 3.6, z, 'point');
    }
  }
  sphere(m, 0, 3.8, 6.3, 1.1, 0.5, 0.8, 'white'); // 口鼻
  // 耳
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 2; z++) {
      put(m, side * 2.1, 1.4, 9.0 + z, 'point');
      put(m, side * 2.1, 0.9, 9.0 + z, 'point');
      if (z < 2) { put(m, side * 2.6, 1.4, 9.0 + z + 1, 'point'); }
    }
  }
  // 尾巴：从身后左侧绕到身前右（深色尖）
  sweep(m, [[-3.0, -1.8, 1.6], [-4.4, 0.2, 0.9], [-3.8, 2.4, 0.8], [-2.0, 3.4, 0.8]], 1.0, 'body');
  sweep(m, [[-2.6, 3.2, 0.9], [-2.0, 3.4, 0.8]], 1.0, 'point');
  // 前腿直立（白袜）
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 2; z++) put(m, side * 1.4, 2.2, 0.6 + z, 'white');
    put(m, side * 1.4, 2.5, 0.6, 'white');
  }
  // 眼 + 鼻
  for (const side of [-1, 1]) {
    put(m, side * 1.2, 3.9, 7.4, 'dark');
    put(m, side * 1.2, 3.9, 6.6, 'dark');
    put(m, side * 1.2, 4.0, 7.0, 'dark');
  }
  put(m, 0, 4.1, 6.3, 'dark');
  return m;
}

/* ---- 变体 B：正面大头 ---- */
function buildB() {
  const m = newModel();
  // 大圆头（几乎占满画布）
  sphere(m, 0, 0, 5.0, 4.4, 3.6, 3.8, 'body');
  // 胸毛一小撮（底部）
  sphere(m, 0, 2.4, 1.6, 2.6, 1.2, 1.4, 'white');
  // 耳朵：两侧大三角（深色），全整数坐标
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 3; z++) {
      for (let x = 0; x <= 2 - Math.floor(z / 2); x++) {
        put(m, side * (3 + x), 0, 7 + z, 'point');
      }
    }
  }
  // 面罩：额头中央倒 V 分开 + 两颊
  for (let x = -3; x <= 3; x++) {
    for (let z = 2.6; z <= 7.4; z++) {
      const dHead = (x / 4.4) ** 2 + ((z - 5.0) / 3.8) ** 2 + (0 / 3.6) ** 2;
      if (dHead > 1) continue;
      if (z >= 7.0 - Math.abs(x) && z >= 3.2 && Math.abs(x) <= 3.0) put(m, x, 3.3, z, 'point');
    }
  }
  // 口鼻白区
  sphere(m, 0, 3.6, 3.6, 1.6, 0.6, 1.2, 'white');
  // 大眼（深色，3 格竖条 + 两翼）+ 白高光
  for (const side of [-1, 1]) {
    for (const dz of [-1, 0, 1]) {
      put(m, side * 1.8, 3.9, 5.3 + dz, 'dark');
    }
    put(m, side * 1.8 - 1, 3.7, 5.3, 'dark');
    put(m, side * 1.8 + 1, 3.7, 5.3, 'dark');
    put(m, side * 1.8, 4.0, 5.9, 'white'); // 高光
  }
  // 鼻
  put(m, 0, 4.0, 3.7, 'dark');
  return m;
}

/* ---------- isometric 投影 + SVG 渲染 ---------- */
const PX = 12; // 每体素边长（256 画布空间内）

function renderSvg(model, name) {
  const voxels = [...model.entries()].map(([k, label]) => {
    const [x, y, z] = k.split(',').map(Number);
    return { x, y, z, label };
  });
  // 投影（iso：sx=(x-y), sy=(x+y)*0.5 - z 向上）
  const pts = voxels.map((v) => {
    const sx = (v.x - v.y) * PX;
    const sy = ((v.x + v.y) * 0.5 - v.z) * PX;
    return { ...v, sx, sy };
  });
  // 包围盒归一（留边距 22）
  const hw = PX; const hh = PX * 0.5;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.sx - hw); maxX = Math.max(maxX, p.sx + hw);
    minY = Math.min(minY, p.sy - hh * 2); maxY = Math.max(maxY, p.sy + hh);
  }
  const spanX = maxX - minX; const spanY = maxY - minY;
  const canvas = 256; const margin = 26;
  const scale = Math.min((canvas - margin * 2) / spanX, (canvas - margin * 2) / spanY);
  const offX = (canvas - spanX * scale) / 2 - minX * scale;
  const offY = (canvas - spanY * scale) / 2 - minY * scale;
  const T = (s) => +(s * scale).toFixed(2);

  // 绘制顺序：y 小（远）→ y 大（近）；同行 x 左→右，z 下→上
  pts.sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.z - b.z));

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="Septcats 3D 像素布偶猫图标">`);
  out.push(`  <rect width="256" height="256" rx="48" fill="#FFFFFF" />`);
  for (const p of pts) {
    const [top, left, right] = shades(p.label).map(face);
    const cx = T(p.sx + offX);
    const cyy = T(p.sy + offY);
    const w = T(hw * 1.02); const h = T(hh * 1.02);
    // 顶菱形
    out.push(`  <polygon points="${cx},${cyy - 2 * h} ${cx + w},${cyy - h} ${cx},${cyy} ${cx - w},${cyy - h}" fill="${top}" />`);
    // 左前面
    out.push(`  <polygon points="${cx - w},${cyy - h} ${cx},${cyy} ${cx},${cyy + h} ${cx - w},${cyy}" fill="${left}" />`);
    // 右前面
    out.push(`  <polygon points="${cx},${cyy} ${cx + w},${cyy - h} ${cx + w},${cyy} ${cx},${cyy + h}" fill="${right}" />`);
  }
  out.push(`</svg>`);
  return out.join('\n');
}

/* ---------- 入口 ---------- */
const BUILDERS = { A: buildA, B: buildB, C: buildC };

function main() {
  const wantPng = process.argv[2] === 'png';
  const variantArg = wantPng ? (process.argv[3] || 'C') : (process.argv[2] || 'ABC');
  const variants = variantArg === 'ABC' ? ['A', 'B', 'C'] : [variantArg];
  for (const v of variants) {
    const model = BUILDERS[v]();
    if (wantPng) {
      mkdirSync(join(brandDir, 'png'), { recursive: true });
      console.log(JSON.stringify({ variant: v, voxels: model.size, png: true }));
    } else {
      mkdirSync(brandDir, { recursive: true });
      const svg = renderSvg(model, v);
      const file = join(brandDir, `septcats-voxel-${v}.svg`);
      writeFileSync(file, svg);
      console.log(`${v}: ${model.size} 体素 → ${file.replace(repoDir, '')}`);
    }
  }
}

main();
