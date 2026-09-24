/* T79 定性 2：现场重放 E1 输入序列，每步 dump DOM/块数——找产品或探针在哪步丢 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't79-dbg2');
const UD = `${RUN}\\ud`;
const PORT = 9241;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const TS = 'd' + Date.now().toString(36);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
const snap = async (tag) => {
  const s = await page.evaluate(() => {
    const ed = document.querySelector('.pv-body .ProseMirror');
    return ed ? [...ed.children].map((c) => `${c.tagName.toLowerCase()}:${(c.textContent ?? '').slice(0, 14)}`).join(' + ') : 'NO_EDITOR';
  });
  console.log(`${tag}: ${s}`);
};
// 建页
await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
await wait(900);
await page.evaluate((pn) => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, pn); i.dispatchEvent(new Event('input', { bubbles: true })); } }, `DBG2 ${TS}`);
await wait(200);
await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
await wait(1500);
const body = page.locator('.pv-body .ProseMirror').first();
await body.click();
await page.keyboard.type('# 标题测试', { delay: 30 }); await page.keyboard.press('Enter'); await wait(300);
await snap('after heading');
await page.keyboard.type('- [ ] 待办测试', { delay: 30 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
await snap('after todo');
await page.keyboard.type('> 引用测试', { delay: 30 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
await snap('after quote');
await page.keyboard.type('```python', { delay: 30 }); await page.keyboard.press('Enter'); await wait(300);
await snap('after fence+enter');
await page.keyboard.type('print("hi")', { delay: 30 }); await wait(200);
await snap('after code text');
await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
await snap('after code exits');
await page.keyboard.type('/表格', { delay: 40 }); await wait(700);
const slashCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="slash-item-"]').length);
console.log(`slash open items=${slashCount}`);
await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click());
await wait(700);
await snap('after insert table');
await page.evaluate(() => { const c = document.querySelector('[data-testid^="block-table-cell-"]'); const r = c?.getBoundingClientRect(); if (c != null && r != null) c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); });
await wait(400);
await page.keyboard.type('格A|B', { delay: 30 }); await wait(500);
await snap('after cell type inner');
const inn = await page.evaluate(() => {
  const ed = document.querySelector('.pv-body .ProseMirror');
  return [...(ed?.children ?? [])].map((c) => `${c.tagName.toLowerCase()}:${(c.innerText ?? c.textContent ?? '').slice(0, 30).replace(/\n/g,'↵')}`).join(' + ');
});
console.log(`inner: ${inn}`);
await wait(4000);
try { await page.evaluate(() => window.close()); } catch { /* */ }
await wait(1500);
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
process.exit(0);
