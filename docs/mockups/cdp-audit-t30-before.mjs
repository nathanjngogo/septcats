/* TASK-T30-01 修复前真机复现：三症状证据采集（截图 + getBoundingClientRect/elementFromPoint 实测）。
 * 独立夹具根（--user-data-dir + rootPath），不触碰默认根/真实数据。
 * 产物：docs/mockups/screens-t30/before-*.png + 控制台 JSON 数值。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t30-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t30-data';
const PORT = 9388;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t30';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(UD, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
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
const out = {};

// ---------- 症状②前置：建一页 + 打 40 段长内容 ----------
await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('T30长页');
await input.press('Enter');
await wait(2000);
const editorBody = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
await editorBody.click();
for (let i = 0; i < 40; i++) {
  await page.keyboard.type(`T30 第 ${String(i + 1)} 段内容用于撑长页面验证窗口级滚动。`);
  await page.keyboard.press('Enter');
}
await wait(1200);
await shot('before-0-editor-longpage');

// ---------- 症状②：窗口级滚动 + 侧栏随滚 ----------
out.winScroll = await page.evaluate(() => {
  const se = document.scrollingElement;
  return { scrollHeight: se.scrollHeight, clientHeight: se.clientHeight, rootH: document.getElementById('root').getBoundingClientRect().height };
});
out.sideTopBefore = await page.evaluate(() => document.querySelector('.app-side').getBoundingClientRect().top);
// 主区滚到底（.sc-shell__main 是内部滚动容器）
out.mainScrollAfter = await page.evaluate(() => {
  const main = document.querySelector('.sc-shell__main');
  const before = document.querySelector('.app-side').getBoundingClientRect().top;
  main.scrollTop = main.scrollHeight;
  const after = document.querySelector('.app-side').getBoundingClientRect().top;
  return { mainScrollTop: main.scrollTop, sideTopBefore: before, sideTopAfter: after };
});
// 窗口级滚动模拟（wheel 到底）
await page.mouse.move(800, 400);
await page.mouse.wheel(0, 3000);
await wait(400);
out.sideTopAfterWindowWheel = await page.evaluate(() => document.querySelector('.app-side').getBoundingClientRect().top);
out.winScrollY = await page.evaluate(() => window.scrollY);
await shot('before-1-window-scroll');
await page.evaluate(() => window.scrollTo(0, 0));
await wait(300);

// ---------- 症状①：收起侧栏 ----------
await page.getByRole('button', { name: /收起侧栏|Collapse/ }).click();
await wait(400);
out.collapsed = await page.evaluate(() => {
  const sb = document.querySelector('.sc-shell__sidebar');
  const aside = document.querySelector('.app-side');
  const main = document.querySelector('.sc-shell__main');
  return {
    sidebarW: sb.getBoundingClientRect().width,
    appSideVisible: aside !== null && aside.getClientRects().length > 0 && getComputedStyle(aside).visibility !== 'hidden',
    mainW: main.getBoundingClientRect().width,
    winW: window.innerWidth,
    shellClass: document.querySelector('.sc-shell').className,
  };
});
await shot('before-2-collapsed');
await page.getByRole('button', { name: /展开侧栏|Expand/ }).click();
await wait(300);

// ---------- 症状③：转为数据库 → 建记录 → 编辑单元格，采样遮挡 ----------
await page.getByRole('button', { name: /转为数据库|Convert to Database/ }).click();
await wait(2000);
out.dbEmpty = await page.evaluate(() => document.querySelector('.dbpage')?.innerText.slice(0, 120) ?? null);
await shot('before-3-db-empty');
// 建 25 条记录
for (let i = 0; i < 25; i++) {
  const btn = page.getByRole('button', { name: /新建记录|New Record/ }).first();
  try { await btn.click({ timeout: 3000 }); } catch { await page.evaluate(() => { const b = [...document.querySelectorAll('.sc-dbgrid__foot button')].find((x) => x.textContent.includes('新建记录')); if (b) b.click(); }); }
  await wait(220);
}
await wait(1200);
await shot('before-4-db-25rows');
out.dbLayout = await page.evaluate(() => {
  const main = document.querySelector('.sc-shell__main');
  const grid = document.querySelector('.sc-dbgrid__body');
  const dbpage = document.querySelector('.dbpage');
  const se = document.scrollingElement;
  return {
    winScrollH: se.scrollHeight, winClientH: se.clientHeight,
    mainRect: main.getBoundingClientRect().toJSON(),
    gridRect: grid ? grid.getBoundingClientRect().toJSON() : null,
    dbpageRect: dbpage.getBoundingClientRect().toJSON(),
  };
});

// 点击第一行标题单元格进入编辑，再网格采样主区遮挡比例
const titleCell = page.locator('.sc-dbcell--title').first();
await titleCell.click();
await wait(500);
out.cellEdit = await page.evaluate(() => {
  const editing = document.querySelector('.sc-dbcell--editing');
  const inp = document.querySelector('.sc-dbc-input');
  return { editing: editing !== null, input: inp !== null };
});
// 网格采样：主区范围内 elementFromPoint，统计被非主区/浮层元素覆盖比例
out.coverSample = await page.evaluate(() => {
  const main = document.querySelector('.sc-shell__main');
  const r = main.getBoundingClientRect();
  const cols = 10, rows = 8;
  const hits = {};
  let covered = 0, total = 0;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = r.left + ((ix + 0.5) * r.width) / cols;
      const y = r.top + ((iy + 0.5) * r.height) / rows;
      const el = document.elementFromPoint(x, y);
      total++;
      if (el === null) { covered++; hits['(null)'] = (hits['(null)'] ?? 0) + 1; continue; }
      const key = el.closest('.sc-shell__main') ? (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName) : `OUT:${el.className?.toString().split(' ')[0] ?? el.tagName}`;
      if (!el.closest('.sc-shell__main') || (el.className && typeof el.className === 'string' && /overlay|dialog|modal|palette/.test(el.className))) covered++;
      hits[key] = (hits[key] ?? 0) + 1;
    }
  }
  return { covered, total, hits };
});
await shot('before-5-db-celledit');
// Esc 是否可退出编辑
await page.keyboard.press('Escape');
await wait(400);
out.afterEsc = await page.evaluate(() => ({ editing: document.querySelector('.sc-dbcell--editing') !== null }));
await shot('before-6-db-after-esc');

console.log('=== T30 BEFORE EVIDENCE ===');
console.log(JSON.stringify(out, null, 2));
killAll();
