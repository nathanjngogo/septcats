/* 一锤定音：新夹具建表格页→键入格A→优雅退出→sqlite 直读 blocks 表 table 行 content_json/props_json */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't79-cell');
const UD = `${RUN}\\ud`;
const DATA = join(RUN, 'data');
const PORT = 9243;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(DATA, { recursive: true });
// settings 钉 rootPath（探针先例：写 settings.json 于 UD？——按既有探针法：夹具目录）
function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  return child;
}
let child = launch();
let browser = null;
for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
let ctx = browser.contexts()[0];
let page = ctx.pages()[0] ?? (await ctx.newPage());
const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
const wsInfo = await page.evaluate(async () => { const w = await window.septcats.workspaces.list({}); return JSON.stringify(w).slice(0, 300); });
console.log('WS:', wsInfo);
await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
await wait(900);
await page.evaluate(() => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, 'CELL 定案页'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
await wait(200);
await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
await wait(1500);
await page.locator('.pv-body .ProseMirror').first().click();
await page.keyboard.type('/表格', { delay: 40 }); await wait(700);
await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click());
await wait(700);
await page.evaluate(() => document.querySelector('[data-testid^="block-table-cell-"]')?.focus());
await wait(300);
await page.keyboard.type('格A', { delay: 30 }); await wait(400);
const dv = await page.evaluate(() => document.querySelector('[data-testid="block-table-cell-0-0"]')?.value ?? 'NONE');
console.log('DOM cell value:', dv);
await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
await wait(3800);
await page.evaluate(() => window.close()).catch(() => {});
await wait(2200);
for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { break; } }
try { browser?.close(); } catch { /* */ }
console.log('优雅退出完成，找 DB');
