/* cdp-e2e-t52-01.mjs —— TASK-T52-01 真机取证（布局融合三件）
 *
 * 范围（对应任务书 §1①②③④ + §2①②③④⑤ + T33/T36 红线复验）：
 *   G0 夹具自检：独立夹具真点「新建页面」×3 → 3 标签 / 3 存活页；
 *   G1 §2① 侧栏通高：.app-side 顶端 = 内容区第 0 行（原生菜单下沿，窗口 chrome 高 > 0 佐证）、
 *      通高（height ≈ innerHeight）、顶栏左缘 = 侧栏右缘（不再通栏横切）、
 *      编辑器视图顶栏自带折叠钮被 .app-shell--fused 隐藏（display:none）；
 *   G2 §2② 折叠钮位置：钮中心 x ∈ [tabsBar.left, tabsBar.left+64] 且 |Δy(行中心)| ≤ 2
 *      （附带报「与活动标签中心」差值仅供参考）；
 *   G3 §2③ 融合无缝：.tabsbar / 活动标签 border-bottom = 0；活动标签 computed 背景 = .pv-root
 *      背景（贴色值）；非活动标签 = surface；活动标签下缘正下方 elementFromPoint 命中正文
 *      （无隔离带元素）；
 *   G4 §2④ 四宽度（1280/900/760/640）窗口零滚动 + 横向不滚 + 侧栏 top 恒 0；
 *   G5 §2⑤ 收起 = 0px（.sc-shell__sidebar 宽 0 / display:none / 主区占满），
 *      且**收起态的钮仍在视口内**（T30-01 可达性红线），再点即展开；
 *   G6 T33/T36 红线复验：.pv-body 装订线 70px、手柄簇↔文本 gutter = 12、overlap=false；
 *   G7 双主题（浅/深）× 三态（有标签 / 无标签 / 侧栏收起）6 张截图 + 1 张窗口级补充
 *      （含原生菜单栏，证明侧栏顶到菜单下沿）。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t52-01/ 下，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口，窗口级截图经 main 进程 --inspect 调公开 API（不改产品代码）。
 *
 * 运行：node docs/mockups/cdp-e2e-t52-01.mjs
 * 产物：docs/mockups/screens-t52/t52-01-results.json + 7 张 png
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t52-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9475;
const INSPECT = 9235;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t52');
const OUT_JSON = join(SHOTS, 't52-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const LAYOUT_KEY = 'septcats.layout';
const WIDTHS = [1280, 900, 760, 640];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T52-01 真机取证（布局融合三件：侧栏通高 / 折叠钮搬家 / 标签条并入编辑区）',
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
async function setThemeAndReload(theme) {
  await page.evaluate((t) => window.localStorage.setItem('septcats.theme', t), theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? document.documentElement.className);
}
const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => {});
/** 局部放大截图（dsf=3）：给 PM 目检标签行融合细节用（不改任何布局量测）。 */
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

/** §2① 侧栏通高 + 顶栏只覆盖右侧的量测。 */
const FUSION_MEASURE = () => {
  const side = document.querySelector('.app-side');
  const aside = document.querySelector('.sc-shell__sidebar');
  const topbar = document.querySelector('.sc-shell__topbar');
  const sr = side.getBoundingClientRect();
  const ar = aside.getBoundingClientRect();
  const tr = topbar.getBoundingClientRect();
  const shellBtn = topbar.querySelector('.sc-iconbtn');
  return {
    sideTop: +sr.top.toFixed(1),
    sideLeft: +sr.left.toFixed(1),
    sideHeight: +sr.height.toFixed(1),
    asideTop: +ar.top.toFixed(1),
    asideWidth: +ar.width.toFixed(1),
    topbarLeft: +tr.left.toFixed(1),
    topbarRight: +tr.right.toFixed(1),
    topbarTop: +tr.top.toFixed(1),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    outerHeight: window.outerHeight,
    outerWidth: window.outerWidth,
    nativeChromeH: Math.round(window.outerHeight - window.innerHeight),
    shellBtnDisplay: shellBtn === null ? '(absent)' : getComputedStyle(shellBtn).display,
  };
};

/** §2② 折叠钮位置量测。 */
const TOGGLE_MEASURE = () => {
  const btn = document.querySelector('[data-testid="side-toggle"]');
  const bar = document.querySelector('.tabsbar');
  const active = document.querySelector('.tabsbar-tab--active');
  if (btn === null || bar === null) return null;
  const b = btn.getBoundingClientRect();
  const r = bar.getBoundingClientRect();
  const a = active === null ? null : active.getBoundingClientRect();
  return {
    btnCenterX: +(b.left + b.width / 2).toFixed(1),
    btnCenterY: +(b.top + b.height / 2).toFixed(1),
    btnW: +b.width.toFixed(1),
    barLeft: +r.left.toFixed(1),
    barRight: +r.right.toFixed(1),
    barCenterY: +(r.top + r.height / 2).toFixed(1),
    barTop: +r.top.toFixed(1),
    barHeight: +r.height.toFixed(1),
    activeCenterY: a === null ? null : +(a.top + a.height / 2).toFixed(1),
    inViewport: b.left >= -1 && b.top >= -1 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1,
  };
};

/** §2③ 融合贴合：色值 + 分隔线 + 下缘命中。 */
const FUSION_COLORS = () => {
  const bar = document.querySelector('.tabsbar');
  const active = document.querySelector('.tabsbar-tab--active');
  const inactive = [...document.querySelectorAll('.tabsbar-tab')].find((el) => !el.className.includes('--active'));
  const pv = document.querySelector('.pv-root');
  const barStyle = getComputedStyle(bar);
  const aStyle = active === null ? null : getComputedStyle(active);
  const ar = active === null ? null : active.getBoundingClientRect();
  const br = bar.getBoundingClientRect();
  let belowActive = null;
  if (ar !== null) {
    const x = ar.left + ar.width / 2;
    const hit = document.elementFromPoint(x, br.bottom + 1);
    belowActive = hit === null ? null : `${hit.className || hit.tagName}`.slice(0, 60);
  }
  return {
    barBg: barStyle.backgroundColor,
    barBorderBottom: barStyle.borderBottomWidth,
    activeBg: aStyle === null ? null : aStyle.backgroundColor,
    activeBorderBottom: aStyle === null ? null : aStyle.borderBottomWidth,
    inactiveBg: inactive === undefined ? null : getComputedStyle(inactive).backgroundColor,
    pvBg: pv === null ? null : getComputedStyle(pv).backgroundColor,
    pvTop: pv === null ? null : +pv.getBoundingClientRect().top.toFixed(1),
    barBottom: +br.bottom.toFixed(1),
    belowActive,
  };
};

/** §2④ 零滚动 + 侧栏 top 恒 0。 */
const SCROLL_MEASURE = () => {
  const se = document.scrollingElement;
  const side = document.querySelector('.app-side');
  return {
    winScrollH: se.scrollHeight,
    winClientH: se.clientHeight,
    winScrollW: se.scrollWidth,
    winClientW: se.clientWidth,
    sideTop: side === null ? null : +side.getBoundingClientRect().top.toFixed(1),
    sidebarW: +(document.querySelector('.sc-shell__sidebar')?.getBoundingClientRect().width ?? -1).toFixed(1),
  };
};

/** §2⑤ 收起态。 */
const COLLAPSED_MEASURE = () => {
  const aside = document.querySelector('.sc-shell__sidebar');
  const side = document.querySelector('.app-side');
  const main = document.querySelector('.sc-shell__main');
  const topbar = document.querySelector('.sc-shell__topbar');
  const btn = document.querySelector('[data-testid="side-toggle"]');
  const b = btn === null ? null : btn.getBoundingClientRect();
  const mr = main.getBoundingClientRect();
  const tr = topbar.getBoundingClientRect();
  return {
    sidebarW: aside === null ? null : aside.getBoundingClientRect().width,
    sidebarDisplay: aside === null ? null : getComputedStyle(aside).display,
    appSideVisible: side !== null && side.getClientRects().length > 0,
    mainW: +mr.width.toFixed(1),
    mainLeft: +mr.left.toFixed(1),
    topbarLeft: +tr.left.toFixed(1),
    topbarRight: +tr.right.toFixed(1),
    winW: window.innerWidth,
    btnRect: b === null ? null : { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
    btnInViewport: b !== null && b.left >= -1 && b.top >= -1 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1,
  };
};

/** T33/T36 红线：装订线 70px + gutter = 12。 */
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
    const textLeft = br.left + parseFloat(st.paddingLeft || '0') + parseFloat(st.borderLeftWidth || '0');
    return {
      bodyPaddingLeft: getComputedStyle(body).paddingLeft,
      gutter: +(textLeft - cr.right).toFixed(1),
      overlap: textLeft < cr.right,
      clusterW: +cr.width.toFixed(1),
      clusterH: +cr.height.toFixed(1),
    };
  });
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
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  }
  const tabs0 = await tabCount();
  const pages0 = await pageCount();
  check('G0-1 夹具成立：真点「新建页面」×3 → 3 标签 / 3 存活页', tabs0 === 3 && pages0 === 3, `tabs=${String(tabs0)} pages=${String(pages0)}`);

  // --- G1 §2① 侧栏通高 / 顶栏不再通栏 ---------------------------------------
  STEP = 'G1|sidebar-full-height';
  const m1 = await page.evaluate(FUSION_MEASURE);
  phases.fusion = m1;
  info('融合量测（原始）', JSON.stringify(m1));
  check(
    'G1-1 §2①：.app-side / .sc-shell__sidebar 顶端 = 内容区第 0 行（原生菜单下沿；窗口 chrome 高 > 0 佐证菜单在 y<0）',
    m1.sideTop === 0 && m1.asideTop === 0 && m1.nativeChromeH > 0,
    `sideTop=${String(m1.sideTop)} asideTop=${String(m1.asideTop)} nativeChromeH=${String(m1.nativeChromeH)}（outerH ${String(m1.outerHeight)} − innerH ${String(m1.innerHeight)}）`,
  );
  check(
    'G1-2 侧栏通高：高度 ≈ 内容区高（不再被顶栏压掉 40px）',
    Math.abs(m1.sideHeight - m1.innerHeight) <= 1,
    `sideHeight=${String(m1.sideHeight)} innerHeight=${String(m1.innerHeight)}`,
  );
  check(
    'G1-3 §2①：顶栏左缘 = 侧栏右缘（只覆盖右侧，不再通栏横切侧栏上方）',
    Math.abs(m1.topbarLeft - m1.asideWidth) <= 1 && m1.topbarLeft > 0,
    `topbarLeft=${String(m1.topbarLeft)} sidebarW=${String(m1.asideWidth)} topbarRight=${String(m1.topbarRight)} winW=${String(m1.innerWidth)}`,
  );
  check(
    'G1-4 编辑器视图：顶栏自带折叠钮被 .app-shell--fused 隐藏（display:none，唯一入口在标签行）',
    m1.shellBtnDisplay === 'none',
    `display=${String(m1.shellBtnDisplay)}`,
  );

  // --- G2 §2② 折叠钮位置 -----------------------------------------------------
  STEP = 'G2|toggle-position';
  const m2 = await page.evaluate(TOGGLE_MEASURE);
  phases.toggle = m2;
  info('折叠钮量测（原始）', JSON.stringify(m2));
  check(
    'G2-1 §2②：钮中心 x ∈ [标签条左, 标签条左+64] 且钮 = 24px 图标位（§1.2）',
    m2 !== null && m2.btnCenterX >= m2.barLeft && m2.btnCenterX <= m2.barLeft + 64 && m2.btnW === 24,
    m2 === null ? 'NULL' : `btnCenterX=${String(m2.btnCenterX)} barLeft=${String(m2.barLeft)} barRight=${String(m2.barRight)} btnW=${String(m2.btnW)}`,
  );
  check(
    'G2-2 §2②：钮中心 y 与标签条行中心差 ≤ 2px',
    m2 !== null && Math.abs(m2.btnCenterY - m2.barCenterY) <= 2,
    m2 === null ? 'NULL' : `btnCenterY=${String(m2.btnCenterY)} barCenterY=${String(m2.barCenterY)} Δ=${(Math.abs(m2.btnCenterY - m2.barCenterY)).toFixed(1)}`,
  );
  info(
    '参考：钮中心 y 与活动标签中心差（标签底对齐，非验收项）',
    m2 === null ? 'NULL' : `btnCenterY=${String(m2.btnCenterY)} activeCenterY=${String(m2.activeCenterY)} Δ=${(Math.abs(m2.btnCenterY - (m2.activeCenterY ?? 0))).toFixed(1)}`,
  );

  // --- G3 §2③ 融合无缝 -------------------------------------------------------
  STEP = 'G3|fusion';
  const m3 = await page.evaluate(FUSION_COLORS);
  phases.colors = m3;
  info('融合色值/分隔线（原始）', JSON.stringify(m3));
  check(
    'G3-1 §2③：标签行与活动标签底边均无分隔线（border-bottom-width = 0）',
    m3.barBorderBottom === '0px' && m3.activeBorderBottom === '0px',
    `barBorderBottom=${String(m3.barBorderBottom)} activeBorderBottom=${String(m3.activeBorderBottom)}`,
  );
  check(
    'G3-2 §2③：活动标签背景 = .pv-root 背景（连通无缝，贴色值）',
    m3.activeBg !== null && m3.activeBg === m3.pvBg,
    `activeBg=${String(m3.activeBg)} pvBg=${String(m3.pvBg)} barBg=${String(m3.barBg)} inactiveBg=${String(m3.inactiveBg)}`,
  );
  check(
    'G3-3 非活动标签沉 surface（≠ 活动标签色、≠ 行底色）',
    m3.inactiveBg !== null && m3.inactiveBg !== m3.activeBg && m3.inactiveBg !== m3.barBg,
    `inactiveBg=${String(m3.inactiveBg)} activeBg=${String(m3.activeBg)} barBg=${String(m3.barBg)}`,
  );
  check(
    'G3-4 §2③：活动标签下缘正下方 elementFromPoint 命中正文容器（活动列「冒泡」进编辑区，无隔离带元素）',
    m3.belowActive !== null && m3.belowActive.includes('pv-root'),
    `belowActive="${String(m3.belowActive)}" barBottom=${String(m3.barBottom)} pvTop=${String(m3.pvTop)}`,
  );
  await shot('t52-01-light-tabs.png');
  const activeInfo = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tabsbar-tab')];
    return {
      count: tabs.length,
      activeIndex: tabs.findIndex((el) => el.className.includes('--active')),
      activeText: tabs.find((el) => el.className.includes('--active'))?.textContent ?? null,
    };
  });
  info('活动标签（原始）', JSON.stringify(activeInfo));

  // --- G4 §2④ 四宽度零滚动 ---------------------------------------------------
  STEP = 'G4|four-widths';
  const cdp = await page.context().newCDPSession(page);
  const widths = [];
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(700);
    const s = await page.evaluate(SCROLL_MEASURE);
    widths.push({ w, ...s });
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await wait(700);
  phases.widths = widths;
  info('四宽度零滚动（原始）', JSON.stringify(widths));
  check(
    'G4-1 §2④：1280/900/760/640 四宽度窗口均零滚动（纵向 + 横向）',
    widths.every((x) => x.winScrollH <= x.winClientH + 1 && x.winScrollW <= x.winClientW + 1),
    widths.map((x) => `${String(x.w)}:{h ${String(x.winScrollH)}/${String(x.winClientH)},w ${String(x.winScrollW)}/${String(x.winClientW)}}`).join(' '),
  );
  check(
    'G4-2 §2④：四宽度下侧栏顶端恒为 0（通高不随窗口尺寸退化）',
    widths.every((x) => x.sideTop === 0),
    widths.map((x) => `${String(x.w)}:top=${String(x.sideTop)}`).join(' '),
  );

  // --- G5 §2⑤ 收起 = 0px（且钮仍可达） ---------------------------------------
  STEP = 'G5|collapsed';
  await page.locator('[data-testid="side-toggle"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  const c1 = await page.evaluate(COLLAPSED_MEASURE);
  phases.collapsed = c1;
  info('收起态量测（原始）', JSON.stringify(c1));
  check(
    'G5-1 §2⑤：收起后 .sc-shell__sidebar 宽度 = 0 且 display:none、.app-side 不可见、主区占满（T30-01 红线）',
    c1.sidebarW === 0 && c1.sidebarDisplay === 'none' && c1.appSideVisible === false && Math.abs(c1.mainW - c1.winW) <= 1,
    `width=${String(c1.sidebarW)} display=${String(c1.sidebarDisplay)} appSideVisible=${String(c1.appSideVisible)} mainW=${String(c1.mainW)} winW=${String(c1.winW)}`,
  );
  check(
    'G5-1b 收起后顶栏同步占满（grid-column 回第 1 列；防「隐式列」把主区挤窄）',
    Math.abs(c1.topbarLeft - 0) <= 1 && Math.abs(c1.topbarRight - c1.winW) <= 1,
    `topbarLeft=${String(c1.topbarLeft)} topbarRight=${String(c1.topbarRight)} winW=${String(c1.winW)} mainLeft=${String(c1.mainLeft)}`,
  );
  check(
    'G5-2 收起态钮仍可达：仍在视口内（编辑区左上），点击可再展开',
    c1.btnInViewport === true,
    `btnRect=${JSON.stringify(c1.btnRect)} inViewport=${String(c1.btnInViewport)}`,
  );
  await shot('t52-01-light-collapsed.png');
  await page.locator('[data-testid="side-toggle"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  const c2 = await page.evaluate(COLLAPSED_MEASURE);
  check(
    'G5-3 再点同一钮可展开（侧栏宽度恢复 ≈ 240）',
    c2.sidebarW !== null && c2.sidebarW > 100,
    `width=${String(c2.sidebarW)} display=${String(c2.sidebarDisplay)}`,
  );

  // --- G6 T33/T36 红线复验 ---------------------------------------------------
  STEP = 'G6|gutter';
  // 夹具：真键入两段正文（T33 手柄簇只在有块时渲染；与 T30/T41 探针同法）
  const editorBody = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
  await editorBody.click({ force: true }).catch(() => {});
  await page.keyboard.type('T52 装订线复验第一段').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.keyboard.type('T52 装订线复验第二段').catch(() => {});
  await wait(1600);
  const g = await measureGutter();
  phases.gutter = g;
  info('装订线量测（原始）', JSON.stringify(g));
  check(
    'G6-1 T33 红线：.pv-body 左侧装订线 = 70px（28+2+28+12 token 派生）',
    g !== null && g.bodyPaddingLeft === '70px',
    `bodyPaddingLeft=${String(g?.bodyPaddingLeft)}`,
  );
  check(
    'G6-2 T33/T36 红线：手柄簇右缘 ↔ 文本左缘 gutter = 12 且无重叠（overlap=false）',
    g !== null && Math.abs(g.gutter - 12) <= 0.6 && g.overlap === false,
    `gutter=${String(g?.gutter)} overlap=${String(g?.overlap)} cluster=${String(g?.clusterW)}×${String(g?.clusterH)}`,
  );

  // --- G7 双主题 × 三态 6 截图 ----------------------------------------------
  STEP = 'G7|screens';
  // 浅色 · 无标签（布局隐藏标签条：行与折叠钮仍在 → 收起态钮不丢）
  await patchLayout({ tabsVisible: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  const noTabs = await page.evaluate(() => ({
    tabsbar: document.querySelector('.tabsbar') !== null,
    row: document.querySelector('.app-tabrow') !== null,
    toggle: document.querySelector('[data-testid="side-toggle"]') !== null,
  }));
  await shot('t52-01-light-notabs.png');
  check(
    'G7-1 「无标签」态（布局隐藏标签条）：.tabsbar 不渲染但行宿主与折叠钮仍在（钮不丢）',
    noTabs.tabsbar === false && noTabs.row === true && noTabs.toggle === true,
    JSON.stringify(noTabs),
  );
  await patchLayout({ tabsVisible: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);

  // 窗口级补充截图（含原生菜单栏 → 侧栏顶到菜单下沿）
  const winShot = await captureWindow(join(SHOTS, 't52-01-window-light-full.png'));
  check(
    'G7-2 窗口级补充截图（含标题栏 + 原生菜单栏，侧栏顶到菜单下沿）',
    winShot.size > 0,
    `bytes=${String(winShot.size)} rect=${JSON.stringify(winShot.rect)} err=${String(winShot.err)}`,
  );
  const zoomLight = await shotZoom('t52-01-light-tabrow-zoom.png', { x: 240, y: 40, width: 520, height: 36 });
  info('浅色标签行 3x 放大截图', JSON.stringify(zoomLight));

  // 深色三态
  const themeAttr = await setThemeAndReload('dark');
  info('深色主题属性', String(themeAttr));
  await shot('t52-01-dark-tabs.png');
  await patchLayout({ tabsVisible: false });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  await shot('t52-01-dark-notabs.png');
  await patchLayout({ tabsVisible: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  const darkColors = await page.evaluate(FUSION_COLORS);
  phases.darkColors = darkColors;
  info('深色融合色值（原始）', JSON.stringify(darkColors));
  check(
    'G7-3 深色主题下同样成立：活动标签底 = .pv-root 底、无边线（同一 token 双主题）',
    darkColors.activeBg === darkColors.pvBg && darkColors.barBorderBottom === '0px' && darkColors.activeBorderBottom === '0px',
    `activeBg=${String(darkColors.activeBg)} pvBg=${String(darkColors.pvBg)} barBorder=${String(darkColors.barBorderBottom)}`,
  );
  await page.locator('[data-testid="side-toggle"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  await shot('t52-01-dark-collapsed.png');
  await page.locator('[data-testid="side-toggle"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  const zoomDark = await shotZoom('t52-01-dark-tabrow-zoom.png', { x: 240, y: 40, width: 520, height: 36 });
  info('深色标签行 3x 放大截图', JSON.stringify(zoomDark));
  const finalLayout = await readLayout();
  info('退出前布局存储（原始）', JSON.stringify(finalLayout));

  // --- G8 退出 --------------------------------------------------------------
  boot.quit = await quit(boot.pid, boot.browser);
  check('G8-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
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
    task: 'TASK-T52-01 真机取证（布局融合三件）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) 量测/点击/截图 + Emulation.setDeviceMetricsOverride 四宽度 + main 进程 --inspect desktopCapturer 窗口级补拍',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't52-01-light-tabs.png',
      't52-01-light-notabs.png',
      't52-01-light-collapsed.png',
      't52-01-dark-tabs.png',
      't52-01-dark-notabs.png',
      't52-01-dark-collapsed.png',
      't52-01-window-light-full.png',
      't52-01-light-tabrow-zoom.png',
      't52-01-dark-tabrow-zoom.png',
    ],
    pass: passes,
    fail: fails,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T52-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
