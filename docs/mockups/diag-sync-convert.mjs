/* 针对性诊断：①「同步错误」何时出现、详情是什么 ②「转为数据库」在此序列下为何不生效
 * 独立夹具根。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\diag-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\diag-data';
const PORT = 9391;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const log = (...a) => console.log(...a);

killAll();
for (const d of [UD, ROOT]) rmSync(d, { recursive: true, force: true });
for (const d of [UD, ROOT]) mkdirSync(d, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');
const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await new Promise((r) => setTimeout(r, 1000)); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR ${String(e).slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async () => { for (let k = 0; k < 25; k++) { if (await page.evaluate(() => typeof window.septcats?.templates?.list === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true; await wait(800); } return false; };
await ready();
const side = page.locator('.app-side');
const pill = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /同步|Synced|Sync/i.test(e.textContent ?? ''));
  if (!el) return { text: '(无状态元素)', title: '', aria: '' };
  const box = el.closest('[role="status"],[data-state],button') ?? el;
  return { text: (el.textContent ?? '').trim().slice(0, 40), title: box.getAttribute('title') ?? '', aria: box.getAttribute('aria-label') ?? '', state: box.getAttribute('data-state') ?? '', cls: box.className?.toString().slice(0, 80) ?? '' };
});
const step = async (name) => { const s = await pill(); log(`STATUS@${name}: text="${s.text}" state="${s.state}" title="${s.title}" aria="${s.aria}" cls="${s.cls}"`); };
const newPage = async (title) => {
  await side.getByText(/新建页面|New Page/).first().click({ timeout: 8000 }).catch(() => {});
  const i = side.locator('input').first();
  if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await i.fill(title); await i.press('Enter'); }
  await wait(1800);
};
const palette = async (q) => {
  await page.keyboard.press('Escape').catch(() => {}); await wait(300);
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  if (!(await pin.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false))) return null;
  await pin.fill(''); if (q) await pin.type(q, { delay: 20 });
  await wait(1400);
  return page.locator('.palette-list [role="option"]');
};

await step('boot');
await newPage('诊断源页');
await step('after-create-page');
await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await page.keyboard.type('诊断正文', { delay: 15 });
await wait(1800);
await step('after-type');

// 模板保存
await palette('另存为');
await page.locator('.palette-list [role="option"]').filter({ hasText: '另存为模板' }).first().click().catch(() => {});
await wait(1000);
const sInp = page.locator('[data-testid="template-save-name"]').first();
if (await sInp.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) await sInp.fill('诊断模板');
await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
await wait(1800);
await step('after-save-template');

// 转为数据库（先记录按钮存在性与可见性）
const btnInfo = await page.evaluate(() => {
  const els = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent ?? '').trim() === '转为数据库');
  return els.map((e) => { const b = e.closest('button,[role="button"]') ?? e; const r = b.getBoundingClientRect(); return { tag: b.tagName, cls: b.className?.toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), disabled: b.disabled ?? null }; });
});
log('CONV-BUTTON:', JSON.stringify(btnInfo));
await page.getByText('转为数据库').first().click({ force: true }).catch(() => {});
await wait(3000);
await step('after-convert-click');
const afterConv = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
log('BODY-AFTER-CONVERT:', afterConv);
const tpl = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
log('TEMPLATES:', JSON.stringify(tpl));
log('ERRORS:', errs.length === 0 ? '(none)' : errs.slice(0, 8).join(' ;; '));

await br.close().catch(() => {});
killAll();
process.exit(0);