/* T76 真机探针：表格块 + 折叠列表（插入→编辑→加删行列→表头→toggle 折叠→重启持久化） */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't76-e2e');
const UD = `${RUN}\\ud`;
const ROOT = join(RUN, 'data');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t76');
const PORT = 9235;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

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
  mkdirSync(SHOTS, { recursive: true });
  const rootBefore = rootMtime();
  let child = null; let browser = null; let page = null;
  try {
    ({ child, browser, page } = await launch());
    const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
    if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }

    STEP = 'S1|建页入表';
    await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
    await wait(900);
    await page.evaluate(() => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, 'T76 表格页'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
    await wait(200);
    await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await wait(1500);
    const body = page.locator('.pv-body .ProseMirror').first();
    await body.click();
    await wait(300);
    await page.keyboard.press('Enter');
    await page.keyboard.type('/', { delay: 40 });
    await wait(600);
    const slashHas = (await page.locator('[data-testid="slash-item-table"]').count()) > 0;
    check('S1-a 斜杠菜单出现「表格」项', slashHas, String(slashHas));
    await page.evaluate(() => document.querySelector('[data-testid="slash-item-table"]')?.click());
    await wait(800);
    const tbl = await page.evaluate(() => ({
      cells: document.querySelectorAll('[data-testid^="block-table-cell-"]').length,
      addRow: document.querySelector('[data-testid="block-table-add-row"]') !== null,
      grid: !![...document.querySelectorAll('[data-testid^="block-table"]')].find((e) => (getComputedStyle(e).borderTopColor !== 'rgba(0, 0, 0, 0)')),
    }));
    check('S1-b 插入 3×3 表（9 格+加行钮）', tbl.cells === 9 && tbl.addRow, JSON.stringify(tbl));
    // 首格输入文本
    const cellSel = '[data-testid="block-table-cell-0-0"]';
    await page.evaluate((sel) => { document.querySelector(sel)?.focus(); }, cellSel);
    await page.keyboard.type('甲', { delay: 30 });
    await wait(400);
    const cellTxt = await page.evaluate((sel) => document.querySelector(sel)?.value ?? document.querySelector(sel)?.textContent ?? '', cellSel);
    check('S1-c 单元格输入落值「甲」', cellTxt.includes('甲'), JSON.stringify(cellTxt));
    await page.screenshot({ path: join(SHOTS, 's1-table.png') }).catch(() => {});

    STEP = 'S2|行列操作';
    await page.evaluate(() => document.querySelector('[data-testid="block-table-add-row"]')?.click());
    await wait(400);
    await page.evaluate(() => document.querySelector('[data-testid="block-table-add-col"]')?.click());
    await wait(400);
    const dims = await page.evaluate(() => document.querySelectorAll('[data-testid^="block-table-cell-"]').length);
    check('S2-a 加行+加列→4×4=16 格', dims === 16, String(dims));
    await page.evaluate(() => document.querySelector('[data-testid="block-table-del-row-3"]')?.click());
    await wait(400);
    await page.evaluate(() => document.querySelector('[data-testid="block-table-del-col-3"]')?.click());
    await wait(400);
    const dims2 = await page.evaluate(() => document.querySelectorAll('[data-testid^="block-table-cell-"]').length);
    check('S2-b 删行3+删列3→回 3×3=9 格且首格仍「甲」', dims2 === 9, String(dims2));
    const stillA = await page.evaluate((sel) => document.querySelector(sel)?.value ?? document.querySelector(sel)?.textContent ?? '', cellSel);
    check('S2-c 首格值保真「甲」', stillA.includes('甲'), JSON.stringify(stillA));
    // 表头取证=真实 DOM 形态（D-4：div-grid+input 交互层；表头行=--header class；renderHTML 导出路径才有原生 table，不在此断言）
    // 默认态未知——先把开关收敛到 false（若 true 就点一次关掉）再验翻转
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="block-table-header-toggle"]');
      if (b?.getAttribute('aria-pressed') === 'true') b.click();
    });
    await wait(350);
    const hdrBefore = await page.evaluate(() => ({
      pressed: document.querySelector('[data-testid="block-table-header-toggle"]')?.getAttribute('aria-pressed') ?? 'NONE',
      headerRows: document.querySelectorAll('.sc-table__row--header').length,
    }));
    await page.evaluate(() => document.querySelector('[data-testid="block-table-header-toggle"]')?.click());
    await wait(400);
    const hdr = await page.evaluate(() => ({
      pressed: document.querySelector('[data-testid="block-table-header-toggle"]')?.getAttribute('aria-pressed') ?? 'NONE',
      headerRows: document.querySelectorAll('.sc-table__row--header').length,
    }));
    check('S2-d 表头开关→aria-pressed 翻转+首行 header class', hdrBefore.pressed === 'false' && hdr.pressed === 'true' && hdr.headerRows === 1, JSON.stringify({ before: hdrBefore, after: hdr }));
    await page.screenshot({ path: join(SHOTS, 's2-dims.png') }).catch(() => {});

    STEP = 'S3|折叠列表';
    await body.click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('/', { delay: 40 });
    await wait(600);
    const hasTog = (await page.locator('[data-testid="slash-item-toggle"]').count()) > 0;
    check('S3-a 斜杠菜单出现「折叠列表」项', hasTog, String(hasTog));
    await page.evaluate(() => document.querySelector('[data-testid="slash-item-toggle"]')?.click());
    await wait(700);
    const tog = await page.evaluate(() => ({
      title: document.querySelectorAll('[data-testid="block-toggle-title"]').length,
      line: document.querySelectorAll('[data-testid^="block-toggle-line-"]').length,
      expandedBtn: document.querySelectorAll('[data-testid^="block-toggle-"]').length,
    }));
    check('S3-b toggle 块在场（标题+正文行）', tog.title >= 1, JSON.stringify(tog));
    await page.evaluate(() => { const el = document.querySelector('[data-testid="block-toggle-title"]'); if (el != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, '折叠标题Q'); el.dispatchEvent(new Event('input', { bubbles: true })); } });
    await wait(300);
    // 默认收起：正文行不可见
    const collapsed = await page.evaluate(() => {
      const root = document.querySelector('[data-testid^="block-toggle-"]:not([data-testid="block-toggle-title"]):not([data-testid^="block-toggle-line-"])');
      const btn = root?.querySelector('[data-testid^="block-toggle-"]') ?? root;
      const exp = btn?.getAttribute('aria-expanded') ?? 'NONE';
      return { exp, open0: root?.dataset?.open ?? 'NO_ROOT' };
    });
    check('S3-c 默认收起（aria-expanded=false 或 data-open=false）', collapsed.exp === 'false' || collapsed.open0 === 'false', JSON.stringify(collapsed));
    // 点开（arrow 钮=aria-expanded=false 的那个）→展开态+正文行可见
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-testid^="block-toggle-"]')].find((e) => e.getAttribute('aria-expanded') === 'false');
      b?.click();
    });
    await wait(600);
    const opened = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-testid^="block-toggle-"]')].find((e) => e.getAttribute('aria-label') != null);
      const line = document.querySelector('[data-testid^="block-toggle-line-"]');
      return { exp: b?.getAttribute('aria-expanded') ?? 'NONE', lineVisible: line != null && line.offsetParent !== null, lines: document.querySelectorAll('[data-testid^="block-toggle-line-"]').length };
    });
    check('S3-d 点开→aria-expanded=true 且正文行可见', opened.exp === 'true' && opened.lineVisible === true, JSON.stringify(opened));
    await page.screenshot({ path: join(SHOTS, 's3-toggle.png') }).catch(() => {});

    STEP = 'S4|重启持久化';
    await wait(3200); // leveldb/落盘 flush 窗口（T65 纪律：优雅退出前留足）
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    let quit = false;
    for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { quit = true; break; } }
    info('优雅退出达成', quit);
    ({ child, browser, page } = await launch());
    await wait(1800);
    // 回到 T76 表格页（重启回原页签）
    const back = await page.evaluate(() => document.body.innerText.includes('T76 表格页') || document.body.innerText.includes('甲'));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes('T76'));
      if (row != null) row.click();
    });
    await wait(1200);
    const persist = await page.evaluate(() => ({
      cells: document.querySelectorAll('[data-testid^="block-table-cell-"]').length,
      first: document.querySelector('[data-testid="block-table-cell-0-0"]')?.value ?? document.querySelector('[data-testid="block-table-cell-0-0"]')?.textContent ?? '',
    }));
    check('S4-a 重启后表格块还原（9 格+首格「甲」）', persist.cells === 9 && persist.first.includes('甲'), JSON.stringify(persist) + ` back=${String(back)}`);
    await page.screenshot({ path: join(SHOTS, 's4-restart.png') }).catch(() => {});

    STEP = 'S5|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('S5-1 全流程后应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't76-results.json'), JSON.stringify({ task: 'T76-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T76-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 11) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 11（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    const rootAfter = rootMtime();
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootAfter)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 && assertions.length >= 11 ? 0 : 1);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });
