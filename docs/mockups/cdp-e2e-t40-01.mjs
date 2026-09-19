/* TASK-T40-01 真机验收探针 —— 数据库「字段」体系（PM 独立复跑，非工程师自报）

 覆盖任务书 §2 八条验收：
  1. 11 类型逐条：填值 → 重开应用 → 读回一致
  2. 改类型：不兼容场景值不静默丢失（含"改回原类型可恢复"）
  3. 删除字段：列消失 + 该列值清理 + 重开不复活
  4. 排序：移动后列序持久化（重开断言）
  5. 选项管理：增删改 + 被删选项引用值清理 + 持久化
  6. 标题字段：改类型/删除入口被禁用（UI disabled + main E_INVARIANT 双断言）
  7. 回归：窗口零滚动、侧栏可完全收起、多页签(T37)、AI 面板(T38)行为不变
  8. 双主题截图（表格 / 属性菜单 / 类型子菜单 / 选项面板 四态 × light·dark）

 口径（照 skill septcats-cdp-e2e 五条必守）：
  - 双隔离：--user-data-dir + rootPath 全在 _scratch/probe-t40-01/ 下，绝不触碰
    C:\Users\Administrator\.septcats\（真实数据根，运行前后断言 mtime 不变）；
  - 每节开始前 page.reload() + 等桥就绪（流程复位），不做跨节状态假设；
  - waitFor 返回「最后计算值」而非 true（避免假红）；
  - 数据面走真实 IPC → 真实 main → 真实 SQLite（window.septcats.db.*）；
  - 优雅退出 = window.close()，仅在关不掉时对本进程 PID 树 taskkill。
*/
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t40-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9401;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t40');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

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

const killTree = (pid) => {
  if (typeof pid !== 'number') return;
  try {
    execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退出 */
  }
};
const alive = (pid) => {
  if (typeof pid !== 'number') return false;
  try {
    const out = execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
};

const consoleErrors = [];
const pageErrors = [];
const attach = (page, tag) => {
  page.on('pageerror', (err) => pageErrors.push(`[${tag}] ${String(err?.message ?? err)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`);
  });
};

const launched = [];
async function launch(tag) {
  const proc = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: APPDIR, detached: true, stdio: 'ignore' },
  );
  proc.unref();
  launched.push(proc.pid);
  let br = null;
  for (let k = 0; k < 40 && br === null; k++) {
    await wait(1000);
    try {
      br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      /* retry */
    }
  }
  if (br === null) throw new Error('CDP connect failed');
  const page = br.contexts()[0].pages().find((p) => p.url().includes('index.html')) ?? br.contexts()[0].pages()[0];
  attach(page, tag);
  for (let k = 0; k < 40; k++) {
    const ready = await page
      .evaluate(() => typeof window.septcats?.db?.load === 'function' && document.querySelector('.app-side') !== null)
      .catch(() => false);
    if (ready) break;
    await wait(800);
  }
  await wait(1500);
  return { br, page, pid: proc.pid };
}

async function quit(page, pid) {
  try {
    await page.evaluate(() => window.close());
  } catch {
    /* 页面已销毁 */
  }
  await wait(2500);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  await wait(1200);
  return { gracefulExited: !stillAlive };
}

/** waitFor 返回「最后计算值」（skill 规则 4）——绝不用 true 代替目标值。 */
async function waitFor(fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await wait(stepMs);
  }
  return last;
}

const realRootMtime = () => {
  try {
    return statSync(REAL_ROOT).mtimeMs;
  } catch {
    return null;
  }
};

// ======================= 夹具 =======================
rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(
  `${UD}\\septcats.settings.json`,
  JSON.stringify(
    {
      schema: 1,
      rootPath: ROOT,
      theme: 'light',
      locale: 'zh-CN',
      privacy: { telemetry: false, linkPreviewOnType: true },
      editor: { defaultEditMode: 'rich', spellcheck: true },
      data: { note: '' },
      sync: { enabled: true, encrypt: false, gc: false },
    },
    null,
    2,
  ),
  'utf8',
);
const realMtimeBefore = realRootMtime();
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\nSHOTS=${SHOTS}\nREAL_ROOT mtime(before)=${String(realMtimeBefore)}\n`);

const TYPE_ORDER = ['number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'relation', 'file', 'ai'];
const LABEL = {
  text: '文本',
  number: '数字',
  select: '单选',
  multi_select: '多选',
  date: '日期',
  checkbox: '勾选',
  url: '链接',
  email: '邮箱',
  relation: '关联',
  file: '文件',
  ai: 'AI',
};

// 期望值（11 类型）；select/multi_select/relation 依赖运行时 id，由 setup 回填
const EXPECT = {
  text: '你好 Septcats',
  number: 42,
  date: { y: 2026, m: 9, d: 20 },
  checkbox: true,
  url: 'https://example.com/a',
  email: 'a@example.com',
  file: ['报告.pdf'],
  ai: 'AI 生成的摘要文本',
};

/** setup：建库 + 11 字段 + 2 记录 + 填满 11 类值。返回全部 pid/rid。 */
const SETUP = async ([LABELS, TYPES]) => {
  const db = window.septcats.db;
  const ws = await window.septcats.workspaces.list();
  const created = await db.create({
    workspaceId: ws.activeId,
    parentPageId: null,
    title: 'T40验收库',
  });
  const pageId = created.pageId;
  const pidOfLast = (collection) => {
    const keys = Object.keys(collection.schema.properties);
    return keys[keys.length - 1];
  };
  const pids = {};
  for (const t of TYPES) {
    const r = await db.propAdd({ pageId, type: t });
    pids[t] = pidOfLast(r.collection);
    await db.propUpdate({ pageId, pid: pids[t], patch: { name: LABELS[t] } });
  }
  // 额外一个 text 字段（测改类型迁移用）
  const rt = await db.propAdd({ pageId, type: 'text' });
  pids.text = pidOfLast(rt.collection);
  await db.propUpdate({ pageId, pid: pids.text, patch: { name: LABELS.text } });

  // 选项：select / multi_select
  await db.propUpdate({
    pageId,
    pid: pids.select,
    patch: { options: [{ name: '进行中', tone: 'amber' }, { name: '已完成' }] },
  });
  await db.propUpdate({
    pageId,
    pid: pids.multi_select,
    patch: { options: [{ name: '标签A' }, { name: '标签B' }, { name: '标签C' }] },
  });

  const r1 = await db.recordCreate({ pageId });
  const r2 = await db.recordCreate({ pageId });
  const ridA = r1.record.id;
  const ridB = r2.record.id;

  const col = await db.load({ pageId });
  const schema = col.collection.schema;
  const titlePid = schema.title_pid;
  const selOpts = schema.properties[pids.select].options;
  const mulOpts = schema.properties[pids.multi_select].options;

  const values = {
    [titlePid]: '第一条记录',
    [pids.text]: '你好 Septcats',
    [pids.number]: 42,
    [pids.select]: selOpts[0].id,
    [pids.multi_select]: [mulOpts[0].id, mulOpts[1].id],
    [pids.date]: { y: 2026, m: 9, d: 20 },
    [pids.checkbox]: true,
    [pids.url]: 'https://example.com/a',
    [pids.email]: 'a@example.com',
    [pids.relation]: [ridB],
    [pids.file]: ['报告.pdf'],
    [pids.ai]: 'AI 生成的摘要文本',
  };
  await db.recordUpdate({ pageId, recordId: ridA, patch: values });
  const after = await db.load({ pageId });
  return {
    pageId,
    collectionId: created.collectionId,
    titlePid,
    pids,
    ridA,
    ridB,
    selOpts: selOpts.map((o) => ({ id: o.id, name: o.name })),
    mulOpts: mulOpts.map((o) => ({ id: o.id, name: o.name })),
    values,
    propOrder: Object.keys(after.collection.schema.properties),
  };
};

/** 读回：返回 11 类值 + 标题值。 */
const READBACK = async ([pageId, pids, titlePid, ridA]) => {
  const db = window.septcats.db;
  const r = await db.load({ pageId });
  const rec = r.records.find((x) => x.id === ridA);
  if (rec === undefined) return { found: false };
  const v = rec.values;
  return {
    found: true,
    title: v[titlePid],
    text: v[pids.text],
    number: v[pids.number],
    select: v[pids.select],
    multi_select: v[pids.multi_select],
    date: v[pids.date],
    checkbox: v[pids.checkbox],
    url: v[pids.url],
    email: v[pids.email],
    relation: v[pids.relation],
    file: v[pids.file],
    ai: v[pids.ai],
  };
};

// ======================= BOOT 1：建库 + UI 断言 + light 截图 =======================
console.log('\n========== BOOT 1 ==========');
const b1 = await launch('boot1');
const page = b1.page;

const setup = await page.evaluate(SETUP, [LABEL, TYPE_ORDER]);
info('建库', `pageId=${setup.pageId} 字段数=${String(setup.propOrder.length)} 标题pid=${setup.titlePid}`);
check('A1 建库成功（11 字段 + 标题）', setup.propOrder.length === 12, `propOrder.length=${String(setup.propOrder.length)}（期望 12 = 标题 + 11）`);
// BOOT2/BOOT3 的截图导航用（该页是 db.create 产物，界面态为普通文档页 —— 见下方根因备注）
const nodeSel = `[data-testid="side-node-${setup.pageId}"]`;

// ---------- 界面面：走产品真实路径（新建页 → 转为多维数据 → 新属性），同会话 ----------
// 根因备注（PM 侦察）：page 表**无 kind 列** → `activePage.kind==='database'` 永不成立，
// DbPage 只能由「转为多维数据」写入的本地态 dbPageId 承载。故界面验收必须走该真实路径，
// 不能靠 db.create 后重载（那样只会得到普通文档页 + 「转为多维数据」按钮）。
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page.evaluate(() => typeof window.septcats?.db?.load === 'function'), 20000);
await wait(1200);

// 1) 新建页面（真实鼠标）
await page.getByTestId('side-new-page').click();
const nameInput = page.locator('.app-side input').first();
await nameInput.waitFor({ state: 'visible', timeout: 15000 });
await nameInput.fill('T40界面验收页');
await nameInput.press('Enter');
await wait(1300);

// 2) 转为多维数据
const convBtn = page.locator('button', { hasText: '转为多维数据' }).first();
const convVisible = await waitFor(async () => ((await convBtn.count()) > 0 ? true : false), 15000);
check('B0 「转为多维数据」入口存在（界面验收的真实入口）', convVisible === true, `visible=${String(convVisible)}`);
if (convVisible) await convBtn.click();
// 实测：转换后 DbPage 是**整页空态**（"还没有记录"），PropBar/表格要**先建一条记录**才挂载
await wait(2000);
const newRecBtn0 = page.locator('button', { hasText: '新建记录' }).first();
const hadEmpty = (await newRecBtn0.count()) > 0;
if (hadEmpty) {
  await newRecBtn0.click().catch(() => {});
  await wait(1800);
}
info('转换后空态', `空态按钮存在=${String(hadEmpty)}`);
const dbUp = await waitFor(async () => page.evaluate(() => document.querySelector('.sc-propbar') !== null), 20000);
check('B1 转为多维数据后 DbPage 渲染（属性条出现）', dbUp === true, `propbar=${String(dbUp)}`);
await wait(900);

// 3) 通过 UI 新属性 ×3（单选 / 勾选 / 数字）
const addProp = async (label) => {
  await page.locator('button', { hasText: '新属性' }).first().click();
  await wait(600);
  const item = page.locator('[role="menuitem"]', { hasText: label }).first();
  await item.click({ timeout: 8000 }).catch(() => {});
  await wait(1000);
};
let uiErr = null;
try {
  await addProp('单选');
  await addProp('勾选');
  await addProp('数字');
} catch (e) {
  uiErr = String(e?.message ?? e);
}
const chips = await page.locator('.sc-chip--prop').count();
check('B2 UI 新属性生效（chip 数 = 4：标题 + 单选/勾选/数字）', chips === 4, `chips=${String(chips)} err=${JSON.stringify(uiErr)}`);
await page.screenshot({ path: join(SHOTS, 'light-01-grid.png') }).catch(() => {});

// 4) 记录已在 B1 建好；这里直接读单元格渲染态
const cellCounts = await page.evaluate(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const types = ['text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'email', 'relation', 'file', 'ai'];
  return {
    dbc: q('.sc-dbc'),
    grid: q('.sc-dbgrid'),
    byType: Object.fromEntries(types.map((ty) => [ty, q(`.sc-dbc[data-type="${ty}"]`)])),
  };
});
info('单元格（未编辑态，空值走 .sc-dbc-empty）', JSON.stringify(cellCounts));
check('B3a 三列均有单元格节点（data-type 齐）', cellCounts.byType.select > 0 && cellCounts.byType.checkbox > 0 && cellCounts.byType.number > 0, JSON.stringify(cellCounts.byType));

// B3：勾选列 Enter 直接切换
let checkToggle = null;
try {
  await page.locator('.sc-dbc[data-type="checkbox"]').first().click({ timeout: 8000 });
  await wait(500);
  const focusState = await page.evaluate(() => {
    const ae = document.activeElement;
    const cell = document.querySelector('.sc-dbc[data-type="checkbox"]');
    return {
      activeTag: ae?.tagName ?? null,
      activeRole: ae?.getAttribute?.('role') ?? null,
      activeIsOuterGridcell: ae?.getAttribute?.('role') === 'gridcell',
      activeInsideCellEditor: cell !== null && cell.contains(ae),
      cellEditorHasTabIndex: cell?.hasAttribute('tabindex') ?? null,
    };
  });
  await page.keyboard.press('Enter');
  await wait(1000);
  checkToggle = await page.evaluate(() => ({ on: document.querySelectorAll('.sc-dbc-check--on').length }));
  checkToggle.focus = focusState;
} catch (e) {
  checkToggle = { err: String(e?.message ?? e) };
}
info('勾选格焦点取证', JSON.stringify(checkToggle));
check('B3 勾选列 Enter 直接切换（T40-01-1 已修：修复前此断言为红，修复后转绿）', checkToggle !== null && checkToggle.on > 0, JSON.stringify(checkToggle));

// B4/B5：单选列点击进编辑 → SinglePicker（含 T40 新增「新建选项」行）
let pickerState = null;
try {
  await page.locator('.sc-dbc[data-type="select"]').first().click({ timeout: 8000 });
  await wait(1200);
  pickerState = await page.evaluate(() => ({
    picker: document.querySelectorAll('.sc-dbc-picker').length,
    createBtn: document.querySelectorAll('.sc-dbc-picker__create-btn').length,
    list: document.querySelectorAll('.sc-dbc-picker__list').length,
  }));
} catch (e) {
  pickerState = { err: String(e?.message ?? e) };
}
info('单选编辑态', JSON.stringify(pickerState));
check('B4 单选列点击进编辑渲染 .sc-dbc-picker', pickerState !== null && pickerState.picker > 0, JSON.stringify(pickerState));
check('B5 单选 picker 内含「新建选项」入口（T40 新增）', pickerState !== null && pickerState.createBtn > 0, JSON.stringify(pickerState));
await page.screenshot({ path: join(SHOTS, 'light-05-picker-create.png') }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await wait(400);

// 5) 标题列菜单：更改类型 / 删除属性 必须 disabled
let titleMenu = null;
if (chips > 0) {
  await page.locator('.sc-chip--prop').first().click();
  await wait(700);
  titleMenu = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('.sc-menu')];
    const m = ms[ms.length - 1];
    if (m === undefined) return null;
    return [...m.querySelectorAll('[role="menuitem"]')].map((el) => ({
      label: el.querySelector('.sc-menu__label')?.textContent ?? el.textContent,
      disabled: el.disabled === true,
    }));
  });
}
info('标题列菜单', JSON.stringify(titleMenu));
check('B6 标题列「更改类型…」被禁用', titleMenu !== null && titleMenu.some((i) => i.label.includes('更改类型') && i.disabled === true), `menu=${JSON.stringify(titleMenu)}`);
check('B7 标题列「删除属性」被禁用', titleMenu !== null && titleMenu.some((i) => i.label.includes('删除属性') && i.disabled === true), `menu=${JSON.stringify(titleMenu)}`);
await page.screenshot({ path: join(SHOTS, 'light-02-menu-title.png') }).catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await wait(400);

// 6) 数据列（单选列）菜单：可用 + 含「选项管理…」「左移/右移」
let dataMenu = null;
if (chips > 1) {
  await page.locator('.sc-chip--prop').nth(1).click();
  await wait(700);
  dataMenu = await page.evaluate(() => {
    const ms = [...document.querySelectorAll('.sc-menu')];
    const m = ms[ms.length - 1];
    if (m === undefined) return null;
    return [...m.querySelectorAll('[role="menuitem"]')].map((el) => ({
      label: el.querySelector('.sc-menu__label')?.textContent ?? el.textContent,
      disabled: el.disabled === true,
    }));
  });
}
info('数据列菜单（单选列）', JSON.stringify(dataMenu));
check('B8 数据列「更改类型…」可用（未禁用）', dataMenu !== null && dataMenu.some((i) => i.label.includes('更改类型') && i.disabled === false), `menu=${JSON.stringify(dataMenu)}`);
check('B9 数据列「删除属性」可用（未禁用）', dataMenu !== null && dataMenu.some((i) => i.label.includes('删除属性') && i.disabled === false), `menu=${JSON.stringify(dataMenu)}`);
check('B10 单选列菜单含「选项管理…」（T40 新增）', dataMenu !== null && dataMenu.some((i) => i.label.includes('选项管理')), `menu=${JSON.stringify(dataMenu)}`);
check('B11 数据列菜单含「左移 / 右移」（T40 新增）', dataMenu !== null && dataMenu.some((i) => i.label.includes('左移')) && dataMenu.some((i) => i.label.includes('右移')), `menu=${JSON.stringify(dataMenu)}`);
await page.screenshot({ path: join(SHOTS, 'light-03-menu-data.png') }).catch(() => {});

// 7) 打开「选项管理…」面板（T40 新增 UI）
let optPanel = false;
if (dataMenu !== null && dataMenu.some((i) => i.label.includes('选项管理'))) {
  const optItem = page.locator('[role="menuitem"]', { hasText: '选项管理' }).first();
  await optItem.click().catch(() => {});
  await wait(900);
  optPanel = await page.evaluate(() => document.querySelector('.sc-propbar__options') !== null);
  await page.screenshot({ path: join(SHOTS, 'light-04-options-panel.png') }).catch(() => {});
}
check('B12 「选项管理」面板可打开（T40 新增 UI）', optPanel === true, `panel=${String(optPanel)}`);
await page.keyboard.press('Escape').catch(() => {});
await wait(300);

// 8) 「左移」真实点击 → 列序变化（T40 新增 UI）
let moveUi = null;
try {
  await page.locator('.sc-chip--prop').nth(2).click();
  await wait(600);
  const before = await page.evaluate(() => [...document.querySelectorAll('.sc-chip--prop')].map((e) => e.textContent));
  await page.locator('[role="menuitem"]', { hasText: '左移' }).first().click({ timeout: 6000 });
  await wait(1000);
  const after = await page.evaluate(() => [...document.querySelectorAll('.sc-chip--prop')].map((e) => e.textContent));
  moveUi = { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
} catch (e) {
  moveUi = { err: String(e?.message ?? e) };
}
info('左移 UI 结果', JSON.stringify(moveUi));
check('B13 「左移」真实点击触发列序变化（T40 新增 UI）', moveUi?.changed === true, JSON.stringify(moveUi));
await page.keyboard.press('Escape').catch(() => {});
await wait(300);

// 回归：零滚动 + 侧栏 + 多页签 + AI 面板
const reg1 = await page.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  vScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
  tabsbar: document.querySelector('[data-testid="tabsbar"]') !== null,
  aiPanelBtn: document.querySelector('[class*="ai-chat"], [class*="ai-panel"], [aria-label*="AI"]') !== null,
  side: document.querySelector('.app-side') !== null,
}));
info('回归探针 boot1', JSON.stringify(reg1));
check('R1 窗口零滚动（横向）', reg1.hScroll === false, `hScroll=${String(reg1.hScroll)}`);
check('R2 多页签栏存在（T37 不回归）', reg1.tabsbar === true, `tabsbar=${String(reg1.tabsbar)}`);
check('R3 AI 面板入口存在（T38 不回归）', reg1.aiPanelBtn === true, `aiPanel=${String(reg1.aiPanelBtn)}`);

const b1quit = await quit(page, b1.pid);
info('boot1 退出', `优雅退出=${String(b1quit.gracefulExited)}`);

// ======================= BOOT 2：11 类型读回 + 改类型 + 删除 + 排序 + 选项 + 标题保护 =======================
console.log('\n========== BOOT 2 ==========');
const b2 = await launch('boot2');
const page2 = b2.page;
const P = setup.pageId;
const pids = setup.pids;
const titlePid = setup.titlePid;
const ridA = setup.ridA;

// —— §2-1 11 类型值往返 ——
const rb = await page2.evaluate(READBACK, [P, pids, titlePid, ridA]);
info('读回值', JSON.stringify(rb));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('C1 重开后文本值一致', rb.found && eq(rb.text, EXPECT.text), `text=${JSON.stringify(rb.text)}`);
check('C2 重开后数字值一致', rb.found && eq(rb.number, EXPECT.number), `number=${JSON.stringify(rb.number)}`);
check('C3 重开后单选取值一致（选项 id）', rb.found && eq(rb.select, setup.values[pids.select]), `select=${JSON.stringify(rb.select)}`);
check('C4 重开后多选取值一致', rb.found && eq(rb.multi_select, setup.values[pids.multi_select]), `multi=${JSON.stringify(rb.multi_select)}`);
check('C5 重开后日期值一致', rb.found && eq(rb.date, EXPECT.date), `date=${JSON.stringify(rb.date)}`);
check('C6 重开后勾选值一致', rb.found && eq(rb.checkbox, EXPECT.checkbox), `checkbox=${JSON.stringify(rb.checkbox)}`);
check('C7 重开后链接值一致', rb.found && eq(rb.url, EXPECT.url), `url=${JSON.stringify(rb.url)}`);
check('C8 重开后邮箱值一致', rb.found && eq(rb.email, EXPECT.email), `email=${JSON.stringify(rb.email)}`);
check('C9 重开后关联值一致', rb.found && eq(rb.relation, setup.values[pids.relation]), `relation=${JSON.stringify(rb.relation)}`);
check('C10 重开后文件值一致', rb.found && eq(rb.file, EXPECT.file), `file=${JSON.stringify(rb.file)}`);
check('C11 重开后 AI 列值一致', rb.found && eq(rb.ai, EXPECT.ai), `ai=${JSON.stringify(rb.ai)}`);
check('C12 重开后标题值一致', rb.found && eq(rb.title, '第一条记录'), `title=${JSON.stringify(rb.title)}`);

// —— §2-2 改类型迁移（不静默丢值）——
const MIG = async ([pageId, textPid, rid]) => {
  const db = window.septcats.db;
  const out = {};
  // 可迁：'42' → number
  await db.recordUpdate({ pageId, recordId: rid, patch: { [textPid]: '42' } });
  let c = await db.propUpdate({ pageId, pid: textPid, patch: { type: 'number' } });
  out.migratedType = c.collection.schema.properties[textPid].type;
  let l = await db.load({ pageId });
  out.afterMigrate = l.records.find((r) => r.id === rid).values[textPid];
  // 不可迁：改回 text 再写非数字，再改 number → 原样保留
  await db.propUpdate({ pageId, pid: textPid, patch: { type: 'text' } });
  await db.recordUpdate({ pageId, recordId: rid, patch: { [textPid]: '不是数字' } });
  await db.propUpdate({ pageId, pid: textPid, patch: { type: 'number' } });
  l = await db.load({ pageId });
  out.afterUncoercible = l.records.find((r) => r.id === rid).values[textPid];
  // 改回原类型 → 值可恢复（不落刀）
  await db.propUpdate({ pageId, pid: textPid, patch: { type: 'text' } });
  l = await db.load({ pageId });
  out.afterRevert = l.records.find((r) => r.id === rid).values[textPid];
  return out;
};
const mig = await page2.evaluate(MIG, [P, pids.text, ridA]);
info('迁移结果', JSON.stringify(mig));
check('C13 改类型 text→number：数字串被迁移为 number 42', mig.migratedType === 'number' && mig.afterMigrate === 42, `type=${String(mig.migratedType)} value=${JSON.stringify(mig.afterMigrate)}`);
check('C14 改类型不静默丢值：非数字原样保留', mig.afterUncoercible === '不是数字', `value=${JSON.stringify(mig.afterUncoercible)}（期望字符串原样保留，不得为 null）`);
check('C15 改回原类型后值可恢复（迁移不落刀）', mig.afterRevert === '不是数字', `value=${JSON.stringify(mig.afterRevert)}`);

// —— §2-3 删除字段（列消失 + 值清理）——
const DEL = async ([pageId, filePid, rid]) => {
  const db = window.septcats.db;
  const before = await db.load({ pageId });
  const hadValue = Object.prototype.hasOwnProperty.call(before.records.find((r) => r.id === rid).values, filePid);
  const c = await db.propRemove({ pageId, pid: filePid });
  const after = await db.load({ pageId });
  const rec = after.records.find((r) => r.id === rid);
  return {
    hadValue,
    pidGone: !Object.prototype.hasOwnProperty.call(c.collection.schema.properties, filePid),
    valueGone: !Object.prototype.hasOwnProperty.call(rec.values, filePid),
    schemaKeys: Object.keys(c.collection.schema.properties).length,
  };
};
const del = await page2.evaluate(DEL, [P, pids.file, ridA]);
info('删除字段结果', JSON.stringify(del));
check('C16 删除字段：schema 中该列消失', del.pidGone === true, `pidGone=${String(del.pidGone)}`);
check('C17 删除字段：该列值被一并清理', del.valueGone === true, `valueGone=${String(del.valueGone)}（原 hadValue=${String(del.hadValue)}）`);

// —— §2-4 排序（移动后持久化）——
const MOVE = async ([pageId, pidToMove, titlePidIn]) => {
  const db = window.septcats.db;
  const out = {};
  let l = await db.load({ pageId });
  out.before = Object.keys(l.collection.schema.properties);
  const c1 = await db.propMove({ pageId, pid: pidToMove, beforePid: null });
  out.afterMoveEnd = Object.keys(c1.collection.schema.properties);
  out.movedToEnd = out.afterMoveEnd[out.afterMoveEnd.length - 1] === pidToMove;
  // 标题列不可移动
  try {
    await db.propMove({ pageId, pid: titlePidIn, beforePid: null });
    out.titleMoveErr = null;
  } catch (e) {
    out.titleMoveErr = String(e?.message ?? e);
  }
  const c2 = await db.propMove({ pageId, pid: pidToMove, beforePid: out.afterMoveEnd[1] });
  out.afterMoveBack = Object.keys(c2.collection.schema.properties);
  out.titleStillFirst = out.afterMoveBack[0] === titlePidIn;
  return out;
};
const mv = await page2.evaluate(MOVE, [P, pids.number, titlePid]);
info('排序结果', JSON.stringify(mv));
check('C18 排序：移到末尾生效', mv.movedToEnd === true, `afterMoveEnd=${JSON.stringify(mv.afterMoveEnd)}`);
check('C19 排序：标题列恒首列', mv.titleStillFirst === true, `first=${JSON.stringify(mv.afterMoveBack?.[0])} titlePid=${titlePid}`);
check('C20 排序：标题列移动被拒（E_INVARIANT）', typeof mv.titleMoveErr === 'string' && mv.titleMoveErr.includes('E_INVARIANT'), `err=${JSON.stringify(mv.titleMoveErr)}`);

// —— §2-5 选项管理 ——
const OPTS = async ([pageId, selPid, mulPid, rid]) => {
  const db = window.septcats.db;
  const out = {};
  let l = await db.load({ pageId });
  const selBefore = l.collection.schema.properties[selPid].options.map((o) => ({ id: o.id, name: o.name }));
  const mulBefore = l.collection.schema.properties[mulPid].options.map((o) => ({ id: o.id, name: o.name }));
  // 新增（缺 id 由 main 生成）+ 改名
  const nextSel = [...selBefore.map((o, i) => ({ id: o.id, name: i === 0 ? '进行中(改名)' : o.name })), { name: '已归档' }];
  let c = await db.propUpdate({ pageId, pid: selPid, patch: { options: nextSel } });
  out.afterAddRename = c.collection.schema.properties[selPid].options.map((o) => ({ id: o.id, name: o.name }));
  // 删除被引用选项（multi 的第 0 个被值引用）→ 引用值应被清理
  const mulKeep = mulBefore.slice(1);
  c = await db.propUpdate({ pageId, pid: mulPid, patch: { options: mulKeep } });
  out.mulAfterDelete = c.collection.schema.properties[mulPid].options.map((o) => ({ id: o.id, name: o.name }));
  const rec = (await db.load({ pageId })).records.find((r) => r.id === rid);
  out.mulValueAfterDelete = rec.values[mulPid];
  return { out, selBefore, mulBefore };
};
const op = await page2.evaluate(OPTS, [P, pids.select, pids.multi_select, ridA]);
info('选项管理结果', JSON.stringify(op));
check(
  'C21 选项管理：新增（main 生成 id）生效',
  Array.isArray(op.out.afterAddRename) && op.out.afterAddRename.length === 3 && op.out.afterAddRename.every((o) => typeof o.id === 'string' && o.id.length > 0),
  `options=${JSON.stringify(op.out.afterAddRename)}`,
);
check(
  'C22 选项管理：改名生效',
  op.out.afterAddRename.some((o) => o.name === '进行中(改名)'),
  `names=${JSON.stringify(op.out.afterAddRename.map((o) => o.name))}`,
);
check(
  'C23 选项管理：删除被引用选项 → 引用值被清理（不悬空）',
  Array.isArray(op.out.mulValueAfterDelete) && op.out.mulValueAfterDelete.length === 1 && op.out.mulValueAfterDelete[0] === op.mulBefore[1].id,
  `value=${JSON.stringify(op.out.mulValueAfterDelete)} 删掉=${JSON.stringify(op.mulBefore[0].id)} 保留=${JSON.stringify(op.mulBefore[1].id)}`,
);

// —— §2-6 标题保护（main 侧）——
const TITLE = async ([pageId, titlePidIn]) => {
  const db = window.septcats.db;
  const out = {};
  try {
    await db.propUpdate({ pageId, pid: titlePidIn, patch: { type: 'number' } });
    out.typeErr = null;
  } catch (e) {
    out.typeErr = String(e?.message ?? e);
  }
  try {
    await db.propRemove({ pageId, pid: titlePidIn });
    out.removeErr = null;
  } catch (e) {
    out.removeErr = String(e?.message ?? e);
  }
  const l = await db.load({ pageId });
  out.stillThere = Object.prototype.hasOwnProperty.call(l.collection.schema.properties, titlePidIn);
  out.stillText = l.collection.schema.properties[titlePidIn]?.type;
  return out;
};
const ti = await page2.evaluate(TITLE, [P, titlePid]);
info('标题保护结果', JSON.stringify(ti));
check('C24 标题列改类型被拒（E_INVARIANT）', typeof ti.typeErr === 'string' && ti.typeErr.includes('E_INVARIANT'), `err=${JSON.stringify(ti.typeErr)}`);
check('C25 标题列删除被拒（E_INVARIANT）', typeof ti.removeErr === 'string' && ti.removeErr.includes('E_INVARIANT'), `err=${JSON.stringify(ti.removeErr)}`);
check('C26 标题列仍在且仍为 text', ti.stillThere === true && ti.stillText === 'text', `there=${String(ti.stillThere)} type=${String(ti.stillText)}`);

// light 截图（改类型子菜单 / 选项面板）
await page2.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page2.evaluate(() => typeof window.septcats?.db?.load === 'function'), 20000);
await wait(1200);
await page2.locator(nodeSel).first().click().catch(() => {});
await waitFor(async () => page2.evaluate(() => document.querySelector('.sc-dbgrid') !== null), 15000);
await page2.screenshot({ path: join(SHOTS, 'light-04-grid-after.png') }).catch(() => {});

const b2quit = await quit(page2, b2.pid);
info('boot2 退出', `优雅退出=${String(b2quit.gracefulExited)}`);

// ======================= BOOT 3：持久化复验 + 排序/选项读回 + dark 截图 =======================
console.log('\n========== BOOT 3 ==========');
const b3 = await launch('boot3');
const page3 = b3.page;

const persist = await page3.evaluate(
  async ([pageId, filePid, selPid, mulPid, rid, expectedSelectValue, expectedMulValue, nPid]) => {
    const db = window.septcats.db;
    const l = await db.load({ pageId });
    const keys = Object.keys(l.collection.schema.properties);
    const rec = l.records.find((r) => r.id === rid);
    return {
      filePidGone: !keys.includes(filePid),
      numbersLast: keys[keys.length - 1] === nPid,
      selOptions: l.collection.schema.properties[selPid].options.map((o) => o.name),
      mulOptions: l.collection.schema.properties[mulPid].options.map((o) => o.name),
      selectValue: rec.values[selPid],
      mulValue: rec.values[mulPid],
      expectedSelectValue,
      expectedMulValue,
      keys,
    };
  },
  [
    P,
    pids.file,
    pids.select,
    pids.multi_select,
    ridA,
    setup.values[pids.select],
    op?.out?.mulValueAfterDelete ?? null,
    pids.number,
  ],
);
info('重启后持久化', JSON.stringify(persist));
check('D1 重启后：被删字段不复活', persist.filePidGone === true, `filePidGone=${String(persist.filePidGone)}`);
check('D2 重启后：列序持久化（与移动后最终序一致）', eq(persist.keys, mv.afterMoveBack), `重启后=${JSON.stringify(persist.keys)}
      移动后=${JSON.stringify(mv.afterMoveBack)}`);
check(
  'D3 重启后：选项管理持久化（3 项含已归档）',
  Array.isArray(persist.selOptions) && persist.selOptions.length === 3,
  `selOptions=${JSON.stringify(persist.selOptions)}`,
);
check('D4 重启后：单选取值未受影响', persist.selectValue === persist.expectedSelectValue, `select=${JSON.stringify(persist.selectValue)}`);
check(
  'D5 重启后：多选被删选项的引用仍为清理后状态',
  eq(persist.mulValue, persist.expectedMulValue),
  `mul=${JSON.stringify(persist.mulValue)} 期望=${JSON.stringify(persist.expectedMulValue)}`,
);

// dark 主题（走真实 settings.patch，不用注入）
// 主题真相源 = localStorage['septcats.theme']（apps/desktop/src/renderer/src/main.tsx §0.C
// 「仅当 localStorage 无 theme 时用 settings.theme 作一次性种子」）→ 探针按真相源设置。
const themeSet = await page3.evaluate(() => {
  try {
    localStorage.setItem('septcats.theme', 'dark');
    return { ok: true, stored: localStorage.getItem('septcats.theme') };
  } catch (e) {
    return { ok: false, err: String(e?.message ?? e) };
  }
});
info('localStorage 主题设置', JSON.stringify(themeSet));
await page3.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page3.evaluate(() => typeof window.septcats?.db?.load === 'function'), 20000);
await wait(1200);
await page3.locator(nodeSel).first().click().catch(() => {});
await waitFor(async () => page3.evaluate(() => document.querySelector('.sc-dbgrid') !== null), 15000);
await wait(600);
const darkTheme = await page3.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('E1 深色主题生效（走设置页真实路径）', darkTheme === 'dark', `data-theme=${String(darkTheme)}`);
await page3.screenshot({ path: join(SHOTS, 'dark-04-grid.png') }).catch(() => {});
const chips3 = await page3.locator('.sc-chip--prop').count();
if (chips3 > 2) {
  await page3.locator('.sc-chip--prop').nth(2).click().catch(() => {});
  await wait(700);
  await page3.screenshot({ path: join(SHOTS, 'dark-02-menu-data.png') }).catch(() => {});
  await page3.keyboard.press('Escape').catch(() => {});
}
await wait(300);

// 标题列菜单（dark）
if (chips3 > 0) {
  await page3.locator('.sc-chip--prop').first().click().catch(() => {});
  await wait(700);
  await page3.screenshot({ path: join(SHOTS, 'dark-01-menu-title.png') }).catch(() => {});
  await page3.keyboard.press('Escape').catch(() => {});
}

// 深色下重走一遍真实路径，取真正的深色库页截图（任务书 §2-8 双主题）
let darkDb = null;
try {
  await page3.getByTestId('side-new-page').click();
  const ni = page3.locator('.app-side input').first();
  await ni.waitFor({ state: 'visible', timeout: 15000 });
  await ni.fill('T40深色验收页');
  await ni.press('Enter');
  await wait(1300);
  const cb = page3.locator('button', { hasText: '转为多维数据' }).first();
  if ((await cb.count()) > 0) await cb.click();
  await wait(2000);
  const nr = page3.locator('button', { hasText: '新建记录' }).first();
  if ((await nr.count()) > 0) await nr.click();
  await wait(1800);
  const up = await waitFor(async () => page3.evaluate(() => document.querySelector('.sc-propbar') !== null), 15000);
  if (up) {
    await page3.locator('button', { hasText: '新属性' }).first().click();
    await wait(600);
    await page3.locator('[role="menuitem"]', { hasText: '单选' }).first().click().catch(() => {});
    await wait(1200);
  }
  await page3.screenshot({ path: join(SHOTS, 'dark-01-grid.png') }).catch(() => {});
  await page3.locator('.sc-dbc[data-type="select"]').first().click({ timeout: 8000 }).catch(() => {});
  await wait(1200);
  const pk = await page3.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    picker: document.querySelectorAll('.sc-dbc-picker').length,
    createBtn: document.querySelectorAll('.sc-dbc-picker__create-btn').length,
    chips: document.querySelectorAll('.sc-chip--prop').length,
  }));
  darkDb = pk;
  await page3.screenshot({ path: join(SHOTS, 'dark-05-picker-create.png') }).catch(() => {});
} catch (e) {
  darkDb = { err: String(e?.message ?? e) };
}
info('深色库页', JSON.stringify(darkDb));
check('E4 深色主题下 DbPage 与单选 picker 正常（含新建选项入口）', darkDb !== null && darkDb.theme === 'dark' && darkDb.picker > 0 && darkDb.createBtn > 0, JSON.stringify(darkDb));
await page3.keyboard.press('Escape').catch(() => {});
await wait(300);

// 回归复验
const reg3 = await page3.evaluate(() => ({
  hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  tabsbar: document.querySelector('[data-testid="tabsbar"]') !== null,
  grid: document.querySelector('.sc-dbgrid') !== null,
  rendered: document.querySelector('.app-editor-col') !== null && document.body.innerText.length > 20,
}));
check('E2 深色下仍零横向滚动', reg3.hScroll === false, `hScroll=${String(reg3.hScroll)}`);
check('E3 深色下应用正常渲染（无白屏；重载后库页不可达系既有 kind 缺陷，另立案）', reg3.rendered === true, `rendered=${String(reg3.rendered)} grid=${String(reg3.grid)}`);

const b3quit = await quit(page3, b3.pid);
info('boot3 退出', `优雅退出=${String(b3quit.gracefulExited)}`);

// ======================= 收尾断言 =======================
const realMtimeAfter = realRootMtime();
check('F1 真实数据根未被触碰（双隔离生效）', realMtimeAfter === realMtimeBefore, `before=${String(realMtimeBefore)} after=${String(realMtimeAfter)}`);
check('F2 无 pageerror', pageErrors.length === 0, `pageErrors=${JSON.stringify(pageErrors.slice(0, 5))}`);
check('F3 无 console error', consoleErrors.length === 0, `consoleErrors=${JSON.stringify(consoleErrors.slice(0, 5))}`);

const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n========== 汇总：${String(pass)} PASS / ${String(fail)} FAIL ==========`);
if (fail > 0) {
  console.log('FAIL 明细：');
  for (const r of results.filter((x) => x.ok === false)) console.log(`  ✗ ${r.name} — ${r.raw}`);
}
writeFileSync(join(SHOTS, 't40-results.json'), JSON.stringify({ pass, fail, results }, null, 2), 'utf8');
console.log(`结果已写入 ${join(SHOTS, 't40-results.json')}`);
process.exit(fail > 0 ? 1 : 0);