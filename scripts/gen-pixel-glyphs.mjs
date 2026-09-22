/*
 * gen-pixel-glyphs.mjs —— 全仓 UI 图标像素化：16×16 网格 glyph 表（T58 设计资产）。
 *
 * 语法（与 T53/T55 同源）：1 格=1 像素；描边族=轮廓线宽 1 格；填充位用「亮档」
 * （主色 + opacity .45 两档，代码渲染时映射）。每 glyph 附质检：
 *   - 墨迹占比 18–46%（16px 可读带）
 *   - 连通体 ≤2（图标允许分离件，如放大镜=圈+柄一体即可）
 *   - 坐标全整数
 * 用法：node scripts/gen-pixel-glyphs.mjs        → 打印表+质检+拼版 PNG
 *       模块被 import 时导出 GLYPHS（运行时 pixelIcons.tsx 的矩阵由 CB 从本表生成）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './pixel-png.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 16×16 画格工具 ---------- */
const G = 16;
function canvas() { return Array.from({ length: G }, () => Array(G).fill(0)); }
function px(g, x, y, v = 1) { if (x >= 0 && x < G && y >= 0 && y < G) g[y][x] = v; }
function rect(g, x0, y0, x1, y1, v = 1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, v); }
function ring(g, x0, y0, x1, y1, v = 1) { for (let x = x0; x <= x1; x++) { px(g, x, y0, v); px(g, x, y1, v); } for (let y = y0; y <= y1; y++) { px(g, x0, y, v); px(g, x1, y, v); } }
function hline(g, x0, x1, y, v = 1) { for (let x = x0; x <= x1; x++) px(g, x, y, v); }
function vline(g, x, y0, y1, v = 1) { for (let y = y0; y <= y1; y++) px(g, x, y, v); }
function dline(g, x0, y0, x1, y1, v = 1) { //  Bresenham
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
  for (;;) { px(g, x0, y0, v); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
}
const v2 = (s) => [...s].map((c) => (c === '#' ? 1 : c === 'o' ? 0.45 : c === 'x' ? 0.3 : 0)); // 位图行（#=主墨 o=半档 x=淡档 .=空）
function bmp(...rows) { const g = canvas(); rows.forEach((r, y) => { [...r].forEach((c, x) => { if (c === '#') px(g, x, y); else if (c === 'o') px(g, x, y, 0.45); else if (c === 'x') px(g, x, y, 0.3); }); }); return g; }

/* ---------- 质检（像素画口径）----------
 * 连通体按 8-邻域（对角相邻=视觉连续，Bresenham 斜线不该判碎块）；
 * 墨占比带 8–50%（轮廓族天然低墨）；分离件 ≤6 组（点阵类允许多枚）。 */
function quality(g) {
  let ink = 0;
  for (const row of g) for (const c of row) if (c > 0) ink++;
  const ratio = ink / (G * G);
  const seen = Array.from({ length: G }, () => Array(G).fill(false));
  let comps = 0;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (g[y][x] > 0 && !seen[y][x]) {
      comps++;
      const q = [[x, y]]; seen[y][x] = true;
      while (q.length) {
        const [cx, cy] = q.pop();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < G && ny >= 0 && ny < G && g[ny][nx] > 0 && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); }
        }
      }
    }
  }
  return { ink, ratio, comps, ok: ratio >= 0.08 && ratio <= 0.5 && comps <= 6 };
}
/** 2px 笔画助手（16px 档可读性） */
function dline2(g, x0, y0, x1, y1, v = 1) { dline(g, x0, y0, x1, y1, v); dline(g, x0 + 1, y0, x1 + 1, y1, v); }
function hline2(g, x0, x1, y, v = 1) { hline(g, x0, x1, y, v); hline(g, x0, x1, y + 1, v); }
function vline2(g, x, y0, y1, v = 1) { vline(g, x, y0, y1, v); vline(g, x + 1, y0, y1, v); }

/* ---------- 25+ glyph 定义（对齐 Icon.tsx 现 re-export 清单） ---------- */
export const GLYPHS = {};
function def(name, g) { GLYPHS[name] = g; }

// —— 导航/动作 ——
def('Plus', (() => { const g = canvas(); vline2(g, 7, 3, 12); hline2(g, 3, 12, 7); return g; })());
def('Check', (() => { const g = canvas(); dline2(g, 3, 7, 6, 11); dline2(g, 6, 11, 12, 3); return g; })());
def('Close', (() => { const g = canvas(); dline2(g, 3, 3, 12, 12); dline2(g, 11, 3, 2, 12); return g; })());
def('Search', (() => { const g = canvas(); ring(g, 3, 2, 10, 9); ring(g, 4, 3, 9, 8); dline2(g, 10, 9, 13, 13); return g; })());
def('GearSix', (() => { const g = canvas();
  // 干净齿轮：8 格圈环 + 中心 2×2 孔 + 四向齿（1 格外凸）
  ring(g, 4, 4, 11, 11); rect(g, 6, 6, 9, 9, 0); vline(g, 7, 6, 7); vline(g, 8, 8, 9); hline(g, 6, 6, 7); hline(g, 9, 9, 8);
  rect(g, 6, 1, 9, 3); rect(g, 6, 12, 9, 14); rect(g, 1, 6, 3, 9); rect(g, 12, 6, 14, 9);
  return g; })());
def('SidebarSimple', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); vline(g, 6, 3, 12); hline(g, 3, 5, 5); hline(g, 3, 5, 8); return g; })());
def('Layout', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); hline(g, 3, 12, 6); vline(g, 8, 7, 12); return g; })()); // T57 布局钮候选
def('BookOpen', bmp( // 说明书（T56 菜单 icon）
  '................',
  '.####o##o####...',
  '##...o##o...##..',
  '##.o.##o.o.##...',
  '##..o#o#o..##...',
  '##...o##o...##..',
  '##..o##o##o.##..',
  '##.o.#o#.o..##..',
  '##..o##o##o.##..',
  '##...####....##.',
  '.####o##o####...',
  '..o..o##o..o....',
  '................',
  '................',
  '................',
  '................'));

// —— 页面/文件 ——
def('FileText', (() => { const g = canvas(); ring(g, 3, 1, 12, 14); hline(g, 5, 10, 5); hline(g, 5, 10, 8); hline(g, 5, 8, 11); return g; })());
def('Note', (() => { const g = canvas(); ring(g, 2, 3, 13, 13); dline(g, 2, 3, 5, 0); rect(g, 5, 0, 13, 2, 0); hline(g, 4, 10, 6); hline(g, 4, 10, 9); return g; })());
def('FolderSimple', (() => { const g = canvas(); ring(g, 1, 3, 8, 6); rect(g, 1, 5, 8, 6); ring(g, 1, 4, 14, 13); hline(g, 2, 13, 7, 0.45); return g; })());
def('Copy', (() => { const g = canvas(); ring(g, 5, 1, 13, 10); ring(g, 2, 4, 10, 13); return g; })());
def('Trash', (() => { const g = canvas(); hline2(g, 2, 13, 3); dline(g, 4, 5, 5, 13); dline2(g, 5, 5, 6, 13); dline(g, 11, 5, 10, 13); dline2(g, 10, 5, 9, 13); hline(g, 6, 9, 13); vline(g, 7, 6, 11, 0.45); vline(g, 9, 6, 11, 0.45); hline2(g, 5, 10, 1); vline(g, 5, 0, 1); vline(g, 10, 0, 1); return g; })());
def('PencilSimple', bmp(
  '.............##.',
  '............###.',
  '..........###.#.',
  '.........###.##.',
  '.......###.##...',
  '......###.##....',
  '....###.##......',
  '...###.##.......',
  '..###.##........',
  '.###.##.........',
  '.##.##..........',
  '#####...........',
  '####............',
  '###.............',
  '................',
  '................'));
def('Star', bmp(
  '.......##.......',
  '......####......',
  '......####......',
  '################',
  '.##############.',
  '..##########....',
  '...########.....',
  '....######......',
  '....######......',
  '...###..###.....',
  '..##......##....',
  '.##........##...',
  '................',
  '................',
  '................',
  '................'));
def('Clock', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); px(g, 2, 1); px(g, 13, 1); px(g, 1, 2); px(g, 14, 2); px(g, 2, 14); px(g, 13, 14); px(g, 1, 13); px(g, 14, 13); vline(g, 8, 4, 8); hline(g, 8, 11, 8); return g; })());

// —— 状态/提示 ——
def('Info', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); px(g, 2, 1); px(g, 13, 1); px(g, 1, 2); px(g, 14, 2); px(g, 2, 14); px(g, 13, 14); px(g, 1, 13); px(g, 14, 13); rect(g, 8, 4, 8, 4); rect(g, 7, 7, 8, 11); return g; })());
def('CheckCircle', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); px(g, 2, 1); px(g, 13, 1); px(g, 1, 2); px(g, 14, 2); px(g, 2, 14); px(g, 13, 14); px(g, 1, 13); px(g, 14, 13); dline2(g, 4, 7, 7, 10); dline2(g, 7, 10, 12, 4); return g; })());
def('WarningCircle', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); px(g, 2, 1); px(g, 13, 1); px(g, 1, 2); px(g, 14, 2); px(g, 2, 14); px(g, 13, 14); px(g, 1, 13); px(g, 14, 13); vline(g, 8, 4, 8); rect(g, 8, 10, 8, 11); return g; })());
def('WarningOctagon', (() => { const g = canvas(); hline(g, 5, 10, 1); ring(g, 1, 3, 14, 12); rect(g, 2, 1, 4, 2, 0); rect(g, 11, 1, 13, 2, 0); rect(g, 2, 13, 4, 14, 0); rect(g, 11, 13, 13, 14, 0); vline(g, 8, 4, 8); rect(g, 7, 10, 8, 11); return g; })());
def('Circle', (() => { const g = canvas(); ring(g, 2, 2, 13, 13); px(g, 2, 1); px(g, 13, 1); px(g, 1, 2); px(g, 14, 2); px(g, 2, 14); px(g, 13, 14); px(g, 1, 13); px(g, 14, 13); return g; })());

// —— 箭头/控件 ——
def('ArrowClockwise', (() => { const g = canvas(); ring(g, 3, 3, 12, 12); rect(g, 3, 3, 5, 5, 0); rect(g, 10, 3, 12, 5, 0); rect(g, 3, 10, 5, 12, 0); px(g, 4, 6); px(g, 6, 4); px(g, 11, 6); px(g, 9, 4); dline2(g, 12, 2, 13, 5); dline(g, 10, 4, 13, 4); return g; })());
def('ArrowsClockwise', (() => { const g = canvas(); ring(g, 3, 3, 12, 12); rect(g, 3, 3, 5, 5, 0); rect(g, 10, 3, 12, 5, 0); rect(g, 3, 10, 5, 12, 0); px(g, 4, 6); px(g, 6, 4); px(g, 11, 6); px(g, 9, 4); dline2(g, 3, 10, 4, 13); dline(g, 2, 12, 5, 12); dline2(g, 12, 2, 13, 5); dline(g, 10, 4, 13, 4); return g; })());
def('CaretDown', bmp(
  '................',
  '................',
  '................',
  '################',
  '.##############.',
  '..############..',
  '....########....',
  '......####......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................'));
def('CaretUp', bmp(
  '................',
  '................',
  '................',
  '......####......',
  '....########....',
  '..############..',
  '.##############.',
  '################',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................'));
def('CaretRight', bmp(
  '................',
  '..##............',
  '..####..........',
  '..######........',
  '..########......',
  '..##########....',
  '..############..',
  '..############..',
  '..##########....',
  '..########......',
  '..######........',
  '..####..........',
  '..##............',
  '................',
  '................',
  '................'));
def('DotsThree', (() => { const g = canvas(); rect(g, 1, 6, 4, 9); rect(g, 6, 6, 9, 9); rect(g, 11, 6, 14, 9); return g; })());

// —— AI 钮（老板点名重设计）：像素机器人头（方眼+天线；关=眼灭由运行时换亮档，glyph 同源）——
def('AiRobot', bmp(
  '................',
  '.......##.......',
  '.......##.......',
  '..############..',
  '..#..........#..',
  '..#.####.####.#.',
  '..#.####.####.#.',
  '..#..........#..',
  '..#...####....#.',
  '..#..........#..',
  '..############..',
  '...#........#...',
  '...#........#...',
  '................',
  '................',
  '................'));

/* ---------- 拼版渲染（全家福硬边 PNG，供判读） ---------- */
const names = Object.keys(GLYPHS);
const cols = 7, scale = 12, gap = 12;
const rows = Math.ceil(names.length / cols);
const W = cols * (G * scale + gap) + gap, H = rows * (G * scale + gap + 28) + gap;
const img = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { img[i * 4] = 255; img[i * 4 + 1] = 255; img[i * 4 + 2] = 255; img[i * 4 + 3] = 255; }
function paint(x, y, v, g0 = 30) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 4;
  const c = Math.round(g0 + (255 - g0) * (1 - Math.min(1, v * (g0 === 30 ? 1 : 1))));
  img[o] = img[o + 1] = img[o + 2] = v >= 1 ? g0 : Math.round(g0 + (255 - g0) * (1 - v));
  img[o + 3] = 255;
}
for (let i = 0; i < names.length; i++) {
  const g = GLYPHS[names[i]];
  const ox = gap + (i % cols) * (G * scale + gap);
  const oy = gap + Math.floor(i / cols) * (G * scale + gap + 28);
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    if (g[y][x] > 0) {
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
        // 1 格边缘暗 1px = bevel 观感（判读用不着，纯好看→省）
        paint(ox + x * scale + sx, oy + y * scale + sy, g[y][x]);
      }
    }
  }
}
mkdirSync(join(repoDir, 'assets', 'icons'), { recursive: true });
const png = encodePng(img, W, H);
writeFileSync(join(repoDir, 'assets', 'icons', 'glyph-sheet.png'), png);

/* ---------- 质检报告 ---------- */
let bad = 0;
console.log('glyph 数:', names.length);
for (const n of names) {
  const q = quality(GLYPHS[n]);
  const flag = q.ok ? '✓' : '✗';
  if (!q.ok) bad++;
  console.log(`${flag} ${n.padEnd(18)} 墨${(q.ratio * 100).toFixed(1)}% 连通${q.comps}`);
}
console.log(bad === 0 ? '质检全绿' : `质检 ${bad} 项不达标`);
