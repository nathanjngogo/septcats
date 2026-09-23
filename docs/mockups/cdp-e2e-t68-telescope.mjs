/*
 * cdp-e2e-t68-telescope.mjs —— 编辑区标题上方像素望远镜（老板 09-23）PM 真机取证。
 * P1 图标=SVG crispEdges 像素网格（无 emoji 文本）；P2 格子构图非空；P3 色随主题
 * （light 深墨/dark 亮墨）；P4 截图双主题目检；P5 隔离夹具+真根 untouched+电子计数=0。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t68';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t68');
const PORT = 9573;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
function check(name, ok, raw) {
  assertions.push({ name, ok: ok === true, raw: String(raw).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 160)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function electronCount() {
  try { return execSync('tasklist /FI "IMAGENAME eq electron.exe" /CSV | find /c "electron.exe"', { encoding: 'utf8' }).trim(); } catch { return '?'; }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2500);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });
  await page.locator('[data-testid="side-new-page"]').first().click();
  await wait(1200);
  await page.keyboard.press('Escape').catch(() => {}); // 退出行内重命名
  await wait(600);

  const shot = async (name) => page.screenshot({ path: join(SHOTS, name), clip: await page.locator('.pv-title-row').boundingBox().catch(() => ({ x: 0, y: 0, width: 800, height: 120 })) ?? { x: 0, y: 0, width: 800, height: 120 } });

  // P1 像素 SVG + 无 emoji
  const p1 = await page.evaluate(() => {
    const host = document.querySelector('.pv-page-icon');
    const svg = host?.querySelector('svg');
    return {
      host: host !== null, emoji: (host?.textContent ?? '').includes('🔭'),
      svg: svg !== null, crisp: svg?.getAttribute('shape-rendering') ?? svg?.style?.shapeRendering ?? null,
      rects: svg ? svg.querySelectorAll('rect').length : 0,
      box: svg ? { w: svg.getBoundingClientRect().width, h: svg.getBoundingClientRect().height } : null,
    };
  });
  check('P1 图标=像素 SVG（crispEdges·rect 网格）且 emoji 清除', p1.host && p1.svg && p1.crisp === 'crispEdges' && !p1.emoji && p1.rects > 20, JSON.stringify(p1));
  check('P2 尺寸=32 方图（标题上方大图标口径）', p1.box !== null && Math.abs(p1.box.w - 32) < 1 && Math.abs(p1.box.h - 32) < 1, JSON.stringify(p1.box));

  await shot('t68-light.png');

  // P3 双主题色随墨色（T59 同款 localStorage+reload 法，data-theme 为证）
  const colorLight = await page.evaluate(() => getComputedStyle(document.querySelector('.pv-page-icon')).color);
  await page.evaluate(() => window.localStorage.setItem('septcats.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForSelector('.pv-page-icon', { timeout: 20000 });
  await wait(1500);
  const p3 = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    color: getComputedStyle(document.querySelector('.pv-page-icon')).color,
  }));
  check('P3 图标色随主题（light→dark data-theme + 亮墨 rgb(237,..)）', p3.theme === 'dark' && p3.color !== colorLight && p3.color.includes('237'), `${colorLight} → ${p3.color} theme=${String(p3.theme)}`);
  await shot('t68-dark.png');

  check('P5 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
  await browser.close().catch(() => {});
  killTree(child.pid);
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; })
  .finally(() => {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't68-results.json'), JSON.stringify({ assertions }, null, 2));
    console.log(`\n===== T68 望远镜：${pass} PASS / ${fail} FAIL =====`);
    setTimeout(() => {
      const n = electronCount();
      console.log('electron 最终计数=', n);
      process.exit(fail === 0 && n === '0' ? 0 : 1);
    }, 1500);
  });
