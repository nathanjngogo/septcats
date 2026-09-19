/* TASK-T41-01-1 真机验收（PM 独立）：DB 页 ⋯ 菜单不含全宽项，普通页仍含且仍可切
   关键：验证「隐藏」没有误伤功能（普通页切全宽仍生效）
*/
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t41-1';
const UD = RUN + '\\ud';
const ROOT = RUN + '\\data';
const PORT = 9449;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t41-1');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, raw) => { results.push({ name: n, ok: !!ok, raw: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}  — ${String(raw)}`); };
const info = (n, raw) => { results.push({ name: `[info] ${n}`, ok: null, raw: String(raw) }); console.log(`INFO  ${n}  — ${String(raw)}`); };
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* ignore */ } };
const alive = (pid) => { try { execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' }); return true; } catch { return false; } };
const consoleErrors = []; const pageErrors = [];

async function launch(tag) {
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* ignore */ }
  await wait(1500);
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], { cwd: APPDIR, detached: false, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(800); } }
  if (browser === null || browser === undefined) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter((p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'));
    if (ps.length > 0) { page = ps[0]; break; }
    await wait(500);
  }
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e && e.message ? e.message : e)}`));
  await page.bringToFront().catch(() => {});
  await wait(2000);
  return { page, pid: child.pid, browser };
}
async function quit(page, pid, browser) {
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
  await wait(1200);
  if (alive(pid)) killTree(pid);
  await browser.close().catch(() => {});
  await wait(1200);
}
async function waitFor(fn, timeoutMs, stepMs = 250) {
  const dl = Date.now() + timeoutMs; let last = false;
  while (Date.now() < dl) { last = await fn(); if (last) return last; await wait(stepMs); }
  return last;
}
async function menuOf(page, rowId) {
  await page.locator(`[data-testid="${rowId}"]`).first().hover().catch(() => {});
  await wait(450);
  const moreId = String(rowId).replace('side-wiki-node-', 'side-more-').replace('side-node-', 'side-more-');
  await page.locator(`[data-testid="${moreId}"]`).first().click({ force: true }).catch(() => {});
  await wait(900);
  const txt = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('.sc-menu')];
    const m = ms[ms.length - 1];
    if (m === null || m === undefined) return null;
    return [...m.querySelectorAll('[role="menuitem"] .sc-menu__label')].map((e) => e.textContent);
  });
  await page.keyboard.press('Escape').catch(() => {});
  await wait(350);
  return txt;
}
async function rowIdOf(page, title) {
  return page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
    const r = rows.find((el) => (el.textContent || '').includes(t));
    return r ? r.getAttribute('data-testid') : null;
  }, title);
}
async function newPage(page, title) {
  await page.getByTestId('side-new-page').click();
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1500);
}

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' }, sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

console.log('\n--- BOOT1：造普通页 + DB 页 ---');
let { page, pid, browser } = await launch('b1');
await newPage(page, '普通页甲');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(400);
await page.keyboard.type('普通页正文', { delay: 25 });
await wait(600);
const normalRowId = await rowIdOf(page, '普通页甲');
info('普通页 rowId', String(normalRowId));

// 普通页 ⋯ 菜单：应含全宽项
STEP: {
  const m1 = await menuOf(page, normalRowId);
  info('普通页菜单', JSON.stringify(m1));
  check('N1 普通页 ⋯ 菜单**含**全宽项（功能未被误删）',
    m1 !== null && m1.some((x) => String(x).includes('全宽') || String(x).includes('固定宽度')),
    JSON.stringify(m1));
}

// 普通页切全宽 → 应真生效
const before = await page.evaluate(() => ({
  measure: document.querySelector('.pv-root')?.getAttribute('data-measure') ?? null,
  bodyW: document.querySelector('.pv-body') === null ? null : +document.querySelector('.pv-body').getBoundingClientRect().width.toFixed(1),
}));
await page.locator(`[data-testid="${normalRowId}"]`).first().hover().catch(() => {});
await wait(400);
await page.locator(`[data-testid="side-more-${String(normalRowId).replace('side-node-', '')}"]`).first().click({ force: true }).catch(() => {});
await wait(900);
const fw = page.locator('[role="menuitem"]', { hasText: '固定宽度' }).first();
if ((await fw.count()) > 0) await fw.click({ force: true }).catch(() => {});
await wait(1300);
const after = await page.evaluate(() => ({
  measure: document.querySelector('.pv-root')?.getAttribute('data-measure') ?? null,
  bodyW: document.querySelector('.pv-body') === null ? null : +document.querySelector('.pv-body').getBoundingClientRect().width.toFixed(1),
}));
check('N2 普通页切全宽仍真生效（宽度变化）',
  after.measure === 'full' && before.bodyW !== null && after.bodyW !== null && after.bodyW > before.bodyW,
  `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);

// 造 DB 页
const dbPageId = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const c = await window.septcats.db.create({ workspaceId: ws.activeId, title: 'DB页乙' });
  const r = await window.septcats.db.propAdd({ pageId: c.pageId, type: 'number' });
  await window.septcats.db.recordCreate({ pageId: c.pageId });
  return c.pageId;
});
info('DB 页 id', String(dbPageId));
await quit(page, pid, browser);

console.log('\n--- BOOT2：DB 页菜单（应无全宽项）---');
({ page, pid, browser } = await launch('b2'));
await wait(1200);
const dbRowId = await rowIdOf(page, 'DB页乙');
info('DB 页 rowId', String(dbRowId));
check('D0 DB 页在侧栏可见', dbRowId !== null, String(dbRowId));

if (dbRowId !== null) {
  const m2 = await menuOf(page, dbRowId);
  info('DB 页菜单', JSON.stringify(m2));
  check('D1 DB 页 ⋯ 菜单**不含**全宽项（不提供无效控件）',
    m2 !== null && !m2.some((x) => String(x).includes('全宽') || String(x).includes('固定宽度')),
    JSON.stringify(m2));
  check('D2 DB 页菜单仍含删除项（未误删其它项）',
    m2 !== null && m2.some((x) => String(x).includes('删除')),
    JSON.stringify(m2));
}
// ★ 命令面板门控真机验证（补 T41-01-1 报告 D-3 的证据缺口：工程师称该侧无单测、仅代码走查）
STEP2: {
  const pal = async () => {
    await page.keyboard.press('Control+k').catch(() => {});
    await wait(1000);
    const opts = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="palette-panel"]');
      if (panel === null) return null;
      return [...panel.querySelectorAll('[role="option"]')].map((e) => (e.textContent || '').trim());
    });
    await page.keyboard.press('Escape').catch(() => {});
    await wait(400);
    return opts;
  };
  // ★ 必须先**真正点击选中** DB 页（上一轮 PM 只 hover 开菜单，选中页其实还是普通页 → 假红）
  if (dbRowId !== null) { await page.locator(`[data-testid="${dbRowId}"]`).first().click({ force: true }).catch(() => {}); await wait(1500); }
  const selIsDb = await page.evaluate(() => document.querySelector('.dbpage') !== null);
  info('当前选中页是否已渲染为 DbPage', String(selIsDb));
  const dbOpts = await pal();
  info('命令面板（选中 DB 页）', JSON.stringify(dbOpts));
  check('P1 命令面板在 DB 页不含全宽命令', dbOpts !== null && !dbOpts.some((x) => x.includes('全宽')), JSON.stringify(dbOpts));
  // 切到普通页再看
  const nRow = await rowIdOf(page, '普通页甲');
  if (nRow !== null) { await page.locator(`[data-testid="${nRow}"]`).first().click({ force: true }).catch(() => {}); await wait(1300); }
  const nOpts = await pal();
  info('命令面板（选中普通页）', JSON.stringify(nOpts));
  check('P2 命令面板在普通页含全宽命令', nOpts !== null && nOpts.some((x) => x.includes('全宽')), JSON.stringify(nOpts));
}

await page.screenshot({ path: join(SHOTS, 'menu-db.png') }).catch(() => {});
await quit(page, pid, browser);

const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n========== 汇总：${pass} PASS / ${fail} FAIL ==========`);
console.log(`console 错误 ${consoleErrors.length} / pageerror ${pageErrors.length}`);
for (const e of consoleErrors.slice(0, 5)) console.log(`  console: ${e.slice(0, 140)}`);
for (const e of pageErrors.slice(0, 5)) console.log(`  pageerror: ${e.slice(0, 140)}`);
writeFileSync(join(SHOTS, 't41-1-results.json'), JSON.stringify({ pass, fail, results, consoleErrors, pageErrors }, null, 2), 'utf8');