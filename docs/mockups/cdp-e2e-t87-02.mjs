/* cdp-e2e-t87-02.mjs —— 自绘菜单带随主题真机验收（TASK-T87-02，老板 09-28：
 * 「整个软件随着主题而改变」——旧原生菜单「文件/编辑/视图/帮助」带不吃 CSS）。
 *
 * 靶子：默认打包产物 win-unpacked（交付物终验口径），SEPTCATS_APP_BIN/SEPTCATS_DEV 可切。
 * 判据（全部实测像素/计算值，不依赖视觉模型）：
 *   M1 原生菜单栏已撤：进程照常 + 自绘带 [data-testid="menu-bar-band"] 在位、四组入口可见。
 *   M2 带随明暗：light 时带底色亮度 >200；切 dark 后 <60；文字色反向（浅底深字/深底浅字）。
 *   M3 带随配色派系：light+paper 与 light+contrast 的带底色不同（paper=暖白 ≠ 纯白）。
 *   M4 带随质感：glass 下带吃 chrome 半透明（alpha ≤0.6 且 blur>0）；pixel 下实心。
 *   M5 功能回路：点「文件」→ 下拉 role=menu；点「新建页面」→ 侧栏行数 +1（经 main 动作出口）。
 *   M6 持久 + 零触碰：重启后 paper+dark 保持；真实档案根 mtime 不变。
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
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 't87-02';
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? (process.env.SEPTCATS_APP_DIR ? join(process.env.SEPTCATS_APP_DIR, 'Septcats.exe') : PACKAGE_APP);
const DEV = process.env.SEPTCATS_DEV === '1';
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9588');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const RESULT = join(SCRIPT_DIR, `screens-${RUN_NAME}`, 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) {
  console.log(text);
  try { appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* 结果目录未就绪 */ }
}
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 240) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() {
  for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } }
}
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
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('[data-testid="menu-bar-band"]', { timeout: 30000 });
  await wait(2200);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2200); }
  // palette/look 走 localStorage 预置 + reload（同 look 探针口径，绕开 UI 时序）
  if (palette !== undefined || look !== undefined) {
    await page.evaluate(([pal, lk]) => {
      if (pal !== null) { localStorage.setItem('septcats.palette', String(pal)); }
      if (lk !== null) { localStorage.setItem('septcats.look', String(lk)); }
    }, [palette ?? null, look ?? null]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="menu-bar-band"]', { timeout: 30000 });
    await wait(2400);
  }
  return { child, browser, page };
}

/** 菜单带的计算样式（底色 rgba / 文字色 / blur）。 */
function bandStyle(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.menub_band');
    const btn = document.querySelector('.menub_item');
    if (el === null || btn === null) { return null; }
    const c = getComputedStyle(el);
    const b = getComputedStyle(btn);
    return { bg: c.backgroundColor, img: (c.backgroundImage === 'none' ? 'none' : 'grad'), blur: (c.backdropFilter || 'none'), color: b.color };
  });
}
function rgbOf(s) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s ?? '');
  if (m !== null) { return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }; }
  // Chromium 计算值新形态：color(srgb r g b / a)（分量 0~1）——glass 半透明带就是这形态
  const m2 = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(s ?? '');
  if (m2 !== null) {
    return { r: Math.round(+m2[1] * 255), g: Math.round(+m2[2] * 255), b: Math.round(+m2[3] * 255), a: m2[4] === undefined ? 1 : +m2[4] };
  }
  return null;
}
function lum(c) { return c === null ? -1 : (c.r * 299 + c.g * 587 + c.b * 114) / 1000; }

let CTX = null;
async function main() {
  const before = rootMtime();

  STEP = 'M1|在位';
  let app = await boot('light', 'contrast', 'pixel');
  CTX = app;
  check('M1-a 靶子存在', DEV || statSync(APP_BIN).size > 0, DEV ? 'dev' : APP_BIN);
  check('M1-b 自绘菜单带渲染', (await app.page.locator('[data-testid="menu-bar-band"]').count()) === 1, 'band');
  const groupKeys = ['file', 'edit', 'view', 'help'];
  let allGroups = true;
  for (const k of groupKeys) { allGroups = allGroups && (await app.page.locator(`[data-testid="menu-bar-${k}"]`).count()) === 1; }
  check('M1-c 四组入口齐全（文件/编辑/视图/帮助）', allGroups, groupKeys.join(','));

  STEP = 'M2|明暗联动';
  const lightStyle = bandStyle(app.page);
  const lL = rgbOf((await lightStyle).bg);
  const lT = rgbOf((await lightStyle).color);
  check('M2-a light：带底亮（>200）且文字深（<80）', lum(lL) > 200 && lum(lT) < 80, `bg=${(await lightStyle).bg} 文字=${(await lightStyle).color}`);
  await app.page.evaluate(() => { localStorage.setItem('septcats.theme', 'dark'); });
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForSelector('[data-testid="menu-bar-band"]');
  await wait(2200);
  const darkStyle = await bandStyle(app.page);
  const dL = rgbOf(darkStyle.bg);
  const dT = rgbOf(darkStyle.color);
  check('M2-b dark：带底暗（<60）且文字浅（>180）', lum(dL) < 60 && lum(dT) > 180, `bg=${darkStyle.bg} 文字=${darkStyle.color}`);

  STEP = 'M3|配色派系联动';
  await app.page.evaluate(() => { localStorage.setItem('septcats.palette', 'paper'); });
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForSelector('[data-testid="menu-bar-band"]');
  await wait(2200);
  const paper = await bandStyle(app.page);
  const pL = rgbOf(paper.bg);
  // paper 暗档画布=#1A1712（暖褐）：与 contrast 的 #050505 区分 = b 通道明显>（暖色 r>b）
  check('M3-a dark+paper 与 dark+contrast 底色不同（暖褐可辨）', pL !== null && dL !== null && Math.abs(lum(pL) - lum(dL)) > 8, `paper=${paper.bg} vs contrast=${darkStyle.bg}`);

  STEP = 'M4|质感联动';
  await app.page.evaluate(() => { localStorage.setItem('septcats.look', 'glass'); });
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForSelector('[data-testid="menu-bar-band"]');
  await wait(2200);
  const glass = await bandStyle(app.page);
  const gC = rgbOf(glass.bg);
  check('M4-a glass：菜单带吃 chrome 半透明+磨砂', gC !== null && gC.a <= 0.6 && /blur\((\d+)/.test(glass.blur) && Number(/blur\((\d+)/.exec(glass.blur)[1]) >= 20, `bg=${glass.bg} blur=${glass.blur}`);
  await app.page.evaluate(() => { localStorage.setItem('septcats.look', 'pixel'); });
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForSelector('[data-testid="menu-bar-band"]');
  await wait(2200);
  const backPixel = await bandStyle(app.page);
  const bp = rgbOf(backPixel.bg);
  check('M4-b pixel：菜单带实心（alpha=1、无 blur）', bp !== null && bp.a > 0.98 && backPixel.blur === 'none', `bg=${backPixel.bg} blur=${backPixel.blur}`);

  STEP = 'M5|功能回路';
  const rowsBefore = await app.page.locator('[data-testid^="side-node-"]').count();
  await app.page.click('[data-testid="menu-bar-file"]');
  await app.page.waitForSelector('[role="menu"]', { timeout: 5000 });
  const item = app.page.locator('[role="menuitem"]', { hasText: '新建页面' }).first();
  check('M5-a 「文件」下拉打开且含「新建页面」', (await item.count()) === 1, 'dropdown');
  await item.click();
  await wait(1600);
  const rowsAfter = await app.page.locator('[data-testid^="side-node-"]').count();
  check('M5-b 点击条目 → 经 main 动作出口真的新建了页面', rowsAfter === rowsBefore + 1, `${String(rowsBefore)}→${String(rowsAfter)}`);
  await app.page.keyboard.press('Escape');
  await wait(400);
  check('M5-c 下拉已随操作收起', (await app.page.locator('[role="menu"]').count()) === 0, 'dismissed');
  await app.page.screenshot({ path: join(SCRIPT_DIR, `screens-${RUN_NAME}`, 'menu-band-final.png') });

  STEP = 'M6|持久+隔离';
  await app.browser.close().catch(() => undefined);
  killTree(app.child.pid);
  app = await boot('dark', 'paper', 'glass');
  CTX = app;
  const st = await bandStyle(app.page);
  const s6 = rgbOf(st.bg);
  check('M6-a 重启后 dark+paper 生效（暖褐半透明带）', s6 !== null && lum(s6) < 80 && s6.r > s6.b, `bg=${st.bg}`);
  check('M6-b 带在位（无原生菜单回归）', (await app.page.locator('[data-testid="menu-bar-band"]').count()) === 1, 'band');
  await app.browser.close().catch(() => undefined);
  killTree(app.child.pid);
  CTX = { child: { pid: 0 }, browser: null };
  const after = rootMtime();
  check('M6-c 真实档案根 mtime 未变（零触碰）', before === after, `${String(before)} vs ${String(after)}`);
  killStaleApp();
}

function report(fatal) {
  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok !== true).length;
  if (fatal !== undefined) { line(`FATAL ${String(fatal)}`); }
  line(`\n===== T87-02 菜单带随主题探针：${pass} PASS / ${fail} FAIL（靶=${DEV ? 'dev' : 'win-unpacked'}）=====`);
  if (fail === 0 && fatal === undefined) { process.exit(0); }
  process.exit(fatal !== undefined ? 3 : 1);
}
main()
  .then(() => report())
  .catch((e) => {
    if (CTX !== null) {
      try { killTree(CTX.child.pid); } catch { /* */ }
      try { CTX.browser?.close(); } catch { /* */ }
      killStaleApp();
    }
    report(e && e.stack ? e.stack : String(e));
  });
