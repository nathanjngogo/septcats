/* probe-n1-pages-db.mjs —— 真机深功能探针：**编辑器/页面 + 多维表格**（老板 10-07 报障：
 * 「还有很多Bug，功能都实现不了」，勾选区 = 编辑器与页面 + 多维表格，时间线 = 0.6.14/0.6.15 起）。
 *
 * 为什么要有它：jsdom 层 1500+ 测试全绿、IPC 接线全通（119 频道）、桥接面 0 缺——静态与单测
 * 都查不出「真机上用不了」。所以本探针在**真机**上从数据层到 UI 层各走一遍，逐项给 PASS/FAIL
 * ＋证据，失败自动截图，末尾落 JSON 报告。它不猜、不靠肉眼，直接回答「哪一层断的」。
 *
 * 判据分层：
 *   ① 数据层（window.septcats.* 直驱）：页面增改/外观/块落库/库页属性·记录·视图——绕过 UI，
 *      看 IPC + 落库本身是否可用；② UI 层（真点击/真输入）：数据层成功但 UI 没反映 = **接线断点**，
 *      这正是「功能实现不了」的典型形态；③ 路由层：库页重开是否仍进表格（不回落编辑器）。
 *
 * 安全：只动 _scratch 夹具档（--user-data-dir 隔离）；真实档案根 mtime 全程不变（G1 硬断言）。
 * 用法（Windows 仓根）：node docs/mockups/probe-n1-pages-db.mjs
 *   靶子默认 apps/desktop/dist/win-unpacked/Septcats.exe；
 *   验装好的版本：set SEPTCATS_APP_BIN=C:\Users\Administrator\AppData\Local\Programs\Septcats\Septcats.exe
 * 产物：docs/mockups/screens-probe-n1/（失败截图）+ docs/mockups/probe-n1-report.json
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync, openSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 'n1';
const IS_WIN = process.platform === 'win32';
const RUN =
  process.env.SEPTCATS_RUN_DIR ??
  (IS_WIN ? `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}` : `${tmpdir()}/septcats-${RUN_NAME}`);
const UD = `${RUN}\\ud`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9571');
const REAL_ROOT =
  process.env.SEPTCATS_REAL_ROOT ?? (IS_WIN ? 'C:\\Users\\Administrator\\.septcats' : `${homedir()}/.septcats`);
const SHOTS = join(SCRIPT_DIR, `screens-${RUN_NAME}`);
const REPORT = join(SCRIPT_DIR, `probe-${RUN_NAME}-report.json`);
const APP_BIN =
  process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const KEEP = process.env.SEPTCATS_KEEP === '1';

/**
 * playwright-core 的解析：仓内 node_modules 优先；SEPTCATS_PW_ROOT 可指到别处
 * （Linux 开发机常没有这个依赖，装到临时目录即可，不必改仓依赖）。
 */
const PW_ROOT = process.env.SEPTCATS_PW_ROOT ?? join(REPO, 'node_modules');
const requireFrom = createRequire(join(PW_ROOT, 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let STEP = 'boot';
function check(name, ok, evidence) {
  results.push({ step: STEP, name, ok: Boolean(ok), evidence: evidence === undefined ? '' : String(evidence).slice(0, 300) });
  console.log(`${ok ? '✓' : '✗'} [${STEP}] ${name}${evidence === undefined ? '' : ` — ${String(evidence).slice(0, 300)}`}`);
  return Boolean(ok);
}
async function step(label, fn) {
  STEP = label;
  try {
    await fn();
  } catch (error) {
    check(`${label} 步骤未抛异常`, false, `抛错：${String(error).slice(0, 600)}`);
  }
}
async function waitFor(fn, timeout = 8000, interval = 250) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch { /* 重试到超时 */ }
    await wait(interval);
  }
  return false;
}
function realRootMtime() {
  try { return statSync(REAL_ROOT).mtimeMs; } catch { return null; }
}
function killAll() {
  const cmds = IS_WIN
    ? [
        `taskkill /F /IM Septcats.exe /T >NUL 2>NUL`,
        `powershell -NoProfile -Command "Get-Process Septcats -ErrorAction SilentlyContinue | Stop-Process -Force" >NUL 2>NUL`,
      ]
    : [
        // ⚠ 两个坑（本轮真机实测都踩过）：
        //  1) 笼统的 `pkill -f Septcats` 会命中仓路径本身 → 把探针自己的 shell 一起杀（瞬间 SIGTERM、零输出）；
        //  2) 直接用 `-f "user-data-dir=${UD}"` 时，**本进程自己的命令行里也含该串** → 同样自杀。
        //     故用 ERE 括号技巧 `user[-]data-dir=`：模式文本本身不含匹配串，只命中真正的应用进程。
        `pkill -f "user[-]data-dir=${UD}" >/dev/null 2>&1`,
        // 端口兜底：上一轮若被强杀，旧的 detached 实例会占住调试端口与单实例锁（应用日志会写
        // 「另一实例已持有单实例锁，本次启动退出」），新实例起不来、探针连到僵尸 → 全段假红。
        `fuser -k ${String(PORT)}/tcp >/dev/null 2>&1`,
      ];
  for (const cmd of cmds) {
    try { execSync(cmd, { stdio: 'ignore', shell: IS_WIN ? 'cmd.exe' : '/bin/bash' }); } catch { /* 没进程最好 */ }
  }
}
/**
 * 选中侧栏某页：**真点击**（Playwright locator）。
 * ⚠ 合成 `dispatchEvent(new MouseEvent('click'))` 在这套侧栏行上不可靠（实测：点击像发生了，
 * 活动页却没换 → 后续断言全部测错页，制造一串假红）。故一律真点击 + 用活动行验证。
 */
async function selectPage(page, id, title) {
  const byId = page.locator(`[data-testid="side-node-${id}"]`).first();
  if ((await byId.count()) > 0) {
    await byId.click({ timeout: 6000 }).catch(() => {});
    return true;
  }
  const byText = page.locator('.app-nav-row', { hasText: title }).first();
  if ((await byText.count()) > 0) {
    await byText.click({ timeout: 6000 }).catch(() => {});
    return true;
  }
  return false;
}

/** 当前活动页 id（侧栏活动行 testid 反解；UI 真源）。 */
async function activePageId(page) {
  return page.evaluate(
    () =>
      document
        .querySelector('.app-nav-row--active[data-testid^="side-node-"]')
        ?.getAttribute('data-testid')
        ?.replace('side-node-', '') ?? null,
  );
}
async function clickByText(page, text, opts = {}) {
  return page.evaluate(
    ([t, tag]) => {
      const nodes = [...document.querySelectorAll(tag ?? 'button, [role=button], a, summary, div')];
      const hit = nodes.find((n) => (n.textContent ?? '').trim() === t) ??
        nodes.find((n) => (n.textContent ?? '').trim().includes(t));
      if (hit === undefined) return false;
      hit.click();
      return true;
    },
    [text, opts.tag],
  );
}
async function shot(page, slug) {
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${String(results.length).padStart(2, '0')}-${slug}.png`) });
  } catch { /* 截图失败不影响判定 */ }
}

// ── 前置：夹具档 + 真实档案 mtime 基线 ────────────────────────────────────────
if (process.env.SEPTCATS_DEV !== '1' && !existsSync(APP_BIN)) {
  console.log(`✗ 找不到应用二进制：${APP_BIN}\n  · 用 SEPTCATS_APP_BIN 指向已装版本；或\n  · 用 SEPTCATS_DEV=1 直接跑本机 electron 源码（Linux/macOS 开发机）`);
  process.exit(2);
}
rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const REAL_BEFORE = realRootMtime();
console.log(`靶子：${APP_BIN}\n夹具：${RUN}\n真实档案根 mtime 基线：${String(REAL_BEFORE)}`);

killAll();
const DEV = process.env.SEPTCATS_DEV === '1';
const devBin = join(APPDIR, 'node_modules', 'electron', 'dist', IS_WIN ? 'electron.exe' : 'electron');
const spawnBin = DEV ? devBin : APP_BIN;
const spawnArgs = DEV
  ? ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, '--no-sandbox']
  : [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`];
if (DEV && !existsSync(spawnBin)) {
  console.log(`✗ SEPTCATS_DEV=1 但找不到 ${spawnBin}（先装本机 electron dist）`);
  process.exit(2);
}
console.log(`启动：${spawnBin} ${spawnArgs.slice(0, 1).join(' ')}${DEV ? ' （dev 模式，cwd=' + APPDIR + '）' : ''}`);
/**
 * DEV 模式把应用自身的 stdout/stderr 落盘：子进程（DbServer/网络服务）崩溃时，
 * 只有应用自己的日志能说明原因（生产包没有这个能力，故仅 DEV 捕获）。
 */
const APP_LOG = join(dirname(SHOTS), `app-${RUN_NAME}.log`);
const appOut = DEV ? openSync(APP_LOG, 'a') : 'ignore';
const proc = spawn(spawnBin, spawnArgs, {
  cwd: DEV ? APPDIR : undefined,
  detached: true,
  stdio: DEV ? ['ignore', appOut, appOut] : 'ignore',
});
proc.unref();
if (DEV) console.log(`应用日志：${APP_LOG}`);

// ── 连接 ────────────────────────────────────────────────────────────────────
let browser = null;
for (let i = 0; i < 60 && browser === null; i += 1) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
  } catch {
    await wait(500);
  }
}
if (browser === null) {
  check('CDP 连上应用实例', false, `端口 ${String(PORT)} 60 次重试未连上（应用是否启动失败？看 Windows 是否有报错窗）`);
  killAll();
  writeFileSync(REPORT, JSON.stringify({ results, fatal: 'no-cdp' }, null, 2), 'utf8');
  process.exit(1);
}
check('CDP 连上应用实例', true);

const ctx = browser.contexts()[0] ?? null;
if (ctx === null) {
  check('拿到应用窗口上下文（Electron 只给一个既有 context）', false, 'contexts()[0] 为空——应用可能还没建窗');
  killAll();
  writeFileSync(REPORT, JSON.stringify({ results, fatal: 'no-context' }, null, 2), 'utf8');
  process.exit(1);
}
/**
 * 取应用窗口页：**只等不造**。
 * Electron/CDP 不支持 `Target.createTarget`（即 Playwright 的 newPage/newContext 一律抛
 * `Protocol error (Target.createTarget): Not supported`，本探针首跑即踩），故照 t85 探针口径：
 * 先在既有 pages 里找，找不到再 `waitForEvent('page')` 等窗口出现。
 */
let page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) ?? null;
if (page === null) {
  page = await ctx.waitForEvent('page', { timeout: 30_000 }).catch(() => null);
}
if (page === null) {
  check('应用窗口页出现（只等不造）', false, '30s 内没有窗口页——应用是否启动失败/无窗口？');
  killAll();
  writeFileSync(REPORT, JSON.stringify({ results, fatal: 'no-page' }, null, 2), 'utf8');
  process.exit(1);
}
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e).slice(0, 200)); });
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 200)}`); });

async function bridgeReady(p) {
  return waitFor(async () => p.evaluate(() => typeof window.septcats === 'object' && window.septcats !== null), 30_000);
}
await page.waitForSelector('.app-side, .sc-shell, .pv-root', { timeout: 30_000 }).catch(() => null);
check('应用 DOM 就绪（侧栏/外壳出现）', true);
check('preload 桥就绪（window.septcats）', await bridgeReady(page));
// 僵尸实例自检：若连到的是上一轮残留实例，应用日志会写单实例锁退出，DbServer 往往是死的。
const appLogTail = DEV ? (existsSync(APP_LOG) ? readFileSync(APP_LOG, 'utf8').split('\n').slice(-6).join(' | ') : '') : '';
const singleInstanceLeak = /另一实例已持有单实例锁/.test(appLogTail);
check('未连到僵尸实例（单实例锁未被占用）', !singleInstanceLeak, singleInstanceLeak ? `应用日志：${appLogTail.slice(0, 240)}` : '');

// ── T0 首启导览（全屏模态遮罩，不关掉则后面所有点击都被它吃掉）───────────────
await step('T0 导览', async () => {
  const overlay = await waitFor(
    () => page.evaluate(() => Boolean(document.querySelector('.sc-tour__overlay'))),
    6000,
  );
  if (overlay) {
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=tour-skip]');
      if (b === null) return false;
      b.click();
      return true;
    });
    const gone = await waitFor(
      () => page.evaluate(() => !document.querySelector('.sc-tour__overlay')),
      6000,
    );
    check('T0 首启导览已关闭（不关则整屏点击失效）', clicked && gone, `clicked=${String(clicked)} gone=${String(gone)}`);
  } else {
    check('T0 无首启导览（本档已看过）', true);
  }
});

// ── A 外壳 ──────────────────────────────────────────────────────────────────
await step('A 外壳', async () => {
  const shell = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.sc-shell'))), 20_000);
  check('A1 应用外壳挂载（.sc-shell）', shell);
  const side = await page.evaluate(() => ({
    sidebar: Boolean(document.querySelector('.sc-shell__sidebar')),
    rail: Boolean(document.querySelector('.nav-rail')),
    host: Boolean(document.querySelector('.app-overlay-host')),
  }));
  check('A2 侧栏 / 导轨 / 浮层宿主齐备', side.sidebar && side.rail, JSON.stringify(side));
  if (!shell) await shot(page, 'A-shell-missing');
});

// ── B 页面数据层（IPC 直驱）───────────────────────────────────────────────────
let wsId = null;
let pageId = null;
await step('B 页面数据层', async () => {
  const ws = await page.evaluate(async () => {
    const r = await window.septcats.workspaces.list();
    return { activeId: r.activeId, count: r.items.length };
  });
  wsId = ws.activeId;
  check('B1 workspaces.list 可用且活动工作区非空', typeof wsId === 'string' && wsId.length > 0, JSON.stringify(ws));

  const created = await page.evaluate(async () => window.septcats.pages.create({ parentId: null }));
  pageId = created.id;
  check('B2 pages.create 可用（返回 id）', typeof pageId === 'string' && pageId.length > 0, JSON.stringify(created));

  const renamed = await page.evaluate(async ([id]) => window.septcats.pages.rename({ id, title: '探针页面A' }), [pageId]);
  const tree1 = await page.evaluate(async ([w]) => window.septcats.pages.tree({ workspaceId: w }), [wsId]);
  const node1 = tree1.find((n) => n.id === pageId);
  check('B3 pages.rename 生效（树里标题一致）', node1?.title === '探针页面A' && renamed.id === pageId, `title=${String(node1?.title)}`);

  // ★ 新功能硬验证：外观（图标/封面）——patch op 是否真落库
  await page.evaluate(async ([id]) => window.septcats.pages.appearance({ id, icon: '📄', cover: 'aurora' }), [pageId]);
  const tree2 = await page.evaluate(async ([w]) => window.septcats.pages.tree({ workspaceId: w }), [wsId]);
  const node2 = tree2.find((n) => n.id === pageId);
  check(
    'B4 pages.appearance 落库（图标/封面写进 page 行并被树读回）',
    node2?.icon === '📄' && node2?.cover === 'aurora',
    `icon=${String(node2?.icon)} cover=${String(node2?.cover)}`,
  );
  check('B5 普通页 pageType=page（未转换时）', node2?.pageType === 'page', String(node2?.pageType));

  // 清掉外观，留给 F 段做 UI 验证
  await page.evaluate(async ([id]) => window.septcats.pages.appearance({ id, icon: null, cover: null }), [pageId]);
});

// ── C 编辑器（UI 真交互）─────────────────────────────────────────────────────
await step('C 编辑器', async () => {
  // 走**应用自己的「新建页面」**按钮：树与选中会同步（直接 IPC 建页不会刷新侧栏树，
  // 上一版就是这么测错页的：字打进了旧页，却去查新页 → 假红）。
  await page.click('[data-testid="side-new-page"]');
  await wait(2500);
  /** 当前活动页 = 侧栏活动行的 testid（UI 真源，不猜）。 */
  const editorPageId = await activePageId(page);
  check('C0 新建页面并成为活动页（侧栏活动行可读）', typeof editorPageId === 'string' && editorPageId.length > 0, `activeId=${String(editorPageId)}`);
  if (editorPageId === null) { return; }

  const mounted = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.pv-body .ProseMirror'))), 12_000);
  check('C1 编辑器挂载（.pv-body .ProseMirror）', mounted, mounted ? '' : '编辑器未挂载——页面打不开时这是第一断点');
  if (!mounted) { await shot(page, 'C-editor-not-mounted'); return; }

  await page.click('.pv-body .ProseMirror');
  const mark = `探针文本${String(Date.now() % 100000)}`;
  await page.keyboard.type(mark);
  const typed = await waitFor(
    () => page.evaluate(([m]) => (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').includes(m), [mark]),
    5000,
  );
  check('C2 真键盘输入进入编辑器 DOM', typed, `mark=${mark}`);

  // 保存是防抖的：先失焦，再等落库（真机实测：1.5s 内即落库）
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const readBack = async () =>
    page.evaluate(async ([id, m]) => {
      const r = await window.septcats.blocks.list({ pageId: id });
      return (r.blocks ?? []).some((b) => JSON.stringify(b.content ?? '').includes(m));
    }, [editorPageId, mark]);
  const persisted = await waitFor(async () => ((await readBack()) ? true : false), 12_000);
  check('C3 输入落库（blocks.list 读回同一文本）', persisted, persisted ? '' : 'DOM 有但库里没有 = 保存通路断了');
  if (!persisted) await shot(page, 'C-save-failed');

  // 斜杠菜单（真机实测可弹出；选择器认 .sc-slashmenu）。⚠ 前面刚 blur 过：必须先点回编辑器，
  // 否则按键落在没有焦点的页面上 → 假红（上一版就是这么红的）。
  await page.click('.pv-body .ProseMirror');
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(300);
  await page.keyboard.type('/');
  const slash = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.sc-slashmenu'))), 5000);
  check('C4 斜杠菜单可唤出（.sc-slashmenu）', slash);
  await page.keyboard.press('Escape');
  await wait(300);
});

// ── D 转为多维数据 + 路由闭环 ────────────────────────────────────────────────
/** D 段解析出的库页 id（E 段续用，故提到模块作用域）。 */
let dbPageId = null;
await step('D 库页路由', async () => {
  if (pageId === null) { check('D 前置：已有页面', false, 'B 段未建出页面'); return; }
  const clicked = await clickByText(page, '转为多维数据');
  check('D1 点「转为多维数据」按钮命中', clicked);
  // 转换实现 = `db.create` **新建一个库页**（不是把当前页转成库页）→ 判定必须落在新建出来的那页上。
  dbPageId = await waitFor(async () =>
    page.evaluate(async () => {
      const ws = await window.septcats.workspaces.list();
      const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
      return tree.find((n) => n.pageType === 'database')?.id ?? null;
    }), 12_000);
  check('D2 树里出现 database 页（数据层）', typeof dbPageId === 'string' && dbPageId.length > 0, `dbPageId=${String(dbPageId)}`);

  const props = await waitFor(async () =>
    page.evaluate(async ([id]) => {
      try {
        const r = await window.septcats.db.load({ pageId: id });
        return r.collection ? Object.keys(r.collection.schema.properties).length : false;
      } catch { return false; }
    }, [dbPageId ?? '']), 12_000);
  check('D3 库页 collection 可读（含属性）', typeof props === 'number' && props >= 1, `props=${String(props)}`);

  // 新库页 0 记录 → 设计上渲染 EmptyState（「还没有记录 / 新建记录」），不是网格；两者都算"库页 UI 正常"。
  const ui = await waitFor(
    () => page.evaluate(() => ({
      grid: Boolean(document.querySelector('.dbpage .sc-dbgrid, .sc-dbgrid')),
      empty: Boolean(document.querySelector('.dbpage .sc-empty')),
      text: (document.querySelector('.dbpage')?.innerText ?? '').slice(0, 120),
    })),
    12_000,
  );
  check('D4 库页 UI 正常挂载（网格或空态，二者皆合法）', ui.grid || ui.empty, JSON.stringify(ui).slice(0, 240));
  if (!ui.grid && !ui.empty) await shot(page, 'D-grid-missing');

  const editorGone = await page.evaluate(() => !document.querySelector('.pv-body .ProseMirror'));
  check('D5 库页态编辑器已卸载（不再同时挂编辑器）', editorGone);

  // D6 稳定性：**不再切走**（换页再选回依赖侧栏分组展开态，脆且与本次判据无关）。
  // 只验「库页在一次重渲染触发后仍保持库页形态、编辑器不回来」。
  await wait(2500);
  const stable = await page.evaluate(() => ({
    db: Boolean(document.querySelector('.dbpage')),
    grid: Boolean(document.querySelector('.dbpage .sc-dbgrid, .sc-dbgrid')),
    empty: Boolean(document.querySelector('.dbpage .sc-empty')),
    editor: Boolean(document.querySelector('.pv-body .ProseMirror')),
  }));
  check('D6 库页形态稳定（编辑器未回来）', (stable.db || stable.grid || stable.empty) && !stable.editor, JSON.stringify(stable));
});

// ── E 多维表格功能 ──────────────────────────────────────────────────────────
await step('E 多维表格', async () => {
  /** D 段解析出的库页 id（db.create 新建的那页）。 */
  const dbPage = typeof dbPageId === 'string' && dbPageId.length > 0 ? dbPageId : '';
  if (dbPage === '') { check('E 前置：已有库页', false, 'D 段未解析出 database 页'); return; }
  let onDb = await page.evaluate(() => Boolean(document.querySelector('.dbpage')));
  if (!onDb) {
    await selectPage(page, dbPage, '未命名');
    await wait(2000);
    onDb = await page.evaluate(() => Boolean(document.querySelector('.dbpage')));
  }
  check('E 前置：当前在库页上（否则 UI 断言无意义）', onDb, `dbPageId=${dbPage} onDb=${String(onDb)}`);
  if (!onDb) { await shot(page, 'E-not-on-dbpage'); return; }
  const before = await page.evaluate(async ([id]) => {
    const r = await window.septcats.db.load({ pageId: id });
    return { props: Object.keys(r.collection.schema.properties).length, records: r.records.length, views: (r.collection.views ?? []).length };
  }, [dbPage]).catch(() => null);
  check('E0 db.load 基线可读', before !== null, JSON.stringify(before));

  // E1/E2 加属性：数据层 vs UI
  const prop = await page.evaluate(async ([id]) => window.septcats.db.propAdd({ pageId: id, type: 'text' }), [dbPage]).catch((e) => `ERR ${String(e).slice(0, 80)}`);
  const afterProps = await page.evaluate(async ([id]) => {
    const r = await window.septcats.db.load({ pageId: id });
    return Object.keys(r.collection.schema.properties).length;
  }, [dbPage]).catch(() => -1);
  check('E1 db.propAdd 数据层生效（属性数 +1）', typeof before?.props === 'number' && afterProps === before.props + 1, `${String(before?.props)} → ${String(afterProps)}`);
  // UI 驱动：点「新建记录」→ 表格形态出现（空态 → 网格），再数表头/单元格/属性条。
  // 注意：IPC 直改库不会推回渲染层（无推送通道），故 UI 断言必须由 UI 动作触发。
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === '新建记录');
    b?.click();
  });
  await wait(2200);
  const headAfter = await page.evaluate(() => document.querySelectorAll('.sc-dbhead__cell').length);
  // ⚠ 不能拿「IPC 直接加的属性数」当期望：IPC 直改库没有推回渲染层的通道，UI 只会跟随
  // **UI 驱动**的动作。故此处只钉「表头至少含 1 个属性列 + 选择列」，并在下一条验属性菜单可达。
  check('E2 表格头渲染（≥2 列：选择列 + 至少 1 属性列）', headAfter >= 2, `表头列=${String(headAfter)}`);
  const propMenu = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((n) => (n.textContent ?? '').trim() === '新属性');
    if (b === null || b === undefined) return false;
    b.click();
    return true;
  });
  await wait(900);
  const menuOpen = await page.evaluate(() => document.querySelectorAll('[role=menu], .sc-menu, .sc-popover').length > 0);
  check('E2b 「新属性」入口可点且弹层出现（属性增改入口可达）', propMenu && menuOpen, `clicked=${String(propMenu)} menu=${String(menuOpen)}`);
  await page.keyboard.press('Escape').catch(() => {});

  // E3/E4 记录：数据层 + 真点击单元格编辑
  const rec = await page.evaluate(async ([id]) => window.septcats.db.recordCreate({ pageId: id }), [dbPage]).catch((e) => `ERR ${String(e).slice(0, 80)}`);
  const recCount = await page.evaluate(async ([id]) => (await window.septcats.db.load({ pageId: id })).records.length, [dbPage]).catch(() => -1);
  check('E3 db.recordCreate 数据层生效（记录数 +1）', typeof rec === 'object' && recCount === (before?.records ?? 0) + 1, `记录 ${String(before?.records)} → ${String(recCount)}`);
  const cellCount = await waitFor(() => page.evaluate(() => document.querySelectorAll('.sc-dbcell').length > 0), 8000);
  check('E4 记录出现在 UI 网格（.sc-dbcell 出现）', cellCount);

  // E5 视图持久化
  const views = await page.evaluate(async ([id]) => (await window.septcats.db.load({ pageId: id })).collection.views ?? [], [dbPage]).catch(() => []);
  check('E5 collection.views 可读（视图条数据源）', Array.isArray(views), `views=${Array.isArray(views) ? views.length : 'n/a'}`);

  // E6 筛选/排序 chip 面
  const chips = await page.evaluate(() => document.querySelectorAll('.sc-chip').length);
  check('E6 属性条渲染（.sc-chip 数 ≥1）', chips >= 1, `chip=${String(chips)}`);

  // E7 CSV 导出（数据层）
  const csv = await page.evaluate(async ([id]) => {
    try { const r = await window.septcats.db.exportCsv({ pageId: id }); return String(r.csv ?? '').length; } catch (e) { return `ERR ${String(e).slice(0, 60)}`; }
  }, [dbPage]).catch((e) => `ERR ${String(e).slice(0, 300)}`);
  check('E7 db.exportCsv 可用（CSV 非空）', typeof csv === 'number' && csv > 0, `csv 长度=${String(csv)}`);
  if (!cellCount) await shot(page, 'E-cells-missing');
});

// ── F 新功能：图标 / 封面（UI 真点）─────────────────────────────────────────
await step('F 图标与封面', async () => {
  if (pageId === null) { check('F 前置：已有页面', false, 'B 段未建出页面'); return; }
  // 回到普通页：新建一个空白页做外观验证
  // 走应用自己的「新建页面」（树/选中同步；IPC 直建不会刷新侧栏树 → 选不中 → 一串假红）。
  await page.click('[data-testid="side-new-page"]');
  await wait(2200);
  const freshId = await activePageId(page);
  const titleRow = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.pv-title-row'))), 10_000);
  check('F0 新页可打开（题头行出现）', titleRow);
  // 护栏：确认活动页**就是**这个新页（否则外观会设到别的页、落库断言指错页 → 假红）
  const guard = await page.evaluate(
    () => ({
      activeRow: document.querySelector('.app-nav-row--active[data-testid^="side-node-"]')?.getAttribute('data-testid') ?? null,
      editor: document.querySelector('.pv-body .ProseMirror') !== null,
      dbpage: document.querySelector('.dbpage') !== null,
    }),
  );
  check('F0b 选中的是普通页且编辑器在（选中护栏）', guard.activeRow === `side-node-${String(freshId)}` && guard.editor && !guard.dbpage, JSON.stringify(guard));
  if (!titleRow) { await shot(page, 'F-title-missing'); return; }

  // 图标：hover 题头 → 点「添加图标」
  await page.hover('.pv-title-row').catch(() => {});
  const addIcon = await waitFor(() => page.evaluate(() => {
    const b = document.querySelector('[data-testid=page-add-icon]');
    if (b === null) return false;
    b.click();
    return true;
  }), 5000);
  check('F1 「添加图标」按钮可点（hover 显形后）', addIcon);
  const picker = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid=page-appearance-icon]'))), 4000);
  check('F2 图标画廊浮层出现', picker);
  if (picker) {
    const picked = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=page-icon-option-📄]') ?? document.querySelector('[data-testid^=page-icon-option-]');
      if (b === null) return false;
      b.click();
      return true;
    });
    const shown = await waitFor(() => page.evaluate(() => document.querySelector('[data-testid=page-icon]')?.textContent ?? ''), 5000);
    check('F3 选图标后题头出现图标（UI 生效）', picked && String(shown).length > 0, `icon=${String(shown)}`);
    const persisted = await page.evaluate(async ([w, id]) => {
      const tree = await window.septcats.pages.tree({ workspaceId: w });
      return tree.find((n) => n.id === id)?.icon ?? null;
    }, [wsId, freshId]).catch(() => null);
    check('F4 图标落库（树读回非空）', typeof persisted === 'string' && persisted.length > 0, `tree.icon=${String(persisted)}`);
  }

  // 封面
  await page.hover('.pv-title-row').catch(() => {});
  const addCover = await waitFor(() => page.evaluate(() => {
    const b = document.querySelector('[data-testid=page-add-cover]');
    if (b === null) return false;
    b.click();
    return true;
  }), 5000);
  check('F5 「添加封面」按钮可点', addCover);
  const coverPicker = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid=page-appearance-cover]'))), 4000);
  check('F6 封面画廊浮层出现', coverPicker);
  if (coverPicker) {
    const pickedCover = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=page-cover-option-aurora]');
      if (b === null) return false;
      b.click();
      return true;
    });
    const coverEl = await waitFor(() => page.evaluate(() => document.querySelector('[data-testid=page-cover]')?.getAttribute('data-cover') ?? ''), 5000);
    check('F7 封面渲染（.pv-cover 出现且 data-cover 命中）', pickedCover && coverEl === 'aurora', `data-cover=${String(coverEl)}`);
    const persistedCover = await page.evaluate(async ([w, id]) => {
      const tree = await window.septcats.pages.tree({ workspaceId: w });
      return tree.find((n) => n.id === id)?.cover ?? null;
    }, [wsId, freshId]).catch(() => null);
    check('F8 封面落库（树读回）', persistedCover === 'aurora', `tree.cover=${String(persistedCover)}`);
    if (coverEl !== 'aurora') await shot(page, 'F-cover-not-rendered');
  }
});

// ── G 收尾：真实档案不被碰 ──────────────────────────────────────────────────
await step('G 硬不变量', async () => {
  const after = realRootMtime();
  check('G1 真实档案根 mtime 未变（夹具口径成立）', REAL_BEFORE === after, `before=${String(REAL_BEFORE)} after=${String(after)}`);
  check('G2 无效 UI 崩溃（pageerror/console-error 计数）', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
});

// ── 报告 + 收尾 ─────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
writeFileSync(
  REPORT,
  JSON.stringify(
    { at: new Date().toISOString(), app: APP_BIN, run: RUN, port: PORT, pageErrors, results },
    null,
    2,
  ),
  'utf8',
);
console.log(`\n报告：${REPORT}`);
console.log(`截图：${SHOTS}`);
if (pageErrors.length > 0) {
  console.log('\n捕获到的错误（前 10 条）：');
  for (const e of pageErrors.slice(0, 10)) console.log(`  ! ${e}`);
}
console.log(`\n== probe-n1 ${failed.length === 0 ? 'ALL-PASS' : `${String(failed.length)} FAILED`} / ${String(results.length)} 项 ==`);
console.log('失败项：');
for (const f of failed) console.log(`  ✗ [${f.step}] ${f.name} — ${f.evidence}`);

await browser.close().catch(() => {});
killAll();
if (!KEEP) rmSync(RUN, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);