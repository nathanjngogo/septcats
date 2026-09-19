/* 复现「输入文本有重叠」：新建页连续输入 → 检查 DOM 与库中是否出现重复/幽灵块
 * 独立夹具根；不触碰真实库 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\ovl-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\ovl-data';
const PORT = 9398;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-overlap';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const log = (...a) => console.log(...a);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await i.fill('重叠复现页'); await i.press('Enter'); }
await wait(1800);
await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await page.keyboard.type('重叠甲', { delay: 40 });
await wait(1500);
log('STEP1 输入后:', JSON.stringify(await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.pv-body .ProseMirror > *')];
  const ids = nodes.map((n) => n.getAttribute('data-id'));
  return { topLevel: nodes.map((n) => ({ tag: n.tagName, id: n.getAttribute('data-id'), text: (n.textContent ?? '').slice(0, 20) })), bodyText: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 80), dupIds: ids.filter((id, k) => id !== null && ids.indexOf(id) !== k) };
})));
await page.keyboard.press('Enter');
await page.keyboard.type('重叠乙', { delay: 40 });
await wait(1800);
const after = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.pv-body .ProseMirror > *')];
  const ids = nodes.map((n) => n.getAttribute('data-id'));
  return {
    topLevel: nodes.map((n) => ({ tag: n.tagName, id: n.getAttribute('data-id'), text: (n.textContent ?? '').slice(0, 20) })),
    innerText: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 120),
    dupIds: ids.filter((id, k) => id !== null && ids.indexOf(id) !== k),
    emptyWrap: nodes.filter((n) => (n.textContent ?? '').trim() === '').length,
  };
});
log('STEP2 两段后:', JSON.stringify(after));
await page.screenshot({ path: SHOTS + '/after-typing.png' });
// 手柄 × 文本 相交检测（当前窗口 + 窄窗 640/900/1280）
for (const W of [1280, 900, 760, 640]) {
  await page.evaluate((w) => window.resizeTo(w, 800), W).catch(() => {});
  await wait(900);
  const firstBlk = page.locator('.pv-body [data-id]').first();
  await firstBlk.hover().catch(() => {});
  await wait(900);
  const m = await page.evaluate(() => {
    const h = document.querySelector('.sc-blockcontrol__handle');
    const blk = document.querySelector('.pv-body [data-id]');
    if (!h || !blk) return { handle: null };
    const hr = h.getBoundingClientRect();
    // 文本范围：首个文本节点的 rect（含 range 精确到字符）
    const node = blk.firstChild ?? blk;
    const rng = document.createRange(); rng.selectNodeContents(node);
    const tr = rng.getBoundingClientRect();
    const overlapX = Math.max(0, Math.min(hr.right, tr.right) - Math.max(hr.left, tr.left));
    const overlapY = Math.max(0, Math.min(hr.bottom, tr.bottom) - Math.max(hr.top, tr.top));
    return { winW: window.innerWidth, handle: { l: Math.round(hr.left), r: Math.round(hr.right) }, text: { l: Math.round(tr.left), r: Math.round(tr.right) }, overlapX: Math.round(overlapX), overlapY: Math.round(overlapY), overlap: overlapX > 2 && overlapY > 2, gutter: Math.round(tr.left - hr.right) };
  });
  log('OVERLAP-CHECK winW=' + String(W) + ':', JSON.stringify(m));
  if (W === 640) await page.screenshot({ path: SHOTS + '/narrow-handle.png' });
}
// 重载后再看（落库后是否重复）
await page.reload();
await wait(3000);
const reloaded = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('.pv-body .ProseMirror > *')];
  return { count: nodes.length, texts: nodes.map((n) => (n.textContent ?? '').slice(0, 20)), innerText: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 120) };
});
log('STEP3 重载后:', JSON.stringify(reloaded));
await page.screenshot({ path: SHOTS + '/after-reload.png' });
await br.close().catch(() => {});
killAll();
process.exit(0);