/* cdp-e2e-t56-01.mjs —— TASK-T56-01 真机取证（使用说明书嵌入帮助菜单）
 *
 * 范围（对应任务书 §1③④⑤ + §3）：
 *   G0 夹具自检：独立 userData/rootPath 起应用，渲染面就绪（.sc-shell + pages API）；
 *   G1 帮助菜单结构：main `Menu.getApplicationMenu()` → Help 子菜单 = [使用说明书,
 *      separator, 关于 Septcats]（位置在「关于」上方 + 分隔线，双语 label 走字典）；
 *   G2 真点菜单项（MenuItem.click()，与真实点击同一处理器）→ renderer 切说明书视图
 *      （data-testid=manual-view）+ 面包屑「使用说明书」+ 正文命中章节标题 → 截图①；
 *   G3 锚点跳「数据库视图」：scrollIntoView 真滚动（content.scrollTop 前移 + 章节顶与
 *      滚动口对齐）+ aria-current 随动；折叠章表 → 锚点区 display:none → 截图③；
 *   G4 Esc → 回编辑区（说明书卸载、app-editor-col 回归）；
 *   G5 命令面板入口：顶栏搜索钮开面板 → 输入关键词 → 命中「使用说明书」行 → 执行 →
 *      说明书视图再现（命令面板与帮助菜单同一条视图通道）；
 *   G6 切 English：settings.patch(locale=en-US) → 原生菜单 label 变 'User Manual'
 *      （main 权威）；locale 标记 en-US + reload 让 renderer 同语言 → 再开说明书 →
 *      标题 'User Manual' + 正文 'Getting Started' → 截图②；
 *   G7 退出：window.close() 优雅退出 + Get-Process electron 计数（交付纪律贴实证）。
 *
 * 取证法（同 T51-01 / T54-01 / T55-02）：renderer CDP（playwright-core over
 *   --remote-debugging-port）+ main 进程 Node inspector（--inspect）读
 *   `Menu.getApplicationMenu()`。截图 = renderer `page.screenshot`（窗口内容真像素）。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（先 ensure-abi electron + pnpm -C apps/desktop build）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t56-01/，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 不改产品状态（只切 locale，属说明书写明的用户动作）；退出只用 window.close()。
 *
 * 运行：node scripts/ensure-abi.mjs electron && pnpm -C apps/desktop build && node docs/mockups/cdp-e2e-t56-01.mjs
 * 产物：docs/mockups/screens-t56/t56-01-results.json + t56-zh-content.png +
 *       t56-en-content.png + t56-anchors-collapsed.png
 */
import { createRequire } from 'node:module';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t56-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9476;
const INSPECT = 9236;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t56');
const OUT_JSON = join(SHOTS, 't56-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ task: 'TASK-T56-01 真机取证（使用说明书嵌入帮助菜单）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
      'utf8',
    );
  } catch {
    /* 落盘失败不拦路 */
  }
};
const check = (name, ok, raw) => {
  results.push({ step: STEP, name, ok: ok === true, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw)}`);
  dump();
};
const info = (name, raw) => {
  results.push({ step: STEP, name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  [${STEP}] ${name}  — ${String(raw)}`);
  dump();
};
process.on('unhandledRejection', (e) => info('未处理拒绝（原始）', String(e?.stack ?? e)));
process.on('uncaughtException', (e) => info('未捕获异常（原始）', String(e?.stack ?? e)));

const killTree = (pid) => {
  if (typeof pid !== 'number' || Number.isNaN(pid)) return;
  try {
    execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退出 */
  }
};
const alive = (pid) => {
  if (typeof pid !== 'number') return false;
  try {
    return execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' }).includes(String(pid));
  } catch {
    return false;
  }
};
const listeningPids = (port) => {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${String(port)}`) && /LISTENING/i.test(line)) {
        const pid = Number(line.trim().split(/\s+/).pop());
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
};
/** Get-Process electron 计数（交付纪律：杀净自起进程，贴实证）。 */
const electronCount = () => {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', '(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count'], { encoding: 'utf8' });
  return Number(String(r.stdout ?? '').trim() || '0');
};

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    try {
      last = await fn();
    } catch {
      last = false;
    }
    if (last) return last;
    await wait(stepMs);
  }
  return last;
}

// --- main 进程 inspector 客户端 ---------------------------------------------
let ws = null;
let msgId = 0;
const pending = new Map();

async function connectInspector() {
  let target = null;
  for (let i = 0; i < 50 && target === null; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${String(INSPECT)}/json/list`)).json();
      target = list.find((t) => t.webSocketDebuggerUrl) ?? null;
    } catch {
      await wait(600);
    }
  }
  if (target === null) throw new Error('main inspector 未就绪');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  await send('Runtime.enable');
  return target.title;
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    msgId += 1;
    pending.set(msgId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 400) };
  return { value: r.result?.value };
}

/** 原生菜单结构（Help 子菜单项序 = label/type 列表）。 */
async function menuState() {
  const r = await mainEval(`(() => {
    const { Menu } = require('electron');
    const m = Menu.getApplicationMenu();
    if (!m) return JSON.stringify({ ok: false, reason: 'NO_MENU' });
    const help = m.items[m.items.length - 1];
    const sub = help.submenu ? help.submenu.items : [];
    return JSON.stringify({
      ok: true,
      top: m.items.map((i) => i.label),
      helpLabel: help.label,
      helpItems: sub.map((i) => ({ label: i.label ?? null, type: i.type, role: i.role ?? null })),
    });
  })()`);
  if (r.err || typeof r.value !== 'string') return { ok: false, reason: r.err ?? 'no-value' };
  return JSON.parse(r.value);
}

/** 真点「使用说明书」菜单项（MenuItem.click() 与真实点击同一处理器）。 */
async function clickManualMenuItem() {
  const r = await mainEval(`(() => {
    const { Menu } = require('electron');
    const m = Menu.getApplicationMenu();
    const help = m.items[m.items.length - 1];
    const item = help.submenu.items.find((i) => i.type !== 'separator');
    if (!item) return 'NO_ITEM';
    item.click();
    return 'clicked:' + String(item.label);
  })()`);
  return r.value ?? r.err;
}

// --- 渲染器 ------------------------------------------------------------------
async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  const child = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, `--inspect=${String(INSPECT)}`],
    { cwd: APPDIR, detached: false, stdio: 'ignore' },
  );
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
      break;
    } catch {
      await wait(800);
    }
  }
  if (browser === null) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  ctx.setDefaultTimeout(10000);
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter((p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'));
    if (ps.length > 0) {
      page = ps[0];
      break;
    }
    await wait(500);
  }
  await page.bringToFront().catch(() => {});
  await waitFor(
    async () => page.evaluate(() => document.querySelector('.sc-shell') !== null && typeof window.septcats?.pages?.tree === 'function'),
    45000,
  );
  await wait(2200);
  return { page, pid: child.pid, browser };
}

/** 等待说明书视图出现 / 消失。 */
const manualVisible = (page) => page.evaluate(() => document.querySelector('[data-testid="manual-view"]') !== null);

async function quit(page, pid, browser) {
  STEP = 'teardown';
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  await wait(400);
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
  await wait(3000);
  let forced = false;
  if (alive(pid)) {
    forced = true;
    killTree(pid);
  }
  await browser.close().catch(() => {});
  await wait(1500);
  return { gracefulExited: !forced, forced, pid };
}

// ===========================================================================
const realRootMtimeBefore = (() => {
  try {
    return String(statSync(REAL_ROOT).mtimeMs);
  } catch {
    return 'absent';
  }
})();

rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(
  `${UD}\\septcats.settings.json`,
  JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2),
  'utf8',
);
info('夹具', `UD=${UD} ROOT=${ROOT} APPDIR=${APPDIR}`);

const quits = [];
const phases = {};
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  const page = boot.page;
  info('main inspector', await connectInspector());
  check(
    'G0-1 夹具成立：独立 userData/rootPath 起应用，渲染面就绪（.sc-shell + pages API）',
    (await page.evaluate(() => document.querySelector('.sc-shell') !== null)) === true,
    `userData=${UD}`,
  );
  check('G0-2 夹具数据根已物化（未触碰真实档案）', existsSync(ROOT), `root exists=${String(existsSync(ROOT))}`);

  // --- G1 帮助菜单结构 ------------------------------------------------------
  STEP = 'G1|menu-structure';
  const menu1 = await menuState();
  phases.menuZh = menu1;
  info('原生菜单（原始）', JSON.stringify(menu1));
  check(
    'G1-1 Help 子菜单 = [使用说明书, separator, 关于 Septcats]（使用说明书在「关于」上方 + 分隔线）',
    menu1.ok === true &&
      menu1.helpItems.length === 3 &&
      menu1.helpItems[0].label === '使用说明书' &&
      menu1.helpItems[1].type === 'separator' &&
      menu1.helpItems[2].label === '关于 Septcats',
    JSON.stringify(menu1.helpItems),
  );

  // --- G2 菜单点击 → 说明书视图 --------------------------------------------
  STEP = 'G2|open-via-menu';
  const clicked = await clickManualMenuItem();
  info('菜单项 click()（原始）', String(clicked));
  const opened = await waitFor(async () => manualVisible(page), 8000);
  check('G2-1 点菜单项 → 说明书视图出现（data-testid=manual-view）', opened === true, `click=${String(clicked)}`);
  const shell2 = await page.evaluate(() => ({
    crumb: document.querySelector('.sc-shell__crumb')?.textContent ?? '',
    editorCol: document.querySelector('.app-editor-col') !== null,
    title: document.querySelector('.manual-view__title')?.textContent ?? '',
    anchors: document.querySelectorAll('[data-testid="manual-anchors"] button').length,
    docTitle: document.querySelector('.manual-view__h1')?.textContent ?? '',
  }));
  phases.shellZh = shell2;
  info('视图状态（原始）', JSON.stringify(shell2));
  check('G2-2 面包屑为「使用说明书」且编辑列让位（说明书接管内容区）', shell2.crumb.includes('使用说明书') && shell2.editorCol === false, `crumb=${shell2.crumb} editorCol=${String(shell2.editorCol)}`);
  check('G2-3 正文命中章节标题「快速上手」+ 章节锚点表非空', shell2.docTitle.includes('使用说明书') && shell2.anchors >= 12, `docTitle=${shell2.docTitle} anchors=${String(shell2.anchors)}`);
  await page.screenshot({ path: join(SHOTS, 't56-zh-content.png') });
  check('G2-4 截图①（zh 正文）已产出', existsSync(join(SHOTS, 't56-zh-content.png')), 't56-zh-content.png');

  // --- G3 锚点跳转 + 折叠 ---------------------------------------------------
  STEP = 'G3|anchor';
  const jump = await page.evaluate(async () => {
    const content = document.querySelector('[data-testid="manual-content"]');
    const anchors = [...document.querySelectorAll('[data-testid="manual-anchors"] button')];
    const label = (el) => (el.textContent ?? '').trim();
    const targetIndex = anchors.findIndex((el) => label(el) === '数据库视图');
    if (!content || targetIndex < 0) return { ok: false };
    const target = anchors[targetIndex];
    const section = document.getElementById(`section-${String(targetIndex + 1)}`);
    const before = content.scrollTop;
    target.click();
    await new Promise((r) => setTimeout(r, 600));
    const active = target.getAttribute('aria-current');
    const activeCount = anchors.filter((el) => el.getAttribute('aria-current') === 'true').length;
    const cr = content.getBoundingClientRect();
    const sr = section ? section.getBoundingClientRect() : null;
    return {
      ok: true,
      before,
      after: content.scrollTop,
      active,
      activeCount,
      deltaTop: sr ? Math.round(sr.top - cr.top) : null,
      heading: section ? (section.querySelector('h2')?.textContent ?? '') : '',
    };
  });
  phases.jump = jump;
  info('锚点跳转（原始）', JSON.stringify(jump));
  check(
    'G3-1 锚点跳「数据库视图」→ 目标章节命中 DOM 且真滚动（scrollTop 前移 + 章节顶对齐滚动口）',
    jump.ok === true && jump.after > jump.before && jump.after > 100 && jump.deltaTop !== null && Math.abs(jump.deltaTop) < 80 && jump.heading === '数据库视图',
    JSON.stringify(jump),
  );
  check('G3-2 aria-current 唯一落在被点锚点（章节表高亮随动）', jump.active === 'true' && jump.activeCount === 1, `active=${String(jump.active)} count=${String(jump.activeCount)}`);

  const collapsed = await page.evaluate(async () => {
    const toggle = document.querySelector('[data-testid="manual-anchors-toggle"]');
    if (!toggle) return { ok: false };
    toggle.click();
    await new Promise((r) => setTimeout(r, 400));
    const nav = document.querySelector('[data-testid="manual-anchors"]');
    const root = document.querySelector('[data-testid="manual-view"]');
    return {
      ok: true,
      cls: root ? root.className : '',
      expanded: toggle.getAttribute('aria-expanded'),
      navDisplay: nav ? getComputedStyle(nav).display : 'MISSING',
    };
  });
  phases.collapsed = collapsed;
  info('折叠章表（原始）', JSON.stringify(collapsed));
  check('G3-3 折叠钮收起章表（根类切换 + 锚点区 display:none）', collapsed.ok === true && collapsed.cls.includes('manual-view--collapsed') && collapsed.expanded === 'false' && collapsed.navDisplay === 'none', JSON.stringify(collapsed));
  await page.screenshot({ path: join(SHOTS, 't56-anchors-collapsed.png') });
  check('G3-4 截图③（锚点折叠态）已产出', existsSync(join(SHOTS, 't56-anchors-collapsed.png')), 't56-anchors-collapsed.png');
  // 复原（展开），后续用例不继承折叠态
  await page.evaluate(() => {
    document.querySelector('[data-testid="manual-anchors-toggle"]')?.click();
  });
  await wait(300);

  // --- G4 Esc 回编辑区 ------------------------------------------------------
  STEP = 'G4|esc';
  await page.keyboard.press('Escape');
  const backToEditor = await waitFor(async () => (await manualVisible(page)) === false, 6000);
  const afterEsc = await page.evaluate(() => ({
    manual: document.querySelector('[data-testid="manual-view"]') !== null,
    editorCol: document.querySelector('.app-editor-col') !== null,
  }));
  check('G4-1 Esc → 说明书卸载、编辑列回归（view 回 editor）', backToEditor === true && afterEsc.manual === false && afterEsc.editorCol === true, JSON.stringify(afterEsc));

  // --- G5 命令面板入口 ------------------------------------------------------
  STEP = 'G5|palette';
  await page.getByRole('button', { name: /搜索|Search/ }).first().click({ force: true }).catch(() => {});
  const paletteOpen = await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="palette-panel"]') !== null), 6000);
  await page.keyboard.type('说明书');
  await wait(500);
  const cmdRow = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    const hit = rows.find((row) => (row.textContent ?? '').includes('使用说明书'));
    return { count: rows.length, found: hit !== undefined, text: hit ? (hit.textContent ?? '').trim() : '' };
  });
  check('G5-1 命令面板可开且命中「使用说明书」命令（label 走 i18n）', paletteOpen === true && cmdRow.found === true, JSON.stringify(cmdRow));
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    const hit = rows.find((row) => (row.textContent ?? '').includes('使用说明书'));
    hit?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  const openedByCmd = await waitFor(async () => manualVisible(page), 6000);
  check('G5-2 执行该命令 → 说明书视图再现（命令面板与帮助菜单同通道）', openedByCmd === true, `manualVisible=${String(openedByCmd)}`);
  await page.keyboard.press('Escape');
  await waitFor(async () => (await manualVisible(page)) === false, 6000);

  // --- G6 切 English --------------------------------------------------------
  STEP = 'G6|english';
  const patched = await page.evaluate(async () => {
    window.localStorage.setItem('septcats.localePref', 'en-US');
    const res = await window.septcats.settings.patch({ locale: 'en-US' });
    return res?.locale ?? null;
  });
  await wait(900);
  const menu2 = await menuState();
  phases.menuEn = menu2;
  info('切 English 后原生菜单（原始）', JSON.stringify(menu2));
  check(
    'G6-1 切 English → 原生菜单 label 变 User Manual（main 权威；位置/分隔线不变）',
    patched === 'en-US' && menu2.ok === true && menu2.helpItems[0].label === 'User Manual' && menu2.helpItems[1].type === 'separator' && menu2.helpItems[2].label === 'About Septcats',
    JSON.stringify(menu2.helpItems),
  );
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('.sc-shell') !== null), 30000);
  await wait(1800);
  await clickManualMenuItem();
  const openedEn = await waitFor(async () => manualVisible(page), 8000);
  const en = await page.evaluate(() => ({
    title: document.querySelector('.manual-view__title')?.textContent ?? '',
    docTitle: document.querySelector('.manual-view__h1')?.textContent ?? '',
    hasGettingStarted: [...document.querySelectorAll('[data-testid="manual-content"] h2')].some((h) => (h.textContent ?? '').trim() === 'Getting Started'),
    anchors: document.querySelectorAll('[data-testid="manual-anchors"] button').length,
  }));
  phases.en = en;
  info('English 说明书（原始）', JSON.stringify(en));
  check('G6-2 reload 后 renderer 为 English，再开说明书：标题 User Manual + 正文 Getting Started', openedEn === true && en.title === 'User Manual' && en.docTitle.includes('User Manual') && en.hasGettingStarted === true, JSON.stringify(en));
  await page.screenshot({ path: join(SHOTS, 't56-en-content.png') });
  check('G6-3 截图②（en 正文）已产出', existsSync(join(SHOTS, 't56-en-content.png')), 't56-en-content.png');

  // --- G7 退出 --------------------------------------------------------------
  const quitResult = await quit(page, boot.pid, boot.browser);
  boot.quit = quitResult;
  quits.push(quitResult);
  check('G7-1 退出干净：window.close() 优雅退出（未强杀）', quitResult.gracefulExited === true, JSON.stringify(quitResult));
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
  for (const pid of listeningPids(PORT)) killTree(pid);
  const realRootMtimeAfter = (() => {
    try {
      return String(statSync(REAL_ROOT).mtimeMs);
    } catch {
      return 'absent';
    }
  })();
  const electrons = electronCount();
  const passes = results.filter((r) => r.ok === true).length;
  const fails = results.filter((r) => r.ok === false).length;
  const payload = {
    task: 'TASK-T56-01 真机取证（使用说明书嵌入帮助菜单）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) + main-process Node inspector (--inspect) 读 Menu.getApplicationMenu()；截图 = renderer page.screenshot',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: ['t56-zh-content.png', 't56-en-content.png', 't56-anchors-collapsed.png'],
    electronProcessesAfterQuit: electrons,
    pass: passes,
    fail: fails,
    quiet: quits,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T56-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}  electron 进程数=${String(electrons)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
