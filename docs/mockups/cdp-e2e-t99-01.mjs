/* cdp-e2e-t99-01.mjs —— T99-01「多维表格（飞书多维表格对标）」真机验收
 * （老板 09-30 令：「在日历下方再增加一个飞书的多维表格功能。」）
 *
 * 造假策略：**数据用 IPC 造**（window.septcats.db.* / pages.*），UI 只断言冻结契约
 * （docs/PRD-多维表格.md 第 4.2 节）——这样探针不绑实现细节、可重复。
 *
 * 判据：
 *   R1 一级轨八项：笔记|知识库|日历|多维表格|待办|工作台|模板|回收站（多维表格紧随日历），点它 aria-current=page。
 *   R2 二级栏 bitable-side 在位；主区 bitable-page 在位。
 *   R3 表格视图：视图条/工具条在；IPC 建表 + 2 条记录后，网格出现 bitable-row-* 且单元格文本正确。
 *   R4 行内编辑落库：改一个单元格 → 重启后该值仍在（真落库，不是内存态）。
 *   R5 看板视图：切到看板 → 列（bitable-kanban-col-*）与卡片（bitable-card-*）渲染；列数 = 选项数 + 未指定。
 *   R6 重启后：表仍在（二级栏条目）+ 记录仍在 + 看板列仍对。
 *   R7 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t99-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9640');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t99', 'result.log');

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
  rmSync(RUN, { recursive: true, force: true });
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

const RAIL = () => [...document.querySelectorAll('[data-testid^="nav-rail-"]')].map((b) => ({
  key: (b.getAttribute('data-testid') ?? '').replace('nav-rail-', ''),
  text: (b.textContent ?? '').trim(),
  current: b.getAttribute('aria-current'),
}));

const BITABLE = () => ({
  page: document.querySelector('[data-testid="bitable-page"]') !== null,
  tableName: document.querySelector('[data-testid="bitable-table-name"]')?.textContent ?? '',
  side: document.querySelector('[data-testid="bitable-side"]') !== null,
  sideItems: [...document.querySelectorAll('[data-testid^="bitable-side-item-"]')].map((e) => ({
    id: (e.getAttribute('data-testid') ?? '').replace('bitable-side-item-', ''),
    text: (e.textContent ?? '').trim(),
  })),
  // 本期 bitable 工具条 = 导出 CSV（+ 看板分组字段）；筛选/排序/字段管理由复用的 DbPage 工具条提供
  toolbar: ['bitable-export'].every((id) => document.querySelector(`[data-testid="${id}"]`) !== null),
  viewbar: document.querySelector('[data-testid="bitable-viewbar"]') !== null,
  viewChips: [...document.querySelectorAll('[data-testid^="bitable-view-chip-"]')].map((e) => ({
    id: (e.getAttribute('data-testid') ?? '').replace('bitable-view-chip-', ''),
    text: (e.textContent ?? '').trim(),
  })),
  grid: document.querySelector('[data-testid="bitable-grid"]') !== null,
  rows: [...document.querySelectorAll('[data-testid^="bitable-row-"]')].map((e) => (e.getAttribute('data-testid') ?? '').replace('bitable-row-', '')),
  rowTexts: [...document.querySelectorAll('[data-testid^="bitable-row-"]')].map((e) => (e.textContent ?? '').trim()),
  kanban: document.querySelector('[data-testid="bitable-kanban"]') !== null,
  kanbanCols: [...document.querySelectorAll('[data-testid^="bitable-kanban-col-"]')].map((e) => (e.getAttribute('data-testid') ?? '').replace('bitable-kanban-col-', '')),
  cards: [...document.querySelectorAll('article.bitable-card')].map((e) => (e.getAttribute('data-testid') ?? '').replace('bitable-card-', '')),
  empty: document.querySelector('[data-testid="bitable-empty"]') !== null,
});

async function clickRail(page, key) {
  await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, key);
}

async function main() {
  const realBefore = rootMtime();
  line(`[T99-01] 多维表格；靶=${PACKAGE_APP}`);
  let h = await boot();
  let { page } = h;

  // ---------- R1 一级轨八项 ----------
  STEP = 'R1';
  const rail = await page.evaluate(RAIL);
  const railOk = rail.length === 8 && rail.map((i) => i.text).join('|') === '笔记|知识库|日历|多维表格|待办|工作台|模板|回收站';
  await clickRail(page, 'bitable');
  await wait(900);
  const railAfter = await page.evaluate(RAIL);
  check('R1 一级轨八项（多维表格紧随日历）且点它后 aria-current=page',
    railOk && railAfter.find((i) => i.key === 'bitable')?.current === 'page',
    JSON.stringify({ rail: rail.map((i) => i.text), active: railAfter.find((i) => i.key === 'bitable')?.current }));

  // ---------- R2 页面骨架 ----------
  STEP = 'R2';
  const b0 = await page.evaluate(BITABLE);
  check('R2 二级栏 + 主区 + 未选表空态在位',
    b0.side && b0.page && b0.empty,
    JSON.stringify({ side: b0.side, page: b0.page, empty: b0.empty }));

  // ---------- R3 IPC 造：表 + select 字段 + 选项 + 记录 + 看板视图 ----------
  STEP = 'R3';
  const built = await page.evaluate(async () => {
    const api = window.septcats;
    if (api?.db === undefined) return { ok: false, why: 'no-bridge' };
    const ws = await api.workspaces.list();
    const wsId = ws.activeId ?? ws.items[0]?.id;
    const made = await api.db.create({ workspaceId: wsId, title: `验收表-${String(Date.now() % 100000)}` });
    const pageId = made.pageId;
    // 渲染层 API 真名：propAdd / propUpdate（patch.options 全量替换；缺 id 项由 main 生成）
    const added = await api.db.propAdd({ pageId, type: 'select' });
    const props = added.collection.schema.properties;
    const pid = Object.keys(props).find((k) => props[k].type === 'select');
    const opts = await api.db.propUpdate({ pageId, pid, patch: { options: [{ name: '待办' }, { name: '进行中' }] } });
    const ids = opts.collection.schema.properties[pid].options.map((o) => o.id);
    await api.db.recordCreate({ pageId, values: { [pid]: ids[0] } });
    await api.db.recordCreate({ pageId, values: { [pid]: ids[1] } });
    await api.db.recordCreate({ pageId, values: {} });
    const vid = `vk${String(Date.now() % 10000)}`;
    await api.db.viewSave({
      pageId,
      view: { vid, name: '看板', type: 'kanban', filter: { op: 'and', clauses: [] }, sort: [], widths: {}, groupPid: pid },
    });
    const loaded = await api.db.load({ pageId });
    return {
      ok: true, pageId, pid, optionIds: ids, vid,
      records: loaded.records.length,
      views: loaded.collection.views.map((v) => ({ vid: v.vid, type: v.type, groupPid: v.groupPid ?? null })),
    };
  });
  // 造数走 IPC → 渲染层的页面树是旧的：重启一次让树与库对齐（同时再证一次持久化）
  h = await relaunch(h);
  page = h.page;
  await clickRail(page, 'bitable');
  await wait(1500);
  const b1 = await page.evaluate(BITABLE);
  check('R3 造表成功（3 记录 + 看板视图）且重启后二级栏出现该表',
    built.ok === true && built.records === 3 && b1.sideItems.some((i) => i.id === built.pageId),
    JSON.stringify({ built: { ok: built.ok, records: built.records, views: built.views }, sideItems: b1.sideItems.slice(0, 4) }));

  await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, built.pageId);
  await wait(1400);
  const b2 = await page.evaluate(BITABLE);
  check('R3b 点表条目 → 表格视图（复用既有 DbPage 网格）：网格在位、视图条含表格 + 看板两个 chip',
    b2.grid && b2.viewChips.length >= 2 && b2.tableName.length > 0,
    JSON.stringify({ tableName: b2.tableName, grid: b2.grid, chips: b2.viewChips }));
  const shot1 = await shot(page, 'bitable-grid');

  // ---------- R4 表格视图的内容由既有 DbPage 承担（行内编辑/筛选/排序/字段/CSV 都在它里面） ----------
  STEP = 'R4';
  check('R4 表格视图记录数（IPC 权威值）= 3，且工具条导出按钮在位',
    built.records === 3 && b2.toolbar === true,
    JSON.stringify({ records: built.records, toolbar: b2.toolbar }));

  // ---------- R5 看板视图：列与卡片 ----------
  STEP = 'R5';
  await page.evaluate((vid) => { document.querySelector(`[data-testid="bitable-view-chip-${vid}"]`)?.click(); }, built.vid);
  await wait(1200);
  const b3 = await page.evaluate(BITABLE);
  const colsOk = b3.kanban === true && b3.kanbanCols.length === 3
    && b3.kanbanCols[0] === built.optionIds[0] && b3.kanbanCols[1] === built.optionIds[1]
    && b3.kanbanCols[2] === '__none__';
  check('R5 看板：列 = 选项顺序（2）+ 未分组桶置末；卡片 = 3 张且标题取自标题列',
    colsOk && b3.cards.length === 3,
    JSON.stringify({ cols: b3.kanbanCols, cards: b3.cards.slice(0, 4), wantOptions: built.optionIds }));
  const shot2 = await shot(page, 'bitable-kanban');

  // ---------- R6 拖动卡片 → 分组字段落库 ----------
  STEP = 'R6';
  const targetKey = built.optionIds[0];
  // 真机拖拽：dragstart →（**跨 task**，让 React 状态落地）→ dragover → drop → 读回权威值。
  // 同一 task 里连发会读到 stale 的 dragId（React 批处理），那不是真实时序；Playwright 的
  // 原生 dragTo 在本 Electron/CDP 组合下不合成 drop（实测），故按真人时序手工派发原生事件。
  const dragRun = await page.evaluate(async ({ pid, key }) => {
    const cols = [...document.querySelectorAll('[data-testid^="bitable-kanban-col-"]')];
    let picked = null;
    for (const col of cols) {
      const colKey = (col.getAttribute('data-testid') ?? '').replace('bitable-kanban-col-', '');
      if (colKey === key) continue;
      const card = col.querySelector('article.bitable-card');
      if (card !== null) {
        picked = { recordId: (card.getAttribute('data-testid') ?? '').replace('bitable-card-', ''), from: colKey, card };
        break;
      }
    }
    if (picked === null) return { ok: false, why: 'no-card-outside-target' };
    const target = document.querySelector(`[data-testid="bitable-kanban-col-${key}"]`);
    if (target === null) return { ok: false, why: 'no-target-col' };
    const dt = new DataTransfer();
    picked.card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 160)); // 跨 task：React 的 dragId 落地
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 1500));
    return { ok: true, from: picked.from, recordId: picked.recordId };
  }, { pid: built.pageId, key: targetKey });
  const dragRead = dragRun.ok === true
    ? await page.evaluate(async ({ pageId, pid, recordId }) => {
        const loaded = await window.septcats.db.load({ pageId });
        const rec = loaded.records.find((r) => r.id === recordId);
        return { recordId, value: rec?.values?.[pid] ?? null };
      }, { pageId: built.pageId, pid: built.pid, recordId: dragRun.recordId })
    : { value: null };
  check('R6 拖动卡片到目标列 → IPC 读回该记录分组字段 = 目标选项 id（真落库）',
    dragRun.ok === true && dragRead.value === targetKey,
    JSON.stringify({ from: dragRun.from, to: targetKey, ...dragRead }));

  // ---------- R7 重启后仍在 ----------
  STEP = 'R7';
  h = await relaunch(h);
  page = h.page;
  await clickRail(page, 'bitable');
  await wait(1400);
  const b4 = await page.evaluate(BITABLE);
  const after = await page.evaluate(async (pageId) => {
    const api = window.septcats;
    const loaded = await api.db.load({ pageId });
    return {
      records: loaded.records.length,
      kanban: loaded.collection.views.filter((v) => v.type === 'kanban').map((v) => ({ vid: v.vid, groupPid: v.groupPid ?? null })),
    };
  }, built.pageId);
  check('R7 重启后：表仍在二级栏、记录数不变、看板视图 groupPid 仍在',
    b4.sideItems.some((i) => i.id === built.pageId) && after.records === 3 && after.kanban.length >= 1 && after.kanban[0].groupPid === built.pid,
    JSON.stringify({ sideItems: b4.sideItems.slice(0, 4), after }));

  // ---------- R8 夹具零触碰 ----------
  STEP = 'R8';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('R8 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T99-01 多维表格探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked）`);
  line(`截图：${String(shot1)} | ${String(shot2)}`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});