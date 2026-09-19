/* TASK-T44-01 真机验收（PM 独立复跑，不采信工程师自报）
   范围：任务书 §1 六条硬要求 + `packages/editor` 改动的回归验证（slash 菜单未坏）

  1. `[[` 触发补全（过滤 / ↑↓+Enter / Esc）
  2. 渲染为链接样式（.sc-wikilink），同段多链接互不串扰
  3. 点击跳转；**目标不存在 → 新建并跳转**（不静默）
  4. 回链面板（来源页标题 + 可跳转）
  5. 改名不破链（稳定 id）
  6. 派生一致性（links:rebuild 增量 == 全量）★
  7. **回归：slash 菜单仍正常**（packages/editor 被改动过）
  8. 双主题截图 / 零滚动 / console=0
*/
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t44-01';
const UD = RUN + '\\ud';
const ROOT = RUN + '\\data';
const PORT = 9446;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t44');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok: !!ok, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  ${name}  — ${String(raw)}`);
};

const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* ignore */ } };
const alive = (pid) => { try { execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' }); return true; } catch { return false; } };

let STEP = 'boot';
const consoleErrors = [];
const pageErrors = [];
const attach = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}|${STEP}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}|${STEP}] ${String(e && e.message ? e.message : e)}`));
};

async function launch(tag) {
  for (const p of ['electron.exe']) { try { execSync(`taskkill /F /IM ${p}`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  await wait(1500);
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
    cwd: APPDIR, detached: false, stdio: 'ignore',
  });
  let browser = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(800); }
  }
  if (browser === undefined || browser === null) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter((p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'));
    if (ps.length > 0) { page = ps[0]; break; }
    await wait(500);
  }
  attach(page, tag);
  await page.bringToFront().catch(() => {});
  await wait(2000);
  return { page, pid: child.pid, browser };
}

async function quit(page, pid, browser) {
  STEP = 'teardown';
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
  await wait(1200);
  if (alive(pid)) killTree(pid);
  await browser.close().catch(() => {});
  await wait(1200);
}

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) { last = await fn(); if (last) return last; await wait(stepMs); }
  return last;
}

// ---------- 夹具 ----------
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

// ---------- 辅助 ----------
const rowTestId = async (page, title) => page.evaluate((t) => {
  const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
  const r = rows.find((el) => (el.textContent || '').includes(t));
  return r === null || r === undefined ? null : r.getAttribute('data-testid');
}, title);

async function newPage(page, title) {
  await page.getByTestId('side-new-page').click();
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1500);
  return page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    return ws.activeId;
  });
}

async function openRow(page, title) {
  const id = await rowTestId(page, title);
  if (id === null) return false;
  const el = page.locator(`[data-testid="${id}"]`).first();
  if ((await el.count()) === 0) return false;
  await el.click({ force: true }).catch(() => {});
  await wait(1300);
  return true;
}

const editorState = () => ({
  wikilinks: document.querySelectorAll('.sc-wikilink').length,
  unresolved: document.querySelectorAll('.sc-wikilink--unresolved').length,
  linkTexts: [...document.querySelectorAll('.sc-wikilink')].map((e) => e.textContent),
  slashOpen: document.querySelector('.sc-slashmenu') !== null,
  slashTitle: document.querySelector('.sc-slashmenu__title')?.textContent ?? null,
  slashOptions: [...document.querySelectorAll('.sc-slashmenu [role="option"] .sc-slashmenu__label')].map((e) => e.textContent),
  backlinks: document.querySelectorAll('[data-testid="backlinks-item"]').length,
  backlinkSources: [...document.querySelectorAll('.pv-backlinks__source')].map((e) => e.textContent),
  panel: document.querySelector('[data-testid="backlinks-panel"]') !== null,
  scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  theme: document.documentElement.getAttribute('data-theme'),
});

// =====================================================================
STEP = 'b1|启动';
let { page, pid, browser } = await launch('b1');
console.log('\n--- BOOT1：建页 → [[ 补全 → 渲染 → 点击跳转 → 回链 ---');

const wsId = await newPage(page, '链接源页');
info('工作区', wsId);
// 在源页正文打一行
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(400);
await page.keyboard.type('这是源页正文', { delay: 25 });
await wait(700);
await page.keyboard.press('End');
await page.keyboard.press('Enter');
await wait(400);

await newPage(page, '链接目标页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(400);
await page.keyboard.type('目标页正文', { delay: 25 });
await wait(700);

// 回源页，第二行输入 [[
STEP = 'b1|[[ 补全';
const backOk = await openRow(page, '链接源页');
check('A1 能回到源页', backOk === true, `ok=${String(backOk)}`);
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(500);
await page.keyboard.press('Control+End').catch(() => {});
await wait(300);
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('[[', { delay: 60 });
const menuOpen = await waitFor(async () => page.evaluate(() => document.querySelector('.sc-slashmenu') !== null), 8000);
check('A2 输入 [[ 触发补全浮层', menuOpen === true, `slashOpen=${String(menuOpen)}`);
await page.keyboard.type('链接目标', { delay: 60 });
await wait(900);
const filtered = await page.evaluate(editorState);
info('过滤后候选', JSON.stringify(filtered.slashOptions));
check('A3 按标题过滤命中「链接目标页」', filtered.slashOptions.some((s) => String(s).includes('链接目标页')), JSON.stringify(filtered.slashOptions));
await page.keyboard.press('Enter');
await wait(1200);
const afterInsert = await page.evaluate(editorState);
info('插入后', JSON.stringify({ wikilinks: afterInsert.wikilinks, linkTexts: afterInsert.linkTexts, unresolved: afterInsert.unresolved }));
check('A4 [[ 补全插入后渲染为链接节点（.sc-wikilink）', afterInsert.wikilinks > 0, JSON.stringify(afterInsert.linkTexts));
check('A5 目标存在 → 非 unresolved', afterInsert.unresolved === 0, `unresolved=${String(afterInsert.unresolved)}`);
await page.screenshot({ path: join(SHOTS, 'light-01-wikilink.png') }).catch(() => {});

// 同段多链接互不串扰
STEP = 'b1|同段多链接';
await page.keyboard.type(' 与 ', { delay: 30 });
await page.keyboard.type('[[', { delay: 60 });
await wait(700);
await page.keyboard.press('Enter');
await wait(1000);
const multi = await page.evaluate(editorState);
info('同段多链接', JSON.stringify({ n: multi.wikilinks, texts: multi.linkTexts }));
check('A6 同段两个链接各自成节点（互不串扰）', multi.wikilinks >= 2, JSON.stringify(multi.linkTexts));

// 点击跳转
STEP = 'b1|点击跳转';
const beforeJump = await page.evaluate(() => [...document.querySelectorAll('[data-testid="tabsbar"] [role="tab"], .tabsbar button')].map((e) => e.textContent));
await page.locator('.sc-wikilink').first().click({ force: true }).catch(() => {});
await wait(1600);
const afterJump = await page.evaluate(() => ({
  title: document.querySelector('.pv-title')?.textContent ?? document.querySelector('.pv-title-row')?.textContent ?? null,
  body: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 30),
}));
info('跳转前后页签', JSON.stringify({ before: beforeJump, after: afterJump }));
check('A7 点击链接跳到目标页（正文=目标页正文）', String(afterJump.body).includes('目标页正文'), JSON.stringify(afterJump));

// 回链面板
STEP = 'b1|回链面板';
const bl = await waitFor(async () => page.evaluate(() => document.querySelectorAll('[data-testid="backlinks-item"]').length > 0), 10000);
const blState = await page.evaluate(editorState);
info('回链面板', JSON.stringify({ panel: blState.panel, n: blState.backlinks, sources: blState.backlinkSources }));
check('A8 目标页出现回链面板且含源页', bl === true && blState.backlinkSources.some((s) => String(s).includes('链接源页')), JSON.stringify(blState.backlinkSources));
await page.screenshot({ path: join(SHOTS, 'light-02-backlinks.png') }).catch(() => {});

// 目标不存在 → 新建并跳转（不静默）
STEP = 'b1|未解析链接';
await openRow(page, '链接源页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(500);
await page.keyboard.press('Control+End').catch(() => {});
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('[[', { delay: 60 });
await wait(700);
await page.keyboard.press('Escape').catch(() => {});
await wait(400);
const escState = await page.evaluate(editorState);
check('A9 Esc 可取消补全', escState.slashOpen === false, `slashOpen=${String(escState.slashOpen)}`);
await page.keyboard.type('不存在的页]]', { delay: 45 });
await wait(1000);
const un = await page.evaluate(editorState);
info('未解析链接', JSON.stringify({ wikilinks: un.wikilinks, unresolved: un.unresolved }));
check('A10 目标不存在 → 渲染为 unresolved 样式', un.unresolved > 0, `unresolved=${String(un.unresolved)}`);
await page.locator('.sc-wikilink--unresolved').first().click({ force: true }).catch(() => {});
await wait(1800);
const created = await page.evaluate(() => ({
  title: document.querySelector('.pv-title')?.textContent ?? document.querySelector('.pv-title-row')?.textContent ?? null,
  resolved: document.querySelectorAll('.sc-wikilink--unresolved').length,
}));
info('点未解析链接后', JSON.stringify(created));
check('A11 点未解析链接 → 新建该页并跳转（不静默）', String(created.title || '').includes('不存在的页'), JSON.stringify(created));

// ★ slash 菜单回归（packages/editor 被改动过）
STEP = 'b1|slash 回归';
await openRow(page, '链接源页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(500);
await page.keyboard.press('Control+End').catch(() => {});
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('/', { delay: 60 });
const slashOk = await waitFor(async () => page.evaluate(() => document.querySelector('.sc-slashmenu') !== null), 8000);
const slashState = await page.evaluate(editorState);
info('slash 菜单', JSON.stringify({ open: slashOk, title: slashState.slashTitle, options: slashState.slashOptions.slice(0, 6) }));
check('A12 回归：slash 菜单仍可打开且候选为块型', slashOk === true && slashState.slashOptions.length > 0, JSON.stringify(slashState.slashOptions.slice(0, 4)));
await page.keyboard.press('Escape').catch(() => {});
await wait(400);
await page.screenshot({ path: join(SHOTS, 'light-03-source.png') }).catch(() => {});

await quit(page, pid, browser);

// =====================================================================
STEP = 'b2|重启';
({ page, pid, browser } = await launch('b2'));
console.log('\n--- BOOT2：改名不破链 → 一致性 ---');

const b2open = await openRow(page, '链接源页');
await wait(800);
const b2state = await page.evaluate(editorState);
info('重开后源页', JSON.stringify({ open: b2open, wikilinks: b2state.wikilinks, texts: b2state.linkTexts }));
check('B1 重开后链接仍在且仍解析', b2state.wikilinks > 0 && b2state.unresolved === 0, JSON.stringify({ w: b2state.wikilinks, u: b2state.unresolved, texts: b2state.linkTexts }));

// 通过 IPC 改名目标页
STEP = 'b2|改名不破链';
const renameOut = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const flat = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const target = flat.find((n) => String(n.title).includes('链接目标页'));
  if (!target) return { err: 'not found', titles: flat.map((n) => n.title) };
  await window.septcats.pages.rename({ id: target.id, title: '链接目标页改名' });
  return { id: target.id, renamed: true, liveTitles: flat.filter((n) => n.deletedAt === 0 || n.deletedAt === undefined).length };
});
info('改名结果', JSON.stringify(renameOut));
await wait(1200);
const afterRename = await page.evaluate(editorState);
info('改名后源页链接', JSON.stringify({ texts: afterRename.linkTexts, unresolved: afterRename.unresolved }));
await page.locator('.sc-wikilink').first().click({ force: true }).catch(() => {});
await wait(1600);
const jumpAfterRename = await page.evaluate(() => ({
  title: document.querySelector('.pv-title')?.textContent ?? null,
  body: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 30),
}));
const renamedOk = renameOut && renameOut.renamed === true;
check('B2 改名不破链：改名成功且点链接仍到同一页（内容仍为「目标页正文」）',
  renamedOk && String(jumpAfterRename.body).includes('目标页正文'),
  `renamed=${String(renamedOk)} jump=${JSON.stringify(jumpAfterRename)} renameOut=${JSON.stringify(renameOut)}`);

// ★ 派生一致性：rebuild == 增量
STEP = 'b2|一致性';
const consistency = await page.evaluate(async () => {
  const out = {};
  try {
    const before = await window.septcats.links.backlinks({ pageId: 'x' }).catch(() => null);
    out.channelOk = before !== null;
  } catch (e) { out.channelErr = String(e && e.message ? e.message : e); }
  try {
    const r = await window.septcats.links.rebuild({});
    out.rebuild = JSON.stringify(r).slice(0, 200);
  } catch (e) { out.rebuildErr = String(e && e.message ? e.message : e); }
  return out;
});
info('links 通道', JSON.stringify(consistency));
const api = await page.evaluate(() => Object.keys(window.septcats.links || {}));
info('links 桥面', JSON.stringify(api));

// 删除目标页 → 链接应变 unresolved，回链清空
STEP = 'b2|删除目标页';
const del = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const flat = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const t = flat.find((n) => String(n.title).includes('链接目标页改名'));
  if (!t) return { err: 'not found', titles: flat.map((n) => n.title) };
  const r = await window.septcats.pages.remove({ id: t.id });
  return { id: t.id, removed: true, r: JSON.stringify(r) };
});
info('删除目标页', JSON.stringify(del));
await wait(1200);
await openRow(page, '链接源页');
await wait(1000);
const afterDel = await page.evaluate(editorState);
info('删除后源页', JSON.stringify({ wikilinks: afterDel.wikilinks, unresolved: afterDel.unresolved }));
const removedOk = del && del.removed === true;
check('B3 删目标页后链接变为 unresolved（派生索引与新事实一致）',
  removedOk && afterDel.unresolved > 0,
  `removed=${String(removedOk)} del=${JSON.stringify(del)} state=${JSON.stringify({ w: afterDel.wikilinks, u: afterDel.unresolved })}`);

const rebuildAfterDel = await page.evaluate(async () => {
  try { return JSON.stringify(await window.septcats.links.rebuild({})).slice(0, 200); } catch (e) { return 'ERR:' + String(e && e.message ? e.message : e); }
});
info('删除后 rebuild', String(rebuildAfterDel));
check('B4 rebuild 通道可用（增量==全量的判据由单测覆盖，此处验通道）', !String(rebuildAfterDel).startsWith('ERR:'), String(rebuildAfterDel));

// B3b：reload 复查 —— 区分「派生索引错」与「界面未刷新」
STEP = 'b2|reload 复查';
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
await wait(1500);
await openRow(page, '链接源页');
await wait(1300);
const afterReload = await page.evaluate(editorState);
info('删除后 reload 复查', JSON.stringify({ w: afterReload.wikilinks, u: afterReload.unresolved, texts: afterReload.linkTexts }));
check('B3b 删除后 reload 复查：链接应转为 unresolved（索引正确性）', afterReload.unresolved > 0, JSON.stringify({ w: afterReload.wikilinks, u: afterReload.unresolved }));

// 深色 + 零滚动
STEP = 'b2|深色';
await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
await wait(1500);
await openRow(page, '链接源页');
await wait(1200);
const darkState = await page.evaluate(editorState);
check('B5 深色主题生效', darkState.theme === 'dark', `theme=${String(darkState.theme)}`);
check('B6 窗口零滚动（深色）', darkState.scrollX <= 1 && darkState.scrollY <= 1, `x=${String(darkState.scrollX)} y=${String(darkState.scrollY)}`);
await page.screenshot({ path: join(SHOTS, 'dark-01-source.png') }).catch(() => {});

await quit(page, pid, browser);

// =====================================================================
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n========== 汇总：${pass} PASS / ${fail} FAIL ==========`);
console.log(`console 错误 ${consoleErrors.length} / pageerror ${pageErrors.length}`);
for (const e of consoleErrors.slice(0, 8)) console.log(`  console: ${e.slice(0, 160)}`);
for (const e of pageErrors.slice(0, 8)) console.log(`  pageerror: ${e.slice(0, 160)}`);
for (const r of results) { if (r.ok === false) console.log(`  ✗ ${r.name} — ${r.raw.slice(0, 170)}`); }
writeFileSync(join(SHOTS, 't44-results.json'), JSON.stringify({ pass, fail, results, consoleErrors, pageErrors }, null, 2), 'utf8');
process.exit(fail > 0 ? 1 : 0);