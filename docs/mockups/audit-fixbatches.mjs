/* audit-fixbatches.mjs —— 独立复核探针（老板指派的第三方复核，非 PM 自跑、非工程师自报）
 *
 * 范围：5 条未经 PM 独立复核的修复提交
 *   - 3e5e6c7：T42-01-1（wiki 页误接协作层）/ T43-01-1（显式选 English 重启回中文）/ T40-01-1（勾选列写不进值）
 *   - 4d25613：T44-01-1（删目标页后链接仍判已解析）
 *   - 17946d5：T41-01-1（DB 页全宽项无视觉效果）
 *
 * 纪律：
 * - 本探针**只跑已打包的 out/**（不重打包、不改产品源码、不碰 git）；不设代理。
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/audit-fixbatches/ 下，
 *   绝不读写 C:\Users\Administrator\.septcats\（老板真实数据根）。
 * - 判据由复核方自拟，不引用/转述原报告数值；每条断言都落原始值。
 *
 * 运行：node docs/mockups/audit-fixbatches.mjs
 * 产物：docs/mockups/screens-t38/audit-fixbatches-results.json（原始数值）
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..'); // 本 worktree（产物写这里）
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats'; // 已打包 out/ 所在仓库（只读运行）
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core'))
  ? REPO
  : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\audit-fixbatches';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9459;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t38');
const OUT_JSON = join(SHOTS, 'audit-fixbatches-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let TAG = { commit: '(boot)', subject: 'boot' };
const check = (name, ok, raw) => {
  results.push({ ...TAG, name, ok: ok === true, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${TAG.commit}] ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ ...TAG, name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  [${TAG.commit}] ${name}  — ${String(raw)}`);
};
const T42 = { commit: '3e5e6c7 / T42-01-1', subject: 'wiki 页误接协作层' };
const T43 = { commit: '3e5e6c7 / T43-01-1', subject: '显式选 English 重启回中文' };
const T40 = { commit: '3e5e6c7 / T40-01-1', subject: '勾选列值界面写不进去' };
const T44 = { commit: '4d25613 / T44-01-1', subject: '删目标页后链接仍判已解析' };
const T41 = { commit: '17946d5 / T41-01-1', subject: 'DB 页全宽项无视觉效果' };

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
    const out = execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
};
/** 端口占用者（只可能是本探针上一轮的残留，端口为本探针专属） */
const listeningPids = (port) => {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${String(port)}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
};

let STEP = 'boot';
const consoleErrors = [];
const pageErrors = [];
const attach = (page, tag) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${tag}|${STEP}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`[${tag}|${STEP}] ${String(err?.message ?? err)}`);
  });
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

const RECONCILE_SETTLE_MS = 2500;

async function launch(tag) {
  const stale = listeningPids(PORT);
  for (const pid of stale) killTree(pid);
  if (stale.length > 0) await wait(1500);
  const child = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
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
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter(
      (p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'),
    );
    if (ps.length > 0) {
      page = ps[0];
      break;
    }
    await wait(500);
  }
  attach(page, tag);
  await page.bringToFront().catch(() => {});
  await waitFor(
    async () =>
      page.evaluate(
        () =>
          document.querySelector('.app-side') !== null &&
          typeof window.septcats?.pages?.tree === 'function',
      ),
    45000,
  );
  await wait(1800);
  return { page, pid: child.pid, browser };
}

async function quit(page, pid, browser) {
  STEP = 'teardown';
  await page
    .evaluate(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
  await wait(1500);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  await browser.close().catch(() => {});
  await wait(1200);
  return { gracefulExited: !stillAlive };
}

// ---------------------------------------------------------------------------
// DOM / 桥 读取器（全部返回原始值）
// ---------------------------------------------------------------------------

const WIKILINK_STATE = () => {
  const links = [...document.querySelectorAll('.sc-wikilink')];
  return {
    total: links.length,
    unresolved: document.querySelectorAll('.sc-wikilink--unresolved').length,
    items: links.map((el) => ({
      text: el.textContent,
      cls: el.getAttribute('class'),
      dataTarget: el.getAttribute('data-target'),
      dataTitle: el.getAttribute('data-title'),
      outer: el.outerHTML,
    })),
  };
};
const wikilinkState = (page) => page.evaluate(WIKILINK_STATE);

const WIDTH_STATE = () => {
  const box = (el) => {
    if (el === null || el === undefined) return null;
    const b = el.getBoundingClientRect();
    return { w: Number(b.width.toFixed(1)), x: Number(b.x.toFixed(1)) };
  };
  const pvRoot = document.querySelector('.pv-root');
  const measureChain = (() => {
    const out = [];
    let el = document.querySelector('.dbpage') ?? document.querySelector('.pv-body');
    while (el !== null && el !== undefined) {
      if (el.hasAttribute !== undefined && el.hasAttribute('data-measure')) {
        out.push({ tag: el.tagName, cls: el.getAttribute('class'), m: el.getAttribute('data-measure') });
      }
      el = el.parentElement;
    }
    return out;
  })();
  const body = document.querySelector('.pv-body');
  const dbpage = document.querySelector('.dbpage');
  const grid = document.querySelector('.sc-dbgrid');
  return {
    winInner: window.innerWidth,
    pvRootPresent: pvRoot !== null,
    pvRootMeasure: pvRoot === null ? null : pvRoot.getAttribute('data-measure'),
    pvRoot: box(pvRoot),
    pvBody: box(body),
    pvBodyClientW: body === null ? null : body.clientWidth,
    dbpage: box(dbpage),
    dbpageClientW: dbpage === null ? null : dbpage.clientWidth,
    dbgrid: box(grid),
    dbgridClientW: grid === null ? null : grid.clientWidth,
    dbpageClass: dbpage === null ? null : dbpage.getAttribute('class'),
    measureChain,
  };
};
const widthState = (page) => page.evaluate(WIDTH_STATE);

const BACKLINKS_DOM = () => ({
  panel: document.querySelector('[data-testid="backlinks-panel"]') !== null,
  items: document.querySelectorAll('[data-testid="backlinks-item"]').length,
  sources: [...document.querySelectorAll('.pv-backlinks__source')].map((el) => el.textContent),
  contexts: [...document.querySelectorAll('.pv-backlinks__context')].map((el) => el.textContent),
});

const GRID_STATE = () => ({
  gridRows: document.querySelectorAll('.sc-dbrow').length,
  headers: [...document.querySelectorAll('.sc-dbhead__cell')].map((el) => el.getAttribute('title')),
  headerNames: [...document.querySelectorAll('.sc-dbhead__name')].map((el) => el.textContent),
  checkboxCells: document.querySelectorAll('.sc-dbc[data-type="checkbox"]').length,
  checkboxOn: document.querySelectorAll('.sc-dbc-check--on').length,
  propChips: [...document.querySelectorAll('.sc-chip--prop')].map((el) => ({
    label: el.textContent,
    aria: el.getAttribute('aria-label'),
  })),
  menuLabels: [...document.querySelectorAll('.sc-menu [role="menuitem"] .sc-menu__label')].map((el) => el.textContent),
  dialogTitles: [...document.querySelectorAll('[role="dialog"]')].map((el) => el.textContent?.slice(0, 60) ?? null),
  activeElement: {
    tag: document.activeElement?.tagName ?? null,
    role: document.activeElement?.getAttribute?.('role') ?? null,
    cls: document.activeElement?.getAttribute?.('class') ?? null,
  },
  emptyState: document.querySelector('.dbpage .sc-empty, .dbpage [class*="empty"]')?.textContent ?? null,
});
const gridState = (page) => page.evaluate(GRID_STATE);

const LOCALE_STATE = () => {
  const txt = document.body.innerText;
  return {
    navLang: navigator.language,
    pref: (() => {
      try {
        return localStorage.getItem('septcats.localePref');
      } catch {
        return 'n/a';
      }
    })(),
    zh: {
      设置: txt.includes('设置'),
      外观: txt.includes('外观'),
      收藏: txt.includes('收藏'),
      跟随系统: txt.includes('跟随系统'),
    },
    en: {
      Settings: txt.includes('Settings'),
      Appearance: txt.includes('Appearance'),
      Favorites: txt.includes('Favorites'),
      System: txt.includes('System'),
    },
    sideText: (document.querySelector('.app-side')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 160),
  };
};

// ---------------------------------------------------------------------------
// 桥封装
// ---------------------------------------------------------------------------
async function wsIdOf(page) {
  return page.evaluate(async () => (await window.septcats.workspaces.list()).activeId);
}
async function treeOf(page) {
  return page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    return window.septcats.pages.tree({ workspaceId: ws.activeId });
  });
}
async function nodeByTitle(page, title) {
  const tree = await treeOf(page);
  const hit = tree.filter((n) => String(n.title) === title);
  return {
    matches: hit.map((n) => ({ id: n.id, title: n.title, alive: n.alive, pageType: n.pageType, parentId: n.parentId, deletedAt: n.deletedAt })),
    allNodes: tree.map((n) => `${n.title}(alive=${String(n.alive)},type=${String(n.pageType)})`),
  };
}
async function dbInfo(page, pageId) {
  return page.evaluate(async (pid) => {
    const r = await window.septcats.db.load({ pageId: pid });
    return {
      title_pid: r.collection.schema.title_pid,
      order: Object.keys(r.collection.schema.properties),
      properties: Object.entries(r.collection.schema.properties).map(([id, p]) => ({
        id,
        name: p.name,
        type: p.type,
        options: (p.options ?? []).map((o) => o.name),
      })),
      records: r.records.map((rec) => ({ id: rec.id, values: rec.values })),
    };
  }, pageId);
}
async function backlinksOf(page, pageId) {
  return page.evaluate(async (pid) => {
    const r = await window.septcats.links.backlinks({ pageId: pid });
    return {
      n: r.entries.length,
      entries: r.entries.map((e) => ({
        sourcePageId: e.sourcePageId,
        sourceTitle: e.sourceTitle,
        context: e.context,
      })),
    };
  }, pageId);
}

// ---------------------------------------------------------------------------
// UI 操作
// ---------------------------------------------------------------------------
async function rowTestId(page, title) {
  return page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
    const row = rows.find((el) => (el.textContent ?? '').includes(t));
    return row === null || row === undefined ? null : row.getAttribute('data-testid');
  }, title);
}
const moreOf = (rowId) =>
  String(rowId).replace('side-wiki-node-', 'side-more-').replace('side-node-', 'side-more-');

async function openRow(page, title) {
  const rowId = await rowTestId(page, title);
  if (rowId === null) return { ok: false, rowId: null };
  await page.locator(`[data-testid="${rowId}"]`).first().click({ force: true }).catch(() => {});
  await wait(1400);
  return { ok: true, rowId };
}

/** 精确按页 id 定位侧栏行（同名页并存时必须用 id，不能按标题找第一个）。 */
async function rowTestIdExact(page, id) {
  return page.evaluate((pid) => {
    const el =
      document.querySelector(`[data-testid="side-node-${pid}"]`) ??
      document.querySelector(`[data-testid="side-wiki-node-${pid}"]`);
    return el === null || el === undefined ? null : el.getAttribute('data-testid');
  }, id);
}
async function clickRowById(page, id, settleMs = 1800) {
  const rowId = await rowTestIdExact(page, id);
  if (rowId === null) return { clicked: false, rowId: null };
  await page.locator(`[data-testid="${rowId}"]`).first().click({ force: true }).catch(() => {});
  await wait(settleMs);
  return { clicked: true, rowId };
}
/** 当前选中页渲染成什么（用于证明「确实选中的是 DB 页」）。 */
const SELECTED_KIND = () => ({
  dbpage: document.querySelector('.dbpage') !== null,
  pvRoot: document.querySelector('.pv-root') !== null,
  pvBody: document.querySelector('.pv-body') !== null,
  hasEditor: document.querySelector('.ProseMirror') !== null,
  wikiLanding: document.querySelector('[data-testid="wiki-title"]') !== null,
});
const selectedKind = (page) => page.evaluate(SELECTED_KIND);

/** 按标题 + 类型取节点 id（同名节点并存时消歧）。 */
async function nodeIdByTitle(page, title, type) {
  const tree = await treeOf(page);
  const hit = tree.filter((n) => String(n.title) === title && (type === undefined || n.pageType === type));
  return hit.length > 0 ? hit[0].id : null;
}

async function openMenu(page, rowId) {
  await page.locator(`[data-testid="${rowId}"]`).first().hover().catch(() => {});
  await wait(450);
  await page.locator(`[data-testid="${moreOf(rowId)}"]`).first().click({ force: true }).catch(() => {});
  await wait(900);
  return page.evaluate(() => {
    const menus = [...document.querySelectorAll('.sc-menu')];
    const menu = menus[menus.length - 1];
    if (menu === null || menu === undefined) return null;
    return [...menu.querySelectorAll('[role="menuitem"] .sc-menu__label')].map((el) => el.textContent);
  });
}
async function clickMenuItem(page, text) {
  const item = page.locator('[role="menuitem"]', { hasText: text }).first();
  if ((await item.count()) === 0) return false;
  await item.click({ force: true }).catch(() => {});
  await wait(1300);
  return true;
}
async function closeMenu(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);
}

async function newPage(page, title) {
  await page.getByTestId('side-new-page').click();
  const input = page.locator('.app-side input').first();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.fill(title);
  await input.press('Enter');
  await wait(1600);
}

async function paletteOptions(page) {
  await page.keyboard.press('Control+k').catch(() => {});
  await wait(1000);
  const opts = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="palette-panel"]');
    if (panel === null) return null;
    return [...panel.querySelectorAll('[role="option"]')].map((el) => (el.textContent ?? '').trim());
  });
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);
  return opts;
}
async function paletteSearch(page, query) {
  await page.keyboard.press('Control+k').catch(() => {});
  await wait(900);
  const input = page.locator('[data-testid="palette-panel"] input').first();
  if ((await input.count()) > 0) {
    await input.fill(query);
    await wait(900);
  }
  const opts = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="palette-panel"]');
    if (panel === null) return null;
    return [...panel.querySelectorAll('[role="option"]')].map((el) => (el.textContent ?? '').trim());
  });
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);
  return opts;
}

async function openSettings(page) {
  const btn = page.getByRole('button', { name: /设置|Settings/ }).last();
  if ((await btn.count()) === 0) return false;
  await btn.click({ force: true }).catch(() => {});
  const ok = await waitFor(
    async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null),
    10000,
  );
  await wait(800);
  return ok === true;
}
async function clickRadio(page, label) {
  const option = page.locator('.sc-radio__label', { hasText: label }).first();
  if ((await option.count()) === 0) return false;
  await option.click({ force: true }).catch(() => {});
  await wait(1500);
  return true;
}

async function setPageWidthStorage(page, wsId, fullIds) {
  await page.evaluate(
    (args) => {
      localStorage.setItem(`septcats.pagewidth.${String(args.ws)}`, JSON.stringify({ v: 1, full: args.full }));
    },
    { ws: wsId, full: fullIds },
  );
}
async function reloadAndSettle(page) {
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitFor(
    async () =>
      page.evaluate(
        () =>
          document.querySelector('.app-side') !== null &&
          typeof window.septcats?.pages?.tree === 'function',
      ),
    30000,
  );
  await wait(2500);
}

// ===========================================================================
// 夹具（隔离）：settings 只写自建 user-data-dir；rootPath 指自建目录
// ===========================================================================
const realRootMtimeBefore = (() => {
  try {
    return String(statSync(REAL_ROOT).mtimeMs);
  } catch {
    return 'absent';
  }
})();

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
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\nSHOTS=${SHOTS}\nELECTRON=${ELECTRON}\n`);
const bundleMtime = (() => {
  try {
    return String(statSync(join(APPDIR, 'out', 'main', 'index.js')).mtime);
  } catch {
    return 'absent';
  }
})();
info('被复核的已打包产物 out/main/index.js mtime（不重打包，直接跑现成产物）', bundleMtime);

const phases = {};
let boot = null;
let quitInfo = [];

try {
  // =========================================================================
  // BOOT 1
  // =========================================================================
  boot = await launch('boot1');
  const page = boot.page;
  const wsId = await wsIdOf(page);
  info('夹具工作区 id', String(wsId));
  phases.boot1Tree = await treeOf(page).then((t) => t.map((n) => `${n.title}(alive=${String(n.alive)},type=${String(n.pageType)})`));

  // -------------------------------------------------------------------------
  // P1 · T41-01-1 对照：普通页 ⋯ 菜单含全宽项 + 切换像素
  // -------------------------------------------------------------------------
  TAG = T41;
  STEP = 'p1|普通页全宽';
  await newPage(page, '复核普通页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(400);
  await page.keyboard.type('复核普通页正文', { delay: 20 });
  await wait(900);
  const normalRowId = await rowTestId(page, '复核普通页');
  const normalMenu = await openMenu(page, normalRowId);
  info('普通页 ⋯ 菜单项（原始）', JSON.stringify(normalMenu));
  await closeMenu(page);
  check(
    'N1 普通页 ⋯ 菜单仍含全宽项（隐藏未误伤普通页）',
    normalMenu !== null && normalMenu.some((x) => String(x).includes('全宽') || String(x).includes('固定宽度')),
    JSON.stringify(normalMenu),
  );

  const normalFixed = await widthState(page);
  await openMenu(page, normalRowId);
  const clickedFull = await clickMenuItem(page, '固定宽度');
  await wait(1200);
  const normalFull = await widthState(page);
  info('普通页宽度 before/after（原始 px）', JSON.stringify({ before: normalFixed, after: normalFull, clicked: clickedFull }));
  check(
    'N2 普通页切全宽真生效（.pv-body 像素变宽，measure=full）',
    normalFull.pvRootMeasure === 'full' &&
      normalFixed.pvBodyClientW !== null &&
      normalFull.pvBodyClientW !== null &&
      normalFull.pvBodyClientW > normalFixed.pvBodyClientW,
    `before=${JSON.stringify({ measure: normalFixed.pvRootMeasure, bodyClientW: normalFixed.pvBodyClientW, bodyBox: normalFixed.pvBody })} after=${JSON.stringify({ measure: normalFull.pvRootMeasure, bodyClientW: normalFull.pvBodyClientW, bodyBox: normalFull.pvBody })} delta=${String((normalFull.pvBodyClientW ?? 0) - (normalFixed.pvBodyClientW ?? 0))}`,
  );
  // 还原为固定宽度（回到默认态）
  const normalRowId2 = await rowTestId(page, '复核普通页');
  await openMenu(page, normalRowId2);
  await clickMenuItem(page, '全宽');
  await wait(1000);
  info('普通页还原固定宽度后', JSON.stringify(await widthState(page)));

  // -------------------------------------------------------------------------
  // P2 · T41-01-1 主体：DB 页（真机 UI 转为多维数据）
  // -------------------------------------------------------------------------
  TAG = T41;
  STEP = 'p2|转 DB 页';
  await openRow(page, '复核普通页');
  await newPage(page, '复核数据页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(400);
  await page.keyboard.type('待转为多维数据的页', { delay: 20 });
  await wait(800);
  const convertBtn = page.getByRole('button', { name: '转为多维数据' }).first();
  const hasConvert = (await convertBtn.count()) > 0;
  if (hasConvert) await convertBtn.click({ force: true }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('.dbpage') !== null), 15000);
  await wait(1500);
  const dbNode = await nodeByTitle(page, '复核数据页');
  info('「转为多维数据」按钮存在并点击', `hasConvert=${String(hasConvert)}`);
  info('转换后页面树（原始）', JSON.stringify(dbNode.matches));
  // ★ 真机转换会**新建**一个 database 节点（pg-…），原 page 节点同名保留 →
  //   同名两行并存，必须按 id 精确选中 DB 行，否则量到的是普通页（探针首轮踩坑，已修正）
  const dbPageId = dbNode.matches.find((m) => m.pageType === 'database')?.id ?? null;
  const plainPageId = await nodeIdByTitle(page, '复核普通页');
  const dbRowId = await rowTestIdExact(page, dbPageId);
  info('DB 页节点 id / 侧栏行 testid', `dbPageId=${String(dbPageId)} rowId=${String(dbRowId)} plainPageId=${String(plainPageId)}`);
  const dbSelectedState = await clickRowById(page, dbPageId);
  const dbKind = await selectedKind(page);
  info('点击 DB 页行后选中页渲染（原始）', JSON.stringify({ clicked: dbSelectedState, kind: dbKind }));
  check(
    'D0 真机 UI 转换产出 DB 页，且**确实选中 DB 行**后渲染 .dbpage（同名双节点按 id 消歧）',
    dbPageId !== null && dbSelectedState.clicked === true && dbKind.dbpage === true,
    `dbPageId=${String(dbPageId)} rowId=${String(dbRowId)} kind=${JSON.stringify(dbKind)} tree=${JSON.stringify(dbNode.matches)}`,
  );

  const dbMenu = await openMenu(page, dbRowId);
  info('DB 页 ⋯ 菜单项（原始）', JSON.stringify(dbMenu));
  await closeMenu(page);
  check(
    'D1 DB 页 ⋯ 菜单不含全宽项（隐藏方案生效）',
    dbMenu !== null && !dbMenu.some((x) => String(x).includes('全宽') || String(x).includes('固定宽度')),
    JSON.stringify(dbMenu),
  );
  check(
    'D2 DB 页 ⋯ 菜单仍含删除项（未误删其它项）',
    dbMenu !== null && dbMenu.some((x) => String(x).includes('删除')),
    JSON.stringify(dbMenu),
  );

  // 命令面板：先真正点击选中 DB 页（按 id，避免同名行误选）
  STEP = 'p2|命令面板';
  await clickRowById(page, dbPageId);
  const dbSelected = await selectedKind(page);
  const dbPalette = await paletteOptions(page);
  const dbPaletteSearch = await paletteSearch(page, 'full');
  info('选中 DB 页（按 id 点击，选中页渲染原始）', JSON.stringify(dbSelected));
  info('命令面板（选中 DB 页）全部选项（原始）', JSON.stringify(dbPalette));
  info('命令面板搜 full（选中 DB 页，原始）', JSON.stringify(dbPaletteSearch));
  check(
    'P1 命令面板在 DB 页不含全宽命令（含搜 full 别名也不含）；且选中页确为 DbPage',
    dbSelected.dbpage === true &&
      dbPalette !== null &&
      !dbPalette.some((x) => x.includes('全宽')) &&
      (dbPaletteSearch === null || !dbPaletteSearch.some((x) => x.includes('全宽'))),
    `selected=${JSON.stringify(dbSelected)} panel=${JSON.stringify(dbPalette)} searchFull=${JSON.stringify(dbPaletteSearch)}`,
  );

  await clickRowById(page, plainPageId, 1600);
  const normalSelected = await selectedKind(page);
  const normalPalette = await paletteOptions(page);
  const normalPaletteSearch = await paletteSearch(page, 'full');
  info('选中普通页（按 id 点击，原始）', JSON.stringify(normalSelected));
  info('命令面板（选中普通页）全部选项（原始）', JSON.stringify(normalPalette));
  info('命令面板搜 full（选中普通页，原始）', JSON.stringify(normalPaletteSearch));
  check(
    'P2 命令面板在普通页含全宽命令（门控有对照）',
    normalSelected.dbpage === false &&
      normalSelected.pvBody === true &&
      ((normalPalette !== null && normalPalette.some((x) => x.includes('全宽'))) ||
        (normalPaletteSearch !== null && normalPaletteSearch.some((x) => x.includes('全宽')))),
    `selected=${JSON.stringify(normalSelected)} panel=${JSON.stringify(normalPalette)} searchFull=${JSON.stringify(normalPaletteSearch)}`,
  );

  // ★ 前提独立验证：DB 视图是否真的对 pageWidth 无反应？（用产品自身持久化通道注入）
  STEP = 'p2|DB 全宽前提验证';
  const px = {};
  // (a) 固定宽度态
  await setPageWidthStorage(page, wsId, []);
  await reloadAndSettle(page);
  await clickRowById(page, dbPageId);
  px.dbFixed = await widthState(page);
  px.dbFixedKind = await selectedKind(page);
  await clickRowById(page, plainPageId, 1600);
  px.normalFixed = await widthState(page);
  px.normalFixedKind = await selectedKind(page);
  // (b) 全宽态（把 DB 页与普通页都写进 full 集合）
  await setPageWidthStorage(page, wsId, [dbPageId, plainPageId].filter((x) => x !== null && x !== ''));
  await reloadAndSettle(page);
  await clickRowById(page, dbPageId);
  px.dbFull = await widthState(page);
  px.dbFullKind = await selectedKind(page);
  await clickRowById(page, plainPageId, 1600);
  px.normalFull = await widthState(page);
  px.normalFullKind = await selectedKind(page);
  await setPageWidthStorage(page, wsId, []);
  await reloadAndSettle(page);
  info('像素原始矩阵（DB 固定 / DB 全宽 / 普通页固定 / 普通页全宽）', JSON.stringify(px));
  const dbDelta = (px.dbFull.dbpageClientW ?? 0) - (px.dbFixed.dbpageClientW ?? 0);
  const dbGridDelta = (px.dbFull.dbgridClientW ?? 0) - (px.dbFixed.dbgridClientW ?? 0);
  const normalDelta = (px.normalFull.pvBodyClientW ?? 0) - (px.normalFixed.pvBodyClientW ?? 0);
  check(
    'X1 前提独立验证：DB 页在 pageWidth=全宽 下容器/网格像素差为 0（「DB 全宽无视觉效果」前提成立）',
    px.dbFixedKind.dbpage === true &&
      px.dbFullKind.dbpage === true &&
      px.dbFixed.dbpageClientW !== null &&
      px.dbFull.dbpageClientW !== null &&
      dbDelta === 0 &&
      dbGridDelta === 0,
    `dbFixed.dbpageClientW=${String(px.dbFixed.dbpageClientW)} dbFull.dbpageClientW=${String(px.dbFull.dbpageClientW)} delta=${String(dbDelta)} | dbFixed.dbgridClientW=${String(px.dbFixed.dbgridClientW)} dbFull.dbgridClientW=${String(px.dbFull.dbgridClientW)} gridDelta=${String(dbGridDelta)} | DB 页 pv-root 存在？fixed=${String(px.dbFixed.pvRootPresent)} full=${String(px.dbFull.pvRootPresent)}；DB 页 pv-body 宽度 fixed=${String(px.dbFixed.pvBody?.w ?? null)} full=${String(px.dbFull.pvBody?.w ?? null)}；chain=${JSON.stringify(px.dbFull.measureChain)}`,
  );
  check(
    'X2 对照：同一注入下普通页正文列真变宽（注入通道有效，非探针失灵）',
    px.normalFixedKind.pvBody === true && px.normalFullKind.pvBody === true && normalDelta > 0,
    `normalFixed.pvBodyClientW=${String(px.normalFixed.pvBodyClientW)} normalFull.pvBodyClientW=${String(px.normalFull.pvBodyClientW)} delta=${String(normalDelta)} measure=${String(px.normalFull.pvRootMeasure)}`,
  );
  info(
    '结论数值（T41-01-1）',
    `DB 页「全宽」下 .dbpage clientWidth = ${String(px.dbFixed.dbpageClientW)} → ${String(px.dbFull.dbpageClientW)}（差 ${String(dbDelta)}px，未变宽）；.dbpage 无 data-measure 祖先、无 .pv-body（.pv-body 宽度 ${String(px.dbFixed.pvBody?.w ?? null)}）；普通页同条件下 .pv-body ${String(px.normalFixed.pvBodyClientW)} → ${String(px.normalFull.pvBodyClientW)}（+${String(normalDelta)}px）`,
  );

  // -------------------------------------------------------------------------
  // P3 · T40-01-1 勾选列（真机 UI 建字段 → 点/键盘写值 → 读回）
  // -------------------------------------------------------------------------
  TAG = T40;
  STEP = 'p3|字段操作';
  const dbRowIdC = await clickRowById(page, dbPageId);
  const dbKindP3 = await selectedKind(page);
  info('T40 起点：选中 DB 页（原始）', JSON.stringify({ row: dbRowIdC, kind: dbKindP3 }));
  const grid0 = await gridState(page);
  info('DB 页初始网格（原始）', JSON.stringify(grid0));
  check('F0 T40 起点确为 DB 页（.dbpage 在位，避免量到同名普通页）', dbKindP3.dbpage === true, JSON.stringify(dbKindP3));

  // 先建记录：空态（status='empty'）只渲染 EmptyState、没有 PropBar，
  // 所以必须先建出记录让页面进入 ready，才谈得上「用 UI 加字段」
  const createBtn = page.getByRole('button', { name: '新建记录' }).first();
  let createdVia = 'none';
  if ((await createBtn.count()) > 0) {
    await createBtn.click({ force: true }).catch(() => {});
    createdVia = 'empty-state-button';
  } else {
    const createBtn2 = page.getByRole('button', { name: /新建记录|新建/ }).first();
    if ((await createBtn2.count()) > 0) {
      await createBtn2.click({ force: true }).catch(() => {});
      createdVia = 'fallback-button';
    }
  }
  await wait(2000);
  let dbState = await dbInfo(page, dbPageId);
  info('建记录后（原始）', JSON.stringify({ via: createdVia, records: dbState.records, grid: await gridState(page) }));
  check('F1 真机 UI 建出 1 条记录（空态按钮「新建记录」）', dbState.records.length >= 1, `via=${createdVia} records=${JSON.stringify(dbState.records)}`);

  // 建字段：新属性 → 勾选（真机 UI 菜单）
  const addBtn = page.getByRole('button', { name: '新属性' }).first();
  const hasAddBtn = (await addBtn.count()) > 0;
  if (hasAddBtn) await addBtn.click({ force: true }).catch(() => {});
  await wait(800);
  const propMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-menu [role="menuitem"] .sc-menu__label')].map((el) => el.textContent),
  );
  info('「新属性」菜单项（原始）', JSON.stringify(propMenu));
  const pickCheckbox = await clickMenuItem(page, '勾选');
  await wait(1600);
  dbState = await dbInfo(page, dbPageId);
  info('建勾选字段后 schema（原始）', JSON.stringify(dbState));
  const checkboxPid = dbState.properties.find((p) => p.type === 'checkbox')?.id ?? null;
  check(
    'F2 真机 UI 建「勾选」字段成功（菜单可点 + schema 出现 checkbox 列 + 网格表头出现）',
    hasAddBtn === true && pickCheckbox === true && checkboxPid !== null,
    `menu=${JSON.stringify(propMenu)} pid=${String(checkboxPid)} properties=${JSON.stringify(dbState.properties)} headers=${JSON.stringify((await gridState(page)).headers)}`,
  );

  // 建第二个字段（文本）用于排序 / 改类型 / 删除
  const addBtn2 = page.getByRole('button', { name: '新属性' }).first();
  if ((await addBtn2.count()) > 0) await addBtn2.click({ force: true }).catch(() => {});
  await wait(800);
  await clickMenuItem(page, '文本');
  await wait(1600);
  dbState = await dbInfo(page, dbPageId);
  const orderAfterAdd = dbState.order;
  const textPid = dbState.properties.find((p) => p.type === 'text' && p.id !== dbState.title_pid)?.id ?? null;
  info('建文本字段后 schema 顺序（原始）', JSON.stringify(orderAfterAdd));
  check(
    'F3 真机 UI 建「文本」字段成功（schema 属性序列增长）',
    textPid !== null && orderAfterAdd.length >= 3,
    `order=${JSON.stringify(orderAfterAdd)}`,
  );

  // （记录已在 T40 段开头经真机 UI 建出，见 F1）
  dbState = await dbInfo(page, dbPageId);
  info('建字段后当前记录（原始）', JSON.stringify(dbState.records));

  // ① 点击勾选格
  STEP = 'p3|点击勾选';
  const ckCell = page.locator('.sc-dbc[data-type="checkbox"]').first();
  if ((await ckCell.count()) > 0) await ckCell.click({ force: true }).catch(() => {});
  await wait(1800);
  const afterClickLoad = await dbInfo(page, dbPageId);
  const afterClickGrid = await gridState(page);
  info('点击勾选格后（原始）', JSON.stringify({ values: afterClickLoad.records.map((r) => r.values), on: afterClickGrid.checkboxOn, activeElement: afterClickGrid.activeElement }));
  check(
    'F4 点击勾选格：值真的写入并落库（.sc-dbc-check--on 出现 + db.load 读回 true）',
    afterClickLoad.records.length > 0 &&
      checkboxPid !== null &&
      afterClickLoad.records[0].values[checkboxPid] === true &&
      afterClickGrid.checkboxOn === 1,
    `checkboxPid=${String(checkboxPid)} values=${JSON.stringify(afterClickLoad.records.map((r) => r.values))} domOn=${String(afterClickGrid.checkboxOn)}`,
  );

  // ② 键盘 Enter（焦点在 gridcell）：true → null
  STEP = 'p3|键盘 Enter';
  const focusBeforeEnter = await gridState(page);
  await page.keyboard.press('Enter').catch(() => {});
  await wait(1800);
  const afterEnterLoad = await dbInfo(page, dbPageId);
  const afterEnterGrid = await gridState(page);
  info('Enter 后（原始）', JSON.stringify({ values: afterEnterLoad.records.map((r) => r.values), on: afterEnterGrid.checkboxOn, activeElement: afterEnterGrid.activeElement }));
  check(
    'F5 gridcell 上按 Enter：勾选值被切换并落库（true → 非 true）',
    afterEnterLoad.records.length > 0 &&
      checkboxPid !== null &&
      afterEnterLoad.records[0].values[checkboxPid] !== true,
    `before=${JSON.stringify({ activeElement: focusBeforeEnter.activeElement, on: focusBeforeEnter.checkboxOn })} after=${JSON.stringify(afterEnterLoad.records.map((r) => r.values))} domOn=${String(afterEnterGrid.checkboxOn)}`,
  );

  // ③ 键盘 Space：非 true → true
  STEP = 'p3|键盘 Space';
  await page.keyboard.press(' ').catch(() => {});
  await wait(1800);
  const afterSpaceLoad = await dbInfo(page, dbPageId);
  const afterSpaceGrid = await gridState(page);
  info('Space 后（原始）', JSON.stringify({ values: afterSpaceLoad.records.map((r) => r.values), on: afterSpaceGrid.checkboxOn }));
  check(
    'F6 gridcell 上按 Space：勾选值被切换回 true 并落库',
    afterSpaceLoad.records.length > 0 && checkboxPid !== null && afterSpaceLoad.records[0].values[checkboxPid] === true,
    `values=${JSON.stringify(afterSpaceLoad.records.map((r) => r.values))} domOn=${String(afterSpaceGrid.checkboxOn)}`,
  );

  // ④ 字段排序（左移）
  STEP = 'p3|字段排序';
  const orderBeforeMove = (await dbInfo(page, dbPageId)).order;
  const textChip = page.locator(`[aria-label="属性管理：文本"]`).first();
  const hasTextChip = (await textChip.count()) > 0;
  if (hasTextChip) await textChip.click({ force: true }).catch(() => {});
  await wait(800);
  const chipMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-menu [role="menuitem"] .sc-menu__label')].map((el) => el.textContent),
  );
  info('属性管理菜单（原始）', JSON.stringify(chipMenu));
  const moved = await clickMenuItem(page, '左移');
  await wait(1800);
  const orderAfterMove = (await dbInfo(page, dbPageId)).order;
  const headersAfterMove = (await gridState(page)).headerNames;
  info('排序前后属性序列（原始）', JSON.stringify({ before: orderBeforeMove, after: orderAfterMove, headers: headersAfterMove }));
  check(
    'F7 真机 UI 字段左移：schema 属性序列真的变了（顺序下标变化）',
    moved === true && JSON.stringify(orderBeforeMove) !== JSON.stringify(orderAfterMove),
    `before=${JSON.stringify(orderBeforeMove)} after=${JSON.stringify(orderAfterMove)} headers=${JSON.stringify(headersAfterMove)}`,
  );

  // ⑤ 改字段类型（文本 → 数字）
  STEP = 'p3|改字段类型';
  const textChip2 = page.locator(`[aria-label="属性管理：文本"]`).first();
  if ((await textChip2.count()) > 0) await textChip2.click({ force: true }).catch(() => {});
  await wait(800);
  await clickMenuItem(page, '更改类型');
  await wait(800);
  const typeMenu = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-menu [role="menuitem"] .sc-menu__label')].map((el) => el.textContent),
  );
  info('改类型菜单（原始）', JSON.stringify(typeMenu));
  const typePicked = await clickMenuItem(page, '数字');
  await wait(900);
  const dialogBefore = await gridState(page);
  info('改类型二次确认弹层（原始）', JSON.stringify(dialogBefore.dialogTitles));
  const confirmType = page.getByRole('button', { name: '确认更改' }).first();
  const hasTypeConfirm = (await confirmType.count()) > 0;
  if (hasTypeConfirm) await confirmType.click({ force: true }).catch(() => {});
  await wait(1900);
  const afterType = await dbInfo(page, dbPageId);
  const afterTypeProps = afterType.properties.find((p) => p.id === textPid);
  info('改类型后（原始）', JSON.stringify({ pid: textPid, property: afterTypeProps, headers: (await gridState(page)).headers }));
  check(
    'F8 真机 UI 改字段类型：文本 → 数字 生效（schema type + 表头 title 同步）',
    typePicked === true && hasTypeConfirm === true && afterTypeProps?.type === 'number',
    `menu=${JSON.stringify(typeMenu)} dialog=${JSON.stringify(dialogBefore.dialogTitles)} property=${JSON.stringify(afterTypeProps)}`,
  );

  // ⑥ 删除字段（数字列）
  STEP = 'p3|删除字段';
  const chipAria = afterTypeProps?.name ?? '文本';
  const delChip = page.locator(`[aria-label="属性管理：${chipAria}"]`).first();
  if ((await delChip.count()) > 0) await delChip.click({ force: true }).catch(() => {});
  await wait(800);
  const delPicked = await clickMenuItem(page, '删除属性');
  await wait(900);
  const delDialog = await gridState(page);
  info('删除字段二次确认弹层（原始）', JSON.stringify(delDialog.dialogTitles));
  const confirmDel = page.getByRole('button', { name: '删除' }).last();
  const hasDelConfirm = (await confirmDel.count()) > 0;
  if (hasDelConfirm) await confirmDel.click({ force: true }).catch(() => {});
  await wait(1900);
  const afterDel = await dbInfo(page, dbPageId);
  info('删除字段后（原始）', JSON.stringify({ order: afterDel.order, properties: afterDel.properties, headers: (await gridState(page)).headers }));
  check(
    'F9 真机 UI 删除字段：schema 属性消失（值同事务清理，勾选列不受影响）',
    delPicked === true && hasDelConfirm === true && !afterDel.properties.some((p) => p.id === textPid),
    `dialog=${JSON.stringify(delDialog.dialogTitles)} order=${JSON.stringify(afterDel.order)} properties=${JSON.stringify(afterDel.properties)}`,
  );
  check(
    'F10 删除另一字段后勾选列值仍为 true（无连带损坏）',
    checkboxPid !== null && afterDel.records[0]?.values?.[checkboxPid] === true,
    `values=${JSON.stringify(afterDel.records.map((r) => r.values))}`,
  );
  phases.t40 = { checkboxPid, textPid, clickValues: afterClickLoad.records.map((r) => r.values), enterValues: afterEnterLoad.records.map((r) => r.values), spaceValues: afterSpaceLoad.records.map((r) => r.values) };

  // -------------------------------------------------------------------------
  // P4 · T42-01-1 wiki 页 ⇄ 子页往返（console 错误计数）
  // -------------------------------------------------------------------------
  TAG = T42;
  STEP = 'p4|wiki 往返';
  const collabSpy = await page.evaluate(() => {
    try {
      const api = window.septcats;
      const orig = api.collab.attach;
      const holder = { calls: [], installed: false, error: null };
      api.collab.attach = async (input) => {
        holder.calls.push(input?.pageId ?? null);
        return orig(input);
      };
      holder.installed = api.collab.attach !== orig;
      window.__auditCollab = holder;
      return { installed: holder.installed, error: null };
    } catch (error) {
      return { installed: false, error: String(error?.message ?? error) };
    }
  });
  info('collab.attach 间谍是否安装成功（contextBridge 只读则失败，仅作辅助证据）', JSON.stringify(collabSpy));

  await newPage(page, '复核Wiki页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(400);
  await page.keyboard.type('wiki 页转前正文', { delay: 20 });
  await wait(900);
  const wikiRowIdBefore = await rowTestId(page, '复核Wiki页');
  const wikiMenu = await openMenu(page, wikiRowIdBefore);
  info('普通页 ⋯ 菜单（转 Wiki 前，原始）', JSON.stringify(wikiMenu));
  const toWiki = await clickMenuItem(page, '转为 Wiki');
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="wiki-title"]') !== null), 15000);
  await wait(1500);
  const landing = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="wiki-title"]')?.textContent ?? null,
    hasEditor: document.querySelector('.ProseMirror') !== null,
    indexRows: document.querySelectorAll('[data-testid="wiki-index-row"]').length,
    emptyIndex: document.querySelector('[data-testid="wiki-index-empty"]') !== null,
    subpageBtn: [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').includes('新建子页')),
  }));
  info('wiki 落地页初始态（原始）', JSON.stringify(landing));
  check(
    'W0 真机 UI 转 Wiki 成功：落地页渲染且**无编辑器**（.ProseMirror 不在 DOM）',
    toWiki === true && landing.title !== null && landing.hasEditor === false,
    `landing=${JSON.stringify(landing)}`,
  );

  // 往返 3 轮：落地页 → 新建子页 → 回落地页
  const errBefore = consoleErrors.length;
  const pageErrBefore = pageErrors.length;
  const roundTrips = [];
  for (let round = 1; round <= 3; round += 1) {
    STEP = `p4|wiki 往返 r${String(round)}`;
    const subBtn = page.getByRole('button', { name: '新建子页' }).first();
    const hasSub = (await subBtn.count()) > 0;
    if (hasSub) await subBtn.click({ force: true }).catch(() => {});
    await wait(1800);
    const renameInput = page.locator('[data-testid="side-rename-input"]').first();
    let childName = null;
    if ((await renameInput.count()) > 0) {
      childName = `复核子页${String(round)}`;
      await renameInput.fill(childName);
      await renameInput.press('Enter');
      await wait(1600);
    }
    const childState = await page.evaluate(() => ({
      hasEditor: document.querySelector('.ProseMirror') !== null,
      dbpage: document.querySelector('.dbpage') !== null,
      wikiLanding: document.querySelector('[data-testid="wiki-title"]') !== null,
      title: document.querySelector('.pv-page-title')?.textContent ?? null,
    }));
    await openRow(page, '复核Wiki页');
    await wait(1200);
    const backState = await page.evaluate(() => ({
      wikiLanding: document.querySelector('[data-testid="wiki-title"]') !== null,
      hasEditor: document.querySelector('.ProseMirror') !== null,
      indexRows: document.querySelectorAll('[data-testid="wiki-index-row"]').length,
      indexLabels: [...document.querySelectorAll('.wiki-index-label')].map((el) => el.textContent),
    }));
    roundTrips.push({ round, hasSub, childName, childState, backState });
    info(`往返 r${String(round)}（原始）`, JSON.stringify({ hasSub, childName, childState, backState }));
  }
  const errAfter = consoleErrors.slice(errBefore);
  const pageErrAfter = pageErrors.slice(pageErrBefore);
  info('wiki 往返期间 console error（原始全文）', JSON.stringify(errAfter));
  info('wiki 往返期间 pageerror（原始全文）', JSON.stringify(pageErrAfter));
  phases.t42 = { roundTrips, consoleErrors: errAfter, pageErrors: pageErrAfter, collabSpy };
  check(
    'W1 wiki 往返 3 轮：console error = 0 且 pageerror = 0（原缺陷签名 4 条错误不再出现）',
    errAfter.length === 0 && pageErrAfter.length === 0,
    `console=${String(errAfter.length)} ${JSON.stringify(errAfter)} pageerror=${String(pageErrAfter.length)} ${JSON.stringify(pageErrAfter)}`,
  );
  check(
    'W2 每轮返回 wiki 落地页仍无编辑器挂载、子页索引随建子页增长',
    roundTrips.every((r) => r.backState.wikiLanding === true && r.backState.hasEditor === false) &&
      roundTrips[roundTrips.length - 1].backState.indexRows >= 1,
    JSON.stringify(roundTrips.map((r) => ({ round: r.round, childName: r.childName, indexRows: r.backState.indexRows, labels: r.backState.indexLabels }))),
  );
  const collabCalls = await page.evaluate(() => (window.__auditCollab?.calls ?? null));
  info('collab.attach 调用序列（原始，装得上才有效）', JSON.stringify(collabCalls));

  // -------------------------------------------------------------------------
  // P5 · T44-01-1 双链 ⇄ 页面存活（真机删页）
  // -------------------------------------------------------------------------
  TAG = T44;
  STEP = 'p5|建链';
  await newPage(page, '复核源页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(400);
  await page.keyboard.type('源页正文第一行', { delay: 20 });
  await wait(700);
  await page.keyboard.press('End').catch(() => {});
  await page.keyboard.press('Enter');
  await wait(300);

  await newPage(page, '复核目标页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(400);
  await page.keyboard.type('目标页正文', { delay: 20 });
  await wait(1200);
  const targetNode = await nodeByTitle(page, '复核目标页');
  const targetId = targetNode.matches[0]?.id ?? null;
  info('目标页 id（原始）', `id=${String(targetId)} node=${JSON.stringify(targetNode.matches)}`);

  await openRow(page, '复核源页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await wait(500);
  await page.keyboard.press('Control+End').catch(() => {});
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(300);
  await page.keyboard.type('[[', { delay: 60 });
  const menuOpen = await waitFor(async () => page.evaluate(() => document.querySelector('.sc-slashmenu') !== null), 8000);
  await page.keyboard.type('复核目标', { delay: 60 });
  await wait(900);
  const candidates = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-slashmenu [role="option"] .sc-slashmenu__label')].map((el) => el.textContent),
  );
  info('[[ 补全候选（原始）', JSON.stringify(candidates));
  await page.keyboard.press('Enter');
  await wait(RECONCILE_SETTLE_MS);
  const beforeDelete = await wikilinkState(page);
  const preBacklinksDom = null;
  info('删除前 源页链接（原始）', JSON.stringify(beforeDelete));
  check(
    'L1 建链成功且**已解析**：数据只有 1 条 .sc-wikilink、0 条 unresolved，data-target = 目标页 id',
    menuOpen === true &&
      beforeDelete.total === 1 &&
      beforeDelete.unresolved === 0 &&
      beforeDelete.items[0]?.dataTarget === targetId,
    `menuOpen=${String(menuOpen)} state=${JSON.stringify(beforeDelete)}`,
  );

  // 打开目标页 → 反向链接面板
  STEP = 'p5|反向链接面板（删除前）';
  await openRow(page, '复核目标页');
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="backlinks-panel"]') !== null), 10000);
  await wait(1200);
  const blDomBefore = await page.evaluate(BACKLINKS_DOM);
  const blBridgeBefore = await backlinksOf(page, targetId);
  info('目标页反向链接面板（删除前，原始）', JSON.stringify(blDomBefore));
  info('links.backlinks(目标页)（删除前，原始）', JSON.stringify(blBridgeBefore));
  check(
    'L2 删除前：目标页反向链接面板条目数 ≥ 1，DB 索引 links.backlinks 计数 ≥ 1',
    blDomBefore.panel === true && blDomBefore.items >= 1 && blBridgeBefore.n >= 1,
    `dom=${JSON.stringify(blDomBefore)} bridge=${JSON.stringify(blBridgeBefore)}`,
  );

  // 真机删除目标页：侧栏 ⋯ → 删除 → 二次确认
  STEP = 'p5|真机删目标页';
  const targetRowId = await rowTestId(page, '复核目标页');
  const targetMenu = await openMenu(page, targetRowId);
  info('目标页 ⋯ 菜单（原始）', JSON.stringify(targetMenu));
  const delClicked = await clickMenuItem(page, '删除');
  await wait(900);
  const confirmBtn = page.locator('[data-testid="page-delete-confirm"]').first();
  const hasConfirm = (await confirmBtn.count()) > 0;
  if (hasConfirm) await confirmBtn.click({ force: true }).catch(() => {});
  await wait(2200);
  const afterDeleteTree = await nodeByTitle(page, '复核目标页');
  info('删除后页面树（原始）', JSON.stringify(afterDeleteTree.matches));
  check(
    'L3 真机路径删除目标页成功（菜单含删除 + 二次确认弹层 + 树内 alive=0）',
    delClicked === true && hasConfirm === true && afterDeleteTree.matches.some((m) => m.alive === 0),
    `menu=${JSON.stringify(targetMenu)} del=${String(delClicked)} confirm=${String(hasConfirm)} tree=${JSON.stringify(afterDeleteTree.matches)}`,
  );

  // 回源页看链接状态
  STEP = 'p5|删后源页链接';
  await openRow(page, '复核源页');
  await wait(RECONCILE_SETTLE_MS);
  const afterDelete = await wikilinkState(page);
  const blBridgeAfterDelete = await backlinksOf(page, targetId);
  const blDomAfterDelete = await page.evaluate(BACKLINKS_DOM);
  info('删除后 源页链接（原始）', JSON.stringify(afterDelete));
  info('links.backlinks(已删目标页 id)（删除后，原始）', JSON.stringify(blBridgeAfterDelete));
  check(
    'L4 删除目标页后：源页链接转**未解析态**（class 含 sc-wikilink--unresolved、data-target 消失、文本不变）',
    afterDelete.total === 1 &&
      afterDelete.unresolved === 1 &&
      String(afterDelete.items[0]?.cls ?? '').includes('sc-wikilink--unresolved') &&
      afterDelete.items[0]?.dataTarget === null &&
      beforeDelete.items[0]?.text === afterDelete.items[0]?.text,
    `before=${JSON.stringify(beforeDelete.items)} after=${JSON.stringify(afterDelete.items)}`,
  );
  phases.t44 = {
    targetId,
    beforeDelete,
    afterDelete,
    blDomBefore,
    blBridgeBefore,
    blBridgeAfterDelete,
    blDomAfterDelete,
  };

  // -------------------------------------------------------------------------
  // P6 · T43-01-1 真机路径：设置里显式选 English
  // -------------------------------------------------------------------------
  TAG = T43;
  STEP = 'p6|设置选 English';
  const localeBefore = await page.evaluate(LOCALE_STATE);
  info('选 English 前 locale 状态（原始）', JSON.stringify(localeBefore));
  const opened = await openSettings(page);
  const settingsLocaleState = await page.evaluate(LOCALE_STATE);
  info('设置页打开后 locale 状态（原始）', JSON.stringify({ opened, settingsLocaleState }));
  const radioLabels = await page.evaluate(() => [...document.querySelectorAll('.sc-radio__label')].map((el) => el.textContent));
  info('语言/主题 单选标签（原始）', JSON.stringify(radioLabels));
  const clickedEn = await clickRadio(page, 'English');
  await wait(1500);
  const afterClickEn = await page.evaluate(LOCALE_STATE);
  info('点击 English 后立刻（原始）', JSON.stringify(afterClickEn));
  const settingsFileAfterClick = (() => {
    try {
      const raw = readFileSync(`${UD}\\septcats.settings.json`, 'utf8');
      return { locale: JSON.parse(raw).locale, rootPath: JSON.parse(raw).rootPath };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('夹具 settings 文件 locale（点击后，原始）', JSON.stringify(settingsFileAfterClick));
  check(
    'E1 设置里点 English 立刻生效（界面转英文 + 标记写为 en-US）',
    clickedEn === true && afterClickEn.en.Settings === true && afterClickEn.zh.设置 === false && afterClickEn.pref === 'en-US',
    `clicked=${String(clickedEn)} state=${JSON.stringify(afterClickEn)} settingsFile=${JSON.stringify(settingsFileAfterClick)}`,
  );
  phases.t43 = { localeBefore, settingsLocaleState, radioLabels, afterClickEn, settingsFileAfterClick };
  boot.quit = await quit(page, boot.pid, boot.browser);
  quitInfo.push({ boot: 1, ...boot.quit });

  // =========================================================================
  // BOOT 2：重启后语言（T43 主线）+ 删页后 reload 复查（T44 B3b）+ 恢复分支 + 字段持久化（T40）
  // =========================================================================
  TAG = T43;
  STEP = 'boot2|重启语言';
  boot = await launch('boot2');
  const page2 = boot.page;
  const boot2Locale = await page2.evaluate(LOCALE_STATE);
  info('重启后 locale 状态（原始）', JSON.stringify(boot2Locale));
  const settingsFileOnBoot2 = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale, rootPath: raw.rootPath };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('重启时夹具 settings.locale（原始）', JSON.stringify(settingsFileOnBoot2));
  check(
    'E2【T43 主线复现】显式选 English 后重启：界面为英文（原缺陷：回中文）',
    boot2Locale.en.Settings === true && boot2Locale.zh.设置 === false && boot2Locale.pref === 'en-US',
    `boot2=${JSON.stringify(boot2Locale)} settingsFile=${JSON.stringify(settingsFileOnBoot2)}`,
  );
  phases.t43.boot2 = boot2Locale;

  // T44：删页后 reload 复查（链接必须仍为未解析）
  TAG = T44;
  STEP = 'boot2|删后 reload 复查';
  await openRow(page2, '复核源页');
  await wait(RECONCILE_SETTLE_MS);
  const afterReloadState = await wikilinkState(page2);
  info('（重启=reload）后源页链接（原始）', JSON.stringify(afterReloadState));
  check(
    'L5 删除目标页后重启（reload 语义）：链接仍为未解析态（非界面刷新问题）',
    afterReloadState.total === 1 && afterReloadState.unresolved === 1,
    JSON.stringify(afterReloadState),
  );

  // T44：回收站恢复 → 重新已解析（双向收敛）
  STEP = 'boot2|回收站恢复';
  await page2.getByTestId('side-trash').click().catch(() => {});
  await wait(1800);
  const trashRows = await page2.evaluate(() => [...document.querySelectorAll('[data-testid^="trash-row-"]')].map((el) => el.getAttribute('data-testid')));
  info('回收站行（原始）', JSON.stringify(trashRows));
  const restoreBtn = page2.locator(`[data-testid="trash-restore-${String(targetId)}"]`).first();
  const hasRestore = (await restoreBtn.count()) > 0;
  if (hasRestore) await restoreBtn.click({ force: true }).catch(() => {});
  await wait(2200);
  const afterRestoreTree = await nodeByTitle(page2, '复核目标页');
  await openRow(page2, '复核源页');
  await wait(RECONCILE_SETTLE_MS);
  const afterRestoreState = await wikilinkState(page2);
  const blBridgeAfterRestore = await backlinksOf(page2, targetId);
  info('恢复后 源页链接（原始）', JSON.stringify(afterRestoreState));
  info('恢复后 页面树（原始）', JSON.stringify(afterRestoreTree.matches));
  info('恢复后 links.backlinks(目标页)（原始）', JSON.stringify(blBridgeAfterRestore));
  check(
    'L6 回收站恢复目标页后：链接**重新已解析**且 data-target 回到原页 id（双向收敛，无单向 bug）',
    hasRestore === true &&
      afterRestoreState.unresolved === 0 &&
      afterRestoreState.items[0]?.dataTarget === targetId &&
      afterRestoreTree.matches.some((m) => m.alive === 1),
    `restore=${String(hasRestore)} state=${JSON.stringify(afterRestoreState)} tree=${JSON.stringify(afterRestoreTree.matches)} bridge=${JSON.stringify(blBridgeAfterRestore)}`,
  );
  phases.t44.afterRestore = { state: afterRestoreState, tree: afterRestoreTree.matches, bridge: blBridgeAfterRestore };

  // T44：再删一次 → 点未解析链接 → 新建同名页并回填新 id
  STEP = 'boot2|未解析链接点击路径';
  const targetRowId2 = await rowTestId(page2, '复核目标页');
  await openMenu(page2, targetRowId2);
  await clickMenuItem(page2, '删除');
  await wait(900);
  const confirmBtn2 = page2.locator('[data-testid="page-delete-confirm"]').first();
  if ((await confirmBtn2.count()) > 0) await confirmBtn2.click({ force: true }).catch(() => {});
  await wait(2200);
  await openRow(page2, '复核源页');
  await wait(RECONCILE_SETTLE_MS);
  const beforeClickUnresolved = await wikilinkState(page2);
  const unresolvedLink = page2.locator('.sc-wikilink--unresolved').first();
  const hasUnresolved = (await unresolvedLink.count()) > 0;
  if (hasUnresolved) await unresolvedLink.click({ force: true }).catch(() => {});
  await wait(2600);
  const afterClickCreated = await wikilinkState(page2);
  const newTree = await nodeByTitle(page2, '复核目标页');
  const currentTitle = await page2.evaluate(() => document.querySelector('.pv-page-title')?.textContent ?? null);
  info('点未解析链接前（原始）', JSON.stringify(beforeClickUnresolved));
  info('点未解析链接后（原始）', JSON.stringify({ state: afterClickCreated, title: currentTitle, tree: newTree.matches }));
  const newId = newTree.matches.find((m) => m.alive === 1)?.id ?? null;
  check(
    'L7 点未解析链接 → 新建同名页并跳转、链接回填**新页 id**（claim#3 新建路径 + 非死页跳转）',
    hasUnresolved === true &&
      String(currentTitle ?? '').includes('复核目标页') &&
      newId !== null &&
      newId !== targetId &&
      afterClickCreated.unresolved === 0 &&
      afterClickCreated.items[0]?.dataTarget === newId,
    `preClick=${JSON.stringify(beforeClickUnresolved)} postClick=${JSON.stringify(afterClickCreated)} title=${String(currentTitle)} newId=${String(newId)} oldId=${String(targetId)} tree=${JSON.stringify(newTree.matches)}`,
  );

  // T40：重启后读回勾选值（持久化）
  TAG = T40;
  STEP = 'boot2|勾选值重开读回';
  const dbRowIdD = await clickRowById(page2, dbPageId, 2000);
  const dbKindB2 = await selectedKind(page2);
  if (dbRowIdD.clicked === true && dbKindB2.dbpage === true) {
    const gridReload = await gridState(page2);
    const dbReload = await dbInfo(page2, dbPageId);
    info('重启后 DB 页（原始）', JSON.stringify({ grid: { gridRows: gridReload.gridRows, headers: gridReload.headers, checkboxOn: gridReload.checkboxOn }, properties: dbReload.properties, records: dbReload.records }));
    check(
      'F11 重启（重开）后勾选值读回仍为 true（落库非仅内存）',
      checkboxPid !== null &&
        dbReload.records.length > 0 &&
        dbReload.records[0].values[checkboxPid] === true &&
        gridReload.checkboxOn === 1,
      `checkboxPid=${String(checkboxPid)} values=${JSON.stringify(dbReload.records.map((r) => r.values))} domOn=${String(gridReload.checkboxOn)} headers=${JSON.stringify(gridReload.headers)}`,
    );
    phases.t40.reload = { properties: dbReload.properties, records: dbReload.records, domOn: gridReload.checkboxOn };
  } else {
    check('F11 重启（重开）后勾选值读回仍为 true（落库非仅内存）', false, 'DB 行未找到 → 无法读回（CANNOT-VERIFY）');
  }

  // T43：切「跟随系统」再重启
  TAG = T43;
  STEP = 'boot2|切跟随系统';
  const opened2 = await openSettings(page2);
  const clickedSystem = await clickRadio(page2, 'System');
  await wait(1500);
  const afterSystem = await page2.evaluate(LOCALE_STATE);
  const settingsFileAfterSystem = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('点 System 后（原始）', JSON.stringify({ opened: opened2, clickedSystem, afterSystem, settingsFileAfterSystem }));
  phases.t43.afterSystem = { clickedSystem, afterSystem, settingsFileAfterSystem };
  boot.quit = await quit(page2, boot.pid, boot.browser);
  quitInfo.push({ boot: 2, ...boot.quit });

  // =========================================================================
  // BOOT 3：跟随系统路径的启动落点（raw）
  // =========================================================================
  TAG = T43;
  STEP = 'boot3|跟随系统启动落点';
  boot = await launch('boot3');
  const page3 = boot.page;
  const boot3Locale = await page3.evaluate(LOCALE_STATE);
  const expected = String(boot3Locale.navLang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  const actual = boot3Locale.en.Settings === true ? 'en-US' : boot3Locale.zh.设置 === true ? 'zh-CN' : 'unknown';
  info('重启（跟随系统）后 locale（原始）', JSON.stringify(boot3Locale));
  check(
    'E3 标记为显式 system 时重启按系统语言落点（与 navigator.language 一致）',
    actual === expected && boot3Locale.pref === 'system',
    `navLang=${String(boot3Locale.navLang)} expected=${expected} actual=${actual} pref=${String(boot3Locale.pref)} state=${JSON.stringify(boot3Locale)}`,
  );
  phases.t43.boot3 = boot3Locale;
  boot.quit = await quit(page3, boot.pid, boot.browser);
  quitInfo.push({ boot: 3, ...boot.quit });
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
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
    task: 'audit-fixbatches：5 条未经 PM 复核的修复提交 · 独立真机复核（第三方复核方，非 PM 自跑）',
    ranAt: new Date().toISOString(),
    commitUnderAudit: ['3e5e6c7', '4d25613', '17946d5'],
    appdir: APPDIR,
    appBundleMtime: bundleMtime,
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: {
      realRoot: REAL_ROOT,
      realRootMtimeBefore,
      realRootMtimeAfter,
      untouched: realRootMtimeBefore === realRootMtimeAfter,
    },
    pass: passes,
    fail: fails,
    quiet: quitInfo,
    phases,
    assertions: results,
    consoleErrors,
    pageErrors,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n========== 汇总：${String(passes)} PASS / ${String(fails)} FAIL ==========`);
  console.log(`console 错误 ${String(consoleErrors.length)} / pageerror ${String(pageErrors.length)}`);
  for (const e of consoleErrors.slice(0, 12)) console.log(`  console: ${e.slice(0, 180)}`);
  for (const e of pageErrors.slice(0, 12)) console.log(`  pageerror: ${e.slice(0, 180)}`);
  for (const r of results.filter((x) => x.ok === false)) console.log(`  ✗ [${r.commit}] ${r.name} — ${r.raw.slice(0, 260)}`);
  console.log(`\nresults → ${OUT_JSON}`);
}
process.exit(0);