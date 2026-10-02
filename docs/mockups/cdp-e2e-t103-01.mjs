/* cdp-e2e-t103-01.mjs —— T103「删除视图」真机验收（假按钮补成真实入口 + 二次确认 + 护栏）
 * （台账挂账收口：PRD-多维表格 §3.3 视图条要求「可新建 / 重命名 / 删除 / 切换」，
 *   0.6.11 前删除钮是 disabled 占位 —— 本版接 `db:view:remove` 真实通道。）
 *
 * 造假策略：**表与视图用 IPC 造**（window.septcats.db.*），UI 只断言冻结契约——
 * 判据：
 *   R1 夹具隔离双钉（settings rootPath=_scratch + 库文件在 _scratch）。
 *   R2 造表 + 1 记录 + 2 追加 table 视图 → 落库 [表格,验收B,验收C]。
 *   R3 进入 bitable 页 → 视图条在位、chip 序 3、删除钮**可用**（非旧版 disabled 假按钮）。
 *   R4 上膛：点删除第一次 → 文案「确认删除 表格」（明示当前视图名）+ view-msg 引导行在位，
 *      IPC 读回仍 3 视图（没删）。
 *   R5 失焦解除上膛（blur → 文案回落），再点一次仍不删。
 *   R6 换视图解除上膛 + 删的是**当前**视图：切到验收C → 上膛 → 确认 → IPC 读回
 *      [表格,验收B]（v_c 被删，表格活着 —— 防「明示删 A 实际删 B」）。
 *   R7 护栏：再删（当前=表格）→ 剩 1 视图后钮 disabled + title=「至少保留一个视图」；
 *      IPC 直调 viewRemove 删最后一个 → 拒绝（E_INVARIANT 文案）且视图集未减。
 *   R8 relaunch 后视图数仍 1（真落盘，非内存态）。
 *   R9 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked（跑批前 ensure-abi electron + 重打包）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = process.env.SEPTCATS_APP_BIN ?? join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t103-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9647');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t103', 'result.log');

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
  // EBUSY 容错：上一探针 shell 的 cwd 可能占住 RUN（Windows），失败不阻断
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
    const el = document.querySelector('.bitable-viewbar');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.min(1100, Math.round(r.width)), height: Math.min(160, Math.round(r.height)) };
  });
  if (target === null) return null;
  const buf = await page.screenshot({ clip: target });
  writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
  return join(SHOT_DIR, `${name}.png`);
}

const CHIPS = () => [...document.querySelectorAll('[data-testid^="bitable-view-chip-"]')].map((e) =>
  ((e.getAttribute('data-testid') ?? '').replace('bitable-view-chip-', '')));

/** 视图条删除钮快照：存在性 + 禁用态 + 文案 + title（四件一次读齐，防跨 evaluate 竞态）。 */
const REMOVE_BTN = () => {
  const b = document.querySelector('[data-testid="bitable-view-remove"]');
  if (b === null) return { exists: false };
  const msg = document.querySelector('[data-testid="bitable-view-msg"]');
  return {
    exists: true,
    disabled: b.disabled === true,
    text: (b.textContent ?? '').trim(),
    title: b.getAttribute('title') ?? '',
    msg: msg === null ? null : (msg.textContent ?? '').trim(),
  };
};

async function clickRail(page, key) {
  await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, key);
}

/** 进 bitable 指定表并等视图条就位。 */
async function openBitableTable(page, pageId) {
  await clickRail(page, 'bitable');
  await wait(1200);
  await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, pageId);
  await wait(1800);
}

/** IPC 读回落库视图序（names + vids）。 */
async function readViews(page, pid) {
  return page.evaluate(async (id) => {
    const loaded = await window.septcats.db.load({ pageId: id });
    return { names: loaded.collection.views.map((v) => v.name), vids: loaded.collection.views.map((v) => v.vid) };
  }, pid);
}

/** 点删除钮（真实 DOM click，走按钮的 onClick 上膛/确认逻辑）。 */
async function clickRemove(page) {
  await page.evaluate(() => { document.querySelector('[data-testid="bitable-view-remove"]')?.click(); });
  await wait(500);
}

async function main() {
  const realBefore = rootMtime();
  let h = await boot();
  let page = h.page;
  try {
    // ---------- R1 夹具隔离双钉 ----------
    STEP = 'R1';
    let iso = {};
    try {
      const s = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      iso = { rootPath: String(s.rootPath ?? ''), dbInScratch: existsSync(`${ROOTD}\\septcats.db`) };
    } catch (e) { iso = { err: String(e) }; }
    check('R1 夹具隔离双钉：rootPath=_scratch\\t103-01\\data 且库文件在 _scratch',
      iso.rootPath.replace(/\//g, '\\').toLowerCase() === ROOTD.toLowerCase() && iso.dbInScratch === true,
      JSON.stringify(iso));

    // ---------- R2 IPC 造表 + 1 记录 + 2 追加视图 ----------
    STEP = 'R2';
    const built = await page.evaluate(async () => {
      const api = window.septcats;
      if (api?.db === undefined) return { ok: false, why: 'no-bridge' };
      const ws = await api.workspaces.list();
      const wsId = ws.activeId ?? ws.items[0]?.id;
      const made = await api.db.create({ workspaceId: wsId, title: `删视图验收表-${String(Date.now() % 100000)}` });
      const pageId = made.pageId;
      const base = await api.db.load({ pageId });
      const tableVid = base.collection.views[0].vid;
      // 记录数 0 → DbPage 走空态不挂视图条（t102 同款教训），先造 1 条。
      await api.db.recordCreate({ pageId, values: {} });
      const stamp = Date.now() % 100000;
      const bVid = `e3b${String(stamp)}`;
      const cVid = `e3c${String(stamp)}`;
      await api.db.viewSave({
        pageId,
        view: { vid: bVid, name: '验收B', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} },
      });
      await api.db.viewSave({
        pageId,
        view: { vid: cVid, name: '验收C', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} },
      });
      const loaded = await api.db.load({ pageId });
      return {
        ok: true, pageId, tableVid, bVid, cVid,
        names: loaded.collection.views.map((v) => v.name),
      };
    });
    check('R2 造表 + 追加两 table 视图 -> 落库 [表格,验收B,验收C]',
      built.ok === true && built.names.join('|') === '表格|验收B|验收C',
      JSON.stringify(built).slice(0, 240));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
    await wait(2400);
    await openBitableTable(page, built.pageId);

    // ---------- R3 视图条 + 删除钮可用（撤 disabled 假按钮） ----------
    STEP = 'R3';
    const chips3 = await page.evaluate(CHIPS);
    const btn3 = await page.evaluate(REMOVE_BTN);
    await shot(page, 'r3-viewbar-enabled');
    check('R3 UI chip 序 3 + 删除钮在位且可用（非旧版 disabled 占位）',
      chips3.join(',') === [built.tableVid, built.bVid, built.cVid].join(',')
        && btn3.exists === true && btn3.disabled === false && btn3.text.includes('删除视图'),
      JSON.stringify({ chips3, btn3 }));

    // ---------- R4 上膛不删 + 文案明示当前视图名 ----------
    STEP = 'R4';
    await clickRemove(page);
    const btn4 = await page.evaluate(REMOVE_BTN);
    const views4 = await readViews(page, built.pageId);
    await shot(page, 'r4-armed');
    check('R4 首次点击=上膛：文案「确认删除 表格」+ 引导行在位 + IPC 读回仍 3 视图（没删）',
      btn4.text.includes('确认删除') && btn4.text.includes('表格')
        && btn4.msg !== null && btn4.msg.includes('再次点击')
        && views4.names.length === 3,
      JSON.stringify({ btn4, names: views4.names }));

    // ---------- R5 失焦解除上膛 ----------
    STEP = 'R5';
    // React 的 onBlur 由原生 focusout（冒泡）驱动；dispatch 非冒泡 blur 不会触发（假红坑）。
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="bitable-view-remove"]');
      b?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await wait(500);
    const btn5 = await page.evaluate(REMOVE_BTN);
    check('R5 blur 解除上膛：文案回落「删除视图」且引导行消失',
      !btn5.text.includes('确认删除') && btn5.msg === null,
      JSON.stringify(btn5));

    // ---------- R6 删的是当前视图（换视图作废旧上膛） ----------
    STEP = 'R6';
    await page.evaluate((vid) => { document.querySelector(`[data-testid="bitable-view-chip-${vid}"]`)?.click(); }, built.cVid);
    await wait(1500);
    await clickRemove(page); // 上膛（当前=验收C）
    const btn6a = await page.evaluate(REMOVE_BTN);
    await clickRemove(page); // 确认删
    await wait(900);
    const views6 = await readViews(page, built.pageId);
    await shot(page, 'r6-after-remove');
    check('R6 切到验收C 后上膛文案含「验收C」；确认 → 落库序 [表格,验收B]（删的是当前视图，表格活着）',
      btn6a.text.includes('验收C') && views6.names.join('|') === '表格|验收B' && views6.vids.includes(built.cVid) === false,
      JSON.stringify({ text: btn6a.text, views6 }));

    // UI chip 与落库同步（软刷新不打回 loading）
    const chips6 = await page.evaluate(CHIPS);
    check('R6b 删除后 UI chip 序同步 = 落库序（软刷新，无 Skeleton 闪断）',
      chips6.join(',') === views6.vids.join(','), JSON.stringify({ chips6, vids: views6.vids }));

    // ---------- R7 护栏：剩 1 视图后钮禁用；IPC 直调删最后一个被拒 ----------
    STEP = 'R7';
    // 当前 activeView 收敛到表格（验收C 没了）；上膛+确认删表格 → 剩验收B 1 个
    await clickRemove(page);
    await clickRemove(page);
    await wait(900);
    const views7 = await readViews(page, built.pageId);
    const btn7 = await page.evaluate(REMOVE_BTN);
    await shot(page, 'r7-guard-disabled');
    check('R7 删到只剩 1 视图：钮 disabled + title 给原因（护栏与 main E_INVARIANT 同源）',
      views7.names.length === 1 && btn7.disabled === true && btn7.title.includes('至少保留一个视图'),
      JSON.stringify({ views7, btn7 }));

    const refused = await page.evaluate(async ({ pid, vid }) => {
      try {
        await window.septcats.db.viewRemove({ pageId: pid, vid });
        return { threw: false };
      } catch (e) {
        return { threw: true, message: String(e?.message ?? e) };
      }
    }, { pid: built.pageId, vid: views7.vids[0] });
    const views7b = await readViews(page, built.pageId);
    check('R7b IPC 直调删最后一个视图 → 被拒（错误文案含护栏语）且视图集未减',
      refused.threw === true && refused.message.includes('至少要保留一个视图') && views7b.names.length === 1,
      JSON.stringify({ refused, names: views7b.names }));

    // ---------- R8 relaunch 后仍 1 视图（真落盘） ----------
    STEP = 'R8';
    h = await relaunch(h);
    page = h.page;
    await openBitableTable(page, built.pageId);
    const views8 = await readViews(page, built.pageId);
    const btn8 = await page.evaluate(REMOVE_BTN);
    check('R8 relaunch 后视图仍只剩 1（验收B）且钮 disabled —— 删除真落盘、护栏跨重启',
      views8.names.join('|') === '验收B' && btn8.disabled === true,
      JSON.stringify({ views8, btn8 }));

    // ---------- R9 真实档案零触碰 ----------
    STEP = 'R9';
    const realAfter = rootMtime();
    check('R9 真实档案根 mtime 不变', realBefore === realAfter, `${String(realBefore)} vs ${String(realAfter)}`);
  } catch (err) {
    line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
    assertions.push({ step: STEP, name: 'FATAL', ok: false, raw: String(err).slice(0, 200) });
  } finally {
    await h.browser.close().catch(() => {});
    if (h.child !== null) { killTree(h.child.pid); }
    killStaleApp();
  }

  const fails = assertions.filter((a) => a.ok !== true).length;
  line(`\n===== T103-01 删除视图真机验收：${String(assertions.length - fails)} PASS / ${String(fails)} FAIL =====`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((err) => { line(`FATAL(main) ${String(err)}`); killStaleApp(); process.exitCode = 1; });
