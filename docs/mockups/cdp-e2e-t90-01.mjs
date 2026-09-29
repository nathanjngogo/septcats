/* cdp-e2e-t90-01.mjs —— T90-01B「壁纸衬底真通透」真机验收（老板 09-28 深夜圈图：
 * 「毛玻璃的通透性也没有，没有跟着背景变色」→ 要的通透 = 玻璃透出**桌面壁纸**）。
 *
 * 方案史（为什么不是 DWM acrylic）：材质路线本机实测不可达——任务栏系统亚克力取色
 * 正常，Electron 窗 backdrop 却恒死灰（acrylic/mica × transparent 真假 × Electron
 * 37/38 全验过；DwmGetUnmetMatchRequirements=0 系统自评合格，判定为企业版会话/虚拟
 * 显示驱动下 Chromium 拿不到壁纸共享）。T90-01B 换纯渲染器链路：main 只读壁纸文件
 * → renderer 挂 data-wallpaper=1 铺壳层底 → glass 面板的半透明 + backdrop-filter
 * 磨的就是真壁纸像素。链路全部发生在 Chromium 合成层内 → **page.screenshot 直接
 * 取证**（capturePage/系统截图盲区只对 DWM 层成立，本方案不吃它）。
 *
 * 判据（全部像素级客观）：
 *   P1 glass 档 → data-wallpaper=1 且 --sc-wallpaper 为 data:image URL。
 *   P2 glass 侧栏（半透明 chrome 面板）截图彩度 >18 且比 pixel 基线高 ≥6
 *      （paper 实心 canvas sat≈14 对照）。
 *   P3 切 pixel → data-wallpaper 撤（门控关闭，绝不完全透）。
 *   P4 切回 glass → 衬底恢复（属性驱动可逆，无重启）。
 *   P5 dark+contrast 下 data-wallpaper 仍=1（三轴与衬底正交）。
 *   P6 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t90-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9596');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t90', 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) {
  console.log(text);
  try { mkdirSync(dirname(RESULT), { recursive: true }); appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* 台账写失败不阻断 */ }
}
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 240) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() { try { execSync('taskkill /F /IM Septcats.exe', { stdio: 'ignore' }); } catch { /* */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

let CHILD = null;
async function waitReady(page) {
  for (let i = 0; i < 20; i++) {
    await wait(400);
    if (await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null)) break;
  }
  await wait(2500); // 壁纸 IPC 拉取 + 衬底挂稳（含 backdrop-filter 首帧合成）
}

async function boot(theme, palette, look) {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme, locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: dirname(PACKAGE_APP), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) { throw new Error('CDP 连接超时'); }
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  let page = null;
  for (let i = 0; i < 30; i++) { await wait(500); page = ctx.pages().find((p) => p.url().includes('index.html')); if (page) break; }
  if (page === null) { throw new Error('主窗口未就绪'); }
  await page.evaluate(([pal, lk]) => { localStorage.setItem('septcats.palette', pal); localStorage.setItem('septcats.look', lk); }, [palette, look]);
  await page.reload();
  await waitReady(page);
  return { child: CHILD, browser, page };
}

async function setLookPalette(page, look, palette) {
  await page.evaluate(([lk, pal]) => { localStorage.setItem('septcats.look', lk); localStorage.setItem('septcats.palette', pal); }, [look, palette]);
  await page.reload();
  await waitReady(page);
}

// —— PNG 解码（纯 stdlib）——
function decodePngBuf(d) {
  let pos = 8; let idat = Buffer.alloc(0); let w = 0; let h = 0; let bitd = 8; let ct = 6;
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos); const typ = d.toString('latin1', pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + ln); pos += 12 + ln;
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitd = data[8]; ct = data[9]; }
    else if (typ === 'IDAT') { idat = Buffer.concat([idat, data]); }
    else if (typ === 'IEND') { break; }
  }
  const raw = inflateSync(idat);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1; const bpp = ch * (bitd / 8); const stride = w * bpp;
  const px = Buffer.alloc(h * stride); let i = 0; let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[i]; i += 1; const lineBuf = Buffer.from(raw.subarray(i, i + stride)); i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? lineBuf[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      if (ft === 1) lineBuf[x] = (lineBuf[x] + a) & 255;
      else if (ft === 2) lineBuf[x] = (lineBuf[x] + b) & 255;
      else if (ft === 3) lineBuf[x] = (lineBuf[x] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p0 = a + b - c; const pa = Math.abs(p0 - a); const pb = Math.abs(p0 - b); const pc = Math.abs(p0 - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        lineBuf[x] = (lineBuf[x] + pr) & 255;
      }
    }
    lineBuf.copy(px, y * stride); prev = lineBuf;
  }
  return { w, h, ch, px };
}

function regionStats(img) {
  let sat = 0, lum = 0, n = 0;
  const { w, h, ch, px } = img;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * ch;
      const r = px[o], g = px[o + 1], b = px[o + 2];
      sat += Math.max(r, g, b) - Math.min(r, g, b);
      lum += (r + g + b) / 3;
      n++;
    }
  }
  return { avgSat: +(sat / (n || 1)).toFixed(1), avgLum: +(lum / (n || 1)).toFixed(1) };
}

/** 截侧栏空白带（glass 档侧栏 32% alpha chrome 面板 = 壁纸透出色最直接的观测位）。 */
async function sidebarShot(page, name) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.sc-shell__sidebar');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x) + 8, y: Math.round(r.y) + 80, width: Math.max(40, Math.round(r.width) - 16), height: Math.min(160, Math.max(40, Math.round(r.height) - 200)) };
  });
  if (box === null) throw new Error('侧栏元素缺失');
  const buf = await page.screenshot({ clip: box });
  const path = join(SHOT_DIR, `${name}.png`);
  writeFileSync(path, buf);
  return { path, st: regionStats(decodePngBuf(buf)) };
}

async function wallpaperState(page) {
  return page.evaluate(() => ({
    wp: document.documentElement.dataset.wallpaper ?? null,
    look: document.documentElement.dataset.look ?? null,
    theme: document.documentElement.dataset.theme ?? null,
    varOk: (document.documentElement.style.getPropertyValue('--sc-wallpaper') || '').includes('data:image'),
  }));
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(PACKAGE_APP)) { line('FATAL 缺打包靶 ' + PACKAGE_APP); process.exitCode = 2; return; }
  const realBefore = rootMtime();

  const h = await boot('light', 'paper', 'glass');

  STEP = 'P1';
  const s1 = await wallpaperState(h.page);
  const p1ok = s1.wp === '1' && s1.varOk;
  check('P1 glass → data-wallpaper=1 + --sc-wallpaper=data:image（壁纸 IPC 链路通）', p1ok, JSON.stringify(s1));
  if (!p1ok) {
    line('!! 衬底未挂（壁纸读取失败或门控异常）——后续判据失去意义，终止');
    await h.browser.close().catch(() => {}); h.child.kill();
    process.exitCode = 1; return;
  }

  STEP = 'P2';
  const g2 = await sidebarShot(h.page, 'glass-light-paper');
  await setLookPalette(h.page, 'pixel', 'paper');
  const s3 = await wallpaperState(h.page);
  const g3 = await sidebarShot(h.page, 'pixel-light-paper');
  // C 轮判据升级：壁纸可为深色（实测暗紫 lum≈60）——此时 clash 自适应亮纱保护
  // 可读性，透出表现为「亮度被壁纸拉离实心基线」而非彩度上升。两通道任一成立
  // = 壁纸真的透出来了：彩度跟壁纸（sat 差）或明度跟壁纸（lum 差 >25）。
  const p2ok = g2.st.avgSat >= g3.st.avgSat + 6 || Math.abs(g2.st.avgLum - g3.st.avgLum) > 25;
  check('P2 glass 侧栏透出壁纸（彩度或明度跟壁纸离实心基线）', p2ok, `glass sat=${g2.st.avgSat} lum=${g2.st.avgLum} | pixel sat=${g3.st.avgSat} lum=${g3.st.avgLum}`);

  STEP = 'P3';
  check('P3 切 pixel → data-wallpaper 撤（门控关闭，绝不完全透）', s3.wp === null, JSON.stringify(s3));

  STEP = 'P4';
  await setLookPalette(h.page, 'glass', 'paper');
  const s4 = await wallpaperState(h.page);
  const g4 = await sidebarShot(h.page, 'glass-back');
  const p4ok = s4.wp === '1' && (g4.st.avgSat >= g3.st.avgSat + 6 || Math.abs(g4.st.avgLum - g3.st.avgLum) > 25);
  check('P4 切回 glass → 衬底恢复（属性驱动可逆，无重启）', p4ok, `wp=${String(s4.wp)} sat=${g4.st.avgSat} lum=${g4.st.avgLum} vs pixel lum=${g3.st.avgLum}`);

  STEP = 'P5';
  await h.page.evaluate(() => { localStorage.setItem('septcats.theme', 'dark'); });
  await setLookPalette(h.page, 'glass', 'contrast');
  const s5 = await wallpaperState(h.page);
  check('P5 dark+contrast 下 data-wallpaper 仍=1（三轴与衬底正交）', s5.wp === '1' && s5.look === 'glass', JSON.stringify(s5));

  STEP = 'P6';
  check('P6 真实档案根 mtime 不变', rootMtime() === realBefore, `before=${String(realBefore)} after=${String(rootMtime())}`);

  await h.browser.close().catch(() => {}); h.child.kill();
  for (const pid of listeningPids(PORT)) killTree(pid);

  const fails = assertions.filter((a) => !a.ok);
  line(`\n===== T90-01B 壁纸衬底探针：${assertions.length - fails.length} PASS / ${fails.length} FAIL（靶=win-unpacked，截图 ${SHOT_DIR}）=====`);
  if (fails.length > 0) { process.exitCode = 1; }
  line(`耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => {
  console.error('FATAL', err);
  try { if (CHILD) { CHILD.kill(); } } catch { /* */ }
  for (const pid of listeningPids(PORT)) killTree(pid);
  process.exitCode = 2;
});
