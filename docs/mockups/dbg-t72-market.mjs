/* T72 红定性：市场内 应用/另存为/导入 三条链逐步执行 + console/pageerror 全捕获 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t72-dbg';
const UD = `${RUN}\\ud`; const ROOT = `${RUN}\\data`; const PORT = 9581;
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
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errs.push(`[pageerror] ${String(e).slice(0, 200)}`));
  await page.waitForSelector('.app-side', { timeout: 30000 }); await wait(2600);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2800); }
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
  const click = async (tid) => page.evaluate((s) => { const el = document.querySelector(`[data-testid="${s}"]`); if (el === null) return false; el.click(); return true; }, tid);
  const has = async (tid) => (await page.locator(`[data-testid="${tid}"]`).count()) > 0;

  // 直达 IPC：workbenchTemplates.list / templates.list(workbench)
  console.log('wt.list →', await page.evaluate(async () => { try { return JSON.stringify(await window.septcats.workbenchTemplates.list()).slice(0, 200); } catch (e) { return `ERR ${String(e).slice(0, 140)}`; } }));
  // 开市场
  await click('workbench-market-open'); await wait(1200);
  console.log('market open =', await has('wb-market'), 'tpl cards =', await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-market-template-"]').length));
  // A) 应用链
  await click('wb-market-template-apply-work-journal'); await wait(800);
  const dialogBtns = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.closest('[class*="dialog"], [role="dialog"]') !== null).map((b) => ({ txt: (b.textContent ?? '').trim(), cls: b.className.slice(0, 30) })));
  console.log('apply dialog buttons:', JSON.stringify(dialogBtns));
  const applied = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === '应用并备份');
    if (b === undefined) return 'NO_BTN';
    b.click();
    return 'clicked';
  });
  await wait(2200);
  console.log('apply confirm:', applied, '| backup LS =', await page.evaluate(() => (localStorage.getItem('septcats.wbcard.layoutBackup') ?? '').slice(0, 40) || 'null'), '| cards LS =', await page.evaluate(() => (localStorage.getItem('septcats.workbench.cards') ?? '').slice(0, 60) || 'null'));
  await page.screenshot({ path: join(SHOTS_DIR, 'a-after-apply.png') }).catch(() => {});
  // B) 导入链
  await click('wb-market-import'); await wait(800);
  const ta = page.locator('[data-testid="wb-market-import-text"]');
  await ta.waitFor({ state: 'visible', timeout: 6000 }).catch(() => console.log('import textarea NOT visible'));
  if (await ta.count() > 0) {
    await ta.fill(JSON.stringify({ id: 't72-imported', title: 'T72 导入模板', desc: 'd', layout: { v: 2, order: ['quick', 'todo', 'database', 'recent', 'favorites', 'quote'], hidden: [] }, seedPages: [] }));
    const cRes = await page.evaluate(() => { const b = document.querySelector('[data-testid="wb-market-import-confirm"]'); if (b === null) return 'NO_BTN'; b.click(); return 'clicked'; });
    await wait(2000);
    console.log('import confirm:', cRes, '| tpl cards now =', await page.evaluate(() => [...document.querySelectorAll('[data-testid^="wb-market-template-"]')].map((e) => e.getAttribute('data-testid')).join(',').slice(0, 200)));
    console.log('toast:', await page.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map((e) => (e.textContent ?? '').trim()).join('|').slice(0, 120)));
  }
  // C) templates 存储面
  console.log('templates.list(workbench) →', await page.evaluate(async () => { try { return JSON.stringify(await window.septcats.templates.list({ kind: 'workbench' })).slice(0, 200); } catch (e) { return `ERR ${String(e).slice(0, 140)}`; } }));
  console.log('ERRORS:', JSON.stringify(errs.slice(0, 10), null, 1));
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  void child;
  process.exit(0);
}
const SHOTS_DIR = RUN;
main().catch((e) => { console.error('FATAL', e); process.exit(3); });