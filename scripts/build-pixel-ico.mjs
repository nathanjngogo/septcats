/*
 * build-pixel-ico.mjs —— 用原生直画 PNG 层组装 Windows .ico（纯 stdlib，零依赖）。
 * 用法：node scripts/build-pixel-ico.mjs
 * 输出：apps/desktop/build/icon.ico（五层：T16/T24/T32 + C48/C256，全部 PNG 表项）
 *      + apps/desktop/build/icon.png（C-256）
 *      + apps/desktop/build/icon-tray.png（T-16）/ icon-tray@2x.png（T-32）
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSvgToRgba, encodePng } from './pixel-png.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandSvg = join(repoDir, 'assets', 'brand');
const buildDir = join(repoDir, 'apps', 'desktop', 'build');

function mustSvg(name) {
  const p = join(brandSvg, name);
  if (!existsSync(p)) { console.error(`缺 SVG：${name}（先跑 node scripts/gen-icon-3dpix.mjs all && node scripts/gen-icon-3dpix.mjs T）`); process.exit(1); }
  return p;
}

/** 原生直画一层的 PNG。 */
function layer(svgName, size) {
  return encodePng(renderSvgToRgba(mustSvg(svgName), size), size, size);
}

/* 五层：小尺寸(≤32)用托盘简化子型 T（1 格=1 物理像素保硬边），大尺寸用 C 全细节 */
const LAYERS = [
  { svg: 'septcats-3dpix-T.svg', size: 16 },
  { svg: 'septcats-3dpix-T.svg', size: 24 },
  { svg: 'septcats-3dpix-T.svg', size: 32 },
  { svg: 'septcats-3dpix-C.svg', size: 48 },
  { svg: 'septcats-3dpix-C.svg', size: 256 },
];

const pngs = LAYERS.map((l) => ({ size: l.size, png: layer(l.svg, l.size) }));

/* ICO（Vista+ PNG 表项；同 make-icon.mjs 结构） */
const count = pngs.length;
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(count, 4);
let offset = 6 + 16 * count;
const entries = [];
for (const { size, png } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size % 256, 0);
  e.writeUInt8(size % 256, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += png.length;
  entries.push(e);
}
const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
writeFileSync(join(buildDir, 'icon.ico'), ico);

/* 配套 PNG：窗口/安装器/托盘 */
writeFileSync(join(buildDir, 'icon.png'), pngs.find((p) => p.size === 256).png);
writeFileSync(join(buildDir, 'icon-tray.png'), pngs.find((p) => p.size === 16).png);
writeFileSync(join(buildDir, 'icon-tray@2x.png'), pngs.find((p) => p.size === 32).png);

console.log(`build-pixel-ico: ok — icon.ico ${ico.length} B (layers ${LAYERS.map((l) => l.size).join('/')}) + icon.png + icon-tray[@2x].png`);
