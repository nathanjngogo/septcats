/* T79 真机探针：页面导出 Markdown（定稿=对齐 CB 交付）
 * 三段式：① UI 链（菜单→对话框预览恒开 D-6→取消=零落盘）② IPC confirm(dir) 显式目录落盘取证
 * （原生 showOpenDialog 不可 CDP 驱动；dir 显式=shared/pageExport.ts:15 契约能力）③ 子树层级。
 * R27 页名唯一化纪律内置。 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't79-e2e');
const UD = `${RUN}\\ud`;
const ROOT = join(RUN, 'data');
const EXP = join(RUN, 'export-target');
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

function walkMd(dir, acc, depth = 0) {
  if (depth > 5) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) walkMd(f, acc, depth + 1);
    else if (e.name.endsWith('.md')) acc.push(f);
  }
  return acc;
}

async function ipcPageId(page, title) {
  return page.evaluate(async (pt) => {
    const w = await window.septcats.workspaces.list({});
    const r = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id });
    const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
    const hit = arr.find((x) => x?.title === pt);
    return hit?.id ?? null;
  }, title);
}

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  // T79 事故根治：rootPath 夹具钉死（t60 先例）——绝不写真实数据根
  writeFileSync(
    `${UD}\\septcats.settings.json`,
    JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypted: false, relay: '' } }, null, 2),
    'utf8',
  );
  mkdirSync(EXP, { recursive: true });
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
    await page.keyboard.type('# 一级标题T79', { delay: 20 }); await page.keyboard.press('Enter'); await wait(200);
    await page.keyboard.type('- [ ] 待办T79', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(200);
    await page.keyboard.type('> 引用T79', { delay: 20 }); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await wait(200);
    await page.keyboard.type('/表格', { delay: 30 }); await wait(600);
    const hasTb = (await page.locator('[data-testid="slash-item-table"]').count()) > 0;
    if (hasTb) { await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click()); await wait(600); }
    await page.evaluate(() => document.querySelector('[data-testid^="block-table-cell-"]')?.focus());
    await wait(300);
    await page.keyboard.type('格A', { delay: 30 });
    await wait(400);
    const cellVal = await page.evaluate(() => document.querySelector('[data-testid^="block-table-cell-"]')?.value ?? 'NO_CELL');
    check('E1-c 单元格 DOM 值=格A（input 层）', String(cellVal).includes('格A'), String(cellVal));
    await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
    await wait(2500);
    await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
    await wait(2500);
    check('E1-a 全块型页建成（table 在场）', hasTb, `slashTable=${String(hasTb)}`);
    const pageId = await ipcPageId(page, PAGE_NAME);
    check('E1-b IPC 取到页 id', pageId != null, String(pageId));
    const ipcBlocks = await page.evaluate(async (pid) => { const r = await window.septcats.blocks.list({ pageId: pid }); return r.blocks.map((b) => ({ type: b.type, content: b.content })); }, pageId);
    const tbBlock = ipcBlocks.find((b) => b.type === 'table');
    const tbJson = JSON.stringify(tbBlock === undefined ? null : tbBlock.content);
    check('E1-d 真相层 blocks.list 表格 content 不降级（含 rows 与格A）', tbBlock !== undefined && tbJson.includes('rows') && tbJson.includes('格A'), tbJson.slice(0, 130));

    STEP = 'E2|UI 链+取消零落盘';
    await page.evaluate((pn) => {
      const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn));
      if (row != null) { const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 60, clientY: r.y + 8 })); }
    }, PAGE_NAME);
    await wait(600);
    const exItem = await page.locator('[data-testid="page-export-menu"]').count();
    check('E2-a 页面菜单含导出项', exItem === 1, String(exItem));
    await page.screenshot({ path: join(SHOTS, 'e2-menu.png') }).catch(() => {});
    await page.evaluate(() => document.querySelector('[data-testid="page-export-menu"]')?.click());
    await wait(900);
    const dlg = await page.evaluate(() => ({
      single: document.querySelector('[data-testid="page-export-single"]') != null,
      preview: (document.querySelector('[data-testid="page-export-preview"]')?.textContent ?? '').length,
      confirm: document.querySelector('[data-testid="page-export-confirm"]') != null,
    }));
    check('E2-b 导出对话框=预览恒开+确认（D-6）', dlg.confirm && dlg.preview > 3, JSON.stringify(dlg));
    await page.screenshot({ path: join(SHOTS, 'e2-dialog.png') }).catch(() => {});
    await page.evaluate(() => document.querySelector('[data-testid="page-export-cancel"]')?.click());
    await wait(700);
    check('E2-c 取消=零落盘', walkMd(EXP, []).length === 0, String(walkMd(EXP, []).length));

    STEP = 'E3|IPC dir 落盘取证';
    const expPosix = EXP.replace(/\\/g, '/');
    await page.evaluate(async (a) => window.septcats.pageExport.confirm({ pageId: a[0], scope: 'single', dir: a[1], confirm: true }), [pageId, expPosix]);
    await wait(1000);
    const mds = walkMd(EXP, []);
    check('E3-a 单页导出 md 落盘', mds.length >= 1, mds.join(',').slice(0, 160));
    if (mds.length >= 1) {
      var md = readFileSync(mds[0], 'utf8');
      const miss = [['标题', md.includes('# 一级标题T79')], ['待办', md.includes('待办T79')], ['引用', md.includes('引用T79')], ['表格含格A', md.includes('格A')]].filter((x) => !x[1]);
      check('E3-b md 内容钉（标题/待办/引用/代码/表格）', miss.length === 0, JSON.stringify(miss));
      writeFileSync(join(SHOTS, 'export-sample.md'), md);
    }
    const pv = await page.evaluate(async (a) => {
      const r = await window.septcats.pageExport.preview({ pageId: a[0], scope: 'single' });
      return JSON.stringify(r).slice(0, 160);
    }, [pageId]);
    check('E3-c preview 契约回显（只预览不落盘）', pv.includes('T79') && walkMd(EXP, []).length === mds.length, pv.slice(0, 120));

    STEP = 'E3-code|代码页';
    const CODE_NAME = `T79 代码页 ${TS}`;
    await newPageNamed(page, CODE_NAME);
    await page.locator('.pv-body .ProseMirror').first().click();
    await page.keyboard.type('```python', { delay: 20 }); await page.keyboard.press('Enter'); await wait(300);
    await page.keyboard.type('print("hi")', { delay: 20 }); await wait(400);
    await wait(3500);
    const codeId = await ipcPageId(page, CODE_NAME);
    const EXP3 = join(EXP, 'code'); mkdirSync(EXP3, { recursive: true });
    await page.evaluate(async (a) => window.septcats.pageExport.confirm({ pageId: a[0], scope: 'single', dir: a[1], confirm: true }), [codeId, EXP3.replace(/\\/g, '/')]);
    await wait(900);
    const md3 = walkMd(EXP3, []).map((f) => readFileSync(f, 'utf8')).join('');
    check('E3-d 代码页 fence+内容忠实导出', md3.includes('```') && md3.includes('print("hi")'), md3.slice(0, 120));
    const NL = String.fromCharCode(10);
    const fenceLang = md3.includes('```python');
    const pythonAsBodyLine1 = md3.includes('```' + NL + 'python');
    check('E3-d2 围栏 lang 忠实（```python 在场 + python 不作代码正文首行）', fenceLang === true && pythonAsBodyLine1 === false, JSON.stringify({ fenceLang, pythonAsBodyLine1, head: md3.slice(0, 60) }));
    check('E3-e 表格格A进表（D-1 方言钉）', (typeof md === 'string') && md.includes('格A'), (typeof md === 'string' ? ((md.split(NL).find((l) => l.includes('格A')) ?? 'no-line')) : 'md-undefined'));
    const tbLine = (typeof md === 'string' ? (md.split(NL).find((l) => l.includes('格A')) ?? '') : '');
    check('E3-e2 表格行成行（行首为 | 且列数 ≥3）', tbLine.trim().startsWith('|') === true && tbLine.split('|').length >= 4 && tbLine.includes('格A'), JSON.stringify({ line: tbLine.trim().slice(0, 80) }));

    STEP = 'E4|子树 scope';
    await page.evaluate((pn) => { const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn)); if (row != null) row.click(); }, PAGE_NAME);
    await wait(1000);
    await page.evaluate((pn) => {
      const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn));
      if (row != null) { const r = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.x + 60, clientY: r.y + 8 })); }
    }, PAGE_NAME);
    await wait(600);
    const subIdx = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menuitem"], .sc-menu__item, [class*="menu"] li, [class*="menu"] button')];
      const idx = items.findIndex((e) => (e.textContent ?? '').includes('子页面'));
      if (idx >= 0) items[idx].click();
      return idx;
    });
    await wait(1800);
    await page.evaluate((cn) => { const i = document.querySelector('.app-side input'); if (i != null && i.offsetWidth > 0) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, cn); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } }, CHILD_NAME);
    await wait(1600);
    const EXP2 = join(EXP, 'sub');
    mkdirSync(EXP2, { recursive: true });
    await page.evaluate(async (a) => window.septcats.pageExport.confirm({ pageId: a[0], scope: 'subtree', dir: a[1], confirm: true }), [pageId, EXP2.replace(/\\/g, '/')]);
    await wait(1000);
    const mds2 = walkMd(EXP2, []);
    check('E4-a 子树导出 ≥2 md 含层级', mds2.length >= 2 && mds2.some((f) => f.includes(CHILD_NAME)), mds2.map((f) => f.replace(EXP2, '')).join(',').slice(0, 180));

    STEP = 'E5|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('E5-1 应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't79-results.json'), JSON.stringify({ task: 'T79-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T79-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 15) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 15（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exitCode = fail === 0 && assertions.length >= 15 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
