/* M4 确认链 v2：状态经返回值打印（页内 console.log 不回 stdout） */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t72-dbg2';
const UD = `${RUN}\\ud`; const ROOT = `${RUN}\\data`; const PORT = 9582;
const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2), 'utf8');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null; const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 220)); });
  page.on('pageerror', (e) => errs.push(`pageerror ${String(e).slice(0, 220)}`));
  await page.waitForSelector('.app-side', { timeout: 30000 }); await wait(2600);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2800); }
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
  const click = async (tid) => page.evaluate((s) => { const el = document.querySelector(`[data-testid="${s}"]`); if (el === null) return false; el.click(); return true; }, tid);
  const st = async (tag) => { const x = await page.evaluate(() => ({
    cardsLS: (localStorage.getItem('septcats.workbench.cards') ?? 'null').slice(0, 60),
    backupLS: (localStorage.getItem('septcats.wbcard.layoutBackup') ?? 'null').slice(0, 60),
    toast: [...document.querySelectorAll('[class*="toast"]')].map((e) => (e.textContent ?? '').trim()).join('|').slice(0, 80),
    dialog: document.querySelector('[data-testid="wb-apply-confirm"]') !== null,
    btns: [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter((t) => t.includes('应用')),
  })); console.log(tag, JSON.stringify(x)); };
  await st('boot');
  await click('workbench-market-open'); await wait(1200);
  await click('wb-market-template-apply-work-journal'); await wait(900);
  await st('apply-open');
  const res = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === '应用并备份');
    if (b === undefined) return 'NO_BTN';
    b.click();
    return 'clicked';
  });
  await wait(2500);
  console.log('confirm =', res);
  await st('after-confirm');
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 8)));
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  void child;
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });