/* cdp-e2e-t60-01.mjs —— TASK-T60-01 真机取证（交互一致性批：R13 ①②③⑤⑥⑦）
 *
 * 范围（对应任务书 §2 探针清单 + §1 验收锚）：
 *   G0 夹具自检：隔离夹具真点「新建页面」×2 → 2 标签 / 2 存活页；真键入两段正文（块簇/拖拽用）；
 *   G1 §0-1 块柄簇：hover 块 → DOM 序【⋮⋮】【+】+ 几何序（⋮⋮ 左 / ＋ 右）+
 *      draggable 只落 ⋮⋮ 键（壳不再 draggable、＋ 不可拖）+ ⋮⋮ 光标 = grab（computed）；
 *   G2 §0-1 **真拖拽**：从 ⋮⋮ 键发起 dragstart（原生/CDP 或 DataTransfer 合成，原始路径进报告）
 *      → 落位后块序翻转（DOM 序 + blocks:list 落库序双向实证）；
 *   G3 §0-3 块菜单：点 ⋮⋮ 菜单开（aria-expanded=true）→ 点正文空白 → 菜单关（before/after）；
 *   G4 §0-2/§0-4 侧栏：新建页行图标 = FileText（像素签名，非 FolderSimple）；⋯ 菜单含「重命名」；
 *      右键行 → 菜单弹在光标处（rect 实测 |Δ| ≤ 12px）→ 点「重命名」→ 行内输入框 → 改名落库
 *      （行标题 + pages.tree 标题双向断言）；
 *   G5 §0-5 通知：转换触发 toast → 轮询实测消失耗时 ∈ [2.6s, 4.0s]（口径 3000ms）；
 *   G6 §3 双主题截图 ≥4 张（浅/深 × 主界面 / 右键菜单 / 块菜单）；
 *   G7 §3 1184/894 两宽度零滚动（纵向 + 横向）+ 侧栏 top 恒 0；
 *   G8 隔离自检：真档案 `C:\Users\Administrator\.septcats` mtime 前后一致（untouched）；
 *   G9 退出干净 + electron 进程计数 = 0。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t60-01/ 下，绝不读写 PM 真实数据根；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口；不改产品代码、不写产品数据。
 *
 * 运行：node docs/mockups/cdp-e2e-t60-01.mjs
 * 产物：docs/mockups/screens-t60/t60-01-results.json + ≥4 张 png
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t60-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9482;
const INSPECT = 9242;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t60');
const OUT_JSON = join(SHOTS, 't60-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const WIDTHS = [1184, 894];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T60-01 真机取证（交互一致性批 R13 ①②③⑤⑥⑦）',
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
const tabCount = () => page.evaluate(() => document.querySelectorAll('.tabsbar-tab').length);

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
const TRIM = (v) => v.replace(/\s+/g, ' ').trim();

/** 块柄簇：DOM 序 / draggable 归属 / 光标 / 几何序（全部真机实测）。 */
const CLUSTER_MEASURE = () =>
  page.evaluate(() => {
    const cluster = document.querySelector('.sc-blockcontrol');
    if (cluster === null) return null;
    const children = [...cluster.children];
    const handle = cluster.querySelector('.sc-blockcontrol__handle');
    const add = cluster.querySelector('.sc-blockcontrol__add');
    const shell = cluster.closest('.pv-handle');
    const r = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: +b.left.toFixed(1), right: +b.right.toFixed(1), top: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    return {
      order: children.map((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';
        if (cls.includes('sc-blockcontrol__handle')) return 'handle';
        if (cls.includes('sc-blockcontrol__add')) return 'add';
        if (cls.includes('sc-blockcontrol__menu')) return 'menu';
        return cls;
      }),
      handleDraggable: handle === null ? null : handle.getAttribute('draggable'),
      addDraggable: add === null ? null : add.getAttribute('draggable'),
      shellDraggable: shell === null ? null : shell.getAttribute('draggable'),
      handleCursor: handle === null ? null : getComputedStyle(handle).cursor,
      addCursor: add === null ? null : getComputedStyle(add).cursor,
      handleRect: r(handle),
      addRect: r(add),
      clusterRect: r(cluster),
      blockId: cluster.getAttribute('data-block-id'),
      ariaLabels: [...cluster.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
      disabled: [...cluster.querySelectorAll('button')].map((b) => b.disabled),
    };
  });

/** 正文块序（data-id 序）。 */
const BLOCK_ORDER = () =>
  page.evaluate(() => [...document.querySelectorAll('.pv-body [data-id]')].map((el) => el.getAttribute('data-id')));

const BLOCK_DB_ORDER = (pageId) =>
  page.evaluate(
    (id) =>
      window.septcats.blocks
        .list({ pageId: id })
        .then((r) => (r.blocks ?? r).filter((b) => b.alive === 1).map((b) => b.id))
        .catch((e) => `ERR:${String(e).slice(0, 120)}`),
    pageId,
  );

/** 侧栏行图标像素签名（T58 资产表契约：FileText 首格 x3/w10，FolderSimple 首格 x1/w8）。 */
const ROW_ICON_SIG = (testIdPrefix) =>
  page.evaluate((prefix) => {
    const row = document.querySelector(`[data-testid^="${prefix}"]`);
    if (row === null) return null;
    const icon = row.querySelector('svg.app-nav-ic');
    if (icon === null) return null;
    const rects = [...icon.querySelectorAll('rect')].slice(0, 3).map((r) => ({
      x: r.getAttribute('x'),
      y: r.getAttribute('y'),
      w: r.getAttribute('width'),
    }));
    return { first: rects[0] ?? null, n: icon.querySelectorAll('rect').length };
  }, testIdPrefix);

const MENU_STATE = () =>
  page.evaluate(() => {
    const menu = document.querySelector('#root [role="menu"], [role="menu"]');
    if (menu === null) return null;
    const r = menu.getBoundingClientRect();
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent ?? '').trim());
    return {
      items,
      rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      hostPosition: menu.parentElement === null ? null : getComputedStyle(menu.parentElement).position,
    };
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
  const editorBody = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
  await editorBody.click({ force: true }).catch(() => {});
  await page.keyboard.type('T60 交互一致性第一段').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.keyboard.type('T60 交互一致性第二段').catch(() => {});
  await wait(1600);
  const tabs0 = await tabCount();
  const pages0 = await pageCount();
  check(
    'G0-1 夹具成立：真点「新建页面」×2 + 键入两段正文 → 2 标签 / 2 存活页',
    tabs0 === 2 && pages0 === 2,
    `tabs=${String(tabs0)} pages=${String(pages0)}`,
  );
  const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('G0-2 浅色主题就位（夹具 settings.theme=light）', theme0 === 'light', `data-theme=${String(theme0)}`);
  const activePageId = await page.evaluate(() => {
    const tab = document.querySelector('.tabsbar-tab--active');
    const testId = tab === null ? null : tab.getAttribute('data-testid');
    return testId !== null && testId.startsWith('tab-') ? testId.slice(4) : null;
  });
  info('活动页 id（tab-<id> 派生）', String(activePageId));

  /** 找「有 ≥2 存活块」的页并点开（换主题/换宽度后复跑用；避免点到空页）。 */
  const activatePageWithBlocks = async () => {
    const id = await page.evaluate(async () => {
      const ws = await window.septcats.workspaces.list();
      const nodes = await window.septcats.pages.tree({ workspaceId: ws.activeId });
      for (const node of nodes.filter((n) => n.alive === 1)) {
        const blocks = await window.septcats.blocks.list({ pageId: node.id });
        if ((blocks.blocks ?? blocks).filter((b) => b.alive === 1).length >= 2) return node.id;
      }
      return null;
    });
    if (id === null) return null;
    const tab = page.locator(`[data-testid="tab-${id}"]`);
    if ((await tab.count()) > 0) {
      await tab.first().click({ force: true }).catch(() => {});
    } else {
      await page
        .locator(`[data-testid="side-node-${id}"], [data-testid="side-wiki-node-${id}"]`)
        .first()
        .click({ force: true })
        .catch(() => {});
    }
    await wait(1500);
    return id;
  };

  /** hover 第 n 个块（index 从 0 起）→ 等手柄簇出现。 */
  const hoverBlock = async (index) => {
    const box = await page.evaluate((i) => {
      const blocks = [...document.querySelectorAll('.pv-body [data-id]')];
      const el = blocks[i];
      if (el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + Math.min(60, r.width / 2)), y: Math.round(r.top + r.height / 2) };
    }, index);
    if (box === null) return null;
    await page.mouse.move(box.x, box.y);
    await wait(700);
    return box;
  };

  const runCluster = async (label) => {
    const m = await CLUSTER_MEASURE();
    phases[`cluster_${label}`] = m;
    info(`${label} 簇量测（原始）`, JSON.stringify(m));
    check(
      `G1-1[${label}] §0-1 簇内 DOM 序 = ⋮⋮ 在前 / ＋ 在后（视觉序对调）`,
      m !== null && m.order[0] === 'handle' && m.order[1] === 'add',
      m === null ? 'NULL' : `order=${JSON.stringify(m.order)}`,
    );
    check(
      `G1-2[${label}] §0-1 几何序：⋮⋮ 左缘 < ＋ 左缘 且同高（手柄命中区 ≥24）`,
      m !== null &&
        m.handleRect !== null &&
        m.addRect !== null &&
        m.handleRect.left < m.addRect.left &&
        Math.abs(m.handleRect.top - m.addRect.top) <= 1 &&
        m.handleRect.w >= 24 &&
        m.addRect.w >= 24,
      m === null ? 'NULL' : `handle=${JSON.stringify(m.handleRect)} add=${JSON.stringify(m.addRect)}`,
    );
    check(
      `G1-3[${label}] §0-1 draggable 只落 ⋮⋮ 键（壳与 ＋ 均不可拖）`,
      m !== null && m.handleDraggable === 'true' && m.addDraggable === null && m.shellDraggable === null,
      m === null
        ? 'NULL'
        : `handle=${String(m.handleDraggable)} add=${String(m.addDraggable)} shell=${String(m.shellDraggable)}`,
    );
    check(
      `G1-4[${label}] §0-1 ⋮⋮ 光标 = grab（拖拽语义随迁）；＋ 非 grab`,
      m !== null && m.handleCursor === 'grab' && m.addCursor !== 'grab',
      m === null ? 'NULL' : `handle=${String(m.handleCursor)} add=${String(m.addCursor)}`,
    );
    check(
      `G1-5[${label}] 老语义不回归：aria-label（块操作/新增块）齐备、非禁用`,
      m !== null &&
        m.ariaLabels.includes('块操作') &&
        m.ariaLabels.includes('新增块') &&
        m.disabled.every((d) => d === false),
      m === null ? 'NULL' : `labels=${JSON.stringify(m.ariaLabels)} disabled=${JSON.stringify(m.disabled)}`,
    );
    return m;
  };

  // --- G1 簇序（浅色） -------------------------------------------------------
  STEP = 'G1|cluster-light';
  await hoverBlock(0);
  const cluster = await runCluster('light');
  await wait(400);
  await shot('t60-01-light-cluster.png');

  // --- G2 真拖拽 ------------------------------------------------------------
  STEP = 'G2|real-drag';
  const before = await BLOCK_ORDER();
  await hoverBlock(1);
  const handleBox = await page.evaluate(() => {
    const h = document.querySelector('.sc-blockcontrol__handle');
    if (h === null) return null;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const targetBox = await page.evaluate(() => {
    const b = document.querySelectorAll('.pv-body [data-id]')[0];
    if (b === undefined) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top + 2) };
  });
  info('拖拽坐标（原始）', `handle=${JSON.stringify(handleBox)} target=${JSON.stringify(targetBox)} before=${JSON.stringify(before)}`);
  await page.evaluate(() => {
    window.__t60DragLog = [];
    document.addEventListener(
      'dragstart',
      (e) => {
        const t = e.target;
        window.__t60DragLog.push({
          type: 'dragstart',
          tag: t?.tagName ?? '?',
          cls: typeof t?.className === 'string' ? t.className : '',
          hasDt: e.dataTransfer !== null,
        });
      },
      true,
    );
  });
  let dragMode = 'none';
  if (handleBox !== null && targetBox !== null && before.length >= 2) {
    // ① 原生路径：真鼠标按下 + 分步移动（Chromium 在 draggable 元素上会发起 HTML5 drag）
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handleBox.x, y: handleBox.y, button: 'none', buttons: 0 });
    await wait(200);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handleBox.x, y: handleBox.y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      const x = Math.round(handleBox.x + ((targetBox.x - handleBox.x) * i) / 8);
      const y = Math.round(handleBox.y + ((targetBox.y - handleBox.y) * i) / 8);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      await wait(90);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: targetBox.x, y: targetBox.y, button: 'left', buttons: 0, clickCount: 1 });
    await cdp.detach().catch(() => {});
    await wait(900);
    const log = await page.evaluate(() => window.__t60DragLog ?? []);
    if (log.length > 0) dragMode = 'native-cdp';
    phases.dragNative = log;

    if (dragMode === 'none') {
      // ② 合成路径：DataTransfer 直接派发 dragstart/dragover/drop（React 合成事件同路径）
      const synth = await page.evaluate(() => {
        const handle = document.querySelector('.sc-blockcontrol__handle');
        const blocks = [...document.querySelectorAll('.pv-body [data-id]')];
        const dst = blocks[0];
        if (handle === null || dst === undefined) return 'NO_TARGET';
        const dt = new DataTransfer();
        const r = dst.getBoundingClientRect();
        const fire = (el, type, y) =>
          el.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dt,
              clientX: Math.round(r.left + 40),
              clientY: y,
            }),
          );
        fire(handle, 'dragstart', Math.round(r.top + r.height / 2));
        fire(dst, 'dragenter', Math.round(r.top + 2));
        fire(dst, 'dragover', Math.round(r.top + 2));
        fire(dst, 'drop', Math.round(r.top + 2));
        fire(handle, 'dragend', Math.round(r.top + 2));
        return 'OK';
      });
      await wait(900);
      info('合成拖拽返回', synth);
      const log2 = await page.evaluate(() => window.__t60DragLog ?? []);
      phases.dragSynth = log2;
      dragMode = log2.length > 0 ? 'synth-datatransfer' : 'none';
    }
  }
  const after = await BLOCK_ORDER();
  const dragLogFinal = await page.evaluate(() => window.__t60DragLog ?? []);
  phases.drag = { mode: dragMode, before, after, log: dragLogFinal };
  info('拖拽路径（原始）', `mode=${dragMode} log=${JSON.stringify(dragLogFinal)} after=${JSON.stringify(after)}`);
  check(
    'G2-1 §0-1 拖拽真发起：dragstart 事件由 ⋮⋮ 键本体（sc-blockcontrol__handle）触发',
    dragLogFinal.length > 0 && dragLogFinal.some((l) => l.type === 'dragstart' && l.cls.includes('sc-blockcontrol__handle')),
    JSON.stringify(dragLogFinal),
  );
  check(
    'G2-2 §0-1 落位后块序变化（拖动的块真实换位，非空操作）',
    before.length >= 2 && after.length === before.length && after[0] === before[1] && after[1] === before[0],
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  );
  await wait(1400); // EditSession debounce 300ms + 落库
  const dbOrder = activePageId === null ? 'SKIP(无 pageId)' : await BLOCK_DB_ORDER(activePageId);
  phases.dbOrder = dbOrder;
  info('落库块序（原始）', JSON.stringify(dbOrder));
  check(
    'G2-3 §0-1 拖拽结果落库：blocks:list 序与 DOM 序一致（reorder 真写回）',
    Array.isArray(dbOrder) && dbOrder.length === after.length && dbOrder.every((id, i) => id === after[i]),
    Array.isArray(dbOrder) ? JSON.stringify(dbOrder) : String(dbOrder),
  );
  // 拖到正文上时，payload 若带 text/plain 会被 ProseMirror 原生 drop 插成正文（真机实测过）
  const textsAfterDrag = await page.evaluate(() =>
    [...document.querySelectorAll('.pv-body .ProseMirror [data-id]')].map((el) => (el.textContent ?? '').trim()),
  );
  phases.textsAfterDrag = textsAfterDrag;
  info('拖后正文（原始）', JSON.stringify(textsAfterDrag));
  check(
    'G2-4 §0-1 拖拽零污染：私有 MIME 生效——正文未被插入块 id 文本',
    textsAfterDrag.length > 0 && textsAfterDrag.every((t) => !/[0-9A-HJKMNP-TV-Z]{26}/.test(t)),
    JSON.stringify(textsAfterDrag),
  );

  // --- G3 块菜单开合 + 点空白关 ---------------------------------------------
  STEP = 'G3|block-menu';
  await hoverBlock(0);
  const menuBefore = await page.evaluate(() => {
    const h = document.querySelector('.sc-blockcontrol__handle');
    return h === null ? null : h.getAttribute('aria-expanded');
  });
  await page.locator('.sc-blockcontrol__handle').first().click({ force: true }).catch(() => {});
  await wait(600);
  const menuOpen = await page.evaluate(() => {
    const h = document.querySelector('.sc-blockcontrol__handle');
    return {
      expanded: h === null ? null : h.getAttribute('aria-expanded'),
      count: document.querySelectorAll('.sc-blockcontrol__menu').length,
    };
  });
  await shot('t60-01-light-blockmenu.png');
  const blank = await page.evaluate(() => {
    const pv = document.querySelector('.pv-body');
    const r = pv === null ? null : pv.getBoundingClientRect();
    return r === null ? null : { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height - 40) };
  });
  if (blank !== null) await page.mouse.click(blank.x, blank.y).catch(() => {});
  await wait(700);
  const menuClosed = await page.evaluate(() => ({
    expanded: document.querySelector('.sc-blockcontrol__handle')?.getAttribute('aria-expanded') ?? null,
    count: document.querySelectorAll('.sc-blockcontrol__menu').length,
  }));
  phases.blockMenu = { menuBefore, menuOpen, menuClosed, blank };
  check(
    'G3-1 §0-3 点 ⋮⋮ → 块菜单开（aria-expanded=true + 菜单在 DOM）',
    menuOpen.expanded === 'true' && menuOpen.count === 1,
    JSON.stringify({ before: menuBefore, open: menuOpen }),
  );
  check(
    'G3-2 §0-3 点正文空白 → 块菜单关（aria-expanded=false + 菜单卸载）',
    menuClosed.expanded === 'false' && menuClosed.count === 0,
    JSON.stringify(menuClosed),
  );

  // --- G4 侧栏：图标 / ⋯ 菜单重命名 / 右键菜单 / 改名落库 ---------------------
  STEP = 'G4|sidebar';
  const iconSig = await ROW_ICON_SIG('side-node-');
  const wikiHeadSig = await ROW_ICON_SIG('side-wiki');
  phases.iconSig = { normal: iconSig, wikiHead: wikiHeadSig };
  info('行图标签名（原始）', JSON.stringify(phases.iconSig));
  check(
    'G4-1 §0-2 新建页行图标 = FileText（像素签名首格 x3/w10；非 FolderSimple 的 x1/w8）',
    iconSig !== null && iconSig.first !== null && iconSig.first.x === '3' && iconSig.first.w === '10',
    JSON.stringify(iconSig),
  );
  check(
    'G4-2 §0-2 Wiki 分区头仍 Note（未被文件图标化）',
    wikiHeadSig !== null && wikiHeadSig.first !== null && !(wikiHeadSig.first.x === '3' && wikiHeadSig.first.w === '10'),
    JSON.stringify(wikiHeadSig),
  );

  // ⋯ 菜单含「重命名」
  await page.locator('[data-testid^="side-node-"]').first().hover({ force: true }).catch(() => {});
  await wait(300);
  const moreBtn = page.locator('[data-testid^="side-more-"]').first();
  await moreBtn.click({ force: true }).catch(() => {});
  await wait(600);
  const moreMenu = await MENU_STATE();
  phases.moreMenu = moreMenu;
  info('⋯ 菜单（原始）', JSON.stringify(moreMenu));
  check(
    'G4-3 §0-4 ⋯ 菜单含「重命名」条目（位于删除之前）',
    moreMenu !== null && moreMenu.items.some((i) => i.includes('重命名')),
    JSON.stringify(moreMenu?.items),
  );
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);

  // 右键 → 光标处弹菜单
  const rowBox = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="side-node-"]');
    if (row === null) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + 48), y: Math.round(r.top + r.height / 2) };
  });
  if (rowBox !== null) await page.mouse.click(rowBox.x, rowBox.y, { button: 'right' }).catch(() => {});
  await wait(700);
  const ctxMenu = await MENU_STATE();
  await shot('t60-01-light-ctxmenu.png');
  phases.ctxMenu = { rowBox, menu: ctxMenu };
  info('右键菜单（原始）', JSON.stringify(phases.ctxMenu));
  check(
    'G4-4 §0-4 右键行 → 菜单弹出（条目 = 同一份行菜单，含重命名）',
    ctxMenu !== null && ctxMenu.items.some((i) => i.includes('重命名')) && ctxMenu.items.some((i) => i.includes('删除')),
    JSON.stringify(ctxMenu?.items),
  );
  check(
    'G4-5 §0-4 菜单位置 = 光标处（|Δ| ≤ 12px，clamp 后仍在视口内）且宿主 fixed',
    ctxMenu !== null &&
      rowBox !== null &&
      Math.abs(ctxMenu.rect.left - rowBox.x) <= 12 &&
      Math.abs(ctxMenu.rect.top - rowBox.y) <= 12 &&
      ctxMenu.rect.left >= 0 &&
      ctxMenu.rect.top >= 0,
    ctxMenu === null ? 'NULL' : `menu=${JSON.stringify(ctxMenu.rect)} cursor=${JSON.stringify(rowBox)} host=${String(ctxMenu.hostPosition)}`,
  );

  // 点「重命名」→ 行内输入框 → 改名 → 落库
  const renameTarget = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="side-node-"]');
    return row === null ? null : { testId: row.getAttribute('data-testid'), text: (row.querySelector('.app-nav-tx')?.textContent ?? '').trim() };
  });
  await page.locator('[role="menuitem"]:has-text("重命名")').first().click({ force: true }).catch(() => {});
  await wait(700);
  const inputShown = await page.evaluate(() => document.querySelector('[data-testid="side-rename-input"]') !== null);
  check('G4-6 §0-4 点「重命名」→ 行内输入框出现（复用既有 beginRename 态）', inputShown === true, `input=${String(inputShown)} target=${JSON.stringify(renameTarget)}`);

  const NEW_TITLE = 'T60 改名落库';
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.type(NEW_TITLE).catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await wait(1600);
  const rowTitle = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="side-node-"]');
    return row === null ? null : (row.querySelector('.app-nav-tx')?.textContent ?? '').trim();
  });
  const dbTitle = await page.evaluate(async () => {
    const ws2 = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: ws2.activeId });
    const alive = nodes.filter((n) => n.alive === 1);
    return alive.map((n) => n.title);
  });
  phases.rename = { renameTarget, rowTitle, dbTitle, NEW_TITLE };
  info('改名结果（原始）', JSON.stringify(phases.rename));
  check(
    'G4-7 §0-4/⑤ 改名落库：行标题变化 + DB 侧标题同步（pages.tree）',
    rowTitle === NEW_TITLE && Array.isArray(dbTitle) && dbTitle.includes(NEW_TITLE),
    `row=${String(rowTitle)} db=${JSON.stringify(dbTitle)}`,
  );

  // --- G5 通知 3 秒自动关闭 -------------------------------------------------
  STEP = 'G5|toast-3s';
  await page.locator('[data-testid^="side-node-"]').first().hover({ force: true }).catch(() => {});
  await wait(300);
  await page.locator('[data-testid^="side-more-"]').first().click({ force: true }).catch(() => {});
  await wait(600);
  await page.locator('[role="menuitem"]:has-text("转为 Wiki")').first().click({ force: true }).catch(() => {});
  const appearedAt = await (async () => {
    const ok = await waitFor(async () => page.evaluate(() => document.querySelectorAll('.sc-toast__item').length > 0), 6000, 60);
    return ok ? Date.now() : null;
  })();
  const text = await page.evaluate(() => document.querySelector('.sc-toast__item')?.textContent ?? '');
  const goneAt = await (async () => {
    const ok = await waitFor(async () => page.evaluate(() => document.querySelectorAll('.sc-toast__item').length === 0), 9000, 80);
    return ok ? Date.now() : null;
  })();
  const lifeMs = appearedAt === null || goneAt === null ? null : goneAt - appearedAt;
  phases.toast = { appearedAt, goneAt, lifeMs, text };
  info('toast 生命周期（原始）', JSON.stringify(phases.toast));
  check(
    'G5-1 §0-5 触发一条通知（转换）出现于视口',
    appearedAt !== null && text.length > 0,
    `text=${text} appeared=${String(appearedAt !== null)}`,
  );
  check(
    'G5-2 §0-5 通知 3000ms 自动关闭（实测存活 ∈ [2600, 4000]ms，无手动关闭）',
    lifeMs !== null && lifeMs >= 2600 && lifeMs <= 4000,
    `lifeMs=${String(lifeMs)}`,
  );

  // --- G6 浅色截图 ----------------------------------------------------------
  STEP = 'G6|light-shots';
  await wait(600);
  await shot('t60-01-light-main.png');

  // --- G7 深色：簇序复跑 + 截图 ---------------------------------------------
  STEP = 'G7|dark';
  const themeDark = await setThemeAndReload('dark');
  check('G7-0 深色主题就位', themeDark === 'dark', `data-theme=${String(themeDark)}`);
  const darkPage = await activatePageWithBlocks();
  info('深色激活页（含 ≥2 块）', String(darkPage));
  await hoverBlock(0);
  await runCluster('dark');
  await wait(400);
  await shot('t60-01-dark-main.png');
  const rowBoxDark = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="side-node-"]');
    if (row === null) return null;
    const r = row.getBoundingClientRect();
    return { x: Math.round(r.left + 48), y: Math.round(r.top + r.height / 2) };
  });
  if (rowBoxDark !== null) await page.mouse.click(rowBoxDark.x, rowBoxDark.y, { button: 'right' }).catch(() => {});
  await wait(700);
  const ctxDark = await MENU_STATE();
  await shot('t60-01-dark-ctxmenu.png');
  phases.ctxMenuDark = { rowBoxDark, menu: ctxDark };
  check(
    'G7-1 深色：右键菜单同样弹在光标处（clamp）',
    ctxDark !== null && rowBoxDark !== null && Math.abs(ctxDark.rect.left - rowBoxDark.x) <= 12,
    JSON.stringify(phases.ctxMenuDark),
  );
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);
  await setThemeAndReload('light');
  await activatePageWithBlocks();
  await wait(600);

  // --- G8 两宽度零滚动 ------------------------------------------------------
  STEP = 'G8|two-widths';
  const cdpw = await page.context().newCDPSession(page);
  const widthRows = [];
  for (const w of WIDTHS) {
    await cdpw.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(800);
    widthRows.push({ w, ...(await SCROLL_MEASURE()) });
    if (w === 1184) await shot('t60-01-light-main-1184.png');
    if (w === 894) await shot('t60-01-light-main-894.png');
  }
  await cdpw.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await cdpw.detach().catch(() => {});
  await wait(800);
  phases.widths = widthRows;
  info('两宽度零滚动（原始）', JSON.stringify(widthRows));
  check(
    'G8-1 §3：1184/894 两宽度零滚动（纵向 + 横向）且侧栏 top 恒 0',
    widthRows.every((r) => r.winScrollH <= r.winClientH + 1 && r.winScrollW <= r.winClientW + 1 && r.sideTop === 0),
    widthRows
      .map((r) => `${String(r.w)}:{h ${String(r.winScrollH)}/${String(r.winClientH)},w ${String(r.winScrollW)}/${String(r.winClientW)},top=${String(r.sideTop)}}`)
      .join(' '),
  );

  // --- G9 退出 --------------------------------------------------------------
  const electronBefore = electronCount();
  boot.quit = await quit(boot.pid, boot.browser);
  await wait(1500);
  const electronAfter = electronCount();
  phases.electron = { before: electronBefore, after: electronAfter };
  info('electron 进程计数（退出前后）', JSON.stringify(phases.electron));
  check('G9-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
  check('G9-2 交付纪律：退出后 electron 进程计数 = 0', electronAfter === 0, `before=${String(electronBefore)} after=${String(electronAfter)}`);
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
    task: 'TASK-T60-01 真机取证（交互一致性批 R13 ①②③⑤⑥⑦）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method:
      'renderer CDP（playwright-core over --remote-debugging-port）量测/点击/拖拽/截图 + Emulation.setDeviceMetricsOverride 两宽度',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't60-01-light-main.png',
      't60-01-light-cluster.png',
      't60-01-light-blockmenu.png',
      't60-01-light-ctxmenu.png',
      't60-01-light-main-1184.png',
      't60-01-light-main-894.png',
      't60-01-dark-main.png',
      't60-01-dark-ctxmenu.png',
    ],
    pass: passes,
    fail: fails,
    electronFinal,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T60-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}  electron 最终计数=${String(electronFinal)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
