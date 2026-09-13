import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

// 系统真实主题偏好（AppsUseLightTheme=1 → 浅色）
let reg = '';
try {
  reg = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'AppsUseLightTheme'], { encoding: 'utf8' });
} catch { reg = 'REG_FAIL'; }
console.log('SYSTEM AppsUseLightTheme:', /0x1/.test(reg) ? 'light' : /0x0/.test(reg) ? 'dark' : reg.slice(0, 60));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];
const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const DARK = new Set(['rgb(22, 24, 27)']);

// A) 持久化主链：settings=dark → reload → 实际渲染深色（main.tsx 播种修复的靶心）
await page.evaluate(async () => { await window.septcats.settings.patch({ theme: 'dark' }); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const afterReload = await bg();
check('A settings=dark → reload 后实际深色（播种链）', DARK.has(afterReload), afterReload);

// B) 切浅色 → reload → 实际浅色
await page.evaluate(async () => { await window.septcats.settings.patch({ theme: 'light' }); });
await page.evaluate(() => window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: 'light' } })));
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2200);
const afterLight = await bg();
check('B settings=light → reload 后实际浅色', !DARK.has(afterLight), afterLight);

// C) 设置页点击即时生效（不 reload）
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
  btn?.click();
});
await page.waitForTimeout(500);
const lightBg = await bg();
await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('label,button')).find((e) => (e.textContent ?? '').trim() === '深色');
  el?.click();
});
await page.waitForTimeout(800);
const darkBg = await bg();
check('C 点击「深色」即时切换（live）', darkBg !== lightBg, `${lightBg} → ${darkBg}`);

// 复原现场：跟随系统
await page.evaluate(async () => {
  await window.septcats.settings.patch({ theme: 'system' });
  window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: 'system' } }));
});
await page.waitForTimeout(400);
const finalTheme = await page.evaluate(async () => (await window.septcats.settings.get()).theme);
check('现场复原 theme=system', finalTheme === 'system', finalTheme);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T10 主题链复验 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
