/* T66 T5 红定性：待办 新增→勾选→删除 直测（页内原生 click + id 全量 dump） */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t66-todo';
const UD = `${RUN}\\ud`; const ROOT = `${RUN}\\data`; const PORT = 9579;
const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2), 'utf8');
  spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null; const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 }); await wait(2400);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2800); }
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
  await page.keyboard.press('Alt+h'); await wait(1200);
  const dump = () => page.evaluate(() => ({
    toggles: [...document.querySelectorAll('[data-testid^="wb-todo-toggle-"]')].map((e) => e.getAttribute('data-testid').replace('wb-todo-toggle-', '')),
    texts: [...document.querySelectorAll('.wb-todo__text')].map((e) => (e.textContent ?? '').trim()),
    dels: [...document.querySelectorAll('[data-testid^="wb-todo-del-"]')].map((e) => e.getAttribute('data-testid').replace('wb-todo-del-', '')),
    ls: Object.keys(localStorage).filter((k) => k.includes('workbench')),
    lsRaw: localStorage.getItem('septcats.workbench.todos')?.slice(0, 200) ?? null,
  }));
  console.log('初态:', JSON.stringify(await dump()));
  await page.locator('[data-testid="wb-todo-input"]').first().fill('DBG 待办A');
  await page.locator('[data-testid="wb-todo-input"]').first().press('Enter');
  await wait(900);
  console.log('新增后:', JSON.stringify(await dump()));
  const first = await page.evaluate(() => document.querySelector('[data-testid^="wb-todo-toggle-"]')?.getAttribute('data-testid')?.replace('wb-todo-toggle-', '') ?? null);
  console.log('firstTodo =', String(first));
  const toggleRes = await page.evaluate((id) => {
    const b = document.querySelector(`[data-testid="wb-todo-toggle-${id}"]`);
    if (b === null) return 'GONE';
    b.click();
    return 'clicked';
  }, first);
  await wait(700);
  console.log('勾选后:', toggleRes, JSON.stringify(await dump()));
  const delRes = await page.evaluate((id) => {
    const b = document.querySelector(`[data-testid="wb-todo-del-${id}"]`);
    if (b === null) return 'GONE';
    const r = b.getBoundingClientRect();
    b.click();
    return `clicked box=${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}`;
  }, first);
  await wait(900);
  console.log('删除后:', delRes, JSON.stringify(await dump()));
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });