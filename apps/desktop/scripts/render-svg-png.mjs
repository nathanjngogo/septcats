/*
 * render-svg-png.mjs —— 用仓内 Electron 离屏窗口把 SVG 渲染成多尺寸 PNG（零新依赖）。
 * 管线与 make-icon.mjs 同源（data URL img 内嵌 + 256 原生离屏渲染 + nativeImage.resize）。
 * 用法（在 apps/desktop 下）：
 *   node scripts/render-svg-png.mjs <svg 路径...> --out <目录> --sizes 16,48,256
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const flagIdx = new Set();
for (const f of ['--out', '--sizes']) {
  const i = args.indexOf(f);
  if (i >= 0) { flagIdx.add(i); flagIdx.add(i + 1); }
}
const val = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
};
const outDir = val('--out', '.');
const sizes = val('--sizes', '256').split(',').map(Number);
const svgPaths = args.filter((a, i) => !flagIdx.has(i) && a.endsWith('.svg') && existsSync(a));

/* node 模式：re-exec 进 electron（同 make-icon.mjs） */
if (!process.versions.electron) {
  const require = createRequire(import.meta.url);
  const electronBin = require('electron');
  const res = spawnSync(electronBin, [fileURLToPath(import.meta.url), ...args], { stdio: 'inherit' });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

const { app, BrowserWindow } = await import('electron');

await app.whenReady();
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const svgPath of svgPaths) {
  const svg = readFileSync(svgPath, 'utf8');
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:256px;height:256px;background:#fff;overflow:hidden}
    img{display:block;width:256px;height:256px}
  </style></head><body><img src="${dataUrl}"></body></html>`;

  const win = new BrowserWindow({
    width: 256, height: 256, useContentSize: true, show: false, frame: false,
    backgroundColor: '#ffffff', webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  win.destroy();
  if (img.isEmpty()) {
    console.error('EMPTY capture:', svgPath);
    failed++;
    continue;
  }
  for (const size of sizes) {
    const resized = size === 256 ? img : img.resize({ width: size, height: size, quality: 'best' });
    const png = resized.toPNG();
    const name = `${basename(svgPath, '.svg')}-${size}.png`;
    writeFileSync(join(outDir, name), png);
    console.log('wrote', name, png.length, 'bytes');
  }
}
app.exit(failed ? 1 : 0);
