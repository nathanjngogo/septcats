/* T78 真机探针：跨块多选（Shift+click 区间/批量删/批量转/组拖/重启持久化）
 * 注：renderer 无 undo UI 入口（history.ts 纯结构）——undo 粒度归 CB 单测，本探针不测。
 * testid 与 CB 交付对齐后定稿（M 前缀断言名）。 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't78-e2e');
const UD = `${RUN}\\ud`;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t78');
const PORT = 9238;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PAGE_NAME = `T78 多选页 ${Date.now().toString(36)}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

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

// 建 5 个文本块（行1..行5），返回块 id 序（truth 层）
async function seedFiveBlocks(page) {
  const body = page.locator('.pv-body .ProseMirror').first();
  await body.click();
  await wait(300);
  for (let i = 1; i <= 5; i += 1) {
    if (i > 1) await page.keyboard.press('Enter');
    await page.keyboard.type(`行${String(i)}`, { delay: 30 });
    await wait(120);
  }
  await wait(600);
}

async function ipcPageBlocks(page, name) {
  return page.evaluate(async (pn) => {
    const ws = await window.septcats.workspaces.list({});
    const r = await window.septcats.pages.tree({ workspaceId: ws.activeId ?? ws.items?.[0]?.id });
    const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
    const hit = arr.find((x) => x?.title === pn);
    if (!hit) return { id: null };
    const b = await window.septcats.blocks.list({ pageId: hit.id });
    return { id: hit.id, blocks: (b.blocks ?? []).map((x) => ({ t: x.type, c: (x.content ?? '').slice(0, 10) })) };
  }, name);
}

async function hoverBlock(page, text) {
  // 悬停含 text 的块行 → ⋮⋮ 手柄出现（T60 口径：hover .sc-block-row 显形）
  const pos = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="block-handle-"]')];
    const row = rows.find((e) => (e.closest('[class*="sc-block-row"], .sc-block-row') ?? e.parentElement)?.innerText?.includes(t));
    if (row == null) return null;
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, text);
  if (pos == null) return false;
  await page.mouse.move(pos.x, pos.y);
  await wait(200);
  return true;
}

async function shiftClickHandle(page, text) {
  const ok = await hoverBlock(page, text);
  if (!ok) return false;
  await page.keyboard.down('Shift');
  await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="block-handle-"]')];
    const h = rows.find((e) => (e.closest('[class*="sc-block-row"], .sc-block-row') ?? e.parentElement)?.innerText?.includes(t));
    if (h != null) { const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5, shiftKey: true })); h.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5, shiftKey: true })); h.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5, shiftKey: true })); }
  }, text);
  await page.keyboard.up('Shift');
  await wait(400);
  return true;
}

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const rootBefore = rootMtime();
  let child = null; let browser = null; let page = null;
  try {
    ({ child, browser, page } = await launch());
    const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
    if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }

    STEP = 'M1|建场';
    await newPageNamed(page, PAGE_NAME);
    await seedFiveBlocks(page);
    const seeded = await ipcPageBlocks(page, PAGE_NAME);
    check('M1-a 5 文本块入库', seeded.id != null && seeded.blocks.length === 5, JSON.stringify(seeded.blocks ?? seeded).slice(0, 200));

    STEP = 'M2|区间扩选';
    // caret 放 行1（锚）→ Shift+click 行3 手柄 → 选中条 3 根
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.pv-body .ProseMirror p')].find((e) => e.innerText.includes('行1'));
      if (p != null) { const r = p.getBoundingClientRect(); p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); }
    });
    await wait(400);
    const sc2 = await shiftClickHandle(page, '行3');
    const selCount = await page.evaluate(() => document.querySelectorAll('[data-testid^="block-select-bar-"]').length);
    check('M2-a Shift+click→区间 3 块选中条', sc2 && selCount === 3, `sel=${String(selCount)}`);
    await page.screenshot({ path: join(SHOTS, 'm2-selection.png') }).catch(() => {});
    // 二次 Shift+click 行5 → 区间重算为 行1..行5（并集口径禁止：中途行3 已不算，最终=1..5 共 5）
    await shiftClickHandle(page, '行5');
    const selCount2 = await page.evaluate(() => document.querySelectorAll('[data-testid^="block-select-bar-"]').length);
    check('M2-b 再 Shift+click 重算区间=5（非并集残留）', selCount2 === 5, String(selCount2));
    // 批量计数文案
    const bulk = await page.evaluate(() => {
      const h = [...document.querySelectorAll('[data-testid^="block-handle-"]')].find((e) => (e.closest('[class*="sc-block-row"]') ?? e.parentElement)?.innerText?.includes('行1'));
      const row = h?.closest('[class*="sc-block-row"]');
      if (row != null) { const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); h.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }
      return true;
    });
    await wait(500);
    const bulkMenu = await page.evaluate(() => ({
      del: document.querySelector('[data-testid="block-menu-bulk-delete"]') != null,
      dup: document.querySelector('[data-testid="block-menu-bulk-duplicate"]') != null,
      cnt: document.querySelector('[data-testid="block-menu-bulk-count"]')?.textContent ?? '',
    }));
    check('M2-c 多选态菜单变体（bulk 删/复制/计数=5）', bulkMenu.del && bulkMenu.dup && bulkMenu.cnt.includes('5'), JSON.stringify(bulkMenu));

    STEP = 'M3|批量删除';
    await page.evaluate(() => document.querySelector('[data-testid="block-menu-bulk-delete"]')?.click());
    await wait(800);
    const afterDel = await ipcPageBlocks(page, PAGE_NAME);
    check('M3-a 批量删→truth 层 0 块（N 单块 op）', afterDel.id != null && afterDel.blocks.length === 0, JSON.stringify(afterDel.blocks ?? afterDel).slice(0, 160));

    STEP = 'M4|批量转换';
    await seedFiveBlocks(page); // 重建 5 块
    await wait(400);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.pv-body .ProseMirror p')].find((e) => e.innerText.includes('行1'));
      if (p != null) { const r = p.getBoundingClientRect(); p.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); }
    });
    await wait(300);
    await shiftClickHandle(page, '行2');
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="block-handle-"]')];
      const h = rows.find((e) => (e.closest('[class*="sc-block-row"]') ?? e.parentElement)?.innerText?.includes('行1'));
      if (h != null) { const r = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 5, clientY: r.y + 5 })); h.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }
    });
    await wait(400);
    await page.evaluate(() => document.querySelector('[data-testid="block-menu-bulk-convert-heading"]')?.click());
    await wait(800);
    const afterConv = await ipcPageBlocks(page, PAGE_NAME);
    const heads = (afterConv.blocks ?? []).filter((x) => String(x.t).includes('heading') || x.t === 'h1' || x.t === 'heading1').length;
    check('M4-a 批量转标题→2 块 heading', heads === 2, JSON.stringify(afterConv.blocks ?? []).slice(0, 200));

    STEP = 'M5|重启持久';
    await wait(3200);
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { break; } }
    ({ child, browser, page } = await launch());
    await wait(2000);
    const after = await ipcPageBlocks(page, PAGE_NAME);
    check('M5-a 重启后=2 heading+3 段落（批量 op 全持久）', after.id != null && after.blocks.length === 5 && heads === 2 && (after.blocks ?? []).filter((x) => String(x.t).includes('heading') || x.t === 'h1').length === 2, JSON.stringify(after.blocks ?? []).slice(0, 220));

    STEP = 'M6|清选与存活';
    await page.evaluate((pn) => { const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn)); if (row != null) row.click(); }, PAGE_NAME);
    await wait(1200);
    await page.keyboard.press('Escape');
    await wait(300);
    const selGone = await page.evaluate(() => document.querySelectorAll('[data-testid^="block-select-bar-"]').length);
    check('M6-a Esc 清选（重启后无选区）', selGone === 0, String(selGone));
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('M6-b 应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't78-results.json'), JSON.stringify({ task: 'T78-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T78-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 8) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 8（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exitCode = fail === 0 && assertions.length >= 8 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
