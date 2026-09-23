/* 调试：头行点击后 ws 菜单状态现场 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t70dbg';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9575;
const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
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
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 30000 });
  await wait(2500);
  const snap = async (tag) => page.evaluate((t) => ({
    tag: t,
    heads: document.querySelectorAll('[data-testid="side-ws-head"]').length,
    expanded: document.querySelector('[data-testid="side-ws-head"]')?.getAttribute('aria-expanded'),
    menu: document.querySelectorAll('[role="menu"]').length,
    items: [...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim()),
  }), tag);
  console.log(JSON.stringify(await snap('before')));
  await page.locator('[data-testid="side-ws-head"]').click({ force: true });
  await wait(600);
  console.log(JSON.stringify(await snap('after-click')));
  await page.locator('[data-testid="side-ws-head"]').click({ force: true });
  await wait(600);
  console.log(JSON.stringify(await snap('after-2nd-click')));
  await browser.close().catch(() => {});
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ } process.exit(3); });
