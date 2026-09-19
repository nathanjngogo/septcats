/* TASK-T34-01 截图与层测色值取证：浅/深双主题各一张（侧栏+顶栏），
 * 并逐条取 computed style 证明：顶栏=侧栏=canvas、内容区=content、行三态 token 落地。
 * 直接以 electron . 跑 freshly-built out/；独立夹具根（--user-data-dir + rootPath），
 * 不触碰默认根/真实数据；退出时清理 electron 进程。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APPDIR = 'E:/Hermes Agent工作空间/Septcats/apps/desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t34-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t34-data';
const PORT = 9393;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t34';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
if (br === null) { console.log('FATAL: CDP connect failed'); process.exit(1); }
const page = br.contexts()[0].pages()[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let k = 0; k < 25; k++) {
  if (await page.evaluate(() => typeof window.septcats?.pages?.create === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) break;
  await wait(800);
}
await wait(1500);

// 建一页并选中，让侧栏出现 active 行、内容区有正文
await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('T34 设计对齐验收页');
await input.press('Enter');
await wait(1500);
const editorBody = page.locator('.pv-root [contenteditable]').first();
if (await editorBody.count()) {
  await editorBody.click();
  await page.keyboard.type('Notion 对齐验收正文：顶栏与侧栏同色、内容区纯白。');
}
await wait(800);

const probe = () => page.evaluate(() => {
  const bg = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? '(null)' : getComputedStyle(el).backgroundColor;
  };
  return {
    theme: document.documentElement.getAttribute('data-theme') ?? '(none)',
    sidebar: bg('.sc-shell__sidebar'),
    topbar: bg('.sc-shell__topbar'),
    main: bg('.sc-shell__main'),
    activeRow: bg('.app-nav-row--active'),
    ink: getComputedStyle(document.body).color,
  };
});
const eq = (a, b) => a.replace(/\s/g, '') === b.replace(/\s/g, '');

// ---------- 浅色 ----------
await page.screenshot({ path: `${SHOTS}/t34-light-sidebar-topbar.png` });
const light = await probe();
console.log('LIGHT', JSON.stringify(light, null, 2));
console.log(`${eq(light.sidebar, light.topbar) ? 'PASS' : 'FAIL'}  浅色：顶栏与侧栏同色（${light.topbar}）`);
console.log(`${eq(light.sidebar, 'rgb(249, 248, 247)') ? 'PASS' : 'FAIL'}  浅色：侧栏/顶栏 = canvas #F9F8F7（${light.sidebar}）`);
console.log(`${eq(light.main, 'rgb(255, 255, 255)') ? 'PASS' : 'FAIL'}  浅色：内容区 = content #FFFFFF（${light.main}）`);
console.log(`${eq(light.ink, 'rgb(44, 44, 43)') ? 'PASS' : 'FAIL'}  浅色：主文字 = ink #2C2C2B（${light.ink}）`);

// ---------- 深色（localStorage 真相源 + 重载） ----------
await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
await page.reload();
await wait(2500);
for (let k = 0; k < 20; k++) {
  if (await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false)) break;
  await wait(800);
}
await wait(1200);
await page.screenshot({ path: `${SHOTS}/t34-dark-sidebar-topbar.png` });
const dark = await probe();
console.log('DARK', JSON.stringify(dark, null, 2));
console.log(`${eq(dark.sidebar, dark.topbar) ? 'PASS' : 'FAIL'}  深色：顶栏与侧栏同色（${dark.topbar}）`);
console.log(`${eq(dark.sidebar, 'rgb(32, 32, 32)') ? 'PASS' : 'FAIL'}  深色：侧栏/顶栏 = canvas #202020（${dark.sidebar}）`);
console.log(`${eq(dark.main, 'rgb(25, 25, 25)') ? 'PASS' : 'FAIL'}  深色：内容区 = content #191919（${dark.main}）`);

// 折叠回归（T30 成果不破）：折叠后侧栏 display:none
const collapsed = await page.evaluate(() => {
  const btn = document.querySelector('[aria-expanded][aria-label*="侧栏" i], [aria-expanded][aria-label*="idebar" i]');
  if (btn === null) return '(no-toggle)';
  btn.click();
  return new Promise((resolve) => setTimeout(() => {
    const el = document.querySelector('.sc-shell__sidebar');
    const hidden = el === null || getComputedStyle(el).display === 'none';
    resolve(hidden ? 'display:none' : 'still-visible');
  }, 400));
});
console.log(`${collapsed === 'display:none' ? 'PASS' : 'FAIL'}  回归：折叠后侧栏完全收起（${collapsed}）`);

killAll();
console.log('DONE');
