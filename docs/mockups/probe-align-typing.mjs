/* 量测老板新报两点：①手柄与文字是否垂直对齐 ②换块型后文字是否上下跳
 * 独立夹具根；不触碰真实库 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\al-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\al-data';
const PORT = 9399;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-align';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = '对齐测试文本';

killAll();
for (const d of [UD, ROOT, SHOTS]) rmSync(d, { recursive: true, force: true });
for (const d of [UD, ROOT, SHOTS]) mkdirSync(d, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');
const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await wait(1000); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
for (let k = 0; k < 25; k++) { if (await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false)) break; await wait(800); }
const side = page.locator('.app-side');
await side.getByText(/新建页面|New Page/).first().click({ timeout: 8000 }).catch(() => {});
const i = side.locator('input').first();
if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await i.fill('对齐量测页'); await i.press('Enter'); }
await wait(1800);
await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await page.keyboard.type(T, { delay: 30 });
await wait(1500);

// ① 手柄 vs 首行文字：垂直对齐
const first = page.locator('.pv-body [data-id]').first();
await first.hover().catch(() => {});
await wait(1200);
const align = await page.evaluate(() => {
  const blk = document.querySelector('.pv-body [data-id]');
  const handle = document.querySelector('.sc-blockcontrol__handle');
  const cluster = document.querySelector('.sc-blockcontrol');
  if (!blk || !cluster) return { cluster: null };
  const node = blk.firstChild ?? blk;
  const rng = document.createRange(); rng.selectNodeContents(node);
  const tr = rng.getBoundingClientRect();
  const cr = cluster.getBoundingClientRect();
  const hr = handle ? handle.getBoundingClientRect() : null;
  return {
    textLine: { top: Math.round(tr.top), bottom: Math.round(tr.bottom), centerY: Math.round((tr.top + tr.bottom) / 2), h: Math.round(tr.height) },
    cluster: { top: Math.round(cr.top), bottom: Math.round(cr.bottom), centerY: Math.round((cr.top + cr.bottom) / 2), h: Math.round(cr.height), w: Math.round(cr.width) },
    handleH: hr ? Math.round(hr.height) : null,
    deltaCenterY: Math.round((cr.top + cr.bottom) / 2 - (tr.top + tr.bottom) / 2),
    deltaTop: Math.round(cr.top - tr.top),
  };
});
log('① 对齐量测:', JSON.stringify(align));
await page.screenshot({ path: SHOTS + '/align-before.png' });

// ② 换块型（转 H1）前后：块位置/滚动/文字位置变化
const before = await page.evaluate(() => {
  const blk = document.querySelector('.pv-body [data-id]');
  const scroller = document.querySelector('.pv-root');
  return { blkTop: Math.round(blk.getBoundingClientRect().top), blkH: Math.round(blk.getBoundingClientRect().height), scrollTop: Math.round(scroller?.scrollTop ?? -1), tag: blk.tagName };
});
await page.evaluate(() => { const b = document.querySelector('.sc-blockcontrol__handle'); if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true })); });
await wait(1000);
await page.getByText('标题 1', { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
await wait(2000);
const after = await page.evaluate(() => {
  const blk = document.querySelector('.pv-body [data-id]');
  const scroller = document.querySelector('.pv-root');
  return { blkTop: Math.round(blk.getBoundingClientRect().top), blkH: Math.round(blk.getBoundingClientRect().height), scrollTop: Math.round(scroller?.scrollTop ?? -1), tag: blk.tagName };
});
log('② 换块型:', JSON.stringify({ before, after, dTop: after.blkTop - before.blkTop, dH: after.blkH - before.blkH, dScroll: after.scrollTop - before.scrollTop }));
await page.screenshot({ path: SHOTS + '/after-h1.png' });
// 再转回文本，看是否回到原位
await page.evaluate(() => { const b = document.querySelector('.sc-blockcontrol__handle'); if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true })); });
await wait(900);
await page.getByText('文本', { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
await wait(1800);
const back = await page.evaluate(() => { const blk = document.querySelector('.pv-body [data-id]'); return { blkTop: Math.round(blk.getBoundingClientRect().top), tag: blk.tagName }; });
log('② 转回文本:', JSON.stringify(back), 'vs 初始', before.blkTop);
await br.close().catch(() => {});
killAll();
process.exit(0);