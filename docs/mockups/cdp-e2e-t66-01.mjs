/*
 * cdp-e2e-t66-01.mjs —— TASK-T66-01 真机取证（PM 亲写亲跑）。
 *  个人工作台（home 一等视图 + 五卡 + 库卡常驻 + 三入口 + 防呆回 pages）：
 *   T1 三入口：顶栏房子钮 / Alt+H / 命令面板 go home 都能开 home（.wb-root 出现）。
 *   T2 home 非死角：home 打开时侧栏/顶栏/标签条仍可点（点侧栏普通行→收 home 开编辑器）。
 *   T3 库卡常驻：快捷「新建多维数据」→ 库卡出现该行 + 行数文案；「查看全部」回 pages。
 *   T4 卡显隐/重置：隐藏一卡→少一卡→「恢复」→五卡齐。
 *   T5 待办卡：输入回车→出行→勾选→删除。
 *   T6 重启防呆：home 开着优雅退出→重启→回 pages 视图（不滞留 home）+ toast 可选。
 *   T7 截图取证 screens-t66/。
 * 隔离：--user-data-dir + rootPath 全在 _scratch/t66-01/，真实数据根 mtime 前后核对。
 * 纪律：断言前真值来自实测；结束优雅退出、electron 归零、孤儿差分=0。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t66-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t66');
const PORT = 9566;
const INSPECT = 9266;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`);
}
function info(name, raw) {
  assertions.push({ step: STEP, name: `[info] ${name}`, ok: null, raw: String(raw).slice(0, 500) });
  console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function nodeCount() {
  try {
    const out = execSync('wmic process where "name=\'node.exe\'" get ProcessId /format:csv', { encoding: 'utf8' });
    return out.split(/[\r\n]+/).filter((l) => /\d/.test(l) && !/ProcessId/i.test(l)).length;
  } catch { return -1; }
}
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

let ws = null; let msgId = 0; const pending = new Map();
async function connectInspector() {
  let target = null;
  for (let i = 0; i < 50 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(INSPECT)}/json/list`)).json();
      target = list.find((t) => t.webSocketDebuggerUrl) ?? null;
    } catch { await wait(600); }
  }
  if (target === null) throw new Error('main inspector 未就绪');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  await send('Runtime.enable');
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    msgId += 1;
    pending.set(msgId, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function launch() {
  for (const pid of [...listeningPids(PORT), ...listeningPids(INSPECT)]) killTree(pid);
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, `--inspect=${String(INSPECT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2500);
  const pick = await page.locator('[data-testid="ws-create"], button:has-text("创建")').count().catch(() => 0);
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click().catch(async () => { await page.locator('button:has-text("创建")').first().click().catch(() => {}); }); await wait(2500); }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });
  return { child, browser, page };
}
async function homeOpen(page) { return (await page.locator('[data-testid="workbench"]').count()) > 0; }
async function newPage(page, title) {
  await page.locator('[data-testid="side-new-page"]').first().click({ force: true });
  await wait(700);
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 8000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1200);
}
async function firstSideNodeId(page) {
  return page.evaluate(() => document.querySelector('[data-testid^="side-node-"]')?.getAttribute('data-testid')?.replace('side-node-', '') ?? null);
}

let page = null;

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  const nodesBefore = nodeCount();
  const first = await launch();
  let child = first.child; let browser = first.browser; page = first.page;
  try {
    await connectInspector();
    // 造两枚普通页供后续点行
    await newPage(page, 'T66甲页');
    await newPage(page, 'T66乙页');

    STEP = 'T1|三入口';
    check('T1-a 初始非 home（编辑视图）', (await homeOpen(page)) === false, `home=${String(await homeOpen(page))}`);
    await page.locator('[data-testid="workbench-open"]').first().click({ force: true });
    await wait(800);
    check('T1-b 房子钮开 home（.wb-root 出现）', await homeOpen(page), String(await homeOpen(page)));
    await page.locator('[data-testid="wb-close"]').first().click({ force: true });
    await wait(600);
    check('T1-c wb-close 收 home', (await homeOpen(page)) === false, String(await homeOpen(page)));
    // Alt+H
    await page.locator('.app-side').first().click({ position: { x: 5, y: 5 }, force: true });
    await page.keyboard.press('Alt+h');
    await wait(700);
    check('T1-d Alt+H 开 home', await homeOpen(page), String(await homeOpen(page)));
    await page.keyboard.press('Alt+h');
    await wait(500);
    // 命令面板 go home
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette', { timeout: 8000 });
    await page.locator('.palette-input input').first().type('工作台', { delay: 20 });
    await wait(800);
    const cmdRow = page.locator('[role="option"]', { hasText: '工作台' }).first();
    const found = (await cmdRow.count()) > 0;
    if (found) { await cmdRow.click({ force: true }); await wait(900); }
    check('T1-e 命令面板「工作台」开 home', found && (await homeOpen(page)), `rowFound=${String(found)} home=${String(await homeOpen(page))}`);

    STEP = 'T2|home非死角';
    await page.locator('[data-testid="workbench-open"]').first().click({ force: true }).catch(() => {});
    if (!(await homeOpen(page))) { await page.keyboard.press('Alt+h'); await wait(600); }
    check('T2-a home 开着时侧栏在（.app-side 可点）', (await page.locator('.app-side').count()) > 0, String(await page.locator('.app-side').count()));
    // 点侧栏某普通行 → 应收 home 开编辑器（openInTab 守卫）
    const anyNode = await firstSideNodeId(page);
    await page.locator(`[data-testid="side-node-${anyNode}"]`).first().click({ force: true });
    await wait(1000);
    check('T2-b 点侧栏行收 home（回编辑视图）', (await homeOpen(page)) === false, `node=${String(anyNode)} homeAfter=${String(await homeOpen(page))}`);
    check('T2-c 收 home 后编辑器在场（.pv-root）', (await page.locator('.pv-root').count()) > 0, String(await page.locator('.pv-root').count()));
    await page.screenshot({ path: join(SHOTS, 't2-back-to-editor.png') }).catch(() => {});

    STEP = 'T3|库卡';
    // 开 home → 快捷「新建多维数据」→ 库卡出现该行 + 行数
    await page.keyboard.press('Alt+h');
    await wait(700);
    check('T3-a 库卡常驻可见', (await page.locator('[data-testid="wb-card-database"]').count()) > 0, String(await page.locator('[data-testid="wb-card-database"]').count()));
    const dbBefore = await page.locator('[data-testid^="wb-db-row-"]').count();
    // T70 教训：先清残留浮层（菜单/弹框 outside-close 之外的手动清理），页内原生 click 优先
    await page.keyboard.press('Escape');
    await wait(300);
    if (!(await homeOpen(page))) { await page.keyboard.press('Alt+h'); await wait(800); }
    const clickDb = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="wb-quick-database"]');
      if (b === null) return false;
      b.click();
      return true;
    });
    if (!clickDb) { await page.locator('[data-testid="wb-quick-database"]').first().click({ force: true }).catch(() => {}); }
    // 轮询至多 8s（建库+refresh+closeHome+selectPage 是异步链）
    let dbEditorOpen = false; let homeNow = true;
    for (let i = 0; i < 20; i += 1) {
      await wait(400);
      homeNow = await homeOpen(page);
      dbEditorOpen = await page.evaluate(() => document.querySelector('.dbpage') !== null);
      if (homeNow === false && dbEditorOpen) break;
    }
    const dbg = await page.evaluate(() => ({
      toast: [...document.querySelectorAll('.sc-toast, [data-testid^="toast"]')].map((e) => (e.textContent ?? '').trim()).join('|'),
      hasBtn: document.querySelector('[data-testid="wb-quick-database"]') !== null,
    }));
    const dbgWs = await page.evaluate(async () => {
      try { const r = await window.septcats?.workspaces?.list({}); return JSON.stringify(r).slice(0, 120); } catch (e) { return `ERR:${String(e?.message ?? e)}`; }
    });
    check('T3-b1 快捷建库后自动回 pages 开库页', homeNow === false && dbEditorOpen, `click=${String(clickDb)} home=${String(homeNow)} dbEditor=${String(dbEditorOpen)} btn=${String(dbg.hasBtn)} toast="${dbg.toast}" ws=${dbgWs}`);
    await page.keyboard.press('Alt+h');
    await wait(900);
    const dbAfter = await page.locator('[data-testid^="wb-db-row-"]').count();
    check('T3-b2 重开 home→库卡新增一行', dbAfter >= dbBefore + 1, `before=${String(dbBefore)} after=${String(dbAfter)}`);
    // 行数文案（可能 loading 或 N 行）
    const countTxt = await page.evaluate(() => document.querySelector('[data-testid^="wb-db-count-"]')?.textContent ?? 'NONE');
    check('T3-c 库卡行有行数文案', countTxt !== 'NONE', countTxt);
    await page.screenshot({ path: join(SHOTS, 't3-database-card.png') }).catch(() => {});

    STEP = 'T4|卡显隐重置';
    const cardsAll = await page.locator('[data-testid="wb-slot-quick"],[data-testid="wb-slot-todo"],[data-testid="wb-slot-database"],[data-testid="wb-slot-recent"],[data-testid="wb-slot-favorites"]').count();
    const moreBtn = page.locator('[data-testid="wb-card-more-recent"]').first();
    await moreBtn.scrollIntoViewIfNeeded();
    await wait(300);
    info('T4 钮盒', JSON.stringify(await moreBtn.boundingBox()));
    info('T4 命中测试', await page.evaluate(() => {
      const b = document.querySelector('[data-testid="wb-card-more-recent"]');
      if (b === null) return 'BTN_GONE';
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return `rect=${JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })} hit=${hit === null ? 'null' : hit.tagName + '.' + String(hit.className).slice(0, 40)} containsBtn=${hit !== null && (b.contains(hit) || hit.contains(b))}`;
    }));
    info('T4 页内直点', await page.evaluate(async () => {
      const b = document.querySelector('[data-testid="wb-card-more-recent"]');
      if (b === null) return 'BTN_GONE';
      b.click();
      await new Promise((r) => setTimeout(r, 50));
      const mid = document.querySelectorAll('.wb-card__menu-wrap--open').length;
      const itemsMid = [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent).join(',');
      await new Promise((r) => setTimeout(r, 300));
      const late = document.querySelectorAll('.wb-card__menu-wrap--open').length;
      return `aria=${b.getAttribute('aria-expanded')} open@50ms=${String(mid)} items@50ms=[${itemsMid}] open@350ms=${String(late)}`;
    }));
    info('T4 菜单开现场', await page.evaluate(() => {
      const items = [...document.querySelectorAll('.sc-menu [role="menuitem"], [role="menuitem"]')].map((el) => el.textContent);
      return `menuitems=${JSON.stringify(items)} menuWrapOpen=${document.querySelectorAll('.wb-card__menu-wrap--open').length}`;
    }));
    info('T4 页内点隐藏', await page.evaluate(async () => {
      const it = [...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent ?? '').includes('隐藏'));
      if (it === undefined) return 'NO_HIDE_ITEM';
      it.click();
      await new Promise((r) => setTimeout(r, 100));
      return 'clicked';
    }));
    await wait(700);
    const cardsAfterHide = await page.locator('[data-testid="wb-slot-recent"]').count();
    check('T4-a 隐藏「最近」卡→该 slot 消失', cardsAfterHide === 0 && cardsAll === 5, `cardsAll=${String(cardsAll)} recentSlotAfter=${String(cardsAfterHide)}`);
    check('T4-b 有隐藏时出现「恢复」钮', (await page.locator('[data-testid="wb-reset"]').count()) > 0, String(await page.locator('[data-testid="wb-reset"]').count()));
    await page.locator('[data-testid="wb-reset"]').first().click({ force: true });
    await wait(700);
    const cardsReset = await page.locator('[data-testid^="wb-slot-"]').count();
    check('T4-c 恢复→全卡齐（注册表 11：T71 后口径）', cardsReset === 11, `after=${String(cardsReset)}`);

    STEP = 'T5|待办卡';
    await page.locator('[data-testid="wb-todo-input"]').first().fill('T66 待办一枚');
    await page.locator('[data-testid="wb-todo-input"]').first().press('Enter');
    await wait(800);
    const todoRows = await page.locator('[data-testid^="wb-todo-toggle-"]').count();
    check('T5-a 待办回车→新增一行', todoRows >= 1, `rows=${String(todoRows)}`);
    const firstTodo = await page.evaluate(() => document.querySelector('[data-testid^="wb-todo-toggle-"]')?.getAttribute('data-testid')?.replace('wb-todo-toggle-', '') ?? null);
    if (firstTodo !== null) {
      await page.evaluate((id) => { document.querySelector(`[data-testid="wb-todo-toggle-${id}"]`)?.click(); }, firstTodo);
      await wait(600);
      const done = await page.evaluate((id) => document.querySelector(`[data-testid="wb-todo-toggle-${id}"]`)?.getAttribute('aria-checked') ?? document.querySelector(`[data-testid="wb-todo-toggle-${id}"]`)?.className ?? 'gone', firstTodo);
      info('勾选后待办态', done);
      await page.evaluate((id) => { document.querySelector(`[data-testid="wb-todo-del-${id}"]`)?.click(); }, firstTodo);
      let todoAfterDel = 1;
      for (let i = 0; i < 10; i += 1) { await wait(400); todoAfterDel = await page.locator(`[data-testid="wb-todo-toggle-${firstTodo}"]`).count(); if (todoAfterDel === 0) break; }
      check('T5-b 删除待办→该行移除', todoAfterDel === 0, `after=${String(todoAfterDel)}`);
    }
    await page.screenshot({ path: join(SHOTS, 't5-todo.png') }).catch(() => {});

    STEP = 'T6|重启防呆';
    // home 开着 → 优雅退出 → 重启 → 应回 pages（不滞留 home）
    // （T3-b2 起 home 一直开着；Alt+H 是 toggle，盲按会反收——状态感知确保开）
    if (!(await homeOpen(page))) { await page.keyboard.press('Alt+h'); await wait(600); }
    check('T6-a 退出前 home 开着', await homeOpen(page), String(await homeOpen(page)));
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    if (!child.killed) { killTree(child.pid); }
    const re = await launch();
    child = re.child; browser = re.browser; page = re.page;
    await connectInspector();
    const homeAfterBoot = await homeOpen(page);
    const editorAfterBoot = (await page.locator('.pv-root').count()) > 0;
    check('T6-b 重启不滞留 home（防呆回 pages）', homeAfterBoot === false, `home=${String(homeAfterBoot)} editor=${String(editorAfterBoot)}`);
    // 重启后 home 仍可开
    await page.keyboard.press('Alt+h');
    await wait(700);
    check('T6-c 重启后 home 仍可开（入口未坏）', await homeOpen(page), String(await homeOpen(page)));
    await page.screenshot({ path: join(SHOTS, 't6-restart-home.png') }).catch(() => {});

    STEP = 'T7|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('T7-1 全流程后应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't66-01-results.json'), JSON.stringify({ task: 'T66-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T66-01：${pass} PASS / ${fail} FAIL =====`);
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    const rootAfter = rootMtime();
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootAfter)}`);
    info('node 孤儿差分', `now=${String(nodeCount())} baseline=${String(nodesBefore)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  try { writeFileSync(join(SHOTS, 't66-01-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2)); } catch { /* */ }
  process.exit(3);
});
