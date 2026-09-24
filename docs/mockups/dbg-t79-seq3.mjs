/* T79 定性 3：重放 E1 序列→DOM 终态→优雅退出→同 UD 重启→IPC dump 块真相 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't79-dbg3');
const UD = `${RUN}\\ud`;
const PORT = 9242;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const TS = 'd3' + Date.now().toString(36);
const PNAME = `DBG3 ${TS}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
  if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
  return { child, browser, page };
}

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
let { child, browser, page } = await launch();

await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
await wait(900);
await page.evaluate((pn) => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, pn); i.dispatchEvent(new Event('input', { bubbles: true })); } }, PNAME);
await wait(200);
await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
await wait(1500);
const body = page.locator('.pv-body .ProseMirror').first();
await body.click();
await page.keyboard.type('# 标题测试', { delay: 30 }); await page.keyboard.press('Enter'); await wait(300);
await page.keyboard.type('- [ ] 待办测试', { delay: 30 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
await page.keyboard.type('> 引用测试', { delay: 30 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
await page.keyboard.type('```python', { delay: 30 }); await page.keyboard.press('Enter'); await wait(400);
await page.keyboard.type('print("hi")', { delay: 30 }); await wait(300);
await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(400);
await page.keyboard.type('/表格', { delay: 40 }); await wait(700);
await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click());
await wait(700);
// 单元格：真 .focus()（T76 先例）
await page.evaluate(() => document.querySelector('[data-testid^="block-table-cell-"]')?.focus());
await wait(300);
await page.keyboard.type('格A', { delay: 30 }); await wait(400);
await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
await wait(4500);
const dom = await page.evaluate(() => {
  const ed = document.querySelector('.pv-body .ProseMirror');
  return [...(ed?.children ?? [])].map((c) => `${c.tagName.toLowerCase()}:${(c.innerText ?? '').slice(0, 40).replace(/\n/g, '↵')}`).join('  +  ');
});
console.log(`DOM终态: ${dom}`);
await page.evaluate(() => window.close()).catch(() => {});
await wait(2200);
for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { break; } }
({ child, browser, page } = await launch());
await wait(1800);
const dump = await page.evaluate(async (pn) => {
  const w = await window.septcats.workspaces.list({});
  const r = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id });
  const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
  const hit = arr.find((x) => x?.title === pn);
  if (!hit) return 'NO_PAGE';
  const b = await window.septcats.blocks.list({ pageId: hit.id });
  return (b.blocks ?? []).map((x) => `${x.type}|${JSON.stringify(x.props)}|${JSON.stringify(x.content).slice(0, 150)}`).join('\n');
}, PNAME);
console.log(`DB块真相:\n${dump}`);
try { await page.evaluate(() => window.close()); } catch { /* */ }
await wait(1500);
killTree(child?.pid);
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
process.exit(0);
