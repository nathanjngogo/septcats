/* 块编辑器可见性取证：块手柄（＋/⋮⋮）是否可见？/ 斜杠菜单能否唤起？
 * 独立夹具根；不触碰真实库。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\blk-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\blk-data';
const PORT = 9396;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-blocks';
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

// 建页 + 两段文字
await side.getByText(/新建页面|New Page/).first().click({ timeout: 8000 }).catch(() => {});
const i = side.locator('input').first();
if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await i.fill('块手柄取证页'); await i.press('Enter'); }
await wait(1800);
await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await page.keyboard.type('第一段文字', { delay: 15 });
await page.keyboard.press('Enter');
await page.keyboard.type('第二段文字', { delay: 15 });
await wait(1800);

// 悬停第一段
const para = page.locator('.pv-body .ProseMirror p').first();
await para.hover().catch(() => {});
await wait(1200);
const hov = await page.evaluate(() => {
  const out = {};
  const handle = document.querySelector('.sc-blockcontrol__handle');
  const root = document.querySelector('[class*="sc-blockcontrol"]');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), display: s.display, visibility: s.visibility, opacity: s.opacity, z: s.zIndex, pos: s.position }; };
  out.handle = r(handle);
  out.root = r(root);
  out.handleAria = handle?.getAttribute('aria-label') ?? null;
  out.buttons = [...document.querySelectorAll('[class*="sc-blockcontrol"] button')].map((b) => ({ aria: b.getAttribute('aria-label'), label: (b.textContent ?? '').trim().slice(0, 18) }));
  out.inViewport = handle ? (() => { const b = handle.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0; })() : false;
  return out;
});
log('HOVER:', JSON.stringify(hov));
await page.screenshot({ path: SHOTS + '/hover-block.png' });

// 点手柄 → 菜单
const handle = page.locator('.sc-blockcontrol__handle').first();
const hOk = await handle.click({ timeout: 5000 }).then(() => true).catch(() => false);
await wait(1000);
const menu = await page.evaluate(() => {
  const m = document.querySelector('.sc-blockcontrol__menu');
  if (!m) return null;
  const b = m.getBoundingClientRect(); const s = getComputedStyle(m);
  return { items: [...m.querySelectorAll('[class*="__label"]')].map((e) => (e.textContent ?? '').trim()).slice(0, 12), w: Math.round(b.width), h: Math.round(b.height), display: s.display, visibility: s.visibility };
});
log('MENU after handle click:', JSON.stringify(menu), 'clickOk=', hOk);
await page.screenshot({ path: SHOTS + '/block-menu.png' });
await page.keyboard.press('Escape').catch(() => {});

// 斜杠菜单
await page.keyboard.press('Enter').catch(() => {});
await wait(400);
await page.keyboard.type('/', { delay: 30 });
await wait(1400);
const slash = await page.evaluate(() => {
  const m = document.querySelector('[data-testid="septcats-slashmenu"]');
  if (!m) return null;
  const b = m.getBoundingClientRect(); const s = getComputedStyle(m);
  return { options: [...m.querySelectorAll('[role="option"]')].map((e) => (e.textContent ?? '').trim().slice(0, 16)).slice(0, 14), w: Math.round(b.width), h: Math.round(b.height), display: s.display, inViewport: b.height > 0 && b.top >= 0 && b.bottom <= window.innerHeight };
});
log('SLASH after typing /:', JSON.stringify(slash));
await page.screenshot({ path: SHOTS + '/slash-menu.png' });

await br.close().catch(() => {});
killAll();
process.exit(0);