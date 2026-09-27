/* cdp-e2e-t87-01.mjs —— 原生窗口条随主题（TASK-T87-01，老板 09-28 截图圈定）。
 *
 * 验证：设置→外观「主题（明暗）」会**联动原生层**——OS 标题栏 + 原生菜单栏 +
 * 窗口预绘底色（nativeTheme.themeSource + setBackgroundColor），而非只换网页内容。
 * 靶子：默认打包产物 win-unpacked，SEPTCATS_DEV/SEPTCATS_APP_BIN 可切。
 *
 * ⚠ 取证通道设计（本探针实证过的坑，勿改回）：renderer 的
 * `matchMedia('(prefers-color-scheme: dark)')` 经 **CDP 读会翻回系统真值**
 * （无 CDP 时 true、attach 后 false——2026-09-28 nocdp-launch 对照实验实锤）。
 * 所以 Chromium 明暗一律读 **main.log 的 `chromeTheme probe/windowState` 行**
 * （main→renderer executeJavaScript，生产常驻自证，见 main/index.ts applyChromeTheme）。
 *
 * 判据：
 *   T1 启动 dark：log `chromeTheme applied: mode=dark → dark`；probe/windowState mm=true。
 *   T2 切浅色（设置页 radio 真实通路）：log 追加 `mode=light → light` + probe mm=false；
 *       settings.json 落盘回读 theme=light。
 *   T3 system：log `mode=system → light|dark` 二选一。
 *   T4 重启持久：全新启动再现 applied dark + windowState mm=true。
 *   T5 data-theme 同步 + 真实档案根 mtime 零触碰。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const PACKAGE_APP = join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const DEV_ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 't87';
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? (process.env.SEPTCATS_APP_DIR ? join(process.env.SEPTCATS_APP_DIR, 'Septcats.exe') : PACKAGE_APP);
const DEV = process.env.SEPTCATS_DEV === '1';
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9587');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 260) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() {
  for (const name of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' }); } catch { /* */ } }
}
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}
function logLines(tag) {
  // 注意：logger 落 **数据根**/logs（layout.logs），不是 user-data-dir 下
  const f = join(ROOT, 'logs', 'main.log');
  if (!existsSync(f)) {
    return [];
  }
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.includes(tag));
}
/** 轮询 main.log 直到命中（300ms 步进；超时返回空/旧结果）。 */
async function waitLog(tag, pred, ms = 10000) {
  const dl = Date.now() + ms;
  for (;;) {
    const hit = logLines(tag).filter(pred);
    if (hit.length > 0 || Date.now() > dl) {
      return hit;
    }
    await wait(300);
  }
}

async function boot(theme) {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme, locale: 'zh-CN',
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
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2200);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2200); }
  return { child, browser, page };
}

let CTX = null;
async function main() {
  const before = rootMtime();

  // ===== T1 启动 dark：main 解析 + Chromium 实证 =====
  STEP = 'T1|启动dark';
  let app = await boot('dark');
  CTX = app;
  check('T1-a 靶子存在', DEV || statSync(APP_BIN).size > 0, DEV ? 'dev 模式' : APP_BIN);
  const applied = await waitLog('chromeTheme applied', (l) => /mode=dark → dark/.test(l));
  check('T1-b log: applied mode=dark → dark', applied.length >= 1, applied.slice(-1)[0]?.slice(-80) ?? '(超时)');
  const wstate = await waitLog('chromeTheme windowState', (l) => /\(dark\)/.test(l) && /"mm":true/.test(l), 15000);
  check('T1-c windowState 自证 mm=true（Chromium 报暗=OS 条底色）', wstate.length >= 1, wstate.slice(-1)[0]?.slice(-70) ?? '(超时)');
  check('T1-d data-theme=dark（renderer 联动）', (await app.page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'DOM');

  // ===== T2 运行时切浅色（设置页真实通路）=====
  STEP = 'T2|切浅色';
  await app.page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));
  await app.page.waitForSelector('input[name="settings-theme"][value="light"]', { timeout: 15000 });
  await app.page.click('input[name="settings-theme"][value="light"]');
  const lightApplied = await waitLog('chromeTheme applied', (l) => /mode=light → light/.test(l));
  check('T2-a patch 后 log 追加 applied light', lightApplied.length >= 1, lightApplied.slice(-1)[0]?.slice(-80) ?? '(超时)');
  const lightProbe = await waitLog('chromeTheme probe', (l) => /\(light→light\)/.test(l) && /"mm":false/.test(l), 10000);
  check('T2-b apply 自证翻为 mm=false（OS 条回到亮色）', lightProbe.length >= 1, lightProbe.slice(-1)[0]?.slice(-70) ?? '(超时)');
  check('T2-c settings.json 落盘 theme=light', JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8')).theme === 'light', '磁盘回读');

  // ===== T3 system 态 =====
  STEP = 'T3|system态';
  await app.page.click('input[name="settings-theme"][value="system"]');
  const sysApplied = await waitLog('chromeTheme applied', (l) => /mode=system → (light|dark)/.test(l));
  check('T3-a system 解析为 light|dark 二选一', sysApplied.length >= 1, sysApplied.slice(-1)[0]?.slice(-80) ?? '(超时)');

  // ===== T4 重启持久 =====
  STEP = 'T4|重启dark';
  await app.browser.close().catch(() => undefined);
  killTree(app.child.pid);
  app = await boot('dark');
  CTX = app;
  const again = await waitLog('chromeTheme applied', (l) => /mode=dark/.test(l));
  check('T4-a 全新启动再现 applied dark', (again.slice(-1)[0] ?? '').includes('mode=dark'), again.slice(-1)[0]?.slice(-80) ?? '(超时)');
  const againState = await waitLog('chromeTheme windowState', (l) => /\(dark\)/.test(l) && /"mm":true/.test(l), 15000);
  check('T4-b 重启 windowState mm=true', againState.length >= 1, againState.slice(-1)[0]?.slice(-70) ?? '(超时)');

  // ===== T5 隔离钉 =====
  STEP = 'T5|隔离钉';
  await app.browser.close().catch(() => undefined);
  killTree(app.child.pid);
  CTX = { child: { pid: 0 }, browser: null };
  const after = rootMtime();
  check('T5-a 真实档案根 mtime 未变（零触碰）', before === after, `${String(before)} vs ${String(after)}`);
  killStaleApp();
}

function report(fatal) {
  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok !== true).length;
  if (fatal !== undefined) console.log('FATAL', fatal);
  console.log(`\n===== T87-01 原生条随主题探针：${pass} PASS / ${fail} FAIL（靶=${DEV ? 'dev' : 'win-unpacked'}）=====`);
  if (fail === 0 && fatal === undefined) process.exit(0);
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
