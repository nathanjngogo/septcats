/* T25-01 真机验收：切 English → 主界面/侧栏/面板/设置/对话框无 CJK 残留 → 切回中文
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t25-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t25-data';
const PORT = 9376;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t25';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 200) : ''}`); };

killAll();
for (const dir of [UD, ROOT, SHOTS]) rmSync(dir, { recursive: true, force: true });
for (const dir of [UD, ROOT, SHOTS]) mkdirSync(dir, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async () => {
  for (let k = 0; k < 25; k++) {
    if (await page.evaluate(() => typeof window.septcats?.pages?.create === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true;
    await wait(800);
  }
  return false;
};
await ready();
const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
const surface = (sel) => page.evaluate((s) => (document.querySelector(s)?.innerText ?? '').replace(/\s+/g, ' ').trim(), sel);
const setLocale = async (loc) => {
  await page.evaluate((l) => localStorage.setItem('septcats.localePref', l), loc);
  await page.evaluate(async (l) => { try { await window.septcats.settings.patch({ locale: l }); } catch { /* 无该 API 时靠 localStorage */ } }, loc);
  await page.reload();
  await ready();
  await wait(2200);
};
const openPalette = async () => {
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  await pin.waitFor({ state: 'visible', timeout: 6000 });
  await wait(900);
};
const closePalette = async () => { await page.keyboard.press('Escape').catch(() => {}); await wait(600); };

// ① 基线：中文界面
const zhSide = await surface('.app-side');
check('① 基线中文界面（侧栏含 CJK）', cjk(zhSide) > 0, `cjk=${cjk(zhSide)} ${zhSide.slice(0, 70)}`);

// ② 切 English
await setLocale('en-US');
const enSide = await surface('.app-side');
check('② English：侧栏无 CJK', cjk(enSide) === 0, `cjk=${cjk(enSide)} "${enSide.slice(0, 110)}"`);
await openPalette();
const enPalette = await surface('.palette-list') || (await surface('[data-testid="palette-panel"]'));
check('③ English：命令面板无 CJK', cjk(enPalette) === 0, `cjk=${cjk(enPalette)} "${enPalette.slice(0, 130)}"`);
await page.screenshot({ path: SHOTS + '/en-palette.png' });
await closePalette();
// 设置视图
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,[role="button"],a')].find((x) => ((x.getAttribute('aria-label') ?? '') + (x.getAttribute('title') ?? '')).match(/设置|Settings/));
  b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(2000);
let st = await surface('.app-main') || (await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')));
if (cjk(st) > 0) st = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
check('④ English：设置页无 CJK', cjk(st) === 0, `cjk=${cjk(st)} "${st.slice(0, 170)}"`);
await page.screenshot({ path: SHOTS + '/en-settings.png' });
// 对话框（删除页面确认，走面板英文命令）
await page.keyboard.press('Control+k').catch(() => {});
await closePalette();
const delRows = await (async () => {
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  await pin.waitFor({ state: 'visible', timeout: 6000 });
  await pin.type('Delete', { delay: 25 });
  await wait(1300);
  return page.locator('.palette-list [role="option"]').allInnerTexts().catch(() => []);
})();
const dlg = await (async () => {
  await page.locator('.palette-list [role="option"]').first().click().catch(() => {});
  await wait(1200);
  return page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').replace(/\s+/g, ' ').trim());
})();
check('⑤ English：对话框无 CJK（命令与文案均已英化）', dlg.length > 0 && cjk(dlg) === 0, `rows=${delRows.join(' | ').slice(0, 90)} dialog="${dlg.slice(0, 130)}"`);
await page.screenshot({ path: SHOTS + '/en-dialog.png' });
await page.keyboard.press('Escape').catch(() => {});

// ③ 切回中文
await setLocale('zh-CN');
const back = await surface('.app-side');
check('⑥ 切回中文恢复（侧栏含 CJK）', cjk(back) > 0, `cjk=${cjk(back)} ${back.slice(0, 70)}`);
await page.screenshot({ path: SHOTS + '/zh-restored.png' });

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T25-01 真机（en i18n）${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);