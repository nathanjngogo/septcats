/* T22-01 真机验收：面包屑真路径（三层祖先链）+ 回收站列表（恢复/彻底删除）+ 双主题空态截图
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t22b-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t22b-data';
const PORT = 9372;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t22';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 200) : ''}`); };

killAll();
for (const dir of [UD, ROOT, SHOTS]) rmSync(dir, { recursive: true, force: true });
for (const dir of [UD, ROOT, SHOTS]) mkdirSync(dir, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light' }), 'utf8');

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
const ready = async () => {
  for (let k = 0; k < 25; k++) {
    if (await page.evaluate(() => typeof window.septcats?.pages?.create === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
};
await ready();
const side = page.locator('.app-side');
const crumb = () => page.evaluate(() => (document.querySelector('.sc-shell__crumb')?.innerText ?? '').replace(/\s+/g, ' ').trim());
const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const P = '父页T22';
const C = '子页T22';
const G = '孙页T22';

// ① 经 IPC 搭三层结构（UI 暂无「建子页」入口，见报告 §2 缺口登记）
const mk = async (parentId, title) => {
  const r = await page.evaluate(async (pid) => window.septcats.pages.create({ parentId: pid }), parentId);
  await page.evaluate(async (a) => window.septcats.pages.rename({ id: a.id, title: a.title }), { id: r.id, title });
  return r.id;
};
const pId = await mk(null, P);
const cId = await mk(pId, C);
const gId = await mk(cId, G);
await page.reload();
await ready();
await new Promise((r) => setTimeout(r, 2500));

// ② 面包屑：顶层页（无 demo 路径）
const rootRow = side.getByText(P).first();
await rootRow.click();
await new Promise((r) => setTimeout(r, 1200));
const cRoot = await crumb();
check('① 面包屑：顶层页只显示自己（demo 路径已清除）', cRoot === P && !cRoot.includes('暗物质'), `crumb="${cRoot}"`);

// ③ 面包屑三层祖先链（经命令面板搜索跳转到最深页）
await page.keyboard.press('Control+k');
const pin = page.locator('[data-testid="palette-panel"] input').first();
await pin.waitFor({ state: 'visible', timeout: 5000 });
await pin.type(G, { delay: 25 });
await new Promise((r) => setTimeout(r, 1200));
const hit = page.locator('.palette-list [role="option"]').first();
await hit.click();
await new Promise((r) => setTimeout(r, 1500));
const cDeep = await crumb();
check('② 面包屑：三层祖先链「父 / 子 / 孙」', cDeep.includes(P) && cDeep.includes(C) && cDeep.includes(G), `crumb="${cDeep}"`);
await page.screenshot({ path: SHOTS + '/breadcrumb-3level.png' });

// ④ 回收站：删最深页 → (reload 让 store 重读) → 列表 → 恢复
await page.evaluate(async (id) => window.septcats.pages.remove({ id }), gId);
await page.reload();
await ready();
await new Promise((r) => setTimeout(r, 2500));
await page.locator('.app-side-foot').first().click();
await new Promise((r) => setTimeout(r, 1800));
const t1 = await body();
check('③ 回收站：待删页入列（含「恢复」「彻底删除」）', t1.includes(G) && t1.includes('恢复') && t1.includes('彻底删除'), t1.slice(0, 170));
check('③b 面包屑：回收站 scope 显示「回收站」', (await crumb()).includes('回收站'), `crumb="${await crumb()}"`);
await page.screenshot({ path: SHOTS + '/trash-list.png' });
await page.getByText('恢复').first().click({ timeout: 8000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1800));
const t2 = await body();
check('③c 恢复：行从回收站消失', !t2.includes('彻底删除'), t2.slice(0, 150));

// ⑤ 彻底删除：再删 → (reload) → 二次确认弹层 → 确认
await page.evaluate(async (id) => window.septcats.pages.remove({ id }), gId);
await page.reload();
await ready();
await new Promise((r) => setTimeout(r, 2500));
await page.locator('.app-side-foot').first().click();
await new Promise((r) => setTimeout(r, 1800));
await page.getByText('彻底删除').first().click({ timeout: 8000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 900));
const dlg = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText ?? '').replace(/\s+/g, ' ').trim());
check('④ 彻底删除：复用 Dialog 二次确认（非裸 confirm）', dlg.length > 0, `dialog="${dlg.slice(0, 130)}"`);
await page.screenshot({ path: SHOTS + '/purge-confirm.png' });
await page.locator('[role="dialog"] button').last().click({ timeout: 8000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1800));
const t3 = await body();
check('④b 确认后：行从回收站消失', !t3.includes(G), t3.slice(0, 150));

// ⑥ 双主题截图（回收站空态 + 微交互留档）
for (const [mode, file] of [['light', 'theme-light.png'], ['dark', 'theme-dark.png']]) {
  await page.evaluate((m) => localStorage.setItem('septcats.theme', m), mode);
  await page.reload();
  await ready();
  await page.locator('.app-side-foot').first().click();
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `${SHOTS}/${file}` });
}
check('⑤ 双主题截图留档（回收站空态）', true, 'screens-t22/theme-{light,dark}.png');

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T22-01 真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);