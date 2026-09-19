/* 在**老板库副本**上验证块编辑器（老页面/老块路径）：手柄是否出现、菜单动作是否生效并落库
 * 只读源夹具 repro-boss-lib；工作副本另建；不触碰真实库 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, cpSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const SRC = 'E:\\Hermes Agent工作空间\\_scratch\\repro-boss-lib';
const WORK = 'E:\\Hermes Agent工作空间\\_scratch\\bossblk-work';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\bossblk-ud';
const PORT = 9397;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-bossblk';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

killAll();
for (const d of [WORK, UD, SHOTS]) rmSync(d, { recursive: true, force: true });
for (const d of [WORK, UD, SHOTS]) mkdirSync(d, { recursive: true });
copyFileSync(`${SRC}\\septcats.db`, `${WORK}\\septcats.db`);
for (const f of ['septcats.db-wal', 'septcats.db-shm']) { try { copyFileSync(`${SRC}\\${f}`, `${WORK}\\${f}`); } catch { /* 无 */ } }
cpSync(`${SRC}\\sync`, `${WORK}\\sync`, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: WORK }), 'utf8');


const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await wait(1000); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
for (let k = 0; k < 25; k++) { if (await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false)) break; await wait(800); }
const side = page.locator('.app-side');

// 选老板既有页面
const titles = await side.locator('text=双子星页').count().catch(() => 0);
log('侧栏「双子星页」命中数:', titles);
await side.locator('text=双子星页').first().click({ timeout: 8000 }).catch(() => {});
await wait(2500);
const domDiag = await page.evaluate(() => {
  const ids = [...document.querySelectorAll('.pv-body [data-id]')];
  const pm = document.querySelector('.pv-body .ProseMirror');
  return { dataIdCount: ids.length, classes: ids.slice(0, 4).map((e) => e.className.toString().slice(0, 40)), pmHtmlHead: (pm?.innerHTML ?? '').slice(0, 220) };
});
log('DOM-DIAG(老板页):', JSON.stringify(domDiag));
await page.screenshot({ path: SHOTS + '/boss-page.png' });

// hover 第一块
const firstBlock = page.locator('.pv-body [data-id]').first();
const h = await firstBlock.hover({ timeout: 6000 }).then(() => true).catch(() => false);
await wait(1500);
const hov = await page.evaluate(() => {
  const hd = document.querySelector('.sc-blockcontrol__handle');
  if (!hd) return { handle: null };
  const b = hd.getBoundingClientRect(); const s = getComputedStyle(hd);
  return { handle: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), vis: s.visibility, op: s.opacity }, inViewport: b.width > 0 && b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0, btns: [...document.querySelectorAll('.sc-blockcontrol button')].map((x) => x.getAttribute('aria-label')) };
});
log('HOVER(老板页):', JSON.stringify(hov), 'hoverOk=', h);

// 点块操作 → 菜单 → 点「标题 1」→ 断言 DOM 变 h1
await page.evaluate(() => { const b = document.querySelector('.sc-blockcontrol__handle'); if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true })); });
await wait(1200);
const menu = await page.evaluate(() => {
  const m = document.querySelector('.sc-blockcontrol__menu');
  if (!m) return null;
  const b = m.getBoundingClientRect();
  return { items: [...m.querySelectorAll('[class*="__label"]')].map((e) => (e.textContent ?? '').trim()), w: Math.round(b.width), h: Math.round(b.height), inViewport: b.height > 0 && b.top >= 0 && b.bottom <= window.innerHeight };
});
log('MENU(老板页):', JSON.stringify(menu));
if (menu) {
  const before = await page.evaluate(() => document.querySelector('.pv-body [data-id]')?.tagName ?? '');
  await page.getByText('标题 1', { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
  await wait(2500);
  const after = await page.evaluate(() => ({ tag: document.querySelector('.pv-body [data-id]')?.tagName ?? '', html: (document.querySelector('.pv-body .ProseMirror')?.innerHTML ?? '').slice(0, 160) }));
  log('块型转换:', JSON.stringify({ before, after }));
  await page.screenshot({ path: SHOTS + '/after-h1.png' });
  // 落库校验（重载后仍是 h1）
  await page.reload();
  await wait(3000);
  const persisted = await page.evaluate(() => document.querySelector('.pv-body [data-id]')?.tagName ?? '');
  log('重载后首块标签:', persisted);
}
await br.close().catch(() => {});
killAll();
process.exit(0);