/* T66 T3 红定性：直接打 db.create / quick-database 点击链，抓真错与状态 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t66-dbg';
const UD = `${RUN}\\ud`; const ROOT = `${RUN}\\data`; const PORT = 9578;
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
  await page.waitForSelector('.app-side', { timeout: 30000 }); await wait(2400);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2800); }
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
  const ipc = (ch, p) => page.evaluate(async ([c, q]) => {
    const api = window.septcats; const fn = c.split('.').reduce((o, k) => o?.[k], api);
    if (typeof fn !== 'function') return { ok: false, err: `NO_CHANNEL:${c}` };
    try { return { ok: true, data: await fn.call(api, q) }; } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 200) }; }
  }, [ch, p]);
  const wl = await ipc('workspaces.list', {});
  console.log('workspaces.list →', JSON.stringify(wl).slice(0, 200));
  const wsId = wl.data?.activeId ?? null;
  console.log('activeId =', String(wsId));
  const dbDirect = await ipc('db.create', { workspaceId: wsId, title: 'DBG 多维' });
  console.log('db.create(直调) →', JSON.stringify(dbDirect).slice(0, 300));
  const dbList = await ipc('db.list', { workspaceId: wsId }).catch(() => null);
  console.log('db.list →', JSON.stringify(dbList).slice(0, 240));
  // 开 home → 点 quick 卡「新建库」→ 看 home/编辑器状态与 console 报错
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await page.keyboard.press('Alt+h'); await wait(900);
  console.log('home open =', String((await page.locator('[data-testid="workbench"]').count()) > 0));
  const rowsBefore = await page.locator('[data-testid^="wb-db-row-"]').count();
  const clicked = await page.evaluate(() => { const b = document.querySelector('[data-testid="wb-quick-database"]'); if (b === null) return false; b.click(); return true; });
  await wait(2600);
  const homeAfter = await page.locator('[data-testid="workbench"]').count();
  const dbpage = await page.evaluate(() => document.querySelector('.dbpage') !== null);
  const toast = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="toast"], .sc-toast')].map((e) => (e.textContent ?? '').trim()).join('|'));
  console.log(`click=${String(clicked)} rowsBefore=${String(rowsBefore)} homeAfter=${String(homeAfter)} dbpage=${String(dbpage)} toast="${toast}"`);
  console.log('console errors:', JSON.stringify(errs.slice(0, 5)));
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  void child;
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });