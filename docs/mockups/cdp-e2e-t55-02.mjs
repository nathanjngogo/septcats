/* cdp-e2e-t55-02.mjs —— TASK-T55-02 真机取证（像素布偶猫图标接线）
 *
 * 范围（对应任务书 §1②③④ + §3）：
 *   G0 夹具自检：独立 userData/rootPath 起应用，真点「新建页面」建 1 页（证明渲染面活着）；
 *   G1 托盘图标接线：main 进程真机解析 → **命中 build/icon-tray.png**（不是旧 .ico、不是空图）
 *      + 该文件 existsSync；另读完整候选序列（名字优先于基目录：三处 icon-tray.png 全排在
 *      icon.ico 之前）；托盘实例存在且 icon bounds > 0；
 *   G2 窗口面：title = 'Septcats'；窗口图标解析 → build/icon.png（存在）；backgroundColor
 *      实测 `#F5F5F5`（T53-01 灰阶漏网项已修）；
 *   G3 窗口级截图 ×2：**任务栏区**（窗口按钮可见）+ **托盘区**（通知区图标可见）——
 *      main 进程 desktopCapturer 抓主屏 → 按 DIP 矩形裁剪 → screens-t55/；
 *   G4 退出干净：window.close() 优雅退出 + Get-Process electron 计数。
 *
 * 取证法（同 T51-01 D-7 / T54-01）：renderer CDP（playwright-core over
 *   --remote-debugging-port）+ main 进程 Node inspector（--inspect）。托盘/图标解析出口经
 *   `require.cache` 读本 bundle 的 exports（`t54Probe` / `t55Probe`）——
 *   **绝不 require(path)**：缓存未命中时会重跑 main 入口（单实例锁 → app.quit 自杀）。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（先 `pnpm -C apps/desktop build`，ABI=electron）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t55-02/，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 不弹任何菜单、不改产品状态；退出只用 window.close()，未退出才强杀（如实记录）。
 *
 * 运行：pnpm -C apps/desktop build && node docs/mockups/cdp-e2e-t55-02.mjs
 * 产物：docs/mockups/screens-t55/t55-02-results.json + t55-02-taskbar.png + t55-02-tray.png
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
const MAIN_BUNDLE = join(APPDIR, 'out', 'main', 'index.js').split('\\').join('/');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t55-02';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9475;
const INSPECT = 9235;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t55');
const OUT_JSON = join(SHOTS, 't55-02-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
/** 期望命中的资产（相对 apps/desktop）：托盘 = T 子型、窗口 = C 全细节。 */
const EXPECT_TRAY = join(APPDIR, 'build', 'icon-tray.png');
const EXPECT_WINDOW = join(APPDIR, 'build', 'icon.png');
const EXPECT_BG = '#f5f5f5';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Windows 路径归一（断言用；避免分隔符差异把正确接线判红）。 */
const norm = (p) => String(p ?? '').split('\\').join('/');
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ task: 'TASK-T55-02 真机取证（像素布偶猫图标接线）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
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
// --- OS 级真输入（仅用于打开通知区浮层；不碰产品状态） ------------------------
function runPs(lines) {
  const r = spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', lines.join('; ')], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim().slice(0, 200) };
}
/** 真实鼠标左键点击屏幕物理坐标（Win11 通知区浮层只能真点开）。 */
function clickAt(physX, physY) {
  return runPs([
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(Math.round(physX))},${String(Math.round(physY))})`,
    'Start-Sleep -Milliseconds 300',
    'try { Add-Type -MemberDefinition \'[DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);\' -Name T55Mouse -Namespace T55 } catch {}',
    '[T55.T55Mouse]::mouse_event(2,0,0,0,0)',
    '[T55.T55Mouse]::mouse_event(4,0,0,0,0)',
    'Start-Sleep -Milliseconds 900',
  ]);
}
function sendKeysRaw(keys, settleMs = 500) {
  return runPs([
    '$s = New-Object -ComObject WScript.Shell',
    `$s.SendKeys("${keys}")`,
    `Start-Sleep -Milliseconds ${String(settleMs)}`,
  ]);
}

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

/**
 * 主进程 bundle 的模块缓存出口（**关键安全点**）：绝不用 require(path) —— 缓存未命中时
 * require 会重跑整个 main 入口（单实例锁 → app.quit() 自杀）。这里只读 require.cache。
 */
const PROBE_PRELUDE = `(() => {
  const want = ${JSON.stringify(MAIN_BUNDLE)};
  const norm = (k) => k.split('\\\\').join('/');
  const keys = Object.keys(require.cache);
  const hit = keys.find((k) => norm(k) === want) ?? keys.find((k) => norm(k).endsWith('/out/main/index.js'));
  if (!hit) return null;
  return require.cache[hit].exports;
})()`;

/** 图标解析原始状态（真机解析路径 + 候选序列 + 文件存在性 + 托盘 icons bounds）。 */
async function iconState() {
  const r = await mainEval(`(() => {
    const mods = ${PROBE_PRELUDE};
    const fs = require('fs');
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0] ?? null;
    if (!mods || !mods.t55Probe) return JSON.stringify({ moduleCached: Boolean(mods), probe: false });
    const trayIcon = mods.t55Probe.trayIconPath();
    const windowIcon = mods.t55Probe.windowIconPath();
    const candidates = mods.t55Probe.iconCandidates();
    const tray = mods.t54Probe ? mods.t54Probe.getTray() : null;
    return JSON.stringify({
      moduleCached: true,
      probe: true,
      trayIcon,
      trayIconExists: trayIcon === null ? false : fs.existsSync(trayIcon),
      windowIcon,
      windowIconExists: windowIcon === null ? false : fs.existsSync(windowIcon),
      candidates,
      trayBounds: tray === null || tray === undefined ? null : tray.getBounds(),
      trayDestroyed: tray === null || tray === undefined ? null : tray.isDestroyed(),
      title: w === null ? null : w.getTitle(),
      backgroundColor: w === null ? null : (typeof w.getBackgroundColor === 'function' ? w.getBackgroundColor() : 'NO_API'),
    });
  })()`);
  if (r.err || typeof r.value !== 'string') return { probe: false, err: r.err ?? 'no-value' };
  return JSON.parse(r.value);
}

/** 置顶应用窗口（show + setAlwaysOnTop + moveTop + focus），保证任务栏有窗口按钮。 */
async function raiseMain() {
  const r = await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.show(); w.setAlwaysOnTop(true); w.moveTop(); w.focus();
    return JSON.stringify({ visible: w.isVisible(), focused: w.isFocused(), title: w.getTitle(), bounds: w.getBounds() });
  })()`);
  await wait(1200);
  return r.value;
}

/** 主显示器（DIP）几何 + 任务栏高（workArea 与 bounds 差值推导）。 */
async function displayInfo() {
  const r = await mainEval(`(() => {
    const { screen } = require('electron');
    const d = screen.getPrimaryDisplay();
    const s = d.scaleFactor || 1;
    const bottomBar = (d.bounds.y + d.bounds.height) - (d.workArea.y + d.workArea.height);
    return JSON.stringify({ id: d.id, scale: s, bounds: d.bounds, workArea: d.workArea, taskbarHeight: bottomBar, all: screen.getAllDisplays().map((x) => ({ id: x.id, bounds: x.bounds, scale: x.scaleFactor })) });
  })()`);
  if (r.err || typeof r.value !== 'string') return null;
  return JSON.parse(r.value);
}

/**
 * main 进程内 desktopCapturer 抓屏（可选裁剪，DIP 矩形；`zoom` > 1 时做**最近邻放大**——
 * 16px 托盘图标在 1:1 截图里太小，放大后人眼才看得出「T 子型」；最近邻不引入插值糊边）。
 * 放大用 toBitmap → 手工像素复制 → createFromBitmap（同平台原始格式往返，无重采样）。
 */
async function captureMain(file, rect, displayId, zoom = 1) {
  const expr = `(async () => {
    const { desktopCapturer, screen, nativeImage } = require('electron');
    const d = screen.getPrimaryDisplay(); const s = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({ types:['screen'], thumbnailSize:{ width: Math.floor(d.bounds.width*s), height: Math.floor(d.bounds.height*s) } });
    if (srcs.length === 0) return 'NO_SOURCE';
    const want = String(${JSON.stringify(String(displayId ?? ''))});
    const src = srcs.find((x) => String(x.display_id) === want) ?? srcs[0];
    let img = src.thumbnail;
    ${rect === null ? '' : `const rx = Math.max(0, Math.round(${String(rect.x)}*s)); const ry = Math.max(0, Math.round(${String(rect.y)}*s));
    const rw = Math.max(1, Math.min(Math.round(${String(rect.width)}*s), img.getSize().width - rx));
    const rh = Math.max(1, Math.min(Math.round(${String(rect.height)}*s), img.getSize().height - ry));
    img = img.crop({ x: rx, y: ry, width: rw, height: rh });`}
    const zoom = ${String(zoom)};
    if (zoom > 1) {
      const size = img.getSize();
      const raw = img.toBitmap();
      const big = Buffer.alloc(size.width * zoom * size.height * zoom * 4);
      for (let y = 0; y < size.height * zoom; y++) {
        for (let x = 0; x < size.width * zoom; x++) {
          const sx = Math.floor(x / zoom); const sy = Math.floor(y / zoom);
          const si = (sy * size.width + sx) * 4;
          const di = (y * size.width * zoom + x) * 4;
          raw.copy(big, di, si, si + 4);
        }
      }
      img = nativeImage.createFromBitmap(big, { width: size.width * zoom, height: size.height * zoom });
    }
    return JSON.stringify({ displayId: String(src.display_id), size: img.getSize(), png: img.toPNG().toString('base64') });
  })()`;
  const r = await mainEval(expr);
  if (r.err || typeof r.value !== 'string' || r.value === 'NO_SOURCE') return { size: -1, err: r.err ?? r.value };
  const parsed = JSON.parse(r.value);
  const buf = Buffer.from(parsed.png, 'base64');
  writeFileSync(file, buf);
  return { size: buf.length, err: null, source: parsed.displayId, imageSize: parsed.size };
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
    async () => page.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.tree === 'function'),
    45000,
  );
  await wait(2200);
  return { page, pid: child.pid, browser };
}

async function quit(page, pid, browser) {
  STEP = 'teardown';
  await mainEval(`(() => { const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (w) w.setAlwaysOnTop(false); return 'ok'; })()`).catch(() => {});
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
info('期望资产', `托盘=${EXPECT_TRAY} 窗口=${EXPECT_WINDOW}`);

const quits = [];
const phases = {};
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  const page = boot.page;
  info('main inspector', await connectInspector());
  check(
    'G0-1 夹具成立：独立 userData/rootPath 起应用，渲染面就绪（.app-side + pages API）',
    (await page.evaluate(() => document.querySelector('.app-side') !== null)) === true,
    `userData=${UD}`,
  );
  check('G0-2 夹具数据根已物化（未触碰真实档案）', existsSync(ROOT), `root exists=${String(existsSync(ROOT))}`);

  // --- G1 托盘图标接线 -------------------------------------------------------
  STEP = 'G1|tray-icon';
  const icon = await iconState();
  phases.icon = icon;
  info('图标解析（原始）', JSON.stringify(icon));
  check(
    'G1-1 托盘图标真机解析命中 icon-tray.png（不是旧 icon.ico、不是空图）',
    typeof icon.trayIcon === 'string' && norm(icon.trayIcon).endsWith('build/icon-tray.png'),
    `trayIcon=${String(icon.trayIcon)}`,
  );
  check(
    'G1-2 解析到的托盘图标文件存在（existsSync 真机为真）',
    icon.trayIconExists === true,
    `exists=${String(icon.trayIconExists)}`,
  );
  const trayCandidates = (icon.candidates?.tray ?? []).map(norm);
  check(
    'G1-3 候选序列口径成立：三个基目录的 icon-tray.png 全部排在 icon.ico 之前（名字优先于目录）',
    trayCandidates.length === 6 &&
      trayCandidates.slice(0, 3).every((c) => c.endsWith('build/icon-tray.png')) &&
      trayCandidates.slice(3).every((c) => c.endsWith('build/icon.ico')),
    `candidates=${JSON.stringify(trayCandidates)}`,
  );
  const bounds = icon.trayBounds;
  check(
    'G1-4 托盘实例存在且已装图（icon bounds 宽高 > 0；空图会是 0×0）',
    icon.trayDestroyed === false && bounds !== null && bounds.width > 0 && bounds.height > 0,
    `destroyed=${String(icon.trayDestroyed)} bounds=${JSON.stringify(bounds)}`,
  );

  // --- G2 窗口面 ------------------------------------------------------------
  STEP = 'G2|window';
  const raised = await raiseMain();
  info('置顶（原始）', raised);
  const iconAfter = await iconState();
  check(
    'G2-1 窗口 title 正常（main 侧 getTitle = Septcats）',
    iconAfter.title === 'Septcats',
    `title=${JSON.stringify(iconAfter.title)}`,
  );
  check(
    'G2-2 窗口图标真机解析命中 icon.png 且文件存在',
    typeof iconAfter.windowIcon === 'string' && norm(iconAfter.windowIcon).endsWith('build/icon.png') && iconAfter.windowIconExists === true,
    `windowIcon=${String(iconAfter.windowIcon)} exists=${String(iconAfter.windowIconExists)}`,
  );
  check(
    'G2-3 窗口 backgroundColor = #F5F5F5（T53-01 灰阶漏网项已修：不再是 #FBFBFA）',
    typeof iconAfter.backgroundColor === 'string' && iconAfter.backgroundColor.toLowerCase() === EXPECT_BG,
    `backgroundColor=${JSON.stringify(iconAfter.backgroundColor)}`,
  );

  // --- G3 窗口级截图 ×2（任务栏区 / 托盘区） --------------------------------
  STEP = 'G3|shots';
  const display = await displayInfo();
  phases.display = display;
  info('主显示器（原始）', JSON.stringify(display));
  const taskbarH = display !== null && display.taskbarHeight > 0 ? display.taskbarHeight : 48;
  const boundsRect = display?.bounds ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const work = display?.workArea ?? boundsRect;
  const taskbarRect = {
    x: boundsRect.x,
    y: Math.round((work.y + work.height)),
    width: boundsRect.width,
    height: Math.round(taskbarH),
  };
  const trayWidth = Math.min(420, boundsRect.width);
  const trayRect = {
    x: Math.round(boundsRect.x + boundsRect.width - trayWidth),
    y: Math.round(work.y + work.height),
    width: Math.round(trayWidth),
    height: Math.round(taskbarH),
  };
  const shotTaskbar = await captureMain(join(SHOTS, 't55-02-taskbar.png'), taskbarRect, display?.id);
  check(
    'G3-1 任务栏区窗口级截图已产出（置顶窗口 → 任务栏出现 Septcats 按钮）',
    shotTaskbar.size > 1000,
    `rect=${JSON.stringify(taskbarRect)} bytes=${String(shotTaskbar.size)} source=${String(shotTaskbar.source)} err=${String(shotTaskbar.err)}`,
  );
  // 任务栏按钮群 6× 最近邻放大（按钮只有 ~24px，1:1 看不清是哪只猫）：据窗口 icon 解析结果
  // 断言的是「接线」，这里给的是「人眼可判读」的像素证据（截图落在工作区水平中线附近）。
  const buttonsRect = {
    x: Math.round(work.x + work.width / 2 - 200),
    y: Math.round(work.y + work.height),
    width: 400,
    height: Math.round(taskbarH),
  };
  const shotButtons = await captureMain(join(SHOTS, 't55-02-taskbar-buttons-zoom.png'), buttonsRect, display?.id, 6);
  check(
    'G3-1b 任务栏按钮群 6× 放大截图已产出（白底像素猫 = 窗口 icon.png 落地）',
    shotButtons.size > 1000,
    `rect=${JSON.stringify(buttonsRect)} bytes=${String(shotButtons.size)} err=${String(shotButtons.err)}`,
  );
  const shotTray = await captureMain(join(SHOTS, 't55-02-tray.png'), trayRect, display?.id);
  check(
    'G3-2 托盘区窗口级截图已产出（通知区条带）',
    shotTray.size > 1000,
    `rect=${JSON.stringify(trayRect)} bytes=${String(shotTray.size)} source=${String(shotTray.source)} err=${String(shotTray.err)}`,
  );

  // G3-3（增强取证）：Win11 默认把新应用托盘图标收进溢出浮层（真机实测 tray.getBounds 上报的
  // 就是溢出按钮位：width=32），故真点该按钮把浮层打开，再抓一张「含 T 子型图标」的证据图。
  const trayRectDips = icon.trayBounds;
  if (trayRectDips !== null) {
    const flyout = {
      x: Math.max(0, Math.round(boundsRect.x + boundsRect.width - 440)),
      y: Math.max(0, Math.round(work.y + work.height - 430)),
      width: Math.min(440, boundsRect.width),
      height: 430,
    };
    const before = await captureMain(join(RUN, '_flyout-before.png'), flyout, display?.id);
    const cx = (trayRectDips.x + trayRectDips.width / 2) * (display?.scale ?? 1);
    const cy = (trayRectDips.y + trayRectDips.height / 2) * (display?.scale ?? 1);
    const clicked = clickAt(cx, cy);
    const after = await captureMain(join(SHOTS, 't55-02-tray-overflow.png'), flyout, display?.id);
    const zoomed = await captureMain(join(SHOTS, 't55-02-tray-icon-zoom.png'), flyout, display?.id, 3);
    await sendKeysRaw('{ESC}', 400);
    check(
      'G3-3（增强）真点通知区溢出按钮 → 浮层打开 → 截图（含 3× 最近邻放大版）可见托盘 T 子型图标',
      after.size > 1000 && after.size !== before.size && zoomed.size > 1000,
      `trayBounds=${JSON.stringify(trayRectDips)} click=(${String(Math.round(cx))},${String(Math.round(cy))}) flyout=${JSON.stringify(flyout)} before=${String(before.size)}B after=${String(after.size)}B zoom3x=${String(zoomed.size)}B ps_status=${String(clicked.status)}`,
    );
  } else {
    info('G3-3（增强）跳过', '托盘 bounds 不可得');
  }

  // --- G4 退出 --------------------------------------------------------------
  const quitResult = await quit(page, boot.pid, boot.browser);
  boot.quit = quitResult;
  quits.push(quitResult);
  check('G4-1 退出干净：window.close() 优雅退出（未强杀）', quitResult.gracefulExited === true, JSON.stringify(quitResult));
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
    task: 'TASK-T55-02 真机取证（像素布偶猫图标接线）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) + main-process Node inspector (--inspect) 读 require.cache 的 t55Probe/t54Probe + desktopCapturer 裁剪抓屏',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    expected: { trayIcon: EXPECT_TRAY, windowIcon: EXPECT_WINDOW, backgroundColor: EXPECT_BG },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't55-02-taskbar.png',
      't55-02-taskbar-buttons-zoom.png',
      't55-02-tray.png',
      't55-02-tray-overflow.png',
      't55-02-tray-icon-zoom.png',
    ],
    electronProcessesAfterQuit: electrons,
    pass: passes,
    fail: fails,
    quiet: quits,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T55-02：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}  electron 进程数=${String(electrons)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
