/* T79 真机探针草稿：页面导出 Markdown——建全块型页→菜单导出→落盘验 md/附件→（scope 子树 zip）
 * testid 契约按施工单；与 CB 交付对齐后定稿。R27 页名唯一化纪律内置。 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't79-e2e');
const UD = `${RUN}\\ud`;
const OUT = join(RUN, 'export-out');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t79');
const PORT = 9239;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const TS = Date.now().toString(36);
const PAGE_NAME = `T79 导出页 ${TS}`;
const CHILD_NAME = `T79 子页 ${TS}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(800);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ }
  }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { child, browser, page };
}

async function newPageNamed(page, name) {
  await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
  await wait(900);
  await page.evaluate((pn) => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, pn); i.dispatchEvent(new Event('input', { bubbles: true })); } }, name);
  await wait(200);
  await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  await wait(1500);
}

async function gotoPage(page, name) {
  await page.evaluate((pn) => { const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn)); if (row != null) row.click(); }, name);
  await wait(1200);
}

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const rootBefore = rootMtime();
  let child = null; let browser = null; let page = null;
  try {
    ({ child, browser, page } = await launch());
    const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
    if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }

    STEP = 'E1|建全块型页';
    await newPageNamed(page, PAGE_NAME);
    const body = page.locator('.pv-body .ProseMirror').first();
    await body.click();
    // 标题/待办/引用/代码(python)/表格 —— 经输入规则与斜杠
    await page.keyboard.type('# 一级标题T79', { delay: 20 }); await page.keyboard.press('Enter'); await wait(250);
    await page.keyboard.type('- [ ] 待办T79', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(250);
    await page.keyboard.type('> 引用T79', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(250);
    await page.keyboard.type('```python', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.type('print("hi")', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(300);
    await page.keyboard.type('/表格', { delay: 30 }); await wait(600);
    const hasTb = (await page.locator('[data-testid="slash-item-table"]').count()) > 0;
    if (hasTb) { await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click()); await wait(600); }
    // 表格首格填字
    await page.evaluate(() => { const c = document.querySelector('[data-testid^="block-table-cell-"]'); const r = c?.getBoundingClientRect(); if (c != null && r != null) { c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); } });
    await wait(300);
    await page.keyboard.type('格A', { delay: 20 });
    await wait(500);
    await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
    await wait(2500);
    check('E1-a 全块型页建成（含 table 在场）', hasTb, `slashTable=${String(hasTb)}`);

    STEP = 'E2|导出菜单';
    // 页面级菜单入口（testid 按 CB 交付校准；先试 right-click side-node）
    const menu = await page.evaluate((pn) => {
      const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn));
      if (row == null) return 'NO_ROW';
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 60, clientY: r.y + 8 }));
      return 'fired';
    }, PAGE_NAME);
    await wait(600);
    const exItem = await page.locator('[data-testid="page-export-menu"]').count();
    check('E2-a 页面菜单含导出项', menu === 'fired' && exItem === 1, `${menu} item=${String(exItem)}`);
    await page.screenshot({ path: join(SHOTS, 'e2-menu.png') }).catch(() => {});

    // 点导出 → scope 对话框（本页有子页才弹 scope；无子页直接确认框）
    await page.evaluate(() => document.querySelector('[data-testid="page-export-menu"]')?.click());
    await wait(700);
    const dlg = await page.evaluate(() => ({
      scope: document.querySelector('[data-testid="page-export-scope"]') != null,
      single: document.querySelector('[data-testid="page-export-single"]') != null,
      confirm: document.querySelector('[data-testid="page-export-confirm"]') != null,
    }));
    check('E2-b 导出对话框出现（single/confirm 路径）', dlg.single || dlg.scope || dlg.confirm, JSON.stringify(dlg));
    await page.screenshot({ path: join(SHOTS, 'e2-dialog.png') }).catch(() => {});
    // 选「仅本页」（或 confirm 直落）
    await page.evaluate(() => { document.querySelector('[data-testid="page-export-single"]')?.click(); });
    await wait(400);
    // 导出目录怎么指定=CB 交付口径（对话框内路径输入 or 系统目录选择——探针先按 settings rootPath 导出默认目录找）
    await page.evaluate(() => document.querySelector('[data-testid="page-export-confirm"]')?.click());
    await wait(2500);
    const toast = await page.evaluate(() => document.querySelector('[data-testid="page-export-toast"]')?.textContent ?? '');
    check('E2-c 导出完成 toast', toast.length > 0, toast.slice(0, 80));
    // 落盘取证：UD 夹具 rootPath 下找 <title>.md
    const found = [];
    const walk = (d, depth) => { if (depth > 4) return; for (const e of readdirSync(d, { withFileTypes: true })) { const f = join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else if (e.name.includes(TS)) found.push(f); } };
    walk(UD, 0); walk(RUN, 0); // 导出目录落在 UD 还是 RUN 取决于 CB 对话框实现——两处都找
    const mdPath = found.find((f) => f.endsWith('.md')) ?? null;
    check('E2-d 导出 md 落盘（夹具内可寻）', mdPath != null, found.join(',').slice(0, 160) || '未找到');
    if (mdPath != null) {
      const md = readFileSync(mdPath, 'utf8');
      const marks = ['# 一级标题T79', '待办T79', '引用T79', '```python', 'print("hi")', '格A'].map((k) => [k, md.includes(k)]);
      const allIn = marks.every((x) => x[1]);
      check('E2-e md 内容含标题/待办/引用/代码/表格', allIn, JSON.stringify(marks.filter((x) => !x[1])));
      writeFileSync(join(SHOTS, 'export-sample.md'), md);
    }
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't79-results.json'), JSON.stringify({ task: 'T79-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T79-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 5) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 5（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exitCode = fail === 0 && assertions.length >= 5 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
