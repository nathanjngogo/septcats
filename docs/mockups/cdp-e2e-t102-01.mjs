/* cdp-e2e-t102-01.mjs —— IDEA-E「视图排序」真机验收（0.6.10 创意环节第①项收尾）
 *
 * 契约（bc1c0df + 64882e7 落地口径）：
 *   视图切换 = PropBar 视图下拉菜单（非页签条）；宿主接线 onMoveView 后，
 *   每个视图行带「前移到 X / 后移到 X」动作钮（真 button=键盘等价），改序走
 *   db:view:reorder 通道（引擎 reorderById：占目标位、其余平移）；首项前移/末项后移
 *   的钮 disabled（不造假入口）；点动作钮**不关菜单、不误选视图**。
 *
 * 判据（10 条）：
 *   R1 夹具隔离双钉：settings.json rootPath=_scratch 副本 + UD 独立（真实档案根 mtime 不变 R9）。
 *   R2 IPC 造 3 视图（表格|视图B|视图C，均合法类型）落库序正确；进入 bitable 后视图 chip 序一致。
 *   R3 视图下拉按落库序列出行；首行「前移（已在最前）」钮 disabled。
 *   R4 点末行(视图C)「前移到 X」→ 菜单仍开、当前视图名不变（不误选/不关菜单）。
 *   R5 IPC db.load 读回 views 序 = [表格,视图C,视图B]（move1 落库）。
 *   R6 再点(现末行)视图B「前移到 视图C」→ 读回 [表格,视图C,视图B] 保持? 否——R6 设计为
 *      点(现第2位)视图C「后移到 视图B」→ [表格,视图B,视图C]… 为避免歧义，实现固定为：
 *      R6 move2=首行「表格」后移到「视图C」→ 读回 [视图C,表格,视图B]（首项后移方向未被 disabled，合法）。
 *   R7 page.reload 后 UI chip 序 = move2 读回序（渲染层重取）。
 *   R8 进程 relaunch 后 UI chip 序仍 = move2 读回序（真落盘，重启仍在）。
 *   R9 真实档案根 mtime 不变（红线）。
 *
 * 跑法（PM 值守/主会话）：先 ensure-abi electron + 重打包（build && electron-builder --win），
 *   再 node docs/mockups/cdp-e2e-t102-01.mjs；靶=apps/desktop/dist/win-unpacked。
 * 骨架沿用 cdp-e2e-t99-01.mjs（探针数据隔离双钉 + relaunch 取证模式照搬）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = process.env.SEPTCATS_APP_BIN ?? join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t102-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9646');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t102', 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) {
  console.log(text);
  try { mkdirSync(dirname(RESULT), { recursive: true }); appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* 取证失败不阻断 */ }
}
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 300) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 240)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* 已退 */ } }
function killStaleApp() { try { execSync('taskkill /F /IM Septcats.exe', { stdio: 'ignore' }); } catch { /* 无进程 */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

let CHILD = null;

function writeSettings() {
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
}

async function attach() {
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    cwd: dirname(PACKAGE_APP), stdio: 'ignore', detached: false,
  });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(700); }
  }
  if (browser === null) throw new Error('CDP 连接超时');
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  let page = null;
  for (let i = 0; i < 30; i++) {
    await wait(500);
    page = ctx.pages().find((p) => p.url().includes('index.html'));
    if (page) break;
  }
  if (page === null) throw new Error('主窗口未就绪');
  for (let i = 0; i < 20; i++) {
    await wait(400);
    if (await page.evaluate(() => document.querySelector('.sc-shell__body') !== null)) break;
  }
  await wait(1500);
  return { child: CHILD, browser, page };
}

async function boot() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  // 清理容错：上一探针 shell 的 cwd 可能占住 RUN（Windows EBUSY），失败不阻断
  try { rmSync(RUN, { recursive: true, force: true }); } catch { /* 复用目录 */ }
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  writeSettings();
  return attach();
}

async function relaunch(h) {
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1600);
  killStaleApp();
  return attach();
}

async function shot(page, name) {
  const target = await page.evaluate(() => {
    const el = document.querySelector('.sc-shell__body');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.min(1000, Math.round(r.width)), height: Math.min(460, Math.round(r.height)) };
  });
  if (target === null) return null;
  const buf = await page.screenshot({ clip: target });
  writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
  return join(SHOT_DIR, `${name}.png`);
}

const CHIPS = () => [...document.querySelectorAll('[data-testid^="bitable-view-chip-"]')].map((e) =>
  ((e.getAttribute('data-testid') ?? '').replace('bitable-view-chip-', '')));

async function clickRail(page, key) {
  await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, key);
}

/** 进入 bitable 指定表并打开视图下拉（每节前置复位：菜单是瞬时态，操作前先开）。 */
async function openViewMenu(page, pageId) {
  await clickRail(page, 'bitable');
  await wait(1200);
  await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, pageId);
  await wait(1500);
  // 视图切换钮 = 文本为当前视图名的 haspopup 钮（PropBar 首位）；按可见名定位，稳。
  const btnFound = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sc-propbar button[aria-haspopup="menu"]')];
    const btn = btns.find((b) => (b.textContent ?? '').trim() === '表格') ?? btns[0];
    if (btn === undefined) return false;
    btn.click();
    return true;
  });
  await wait(700);
  return btnFound;
}

/**
 * 读视图下拉的行序 + 动作钮禁用态 + 当前视图名。
 * 值守 10-02 加固：若菜单不在（openViewMenu 那次开未成/被宿主重挂收掉），
 * 在**同一次 evaluate** 内重点视图钮（PropBar 首个 haspopup 必是视图切换）并页内等 900ms 再读——
 * 排除跨 evaluate 的开合竞态。
 */
async function readMenu(page) {
  return page.evaluate(async () => {
    const snap = () => {
      const menu = document.querySelector('[role="menu"][aria-label="视图"]');
      if (menu === null) return null;
      return menu;
    };
    let menu = snap();
    if (menu === null) {
      const btns = [...document.querySelectorAll('.sc-propbar button[aria-haspopup="menu"]')];
      btns[0]?.click();
      await new Promise((r) => { setTimeout(r, 900); });
      menu = snap();
    }
    if (menu === null) return { open: false };
    const rows = [...menu.querySelectorAll('.sc-menu__row')];
    const items = rows.map((row) => {
      const item = row.querySelector('[role="menuitem"]');
      const up = row.querySelector('button[aria-label^="前移"]');
      const down = row.querySelector('button[aria-label^="后移"]');
      return {
        label: (item?.textContent ?? '').trim(),
        upLabel: (up?.getAttribute('aria-label') ?? ''),
        upDisabled: up?.disabled === true,
        downLabel: (down?.getAttribute('aria-label') ?? ''),
      };
    });
    const bar = document.querySelector('.sc-propbar');
    const switchBtn = [...(bar?.querySelectorAll('button[aria-haspopup="menu"]') ?? [])][0];
    return { open: true, items, activeName: (switchBtn?.textContent ?? '').trim() };
  });
}

/** 严格版 readMenu：只读当前态、不补开——给 R4「动作钮点后面板仍开」这类断言用（防补开掩盖）。 */
async function readMenuStrict(page) {
  return page.evaluate(() => {
    const menu = document.querySelector('[role="menu"][aria-label="视图"]');
    if (menu === null) return { open: false };
    const bar = document.querySelector('.sc-propbar');
    const switchBtn = [...(bar?.querySelectorAll('button[aria-haspopup="menu"]') ?? [])][0];
    return { open: true, activeName: (switchBtn?.textContent ?? '').trim() };
  });
}

/** 按「行标签 + 动作」点动作钮；菜单不在则同一 evaluate 内先补开再点（排除开合竞态）。 */
async function clickAction(page, ariaLabel) {
  return page.evaluate(async (lab) => {
    const findBtn = () => document.querySelector(`[role="menu"][aria-label="视图"] button.sc-menu__action[aria-label="${lab}"]`);
    let b = findBtn();
    if (b === null) {
      const btns = [...document.querySelectorAll('.sc-propbar button[aria-haspopup="menu"]')];
      btns[0]?.click();
      await new Promise((r) => { setTimeout(r, 900); });
      b = findBtn();
    }
    if (b === null || (b).disabled === true) return false;
    (b).click();
    return true;
  }, ariaLabel);
}

async function main() {
  const realBefore = rootMtime();
  line(`[T102-01] IDEA-E 视图排序；靶=${PACKAGE_APP}`);
  let h = await boot();
  let page = h.page;

  // ---------- R1 隔离双钉（值守 10-02 修正：AppSettings 线上契约**没有 rootPath 字段**
  // ——readAppSettings 只回 theme/locale/privacy/editor/trayClose/data.note(同步目录)/sync/ai，
  // 拿 IPC rootPath 断言=必假红。改为**磁盘直读**夹具 settings.json（应用启动消费的即此文件），
  // 双钉=UD 副本在位 + 该文件 rootPath 指向 _scratch data + 库文件确实落在 _scratch。 ----------
  STEP = 'R1';
  let iso = {};
  try {
    const s = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
    iso = { rootPath: String(s.rootPath ?? ''), dbInScratch: existsSync(`${ROOTD}\\septcats.db`) };
  } catch (e) { iso = { err: String(e) }; }
  check('R1 夹具隔离双钉：settings.json rootPath=_scratch\\t102-01\\data 且库文件在 _scratch',
    iso.rootPath.replace(/\//g, '\\').toLowerCase() === ROOTD.toLowerCase() && iso.dbInScratch === true,
    JSON.stringify(iso));

  // ---------- R2 IPC 造表 + 3 视图（表格|视图B|视图C） ----------
  STEP = 'R2';
  const built = await page.evaluate(async () => {
    const api = window.septcats;
    if (api?.db === undefined) return { ok: false, why: 'no-bridge' };
    const ws = await api.workspaces.list();
    const wsId = ws.activeId ?? ws.items[0]?.id;
    const made = await api.db.create({ workspaceId: wsId, title: `排序验收表-${String(Date.now() % 100000)}` });
    const pageId = made.pageId;
    const base = await api.db.load({ pageId });
    const tableVid = base.collection.views[0].vid;
    // 值守 10-02 修正（活体诊断定案）：useDbPage 记录数为 0 → status='empty' → DbPage
    // 只渲染 EmptyState、**不挂 DbView/PropBar**（DbPage.tsx:307），视图下拉钮压根不存在。
    // T99 夹具先造记录（recordCreate 后 reload 由 R2b 承担）——此处同口径造 1 条。
    await api.db.recordCreate({ pageId, values: {} });
    const stamp = Date.now() % 100000;
    // 静态对账修正（值守 10-02）：bitable 宿主 DbPage 传 viewTypes=['table']
    // （DbPage.tsx:35/333 -> DbView.tsx:143 visibleViews 过滤），PropBar 视图下拉
    // 只列 table 型视图 —— 非 table 型压根不进菜单，拿它们当菜单行必假红。
    // 夹具改为 3 个 table 视图：表格(默认) / 视图B / 视图C。
    const bVid = `e2eb${String(stamp)}`;
    const cVid = `e2ec${String(stamp)}`;
    await api.db.viewSave({
      pageId,
      view: { vid: bVid, name: '视图B', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} },
    });
    await api.db.viewSave({
      pageId,
      view: { vid: cVid, name: '视图C', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} },
    });
    const loaded = await api.db.load({ pageId });
    return {
      ok: true, pageId, tableVid, bVid, cVid,
      vids: loaded.collection.views.map((v) => v.vid),
      names: loaded.collection.views.map((v) => v.name),
    };
  });
  check('R2 造表 + 追加两 table 视图 -> 落库视图序 [表格,视图B,视图C]',
    built.ok === true && built.names.join('|') === '表格|视图B|视图C',
    JSON.stringify(built).slice(0, 240));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2400);
  await openViewMenu(page, built.pageId);
  const uiOrder = await page.evaluate(CHIPS);
  const shotA = await shot(page, 'view-menu-before');
  check('R2b reload 进入表格 → UI 视图 chip 序 = 落库序',
    uiOrder.join(',') === built.vids.join(','),
    JSON.stringify({ ui: uiOrder, db: built.vids }));

  // ---------- R3 菜单行序 + 首行前移 disabled ----------
  STEP = 'R3';
  let menu = await readMenu(page);
  check('R3 视图下拉按序列 3 行；首行「前移（已在最前）」disabled、末行「前移到」钮可用',
    menu.open === true && menu.items.length === 3
      && menu.items[0].upDisabled === true
      && menu.items[2].upLabel.startsWith('前移到') && menu.items[2].upDisabled === false,
    JSON.stringify(menu.items));

  // ---------- R4 点末行「前移到 X」：不关菜单、不误选视图 ----------
  STEP = 'R4';
  // 末行=视图C，其前邻=视图B -> 换位 -> [表格,视图C,视图B]
  const clicked1 = await clickAction(page, '前移到「视图B」');
  await wait(1400);
  menu = await readMenuStrict(page);
  check('R4 点动作钮 → 菜单保持打开且当前视图仍「表格」（不误选、不关菜单）',
    clicked1 === true && menu.open === true && menu.activeName === '表格',
    JSON.stringify({ clicked1, open: menu.open, activeName: menu.activeName }));

  // ---------- R5 IPC 读回 move1 ----------
  STEP = 'R5';
  const after1 = await page.evaluate(async (pid) => {
    const loaded = await window.septcats.db.load({ pageId: pid });
    return { names: loaded.collection.views.map((v) => v.name), vids: loaded.collection.views.map((v) => v.vid) };
  }, built.pageId);
  check('R5 IPC 读回：move1 后落库序 = [表格,视图C,视图B]',
    after1.names.join('|') === '表格|视图C|视图B',
    JSON.stringify(after1));

  // ---------- R6 move2：首行「表格」后移到「视图C」→ [视图C,表格,视图B] ----------
  STEP = 'R6';
  // 菜单此刻开着（R4 后 readMenu）。首行=表格，其下=视图C。
  const clicked2 = await clickAction(page, '后移到「视图C」');
  await wait(1400);
  const after2 = await page.evaluate(async (pid) => {
    const loaded = await window.septcats.db.load({ pageId: pid });
    return { names: loaded.collection.views.map((v) => v.name), vids: loaded.collection.views.map((v) => v.vid) };
  }, built.pageId);
  check('R6 move2（首项后移，方向未被禁用）-> 落库序 = [视图C,表格,视图B]',
    clicked2 === true && after2.names.join('|') === '视图C|表格|视图B',
    JSON.stringify({ clicked2, after2 }));

  // ---------- R7 reload 后 UI 序一致 ----------
  STEP = 'R7';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2400);
  await clickRail(page, 'bitable');
  await wait(1200);
  await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, built.pageId);
  await wait(1600);
  // chip textContent =「类型 · 名」，不能拿纯名比 —— 按 vid 序对账（静态对账修正）。
  const chips7 = await page.evaluate(CHIPS);
  check('R7 page.reload 后 UI chip(vid) 序 = move2 落库序',
    chips7.join(',') === after2.vids.join(','),
    JSON.stringify(chips7));

  // ---------- R8 进程 relaunch 后仍在（真落盘） ----------
  STEP = 'R8';
  h = await relaunch(h);
  page = h.page;
  await clickRail(page, 'bitable');
  await wait(1500);
  await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, built.pageId);
  await wait(1800);
  const chips8 = await page.evaluate(CHIPS);
  const shotB = await shot(page, 'view-order-after');
  check('R8 relaunch 后 UI chip(vid) 序仍 = move2 落库序（重启仍在）',
    chips8.join(',') === after2.vids.join(','),
    JSON.stringify(chips8));

  // ---------- R9 真实档案零触碰 ----------
  STEP = 'R9';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('R9 真实档案根 mtime 不变（红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T102-01 IDEA-E 视图排序探针：${String(assertions.length)} 断言 = ${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked）`);
  line(`截图：${String(shotA)} | ${String(shotB)}`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 1;
});
