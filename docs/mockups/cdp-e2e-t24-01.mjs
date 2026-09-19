/* T24-01 真机验收：①删除页面鼠标链路（面板+回收站恢复）②转为多维数据后另存=kind=database ③toast 可见
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t24-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t24-data';
const PORT = 9375;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t24';
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
    if (await page.evaluate(() => typeof window.septcats?.templates?.list === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true;
    await wait(800);
  }
  return false;
};
await ready();
const side = page.locator('.app-side');
const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const newPage = async (title) => {
  await side.getByText('新建页面').first().click();
  const i = side.locator('input').first();
  await i.waitFor({ state: 'visible', timeout: 10000 });
  await i.fill(title);
  await i.press('Enter');
  await wait(1800);
};
const paletteRun = async (text, rowIncludes) => {
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  await pin.waitFor({ state: 'visible', timeout: 6000 });
  await pin.fill('');
  await pin.type(text, { delay: 25 });
  await wait(1400);
  const rows = await page.locator('.palette-list [role="option"]').allInnerTexts().catch(() => []);
  const target = page.locator('.palette-list [role="option"]').filter({ hasText: rowIncludes }).first();
  await target.click().catch(() => {});
  await wait(1000);
  return rows;
};
const tplList = () => page.evaluate(async () => (await window.septcats.templates.list({})).templates);
const DEL = '删除靶页T24';

// ① 删除入口（命令面板 → Dialog → 回收站可达 → 鼠标恢复）
await newPage(DEL);
let st = (await body()).replace(/\s+/g, ' ');
check('①a 目标页已建立（侧栏可见）', st.includes(DEL), st.slice(0, 100));
const rowsDel = await paletteRun('删除页面', '删除页面');
check('①b 面板出现「删除页面」命令', rowsDel.some((t) => t.includes('删除页面')), rowsDel.join(' | ').slice(0, 120));
const dlgTxt = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').replace(/\s+/g, ' ').trim());
check('①c 删除有二次确认 Dialog', dlgTxt.length > 0, `dialog="${dlgTxt.slice(0, 120)}"`);
await page.locator('[role="dialog"] button').last().click().catch(() => {});
await wait(2200);
st = (await body()).replace(/\s+/g, ' ');
check('①d 删除后离开侧栏树', !st.includes(DEL), st.slice(0, 110));
await page.locator('.app-side-foot').first().click();
await wait(1800);
st = (await body()).replace(/\s+/g, ' ');
check('①e 回收站里出现该页（鼠标可达）', st.includes(DEL) && st.includes('恢复') && st.includes('彻底删除'), st.slice(0, 160));
await page.screenshot({ path: SHOTS + '/trash-by-mouse.png' });
await page.getByText('恢复').first().click({ timeout: 8000 }).catch(() => {});
await wait(2000);
st = (await body()).replace(/\s+/g, ' ');
check('①f 鼠标恢复成功', !st.includes('彻底删除'), st.slice(0, 140));
await page.locator('.app-side-foot').first().click();
await wait(1200);

// ② 转为多维数据 → 另存模板必须 kind=database → 实例化是库且 0 记录
await newPage('库源页T24');
await page.locator('.pv-body .ProseMirror p').first().click();
await page.keyboard.type('库源正文丁', { delay: 20 });
await wait(1500);
await page.getByText('转为多维数据').first().click({ force: true }).catch(() => {});
await wait(2800);
const dbView = (await body()).replace(/\s+/g, ' ');
check('②a 转换生效（出现库 UI）', dbView.includes('新建记录') || dbView.includes('还没有记录'), dbView.slice(0, 140));
await paletteRun('另存为', '另存为模板');
const sInp = page.locator('[data-testid="template-save-name"]').first();
if (await sInp.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) await sInp.fill('库模板T24');
await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
await wait(1800);
const l1 = await tplList();
const dbTpl = l1.find((t) => t.title === '库模板T24');
check('②b 转换后另存 → kind=database', dbTpl?.kind === 'database', `list=${l1.map((t) => `${t.title}:${t.kind}`).join(', ')}`);

// ③ toast 可见（刚保存应有提示）
const toast = await page.evaluate(() => {
  const t = document.querySelector('.sc-toast__item');
  return { present: t !== null, text: t ? t.innerText.replace(/\s+/g, ' ').slice(0, 80) : '' };
});
check('③ 保存后有可见提示（.sc-toast__item 落地）', toast.present, `text="${toast.text}"`);
await page.screenshot({ path: SHOTS + '/toast-visible.png' });

// ④ 从库模板实例化：库 UI + 0 记录
await page.locator('.app-side .app-nav-suffix').first().click().catch(() => {});
await wait(1200);
await side.getByText('库模板T24').first().click().catch(() => {});
await wait(2600);
const inst = (await body()).replace(/\s+/g, ' ');
check('④ 库模板实例化：新页是库且 0 条记录', (inst.includes('新建记录') || inst.includes('还没有记录')) && inst.includes('库模板T24'), inst.slice(0, 160));
await page.screenshot({ path: SHOTS + '/db-template-instantiated.png' });

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T24-01 真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);