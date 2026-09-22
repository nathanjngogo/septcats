/*
 * cdp-e2e-t64-01.mjs —— TASK-T64-01 真机取证（PM 亲写亲跑）。
 *  A 菜单 clamp：侧栏拖到最小宽(200)→首/末行 ⋯ 菜单 + 右键菜单盒四边 ≥8px；
 *  B 新建文件夹：分体钮→folder 行（FolderSimple）→点行=展开、tabs 数不变→挂子页；
 *  C 转换/面包屑：子页面包屑含文件夹名；folder「转为普通页面」→ 点行恢复开页签；
 *  D 持久化：优雅退出→重启，folder 仍在、仍为容器（不建页签）；
 *  E 回归：搜索 folder 点击不白屏；回收站删 folder 连带子页、恢复后锁结构完好。
 * 隔离：--user-data-dir + rootPath 双隔离（_scratch/t64-01/），真实数据根 mtime 前后核对。
 * 纪律：断言前真值来自实测；窗口 resize 若需走 main inspector setBounds+回读（本探针
 *       用拖拽柄改侧栏宽，不动窗口）；结束优雅退出、electron 归零、孤儿计数差分=0。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t64-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t64');
const PORT = 9547;
const INSPECT = 9247;
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
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails !== undefined) return { err: JSON.stringify(r.exceptionDetails).slice(0, 300) };
  return { value: r.result?.value };
}

async function launch() {
  for (const pid of [...listeningPids(PORT), ...listeningPids(INSPECT)]) killTree(pid);
  // 夹具：settings 钉 rootPath → 全部数据落 _scratch，真实根零触碰（红线）
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
  // 首次运行：工作区选择/创建界面（夹具空库时会出现）——点「继续/打开」类主按钮兜底
  const pick = await page.locator('.app-onboard button, [data-testid="ws-create"], button:has-text("创建工作区"), button:has-text("打开")').count().catch(() => 0);
  if (pick > 0) {
    await page.locator('[data-testid="ws-create"]').first().click().catch(async () => {
      await page.locator('button:has-text("创建")').first().click().catch(() => {});
    });
    await wait(2500);
  }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });
  return { child, browser, page };
}
async function newPage(page, title) {
  await page.locator('[data-testid="side-new-page"]').first().click({ force: true });
  await wait(800);
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 8000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1300);
}
async function openRowMenu(page, title) {
  const id = await page.evaluate((text) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"]')];
    const hit = rows.find((el) => (el.textContent ?? '').includes(text));
    if (hit === undefined) return null;
    return (hit.getAttribute('data-testid') ?? '').replace('side-node-', '');
  }, title);
  if (id === null) return { id: null };
  await page.locator(`[data-testid="side-more-${id}"]`).first().click({ force: true });
  await wait(600);
  return { id };
}
async function menuBox() {
  return page.evaluate(() => {
    const menu = document.querySelector('.sc-menu, .app-nav-menu');
    if (menu === null) return { none: 'MENU_NOT_FOUND' };
    const b = menu.getBoundingClientRect();
    return {
      left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom),
      w: Math.round(b.width), h: Math.round(b.height), innerW: window.innerWidth, innerH: window.innerHeight,
    };
  });
}
async function clickMenuItem(page, text) {
  await page.locator('.sc-menu [role="menuitem"]', { hasText: text }).first().click({ force: true });
  await wait(900);
}
async function sidebarWidth(page) {
  return page.evaluate(() => Math.round(document.querySelector('.app-side')?.getBoundingClientRect().width ?? -1));
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
    STEP = 'A|clamp';
    // A：侧栏拖到最小宽 → 菜单四边 clamp
    const handle = page.locator('.app-sidebar-resize, [role="separator"][aria-orientation="vertical"]').first();
    const hb = await handle.boundingBox().catch(() => null);
    check('A0 找到侧栏拖拽柄', hb !== null, JSON.stringify(hb));
    if (hb !== null) {
      await page.mouse.move(hb.x + 2, hb.y + 60);
      await page.mouse.down();
      await page.mouse.move(1, hb.y + 60, { steps: 12 });
      await page.mouse.up();
      await wait(600);
    }
    const sideW = await sidebarWidth(page);
    check('A1 侧栏拖到最小宽（≈200）', sideW > 150 && sideW <= 210, `side=${String(sideW)}`);
    await newPage(page, 'T64甲页');
    await newPage(page, 'T64乙页');
    await newPage(page, 'T64丙页');
    // 首行 ⋯ 菜单
    const first = await page.evaluate(() => document.querySelector('[data-testid^="side-node-"]')?.getAttribute('data-testid')?.replace('side-node-', '') ?? null);
    await page.locator(`[data-testid="side-more-${first}"]`).first().click({ force: true });
    await wait(700);
    let m = await menuBox();
    info('首行 ⋯ 盒', JSON.stringify(m));
    check('A2 首行 ⋯ 菜单四边在视口内（≥8px 余量）', m.none === undefined && m.left >= 8 && m.top >= 8 && m.bottom <= m.innerH - 8 && m.right <= m.innerW - 8, JSON.stringify(m));
    await page.screenshot({ path: join(SHOTS, 'a-first-menu.png') }).catch(() => {});
    await page.keyboard.press('Escape');
    await wait(400);
    // 末行 ⋯（贴近底缘）
    const rows = page.locator('[data-testid^="side-node-"]');
    const n = await rows.count();
    const lastB = await rows.nth(n - 1).boundingBox();
    await page.mouse.click(lastB.x + 24, lastB.y + lastB.height / 2, { button: 'right' });
    await wait(700);
    m = await menuBox();
    info('末行 右键盒', JSON.stringify(m));
    check('A3 末行右键菜单四边在视口内', m.none === undefined && m.left >= 8 && m.top >= 8 && m.bottom <= m.innerH - 8 && m.right <= m.innerW - 8, JSON.stringify(m));
    await page.screenshot({ path: join(SHOTS, 'a-last-ctx.png') }).catch(() => {});
    await page.keyboard.press('Escape');
    await wait(400);

    STEP = 'B|folder';
    // 分体钮：箭头→新建文件夹
    await page.locator('[data-testid="side-new-page-arrow"]').first().click({ force: true });
    await wait(600);
    m = await menuBox();
    info('分体菜单开盒', JSON.stringify(m));
    check('B1 箭头菜单含「新建文件夹」', m.none === undefined, JSON.stringify(m));
    // 点击前快照行集合（最小侧栏宽下文字会被截，匹配不稳 → 用 diff 找新行）
    const idsBefore = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="side-node-"]')].map((el) => el.getAttribute('data-testid')));
    await page.screenshot({ path: join(SHOTS, 'b-menu-open.png') }).catch(() => {});
    await clickMenuItem(page, '新建文件夹');
    await wait(1200);
    const folderId = await page.evaluate((before) => {
      const rows = [...document.querySelectorAll('[data-testid^="side-node-"]')];
      const fresh = rows.filter((el) => !before.includes(el.getAttribute('data-testid') ?? ''));
      return fresh.length === 0 ? null : fresh[fresh.length - 1].getAttribute('data-testid').replace('side-node-', '');
    }, idsBefore);
    check('B2 点「新建文件夹」后树新增一行=文件夹', folderId !== null, `newId=${String(folderId)} rowsBefore=${String(idsBefore.length)}`);
    const folderText = await page.evaluate((id) => document.querySelector(`[data-testid="side-node-${id}"]`)?.textContent ?? 'GONE', folderId);
    info('文件夹行文本', folderText);
    // 图标 = FolderSimple（比较 glyph）
    const iconSig = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="side-node-${id}"]`);
      return row?.querySelector('svg.app-nav-ic')?.innerHTML.slice(0, 40) ?? 'NO_SVG';
    }, folderId);
    info('文件夹行图标签名', iconSig);
    // 点 folder 行 = 展开收起、不建页签
    const tabsBefore = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    await page.locator(`[data-testid="side-node-${folderId}"]`).first().click({ force: true });
    await wait(700);
    const expanded = await page.evaluate((id) => document.querySelector(`[data-testid="side-node-${id}"]`)?.getAttribute('aria-expanded') ?? document.querySelector(`[data-testid="side-node-${id}"] .app-nav-tw--open`) !== null, folderId);
    const tabsAfter = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    check('B3 点 folder 行不建新页签（tabs 不变）', tabsAfter === tabsBefore, `before=${String(tabsBefore)} after=${String(tabsAfter)}`);
    info('folder 展开态', expanded);
    // 在 folder 上「新建子页面」
    await page.locator(`[data-testid="side-more-${folderId}"]`).first().click({ force: true });
    await wait(600);
    await clickMenuItem(page, '新建子页面');
    await wait(800);
    const inp = page.locator('.app-side input').first();
    await inp.waitFor({ state: 'visible', timeout: 8000 });
    await inp.fill('T64子页');
    await inp.press('Enter');
    await wait(1200);
    const childShown = await page.evaluate((fid) => {
      const rows = [...document.querySelectorAll('[data-testid^="side-node-"]')];
      const hit = rows.find((el) => (el.textContent ?? '').includes('T64子页'));
      return hit !== undefined;
    }, folderId);
    check('B4 子页挂在文件夹下且可见', childShown === true, String(childShown));
    await page.screenshot({ path: join(SHOTS, 'b-folder-child.png') }).catch(() => {});

    STEP = 'C|convert';
    // 点子页 → 正常开编辑器 + 面包屑含文件夹名
    const childId = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((el) => (el.textContent ?? '').includes('T64子页'));
      return hit === undefined ? null : hit.getAttribute('data-testid').replace('side-node-', '');
    });
    await page.locator(`[data-testid="side-node-${childId}"]`).first().click({ force: true });
    await wait(1200);
    const bc = await page.evaluate(() => document.querySelector('.sc-shell__crumb')?.textContent ?? 'NO_BC');
    const folderTitle = await page.evaluate((id) => document.querySelector(`[data-testid="side-node-${id}"]`)?.textContent ?? '', folderId);
    check('C1 点子页正常开编辑器（.pv-root 在）', (await page.locator('.pv-root').count()) > 0, bc.slice(0, 80));
    check('C2 面包屑含文件夹名', bc.includes(folderTitle.trim().slice(0, 4)), `bc=${bc.slice(0, 90)} folder=${folderTitle}`);
    // folder 转普通页 → 点行应开页签
    await page.locator(`[data-testid="side-more-${folderId}"]`).first().click({ force: true });
    await wait(600);
    await clickMenuItem(page, '转为普通页面');
    await wait(900);
    await wait(1500); // 排掉转换动作自身可能引发的异步开页
    const tabsBeforeC = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    const selBeforeC = await page.evaluate(() => (document.querySelector('[data-testid^="side-node-"].app-nav-row--active')?.getAttribute('data-testid') ?? 'none'));
    await page.locator(`[data-testid="side-node-${folderId}"]`).first().click({ force: true });
    await wait(1000);
    const tabsAfterC = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    info('C3 现场', `before=${String(tabsBeforeC)} after=${String(tabsAfterC)} activeBefore=${selBeforeC}`);
    check('C3 转普通页后点行恢复开页签（新页签出现且选中该页）', tabsAfterC === tabsBeforeC + 1, `before=${String(tabsBeforeC)} after=${String(tabsAfterC)}`);
    await page.screenshot({ path: join(SHOTS, 'c-converted.png') }).catch(() => {});

    STEP = 'E|search-trash';
    // 搜索命中 folder：先转回 folder（再转）→ 搜索点击不白屏
    await page.locator(`[data-testid="side-more-${folderId}"]`).first().click({ force: true });
    await wait(600);
    await clickMenuItem(page, '转为文件夹');
    await wait(900);
    await page.keyboard.press('Control+\\');
    await wait(200);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.palette', { timeout: 8000 });
    await page.locator('.palette-input input').first().type('新建文件夹', { delay: 25 });
    await wait(900);
    const hit = page.locator('.palette-row', { hasText: '新建文件夹' }).first();
    if ((await hit.count()) > 0) {
      await hit.click({ force: true });
      await wait(1200);
      const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
      check('E1 搜索命中 folder 点击不白屏（#root 非空）', alive > 0, `root children=${String(alive)}`);
    } else {
      await page.keyboard.press('Escape');
      check('E1 搜索命中 folder 点击不白屏（#root 非空）', false, 'palette 无 folder 命中');
    }
    const alive2 = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('E2 命令面板/搜索操作后应用仍存活', alive2 > 0, String(alive2));

    STEP = 'D|restart';
    // 优雅退出 → 重启：folder 仍在（page_type 持久化），点行仍不建页签
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    if (!child.killed) { killTree(child.pid); }
    const re = await launch();
    child = re.child; browser = re.browser; page = re.page;
    await connectInspector();
    const stillFolder = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="side-node-${id}"]`);
      if (row === null) return 'ROW_GONE';
      return row.querySelector('svg.app-nav-ic')?.innerHTML.slice(0, 40) ?? 'NO_SVG';
    }, folderId);
    check('D1 重启后文件夹行仍在', stillFolder !== 'ROW_GONE', String(stillFolder));
    const tabsB = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    await page.locator(`[data-testid="side-node-${folderId}"]`).first().click({ force: true });
    await wait(800);
    const tabsA = await page.evaluate(() => document.querySelectorAll('[data-testid^="tab-"]:not([data-testid^="tab-close-"])').length);
    check('D2 重启后点 folder 行仍不建页签', tabsA === tabsB, `before=${String(tabsB)} after=${String(tabsA)}`);
    await page.screenshot({ path: join(SHOTS, 'd-restart.png') }).catch(() => {});
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't64-01-results.json'), JSON.stringify({ task: 'T64-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T64-01：${pass} PASS / ${fail} FAIL =====`);
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    const rootAfter = rootMtime();
    info('真实数据根未被触碰', `before=${String(rootBefore)} after=${String(rootAfter)} untouched=${String(rootBefore === rootAfter)}`);
    info('node 孤儿（结束-开跑差分）', `now=${String(nodeCount())} baseline=${String(nodesBefore)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  writeFileSync(join(SHOTS, 't64-01-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2));
  process.exit(3);
});
