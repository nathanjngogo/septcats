/* TASK-T30-01 修复后真机验收：三症状逐条断言（§2 可量化验收 + 截图）。
 * 直接以 electron . 跑 freshly-built out/（ensure-abi electron 已由 build 前置）；
 * 独立夹具根（--user-data-dir + rootPath），不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APPDIR = 'E:/Hermes Agent工作空间/Septcats/apps/desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t30a-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t30a-data';
const PORT = 9390;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t30';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
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
const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 220) : ''}`); };

// ---------- 长页准备（40 段） ----------
await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('T30验收长页');
await input.press('Enter');
await wait(2000);
const editorBody = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
await editorBody.click();
for (let i = 0; i < 40; i++) {
  await page.keyboard.type(`T30 验收第 ${String(i + 1)} 段内容，用于验证滚动只在内部容器。`);
  await page.keyboard.press('Enter');
}
await wait(1200);

// ---------- ② 窗口不滚动 + 侧栏不随滚（长页；编辑器页的内部滚动容器是 .pv-root） ----------
const longPage = await page.evaluate(() => {
  const se = document.scrollingElement;
  const scroller = ['.pv-root', '.sc-shell__main', '.dbpage']
    .map((sel) => document.querySelector(sel))
    .find((el) => el !== null && el.scrollHeight > el.clientHeight);
  const sideTopBefore = document.querySelector('.app-side').getBoundingClientRect().top;
  const main = scroller ?? document.querySelector('.sc-shell__main');
  main.scrollTop = main.scrollHeight;
  const sideTopAfter = document.querySelector('.app-side').getBoundingClientRect().top;
  return {
    scrollerClass: scroller === null ? '(none)' : scroller.className.split(' ')[0],
    winScrollH: se.scrollHeight, winClientH: se.clientHeight,
    mainScrollTop: main.scrollTop,
    sideTopBefore, sideTopAfter,
    sideTopDelta: Math.abs(sideTopAfter - sideTopBefore),
  };
});
check('② 窗口不滚动：scrollingElement.scrollHeight <= clientHeight+1（长页）',
  longPage.winScrollH <= longPage.winClientH + 1, JSON.stringify({ h: longPage.winScrollH, c: longPage.winClientH }));
check('② 主区可滚：内部滚动容器 scrollTop > 0（长页）', longPage.mainScrollTop > 0,
  `scroller=${longPage.scrollerClass} scrollTop=${String(longPage.mainScrollTop)}`);
check('② 侧栏不随滚：主区滚到底后 .app-side top 不变（±1px）', longPage.sideTopDelta <= 1,
  `before=${String(longPage.sideTopBefore)} after=${String(longPage.sideTopAfter)}`);
await shot('after-1-longpage-scrolled');
await page.evaluate(() => { const el = document.querySelector('.sc-shell__main'); if (el !== null) el.scrollTop = 0; });

// ---------- ① 折叠完全收起 ----------
await page.getByRole('button', { name: /收起侧栏|Collapse/ }).click();
await wait(400);
const collapsed = await page.evaluate(() => {
  const sb = document.querySelector('.sc-shell__sidebar');
  const aside = document.querySelector('.app-side');
  const main = document.querySelector('.sc-shell__main');
  const style = getComputedStyle(sb);
  return {
    sidebarW: sb.getBoundingClientRect().width,
    display: style.display,
    appSideVisible: aside !== null && aside.getClientRects().length > 0,
    mainW: main.getBoundingClientRect().width,
    winW: window.innerWidth,
  };
});
check('① 折叠态 .sc-shell__sidebar width===0', collapsed.sidebarW === 0, `width=${String(collapsed.sidebarW)} display=${collapsed.display}`);
check('① 折叠态 .app-side 不可见', !collapsed.appSideVisible, '');
check('① 主区占满：main 宽 ≈ 窗口宽', Math.abs(collapsed.mainW - collapsed.winW) <= 1, `main=${String(collapsed.mainW)} win=${String(collapsed.winW)}`);
await shot('after-2-collapsed');
await page.getByRole('button', { name: /展开侧栏|Expand/ }).click();
await wait(400);
const expandedW = await page.evaluate(() => document.querySelector('.sc-shell__sidebar').getBoundingClientRect().width);
check('① 再点按钮可展开（恢复宽度>0）', expandedW > 100, `width=${String(expandedW)}`);

// ---------- ③ 转库：小视口 + DB 页 + 单元格编辑 ----------
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1184, height: 560, deviceScaleFactor: 0, mobile: false });
await wait(600);
await page.getByRole('button', { name: /转为多维数据|Convert to Database/ }).click();
await wait(2000);
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建记录')); if (b) b.click(); });
  await wait(200);
}
await wait(1000);
const dbSmall = await page.evaluate(() => {
  const se = document.scrollingElement;
  const main = document.querySelector('.sc-shell__main');
  const r = main.getBoundingClientRect();
  let nulls = 0; const total = 100;
  for (let iy = 0; iy < 10; iy++) for (let ix = 0; ix < 10; ix++) {
    const x = r.left + ((ix + 0.5) * r.width) / 10;
    const y = r.top + ((iy + 0.5) * r.height) / 10;
    if (document.elementFromPoint(x, y) === null) nulls++;
  }
  return { winScrollH: se.scrollHeight, winClientH: se.clientHeight, mainBottom: r.bottom, viewportH: se.clientHeight, samplesOutside: `${String(nulls)}/${String(total)}` };
});
check('③ 小视口(560px) DB 页窗口不滚动', dbSmall.winScrollH <= dbSmall.winClientH + 1, JSON.stringify({ h: dbSmall.winScrollH, c: dbSmall.winClientH }));
check('③ 小视口 DB 页主区完整落在视口内（elementFromPoint 无 null 采样）', dbSmall.samplesOutside === '0/100', dbSmall.samplesOutside);
await shot('after-3-db-smallvp');
await cdp.send('Emulation.clearDeviceMetricsOverride');
await wait(600);

// 单元格编辑：标题格**双击**进改名（TitleCell 契约），编辑器须在主区内（无半屏遮挡面板）；Esc 取消
const cell = page.locator('.sc-dbcell--title').first();
await cell.dblclick();
await wait(400);
const editState = await page.evaluate(() => {
  const inp = document.querySelector('.sc-dbc-input[aria-label="编辑标题"], .sc-dbc-input');
  const r = inp?.getBoundingClientRect();
  const main = document.querySelector('.sc-shell__main').getBoundingClientRect();
  return {
    input: inp !== null,
    withinMain: r !== undefined && r.top >= main.top - 1 && r.bottom <= main.bottom + 1,
    rect: r === undefined ? null : { top: r.top, bottom: r.bottom },
  };
});
check('③ 转库后可进入单元格编辑且编辑器在主区内（无半屏遮挡面板）', editState.input && editState.withinMain, JSON.stringify(editState));
await shot('after-4-db-celledit');
await page.keyboard.press('Escape');
await wait(300);
const afterEsc = await page.evaluate(() => ({ editing: document.querySelector('.sc-dbc-input') !== null }));
check('③ Esc 可退出单元格编辑，主区恢复交互', !afterEsc.editing, '');
await shot('after-5-final');

const fail = results.filter((r) => !r.ok).length;
console.log(`=== T30 AFTER: ${String(results.length - fail)}/${String(results.length)} PASS ===`);
killAll();
process.exit(fail === 0 ? 0 : 1);
