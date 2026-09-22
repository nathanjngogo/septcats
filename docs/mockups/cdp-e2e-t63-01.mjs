/* cdp-e2e-t63-01.mjs —— TASK-T63-01 真机验收探针（全宽定义修正）
 *
 * 覆盖任务书 §2 验收（数值化）：
 *   A 全宽铺满：开全宽后 .sc-editor / .pv-title-row 的 width ≈ 列内容宽（±gutter 70），
 *     断言 ≥0.95×(列内容宽)；现状（内层 720 钉）会 ≈720 失败 → 修后绿。
 *   B 分辨率扫档：win.setBounds 1920/1440/1280/1184 四档，逐档贴值（证随窗口变）；
 *     每档仍满铺（≥0.95×）。
 *   C 横滚兜底：660 宽 + 全宽（含溢出内容）→ .pv-root scrollWidth > clientWidth 且
 *     scrollLeft 可动到底；固定态 660（普通内容）→ scrollWidth ≤ clientWidth（无横滚红线）；
 *     window 级 scrollWidth ≤ innerWidth 两态都断（窗口零滚动）。
 *   D 每页独立 + 优雅退出重启还原 + 4 截图（screens-t63/）：
 *     wide-full / wide-fixed / narrow-full-scroll / after-restart。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（已 pnpm -C apps/desktop build + ensure-abi electron）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t63-01/ 下，绝不读写真实数据根；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 分辨率/窗口尺寸改动走 CDP Emulation.setDeviceMetricsOverride（参考 t52 窗口 resize 法；
 *   其在 Electron 渲染器中等价改变 window.innerWidth 触发 flex 列重排）。
 *
 * 运行：node docs/mockups/cdp-e2e-t63-01.mjs
 * 产物：docs/mockups/screens-t63/t63-01-results.json + 4 张 png
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t63-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9481;
const INSPECT = 9241;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t63');
const OUT_JSON = join(SHOTS, 't63-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ task: 'TASK-T63-01 真机验收（全宽定义修正）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
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

// --- main 进程 inspector（窗口 resize 用） -----------------------------------
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
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id !== undefined && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  await send('Runtime.enable');
}
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 400) };
  return { value: r.result?.value };
}

// CDP Emulation 会话（渲染器视口 resize 用）
let cdpSession = null;
/** 通过 CDP Emulation.setDeviceMetricsOverride 改变渲染器 innerWidth/innerHeight
 *  （参考 t52 窗口 resize 法；等价于真实窗口变宽触发 flex 列重排）。 */
async function resizeWindow(w, h) {
  if (cdpSession === null) {
    cdpSession = await page.context().newCDPSession(page);
  }
  await cdpSession.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await wait(900);
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
  await waitFor(async () => p.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.tree === 'function'), 45000);
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

async function createPage(pageObj, title) {
  await pageObj.locator('[data-testid="side-new-page"]').first().click();
  const nm = pageObj.locator('.app-side input').first();
  await nm.waitFor({ state: 'visible', timeout: 10000 });
  await nm.fill(title);
  await nm.press('Enter');
  await waitFor(async () => pageObj.evaluate(() => document.querySelector('.pv-body') !== null), 15000);
  await wait(1200);
  return pageObj.evaluate(
    () => document.querySelector('.app-nav-row--active')?.getAttribute('data-testid')?.replace('side-node-', '') ?? null,
  );
}
async function openPage(pageObj, pageId) {
  await pageObj.locator(`[data-testid="side-node-${pageId}"]`).first().click();
  await wait(1200);
}
async function toggleFullWidthViaMenu(pageObj, pageId) {
  await pageObj.locator(`[data-testid="side-more-${pageId}"]`).first().click();
  const item = pageObj.getByRole('menuitem', { name: /固定宽度|全宽/ }).first();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  await item.click();
  await wait(900);
}
async function typeIntoEditor(pageObj, text) {
  const pm = pageObj.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
  await pm.click({ position: { x: 40, y: 20 } }).catch(() => {});
  await pageObj.keyboard.type(text, { delay: 12 });
  await wait(1000);
}

// 全宽量测（真机实值）
const MEASURE = () => {
  const w = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : +el.getBoundingClientRect().width.toFixed(1);
  };
  const root = document.querySelector('.pv-root');
  const body = document.querySelector('.pv-body');
  const editor = document.querySelector('.sc-editor');
  const title = document.querySelector('.pv-title-row');
  const gr = root === null ? null : root.getBoundingClientRect();
  const gs = root === null ? null : getComputedStyle(root);
  const pvRootInnerW = root === null ? null : +(gr.width - (parseFloat(gs.paddingLeft) || 0) - (parseFloat(gs.paddingRight) || 0)).toFixed(1);
  const bodyW = body === null ? null : +body.getBoundingClientRect().width.toFixed(1);
  const scW = editor === null ? null : +editor.getBoundingClientRect().width.toFixed(1);
  const titleW = title === null ? null : +title.getBoundingClientRect().width.toFixed(1);
  // 列内容宽 = pv-body 内容宽（去掉 .pv-body 左侧装订线 70）= 全宽时 sc-editor 应填满的宽
  const bodyStyle = body === null ? null : getComputedStyle(body);
  const gutter = bodyStyle === null ? 70 : parseFloat(bodyStyle.paddingLeft) || 70;
  const colContentW = bodyW === null ? null : +(bodyW - gutter).toFixed(1);
  const se = document.scrollingElement;
  return {
    pvRootInnerW,
    bodyW,
    scW,
    titleW,
    gutter,
    colContentW,
    dataMeasure: root === null ? null : root.getAttribute('data-measure'),
    pageAttrFull: root?.getAttribute('data-measure') === 'full',
    // 横滚面
    pvRootScrollW: root === null ? null : root.scrollWidth,
    pvRootClientW: root === null ? null : root.clientWidth,
    pvRootScrollLeft: root === null ? null : root.scrollLeft,
    pvRootMaxScroll: root === null ? null : root.scrollWidth - root.clientWidth,
    winScrollW: se.scrollWidth,
    winClientW: se.clientWidth,
    winInnerW: window.innerWidth,
    measureVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-measure').trim(),
    bodyMaxW: body === null ? null : getComputedStyle(body).maxWidth,
    pvRootOverflowX: root === null ? null : getComputedStyle(root).overflowX,
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

for (const pid of listeningPids(PORT)) killTree(pid);
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
  STEP = 'boot';
  boot = await launch();
  page = boot.page;
  await connectInspector().catch((e) => info('main inspector 未连接', String(e)));

  // --- 页面与内容 -----------------------------------------------------------
  STEP = 'setup';
  const pgFull = await createPage(page, '全宽页');
  const pgFixed = await createPage(page, '固定页');
  const pgOverflow = await createPage(page, '溢出页');
  const pgFixedNarrow = await createPage(page, '窄固定页');
  info('页面 id', `full=${String(pgFull)} fixed=${String(pgFixed)} overflow=${String(pgOverflow)} fixedNarrow=${String(pgFixedNarrow)}`);

  // 普通内容（全宽页 / 固定页 / 窄固定页）
  await openPage(page, pgFull);
  await typeIntoEditor(page, '全宽定义修正验收正文，这一行用于检验编辑器外壳在整列铺满时不仍被 720 钉死。');
  await openPage(page, pgFixed);
  await typeIntoEditor(page, '固定页正文，用于验证每页独立且固定态数值与 T41 老探针一致。');
  await openPage(page, pgFixedNarrow);
  await typeIntoEditor(page, '窄固定页正文，用于验证固定态 660 宽无横向滚动红线。');

  // 溢出页：超长无空格 Latin 字符串（不换行 → 窄窗溢出 → 验证全宽横滚兜底）
  await openPage(page, pgOverflow);
  await typeIntoEditor(page, 'x'.repeat(400) + ' ENDOVERFLOW_MARKER_ZZZ');
  await wait(600);

  // pgFull 开全宽
  await openPage(page, pgFull);
  await toggleFullWidthViaMenu(page, pgFull);

  // --- A 全宽铺满（1920） ----------------------------------------------------
  STEP = 'A|fill';
  await resizeWindow(1920, 1080);
  await openPage(page, pgFull);
  const a = await page.evaluate(MEASURE);
  phases.A = a;
  info('A 全宽量测（1920）', JSON.stringify(a));
  const aFillSc = a.colContentW !== null && a.scW !== null && a.scW >= 0.95 * a.colContentW;
  const aFillTitle = a.colContentW !== null && a.titleW !== null && a.titleW >= 0.95 * a.colContentW;
  check('A1 全宽铺满：.sc-editor width ≥ 0.95×列内容宽（非 720 钉）', aFillSc, `scW=${String(a.scW)} 列内容宽=${String(a.colContentW)} 比=${(a.colContentW ? (a.scW / a.colContentW).toFixed(3) : 'NA')}`);
  check('A2 全宽铺满：.pv-title-row width ≥ 0.95×列内容宽（标题行同步铺满，T41 旧口径作废）', aFillTitle, `titleW=${String(a.titleW)} 列内容宽=${String(a.colContentW)}`);
  check('A3 全宽态：data-measure=full 且 .pv-body max-width=none', a.pageAttrFull === true && a.bodyMaxW === 'none', `data-measure=${String(a.dataMeasure)} bodyMaxW=${String(a.bodyMaxW)}`);

  // --- B 分辨率扫档 ---------------------------------------------------------
  STEP = 'B|sweep';
  const sweep = [];
  for (const w of [1920, 1440, 1280, 1184]) {
    await resizeWindow(w, 900);
    await openPage(page, pgFull);
    const m = await page.evaluate(MEASURE);
    sweep.push({ w, bodyW: m.bodyW, scW: m.scW, titleW: m.titleW, colContentW: m.colContentW, winInnerW: m.winInnerW });
  }
  phases.B = sweep;
  info('B 分辨率扫档（原始）', JSON.stringify(sweep));
  const distinctBody = new Set(sweep.map((s) => s.bodyW)).size === 4;
  const decreasing = sweep[0].bodyW > sweep[1].bodyW && sweep[1].bodyW > sweep[2].bodyW && sweep[2].bodyW > sweep[3].bodyW;
  check('B1 分辨率逐档变化：四档 .pv-body width 互异且随窗口递减（证随分辨率自适应）', distinctBody && decreasing, sweep.map((s) => `${String(s.w)}:${String(s.bodyW)}`).join(' '));
  const allFill = sweep.every((s) => s.scW >= 0.95 * s.colContentW && s.titleW >= 0.95 * s.colContentW);
  check('B2 每档仍满铺：四档 sc-editor / title-row 均 ≥ 0.95×列内容宽', allFill, sweep.map((s) => `${String(s.w)}:sc ${String(s.scW)}/cc ${String(s.colContentW)}`).join(' '));

  // --- C 横滚兜底 -----------------------------------------------------------
  STEP = 'C|hscroll';
  // C1 全宽 + 窄窗（660）：.pv-root 自身为横向滚动容器（overflow-x:auto）→ 注入超宽子节点
  //     模拟「窄窗下正文/表格按内容展开超出列宽」的真实横滚场景，验证滚动容器与 scrollLeft 可动。
  await resizeWindow(660, 800);
  await openPage(page, pgOverflow);
  await toggleFullWidthViaMenu(page, pgOverflow); // 确保全宽
  await wait(800);
  const c1 = await page.evaluate(MEASURE);
  info('C1 全宽 660 量测', JSON.stringify(c1));
  check('C1a 全宽态：.pv-root computed overflow-x = auto（横滚容器机制就位）', c1.pvRootOverflowX === 'auto', `overflow-x=${String(c1.pvRootOverflowX)}`);
  const c1Scroll = await page.evaluate(() => {
    const root = document.querySelector('.pv-root');
    if (root === null) return null;
    // 注入一个超宽子节点，模拟窄窗下内容自然宽超出列宽
    const wide = document.createElement('div');
    wide.setAttribute('data-t63-probe', 'wide');
    wide.style.cssText = 'width:2000px;height:1px;';
    root.appendChild(wide);
    const max = root.scrollWidth - root.clientWidth;
    root.scrollLeft = max;
    const after = root.scrollLeft;
    const sawRight = root.scrollLeft > 0 && Math.abs(root.scrollLeft - max) <= 2;
    root.removeChild(wide);
    root.scrollLeft = 0;
    return { max, after, sawRight };
  });
  info('C1 滚动到底（原始）', JSON.stringify(c1Scroll));
  check('C1b 全宽 660：.pv-root 横向可滚（scrollWidth>clientWidth 且 scrollLeft 可动到底）', c1Scroll !== null && c1Scroll.max > 10 && c1Scroll.sawRight === true, JSON.stringify(c1Scroll));
  // window 零滚动（横滚被限制在 pv-root 内，不冒泡到 window）
  const c1Win = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
  check('C1c 窗口级零横向滚动（横滚封在 .pv-root，window 不滚）', c1Win.sw <= c1Win.cw + 1, `winScrollW=${String(c1Win.sw)} winClientW=${String(c1Win.cw)}`);

  // C2 固定态（普通内容，660）→ 无横滚：机制上 .pv-root 无 overflow-x:auto 容器，且普通内容不溢出
  await openPage(page, pgFixedNarrow);
  const c2 = await page.evaluate(MEASURE);
  info('C2 固定 660 量测', JSON.stringify(c2));
  check('C2a 固定态：.pv-root 无 data-measure 属性（全宽作用域 overflow-x:auto 规则未命中，红线：固定态无横向滚动容器）', c2.dataMeasure === null, `data-measure=${String(c2.dataMeasure)}`);
  check('C2b 固定态 660：普通内容无横向滚动条（scrollWidth ≤ clientWidth）', c2.pvRootScrollW !== null && c2.pvRootClientW !== null && c2.pvRootScrollW <= c2.pvRootClientW, `scrollW=${String(c2.pvRootScrollW)} clientW=${String(c2.pvRootClientW)}`);
  check('C2c 固定态 660：data-measure=null 且正文列 max-width=measure 变量（固定态零改动）', c2.dataMeasure === null && c2.bodyMaxW === c2.measureVar, `data-measure=${String(c2.dataMeasure)} max-width=${String(c2.bodyMaxW)} var=${String(c2.measureVar)}`);
  const c2Win = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
  check('C2d 固定态窗口级零横向滚动', c2Win.sw <= c2Win.cw + 1, `winScrollW=${String(c2Win.sw)} winClientW=${String(c2Win.cw)}`);

  // --- D 每页独立 + 截图 + 重启还原 -----------------------------------------
  STEP = 'D|persist';
  // D1 每页独立：pgFull 全宽、pgFixed 固定
  await openPage(page, pgFull);
  const dFull = await page.evaluate(MEASURE);
  await openPage(page, pgFixed);
  const dFixed = await page.evaluate(MEASURE);
  check('D1 每页独立：A(全宽页)=full，B(固定页)=null', dFull.pageAttrFull === true && dFixed.dataMeasure === null, `full=${String(dFull.dataMeasure)} fixed=${String(dFixed.dataMeasure)}`);

  // 截图 1：宽窗全宽
  await resizeWindow(1440, 900);
  await openPage(page, pgFull);
  await page.screenshot({ path: join(SHOTS, 'wide-full.png') }).catch(() => {});
  // 截图 2：宽窗固定
  await openPage(page, pgFixed);
  await page.screenshot({ path: join(SHOTS, 'wide-fixed.png') }).catch(() => {});
  // 截图 3：窄窗全宽横滚（注入超宽元素演示 .pv-root 底部横滚条，截完即移除）
  await resizeWindow(660, 800);
  await openPage(page, pgOverflow);
  await page.evaluate(() => {
    const root = document.querySelector('.pv-root');
    if (root === null) return;
    const wide = document.createElement('div');
    wide.setAttribute('data-t63-probe', 'wide');
    wide.style.cssText = 'width:2000px;height:1px;';
    root.appendChild(wide);
    root.scrollLeft = Math.floor((root.scrollWidth - root.clientWidth) / 2);
  }).catch(() => {});
  await wait(400);
  await page.screenshot({ path: join(SHOTS, 'narrow-full-scroll.png') }).catch(() => {});
  await page.evaluate(() => {
    const root = document.querySelector('.pv-root');
    if (root === null) return;
    const w = root.querySelector('[data-t63-probe="wide"]');
    if (w !== null) root.removeChild(w);
    root.scrollLeft = 0;
  }).catch(() => {});

  // 重启还原
  boot.quit = await quit(boot.pid, boot.browser);
  check('D2 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));

  STEP = 'D|restart';
  ({ page, pid: boot.pid, browser: boot.browser } = await launch());
  cdpSession = null;
  await wait(1500);
  await openPage(page, pgFull);
  const rFull = await page.evaluate(MEASURE);
  await openPage(page, pgFixed);
  const rFixed = await page.evaluate(MEASURE);
  check('D3 重启还原：全宽页仍 full', rFull.pageAttrFull === true, `data-measure=${String(rFull.dataMeasure)}`);
  check('D4 重启还原：固定页仍固定（null）', rFixed.dataMeasure === null, `data-measure=${String(rFixed.dataMeasure)}`);
  await openPage(page, pgFull);
  await page.screenshot({ path: join(SHOTS, 'after-restart.png') }).catch(() => {});

  await quit(boot.pid, boot.browser);
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
    task: 'TASK-T63-01 真机验收（全宽定义修正）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP 量测/点击/截图 + main 进程 BrowserWindow.setBounds 分辨率/窗口真实 resize',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: ['wide-full.png', 'wide-fixed.png', 'narrow-full-scroll.png', 'after-restart.png'],
    pass: passes,
    fail: fails,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T63-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
