/* C4 定性：经 IPC blocks.list 读「T77 代码页」块 lang attr——区分产品未持久化 vs 探针导航失败 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't77-c4');
const UD = `${RUN}\\ud`;
const PORT = 9237;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
  if (browser === null) throw new Error('CDP fail');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { child, browser, page };
}
const out = [];
try {
  let { child, browser, page } = await launch();
  const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
  if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
  // 新页+代码块+选 python（复刻主探针 C1 链）
  await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
  await wait(900);
  await page.evaluate(() => { const i = document.querySelector('.app-side input'); if (i) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, 'T77 代码页'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await wait(200);
  await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(1500);
  const body = page.locator('.pv-body .ProseMirror').first();
  await body.click(); await wait(300);
  await page.keyboard.type('```', { delay: 50 }); await page.keyboard.press('Enter'); await wait(500);
  await page.keyboard.type('x=1', { delay: 20 }); await wait(400);
  await page.evaluate(() => document.querySelector('[data-testid^="codebar-lang-"]')?.click()); await wait(500);
  await page.evaluate(() => document.querySelector('[data-testid="codebar-lang-opt-python"]')?.click()); await wait(600);
  out.push(`tag 现值=${await page.evaluate(() => document.querySelector('[data-testid^="code-lang-tag-"]')?.textContent ?? 'NONE')}`);
  await wait(3500);
  const pid = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list({});
    const r = await window.septcats.pages.tree({ workspaceId: ws.activeId ?? ws.items?.[0]?.id });
    const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
    const hit = arr.find((x) => (x?.title ?? '').includes('T77 代码页'));
    return { id: hit?.id ?? null, titles: arr.map((x) => `${x?.title}#${x?.id?.slice(-4)}#${x?.updatedAt ?? ''}`).join(' | ').slice(0, 400) };
  });
  out.push(`tree=${JSON.stringify(pid).slice(0, 300)}`);
  if (pid.id != null) {
    const blks = await page.evaluate(async (id) => JSON.stringify(await window.septcats.blocks.list({ pageId: id })), pid.id);
    out.push(`blocks=${blks.slice(0, 900)}`);
  }
  await page.evaluate(() => window.close()).catch(() => {});
  await wait(2200);
  for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { break; } }
  // 重启后读同页块（数据面真相）
  ({ child, browser, page } = await launch());
  await wait(1800);
  const after = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list({});
    const r = await window.septcats.pages.tree({ workspaceId: ws.activeId ?? ws.items?.[0]?.id });
    const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
    const hit = arr.find((x) => (x?.title ?? '').includes('T77 代码页'));
    if (!hit) return { id: null, titles: arr.map((x) => `${x?.title}#${x?.id?.slice(-4)}`).join(' | ').slice(0, 300) };
    const b = await window.septcats.blocks.list({ pageId: hit.id });
    return { id: hit.id, blocks: JSON.stringify(b).slice(0, 700) };
  });
  out.push(`after=${JSON.stringify(after)}`);
  try { await page?.evaluate(() => window.close()); } catch { /* */ }
  await wait(1500);
  killTree(child?.pid);
} catch (e) { out.push(`ERR ${String(e)}`); }
console.log(out.join('\n'));
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
process.exit(0);
