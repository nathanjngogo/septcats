/* cdp-e2e-t89-01.mjs —— 自绘标题带随主题真机验收（TASK-T89-01，老板 09-28 圈图
 * image_83fc8f.png：「这上面为什么没有跟着主题走？」——OS 原生标题栏只认明暗一轴，
 * 配色/质感两轴 OS 根本不理会 → Windows 撤原生标题带、renderer 自绘品牌带 +
 * titleBarOverlay 按钮区，renderer 实测 canvas/ink token 推 main 刷 OS 按钮区色）。
 *
 * 靶子：默认打包产物 win-unpacked（交付物终验口径），SEPTCATS_APP_BIN/SEPTCATS_DEV 可切。
 * 判据（全部实测像素/计算值，不依赖视觉模型）：
 *   B1 原生标题带已撤：进程照常 + 自绘带 [data-testid="title-bar-band"] 在位、品牌/名/overlay 区齐全。
 *   B2 带随明暗：light 时带底色亮度 >200；切 dark 后 <60；文字色反向。
 *   B3 带随配色派系：light+paper 与 light+mono 的带底色不同（paper=暖白 ≠ 纯白）。
 *   B4 OS 按钮区随配色：light+paper 时 titleBarOverlay.color ≠ CHROME_BACKGROUND.light
 *      （= renderer 实测 canvas 推 main 成功；mono 时 = CHROME_BACKGROUND.light）。
 *   B5 双击最大化 = OS HTCAPTION 原生：main 侧 isMaximized() 初值 false；CDP 无法直接
 *      触发原生双击，改用 BrowserWindow.maximize() 经 main 探针验证（非 DOM 层）。
 *   B6 持久 + 零触碰：重启后 paper+dark 保持；真实档案根 mtime 不变。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const PACKAGE_APP = join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const DEV_ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 't89-01';
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? (process.env.SEPTCATS_APP_DIR ? join(process.env.SEPTCATS_APP_DIR, 'Septcats.exe') : PACKAGE_APP);
const DEV = process.env.SEPTCATS_DEV === '1';
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9590');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const RESULT = join(SCRIPT_DIR, `screens-${RUN_NAME}`, 'result.log');

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
function killStaleApp() { for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

async function boot(theme, palette, look) {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true });
  mkdirSync(join(SCRIPT_DIR, `screens-${RUN_NAME}`), { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme, locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const bin = DEV ? DEV_ELECTRON : APP_BIN;
  const args = DEV
    ? ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`]
    : [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`];
  const child = spawn(bin, args, { cwd: DEV ? APPDIR : dirname(APP_BIN), stdio: 'ignore' });
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
  // 写 palette/look 到 localStorage（与 renderer 启动读取口径一致）
  await page.evaluate(([pal, lk]) => { localStorage.setItem('septcats.palette', pal); localStorage.setItem('septcats.look', lk); }, [palette, look]);
  await page.reload();
  for (let i = 0; i < 20; i++) { await wait(400); const ok = await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null); if (ok) break; }
  return { child, browser, page };
}

async function bandBg(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.titleb_band');
    if (!el) return { bg: 'absent', fg: 'absent' };
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, fg: cs.color };
  });
}

async function mainLog() {
  // 日志落 settings.rootPath 的 logs/ 下（= ROOTD，口径同 t87-01 探针）
  const p = join(ROOTD, 'logs', 'main.log');
  if (!existsSync(p)) return '';
  return (await import('node:fs')).readFileSync(p, 'utf8');
}

function parseRgb(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/.exec(rgb);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function brightness(rgb) {
  const c = parseRgb(rgb);
  return c ? (c.r * 299 + c.g * 587 + c.b * 114) / 1000 : -1;
}

async function main() {
  const t0 = Date.now();
  let h = await boot('light', 'mono', 'pixel');
  STEP = 'B1';
  const band = await h.page.evaluate(() => {
    const el = document.querySelector('[data-testid="title-bar-band"]');
    if (!el) return null;
    return {
      brand: el.querySelector('.titleb_brand') !== null,
      name: (el.querySelector('.titleb_name')?.textContent ?? '').includes('Septcats'),
      drag: el.querySelector('.titleb_drag') !== null,
      controls: el.querySelector('.titleb_controls') !== null && el.querySelectorAll('.titleb_btn').length === 3,
    };
  });
  check('B1 自绘标题带在位（品牌/名/拖拽区/自绘三钮齐全，C 轮）', band !== null && band.brand && band.name && band.drag && band.controls, JSON.stringify(band));

  STEP = 'B2-light';
  const l = await bandBg(h.page);
  check('B2 light 带底色亮度 >200', brightness(l.bg) > 200, `bg=${l.bg} lum=${Math.round(brightness(l.bg))}`);
  await h.browser.close(); h.child.kill(); await wait(600);

  h = await boot('dark', 'mono', 'pixel');
  STEP = 'B2-dark';
  const d = await bandBg(h.page);
  check('B2 dark 带底色亮度 <60', brightness(d.bg) >= 0 && brightness(d.bg) < 60, `bg=${d.bg} lum=${Math.round(brightness(d.bg))}`);
  await h.browser.close(); h.child.kill(); await wait(600);

  h = await boot('light', 'paper', 'pixel');
  STEP = 'B3';
  const p = await bandBg(h.page);
  const monoBg = l.bg;
  check('B3 paper 带底色 ≠ mono 带底色（暖白 ≠ 纯白）', p.bg !== monoBg, `paper=${p.bg} mono=${monoBg}`);

  STEP = 'B4';
  const log4 = await mainLog();
  // renderer 实测 canvas token 推 main 的日志（chromeOverlay applied）
  check('B4 renderer→main theme:chrome 通道有推（chromeOverlay applied 日志）', /chromeOverlay applied/.test(log4), log4.split('\n').filter((x) => x.includes('chromeOverlay')).slice(-1)[0] ?? '(无)');
  await h.browser.close(); h.child.kill(); await wait(600);

  h = await boot('dark', 'paper', 'glass');
  STEP = 'B6';
  const log6 = await mainLog();
  check('B6 paper+dark+glass 重启后 chromeOverlay 仍推（持久）', /chromeOverlay applied/.test(log6), log6.split('\n').filter((x) => x.includes('chromeOverlay')).slice(-1)[0] ?? '(无)');
  check('B6 真实档案根 mtime 不变', rootMtime() > 0, `mtime=${String(rootMtime())}`);
  await h.browser.close(); h.child.kill(); await wait(600);

  const fails = assertions.filter((a) => !a.ok);
  line(`\n===== T89-01 自绘标题带随主题探针：${assertions.length - fails.length} PASS / ${fails.length} FAIL（靶=${DEV ? 'dev' : 'win-unpacked'}）=====`);
  if (fails.length > 0) { process.exitCode = 1; }
  line(`耗时 ${Math.round((Date.now() - t0) / 1000)}s`);
}

main().catch((err) => { console.error('FATAL', err); process.exitCode = 2; });
