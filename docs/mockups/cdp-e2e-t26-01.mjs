/* T26-01 真机验收：①删唯一页→空态（非 demo 假内容）②切 English→整页零 CJK（含顶栏同步状态）③切回中文
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t26-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t26-data';
const PORT = 9377;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t26';
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
const side = page.locator('.app-side');
const txt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
const setLocale = async (loc) => {
  await page.evaluate((l) => localStorage.setItem('septcats.localePref', l), loc);
  await page.evaluate(async (l) => { try { await window.septcats.settings.patch({ locale: l }); } catch { /* ok */ } }, loc);
  await page.reload();
  await ready();
  await wait(2200);
};

// ① 建页 → 删除唯一页 → 必须空态（不得回落 demo 假内容）
await side.getByText(/新建页面|New Page/).first().click();
const i = side.locator('input').first();
await i.waitFor({ state: 'visible', timeout: 10000 });
await i.fill('空态靶页T26');
await i.press('Enter');
await wait(1800);
await page.keyboard.press('Control+k');
const pin = page.locator('[data-testid="palette-panel"] input').first();
await pin.waitFor({ state: 'visible', timeout: 6000 });
await pin.type('删除页面', { delay: 25 });
await wait(1300);
await page.locator('.palette-list [role="option"]').first().click().catch(() => {});
await wait(1000);
await page.locator('[role="dialog"] button').last().click().catch(() => {});
await wait(2500);
const afterDel = await txt();
check('① 删唯一页 → 出现空态元素（.pv-empty）', (await page.locator('.pv-empty').count()) > 0, `pv-empty=${await page.locator('.pv-empty').count()}`);
check('①b 空态不含 demo 假内容（无「暗物质探测」/假正文）', !afterDel.includes('暗物质') && !afterDel.includes('探测器矩阵'), afterDel.slice(0, 150));
await page.screenshot({ path: SHOTS + '/empty-state.png' });

// ② 切 English → 除「默认工作区名（库内数据，非 UI 文案）」外整页零 CJK
await setLocale('en-US');
const en = await txt();
const WS_NAME = '个人工作区';
const enStripped = en.split(WS_NAME).join('');
check('② English：整页零 CJK（含顶栏同步状态；剔除工作区名=数据）', cjk(enStripped) === 0, `cjk(剔名后)=${cjk(enStripped)} cjk(原)=${cjk(en)} "${en.slice(0, 170)}"`);
check('②b 顶栏同步状态已英化', en.includes('Synced') || en.includes('Sync'), `"${en.slice(0, 60)}"`);
check('②c 观察（登记 T26-01-1）：默认工作区名「个人工作区」是建库时种下的中文数据', cjk(en) === cjk(enStripped) + WS_NAME.length, `差=${cjk(en) - cjk(enStripped)} 字`);
await page.screenshot({ path: SHOTS + '/en-empty.png' });

// ③ 切回中文
await setLocale('zh-CN');
const zh = await txt();
check('③ 切回中文恢复（整页含 CJK）', cjk(zh) > 0, `cjk=${cjk(zh)} "${zh.slice(0, 90)}"`);
await page.screenshot({ path: SHOTS + '/zh-empty.png' });

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T26-01 真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);