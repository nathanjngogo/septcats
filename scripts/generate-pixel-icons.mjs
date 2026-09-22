/*
 * generate-pixel-icons.mjs —— 一键出全套像素品牌图（生成 SVG + 原生直画 PNG，零依赖零网络）。
 * 用法：node scripts/generate-pixel-icons.mjs
 * 产物：assets/brand/septcats-3dpix-{A,B,C,T}.svg；assets/brand/dist/png/*-{16,24,32,48,256}.png
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSvgToRgba, encodePng } from './pixel-png.mjs';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = join(repoDir, 'assets', 'brand');
const distPng = join(brandDir, 'dist', 'png');

/* ① SVG 生成（复用现成生成器） */
const gen = spawnSync(process.execPath, [join(repoDir, 'scripts/gen-icon-3dpix.mjs'), 'all'], { stdio: 'inherit' });
if (gen.status !== 0) process.exit(gen.status ?? 1);
const genT = spawnSync(process.execPath, [join(repoDir, 'scripts/gen-icon-3dpix.mjs'), 'T'], { stdio: 'inherit' });
if (genT.status !== 0) process.exit(genT.status ?? 1);

/* ② PNG 原生直画（每档都是真实分辨率，无重采样） */
mkdirSync(distPng, { recursive: true });
const jobs = [
  ['septcats-3dpix-C', [16, 32, 48, 256]], // 侧位默认版（任务栏/窗口/安装器/文档）
  ['septcats-3dpix-A', [16, 32, 48, 256]], // 备选变体
  ['septcats-3dpix-B', [16, 32, 48, 256]], // 备选变体
  ['septcats-3dpix-T', [16, 24, 32]],      // 托盘原生简化子型
];
for (const [name, sizes] of jobs) {
  for (const size of sizes) {
    const rgba = renderSvgToRgba(join(brandDir, `${name}.svg`), size);
    const png = encodePng(rgba, size, size);
    const file = join(distPng, `${name}-${size}.png`);
    (await import('node:fs')).writeFileSync(file, png);
    console.log('png', file.replace(repoDir, ''), size, 'x', size, png.length, 'B');
  }
}
console.log('DONE');
