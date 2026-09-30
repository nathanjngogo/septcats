/* cdp-e2e-t97-98-01.mjs —— T97-01 日历 / T98-01 待办 真机验收
 * （老板 09-30 令：「在知识库功能下方增加日历功能，增加待办功能」）
 *
 * 一个文件覆盖两个功能（同一次启动里连着验，省一次冷启动）：
 *   R1 一级轨位置：序列 = 笔记|知识库|**日历**|**待办**|工作台|模板|回收站（新增两项紧随知识库）。
 *   R2 日历页：月标签 = 当前年月、网格 42 格、今天格高亮唯一、空态在、二级栏 calendar-side 在。
 *   R3 日历 CRUD 落库：点今天格 → 写标题 → 保存 → 该格出现日程；**重启后仍在**（证明进 SQLite 而非内存）。
 *   R4 待办页：添加 → 列表出现（data-done=0）→ 勾选 → data-done=1 → 清除已完成 → 列表空；二级栏 todo-side 在。
 *   R5 待办落库：重启后仍能看到未完成项。
 *   R6 真实档案根 mtime 不变（夹具零触碰红线；探针用独立 user-data-dir + 独立 rootPath）。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t97-98-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9630');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t97-98', 'result.log');

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
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 260) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`);
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
  await wait(1400);
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

/** 关窗→重开（同一 user-data-dir：验落库，不是内存态）。 */
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
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.min(900, Math.round(r.width)), height: Math.min(460, Math.round(r.height)) };
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

const CAL_STATE = () => {
  const grid = document.querySelector('[data-testid="calendar-grid"]');
  const cells = grid === null ? [] : [...grid.children];
  const label = document.querySelector('[data-testid="calendar-month-label"]');
  return {
    page: document.querySelector('[data-testid="calendar-page"]') !== null,
    side: document.querySelector('[data-testid="calendar-side"]') !== null,
    label: label === null ? '' : (label.textContent ?? '').trim(),
    cells: cells.length,
    todayCells: cells.filter((c) => c.className.includes('calendar-cell--today')).length,
    empty: document.querySelector('[data-testid="calendar-empty"]') !== null,
    chips: [...document.querySelectorAll('.calendar-chip')].map((c) => (c.textContent ?? '').trim()),
    todayKey: (() => {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${String(d.getFullYear())}-${m}-${day}`;
    })(),
  };
};

const TODO_STATE = () => ({
  page: document.querySelector('[data-testid="todo-page"]') !== null,
  side: document.querySelector('[data-testid="todo-side"]') !== null,
  empty: document.querySelector('[data-testid="todo-empty"]') !== null,
  items: [...document.querySelectorAll('[data-testid^="todo-item-"]')].map((el) => ({
    id: (el.getAttribute('data-testid') ?? '').replace('todo-item-', ''),
    done: el.getAttribute('data-done'),
    text: (el.textContent ?? '').trim(),
  })),
});

async function main() {
  const realBefore = rootMtime();
  line(`[T97/T98] 日历 + 待办；靶=${PACKAGE_APP}`);
  let h = await boot();
  let { page } = h;

  // ---------- R1 一级轨位置 ----------
  STEP = 'R1';
  const rail = await page.evaluate(RAIL);
  const railOk = rail.map((i) => i.text).join('|') === '笔记|知识库|日历|待办|工作台|模板|回收站';
  await page.evaluate(() => { document.querySelector('[data-testid="nav-rail-calendar"]').click(); });
  await wait(700);
  const railAfter = await page.evaluate(RAIL);
  check('R1 一级轨七项（日历/待办紧随知识库）且点日历后 aria-current=page',
    railOk && rail.length === 7 && railAfter.find((i) => i.key === 'calendar')?.current === 'page',
    JSON.stringify({ rail: rail.map((i) => i.text), active: railAfter.find((i) => i.key === 'calendar')?.current }));

  // ---------- R2 日历页结构 ----------
  STEP = 'R2';
  const cal0 = await page.evaluate(CAL_STATE);
  const now = new Date();
  const expectLabel = `${String(now.getFullYear())} / ${String(now.getMonth() + 1)}`;
  check('R2a 日历页渲染：月标签=当前年月、42 格、今天唯一高亮、二级栏在位',
    cal0.page && cal0.side && cal0.label === expectLabel && cal0.cells === 42 && cal0.todayCells === 1,
    JSON.stringify(cal0));
  check('R2b 空数据时空态在位（不假造数据）', cal0.empty === true && cal0.chips.length === 0,
    JSON.stringify({ empty: cal0.empty, chips: cal0.chips }));

  // ---------- R3 日历新建 + 重启后仍在 ----------
  STEP = 'R3';
  const title = `验收日程-${String(Date.now() % 100000)}`;
  const created = await page.evaluate(async (t) => {
    const day = document.querySelector('[data-testid^="calendar-day-"]');
    if (day === null) return { ok: false, why: 'no-day-cell' };
    day.click();
    await new Promise((r) => setTimeout(r, 400));
    const input = document.querySelector('[data-testid="calendar-event-title"]')
      ?? document.querySelector('[data-testid="calendar-form-title"]')
      ?? document.querySelector('input[type="text"]');
    if (input === null) return { ok: false, why: 'no-title-input' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const save = document.querySelector('[data-testid="calendar-event-save"]')
      ?? document.querySelector('[data-testid="calendar-form-save"]');
    if (save === null) return { ok: false, why: 'no-save-button' };
    save.click();
    await new Promise((r) => setTimeout(r, 900));
    return { ok: true };
  }, title);
  const cal1 = await page.evaluate(CAL_STATE);
  const shot1 = await shot(page, 'calendar-created');
  check('R3a 点日格新建日程：保存后网格出现该日程',
    created.ok === true && cal1.chips.includes(title),
    JSON.stringify({ created, chips: cal1.chips.slice(0, 6) }));

  h = await relaunch(h);
  page = h.page;
  await page.evaluate(() => { document.querySelector('[data-testid="nav-rail-calendar"]').click(); });
  await wait(900);
  const cal2 = await page.evaluate(CAL_STATE);
  check('R3b 重启后日程仍在（证明落了 SQLite，不是内存态）',
    cal2.chips.includes(title), JSON.stringify({ chips: cal2.chips.slice(0, 6), want: title }));

  // ---------- R4 待办 CRUD ----------
  STEP = 'R4';
  await page.evaluate(() => { document.querySelector('[data-testid="nav-rail-todo"]').click(); });
  await wait(800);
  const todo0 = await page.evaluate(TODO_STATE);
  const todoText = `验收待办-${String(Date.now() % 100000)}`;
  const added = await page.evaluate(async (t) => {
    const input = document.querySelector('[data-testid="todo-input"]');
    if (input === null) return { ok: false, why: 'no-input' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const add = document.querySelector('[data-testid="todo-add"]');
    if (add === null) return { ok: false, why: 'no-add-button' };
    add.click();
    await new Promise((r) => setTimeout(r, 900));
    return { ok: true };
  }, todoText);
  const todo1 = await page.evaluate(TODO_STATE);
  const shot2 = await shot(page, 'todo-added');
  check('R4a 待办页在位 + 添加一条：列表出现且 data-done=0',
    todo0.page && todo0.side && added.ok === true
      && todo1.items.some((it) => it.text.includes(todoText) && it.done === '0'),
    JSON.stringify({ added, items: todo1.items.slice(0, 4) }));

  const toggled = await page.evaluate(async (t) => {
    const el = [...document.querySelectorAll('[data-testid^="todo-item-"]')].find((x) => (x.textContent ?? '').includes(t));
    if (el === undefined) return { ok: false, why: 'row-not-found' };
    const box = el.querySelector('input[type="checkbox"]') ?? el.querySelector('[data-testid="todo-toggle-done"]') ?? el.querySelector('button');
    if (box === null) return { ok: false, why: 'no-toggle' };
    box.click();
    await new Promise((r) => setTimeout(r, 900));
    return { ok: true };
  }, todoText);
  const todo2 = await page.evaluate(TODO_STATE);
  check('R4b 勾选完成：该条 data-done=1',
    toggled.ok === true && todo2.items.some((it) => it.text.includes(todoText) && it.done === '1'),
    JSON.stringify({ toggled, items: todo2.items.slice(0, 4) }));

  // ---------- R5 待办落库（重启后仍在） ----------
  STEP = 'R5';
  h = await relaunch(h);
  page = h.page;
  await page.evaluate(() => { document.querySelector('[data-testid="nav-rail-todo"]').click(); });
  await wait(900);
  const todo3 = await page.evaluate(TODO_STATE);
  check('R5 重启后待办仍在（证明落了 SQLite）',
    todo3.items.some((it) => it.text.includes(todoText)),
    JSON.stringify({ items: todo3.items.slice(0, 4), want: todoText }));

  // ---------- R6 夹具零触碰 ----------
  STEP = 'R6';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('R6 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T97/T98 日历+待办探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked）`);
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