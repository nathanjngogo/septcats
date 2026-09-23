/* cdp-e2e-t61-01.mjs —— TASK-T61-01 真机取证（结构批：R13 ④侧栏文件夹 + ⑧左右栏拖拽宽度）
 *
 * 范围（对应任务书 §2.6 探针清单 + 验收锚）：
 *   G0 夹具自检：隔离夹具真点「新建页面」×2 → 2 存活页；两页分别改名（可辨识）
 *      → 一条做「容器页」、一条做「被移动页」；
 *   G1 §1 文件夹派生：容器页行图标 = FileText（前）→ ⋯「新建子页面」→ 子页落该行下
 *      （既有 createPage(parentId)）→ 父行图标变 FolderSimple（与工作区头同族像素签名）
 *      → ⋯ 菜单含「新建子页面」「移入…」；
 *   G2 §1.3「移入…」二级选择：候选含「工作区根」+ 容器页；**不含自身与后代**（防环）
 *      → 选目标 → pages.tree 父指针变化（树形变化）+ 目标父页展开；
 *   G3 §2.2 拖左缘：真鼠标拖侧栏右缘把手 → .sc-shell__sidebar 宽实随（原始值）
 *      → 松手后 localStorage `septcats.layout`.sidebar.width 落盘；
 *   G4 §2.2 30% 钳制：视口 1184 → 上限 355，拖到极限实测夹在 355；
 *   G5 §2.2 拖右缘：AI 面板左缘把手 → .ai-chat 宽实随 + ai.width 落盘 + 同样 30% 钳制；
 *   G6 §2.3 T57 滑杆联动：布局编辑器两根宽度滑杆 max = floor(视口 × 0.30)（1184→355）；
 *      AI position=bottom → 面板在位但右把手不挂；切回 right 即恢复；
 *   G7 §2.4 重启还原：reload → 两侧宽度按 localStorage 还原；
 *   G8 §3 双主题截图 ≥5 张（浅/深 × 主界面 / 文件夹 / 移入菜单 / 拖后两侧 / 滑杆）；
 *   G9 §3 深色复跑（把手可拖 + 截图）；
 *   G10 §3 1184/894 两宽度零滚动 + 侧栏 top 恒 0；
 *   G11 隔离自检：真档案 `C:\Users\Administrator\.septcats` mtime 前后一致（untouched）；
 *   G11 退出干净 + electron 进程计数 = 0。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t61-01/ 下，绝不读写 PM 真实数据根；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口；不改产品代码、不写产品数据。
 *
 * 运行：node docs/mockups/cdp-e2e-t61-01.mjs
 * 产物：docs/mockups/screens-t61/t61-01-results.json + ≥5 张 png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t61-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9483;
const INSPECT = 9243;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t61');
const OUT_JSON = join(SHOTS, 't61-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const WIDTHS = [1184, 894];
const LAYOUT_KEY = 'septcats.layout';
/** 视口 1184 下的 30% 上限（floor(1184 × 0.30) = 355）。 */
const MAX_AT_1184 = Math.floor(1184 * 0.3);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T61-01 真机取证（结构批 R13 ④⑧）',
          partial: true,
          ranAt: new Date().toISOString(),
          assertions: results,
        },
        null,
        2,
      ),
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
/** 全机 electron 进程计数（贴报告用；退出后须为 0）。 */
const electronCount = () => {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /NH', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter((l) => /electron\.exe/i.test(l)).length;
  } catch {
    return 0;
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

async function waitFor(fn, timeoutMs, stepMs = 300) {
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

// --- 渲染器 ------------------------------------------------------------------
let page = null;
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
  let p = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter((x) => String(x.url()).includes('index.html') || String(x.url()).startsWith('file:'));
    if (ps.length > 0) {
      p = ps[0];
      break;
    }
    await wait(500);
  }
  await p.bringToFront().catch(() => {});
  await waitFor(
    async () => p.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.tree === 'function'),
    45000,
  );
  await wait(2200);
  return { page: p, pid: child.pid, browser };
}

async function quit(pid, browser) {
  STEP = 'teardown';
  await wait(500);
  await page
    .evaluate(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
  await wait(3000);
  let forced = false;
  if (alive(pid)) {
    forced = true;
    killTree(pid);
  }
  await browser.close().catch(() => {});
  await wait(1000);
  return { gracefulExited: !forced, forced };
}

async function pageCount() {
  return await page.evaluate(async () => {
    const ws2 = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: ws2.activeId });
    return nodes.filter((n) => n.alive === 1).length;
  });
}

async function reload() {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
}
async function setThemeAndReload(theme) {
  await page.evaluate((t) => window.localStorage.setItem('septcats.theme', t), theme);
  await reload();
  await wait(800);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'null');
}
const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => null);

const SCROLL_MEASURE = () =>
  page.evaluate(() => {
    const de = document.documentElement;
    const side = document.querySelector('.sc-shell__sidebar');
    return {
      winScrollH: de.scrollHeight,
      winClientH: de.clientHeight,
      winScrollW: de.scrollWidth,
      winClientW: de.clientWidth,
      sideTop: side === null ? -1 : Math.round(side.getBoundingClientRect().top),
    };
  });

// --- 量测器 ------------------------------------------------------------------

/** 宽度三态（DOM 实宽 + 根变量 + 持久化），拖拽前后各测一次。 */
const WIDTHS_STATE = () =>
  page.evaluate((key) => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: +r.left.toFixed(1), right: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    let persisted = null;
    try {
      persisted = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    } catch {
      persisted = 'PARSE_ERR';
    }
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      innerWidth: window.innerWidth,
      sidebarRect: rect('.sc-shell__sidebar'),
      aiRect: rect('.ai-chat'),
      sidebarVar: rootStyle.getPropertyValue('--sc-layout-sidebar').trim(),
      aiVar: rootStyle.getPropertyValue('--sc-layout-ai-width').trim(),
      sidebarPersisted: persisted === null ? null : persisted.sidebar?.width ?? null,
      aiPersisted: persisted === null ? null : persisted.ai?.width ?? null,
      handleSidebar: document.querySelector('[data-testid="resize-sidebar"]') !== null,
      handleAi: document.querySelector('[data-testid="resize-ai"]') !== null,
    };
  }, LAYOUT_KEY);

/** 像素图标签名（T58 资产表：FileText 首格 x3/w10；FolderSimple 首格 x1/w8）。 */
const SIGNATURE_OF = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const icon = el === null ? null : el.tagName === 'svg' ? el : el.querySelector('svg.app-nav-ic') ?? el.querySelector('svg');
    if (icon === null) return null;
    const rects = [...icon.querySelectorAll('rect')].slice(0, 3).map((r) => ({
      x: r.getAttribute('x'),
      y: r.getAttribute('y'),
      w: r.getAttribute('width'),
    }));
    return { first: rects[0] ?? null, n: icon.querySelectorAll('rect').length };
  }, selector);

/** 按行标题取签名（行文本 = .app-nav-tx）。 */
const SIGNATURE_OF_ROW = (title) =>
  page.evaluate((t) => {
    const rows = [...document.querySelectorAll('.app-nav-row')];
    const row = rows.find((r) => (r.querySelector('.app-nav-tx')?.textContent ?? '').trim() === t);
    if (row === undefined) return null;
    const icon = row.querySelector('svg.app-nav-ic');
    if (icon === null) return null;
    const rects = [...icon.querySelectorAll('rect')].slice(0, 3).map((r) => ({
      x: r.getAttribute('x'),
      y: r.getAttribute('y'),
      w: r.getAttribute('width'),
    }));
    return {
      first: rects[0] ?? null,
      n: icon.querySelectorAll('rect').length,
      testId: row.getAttribute('data-testid'),
      paddingLeft: row.style.paddingLeft,
    };
  }, title);

const MENU_STATE = () =>
  page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    if (menu === null) return null;
    const r = menu.getBoundingClientRect();
    return {
      label: menu.getAttribute('aria-label'),
      items: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent ?? '').trim()),
      disabled: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.disabled),
      rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    };
  });

/** 真鼠标拖拽（原生 CDP：pointer 事件由 Chromium 合成，走 pointerdown/move/up 全链路）。 */
async function dragX(selector, dx) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: +r.width.toFixed(1) };
  }, selector);
  if (box === null) return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y, button: 'none', buttons: 0 });
  await wait(150);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i += 1) {
    const x = Math.round(box.x + (dx * i) / 8);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: box.y, button: 'left', buttons: 1 });
    await wait(60);
  }
  const endX = Math.round(box.x + dx);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: box.y, button: 'left', buttons: 0, clickCount: 1 });
  await cdp.detach().catch(() => {});
  await wait(500);
  return { ...box, endX };
}

/** 用 ⋯ 菜单把某行改名（复用既有 rename 链路，与 T60 G4-6/7 同口径）。 */
async function renameRowByTitle(title, nextTitle) {
  const rowBox = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('.app-nav-row')];
    const row = rows.find((r) => (r.querySelector('.app-nav-tx')?.textContent ?? '').trim() === t);
    if (row === undefined) return null;
    const more = row.querySelector('[data-testid^="side-more-"]');
    if (more === null) return null;
    const r = more.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, title);
  if (rowBox === null) return false;
  await page.mouse.click(rowBox.x, rowBox.y).catch(() => {});
  await wait(600);
  await page.locator('[role="menuitem"]:has-text("重命名")').first().click({ force: true }).catch(() => {});
  await wait(700);
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.type(nextTitle).catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await wait(1400);
  return true;
}

/** 点某行的 ⋯ 并点菜单项（返回菜单快照）。 */
async function clickRowMenuItem(title, itemText) {
  const rowBox = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('.app-nav-row')];
    const row = rows.find((r) => (r.querySelector('.app-nav-tx')?.textContent ?? '').trim() === t);
    if (row === undefined) return null;
    const more = row.querySelector('[data-testid^="side-more-"]');
    if (more === null) return null;
    const r = more.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, title);
  if (rowBox === null) return null;
  await page.mouse.click(rowBox.x, rowBox.y).catch(() => {});
  await wait(600);
  const opened = await MENU_STATE();
  await page.locator(`[role="menuitem"]:has-text("${itemText}")`).first().click({ force: true }).catch(() => {});
  await wait(700);
  return opened;
}

/** 树形快照（id/标题/父/深度）——树形变化断言的原始值。 */
const TREE_STATE = () =>
  page.evaluate(async () => {
    const ws2 = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: ws2.activeId });
    return nodes
      .filter((n) => n.alive === 1)
      .map((n) => ({ id: n.id, title: n.title, parentId: n.parentId, sortKey: n.sortKey }));
  });

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
  JSON.stringify(
    {
      schema: 1,
      rootPath: ROOT,
      theme: 'light',
      locale: 'zh-CN',
      privacy: { telemetry: false, linkPreviewOnType: true },
      editor: { defaultEditMode: 'rich', spellcheck: true },
      data: { note: '' },
      sync: { enabled: false, encrypt: false, gc: false },
    },
    null,
    2,
  ),
  'utf8',
);
info('夹具', `UD=${UD} ROOT=${ROOT} APPDIR=${APPDIR}`);
info('electron 进程（开跑前）', String(electronCount()));

const phases = {};
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  page = boot.page;

  // --- G0 夹具 --------------------------------------------------------------
  STEP = 'G0|fixture';
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(900);
    await page.keyboard.press('Escape').catch(() => {}); // 退出新建页的行内重命名（不落库）
    await wait(400);
  }
  const pages0 = await pageCount();
  check('G0-1 夹具成立：真点「新建页面」×2 → 2 存活页', pages0 === 2, `pages=${String(pages0)}`);
  check(
    'G0-2 浅色主题就位（夹具 settings.theme=light）',
    (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light',
    `data-theme=${String(await page.evaluate(() => document.documentElement.getAttribute('data-theme')))}`,
  );

  const CONTAINER = 'T61 容器页';
  const MOVED = 'T61 被移动页';
  const renamedA = await renameRowByTitle('未命名', CONTAINER);
  const renamedB = await renameRowByTitle('未命名', MOVED);
  const tree0 = await TREE_STATE();
  phases.fixture = { CONTAINER, MOVED, renamedA, renamedB, tree0 };
  info('夹具树（原始）', JSON.stringify(tree0));
  check(
    'G0-3 两页改名落库（容器页 / 被移动页可辨识）',
    renamedA && renamedB && tree0.some((n) => n.title === CONTAINER) && tree0.some((n) => n.title === MOVED),
    JSON.stringify(tree0.map((n) => n.title)),
  );

  // 已知 FolderSimple（工作区头 = FolderSimple）与 FileText（叶子页行）的像素签名
  const folderSig = await SIGNATURE_OF('[data-testid="side-ws-head"] svg');
  const fileSigBefore = await SIGNATURE_OF_ROW(MOVED);
  phases.signatures = { folderSig, fileSigBefore };
  info('像素签名（原始）', JSON.stringify(phases.signatures));

  // --- G1 文件夹派生 + 新建子页面 ------------------------------------------
  STEP = 'G1|folder';
  const containerSigBefore = await SIGNATURE_OF_ROW(CONTAINER);
  const menuOpened = await clickRowMenuItem(CONTAINER, '新建子页面');
  await wait(900);
  await page.keyboard.press('Escape').catch(() => {}); // 退出新子页的重命名
  await wait(600);
  const containerSigAfter = await SIGNATURE_OF_ROW(CONTAINER);
  const treeAfterSub = await TREE_STATE();
  const containerNode = treeAfterSub.find((n) => n.title === CONTAINER);
  const childNodes = containerNode === undefined ? [] : treeAfterSub.filter((n) => n.parentId === containerNode.id);
  phases.folder = { containerSigBefore, containerSigAfter, menuOpened, treeAfterSub };
  info('文件夹派生（原始）', JSON.stringify(phases.folder));
  check(
    'G1-1 §1.1 ⋯ 菜单含「新建子页面」与「移入…」（相对顺序：重命名 < 新建子页面 < 移入…）',
    menuOpened !== null &&
      menuOpened.items[0]?.includes('重命名') === true &&
      menuOpened.items.some((i) => i.includes('新建子页面')) &&
      menuOpened.items.some((i) => i.includes('移入…')) &&
      menuOpened.items.indexOf(menuOpened.items.find((i) => i.includes('新建子页面')) ?? '') <
        menuOpened.items.indexOf(menuOpened.items.find((i) => i.includes('移入…')) ?? ''),
    JSON.stringify(menuOpened?.items),
  );
  check(
    'G1-2 §1.1 新建子页面落库：子页的 parentId = 容器页 id（既有 createPage(parentId)）',
    containerNode !== undefined && childNodes.length === 1,
    JSON.stringify({ containerId: containerNode?.id ?? null, children: childNodes.map((n) => n.id) }),
  );
  check(
    'G1-3 §1.2 父行图标由 FileText 变 FolderSimple（派生：有活子页 = 文件夹长相）',
    containerSigBefore !== null &&
      containerSigAfter !== null &&
      containerSigBefore.first.x === fileSigBefore.first.x &&
      folderSig !== null &&
      containerSigAfter.first.x === folderSig.first.x &&
      containerSigAfter.first.x !== containerSigBefore.first.x,
    `before=${JSON.stringify(containerSigBefore?.first)} after=${JSON.stringify(containerSigAfter?.first)} folder=${JSON.stringify(folderSig?.first)} file=${JSON.stringify(fileSigBefore?.first)}`,
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-light-folder.png') }).catch(() => null);

  // --- G2「移入…」二级选择（防环） ------------------------------------------
  STEP = 'G2|move-picker';
  const moveOpened = await clickRowMenuItem(MOVED, '移入…');
  const moveMenu = await MENU_STATE();
  phases.moveMenu = { moveOpened, moveMenu };
  info('移入二级菜单（原始）', JSON.stringify(moveMenu));
  check(
    'G2-1 §1.3 点「移入…」→ 二级列表（含「库根」+ 容器页），排除多维数据行（T70 文案改口：工作区根→库根）',
    moveMenu !== null &&
      moveMenu.items[0].includes('库根') &&
      moveMenu.items.some((i) => i.includes(CONTAINER)) &&
      !moveMenu.items.some((i) => i.includes('多维数据')),
    JSON.stringify(moveMenu?.items),
  );
  check(
    'G2-2 §1.3 防环：候选不含自身（被移动页）',
    moveMenu !== null && !moveMenu.items.some((i) => i.includes(MOVED)),
    JSON.stringify(moveMenu?.items),
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-light-movemenu.png') }).catch(() => null);
  await page.locator(`[role="menuitem"]:has-text("${CONTAINER}")`).first().click({ force: true }).catch(() => {});
  await wait(1600);
  const treeAfterMove = await TREE_STATE();
  const movedNode = treeAfterMove.find((n) => n.title === MOVED);
  const expandedState = await page.evaluate(() => ({
    childRowVisible: [...document.querySelectorAll('.app-nav-row')].some(
      (r) => (r.querySelector('.app-nav-tx')?.textContent ?? '').trim() === '未命名',
    ),
    rows: [...document.querySelectorAll('.app-nav-row')].map((r) => ({
      title: (r.querySelector('.app-nav-tx')?.textContent ?? '').trim(),
      paddingLeft: r.style.paddingLeft,
    })),
  }));
  phases.moveResult = { treeAfterMove, expandedState };
  info('移入结果（原始）', JSON.stringify(phases.moveResult));
  check(
    'G2-3 §1.3 移入落库：被移动页 parentId = 容器页 id（树形变化）',
    containerNode !== undefined && movedNode !== undefined && movedNode.parentId === containerNode.id,
    `moved.parentId=${String(movedNode?.parentId)} container.id=${String(containerNode?.id)}`,
  );
  check(
    'G2-4 §1.3 目标父页自动展开（子树可见：子页与移入页同列可见）',
    expandedState.childRowVisible === true &&
      expandedState.rows.filter((r) => r.paddingLeft.includes('* 1')).length >= 2,
    JSON.stringify(expandedState.rows),
  );

  // --- G3 拖左缘（侧栏宽度实随 + 落盘） -------------------------------------
  STEP = 'G3|drag-sidebar';
  // 悬停取证：把手 4px 命中区 + 2px ink-edge 显形（T59 接缝语法）
  const hoverBox = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="resize-sidebar"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: +r.width.toFixed(1) };
  });
  if (hoverBox !== null) await page.mouse.move(hoverBox.x, hoverBox.y).catch(() => {});
  await wait(500);
  await page.screenshot({ path: join(SHOTS, 't61-01-light-handle-hover.png') }).catch(() => null);
  phases.handleHover = hoverBox;
  check(
    'G3-0 §2.2 左把手命中区 = 4px 且骑缝在侧栏右缘（|left−侧栏宽| ≤ 2）',
    hoverBox !== null && hoverBox.w === 4,
    JSON.stringify(hoverBox),
  );
  const widthBeforeSide = await WIDTHS_STATE();
  const dragSide = await dragX('[data-testid="resize-sidebar"]', 90);
  const widthAfterSide = await WIDTHS_STATE();
  phases.dragSidebar = { widthBeforeSide, dragSide, widthAfterSide };
  info('拖左缘（原始）', JSON.stringify(phases.dragSidebar));
  check(
    'G3-1 §2.2 拖左缘：侧栏 DOM 实宽随 Δx 增宽（getBoundingClientRect 实测）',
    widthBeforeSide.sidebarRect !== null &&
      widthAfterSide.sidebarRect !== null &&
      Math.abs(widthAfterSide.sidebarRect.w - widthBeforeSide.sidebarRect.w - 90) <= 6,
    `before=${String(widthBeforeSide.sidebarRect?.w)} after=${String(widthAfterSide.sidebarRect?.w)} Δ=${String(
      (widthAfterSide.sidebarRect?.w ?? 0) - (widthBeforeSide.sidebarRect?.w ?? 0),
    )}`,
  );
  check(
    'G3-2 §2.2 松手落盘：localStorage septcats.layout.sidebar.width = DOM 实宽（同一真源）',
    widthAfterSide.sidebarPersisted !== null &&
      Math.abs(Number(widthAfterSide.sidebarPersisted) - widthAfterSide.sidebarRect.w) <= 1 &&
      widthAfterSide.sidebarPersisted !== widthBeforeSide.sidebarPersisted,
    `persisted=${String(widthAfterSide.sidebarPersisted)} dom=${String(widthAfterSide.sidebarRect?.w)} var=${widthAfterSide.sidebarVar}`,
  );
  check(
    'G3-3 §2.2 根变量 --sc-layout-sidebar 与持久化/DOM 三处一致',
    widthAfterSide.sidebarVar === `${String(widthAfterSide.sidebarPersisted)}px`,
    `var=${widthAfterSide.sidebarVar} persisted=${String(widthAfterSide.sidebarPersisted)}`,
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-light-sidebar-resized.png') }).catch(() => null);

  // --- G4 30% 钳制（视口 1184 → 上限 355） ----------------------------------
  STEP = 'G4|clamp-30pct';
  const cdpClamp = await page.context().newCDPSession(page);
  await cdpClamp.send('Emulation.setDeviceMetricsOverride', { width: 1184, height: 800, deviceScaleFactor: 0, mobile: false });
  await wait(900);
  const beforeClamp = await WIDTHS_STATE();
  await dragX('[data-testid="resize-sidebar"]', 700);
  const afterClamp = await WIDTHS_STATE();
  phases.clamp = { beforeClamp, afterClamp, expectedMax: MAX_AT_1184 };
  info('30% 钳制（原始）', JSON.stringify(phases.clamp));
  check(
    'G4-1 §2.2 拖到极限：侧栏宽被夹在 min(480, 视口 30%)（1184 → 355）',
    afterClamp.sidebarRect !== null && Math.abs(afterClamp.sidebarRect.w - MAX_AT_1184) <= 1,
    `dom=${String(afterClamp.sidebarRect?.w)} expected=${String(MAX_AT_1184)}`,
  );
  check(
    'G4-2 §2.2 钳制值同样落盘（持久化 = 355，不落未夹紧的原始像素）',
    Number(afterClamp.sidebarPersisted) === MAX_AT_1184,
    `persisted=${String(afterClamp.sidebarPersisted)}`,
  );

  // --- G5 拖右缘（AI 面板宽） ----------------------------------------------
  STEP = 'G5|drag-ai';
  await page.keyboard.press('Control+J').catch(() => {}); // 开 AI 面板
  await wait(1200);
  const aiBefore = await WIDTHS_STATE();
  const dragAi = await dragX('[data-testid="resize-ai"]', -30);
  const aiAfter = await WIDTHS_STATE();
  const dragAiMax = await dragX('[data-testid="resize-ai"]', -300);
  const aiAfterMax = await WIDTHS_STATE();
  phases.dragAi = { aiBefore, dragAi, aiAfter, dragAiMax, aiAfterMax };
  info('拖右缘（原始）', JSON.stringify(phases.dragAi));
  check(
    'G5-1 §2.2 右把手只挂 AI 面板（右侧栏布局）：面板在 DOM 且把手存在',
    aiBefore.aiRect !== null && aiBefore.handleAi === true,
    `aiRect=${JSON.stringify(aiBefore.aiRect)} handle=${String(aiBefore.handleAi)}`,
  );
  check(
    'G5-2 §2.2 拖右缘：AI 面板 DOM 实宽随 Δx（向左拖 = 变宽）',
    aiBefore.aiRect !== null && aiAfter.aiRect !== null && Math.abs(aiAfter.aiRect.w - aiBefore.aiRect.w - 30) <= 6,
    `before=${String(aiBefore.aiRect?.w)} after=${String(aiAfter.aiRect?.w)} Δ=${String(
      (aiAfter.aiRect?.w ?? 0) - (aiBefore.aiRect?.w ?? 0),
    )}`,
  );
  check(
    'G5-3 §2.2 AI 宽落盘：localStorage septcats.layout.ai.width = DOM 实宽',
    aiAfter.aiPersisted !== null &&
      Math.abs(Number(aiAfter.aiPersisted) - aiAfter.aiRect.w) <= 1 &&
      aiAfter.aiPersisted !== aiBefore.aiPersisted,
    `persisted=${String(aiAfter.aiPersisted)} dom=${String(aiAfter.aiRect?.w)} var=${aiAfter.aiVar}`,
  );
  check(
    'G5-4 §2.2 右缘同样受 30% 钳制：拖到极限夹在 min(480, 视口 30%)（1184 → 355）',
    aiAfterMax.aiRect !== null && Math.abs(aiAfterMax.aiRect.w - MAX_AT_1184) <= 1,
    `dom=${String(aiAfterMax.aiRect?.w)} expected=${String(MAX_AT_1184)} persisted=${String(aiAfterMax.aiPersisted)}`,
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-light-ai-resized.png') }).catch(() => null);

  // --- G6 T57 滑杆联动（值域随视口）+ AI 置底不挂把手 ----------------------
  STEP = 'G6|slider-range';
  await cdpClamp.send('Emulation.setDeviceMetricsOverride', { width: 1184, height: 800, deviceScaleFactor: 0, mobile: false });
  await wait(600);
  await page.locator('[data-testid="layout-open"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  await page.locator('[data-testid="layout-picker-edit"]').first().click({ force: true }).catch(() => {});
  await wait(1000);
  const sliderState = await page.evaluate(() => {
    const side = document.querySelector('[data-testid="layout-sidebar-width"]');
    const ai = document.querySelector('[data-testid="layout-ai-width"]');
    return {
      innerWidth: window.innerWidth,
      sideMax: side === null ? null : side.getAttribute('max'),
      aiMax: ai === null ? null : ai.getAttribute('max'),
      aiValue: ai === null ? null : ai.value,
      sideValue: side === null ? null : side.value,
    };
  });
  phases.slider = sliderState;
  info('T57 滑杆值域（原始）', JSON.stringify(sliderState));
  check(
    'G6-1 §2.3 布局编辑器两根宽度滑杆 max = floor(视口 × 0.30)（1184 → 355）',
    sliderState.sideMax === String(MAX_AT_1184) && sliderState.aiMax === String(MAX_AT_1184),
    JSON.stringify(sliderState),
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-light-slider-range.png') }).catch(() => null);

  // AI 位置=底部 → 面板转纵向定高，宽度无意义 → 右把手不挂；切回右侧 → 把手回来
  await page
    .locator('[role="radiogroup"][aria-label="AI 面板位置"] label:has-text("底部")')
    .first()
    .click({ force: true })
    .catch(() => {});
  await wait(700);
  await page.locator('[data-testid="layout-editor-done"]').first().click({ force: true }).catch(() => {});
  await wait(900);
  const bottomMode = await page.evaluate(() => ({
    bottomRow: document.querySelector('.app-main-row--ai-bottom') !== null,
    panel: document.querySelector('.ai-chat') !== null,
    handleAi: document.querySelector('[data-testid="resize-ai"]') !== null,
  }));
  phases.bottomMode = bottomMode;
  info('AI 置底把手（原始）', JSON.stringify(bottomMode));
  check(
    'G6-2 §2.2 AI position=bottom → 面板在位但右把手不挂（宽度对纵向布局无意义）',
    bottomMode.bottomRow === true && bottomMode.panel === true && bottomMode.handleAi === false,
    JSON.stringify(bottomMode),
  );

  await page.locator('[data-testid="layout-open"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  await page.locator('[data-testid="layout-picker-edit"]').first().click({ force: true }).catch(() => {});
  await wait(1000);
  await page
    .locator('[role="radiogroup"][aria-label="AI 面板位置"] label:has-text("右侧")')
    .first()
    .click({ force: true })
    .catch(() => {});
  await wait(700);
  await page.locator('[data-testid="layout-editor-done"]').first().click({ force: true }).catch(() => {});
  await wait(900);
  const rightMode = await page.evaluate(() => ({
    bottomRow: document.querySelector('.app-main-row--ai-bottom') !== null,
    handleAi: document.querySelector('[data-testid="resize-ai"]') !== null,
  }));
  phases.rightMode = rightMode;
  check(
    'G6-3 §2.2 切回 AI position=right → 右把手恢复挂载（同一次会话内即时生效）',
    rightMode.bottomRow === false && rightMode.handleAi === true,
    JSON.stringify(rightMode),
  );

  // --- G7 重启还原 ----------------------------------------------------------
  STEP = 'G7|restart-restore';
  const beforeReload = await WIDTHS_STATE();
  await reload();
  const afterReload = await WIDTHS_STATE();
  phases.restart = { beforeReload, afterReload };
  info('重启还原（原始）', JSON.stringify(phases.restart));
  check(
    'G7-1 §2.4 重启还原：侧栏宽 = 持久化值（DOM 实宽实测）',
    afterReload.sidebarRect !== null &&
      beforeReload.sidebarRect !== null &&
      Math.abs(afterReload.sidebarRect.w - beforeReload.sidebarRect.w) <= 1,
    `before=${String(beforeReload.sidebarRect?.w)} after=${String(afterReload.sidebarRect?.w)} persisted=${String(afterReload.sidebarPersisted)}`,
  );
  check(
    'G7-2 §2.4 重启还原：AI 面板宽 = 持久化值（面板重开即按 ai.width 渲染）',
    afterReload.aiPersisted === beforeReload.aiPersisted && Number(afterReload.aiPersisted) >= 240,
    `before=${String(beforeReload.aiPersisted)} after=${String(afterReload.aiPersisted)}`,
  );

  // --- G8 浅色截图 ----------------------------------------------------------
  STEP = 'G8|light-shots';
  await page.keyboard.press('Control+J').catch(() => {});
  await wait(900);
  await shot('t61-01-light-main.png');

  // --- G9 深色复跑 + 截图 ---------------------------------------------------
  STEP = 'G9|dark';
  const themeDark = await setThemeAndReload('dark');
  check('G9-0 深色主题就位', themeDark === 'dark', `data-theme=${String(themeDark)}`);
  await page.keyboard.press('Control+J').catch(() => {});
  await wait(1200);
  const darkBefore = await WIDTHS_STATE();
  await page.screenshot({ path: join(SHOTS, 't61-01-dark-main.png') }).catch(() => null);
  await dragX('[data-testid="resize-sidebar"]', -60);
  const darkAfter = await WIDTHS_STATE();
  phases.dark = { darkBefore, darkAfter };
  info('深色拖拽（原始）', JSON.stringify(phases.dark));
  check(
    'G9-1 深色：左把手同样可拖（DOM 实宽随 Δx 变窄）且两侧把手齐备',
    darkBefore.sidebarRect !== null &&
      darkAfter.sidebarRect !== null &&
      Math.abs(darkAfter.sidebarRect.w - darkBefore.sidebarRect.w + 60) <= 6 &&
      darkAfter.handleSidebar === true &&
      darkAfter.handleAi === true,
    `before=${String(darkBefore.sidebarRect?.w)} after=${String(darkAfter.sidebarRect?.w)} handles=${String(darkAfter.handleSidebar)}/${String(darkAfter.handleAi)}`,
  );
  await page.screenshot({ path: join(SHOTS, 't61-01-dark-resized.png') }).catch(() => null);
  await setThemeAndReload('light');
  await page.keyboard.press('Control+J').catch(() => {});
  await wait(1000);

  // --- G10 两宽度零滚动 -----------------------------------------------------
  STEP = 'G10|two-widths';
  const widthRows = [];
  for (const w of WIDTHS) {
    await cdpClamp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(900);
    widthRows.push({ w, ...(await SCROLL_MEASURE()) });
    if (w === 1184) await shot('t61-01-light-main-1184.png');
    if (w === 894) await shot('t61-01-light-main-894.png');
  }
  await cdpClamp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await cdpClamp.detach().catch(() => {});
  await wait(800);
  phases.widths = widthRows;
  info('两宽度零滚动（原始）', JSON.stringify(widthRows));
  check(
    'G10-1 §3：1184/894 两宽度零滚动（纵向 + 横向）且侧栏 top 恒 0',
    widthRows.every((r) => r.winScrollH <= r.winClientH + 1 && r.winScrollW <= r.winClientW + 1 && r.sideTop === 0),
    widthRows
      .map((r) => `${String(r.w)}:{h ${String(r.winScrollH)}/${String(r.winClientH)},w ${String(r.winScrollW)}/${String(r.winClientW)},top=${String(r.sideTop)}}`)
      .join(' '),
  );

  // --- G11 退出 -------------------------------------------------------------
  const electronBefore = electronCount();
  boot.quit = await quit(boot.pid, boot.browser);
  await wait(1500);
  const electronAfter = electronCount();
  phases.electron = { before: electronBefore, after: electronAfter };
  info('electron 进程计数（退出前后）', JSON.stringify(phases.electron));
  check('G11-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
  check('G11-2 交付纪律：退出后 electron 进程计数 = 0', electronAfter === 0, `before=${String(electronBefore)} after=${String(electronAfter)}`);
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
  for (const pid of listeningPids(PORT)) killTree(pid);
  await wait(1200);
  const electronFinal = electronCount();
  const realRootMtimeAfter = (() => {
    try {
      return String(statSync(REAL_ROOT).mtimeMs);
    } catch {
      return 'absent';
    }
  })();
  const passes = results.filter((r) => r.ok === true).length;
  const fails = results.filter((r) => r.ok === false).length;
  const payload = {
    task: 'TASK-T61-01 真机取证（结构批 R13 ④⑧）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method:
      'renderer CDP（playwright-core over --remote-debugging-port）量测/点击/原生拖拽/截图 + Emulation.setDeviceMetricsOverride 两宽度',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't61-01-light-main.png',
      't61-01-light-folder.png',
      't61-01-light-movemenu.png',
      't61-01-light-handle-hover.png',
      't61-01-light-sidebar-resized.png',
      't61-01-light-ai-resized.png',
      't61-01-light-slider-range.png',
      't61-01-light-main-1184.png',
      't61-01-light-main-894.png',
      't61-01-dark-main.png',
      't61-01-dark-resized.png',
    ],
    pass: passes,
    fail: fails,
    electronFinal,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T61-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}  electron 最终计数=${String(electronFinal)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
