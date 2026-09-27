/* cdp-e2e-t86-01.mjs —— 侧栏「批量删除」真机探针（TASK-T86-01，老板 09-27 令第 5 条）。
 *
 * 靶子：默认打包产物 win-unpacked（交付物终验口径），SEPTCATS_APP_BIN 可切。
 * 链：B1 入口行在位 → B2 多选操作条（计数 0）→ B3 用 UI「新建页面」造 3 页 →
 *     B4 行点击/勾选框两种勾选方式（计数 2）→ B5 「删除所选」→ 二次确认弹层（含项数）→
 *     B6 确认：逐页入回收站 + **一条**汇总 toast（data-testid=toast-bulk-delete）+ 计数归零 →
 *     B7 真实档案根 mtime 零触碰。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <6 = FATAL（静默蒸发守卫）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't86-batch');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const SHOTS = join(SCRIPT_DIR, 'screens-t86');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9282;
const APP_BIN = process.env['SEPTCATS_APP_BIN'] ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const PACKAGED = APP_BIN.endsWith('Septcats.exe');
const ELECTRON = PACKAGED ? APP_BIN : join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARGS = PACKAGED ? [] : ['.'];

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  try {
    const out = execSync('wmic process where "name=\'Septcats.exe\' or name=\'electron.exe\'" get processid,commandline /format:list', { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) {
        const m = line.match(/^ProcessId=(\d+)/);
        if (m !== null && cur.includes('t86-batch')) killTree(Number(m[1]));
        cur = '';
      }
    }
  } catch { /* wmic 缺失 */ }
}

const assertions = [];
let STEP = '-';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${STEP}] ${name} :: ${String(raw).slice(0, 200)}`);
}

async function launch() {
  killStaleApp();
  await wait(800);
  const child = spawn(ELECTRON, [...APP_ARGS, `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 45; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForSelector('.app-side', { timeout: 40000 });
  await wait(2500);
  return { child, browser, page };
}

/** 侧栏页行 id 列表（data-testid=side-node-<id>）。 */
async function rowIds(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="side-node-"]')].map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('side-node-', ''),
    ),
  );
}
async function bulkCount(page) {
  return page.evaluate(() => document.querySelector('[data-testid="side-bulk-count"]')?.textContent ?? 'NO-BAR');
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/'), theme: 'light', locale: 'zh-CN' }));
  const stamp0 = realRootStamp();
  const { child, browser, page } = await launch();
  try {
    // 首次启动：建工作区（若向导在）
    if ((await page.locator('[data-testid="ws-create"]').count()) > 0) {
      await page.locator('[data-testid="ws-create"]').first().click();
      await wait(2500);
    }

    // ===== B1 造 3 页（真实 UI：新建页面行；**先造页再进多选**，Esc 会退出多选）=====
    STEP = 'B1|造页';
    for (let i = 0; i < 3; i += 1) {
      await page.locator('[data-testid="side-new-page"]').click();
      await wait(1400);
    }
    await page.keyboard.press('Escape').catch(() => undefined); // 收掉行内重命名（此时尚未进多选）
    await wait(600);
    const ids = await rowIds(page);
    check('B1-a 侧栏出现 3 个页行（UI 新建）', ids.length >= 3, JSON.stringify(ids));

    // ===== B2 入口行在位 → 进多选 =====
    STEP = 'B2|入口与多选态';
    const entry = await page.locator('[data-testid="side-bulk-toggle"]').count();
    check('B2-a 侧栏「批量删除…」入口行在位', entry === 1, `count=${String(entry)}`);
    check('B2-b 未进多选时无操作条', (await page.locator('[data-testid="side-bulk-bar"]').count()) === 0, 'no bar');
    await page.locator('[data-testid="side-bulk-toggle"]').click();
    await page.waitForSelector('[data-testid="side-bulk-bar"]', { timeout: 8000 });
    const c0 = await bulkCount(page);
    check('B2-c 操作条出现且计数 0', typeof c0 === 'string' && c0.includes('0'), c0);
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="side-bulk-check-"]')].map((el) => el.getAttribute('data-testid') ?? ''),
    );
    check('B2-d 多选态下每行都有勾选框', boxes.length >= 3, JSON.stringify(boxes.slice(0, 4)));

    // ===== B3 两种勾选方式 =====
    STEP = 'B3|勾选';
    const [a, b] = ids;
    await page.locator(`[data-testid="side-node-${a}"]`).click(); // 行点击 = 勾选
    await wait(400);
    await page.locator(`[data-testid="side-bulk-check-${b}"]`).click(); // 勾选框 = 勾选
    await wait(400);
    const c2 = await bulkCount(page);
    check('B3-a 行点击 + 勾选框两种方式都生效（计数 2）', c2.includes('2'), c2);
    const checkedCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="side-bulk-check-"]:checked').length);
    check('B3-b 原生 checkbox 勾选态 = 2', checkedCount === 2, String(checkedCount));
    await page.screenshot({ path: join(SHOTS, 'b4-selected.png') });

    // ===== B5 确认弹层 =====
    STEP = 'B4|确认层';
    await page.locator('[data-testid="side-bulk-delete"]').click();
    await page.waitForSelector('[data-testid="bulk-delete-confirm"]', { timeout: 8000 });
    const dlgText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? '');
    check('B4-a 二次确认弹层出现且写明项数', dlgText.includes('2'), dlgText.slice(0, 90));
    await page.screenshot({ path: join(SHOTS, 'b5-confirm.png') });

    // ===== B6 执行 =====
    STEP = 'B5|执行';
    await page.locator('[data-testid="bulk-delete-confirm"]').click();
    await wait(2500);
    const toastText = await page.evaluate(() => document.querySelector('[data-testid="toast-bulk-delete"]')?.textContent ?? 'NO-TOAST');
    check('B5-a 一条汇总 toast（data-testid=toast-bulk-delete）', toastText !== 'NO-TOAST', toastText.slice(0, 80));
    check('B5-b 汇总文案报 2 项', toastText.includes('2'), toastText.slice(0, 80));
    const after = await rowIds(page);
    check('B5-c 被删两页已离开侧栏树', !after.includes(a) && !after.includes(b), JSON.stringify(after));
    await wait(800);
    const cEnd = await bulkCount(page);
    check('B5-d 多选计数归零（选中集自动摘除）', cEnd.includes('0'), cEnd);
    await page.screenshot({ path: join(SHOTS, 'b6-done.png') });

    STEP = 'B6|零触碰';
    check('B6-a 真实档案根 mtime 未变', stamp0 === realRootStamp(), `${stamp0} vs ${realRootStamp()}`);
  } finally {
    try { await browser.close(); } catch { /* */ }
    killTree(child.pid);
    killStaleApp();
  }
}

/** 统一收尾：先报（含 FATAL/断言数守卫），再定退出码。 */
function report(fatal) {
  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok === false).length;
  console.log(`\n===== T86：${pass} PASS / ${fail} FAIL（靶=${PACKAGED ? 'win-unpacked' : 'dev'}）=====`);
  if (fatal !== undefined) console.log('FATAL-DETAIL', fatal);
  if (assertions.length < 6) { console.log('TOO FEW ASSERTIONS — FATAL'); process.exit(2); }
  process.exit(fatal === undefined && fail === 0 ? 0 : 1);
}
main().then(() => report()).catch((e) => {
  console.error('FATAL', e);
  try { writeFileSync(join(SHOTS, 't86-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2)); } catch { /* */ }
  report(String(e));
});