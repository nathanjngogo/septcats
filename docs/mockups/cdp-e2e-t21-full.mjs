/* T21-02 真机全链路（PM 验收）：侧栏真树 → 建页 → 重命名 → 输入 → 重载仍在 → 搜索跳转
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t22-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t22-data';
const PORT = 9371;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t21';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 190) : ''}`); };

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
    if (await page.evaluate(() => typeof window.septcats?.blocks?.commit === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
};
await ready();
const side = page.locator('.app-side');
const editorText = () => page.evaluate(() => document.querySelector('.pv-body .ProseMirror')?.innerText ?? '');
const TITLE = 'T21 全链路靶页';
const BODY = '全链路靶文甲';

// ① 侧栏真树：建页（新页会立刻进入标题编辑态 → 标题在 input 里，innerText 读不到）
const newRow = side.getByText('新建页面').first();
await newRow.click();
const createdInput = side.locator('input').first();
const createdOk = await createdInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
const createdVal = createdOk ? await createdInput.inputValue().catch(() => '') : '';
check(
  '侧栏「新建页面」→ 真树出现新页行（自动进标题编辑态，默认「未命名」）',
  createdOk && createdVal.length > 0,
  `input=${String(createdOk)} value="${createdVal}"`,
);

// ② 双击行标题重命名
const row = side.getByText('未命名').first();
await row.dblclick().catch(() => {});
const input = side.locator('input').first();
const hasInput = await input.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
if (hasInput) {
  await input.fill(TITLE);
  await input.press('Enter');
  await new Promise((r) => setTimeout(r, 1200));
}
const treeText2 = (await side.innerText().catch(() => '')).replace(/\s+/g, ' ');
check('双击重命名 → 侧栏显示新标题', treeText2.includes(TITLE), `input=${String(hasInput)} ${treeText2.slice(0, 140)}`);

// ③ 编辑器输入 → 落库
await page.locator('.pv-body .ProseMirror p').first().click();
await page.keyboard.type(BODY, { delay: 20 });
await new Promise((r) => setTimeout(r, 1500)); // EditSession 300ms 防抖 + IPC + 落库
const typed = (await editorText()).includes(BODY);
check('选中页编辑器可输入（真实页内容）', typed, (await editorText()).slice(0, 80));
await page.screenshot({ path: SHOTS + '/before-reload.png' });

// ④ 重载 → 侧栏仍有该页 + 内容仍在
await page.reload();
await ready();
await new Promise((r) => setTimeout(r, 2500)); // 等 load()/ensureSelection + blocks:list
const treeText3 = (await side.innerText().catch(() => '')).replace(/\s+/g, ' ');
check('重载后侧栏仍有该页（真树来自库）', treeText3.includes(TITLE), treeText3.slice(0, 140));
const bodyAfter = await editorText();
check('重载后编辑器显示输入内容（跨进程真落库）', bodyAfter.includes(BODY), bodyAfter.slice(0, 90));
await page.screenshot({ path: SHOTS + '/after-reload.png' });

// ⑤ 搜索跳转：面板输入标题 → 点结果 → 回到该页
await page.keyboard.press('Control+k');
const pin = page.locator('[data-testid="palette-panel"] input').first();
await pin.waitFor({ state: 'visible', timeout: 5000 });
await pin.type('全链路靶', { delay: 25 });
await new Promise((r) => setTimeout(r, 1200));
const hitRows = page.locator('.palette-list [role="option"]');
const hitCount = await hitRows.count().catch(() => 0);
const hitTexts = (await hitRows.allInnerTexts().catch(() => [])).filter((t) => !t.includes('在搜索结果页打开'));
check('面板搜索命中该页（跳转前置）', hitTexts.some((t) => t.includes(TITLE) || t.includes('全链路靶')), `rows=${hitCount} ${hitTexts.join(' | ').slice(0, 120)}`);
if (hitTexts.length > 0) {
  await hitRows.first().click();
  await new Promise((r) => setTimeout(r, 1500));
}
const paletteClosed = (await page.locator('[data-testid="palette-panel"]').count()) === 0;
const afterJump = await editorText();
check('点命中 → 面板关闭且回到该页内容', paletteClosed && afterJump.includes(BODY), `closed=${String(paletteClosed)} ${afterJump.slice(0, 70)}`);

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await page.screenshot({ path: SHOTS + '/after-jump.png' });
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T21-02 真机全链路 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);