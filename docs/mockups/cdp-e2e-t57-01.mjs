/* cdp-e2e-t57-01.mjs —— TASK-T57-01 真机取证（布局选择弹框 + 独立布局编辑器）
 *
 * 范围（对应任务书 §1.1–§1.7 + §2 红线）：
 *   G0 夹具自检：隔离夹具真点「新建页面」×2 → 2 标签 / 2 存活页；真键入两段正文（T52 装订线断言用）；
 *   G1 §1.1 顶栏顺序 Sync→Plus→Layout→Gear（布局钮紧邻设置钮左侧）+ 点击开弹框
 *      （aria-pressed=true；弹框是 overlay → 主区结构仍在）；
 *   G2 §1.2 弹框 = 像素模态（role=dialog/aria-modal/2px 描边/像素投影）+ 三张 CSS 抽象预览卡
 *      （无 <img> 位图）+ 当前项高亮；
 *   G3 §1.7 点 focus 卡 → **主窗口侧栏 getBoundingClientRect 前后实测**（原始值贴报告）：
 *      240 → 0（display:none），measure 变量 650 → 900；
 *   G4 §1.3 「自定义编辑…」→ 独立编辑器页（.layout-editor + 面包屑 + 主区让位）；
 *   G5 §1.7 拉宽度滑杆：**真实鼠标拖动**（mouse down→move→up）与精确回写两路，
 *      均以 .sc-shell__sidebar / .app-side 的 DOM 实测宽度跟随为准；
 *   G6 §1.7 恢复默认 → 240/650/notion 回位（侧栏 DOM 实测 240）；
 *   G7 §1.7 「完成」→ 回编辑器视图（pv-root 回来、.app-shell--fused 在、折叠钮在）；
 *   G8 §2 T52 布局融合语义红线复跑（侧栏通高 / 折叠钮位 / 标签连通）+ T33 装订线 70/12；
 *   G9 §2 1184/894 两宽度不溢出（零滚动 + 侧栏 top 恒 0），编辑器视图与布局编辑器页各测一轮；
 *   G10 i18n：切 English 后弹框与编辑器页文案为英文；
 *   G11 截图 ≥5 张（三 preset 卡缩略 + 编辑器页 zh/en + 两宽度 + 窗口级）。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t57-01/ 下，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口，窗口级截图经 main 进程 --inspect 调公开 API（不改产品代码）。
 *
 * 运行：node docs/mockups/cdp-e2e-t57-01.mjs
 * 产物：docs/mockups/screens-t57/t57-01-results.json + ≥5 张 png
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t57-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9477;
const INSPECT = 9237;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t57');
const OUT_JSON = join(SHOTS, 't57-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const LAYOUT_KEY = 'septcats.layout';
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
          task: 'TASK-T57-01 真机取证（布局选择弹框 + 独立布局编辑器）',
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

// --- main 进程 inspector（仅窗口级补拍用） -----------------------------------
let ws = null;
let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    msgId += 1;
    pending.set(msgId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}
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
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 400) };
  return { value: r.result?.value };
}
/** 窗口级截图（含标题栏 + 原生菜单栏）：main 置顶 + desktopCapturer 裁剪。 */
async function captureWindow(file) {
  const rect = await page.evaluate(() => {
    const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
    const pad = 10;
    return {
      x: Math.max(0, Math.round(window.screenX - pad)),
      y: Math.max(0, Math.round(window.screenY - topChrome - pad)),
      width: Math.round(window.outerWidth + pad * 2),
      height: Math.round(window.outerHeight + topChrome + pad * 2),
    };
  });
  await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.show(); w.setAlwaysOnTop(true); w.moveTop(); w.focus();
    return 'raised';
  })()`);
  await wait(1200);
  const expr = `(async () => {
    const { desktopCapturer, screen } = require('electron');
    const d = screen.getPrimaryDisplay(); const s = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width: Math.floor(d.size.width*s), height: Math.floor(d.size.height*s) } });
    if (srcs.length === 0) return 'NO_SOURCE';
    let img = srcs[0].thumbnail;
    const rx = Math.max(0, Math.round(${String(rect.x)}*s)); const ry = Math.max(0, Math.round(${String(rect.y)}*s));
    const rw = Math.max(1, Math.min(Math.round(${String(rect.width)}*s), img.getSize().width - rx));
    const rh = Math.max(1, Math.min(Math.round(${String(rect.height)}*s), img.getSize().height - ry));
    img = img.crop({ x: rx, y: ry, width: rw, height: rh });
    return img.toPNG().toString('base64');
  })()`;
  const r = await mainEval(expr);
  if (r.err || typeof r.value !== 'string' || r.value === 'NO_SOURCE') return { size: -1, err: r.err ?? r.value, rect };
  const buf = Buffer.from(r.value, 'base64');
  writeFileSync(file, buf);
  await mainEval(`(() => { const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (w) w.setAlwaysOnTop(false); return 'ok'; })()`).catch(() => {});
  return { size: buf.length, err: null, rect };
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
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  await wait(500);
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
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

/** 布局存储读写（renderer localStorage；含默认值兜底）。 */
async function patchLayout(patch) {
  return await page.evaluate(
    ([key, p]) => {
      const raw = window.localStorage.getItem(key);
      const base = raw === null ? { v: 1, preset: 'notion', sidebar: { position: 'left', width: 240 }, content: { measure: 650 }, ai: { position: 'right', expanded: false }, tabsVisible: true, theme: 'system', density: 'comfortable' } : JSON.parse(raw);
      window.localStorage.setItem(key, JSON.stringify({ ...base, ...p }));
      return window.localStorage.getItem(key);
    },
    [LAYOUT_KEY, patch],
  );
}
async function readLayout() {
  return await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  }, LAYOUT_KEY);
}
async function reload() {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
}
const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => {});
/** 局部放大截图（dsf=3）：给 PM 目检像素细节用（不改任何布局量测）。 */
async function shotZoom(file, clip) {
  const s = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const cdpz = await page.context().newCDPSession(page);
  await cdpz.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 3, mobile: false });
  await wait(600);
  const r = await page.screenshot({ path: join(SHOTS, file), clip }).catch(() => null);
  await cdpz.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await cdpz.detach().catch(() => {});
  await wait(600);
  return { bytes: r === null ? -1 : r.length, clip };
}

/** React 受控 range 的精确回写（原生 value setter + input/change 事件）。 */
async function setRange(testId, value) {
  return await page.evaluate(
    ([id, v]) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!(el instanceof HTMLInputElement)) return null;
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc.set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    },
    [testId, value],
  );
}

/** 真实鼠标拖动 range（真机交互路径；与 setRange 双路取证）。 */
async function dragRange(testId, ratio) {
  const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
  if (box === null) return null;
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * 0.5;
  const x1 = box.x + box.width * ratio;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x1, y, { steps: 10 });
  await page.mouse.up();
  await wait(600);
  return await page.evaluate(
    (id) => (document.querySelector(`[data-testid="${id}"]`) instanceof HTMLInputElement ? document.querySelector(`[data-testid="${id}"]`).value : null),
    testId,
  );
}

/** 侧栏/主区量测（§1.7 侧栏宽度实测 + §2 通高）。 */
const SHELL_MEASURE = () => {
  const side = document.querySelector('.app-side');
  const aside = document.querySelector('.sc-shell__sidebar');
  const topbar = document.querySelector('.sc-shell__topbar');
  const main = document.querySelector('.sc-shell__main');
  const ar = aside === null ? null : aside.getBoundingClientRect();
  const sr = side === null ? null : side.getBoundingClientRect();
  const tr = topbar === null ? null : topbar.getBoundingClientRect();
  const mr = main === null ? null : main.getBoundingClientRect();
  return {
    sidebarWidth: ar === null ? null : +ar.width.toFixed(1),
    sidebarDisplay: aside === null ? null : getComputedStyle(aside).display,
    sidebarLeft: ar === null ? null : +ar.left.toFixed(1),
    sidebarTop: ar === null ? null : +ar.top.toFixed(1),
    appSideWidth: sr === null ? null : +sr.width.toFixed(1),
    topbarLeft: tr === null ? null : +tr.left.toFixed(1),
    topbarRight: tr === null ? null : +tr.right.toFixed(1),
    mainWidth: mr === null ? null : +mr.width.toFixed(1),
    mainLeft: mr === null ? null : +mr.left.toFixed(1),
    layoutSidebarVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-sidebar').trim(),
    layoutMeasureVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-measure').trim(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    nativeChromeH: Math.round(window.outerHeight - window.innerHeight),
  };
};

/** §2 折叠钮位置（T52 红线复跑）。 */
const TOGGLE_MEASURE = () => {
  const btn = document.querySelector('[data-testid="side-toggle"]');
  const bar = document.querySelector('.tabsbar');
  if (btn === null || bar === null) return null;
  const b = btn.getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  return {
    btnCenterX: +(b.left + b.width / 2).toFixed(1),
    btnCenterY: +(b.top + b.height / 2).toFixed(1),
    btnW: +b.width.toFixed(1),
    barLeft: +r.left.toFixed(1),
    barCenterY: +(r.top + r.height / 2).toFixed(1),
    inViewport: b.left >= -1 && b.top >= -1 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1,
  };
};

/** §2 标签条与编辑区连通（T52 红线复跑）。 */
const FUSION_COLORS = () => {
  const bar = document.querySelector('.tabsbar');
  const active = document.querySelector('.tabsbar-tab--active');
  const pv = document.querySelector('.pv-root');
  const barStyle = bar === null ? null : getComputedStyle(bar);
  const aStyle = active === null ? null : getComputedStyle(active);
  const ar = active === null ? null : active.getBoundingClientRect();
  const br = bar === null ? null : bar.getBoundingClientRect();
  let belowActive = null;
  if (ar !== null && br !== null) {
    const hit = document.elementFromPoint(ar.left + ar.width / 2, br.bottom + 1);
    belowActive = hit === null ? null : `${hit.className || hit.tagName}`.slice(0, 60);
  }
  return {
    barBorderBottom: barStyle === null ? null : barStyle.borderBottomWidth,
    activeBorderBottom: aStyle === null ? null : aStyle.borderBottomWidth,
    activeBg: aStyle === null ? null : aStyle.backgroundColor,
    pvBg: pv === null ? null : getComputedStyle(pv).backgroundColor,
    belowActive,
  };
};

/** 零滚动 + 侧栏 top 恒 0（§2 两宽度）。 */
const SCROLL_MEASURE = () => {
  const se = document.scrollingElement;
  const side = document.querySelector('.app-side');
  const aside = document.querySelector('.sc-shell__sidebar');
  return {
    winScrollH: se.scrollHeight,
    winClientH: se.clientHeight,
    winScrollW: se.scrollWidth,
    winClientW: se.clientWidth,
    sideTop: side === null ? null : +side.getBoundingClientRect().top.toFixed(1),
    sidebarWidth: aside === null ? null : +aside.getBoundingClientRect().width.toFixed(1),
  };
};

/** T33 装订线（T52 探针同法复跑）。 */
async function measureGutter() {
  await page.locator('.pv-body [data-id]').first().hover({ force: true }).catch(() => {});
  await wait(1200);
  return await page.evaluate(() => {
    const cluster = document.querySelector('.pv-handle');
    const body = document.querySelector('.pv-body');
    const blk = document.querySelector('.pv-body [data-id]');
    if (cluster === null || body === null || blk === null) return null;
    const cr = cluster.getBoundingClientRect();
    const st = getComputedStyle(blk);
    const br = blk.getBoundingClientRect();
    const textLeft = br.left + parseFloat(st.paddingLeft || '0') + parseFloat(br.width ? st.borderLeftWidth || '0' : '0');
    return {
      bodyPaddingLeft: getComputedStyle(body).paddingLeft,
      gutter: +(textLeft - cr.right).toFixed(1),
      overlap: textLeft < cr.right,
      clusterW: +cr.width.toFixed(1),
      clusterH: +cr.height.toFixed(1),
    };
  });
}

/** 弹框结构量测。 */
const PICKER_MEASURE = () => {
  const panel = document.querySelector('[data-testid="layout-picker"]');
  const overlay = document.querySelector('[data-testid="layout-picker-overlay"]');
  if (panel === null || overlay === null) return null;
  const ps = getComputedStyle(panel);
  const cards = [...document.querySelectorAll('.layout-picker__card')];
  return {
    role: panel.getAttribute('role'),
    ariaModal: panel.getAttribute('aria-modal'),
    borderWidth: ps.borderTopWidth,
    boxShadow: ps.boxShadow.slice(0, 120),
    cardCount: cards.length,
    cardIds: cards.map((c) => c.getAttribute('data-testid')),
    activeCards: cards.map((c) => c.getAttribute('aria-pressed')),
    previewCount: document.querySelectorAll('.layout-picker [data-testid="layout-preview"]').length,
    imgCount: document.querySelectorAll('.layout-picker img').length,
    editButton: document.querySelector('[data-testid="layout-picker-edit"]') !== null,
    overlayBg: getComputedStyle(overlay).backgroundColor,
    width: Math.round(panel.getBoundingClientRect().width),
    // 弹框是 overlay：主区结构仍在（不挡重排观测）
    shellAlive: document.querySelector('.sc-shell') !== null,
  };
};

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

const phases = {};
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  page = boot.page;
  info('main inspector', await connectInspector().catch((e) => `未连接：${String(e)}`));

  // --- G0 夹具 --------------------------------------------------------------
  STEP = 'G0|fixture';
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  }
  const editorBody = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
  await editorBody.click({ force: true }).catch(() => {});
  await page.keyboard.type('T57 布局弹框真机取证第一段').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.keyboard.type('T57 布局弹框真机取证第二段').catch(() => {});
  await wait(1600);
  const tabs0 = await tabCount();
  const pages0 = await pageCount();
  check('G0-1 夹具成立：真点「新建页面」×2 + 键入正文两段 → 2 标签 / 2 存活页', tabs0 === 2 && pages0 === 2, `tabs=${String(tabs0)} pages=${String(pages0)}`);

  // --- G1 §1.1 顶栏布局钮 ---------------------------------------------------
  STEP = 'G1|topbar-layout';
  const barOrder = await page.evaluate(() =>
    [...document.querySelectorAll('.sc-shell__actions .sc-iconbtn')].map((n) => n.getAttribute('aria-label') ?? n.className),
  );
  phases.topbarOrder = barOrder;
  info('顶栏 actions 序（原始）', JSON.stringify(barOrder));
  const layoutIdx = barOrder.indexOf('布局');
  const settingsIdx = barOrder.indexOf('设置');
  check(
    'G1-1 §1.1：布局钮存在且紧邻设置钮左侧（顺序 …Plus→Layout→Gear）',
    layoutIdx >= 0 && settingsIdx > 0 && layoutIdx === settingsIdx - 1,
    `layoutIndex=${String(layoutIdx)} settingsIndex=${String(settingsIdx)}`,
  );
  const ariaBefore = await page.locator('[data-testid="layout-open"]').getAttribute('aria-pressed');
  await page.locator('[data-testid="layout-open"]').click({ force: true });
  await wait(800);
  const ariaAfter = await page.locator('[data-testid="layout-open"]').getAttribute('aria-pressed');
  const pm = await page.evaluate(PICKER_MEASURE);
  phases.picker = pm;
  info('弹框量测（原始）', JSON.stringify(pm));
  check('G1-2 点布局钮 → 弹框打开且 aria-pressed 翻 true', ariaBefore === 'false' && ariaAfter === 'true' && pm !== null, `before=${String(ariaBefore)} after=${String(ariaAfter)}`);
  check('G1-3 §1.2：弹框是 overlay，主窗口主区结构仍在（选卡重排可见）', pm !== null && pm.shellAlive === true, `shellAlive=${String(pm?.shellAlive)} overlayBg=${String(pm?.overlayBg)}`);

  // --- G2 §1.2 像素模态 + 三张 CSS 抽象卡 -----------------------------------
  STEP = 'G2|picker-anatomy';
  check(
    'G2-1 §1.2：像素模态语法（role=dialog + aria-modal + 2px 描边 + 像素投影 token 生效）',
    pm !== null && pm.role === 'dialog' && pm.ariaModal === 'true' && pm.borderWidth === '2px' && pm.boxShadow.length > 0,
    `role=${String(pm?.role)} ariaModal=${String(pm?.ariaModal)} border=${String(pm?.borderWidth)} shadow="${String(pm?.boxShadow)}"`,
  );
  check(
    'G2-2 §1.2：三张 preset 卡（notion/focus/workbench）+ 每卡一张 CSS 抽象预览图，零位图 <img>',
    pm !== null && pm.cardCount === 3 && pm.previewCount === 3 && pm.imgCount === 0 && pm.cardIds.join(',') === 'layout-picker-card-notion,layout-picker-card-focus,layout-picker-card-workbench',
    `cards=${String(pm?.cardCount)} previews=${String(pm?.previewCount)} imgs=${String(pm?.imgCount)} ids=${String(pm?.cardIds?.join(','))}`,
  );
  check(
    'G2-3 当前项高亮（notion aria-pressed=true，其余 false）+ 底部「自定义编辑…」按钮在位',
    pm !== null && pm.activeCards.join(',') === 'true,false,false' && pm.editButton === true,
    `pressed=${String(pm?.activeCards?.join(','))} edit=${String(pm?.editButton)} panelW=${String(pm?.width)}`,
  );
  await shot('t57-01-picker-cards.png');
  const cardBoxes = await page.evaluate(() =>
    [...document.querySelectorAll('.layout-picker__card')].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  );
  for (const [i, name] of ['notion', 'focus', 'workbench'].entries()) {
    const b = cardBoxes[i];
    if (b === undefined) continue;
    const z = await shotZoom(`t57-01-picker-card-${name}-zoom.png`, { x: b.x, y: b.y, width: b.w, height: b.h });
    info(`预设卡 ${name} 3x 放大截图`, JSON.stringify(z));
  }

  // --- G3 §1.7 选 focus → 主窗口侧栏前后实测 ---------------------------------
  STEP = 'G3|apply-focus';
  const before = await page.evaluate(SHELL_MEASURE);
  phases.sidebarBefore = before;
  info('选卡前侧栏（原始）', JSON.stringify(before));
  await page.locator('[data-testid="layout-picker-card-focus"]').click({ force: true });
  await wait(1000);
  const after = await page.evaluate(SHELL_MEASURE);
  phases.sidebarAfterFocus = after;
  info('选 focus 后侧栏（原始）', JSON.stringify(after));
  const afterActive = await page.locator('[data-testid="layout-picker-card-focus"]').getAttribute('aria-pressed');
  check(
    'G3-1 §1.7：点 focus → 主窗口侧栏 getBoundingClientRect 实测变窄（240 → 0，display:none）',
    before.sidebarWidth === 240 && after.sidebarWidth === 0 && after.sidebarDisplay === 'none',
    `before=${String(before.sidebarWidth)}px after=${String(after.sidebarWidth)}px display=${String(after.sidebarDisplay)} appSide=${String(before.appSideWidth)}→${String(after.appSideWidth)}`,
  );
  check(
    'G3-2 §1.7：正文宽度变量同步 650 → 900（预设整份套用）+ 主区吃满窗口宽',
    before.layoutMeasureVar === '650px' && after.layoutMeasureVar === '900px' && Math.abs(after.mainWidth - after.innerWidth) <= 1,
    `measure ${String(before.layoutMeasureVar)}→${String(after.layoutMeasureVar)} mainW=${String(after.mainWidth)} winW=${String(after.innerWidth)}`,
  );
  check('G3-3 点卡后弹框不关（可连续试卡）+ 高亮转移到 focus', afterActive === 'true', `focusPressed=${String(afterActive)} pickerStillOpen=${String((await page.evaluate(PICKER_MEASURE)) !== null)}`);
  await shot('t57-01-picker-focus-applied.png');

  // --- G4 §1.3 自定义编辑… → 独立编辑器页 ------------------------------------
  STEP = 'G4|editor-page';
  await page.locator('[data-testid="layout-picker-edit"]').click({ force: true });
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="layout-editor"]') !== null), 10000);
  await wait(900);
  const editorState = await page.evaluate(() => ({
    editor: document.querySelector('[data-testid="layout-editor"]') !== null,
    picker: document.querySelector('[data-testid="layout-picker"]') !== null,
    crumb: document.querySelector('.sc-shell__crumb')?.textContent ?? null,
    pvRoot: document.querySelector('.pv-root') !== null,
    widthValue: document.querySelector('[data-testid="layout-sidebar-width-value"]')?.textContent ?? null,
    rangeMin: document.querySelector('[data-testid="layout-sidebar-width"]')?.getAttribute('min') ?? null,
    rangeMax: document.querySelector('[data-testid="layout-sidebar-width"]')?.getAttribute('max') ?? null,
    previewCount: document.querySelectorAll('[data-testid="layout-editor"] [data-testid="layout-preview"]').length,
    fused: (document.querySelector('.sc-shell')?.className ?? '').includes('app-shell--fused'),
  }));
  phases.editorPage = editorState;
  info('编辑器页状态（原始）', JSON.stringify(editorState));
  check(
    'G4-1 §1.3：弹框关、编辑器页占主区、面包屑「布局编辑器」、主区 pv-root 让位',
    editorState.editor === true && editorState.picker === false && (editorState.crumb ?? '').includes('布局编辑器') && editorState.pvRoot === false,
    JSON.stringify(editorState),
  );
  check(
    'G4-2 §1.3：编辑器页 = 大预览 + 三张预设卡缩略（4 张抽象图）+ 宽度滑杆（区间 200–320）',
    editorState.previewCount === 4 && editorState.rangeMin === '200' && editorState.rangeMax === '320',
    `previews=${String(editorState.previewCount)} min=${String(editorState.rangeMin)} max=${String(editorState.rangeMax)}`,
  );
  check('G4-3 非编辑器视图 → .app-shell--fused 摘除（T52 契约：顶栏钮回来）', editorState.fused === false, `fused=${String(editorState.fused)}`);
  await shot('t57-01-editor-zh.png');

  // --- G5 §1.7 拉宽度滑杆 → 侧栏宽度 DOM 实测跟随 -----------------------------
  STEP = 'G5|slider';
  // 先回到「侧栏左」态（侧栏可见才能量宽度）
  await page.locator('.layout-editor [role="radiogroup"][aria-label="侧栏"] input[value="left"]').click({ force: true });
  await wait(700);
  const beforeDrag = await page.evaluate(SHELL_MEASURE);
  const dragValue = await dragRange('layout-sidebar-width', 0.95);
  const afterDrag = await page.evaluate(SHELL_MEASURE);
  phases.drag = { beforeDrag, dragValue, afterDrag };
  info('真实鼠标拖动滑杆（原始）', JSON.stringify({ dragValue, before: beforeDrag.sidebarWidth, after: afterDrag.sidebarWidth, var: afterDrag.layoutSidebarVar }));
  check(
    'G5-1 §1.7：真实鼠标拖动宽度滑杆 → 主窗口 .sc-shell__sidebar / .app-side 实测宽度跟随（DOM 实测）',
    afterDrag.sidebarWidth !== null && afterDrag.sidebarWidth > 240 && Math.abs(afterDrag.sidebarWidth - Number.parseFloat(afterDrag.layoutSidebarVar)) <= 1 && Math.abs(afterDrag.appSideWidth - afterDrag.sidebarWidth) <= 1,
    `dragValue=${String(dragValue)} sidebar ${String(beforeDrag.sidebarWidth)}→${String(afterDrag.sidebarWidth)} var=${String(afterDrag.layoutSidebarVar)} appSide=${String(afterDrag.appSideWidth)}`,
  );
  const setValue = await setRange('layout-sidebar-width', 300);
  await wait(900);
  const afterSet = await page.evaluate(SHELL_MEASURE);
  phases.afterSet = afterSet;
  info('滑杆精确回写 300（原始）', JSON.stringify({ setValue, ...afterSet }));
  const previewVar = await page.evaluate(() => document.querySelector('.layout-editor__preview .layout-preview')?.getAttribute('style') ?? null);
  check(
    'G5-2 §1.7：滑杆回写 300 → 侧栏实测 = 300px（= --sc-layout-sidebar）+ 大预览图内联变量随动 27.3%',
    afterSet.sidebarWidth === 300 && afterSet.layoutSidebarVar === '300px' && (previewVar ?? '').includes('27.3%'),
    `sidebar=${String(afterSet.sidebarWidth)} var=${String(afterSet.layoutSidebarVar)} previewStyle="${String(previewVar)}" rangeValue=${String(setValue)}`,
  );
  const persisted = await readLayout();
  check(
    'G5-3 回写落入 localStorage（septcats.layout：preset=custom / sidebar.width=300）',
    persisted !== null && persisted.preset === 'custom' && persisted.sidebar?.width === 300,
    JSON.stringify(persisted),
  );
  await shot('t57-01-editor-width300.png');

  // --- G6 §1.7 恢复默认 ------------------------------------------------------
  STEP = 'G6|reset-default';
  await page.locator('[data-testid="layout-editor-reset"]').click({ force: true });
  await wait(1000);
  const afterReset = await page.evaluate(SHELL_MEASURE);
  const resetState = await page.evaluate(() => ({
    widthValue: document.querySelector('[data-testid="layout-sidebar-width-value"]')?.textContent ?? null,
    notionPressed: document.querySelector('[data-testid="layout-preset-notion"]')?.getAttribute('aria-pressed') ?? null,
    density: document.documentElement.dataset.scDensity ?? null,
  }));
  phases.reset = { afterReset, resetState };
  info('恢复默认（原始）', JSON.stringify({ ...resetState, sidebarWidth: afterReset.sidebarWidth, vars: [afterReset.layoutSidebarVar, afterReset.layoutMeasureVar] }));
  check(
    'G6-1 §1.7：恢复默认 → 侧栏/正文/密度/预设四项回位（DOM 实测 240 + 变量 240/650 + notion 高亮）',
    afterReset.sidebarWidth === 240 && afterReset.layoutSidebarVar === '240px' && afterReset.layoutMeasureVar === '650px' && resetState.notionPressed === 'true' && resetState.density === 'comfortable',
    `sidebar=${String(afterReset.sidebarWidth)} vars=${String(afterReset.layoutSidebarVar)}/${String(afterReset.layoutMeasureVar)} notion=${String(resetState.notionPressed)} density=${String(resetState.density)}`,
  );

  // --- G7 §1.7 完成 → 回编辑器视图 -------------------------------------------
  STEP = 'G7|done';
  await page.locator('[data-testid="layout-editor-done"]').click({ force: true });
  await waitFor(async () => page.evaluate(() => document.querySelector('.pv-root') !== null), 10000);
  await wait(900);
  const backState = await page.evaluate(() => ({
    editor: document.querySelector('[data-testid="layout-editor"]') !== null,
    pvRoot: document.querySelector('.pv-root') !== null,
    fused: (document.querySelector('.sc-shell')?.className ?? '').includes('app-shell--fused'),
    toggle: document.querySelector('[data-testid="side-toggle"]') !== null,
    inBar: document.querySelector('.tabsbar')?.contains(document.querySelector('[data-testid="side-toggle"]')) ?? false,
  }));
  phases.backToEditor = backState;
  check(
    'G7-1 §1.7：点「完成」→ 回编辑器视图（编辑器页消失、pv-root 回来、fused 类在、折叠钮在标签行内）',
    backState.editor === false && backState.pvRoot === true && backState.fused === true && backState.toggle === true && backState.inBar === true,
    JSON.stringify(backState),
  );

  // --- G8 §2 T52 红线复跑 ----------------------------------------------------
  STEP = 'G8|t52-redlines';
  const fusionSide = await page.evaluate(SHELL_MEASURE);
  phases.fusionSide = fusionSide;
  info('T52 通高量测（原始）', JSON.stringify(fusionSide));
  check(
    'G8-1 T52 红线：侧栏通高（侧栏 top=0 且高 ≈ 内容区高；原生菜单 chrome 高 > 0）',
    fusionSide.sidebarTop === 0 && Math.abs(fusionSide.appSideWidth - 240) <= 1 && fusionSide.nativeChromeH > 0,
    `sidebarTop=${String(fusionSide.sidebarTop)} sidebarW=${String(fusionSide.sidebarWidth)} chromeH=${String(fusionSide.nativeChromeH)}`,
  );
  check(
    'G8-2 T52 红线：顶栏左缘 = 侧栏右缘（顶栏不再通栏横切侧栏上方）',
    Math.abs((fusionSide.topbarLeft ?? -1) - (fusionSide.sidebarWidth ?? -2)) <= 1 && (fusionSide.topbarLeft ?? 0) > 0,
    `topbarLeft=${String(fusionSide.topbarLeft)} sidebarW=${String(fusionSide.sidebarWidth)} topbarRight=${String(fusionSide.topbarRight)} winW=${String(fusionSide.innerWidth)}`,
  );
  const toggle = await page.evaluate(TOGGLE_MEASURE);
  phases.toggle = toggle;
  info('折叠钮量测（原始）', JSON.stringify(toggle));
  check(
    'G8-3 T52 红线：折叠钮在标签行最左（中心 x ∈ [行左, 行左+64]、|Δy(行中心)| ≤ 2、24px 图标位、在视口内）',
    toggle !== null && toggle.btnCenterX >= toggle.barLeft && toggle.btnCenterX <= toggle.barLeft + 64 && Math.abs(toggle.btnCenterY - toggle.barCenterY) <= 2 && toggle.btnW === 24 && toggle.inViewport === true,
    toggle === null ? 'NULL' : `centerX=${String(toggle.btnCenterX)} barLeft=${String(toggle.barLeft)} Δy=${String(Math.abs(toggle.btnCenterY - toggle.barCenterY).toFixed(1))} w=${String(toggle.btnW)} inViewport=${String(toggle.inViewport)}`,
  );
  const colors = await page.evaluate(FUSION_COLORS);
  phases.colors = colors;
  info('标签连通色值（原始）', JSON.stringify(colors));
  check(
    'G8-4 T52 红线：标签连通（无整行分隔线 + 活动标签底 = pv-root 底 + 下缘命中 pv-root）',
    colors.barBorderBottom === '0px' && colors.activeBorderBottom === '0px' && colors.activeBg === colors.pvBg && (colors.belowActive ?? '').includes('pv-root'),
    `barBorder=${String(colors.barBorderBottom)} activeBorder=${String(colors.activeBorderBottom)} activeBg=${String(colors.activeBg)} pvBg=${String(colors.pvBg)} below="${String(colors.belowActive)}"`,
  );
  const gutter = await measureGutter();
  phases.gutter = gutter;
  info('装订线量测（原始）', JSON.stringify(gutter));
  check(
    'G8-5 T33/T52 红线：.pv-body 左侧装订线 70px + 手柄簇↔文本 gutter=12 且无重叠',
    gutter !== null && gutter.bodyPaddingLeft === '70px' && Math.abs(gutter.gutter - 12) <= 0.6 && gutter.overlap === false,
    `bodyPaddingLeft=${String(gutter?.bodyPaddingLeft)} gutter=${String(gutter?.gutter)} overlap=${String(gutter?.overlap)}`,
  );

  // --- G9 §2 1184/894 两宽度不溢出（编辑器视图 + 布局编辑器页各一轮） --------
  STEP = 'G9|two-widths';
  const cdp = await page.context().newCDPSession(page);
  const rows = [];
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(800);
    const s = await page.evaluate(SCROLL_MEASURE);
    rows.push({ w, view: 'editor', ...s });
  }
  // 布局编辑器页同宽复验
  await page.locator('[data-testid="layout-open"]').click({ force: true }).catch(() => {});
  await wait(600);
  await page.locator('[data-testid="layout-picker-edit"]').click({ force: true }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="layout-editor"]') !== null), 10000);
  await wait(900);
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(800);
    const s = await page.evaluate(SCROLL_MEASURE);
    rows.push({ w, view: 'layout-editor', ...s });
    if (w === 1184) await shot('t57-01-editor-1184.png');
    if (w === 894) await shot('t57-01-editor-894.png');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await wait(800);
  phases.widths = rows;
  info('两宽度零滚动（原始）', JSON.stringify(rows));
  check(
    'G9-1 §2：1184/894 两宽度、两种视图均零滚动（纵向 + 横向）且侧栏 top 恒 0',
    rows.every((r) => r.winScrollH <= r.winClientH + 1 && r.winScrollW <= r.winClientW + 1 && r.sideTop === 0),
    rows.map((r) => `${String(r.w)}/${r.view}:{h ${String(r.winScrollH)}/${String(r.winClientH)},w ${String(r.winScrollW)}/${String(r.winClientW)},top=${String(r.sideTop)}}`).join(' '),
  );

  // --- G10 i18n：English 下面板/编辑器文案 ----------------------------------
  STEP = 'G10|i18n-en';
  await page.locator('[data-testid="layout-editor-done"]').click({ force: true }).catch(() => {});
  await wait(700);
  await page.evaluate(async () => {
    window.localStorage.setItem('septcats.localePref', 'en-US');
    await window.septcats.settings.patch({ locale: 'en-US' });
  });
  await reload();
  await page.locator('[data-testid="layout-open"]').click({ force: true });
  await wait(800);
  const enPicker = await page.evaluate(() => ({
    title: document.querySelector('.layout-picker__title')?.textContent ?? null,
    hint: document.querySelector('.layout-picker__hint')?.textContent ?? null,
    edit: document.querySelector('[data-testid="layout-picker-edit"]')?.textContent ?? null,
    cardName: document.querySelector('[data-testid="layout-picker-card-notion"] .layout-picker__card-name')?.textContent ?? null,
  }));
  phases.enPicker = enPicker;
  info('English 弹框文案（原始）', JSON.stringify(enPicker));
  check(
    'G10-1 §1.5：English 下弹框全英文（标题/提示/卡片名/编辑入口）',
    (enPicker.title ?? '').includes('Choose a layout') && (enPicker.edit ?? '').includes('Customize') && (enPicker.cardName ?? '') === 'Notion' && (enPicker.hint ?? '').includes('Esc'),
    JSON.stringify(enPicker),
  );
  await shot('t57-01-picker-en.png');
  const winShotEn = await captureWindow(join(SHOTS, 't57-01-window-en-picker.png'));
  check('G10-2 窗口级补充截图（含标题栏 + 原生菜单栏）', winShotEn.size > 0, `bytes=${String(winShotEn.size)} err=${String(winShotEn.err)}`);
  await page.locator('[data-testid="layout-picker-edit"]').click({ force: true });
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="layout-editor"]') !== null), 10000);
  await wait(900);
  const enEditor = await page.evaluate(() => ({
    title: document.querySelector('.layout-editor__title')?.textContent ?? null,
    done: document.querySelector('[data-testid="layout-editor-done"]')?.textContent ?? null,
    reset: document.querySelector('[data-testid="layout-editor-reset"]')?.textContent ?? null,
    crumb: document.querySelector('.sc-shell__crumb')?.textContent ?? null,
    slider: document.querySelector('[data-testid="layout-sidebar-width"]')?.getAttribute('aria-label') ?? null,
  }));
  phases.enEditor = enEditor;
  info('English 编辑器文案（原始）', JSON.stringify(enEditor));
  check(
    'G10-3 §1.5：English 下编辑器页全英文（标题/完成/恢复默认/滑杆名/面包屑）',
    (enEditor.title ?? '').includes('Layout editor') && (enEditor.done ?? '').includes('Done') && (enEditor.reset ?? '').includes('Restore') && (enEditor.slider ?? '').includes('Sidebar width') && (enEditor.crumb ?? '').includes('Layout editor'),
    JSON.stringify(enEditor),
  );
  await shot('t57-01-editor-en.png');
  const finalLayout = await readLayout();
  info('退出前布局存储（原始）', JSON.stringify(finalLayout));

  // --- G11 退出 -------------------------------------------------------------
  boot.quit = await quit(boot.pid, boot.browser);
  check('G11-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
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
  const passes = results.filter((r) => r.ok === true).length;
  const fails = results.filter((r) => r.ok === false).length;
  const payload = {
    task: 'TASK-T57-01 真机取证（布局选择弹框 + 独立布局编辑器）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) 量测/点击/拖动/截图 + Emulation.setDeviceMetricsOverride 两宽度 + main 进程 --inspect desktopCapturer 窗口级补拍',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't57-01-picker-cards.png',
      't57-01-picker-card-notion-zoom.png',
      't57-01-picker-card-focus-zoom.png',
      't57-01-picker-card-workbench-zoom.png',
      't57-01-picker-focus-applied.png',
      't57-01-editor-zh.png',
      't57-01-editor-width300.png',
      't57-01-editor-1184.png',
      't57-01-editor-894.png',
      't57-01-picker-en.png',
      't57-01-window-en-picker.png',
      't57-01-editor-en.png',
    ],
    pass: passes,
    fail: fails,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T57-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
