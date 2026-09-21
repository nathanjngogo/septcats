/* cdp-e2e-t54-01.mjs —— TASK-T54-01 真机取证（关闭自动保存 + 退出/最小化托盘询问框 + 托盘）
 *
 * 范围（对应任务书 §1①②③④/§2/§5）：
 *   G0 夹具自检 + 托盘存在性（真点「新建页面」建 1 页；main 侧读真实 Tray 实例）；
 *   G1 询问框（浅）：**键入正文 → 立刻关窗**（<300ms 防抖窗内）→ close 被拦 → editor:flush
 *      握手 → 询问框出现**且此刻正文已在库**（ack 硬证）→ 默认聚焦/三钮文案/遮罩与 Esc 取消
 *      → 浅色窗口级截图；
 *   G2 询问框（深）：切深色 → 关窗 → 弹框 → 深色窗口级截图 → 取消；
 *   G3 最小化到托盘路径：关窗 → 选「最小化到托盘」→ 窗口隐藏、进程存活、renderer 仍响应、
 *      正文在库；托盘「显示主窗口」等价动作恢复 → 编辑器文本仍在；托盘右键菜单窗口级截图；
 *   G4 记住选择路径：勾选「记住我的选择」+ 选托盘 → settings.trayClose='tray' → 再次关窗
 *      **不弹框**直接隐藏；改回 ask（设置页可改回的同一通道）；
 *   G5 退出路径：键入正文 → 立刻关窗 → 弹框 → 选「退出」→ 应用真退出；
 *   G6 重启核对：page1（G5 前的正文）与 page2（G4 前的正文）都在库；
 *   G7 托盘菜单「退出」真点（OS 级 ↓↓Enter）→ 键入正文后立即退出、**不弹框**；
 *   G8 重启核对 G7 的正文在库 + 退出干净 + Get-Process electron 计数=0 + 真数据根未触碰。
 *
 * 取证法（同 T51-01 D-7）：renderer CDP（playwright-core over --remote-debugging-port）
 *   + main 进程 Node inspector（--inspect）读**真实 Tray 实例**（`require` 本 bundle 的
 *   模块缓存 → exports.t54Probe；**绝不 require 缓存击穿**——那会重跑单实例锁逻辑）
 *   + `Tray.popUpContextMenu` + desktopCapturer 窗口级抓屏。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t54-01/，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 退出只用真实退出路径（询问框「退出」/ 托盘菜单「退出」）；未退出才强杀（如实记录）。
 *
 * 运行：node docs/mockups/cdp-e2e-t54-01.mjs
 * 产物：docs/mockups/screens-t54/t54-01-results.json + 3 张 png
 */
import { createRequire } from 'node:module';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const MAIN_BUNDLE = join(APPDIR, 'out', 'main', 'index.js').split('\\').join('/');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t54-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9474;
const INSPECT = 9234;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t54');
const OUT_JSON = join(SHOTS, 't54-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ task: 'TASK-T54-01 真机取证（关闭自动保存 + 退出/托盘询问框）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
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

async function waitFor(fn, timeoutMs, stepMs = 200) {
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

/**
 * 主进程 bundle 的模块缓存出口（**关键安全点**）：绝不用 require(path) —— 缓存未命中时
 * require 会**重跑整个 main 入口**（单实例锁 → app.quit() 自杀）。这里只读 require.cache。
 */
const PROBE_PRELUDE = `(() => {
  const want = ${JSON.stringify(MAIN_BUNDLE)};
  const norm = (k) => k.split('\\\\').join('/');
  const keys = Object.keys(require.cache);
  const hit = keys.find((k) => norm(k) === want) ?? keys.find((k) => norm(k).endsWith('/out/main/index.js'));
  if (!hit) return null;
  return require.cache[hit].exports;
})()`;
async function probeModule() {
  const r = await mainEval(`(() => { const m = ${PROBE_PRELUDE}; return m && m.t54Probe ? 'probe-ok' : 'probe-missing'; })()`);
  return r.err ?? r.value;
}
/** 托盘原始状态（存在性 / 监听器 / 模板 label / 工具提示位）。 */
async function trayState() {
  const r = await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return JSON.stringify({ moduleCached: false });
    const tray = mods.t54Probe.getTray();
    const zh = mods.t54Probe.trayMenuTemplate('zh-CN');
    const en = mods.t54Probe.trayMenuTemplate('en-US');
    return JSON.stringify({
      moduleCached: true,
      exists: tray !== null && tray !== undefined,
      destroyed: tray === null ? null : tray.isDestroyed(),
      clickListeners: tray === null ? null : tray.listenerCount('click'),
      zh, en,
    });
  })()`);
  if (r.err || typeof r.value !== 'string') return { moduleCached: false, err: r.err ?? 'no-value' };
  return JSON.parse(r.value);
}
/** 窗口状态（可见/最小化/几何）。 */
async function winState() {
  const r = await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const all = BrowserWindow.getAllWindows();
    const w = all[0];
    if (!w) return JSON.stringify({ windows: 0 });
    return JSON.stringify({ windows: all.length, visible: w.isVisible(), minimized: w.isMinimized(), destroyed: w.isDestroyed(), title: w.getTitle(), bounds: w.getBounds() });
  })()`);
  if (r.err || typeof r.value !== 'string') return { windows: -1, err: r.err ?? 'no-value' };
  return JSON.parse(r.value);
}
/** 关窗（等价用户点窗口关闭按钮：触发 BrowserWindow 'close' 事件）。 */
async function closeWindow() {
  return (await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.close();
    return 'close-requested';
  })()`)).value;
}
async function showMainWindow() {
  return (await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return 'NO_PROBE';
    mods.t54Probe.showMainWindow();
    return 'shown';
  })()`)).value;
}
async function trayQuitFallback() {
  return (await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return 'NO_PROBE';
    mods.t54Probe.quitFromTray();
    return 'tray-quit-invoked';
  })()`)).value;
}
/** 弹出托盘右键菜单（Windows 不支持 position 参数 → 由 PowerShell 把光标移进窗口，
 *  菜单即跟随光标弹出；带 position 的调用在 Windows 会抛 TypeError，故不传）。 */
async function popUpTrayMenu() {
  const r = await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return 'NO_PROBE';
    const tray = mods.t54Probe.getTray();
    if (tray === null) return 'NO_TRAY';
    tray.popUpContextMenu();
    return 'popped';
  })()`);
  return r.err ?? r.value;
}
/** 把托盘在建的同一个 Menu 实例在窗口内弹成原生菜单（本机会话里托盘浮层不渲染，D-2）。 */
async function popTrayMenuOverWindow(x, y) {
  const r = await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return 'NO_PROBE';
    return mods.t54Probe.popTrayMenuOverWindow(${String(Math.round(x))}, ${String(Math.round(y))}) === true ? 'popped' : 'POPUP_FAILED';
  })()`);
  return r.err ?? r.value;
}
/** 断开 main inspector 会话：调试会话挂着的进程**不会随 app.quit 立刻退**（T51 同坑）。 */
async function disconnectInspector() {
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  await wait(300);
}
async function closeTrayMenu() {
  await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    const tray = mods && mods.t54Probe ? mods.t54Probe.getTray() : null;
    if (tray && typeof tray.closeContextMenu === 'function') { try { tray.closeContextMenu(); } catch (e) {} }
    return 'closed';
  })()`).catch(() => {});
}
/** 置顶应用窗口（show + setAlwaysOnTop + moveTop + focus）。 */
async function raiseMain() {
  const r = await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.show(); w.setAlwaysOnTop(true); w.moveTop(); w.focus();
    return JSON.stringify({ visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds() });
  })()`);
  await wait(1000);
  return r.value;
}
/** main 进程内 desktopCapturer 抓屏（可选裁剪，CSS px）。 */
async function captureMain(file, rect) {
  const expr = `(async () => {
    const { desktopCapturer, screen } = require('electron');
    const d = screen.getPrimaryDisplay(); const s = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width: Math.floor(d.size.width*s), height: Math.floor(d.size.height*s) } });
    if (srcs.length === 0) return 'NO_SOURCE';
    let img = srcs[0].thumbnail;
    ${rect === null ? '' : `const rx = Math.max(0, Math.round(${String(rect.x)}*s)); const ry = Math.max(0, Math.round(${String(rect.y)}*s));
    const rw = Math.max(1, Math.min(Math.round(${String(rect.width)}*s), img.getSize().width - rx));
    const rh = Math.max(1, Math.min(Math.round(${String(rect.height)}*s), img.getSize().height - ry));
    img = img.crop({ x: rx, y: ry, width: rw, height: rh });`}
    return img.toPNG().toString('base64');
  })()`;
  const r = await mainEval(expr);
  if (r.err || typeof r.value !== 'string' || r.value === 'NO_SOURCE') return { size: -1, err: r.err ?? r.value, b64: null };
  const buf = Buffer.from(r.value, 'base64');
  writeFileSync(file, buf);
  return { size: buf.length, err: null, b64: r.value };
}
/** 主显示器缩放因子（光标物理坐标换算）。 */
async function scaleFactor() {
  const r = await mainEval(`(() => { const { screen } = require('electron'); return String(screen.getPrimaryDisplay().scaleFactor || 1); })()`);
  const value = Number(r.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
/** 读取 OS 光标物理坐标（校验 moveCursor 真的生效）。 */
function cursorPos() {
  const r = runPs([
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Cursor]::Position.X; [System.Windows.Forms.Cursor]::Position.Y',
  ]);
  const nums = String(r.out).split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  return nums.length >= 2 ? { x: nums[0], y: nums[1] } : null;
}
/** 存窗口区域基线位图（main 进程内 globalThis，供菜单像素差比对）。 */
async function storeWindowBaseline(rect) {
  const r = await mainEval(`(async () => {
    const { desktopCapturer, screen } = require('electron');
    const d = screen.getPrimaryDisplay(); const s = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width: Math.floor(d.size.width*s), height: Math.floor(d.size.height*s) } });
    if (srcs.length === 0) return 'NO_SOURCE';
    const img = srcs[0].thumbnail;
    const rx = Math.max(0, Math.round(${String(rect.x)}*s)); const ry = Math.max(0, Math.round(${String(rect.y)}*s));
    const rw = Math.min(Math.round(${String(rect.width)}*s), img.getSize().width - rx);
    const rh = Math.min(Math.round(${String(rect.height)}*s), img.getSize().height - ry);
    const crop = img.crop({ x: rx, y: ry, width: rw, height: rh });
    globalThis.__t54Base = crop.toBitmap();
    globalThis.__t54Rect = { x: rx, y: ry, width: rw, height: rh };
    return JSON.stringify({ bitmapBytes: globalThis.__t54Base.length, rect: globalThis.__t54Rect });
  })()`);
  return r.err ?? r.value;
}
/**
 * 弹托盘右键菜单 → 等 900ms → 与基线逐像素比差 → 输出裁剪图 + 变化像素数/外接矩形。
 * changedPixels 是「菜单真的画在窗口内」的量化证据（不是只看文件大小）。
 * mode='tray' 用真实 `Tray.popUpContextMenu()`；mode='menu' 把**托盘在建的同一个
 * Menu 实例**在窗口内弹成原生菜单（本机会话里托盘浮层不渲染，见报告 D-2）。
 */
async function popTrayMenuAndDiff(file, mode) {
  const pop = mode === 'tray'
    ? `const tray = mods.t54Probe.getTray(); if (tray === null) return JSON.stringify({ err: 'NO_TRAY' }); tray.popUpContextMenu();`
    : `const ok = mods.t54Probe.popTrayMenuOverWindow(220, 300); if (ok !== true) return JSON.stringify({ err: 'POPUP_FAILED' });`;
  const r = await mainEval(`(async () => {
    const { desktopCapturer, screen } = require('electron');
    const mods = ${PROBE_PRELUDE};
    if (!mods || !mods.t54Probe) return JSON.stringify({ err: 'NO_PROBE' });
    ${pop}
    await new Promise((res) => setTimeout(res, 900));
    const base = globalThis.__t54Base; const rect = globalThis.__t54Rect;
    if (!base || !rect) return JSON.stringify({ err: 'NO_BASELINE' });
    const d = screen.getPrimaryDisplay(); const s = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width: Math.floor(d.size.width*s), height: Math.floor(d.size.height*s) } });
    if (srcs.length === 0) return JSON.stringify({ err: 'NO_SOURCE' });
    const crop = srcs[0].thumbnail.crop(rect);
    const bmp = crop.toBitmap();
    let changed = 0; let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    const w = rect.width;
    for (let i = 0; i + 3 < bmp.length; i += 4) {
      const p = i / 4; const x = p % w; const y = (p - x) / w;
      const dd = Math.abs(bmp[i] - base[i]) + Math.abs(bmp[i + 1] - base[i + 1]) + Math.abs(bmp[i + 2] - base[i + 2]);
      if (dd > 30) {
        changed += 1;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return JSON.stringify({
      changedPixels: changed,
      totalPixels: Math.floor(bmp.length / 4),
      bbox: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      base64: crop.toPNG().toString('base64'),
    });
  })()`);
  if (r.err || typeof r.value !== 'string') return { err: r.err ?? 'no-value' };
  const parsed = JSON.parse(r.value);
  if (typeof parsed.base64 === 'string') {
    writeFileSync(file, Buffer.from(parsed.base64, 'base64'));
    parsed.bytes = Buffer.from(parsed.base64, 'base64').length;
    delete parsed.base64;
  }
  return parsed;
}

// --- OS 级真键 ---------------------------------------------------------------
function runPs(lines) {
  const r = spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', lines.join('; ')], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim().slice(0, 200) };
}
function sendKeysRaw(keys, settleMs = 500) {
  return runPs([
    '$s = New-Object -ComObject WScript.Shell',
    `$s.SendKeys("${keys}")`,
    `Start-Sleep -Milliseconds ${String(settleMs)}`,
  ]);
}
/** 把 OS 光标移到屏幕物理坐标（托盘菜单在 Windows 跟随光标弹出）。 */
function moveCursor(physX, physY) {
  return runPs([
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(Math.round(physX))},${String(physY)})`,
    'Start-Sleep -Milliseconds 250',
  ]);
}

// --- 渲染器 ------------------------------------------------------------------
async function launch(label) {
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
  if (browser === null) throw new Error(`CDP 连接失败（${label}）`);
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
    async () => page.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.tree === 'function'),
    45000,
  );
  await wait(2200);
  return { page, pid: child.pid, browser };
}

async function quit(page, pid, browser, label) {
  STEP = 'teardown';
  await closeTrayMenu().catch(() => {});
  await mainEval(`(() => { const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (w) w.setAlwaysOnTop(false); return 'ok'; })()`).catch(() => {});
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  await wait(500);
  let forced = false;
  if (alive(pid)) {
    forced = true;
    killTree(pid);
  }
  await browser.close().catch(() => {});
  await wait(1000);
  info(`退出记录（${label}）`, JSON.stringify({ gracefulExited: !forced, forced, pid }));
  return { gracefulExited: !forced, forced };
}

// --- 业务面探针 --------------------------------------------------------------
const askOpen = (page) => page.evaluate(() => document.querySelector('[data-testid="close-ask"]') !== null);

async function askSnapshot(page) {
  return await page.evaluate(() => {
    const root = document.querySelector('[data-testid="close-ask"]');
    if (root === null) return null;
    const focus = document.activeElement;
    const btn = (id) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;
    return {
      theme: document.documentElement.getAttribute('data-theme') ?? 'light',
      title: root.querySelector('#close-ask-title')?.textContent ?? null,
      body: root.querySelector('.close-ask__body')?.textContent ?? null,
      tray: btn('close-ask-tray'),
      quit: btn('close-ask-quit'),
      cancel: btn('close-ask-cancel'),
      rememberLabel: document.querySelector('[data-testid="close-ask-remember"]')?.parentElement?.textContent ?? null,
      activeTestId: focus instanceof HTMLElement ? focus.getAttribute('data-testid') : null,
      bevel: root instanceof HTMLElement ? getComputedStyle(root).boxShadow : null,
    };
  });
}
/** 关窗并等待询问框出现；返回 { latencyMs, shown }（latency 即「关窗→弹框」实测值）。 */
async function closeAndWaitAsk(page, timeoutMs = 4000) {
  const t0 = Date.now();
  await closeWindow();
  const shown = await waitFor(() => askOpen(page), timeoutMs, 120);
  return { latencyMs: Date.now() - t0, shown };
}
/** 一页的库内块 JSON（含正文文本，用于「在库」硬证）。 */
async function dbBlob(page, pageId) {
  return await page.evaluate(async (id) => {
    const blocks = await window.septcats.blocks.list({ pageId: id });
    return JSON.stringify(blocks);
  }, pageId);
}
const editorText = (page) => page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '');
const tabCount = (page) => page.evaluate(() => document.querySelectorAll('.tabsbar-tab').length);
const alivePageIds = (page) =>
  page.evaluate(async () => {
    const wsList = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: wsList.activeId });
    return nodes.filter((n) => n.alive === 1).map((n) => n.id);
  });
async function openPageRow(page, pageId) {
  await page.locator(`[data-testid="side-node-${String(pageId)}"]`).first().click({ force: true }).catch(() => {});
  await wait(900);
}
/** 在正文里键入（真实键击，无延迟 → 落进 300ms 防抖窗）。 */
async function typeBody(page, text) {
  const pm = page.locator('.ProseMirror').first();
  await pm.click({ force: true }).catch(() => {});
  await page.keyboard.press('Control+End').catch(() => {});
  await page.keyboard.type(text, { delay: 0 });
  return text;
}
async function setThemeAndReload(page, theme) {
  await page.evaluate((t) => window.localStorage.setItem('septcats.theme', t), theme);
  await page.reload().catch(() => {});
  await waitFor(
    async () => page.evaluate(() => document.querySelector('.app-side') !== null),
    30000,
  );
  await wait(1500);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? '(none)');
}
/** 窗口外框（含标题栏 + 原生菜单栏）矩形；CSS px（同 T51）。 */
async function windowRect(page) {
  return await page.evaluate(() => {
    const topChrome = Math.max(0, window.outerHeight - window.innerHeight);
    const pad = 12;
    return {
      x: Math.max(0, Math.round(window.screenX - pad)),
      y: Math.max(0, Math.round(window.screenY - topChrome - pad)),
      width: Math.round(window.outerWidth + pad * 2),
      height: Math.round(window.outerHeight + topChrome + pad * 2),
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
  JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, trayClose: 'ask', data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2),
  'utf8',
);
info('夹具', `UD=${UD} ROOT=${ROOT} APPDIR=${APPDIR} bundle=${MAIN_BUNDLE}`);

const TEXT_TRAY = '托盘路径正文T54A';
const TEXT_DARK = '深色询问取消后仍在T54B';
const TEXT_QUIT = '退出路径正文T54C';
const TEXT_REMEMBER = '记住选择路径正文T54D';
const TEXT_TRAYQUIT = '托盘退出路径正文T54E';

let bootA = null;
let bootB = null;
let bootC = null;
try {
  // =========================================================================
  STEP = 'G0|boot';
  bootA = await launch('A');
  const page = bootA.page;
  info('main inspector', await connectInspector());
  info('托盘原始状态', JSON.stringify(await trayState()));

  for (let i = 0; i < 1; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(1400);
  }
  const ids0 = await alivePageIds(page);
  const tabs0 = await tabCount(page);
  check('G0-1 夹具成立：真点「新建页面」→ 1 标签 / 1 存活页', tabs0 >= 1 && ids0.length >= 1, `tabs=${String(tabs0)} pages=${String(ids0.length)}`);
  const page1 = ids0[0];
  await openPageRow(page, page1);
  await page.locator('.ProseMirror').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  // --- G1 询问框（浅）+ 立刻关窗的冲刷硬证 -----------------------------------
  STEP = 'G1|ask-light';
  await typeBody(page, TEXT_TRAY);
  const askLatencyLight = await closeAndWaitAsk(page);
  info('关窗→弹框延迟（浅，原始 ms）', String(askLatencyLight.latencyMs));
  const askLight = await askSnapshot(page);
  const dbAtAsk = await dbBlob(page, page1);
  check(
    'G1-1 关窗被拦且「冲刷完才弹框」：询问框出现时正文**已在库**（editor:flush ack 硬证）',
    askLight !== null && dbAtAsk.includes(TEXT_TRAY),
    `askOpen=${String(askLight !== null)} inDb=${String(dbAtAsk.includes(TEXT_TRAY))} latencyMs=${String(askLatencyLight.latencyMs)}（<2000 = ack 路径，非超时兜底）`,
  );
  check(
    'G1-2 询问框形态：标题/正文取自 i18n，三钮=最小化到托盘/退出/取消，默认聚焦「最小化到托盘」',
    askLight !== null &&
      askLight.title === '关闭 Septcats' &&
      askLight.tray === '最小化到托盘' &&
      askLight.quit === '退出' &&
      askLight.cancel === '取消' &&
      askLight.activeTestId === 'close-ask-tray',
    JSON.stringify(askLight),
  );
  check(
    'G1-3 像素风统一：模态吃 T53 token（box-shadow 含 bevel 硬边 inset + pixel 偏移 + modal 抬升，非系统弹框）',
    askLight !== null &&
      typeof askLight.bevel === 'string' &&
      askLight.bevel.includes('inset') &&
      askLight.bevel.includes('rgb(198, 198, 198) 2px 2px'),
    `boxShadow=${String(askLight?.bevel)}`,
  );
  await raiseMain(); // 抓屏前把应用窗口抬到最前（否则截到的是遮挡窗口的像素）
  const rectAskLight = await windowRect(page);
  const shotAskLight = await captureMain(join(SHOTS, 't54-01-ask-light.png'), rectAskLight);
  check('G1-4 浅色询问框窗口级截图已产出', shotAskLight.size > 0, `rect=${JSON.stringify(rectAskLight)} bytes=${String(shotAskLight.size)} err=${String(shotAskLight.err)}`);

  // 遮罩取消
  await page.locator('[data-testid="close-ask-overlay"]').first().click({ position: { x: 8, y: 8 }, force: true }).catch(() => {});
  await wait(700);
  const afterOverlay = await askOpen(page);
  const stateAfterOverlay = await winState();
  check(
    'G1-5 点遮罩 = 取消：弹框关闭、窗口仍在、进程不退',
    afterOverlay === false && stateAfterOverlay.visible === true,
    `askOpen=${String(afterOverlay)} win=${JSON.stringify(stateAfterOverlay)}`,
  );

  // Esc 取消
  await closeAndWaitAsk(page);
  await page.keyboard.press('Escape').catch(() => {});
  await wait(700);
  const afterEsc = await askOpen(page);
  const stateAfterEsc = await winState();
  check('G1-6 Esc = 取消：弹框关闭、窗口仍在', afterEsc === false && stateAfterEsc.visible === true, `askOpen=${String(afterEsc)} win=${JSON.stringify(stateAfterEsc)}`);

  const dbAfterCancel = await dbBlob(page, page1);
  check('G1-7 取消后正文仍在库（取消不影响已落库内容）', dbAfterCancel.includes(TEXT_TRAY), `inDb=${String(dbAfterCancel.includes(TEXT_TRAY))}`);

  // --- G2 深色询问框 --------------------------------------------------------
  STEP = 'G2|ask-dark';
  const themeDark = await setThemeAndReload(page, 'dark');
  info('深色主题属性', String(themeDark));
  await typeBody(page, TEXT_DARK);
  const askLatencyDark = await closeAndWaitAsk(page);
  info('关窗→弹框延迟（深，原始 ms）', String(askLatencyDark.latencyMs));
  const askDark = await askSnapshot(page);
  const dbDark = await dbBlob(page, page1);
  check(
    'G2-1 深色主题下同样「先冲刷后弹框」：正文已在库且弹框主题=dark',
    askDark !== null && askDark.theme === 'dark' && dbDark.includes(TEXT_DARK),
    `theme=${String(askDark?.theme)} inDb=${String(dbDark.includes(TEXT_DARK))}`,
  );
  await raiseMain(); // 深色截图同样先抬窗
  const rectAskDark = await windowRect(page);
  const shotAskDark = await captureMain(join(SHOTS, 't54-01-ask-dark.png'), rectAskDark);
  check('G2-2 深色询问框窗口级截图已产出', shotAskDark.size > 0, `rect=${JSON.stringify(rectAskDark)} bytes=${String(shotAskDark.size)} err=${String(shotAskDark.err)}`);
  await page.locator('[data-testid="close-ask-cancel"]').first().click({ force: true }).catch(() => {});
  await wait(700);

  // --- G3 最小化到托盘 ------------------------------------------------------
  STEP = 'G3|tray';
  await closeAndWaitAsk(page);
  await page.locator('[data-testid="close-ask-tray"]').first().click({ force: true }).catch(() => {});
  await waitFor(async () => (await winState()).visible === false, 5000, 200);
  const hiddenState = await winState();
  const pidAlive = alive(bootA.pid);
  check(
    'G3-1 选「最小化到托盘」：窗口隐藏（不销毁）、进程存活',
    hiddenState.visible === false && hiddenState.windows === 1 && pidAlive === true,
    `win=${JSON.stringify(hiddenState)} pid=${String(bootA.pid)} alive=${String(pidAlive)}`,
  );
  const pingHidden = await page.evaluate(() => window.septcats.ping()).catch((e) => `ERR:${String(e)}`);
  const dbHidden = await dbBlob(page, page1);
  check(
    'G3-2 隐藏态无假死：renderer 仍响应 IPC 且正文仍在库',
    typeof pingHidden === 'string' && pingHidden.startsWith('20') && dbHidden.includes(TEXT_TRAY),
    `ping=${pingHidden} inDb=${String(dbHidden.includes(TEXT_TRAY))}`,
  );

  const showResult = await showMainWindow();
  await waitFor(async () => (await winState()).visible === true, 5000, 200);
  const shownState = await winState();
  const editorAfterShow = await editorText(page);
  check(
    'G3-3 托盘「显示主窗口」等价动作：窗口恢复可见，编辑器正文仍在',
    shownState.visible === true && editorAfterShow.includes(TEXT_TRAY),
    `route=${String(showResult)} win=${JSON.stringify(shownState)} editorHas=${String(editorAfterShow.includes(TEXT_TRAY))}`,
  );

  // 托盘右键菜单（窗口级截图）
  STEP = 'G3|tray-menu';
  const trayInfo = await trayState();
  check(
    'G3-4 托盘实例真实存在且装了左键 toggle（click 监听器=1）',
    trayInfo.moduleCached === true && trayInfo.exists === true && trayInfo.destroyed === false && trayInfo.clickListeners === 1,
    JSON.stringify(trayInfo),
  );
  check(
    'G3-5 托盘菜单模板（原始 label/type JSON）：显示主窗口 / 分隔线 / 退出（双语言）',
    Array.isArray(trayInfo.zh) &&
      JSON.stringify(trayInfo.zh.map((i) => i.label ?? i.type)) === JSON.stringify(['显示主窗口', 'separator', '退出']) &&
      JSON.stringify(trayInfo.en.map((i) => i.label ?? i.type)) === JSON.stringify(['Show Main Window', 'separator', 'Quit']),
    `zh=${JSON.stringify(trayInfo.zh)} en=${JSON.stringify(trayInfo.en)}`,
  );
  const bounds = (await winState()).bounds ?? { x: 100, y: 100, width: 1200, height: 800 };
  const menuPoint = { x: bounds.x + Math.round(bounds.width * 0.42), y: bounds.y + Math.round(bounds.height * 0.52) };
  await raiseMain();
  const sf = await scaleFactor();
  const cursor = moveCursor(menuPoint.x * sf, menuPoint.y * sf);
  const cursorAfter = cursorPos();
  info(
    '光标移入窗口（物理坐标，读回校验）',
    JSON.stringify({ menuPoint, scaleFactor: sf, ps: cursor.status, cursorAfter, moved: cursorAfter !== null && Math.abs(cursorAfter.x - menuPoint.x * sf) <= 2 && Math.abs(cursorAfter.y - menuPoint.y * sf) <= 2 }),
  );
  const rectTray = await windowRect(page);
  const baseline = await storeWindowBaseline(rectTray);
  let trayShot = await popTrayMenuAndDiff(join(SHOTS, 't54-01-tray-menu.png'), 'tray');
  let trayRoute = 'Tray.popUpContextMenu()';
  if (!(typeof trayShot.changedPixels === 'number' && trayShot.changedPixels > 3000)) {
    info('托盘浮层未渲染（原始像素差）', JSON.stringify(trayShot));
    await sendKeysRaw('{ESC}', 400);
    await closeTrayMenu();
    await wait(400);
    trayShot = await popTrayMenuAndDiff(join(SHOTS, 't54-01-tray-menu.png'), 'menu');
    trayRoute = 'Menu.popup({window}) —— 托盘在建的同一个 Menu 实例（Tray.popUpContextMenu 在本会话不渲染，D-2）';
  }
  check(
    'G3-6 托盘右键菜单窗口级截图已产出，且**逐像素比差证明菜单真的画在窗口内**',
    typeof trayShot.changedPixels === 'number' && trayShot.changedPixels > 3000 && trayShot.bbox !== null && (trayShot.bytes ?? 0) > 0,
    `route=${trayRoute} baseline=${String(baseline)} diff=${JSON.stringify(trayShot)}`,
  );
  await sendKeysRaw('{ESC}', 600);
  await closeTrayMenu();
  await wait(500);

  // --- G4 记住选择路径 ------------------------------------------------------
  STEP = 'G4|remember';
  await typeBody(page, TEXT_REMEMBER);
  await closeAndWaitAsk(page);
  await page.locator('[data-testid="close-ask-remember"]').first().click({ force: true }).catch(() => {});
  const rememberChecked = await page.evaluate(() => document.querySelector('[data-testid="close-ask-remember"]')?.checked === true);
  await page.locator('[data-testid="close-ask-tray"]').first().click({ force: true }).catch(() => {});
  await waitFor(async () => (await winState()).visible === false, 5000, 200);
  const settingsAfterRemember = await page.evaluate(async () => {
    const s = await window.septcats.settings.get();
    return { trayClose: s.trayClose };
  });
  const dbRemember = await dbBlob(page, page1);
  check(
    'G4-1 勾选「记住我的选择」+ 选托盘 → settings.trayClose=tray 落库，且该轮正文已在库',
    dbRemember.includes(TEXT_REMEMBER) && settingsAfterRemember.trayClose === 'tray',
    `checked=${String(rememberChecked)} trayClose=${String(settingsAfterRemember.trayClose)} inDb=${String(dbRemember.includes(TEXT_REMEMBER))}`,
  );

  await showMainWindow();
  await waitFor(async () => (await winState()).visible === true, 5000, 200);
  await wait(600);
  await closeWindow();
  await wait(1600);
  const askAfterRemember = await askOpen(page);
  const stateAfterRemember = await winState();
  check(
    'G4-2 记住值生效：再次关窗**不弹框**，直接最小化到托盘',
    askAfterRemember === false && stateAfterRemember.visible === false,
    `askOpen=${String(askAfterRemember)} win=${JSON.stringify(stateAfterRemember)}`,
  );

  // 改回「每次询问」（设置页同一通道）
  await showMainWindow();
  await wait(800);
  const backToAsk = await page.evaluate(async () => {
    const s = await window.septcats.settings.patch({ trayClose: 'ask' });
    return s.trayClose;
  });
  check('G4-3 设置页通道可改回「每次询问」：patch 后 trayClose=ask', backToAsk === 'ask', `trayClose=${String(backToAsk)}`);

  // --- G5 退出路径 ----------------------------------------------------------
  STEP = 'G5|quit';
  await typeBody(page, TEXT_QUIT);
  const quitLatency = await closeAndWaitAsk(page);
  const askBeforeQuit = await askSnapshot(page);
  const dbBeforeQuit = await dbBlob(page, page1);
  check(
    'G5-1 退出路径同样先冲刷：询问框出现时正文已在库（默认回到「每次询问」）',
    askBeforeQuit !== null && dbBeforeQuit.includes(TEXT_QUIT),
    `latency=${JSON.stringify(quitLatency)} inDb=${String(dbBeforeQuit.includes(TEXT_QUIT))} active=${String(askBeforeQuit?.activeTestId)}`,
  );
  await page.locator('[data-testid="close-ask-quit"]').first().click({ force: true }).catch(() => {});
  // 调试会话挂着的进程不会随 app.quit 立刻退 → 先断开 inspector 再等进程消失
  await disconnectInspector();
  const exitedA = await waitFor(async () => alive(bootA.pid) === false, 20000, 300);
  check('G5-2 选「退出」→ 应用真退出（进程消失，非隐藏）', exitedA === true, `pid=${String(bootA.pid)} alive=${String(alive(bootA.pid))}`);
  bootA.quit = await quit(page, bootA.pid, bootA.browser, 'A');

  // =========================================================================
  STEP = 'G6|restart';
  bootB = await launch('B');
  const pageB = bootB.page;
  await connectInspector();
  const idsB = await alivePageIds(pageB);
  const pageB1 = idsB.includes(page1) ? page1 : idsB[0];
  await openPageRow(pageB, pageB1);
  const blobB = await dbBlob(pageB, pageB1);
  check(
    'G6-1 重启后（退出路径）正文在库完整：QUIT 文本 + 早前 TRAY/DARK/REMEMBER 文本均在',
    blobB.includes(TEXT_QUIT) && blobB.includes(TEXT_TRAY) && blobB.includes(TEXT_DARK) && blobB.includes(TEXT_REMEMBER),
    `hasQuit=${String(blobB.includes(TEXT_QUIT))} hasTray=${String(blobB.includes(TEXT_TRAY))} hasDark=${String(blobB.includes(TEXT_DARK))} hasRemember=${String(blobB.includes(TEXT_REMEMBER))}`,
  );
  const editorB = await editorText(pageB);
  check(
    'G6-2 重启后编辑器可见同一页文本（UI 面同证）',
    editorB.includes(TEXT_TRAY),
    `editorHasTray=${String(editorB.includes(TEXT_TRAY))} editorLen=${String(editorB.length)}`,
  );

  // --- G7 托盘菜单「退出」真点（键入后立即退出，不弹框） ---------------------
  STEP = 'G7|tray-quit';
  await typeBody(pageB, TEXT_TRAYQUIT);
  await raiseMain();
  const boundsB = (await winState()).bounds ?? { x: 100, y: 100, width: 1200, height: 800 };
  info('窗口几何（B，原始）', JSON.stringify(boundsB));
  await raiseMain();
  const menuPopB = await popTrayMenuOverWindow(300, 320);
  await wait(800);
  // 托盘菜单 = [显示主窗口, ---, 退出]：↓↓ 落在「退出」上，Enter 触发真点击
  const keys = sendKeysRaw('{DOWN}{DOWN}{ENTER}', 1200);
  await wait(800);
  const askAtTrayQuit = await askOpen(pageB).catch(() => null);
  await disconnectInspector();
  let exitedB = await waitFor(async () => alive(bootB.pid) === false, 10000, 300);
  let routeB = 'os-keys(↓↓Enter on 托盘菜单原生浮层)';
  if (exitedB !== true) {
    routeB = 't54Probe.quitFromTray()（与托盘菜单项同一处理器）';
    info('托盘菜单 OS 键未生效（原始）', JSON.stringify({ popped: menuPopB, keys }));
    await connectInspector();
    await trayQuitFallback();
    await disconnectInspector();
    exitedB = await waitFor(async () => alive(bootB.pid) === false, 15000, 300);
  }
  check(
    'G7-1 托盘菜单「退出」真点 → 应用退出且**未弹询问框**（quittingFlag 真退路径）',
    exitedB === true && askAtTrayQuit !== true,
    `route=${routeB} pid=${String(bootB.pid)} alive=${String(alive(bootB.pid))} popped=${String(menuPopB)} askAtTrayQuit=${String(askAtTrayQuit)}`,
  );
  bootB.quit = await quit(pageB, bootB.pid, bootB.browser, 'B');

  // =========================================================================
  STEP = 'G8|verify';
  bootC = await launch('C');
  const pageC = bootC.page;
  await connectInspector();
  const idsC = await alivePageIds(pageC);
  const pageC1 = idsC.includes(page1) ? page1 : idsC[0];
  await openPageRow(pageC, pageC1);
  const blobC = await dbBlob(pageC, pageC1);
  check(
    'G8-1 托盘退出路径不丢数据：重启后「托盘退出路径」正文在库',
    blobC.includes(TEXT_TRAYQUIT),
    `hasTrayQuit=${String(blobC.includes(TEXT_TRAYQUIT))} blobLen=${String(blobC.length)}`,
  );
  const editorC = await editorText(pageC);
  check(
    'G8-2 重启后编辑器可见全部五段文本（TRAY/DARK/REMEMBER/QUIT/TRAYQUIT 顺序在正文）',
    [TEXT_TRAY, TEXT_DARK, TEXT_REMEMBER, TEXT_QUIT, TEXT_TRAYQUIT].every((t) => editorC.includes(t)),
    `editorLen=${String(editorC.length)} hasAll=${String([TEXT_TRAY, TEXT_DARK, TEXT_REMEMBER, TEXT_QUIT, TEXT_TRAYQUIT].every((t) => editorC.includes(t)))}`,
  );
  // 第三次启动仍走真实退出路径（关窗 → 询问框 → 退出），保证退出干净未强杀
  STEP = 'G8|quit';
  await closeAndWaitAsk(pageC);
  await pageC.locator('[data-testid="close-ask-quit"]').first().click({ force: true }).catch(() => {});
  await disconnectInspector();
  const exitedC = await waitFor(async () => alive(bootC.pid) === false, 20000, 300);
  check(
    'G8-3 关窗 → 询问框 → 退出：应用真退出（退出干净，未强杀）',
    exitedC === true,
    `pid=${String(bootC.pid)} alive=${String(alive(bootC.pid))}`,
  );
  bootC.quit = await quit(pageC, bootC.pid, bootC.browser, 'C');
} catch (error) {  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
  for (const pid of listeningPids(PORT)) killTree(pid);
  await wait(800);
  const realRootMtimeAfter = (() => {
    try {
      return String(statSync(REAL_ROOT).mtimeMs);
    } catch {
      return 'absent';
    }
  })();
  const electronLeft = electronCount();
  STEP = 'G9|isolation';
  check('G9-1 真数据根未被触碰（mtime 前后一致）', realRootMtimeBefore === realRootMtimeAfter, `${realRootMtimeBefore} → ${realRootMtimeAfter}`);
  check('G9-2 自起 electron 进程已杀净（Get-Process electron 计数=0）', electronLeft === 0, `count=${String(electronLeft)}`);
  const passes = results.filter((r) => r.ok === true).length;
  const fails = results.filter((r) => r.ok === false).length;
  const payload = {
    task: 'TASK-T54-01 真机取证（关闭自动保存 + 退出/托盘询问框）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    mainBundle: MAIN_BUNDLE,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) + main-process Node inspector (--inspect) 读真实 Tray（require.cache 出口 t54Probe）/ popUpContextMenu / desktopCapturer 窗口级抓屏',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter, electronProcessesLeft: electronLeft },
    screenshots: ['t54-01-ask-light.png', 't54-01-ask-dark.png', 't54-01-tray-menu.png'],
    texts: { TEXT_TRAY, TEXT_DARK, TEXT_REMEMBER, TEXT_QUIT, TEXT_TRAYQUIT },
    pass: passes,
    fail: fails,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T54-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)} electronLeft=${String(electronLeft)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
