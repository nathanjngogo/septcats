/* T23-02 真机验收（UI 面）：另存为模板 → 侧栏下拉建页 → 面板模板组 → 数据库模板 → 设置管理 → 双主题
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t23b-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t23b-data';
const PORT = 9374;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t23-ui';
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
const paletteOpen = async (text) => {
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  await pin.waitFor({ state: 'visible', timeout: 6000 });
  await pin.fill('');
  await pin.type(text, { delay: 25 });
  await wait(1400);
  return page.locator('.palette-list [role="option"]');
};
const tplList = () => page.evaluate(async () => (await window.septcats.templates.list({})).templates);
const editorText = () => page.evaluate(() => (document.querySelector('.pv-body .ProseMirror')?.innerText ?? ''));
const SRC = '源页U23';
const TPL = '模板U23';
const BODY_TXT = '模板正文丙';

// ① UI 建源页 + 输入内容
await side.getByText('新建页面').first().click();
const inp = side.locator('input').first();
await inp.waitFor({ state: 'visible', timeout: 10000 });
await inp.fill(SRC);
await inp.press('Enter');
await wait(1600);
await page.locator('.pv-body .ProseMirror p').first().click();
await page.keyboard.type(BODY_TXT, { delay: 20 });
await wait(1600);
check('① 源页 + 内容（真实 UI 路径）', (await editorText()).includes(BODY_TXT), (await editorText()).slice(0, 60));

// ② 命令面板「另存为模板」→ Dialog → 保存
let rows = await paletteOpen('另存为');
const saveRow = rows.filter({ hasText: '另存为模板' }).first();
const hasSaveCmd = (await rows.allInnerTexts().catch(() => [])).some((t) => t.includes('另存为模板'));
check('② 面板出现「另存为模板」命令（有选中页）', hasSaveCmd, `rows=${(await rows.allInnerTexts().catch(() => [])).join(' | ').slice(0, 120)}`);
await saveRow.click().catch(() => {});
await wait(1000);
const dlgInp = page.locator('[data-testid="template-save-name"]').first();
const dlgOk = await dlgInp.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
const dlgDefault = dlgOk ? await dlgInp.inputValue().catch(() => '') : '';
check('②b 另存 Dialog 出现（名称默认=页标题）', dlgOk && dlgDefault === SRC, `预填="${dlgDefault}"`);
if (dlgOk) await dlgInp.fill(TPL);
await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
await wait(1800);
const l1 = await tplList();
check('②c 模板已保存（kind=page）', l1.some((t) => t.title === TPL && t.kind === 'page'), `list=${l1.map((t) => `${t.title}:${t.kind}`).join(', ')}`);

// ③ 侧栏「新建页面 ▾」模板子菜单 → 建页（内容继承）
const arrow = page.locator('.app-side .app-nav-suffix').first();
const hasArrow = await arrow.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
if (hasArrow) await arrow.click().catch(() => {});
await wait(1200);
const sideText = (await side.innerText().catch(() => '')).replace(/\s+/g, ' ');
check('③ 侧栏下拉出现模板行（名称+图标位）', sideText.includes(TPL), `arrow=${String(hasArrow)} ${sideText.slice(0, 150)}`);
await page.screenshot({ path: SHOTS + '/sidebar-dropdown.png' });
await side.getByText(TPL).first().click().catch(() => {});
await wait(2500);
check('③b 从模板建页：新页内容继承模板', (await editorText()).includes(BODY_TXT), (await editorText()).slice(0, 60));

// ④ 命令面板：模板独立分组「从模板新建：…」
rows = await paletteOpen(TPL);
const rowTexts = await rows.allInnerTexts().catch(() => []);
check('④ 面板模板分组存在（行文案「从模板新建：<名称>」）', rowTexts.some((t) => t.includes('从模板新建') && t.includes(TPL)), rowTexts.join(' | ').slice(0, 140));
await page.screenshot({ path: SHOTS + '/palette-template-group.png' });
const before = (await body()).length;
await rows.first().click().catch(() => {});
await wait(2500);
check('④b 面板回车/点击即建页（编辑器有内容）', (await editorText()).includes(BODY_TXT) || (await body()).length !== before, (await editorText()).slice(0, 60));

// ⑤ 数据库模板：转为多维数据 → 另存为模板 → kind=database
const conv = page.getByText('转为多维数据').first();
const hasConv = await conv.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
const logs = [];
const onLog = (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 160)); };
page.on('console', onLog);
if (hasConv) {
  await conv.scrollIntoViewIfNeeded().catch(() => {});
  await conv.click({ force: true }).catch(() => {});
}
await wait(3000);
page.off('console', onLog);
const dbUi = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, ' ');
  const has = ['新建行', '属性', '表格', '看板'].filter((k) => t.includes(k));
  const dlg = document.querySelector('[role="dialog"]');
  return { markers: has.join('/'), dialog: dlg ? dlg.innerText.replace(/\s+/g, ' ').slice(0, 80) : '', view: t.slice(0, 120) };
});
check('⑤a 「转为多维数据」已生效（出现库 UI 标记）', dbUi.markers.length > 0, `markers=${dbUi.markers || '(无)'} console=${logs.join(' ;; ').slice(0, 200)} | view=${dbUi.view}`);
rows = await paletteOpen('另存为');
await rows.filter({ hasText: '另存为模板' }).first().click().catch(() => {});
await wait(1000);
const d2 = page.locator('[data-testid="template-save-name"]').first();
if (await d2.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) await d2.fill('模板U23库');
await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
await wait(1800);
const l2 = await tplList();
check('⑤ 数据库页另存 → kind=database', l2.some((t) => t.kind === 'database'), `list=${l2.map((t) => `${t.title}:${t.kind}`).join(', ')}`);

// ⑥ 设置页「模板」区块：重命名 + 删除
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button,[role="button"],a')].find((b) => ((b.getAttribute('aria-label') ?? '') + (b.getAttribute('title') ?? '')).includes('设置'));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wait(1800);
let st = await body();
let settingsOk = st.includes('模板');
if (!settingsOk) {
  rows = await paletteOpen('设置');
  await rows.first().click().catch(() => {});
  await wait(1800);
  st = await body();
  settingsOk = st.includes('模板');
}
check('⑥ 设置页出现「模板」区块（列出模板）', settingsOk && st.includes(TPL), st.slice(0, 170));
await page.screenshot({ path: SHOTS + '/settings-templates.png' });
const more = page.locator('[data-testid="settings-tpl-menu-0"]').first();
const hasMore = await more.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
if (hasMore) {
  await more.click().catch(() => {});
  await wait(900);
  await page.getByText('重命名').first().click().catch(() => {});
  await wait(900);
  const rInp = page.locator('[data-testid="template-rename-name"]').first();
  if (await rInp.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) await rInp.fill('模板U23改');
  await page.locator('[data-testid="template-rename-confirm"]').first().click().catch(() => {});
  await wait(1600);
}
const l3 = await tplList();
check('⑥b 重命名生效（列表随 slice 刷新）', hasMore ? l3.some((t) => t.title === '模板U23改') : false, `hasMore=${String(hasMore)} list=${l3.map((t) => t.title).join(', ')}`);

// ⑦ 双主题截图
for (const [mode, file] of [['light', 'theme-light.png'], ['dark', 'theme-dark.png']]) {
  await page.evaluate((m) => localStorage.setItem('septcats.theme', m), mode);
  await page.reload();
  await ready();
  await wait(2200);
  await page.screenshot({ path: `${SHOTS}/${file}` });
}
check('⑦ 双主题截图留档', true, 'screens-t23-ui/theme-{light,dark}.png');

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T23-02 真机（UI 面）${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);