/*
 * make-icon.mjs —— 从 resources/icon.svg 程序化生成打包图标（零新增依赖）。
 *
 * 方案（任务书 TASK-T12-01 §0.6 授权：不新增图像库）：
 *   node 模式      → 以当前仓库已有的 electron 二进制（devDependency）启动本文件；
 *   electron 模式  → 离屏 BrowserWindow 渲染 SVG（256×256，白底，Q8「线条猫·白底」）
 *                    → capturePage → nativeImage 缩放出 256/48/32/16 → toPNG
 *                    → stdlib 组装多尺寸 ICO（Vista+ 支持 PNG 表项）写 build/icon.ico
 *                    → 另写 build/icon.png（256，builder png→ico 自动转换的降级冗余）。
 *   darwin 分支    → 输出 .iconset 全尺寸 PNG 并调用系统 iconutil 生成 build/icon.icns
 *                    （macOS 才能执行；Windows 本机跑不到，代码按任务书要求就位）。
 *
 * 用法：node scripts/make-icon.mjs   （在 apps/desktop 目录下）
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(pkgDir, 'build');
const svgPath = join(pkgDir, 'resources', 'icon.svg');
const SIZES = [16, 32, 48, 256];

/* ---------- node 模式：拉起 electron 执行渲染 ---------- */
if (!process.versions.electron) {
  const require = createRequire(import.meta.url);
  const electronBin = require('electron'); // electron 包导出二进制绝对路径
  mkdirSync(buildDir, { recursive: true });
  const res = spawnSync(electronBin, [fileURLToPath(import.meta.url)], {
    cwd: pkgDir,
    stdio: 'inherit',
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

/* ---------- electron 模式 ---------- */
const { app, BrowserWindow, nativeImage } = await import('electron');

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG IHDR 里的宽高（大端，位于固定偏移 16/20）。 */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 组装多尺寸 ICO（全 PNG 表项）。 */
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0); // 256 → 0
    e.writeUInt8(size % 256, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

async function renderPng256() {
  const svg = readFileSync(svgPath, 'utf8');
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:256px;height:256px;background:#fff;overflow:hidden}
    img{display:block;width:256px;height:256px}
  </style></head><body><img src="${dataUrl}"></body></html>`;

  const win = new BrowserWindow({
    width: 256,
    height: 256,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300)); // 等离屏帧稳定
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  win.destroy();
  if (img.isEmpty()) throw new Error('capturePage 返回空图像');
  return img;
}

async function main() {
  const base = await renderPng256();

  const pngs = SIZES.map((size) => {
    const resized = size === 256 ? base : base.resize({ width: size, height: size, quality: 'best' });
    const { width, height } = resized.getSize();
    if (width !== size || height !== size) {
      throw new Error(`resize 尺寸不符：期望 ${size}×${size}，实际 ${width}×${height}`);
    }
    const png = resized.toPNG();
    if (!png.subarray(0, 8).equals(pngSignature)) throw new Error('toPNG 产物非 PNG 签名');
    return { size, png };
  });

  const ico = buildIco(pngs);
  writeFileSync(join(buildDir, 'icon.ico'), ico);
  writeFileSync(join(buildDir, 'icon.png'), pngs.find((p) => p.size === 256).png);

  // darwin 分支：iconset → iconutil → build/icon.icns（本机为 Windows，跑不到）
  if (process.platform === 'darwin') {
    const { spawnSync: ss } = await import('node:child_process');
    const iconsetDir = join(buildDir, 'icon.iconset');
    rmSync(iconsetDir, { recursive: true, force: true });
    mkdirSync(iconsetDir, { recursive: true });
    const spec = [
      ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
      ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
      ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
      ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
      ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
    ];
    for (const [name, size] of spec) {
      const img = size <= 256
        ? base.resize({ width: size, height: size, quality: 'best' })
        : base.resize({ width: Math.min(size, 256), height: Math.min(size, 256), quality: 'best' });
      writeFileSync(join(iconsetDir, name), img.toPNG());
    }
    const r = ss('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', join(buildDir, 'icon.icns')], { stdio: 'inherit' });
    rmSync(iconsetDir, { recursive: true, force: true });
    if (r.status !== 0) throw new Error('iconutil 生成 icns 失败');
  }

  console.log(`make-icon: ok — build/icon.ico (${ico.length} bytes, sizes ${SIZES.join('/')}) + build/icon.png`);
  app.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.error('make-icon: FAILED —', err.message);
  app.exit(1);
});
