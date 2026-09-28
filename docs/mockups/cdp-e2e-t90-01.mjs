/* cdp-e2e-t90-01.mjs —— 真通透（DWM 亚克力透出桌面壁纸）真机验收（TASK-T90-01，
 * 老板 09-28 深夜圈图：「毛玻璃的通透性也没有，没有跟着背景变色」）。
 *
 * 取证方法突破：capturePage 抓不到 DWM 合成层（历史坑），本探针改用
 * **PowerShell CopyFromScreen 系统级全屏截图**=屏幕最终像素，窗区取色与裸桌面
 * 壁纸同点比对 → 客观判「透出」。
 *
 * 靶子：打包产物 win-unpacked。判据：
 *   P1 glass 档 + 三条件满足 → renderer data-osglass=1 且 main.log osglass=true。
 *   P2 系统截图：窗区（chrome 带/主区多点）平均彩度 >20（壁纸暖色透出；实心
 *      灰面彩度 ≈0-3，烟测 D vs A/B 实证分界）。
 *   P3 切 pixel 档 → data-osglass 消失 + main.log osglass=false + 截图窗区实心
 *      （亮度≈canvas 且彩度骤降）。
 *   P4 切回 glass → 通透恢复（材质开关可逆，无重启）。
 *   P5 配色联动：glass 下 light+paper 窗区色调偏暖白底、dark+contrast 偏黑底，
 *      两组截图同点均透出壁纸（sat 都 >12 = 透的是壁纸不是色板）。
 *   P6 真实档案根 mtime 不变（沙箱档案零触碰红线）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const PACKAGE_APP = join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\t90-01`;
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9596');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_PS1 = 'E:\\Hermes Agent工作空间\\_scratch\\shot-ascii.ps1';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t90', 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) { console.log(text); try { appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* */ } }
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
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null)) break; }
  await wait(2500); // 材质应用 + DWM 磨砂稳定
  return { child: CHILD, browser, page };
}

function mainLog() {
  const p = join(ROOTD, 'logs', 'main.log');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

async function sysShot(name) {
  const out = join(SHOT_DIR, `${name}.png`);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${SHOT_PS1}" "${out}"`, { stdio: 'ignore', timeout: 30000 });
  return out;
}

/** 系统截图窗区分析：屏坐标 → 窗区相对坐标（避开正文文字/图标，取 chrome 带与主区空白）。 */
async function windowGeom(page) {
  return page.evaluate(() => {
    const d = window.devicePixelRatio || 1;
    return { x: window.screenX * d, y: window.screenY * d, w: window.outerWidth * d, h: window.outerHeight * d, d };
  });
}

// —— PNG 解码 + 窗区彩度分析（纯 stdlib，像素级客观判据）——
function loadPng(path) {
  const d = readFileSync(path);
  let pos = 8; let idat = Buffer.alloc(0); let w = 0; let h = 0; let bitd = 8; let ct = 6;
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos); const typ = d.toString('latin1', pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + ln); pos += 12 + ln;
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitd = data[8]; ct = data[9]; }
    else if (typ === 'IDAT') { idat = Buffer.concat([idat, data]); }
    else if (typ === 'IEND') { break; }
  }
  const zlib = { inflateSync };
  const raw = zlib.inflateSync(idat);
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

/** 窗区采样点：chrome 带（标题带中段/菜单带）、主区空白（避开左侧列表/中央文字）。 */
function samplePoints(geom) {
  const { x, y, w, h } = geom;
  const rel = (fx, fy) => [Math.round(x + w * fx), Math.round(y + h * fy)];
  return [rel(0.45, 0.02), rel(0.45, 0.055), rel(0.62, 0.30), rel(0.72, 0.55), rel(0.55, 0.75), rel(0.66, 0.88)];
}

function analyzeShot(path, geom) {
  const { w, h, ch, px } = loadPng(path);
  const pts = samplePoints(geom).filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h);
  const stats = pts.map(([x, y]) => {
    const o = (y * w + x) * ch;
    const r = px[o]; const g = px[o + 1]; const b = px[o + 2];
    return { hex: '#%s'.replace('%s', [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')), sat: Math.max(r, g, b) - Math.min(r, g, b), lum: (r * 299 + g * 587 + b * 114) / 1000 };
  });
  const avgSat = stats.reduce((s, v) => s + v.sat, 0) / (stats.length || 1);
  const avgLum = stats.reduce((s, v) => s + v.lum, 0) / (stats.length || 1);
  return { stats, avgSat, avgLum };
}

async function osglassState(page) {
  return page.evaluate(() => ({
    attr: document.documentElement.dataset.osglass ?? null,
    look: document.documentElement.dataset.look ?? null,
    theme: document.documentElement.dataset.theme ?? null,
  }));
}

async function setLookPalette(page, look, palette) {
  await page.evaluate(([lk, pal]) => { localStorage.setItem('septcats.look', lk); localStorage.setItem('septcats.palette', pal); }, [look, palette]);
  await page.reload();
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null)) break; }
  await wait(2500);
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(SHOT_PS1)) { line('FATAL 缺截图脚本 ' + SHOT_PS1); process.exitCode = 2; return; }
  const realBefore = rootMtime();

  let h = await boot('light', 'paper', 'glass');
  STEP = 'P1';
  let st = await osglassState(h.page);
  let log = mainLog();
  const p1ok = st.attr === '1' && /osglass=true/.test(log);
  check('P1 glass 档 → data-osglass=1 + main.log osglass=true（三条件门生效）', p1ok, `attr=${String(st.attr)} log=${log.split('\n').filter((x) => x.includes('osglass')).slice(-1)[0] ?? '(无)'}`);
  if (!p1ok) {
    line('!! 材质未生效（可能系统透明效果被关/非 Win11 22H2+）——P2-P5 判据失去意义，直接终止');
    await h.browser.close(); h.child.kill();
    assertions.push({ step: 'P2', name: '后续项因前置失败跳过', ok: false, raw: 'skip' });
    line(`===== T90-01：0 PASS / 终止 =====`);
    process.exitCode = 1; return;
  }

  STEP = 'P2';
  const geom = await windowGeom(h.page);
  const shotGlass = await sysShot('glass-light-paper');
  const a2 = analyzeShot(shotGlass, geom);
  check('P2 系统截图窗区透出壁纸（平均彩度 >20；实心灰面 ≈0-14（paper canvas sat=14））', a2.avgSat > 20, `avgSat=${a2.avgSat.toFixed(1)} 点=${a2.stats.map((s) => s.hex).join(',')}`);

  STEP = 'P3';
  await setLookPalette(h.page, 'pixel', 'paper');
  st = await osglassState(h.page);
  log = mainLog();
  check('P3 切 pixel → data-osglass 消失 + osglass=false（可逆关闭）', st.attr === null && /osglass=false/.test(log), `attr=${String(st.attr)} log=${log.split('\n').filter((x) => x.includes('osglass')).slice(-1)[0] ?? '(无)'}`);
  const shotPixel = await sysShot('pixel-light-paper');
  const a3 = analyzeShot(shotPixel, geom);
  check('P3 pixel 档窗区实心（亮度 >200 且彩度显著低于玻璃组）', a3.avgLum > 200 && a3.avgSat < a2.avgSat, `lum=${a3.avgLum.toFixed(0)} sat=${a3.avgSat.toFixed(1)} vs glass sat=${a2.avgSat.toFixed(1)}`);

  STEP = 'P4';
  await setLookPalette(h.page, 'glass', 'paper');
  st = await osglassState(h.page);
  const a4 = analyzeShot(await sysShot('glass-back'), await windowGeom(h.page));
  check('P4 切回 glass → 通透恢复（无重启）', st.attr === '1' && a4.avgSat > 20, `attr=${String(st.attr)} sat=${a4.avgSat.toFixed(1)}`);

  STEP = 'P5';
  await setLookPalette(h.page, 'glass', 'contrast');
  await h.page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await wait(1200);
  const a5 = analyzeShot(await sysShot('glass-dark-contrast'), await windowGeom(h.page));
  check('P5 dark+contrast 下仍透出壁纸（sat>20=透的是壁纸不是黑底）且亮度低于 paper 组', a5.avgSat > 20 && a5.avgLum < a2.avgLum, `sat=${a5.avgSat.toFixed(1)} lum=${a5.avgLum.toFixed(0)} vs paper lum=${a2.avgLum.toFixed(0)}`);

  STEP = 'P6';
  check('P6 真实档案根 mtime 不变', rootMtime() === realBefore, `before=${String(realBefore)} after=${String(rootMtime())}`);

  await h.browser.close(); h.child.kill();
  for (const pid of listeningPids(PORT)) killTree(pid);

  const fails = assertions.filter((a) => !a.ok);
  line(`\n===== T90-01 真通透探针：${assertions.length - fails.length} PASS / ${fails.length} FAIL（靶=win-unpacked，截图 ${SHOT_DIR}）=====`);
  if (fails.length > 0) { process.exitCode = 1; }
  line(`耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch(async (err) => {
  console.error('FATAL', err);
  try { if (CHILD) { CHILD.kill(); } } catch { /* */ }
  for (const pid of listeningPids(PORT)) killTree(pid);
  process.exitCode = 2;
});
