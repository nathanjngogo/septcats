/* T71 侦察：建工作台库 → dump 工作台区内 testid/输入/按钮文案/卡序，供 PM 写正式探针 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t71-recon';
const UD = `${RUN}\\ud`; const ROOT = `${RUN}\\data`; const PORT = 9576;
const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2), 'utf8');
  spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null; const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 }); await wait(2500);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
  // 建工作台库
  await page.locator('[data-testid="side-ws-head"]').last().click({ force: true }); await wait(600);
  await page.evaluate(() => { [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').includes('新建库'))?.click(); }); await wait(900);
  await page.locator('[data-testid="new-ws-name"]').fill('T71 侦察库');
  await page.locator('[data-testid="new-ws-type-workbench"]').click({ force: true });
  await page.locator('[data-testid="new-ws-confirm"]').click({ force: true }); await wait(3000);

  const dump = await page.evaluate(() => {
    const region = document.querySelector('[data-testid="workbench"]');
    if (region === null) return { error: 'NO_WORKBENCH' };
    const ids = [...region.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'));
    const ctrl = [...region.querySelectorAll('input, textarea, select, button, [role="button"]')].map((e) => ({
      t: e.getAttribute('data-testid'), tag: e.tagName, ph: e.getAttribute('placeholder') ?? '', txt: (e.textContent ?? '').trim().slice(0, 24), al: e.getAttribute('aria-label') ?? '',
    }));
    return {
      slotOrder: [...region.querySelectorAll('[data-testid^="wb-slot-"]')].map((e) => e.getAttribute('data-testid').replace('wb-slot-', '')),
      cardIds: [...region.querySelectorAll('[data-testid^="wb-card-"]')].map((e) => e.getAttribute('data-testid')),
      ids,
      ctrl,
      ls: Object.keys(localStorage).filter((k) => k.includes('septcats')),
    };
  });
  console.log('SLOTS:', JSON.stringify(dump.slotOrder));
  console.log('CARDS:', JSON.stringify(dump.cardIds));
  console.log('LS:', JSON.stringify(dump.ls));
  console.log('CTRL:');
  for (const c of dump.ctrl ?? []) console.log(`  ${c.tag.padEnd(7)} tid=${String(c.t).padEnd(34)} ph="${c.ph}" txt="${c.txt}" al="${c.al}"`);
  console.log('ALL_IDS:');
  for (const i of dump.ids ?? []) console.log('  ' + i);
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });