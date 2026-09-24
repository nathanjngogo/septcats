/* 定案：重启后（同真实库）T79 导出页 table DOM 单元格值 + IPC list 双读 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const UD = join(REPO, '..', '_scratch', 't79-e2e', 'ud'); // 复用本次探针 UD
const PORT = 9244;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
const page = browser.contexts()[0].pages()[0];
const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
await page.evaluate(() => { const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes('mufe5m7d')); if (row != null) row.click(); });
await wait(1600);
const dom = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid^="block-table-cell-"]')];
  return { n: cells.length, v0: cells[0]?.value ?? 'NONE', all: cells.map((c) => c.value).join(',') };
});
console.log('重启后 DOM table:', JSON.stringify(dom));
const ipc = await page.evaluate(async () => {
  const w = await window.septcats.workspaces.list({});
  const r = await window.septcats.pages.tree({ workspaceId: w.activeId });
  const arr = Array.isArray(r) ? r : (r?.pages ?? []);
  const hit = arr.find((x) => (x?.title ?? '').includes('mufe5m7d'));
  const b = await window.septcats.blocks.list({ pageId: hit.id });
  const tb = (b.blocks ?? []).find((x) => x.type === 'table');
  return JSON.stringify(tb?.content).slice(0, 160);
});
console.log('重启后 IPC list table:', ipc);
try { await page.evaluate(() => window.close()); } catch { /* */ }
await wait(1800);
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
process.exit(0);
