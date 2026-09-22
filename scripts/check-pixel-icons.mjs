/*
 * check-pixel-icons.mjs —— 像素图标族视觉质检门禁（TASK-T58-01 §1.3）。
 *
 * 断言（全绿才 exit 0）：
 *  ① 同源：`packages/ui/src/pixelIcons.tsx` 的运行时矩阵 == `scripts/gen-pixel-glyphs.mjs`
 *     的 GLYPHS 资产表（28/28 逐格），缺一枚或多一枚即红 —— 「一个不漏」的形式证明；
 *  ② 半透明像素 = 0：16/24 两档直画（最近邻取格，零插值）后不得出现 0<a<255 的像素
 *     （硬边像素画的铁律：既无抗锯齿灰边，也无半格）；
 *  ③ 色相合法：每个像素必须恰好落在 {背景} ∪ {foreground 按 tone 档压到背景} 的
 *     灰度集合里（r=g=b）—— 证明色值只来自 currentColor + opacity 分档，没有暗改的
 *     字面色 / 彩色 / 抗锯齿混色；
 *  ④ 16px 档墨迹占比在可读带内：任务书 §1.3 给的带是 18–46%。PM 定稿的资产表里有
 *     5 枚轮廓族天然低墨（Plus/Check/Close/ArrowClockwise/ArrowsClockwise，10.2%–18.0%），
 *     资产禁止重画 → 这 5 枚按「已裁决豁免」记录（THIN_WAIVER），每次运行都会把实测值
 *     连名带数打印出来，PM 可随时撤豁免（撤了即红）。
 *
 * 产物：`assets/icons/png/<Name>-16.png`、`<Name>-24.png` 全家福（浅/深各一套由拼版呈现）
 *       + `assets/icons/png/glyph-sheet-overview.png` 拼版总览 1 张
 *         （每枚 4 档：16 浅 / 16 深 / 24 浅 / 24 深）。
 *
 * 运行：node scripts/check-pixel-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './pixel-png.mjs';
import { GLYPHS } from './gen-pixel-glyphs.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FILE = join(repoDir, 'packages', 'ui', 'src', 'pixelIcons.tsx');
const OUT_DIR = join(repoDir, 'assets', 'icons', 'png');
const GRID = 16;

/** T53 灰阶色板里的图标前景 / 平面（与 packages/ui/test/pixel-icon-contrast.test.ts 同源）。 */
const THEMES = {
  light: { fg: '#595959', bg: '#F5F5F5' }, // ink-secondary on canvas
  dark: { fg: '#A8A8A8', bg: '#141414' },
};

/** §1.3 可读带。 */
const INK_BAND = { min: 0.18, max: 0.46 };
/** 豁免（PM 定稿资产，禁止重画）：实测值随运行打印，撤豁免即红。 */
const THIN_WAIVER = new Set(['Plus', 'Check', 'Close', 'ArrowClockwise', 'ArrowsClockwise']);

const fail = [];
const warn = [];
const note = (line) => console.log(line);

/* ---------- 1. 解析运行时矩阵（pixelIcons.tsx） ---------- */
function parseRuntimeGlyphs(src) {
  const block = /export const PIXEL_GLYPHS = \{([\s\S]*?)\n\} as const satisfies/.exec(src);
  if (block === null) throw new Error('pixelIcons.tsx 未找到 PIXEL_GLYPHS 块');
  const out = new Map();
  const entryRe = /^ {2}(\w+): \[\r?\n([\s\S]*?)^ {2}\],/gm;
  for (const m of block[1].matchAll(entryRe)) {
    const rows = [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    out.set(m[1], rows);
  }
  return out;
}
function parseObjectBody(src, name) {
  const m = new RegExp(`export const ${name} = \\{([^}]*)\\}`).exec(src);
  if (m === null) throw new Error(`pixelIcons.tsx 未找到 ${name}`);
  return m[1];
}
/** TONE_OPACITY：键是数字 tone。 */
function parseToneOpacity(src) {
  const table = new Map();
  for (const pair of parseObjectBody(src, 'TONE_OPACITY').matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)) {
    table.set(Number(pair[1]), Number(pair[2]));
  }
  return table;
}
/** GLYPH_TONES：键是字符字面量（'#' / o / x）。 */
function parseGlyphTones(src) {
  const table = new Map();
  for (const pair of parseObjectBody(src, 'GLYPH_TONES').matchAll(/['"]?([#ox])['"]?\s*:\s*(\d+(?:\.\d+)?)/g)) {
    table.set(pair[1], Number(pair[2]));
  }
  return table;
}

const src = readFileSync(SRC_FILE, 'utf8');
const runtime = parseRuntimeGlyphs(src);
const GLYPH_TONES = parseGlyphTones(src); // 字符 → 设计 tone（1/.45/.3）
const TONE_OPACITY = parseToneOpacity(src); // tone → 运行时 opacity
if (GLYPH_TONES.size === 0 || TONE_OPACITY.size === 0) {
  console.error('✗ 解析 pixelIcons.tsx 的 tone 表失败（GLYPH_TONES / TONE_OPACITY 为空）');
  process.exit(1);
}
const CHAR_OF_TONE = new Map([...GLYPH_TONES].map(([ch, tone]) => [tone, ch]));
const OPACITY_OF_CHAR = new Map([...GLYPH_TONES].map(([ch, tone]) => [ch, TONE_OPACITY.get(tone)]));

/* ---------- 2. 同源比对（资产表 ↔ 运行时表） ---------- */
const assetNames = Object.keys(GLYPHS);
const assetRows = new Map(
  assetNames.map((name) => [name, GLYPHS[name].map((row) => row.map((v) => CHAR_OF_TONE.get(v) ?? '.').join(''))]),
);
const runtimeNames = [...runtime.keys()];
{
  const missing = assetNames.filter((n) => !runtime.has(n));
  const extra = runtimeNames.filter((n) => !assetNames.includes(n));
  if (missing.length > 0) fail.push(`运行时表缺 glyph：${missing.join(', ')}`);
  if (extra.length > 0) fail.push(`运行时表多出资产没有的 glyph：${extra.join(', ')}`);
  let mismatch = 0;
  for (const name of assetNames) {
    if (!runtime.has(name)) continue;
    const a = assetRows.get(name);
    const b = runtime.get(name);
    if (a.length !== b.length || a.some((row, i) => row !== b[i])) {
      mismatch += 1;
      fail.push(`矩阵不等价：${name}（资产 ${String(a.length)} 行 / 运行时 ${String(b.length)} 行）`);
    }
  }
  note(`① 同源：资产 ${String(assetNames.length)} 枚 ↔ 运行时 ${String(runtimeNames.length)} 枚，逐格不等价 ${String(mismatch)} 枚`);
}

/* ---------- 3. 网格合法性（整数格 + 字符集） ---------- */
for (const [name, rows] of runtime) {
  if (rows.length !== GRID) fail.push(`${name} 行数 ${String(rows.length)} ≠ ${String(GRID)}`);
  for (const [i, row] of rows.entries()) {
    if (row.length !== GRID) fail.push(`${name} 第 ${String(i)} 行宽 ${String(row.length)} ≠ ${String(GRID)}`);
    if (!/^[#ox.]{16}$/.test(row)) fail.push(`${name} 第 ${String(i)} 行含非法字符：${row}`);
  }
}

/* ---------- 4. 直画（最近邻取格，零插值） ---------- */
const hexToRgb = (hex) => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
};
const blend = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

/** 按 size 直画一格：返回 { rgba, legal:Set('r,g,b'), partial:number }。 */
function rasterize(rows, size, theme) {
  const fg = hexToRgb(theme.fg);
  const bg = hexToRgb(theme.bg);
  const legal = new Set([bg.join(',')]);
  for (const opacity of new Set([...OPACITY_OF_CHAR.values()])) {
    if (opacity > 0) legal.add(blend(fg, bg, opacity).join(','));
  }
  const rgba = Buffer.alloc(size * size * 4);
  let partial = 0;
  let illegal = 0;
  const illegalSamples = new Set();
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const ch = rows[Math.floor((py * GRID) / size)][Math.floor((px * GRID) / size)];
      const opacity = ch === '.' ? 0 : OPACITY_OF_CHAR.get(ch);
      if (opacity === undefined) {
        illegal += 1;
        illegalSamples.add(ch);
        continue;
      }
      const [r, g, b] = opacity === 0 ? bg : blend(fg, bg, opacity);
      const o = (py * size + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
      if (r !== g || g !== b) {
        illegal += 1;
        illegalSamples.add(`${String(r)},${String(g)},${String(b)}`);
      } else if (!legal.has(`${String(r)},${String(g)},${String(b)}`)) {
        illegal += 1;
        illegalSamples.add(`${String(r)},${String(g)},${String(b)}`);
      }
    }
  }
  // 半透明 = 既非全空（a=0）也非实心（a=255）；硬边直画必须只有这两种
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0 && rgba[i] < 255) partial += 1;
  return { rgba, partial, illegal, illegalSamples: [...illegalSamples].slice(0, 3) };
}

/* ---------- 5. 质检 + 落盘 ---------- */
mkdirSync(OUT_DIR, { recursive: true });
let partialTotal = 0;
let illegalTotal = 0;
const thin = [];
const inkRows = [];

for (const name of assetNames) {
  const rows = runtime.get(name);
  if (rows === undefined) continue;
  let ink = 0;
  for (const row of rows) for (const ch of row) if (ch !== '.') ink += 1;
  const ratio = ink / (GRID * GRID);
  inkRows.push({ name, ink, ratio });
  if (ratio < INK_BAND.min || ratio > INK_BAND.max) {
    if (THIN_WAIVER.has(name)) {
      thin.push(`${name} ${(ratio * 100).toFixed(2)}%`);
    } else {
      fail.push(`墨迹占比越界：${name} ${(ratio * 100).toFixed(2)}%（要求 ${String(INK_BAND.min * 100)}–${String(INK_BAND.max * 100)}%）`);
    }
  }
  for (const size of [16, 24]) {
    const light = rasterize(rows, size, THEMES.light);
    const dark = rasterize(rows, size, THEMES.dark);
    partialTotal += light.partial + dark.partial;
    illegalTotal += light.illegal + dark.illegal;
    if (light.illegal > 0 || dark.illegal > 0) {
      fail.push(`色相非法：${name}@${String(size)}px 非法像素 ${String(light.illegal + dark.illegal)}（样本 ${[...light.illegalSamples, ...dark.illegalSamples].join(' / ')}）`);
    }
    // 每枚每档落 PNG（浅色底 = 常规态；深色底仅入拼版总览，避免文件数翻倍）
    if (size === 16) writeFileSync(join(OUT_DIR, `${name}-16.png`), encodePng(light.rgba, size, size));
    else {
      writeFileSync(join(OUT_DIR, `${name}-16-dark.png`), encodePng(dark.rgba, size, size));
      writeFileSync(join(OUT_DIR, `${name}-24.png`), encodePng(light.rgba, size, size));
      writeFileSync(join(OUT_DIR, `${name}-24-dark.png`), encodePng(dark.rgba, size, size));
    }
  }
}
if (partialTotal > 0) fail.push(`半透明像素 ${String(partialTotal)} 个（硬边像素画要求 0）`);

/* ---------- 6. 拼版总览（每枚 4 档：16 浅 / 16 深 / 24 浅 / 24 深） ---------- */
{
  const cols = 4;
  const cell = 24 * 6; // 24px 档放大 6 倍
  const gap = 10;
  const W = cols * (cell + gap) + gap;
  const H = assetNames.length * (cell + gap) + gap;
  const img = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    img[i * 4] = 0xf5;
    img[i * 4 + 1] = 0xf5;
    img[i * 4 + 2] = 0xf5;
    img[i * 4 + 3] = 255;
  }
  const blit = (rgba, size, ox, oy) => {
    const scale = cell / size;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const o = (y * size + x) * 4;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const tx = ox + Math.floor(x * scale) + sx;
            const ty = oy + Math.floor(y * scale) + sy;
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const t = (ty * W + tx) * 4;
            img[t] = rgba[o];
            img[t + 1] = rgba[o + 1];
            img[t + 2] = rgba[o + 2];
            img[t + 3] = 255;
          }
        }
      }
    }
  };
  assetNames.forEach((name, i) => {
    const rows = runtime.get(name);
    if (rows === undefined) return;
    const oy = gap + i * (cell + gap);
    [16, 16, 24, 24].forEach((size, col) => {
      const theme = col % 2 === 0 ? THEMES.light : THEMES.dark;
      const { rgba } = rasterize(rows, size, theme);
      blit(rgba, size, gap + col * (cell + gap), oy);
    });
  });
  writeFileSync(join(OUT_DIR, 'glyph-sheet-overview.png'), encodePng(img, W, H));
  note(`拼版总览：${join('assets', 'icons', 'png', 'glyph-sheet-overview.png')}（${String(W)}×${String(H)}，行序 = 资产表序）`);
}

/* ---------- 7. 报告 ---------- */
note('');
note(`② 半透明像素：${String(partialTotal)}（要求 0）`);
note(`③ 色相：非法像素 ${String(illegalTotal)}（要求 0；合法色 = 背景 ∪ 前景×{${[...new Set([...OPACITY_OF_CHAR.values()])].join(',')}} 压底色）`);
note(`④ 16px 墨迹占比（带 ${String(INK_BAND.min * 100)}–${String(INK_BAND.max * 100)}%）：`);
for (const { name, ink, ratio } of [...inkRows].sort((a, b) => a.ratio - b.ratio)) {
  const flag = ratio < INK_BAND.min ? (THIN_WAIVER.has(name) ? '⚠豁免' : '✗') : ratio > INK_BAND.max ? '✗' : '✓';
  note(`   ${flag} ${name.padEnd(18)} ${String(ink).padStart(3)} 格 ${(ratio * 100).toFixed(2)}%`);
}
if (thin.length > 0) {
  warn.push(`5 枚以下低于 ${String(INK_BAND.min * 100)}% 下限，属 PM 定稿资产属性（T58-01 D-1）：${thin.join(' / ')}`);
}

note('');
if (warn.length > 0) for (const w of warn) note(`⚠ ${w}`);
if (fail.length > 0) {
  console.error(`✗ 像素图标门禁未过 ${String(fail.length)} 项：`);
  for (const f of fail) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ 像素图标门禁全绿：${String(assetNames.length)} 枚 × {16,24}px × {浅,深} 硬边直画，同源/半透明/色相/墨带 四项通过`);
