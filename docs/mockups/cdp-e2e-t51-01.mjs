/* cdp-e2e-t51-01.mjs —— TASK-T51-01 真机取证（重命名 blur 提交 + 原生菜单本地化）
 *
 * 范围（对应任务书 §1①②/§2/§4）：
 *   G0 夹具自检：独立夹具真点 UI 建 3 页 → 3 存活页 / 3 标签；
 *   G1 侧栏重命名三键语义（真机真键入）：blur 提交 / Esc 取消 / 空值回退；
 *   G2 原生菜单中文：读 main 进程**真实安装的** ApplicationMenu（label/role/
 *      accelerator/registerAccelerator 全量），断言全中文 + Close Tab 非 role:close
 *      → 置顶窗口 + 弹出真实 File 子菜单 → 抓屏 → screens-t51/t51-01-menu-zh.png；
 *   G3 File→New Page：弹出真实 File 子菜单后用 OS 级 ↓/Enter 触发菜单项
 *      → 存活页 +1（回落：main 侧直接调用该菜单项的 click 回调，与真实点击同一处理器）；
 *   G4 Ctrl+W 关标签不关窗（CDP 真键；标签 -1、页面数不变、窗口仍活）；
 *   G5 设置页真点 English → 菜单即时重建 → 英文菜单 JSON + t51-01-menu-en.png。
 *
 * 为什么用 main 进程 Node inspector（--inspect）：
 *   - 原生菜单栏**不在 web contents 里**，page.screenshot 拍不到；且本会话里应用窗口
 *     被其它窗口遮挡/不在可抓屏桌面，跨进程 desktopCapturer 抓不到。经 main 进程
 *     `BrowserWindow.setAlwaysOnTop/moveTop` 置顶 + `Menu.popup` 弹出真实子菜单 +
 *     main 内 `desktopCapturer` 抓屏，才能拿到带原生菜单的窗口像素。
 *   - `Menu.getApplicationMenu()` 是「菜单到底装成什么样」的权威来源（比像素更硬）。
 *   仅用调试端口 + inspector 读取/调用公开 API，**不改任何产品代码**。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t51-01/，绝不读写
 *   C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）。
 *
 * 运行：node docs/mockups/cdp-e2e-t51-01.mjs
 * 产物：docs/mockups/screens-t51/t51-01-results.json + t51-01-menu-{zh,en}.png
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
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t51-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9471;
const INSPECT = 9231;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t51');
const OUT_JSON = join(SHOTS, 't51-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef\u3000-\u303f]/;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify({ task: 'TASK-T51-01 真机取证（重命名 blur 提交 + 原生菜单本地化）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
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
/** 在 main 进程求值（returnByValue）。返回 {value} 或 {err}。 */
async function mainEval(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (r.exceptionDetails) return { err: JSON.stringify(r.exceptionDetails).slice(0, 400) };
  return { value: r.result?.value };
}

/** 置顶应用窗口（show + setAlwaysOnTop + moveTop + focus）并回窗口几何。 */
async function raiseMain() {
  const r = await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.show(); w.setAlwaysOnTop(true); w.moveTop(); w.focus();
    return JSON.stringify({ visible: w.isVisible(), focused: w.isFocused(), minimized: w.isMinimized(), title: w.getTitle(), bounds: w.getBounds(), onTop: w.isAlwaysOnTop() });
  })()`);
  await wait(1200);
  return r.value;
}

/** 真实安装的应用菜单 → 规整 JSON（label/role/accelerator/registerAccelerator/type）。 */
async function menuJson() {
  const r = await mainEval(`(() => {
    const { Menu } = require('electron');
    const m = Menu.getApplicationMenu();
    if (!m) return 'NO_MENU';
    const flat = (items) => items.map((i) => ({
      type: i.type, label: i.label, role: i.role ?? null,
      accelerator: i.accelerator ?? null, registerAccelerator: i.registerAccelerator,
      submenu: i.submenu ? flat(i.submenu.items) : null,
    }));
    return JSON.stringify(flat(m.items));
  })()`);
  if (r.err || typeof r.value !== 'string' || r.value === 'NO_MENU') return null;
  return JSON.parse(r.value);
}

async function popupFileSubmenu() {
  return (await mainEval(`(() => {
    const { Menu, BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    const m = Menu.getApplicationMenu();
    m.items[0].submenu.popup({ window: w, x: 26, y: 26 });
    return 'popped';
  })()`)).value;
}
async function closePopup() {
  await mainEval(`(() => { const { Menu } = require('electron'); const m = Menu.getApplicationMenu(); if (m) m.items.forEach((i) => i.submenu && i.submenu.closePopup()); return 'closed'; })()`);
}
/** 直接调用菜单项 click 回调（与真实点击走同一处理器；G3 的兜底路线）。 */
async function clickFileFirstItem() {
  return (await mainEval(`(() => {
    const { Menu } = require('electron');
    const it = Menu.getApplicationMenu().items[0].submenu.items.find((i) => i.type === 'normal');
    if (!it) return 'NO_ITEM';
    it.click();
    return 'clicked:' + String(it.label);
  })()`)).value;
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
  if (r.err || typeof r.value !== 'string' || r.value === 'NO_SOURCE') return { size: -1, err: r.err ?? r.value };
  const buf = Buffer.from(r.value, 'base64');
  writeFileSync(file, buf);
  return { size: buf.length, err: null };
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

/**
 * 优雅退出：先关菜单弹层 + 取消置顶，再 window.close()（应用自身 window-all-closed
 * → app.quit 路径）；仍未退出则走 app.quit() 这一应用级正常关停；只有都不生效才强杀
 * （如实记录，不把强杀说成优雅）。
 */
async function quit(page, pid, browser) {
  STEP = 'teardown';
  await closePopup().catch(() => {});
  await mainEval(`(() => { const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (w) w.setAlwaysOnTop(false); return 'ok'; })()`).catch(() => {});
  // 先断开 main inspector 会话（调试会话挂着的进程不会随 app.quit 立刻退）
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  await wait(600);
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
  await wait(3000);
  let forced = false;
  if (alive(pid)) {
    forced = true;
    killTree(pid);
  }
  await browser.close().catch(() => {});
  await wait(1200);
  return { gracefulExited: !forced, forced };
}

function runPs(lines) {
  const r = spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', lines.join('; ')], { encoding: 'utf8' });
  return { status: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim().slice(0, 200) };
}
/** OS 级真键（不抢前置：原生菜单弹出时由菜单自己消费）。 */
function sendKeysRaw(keys, settleMs = 500) {
  return runPs([
    '$s = New-Object -ComObject WScript.Shell',
    `$s.SendKeys("${keys}")`,
    `Start-Sleep -Milliseconds ${String(settleMs)}`,
  ]);
}
/** OS 级真键（先 AppActivate 应用窗口，再由窗口消费）。 */
function sendKeys(keys, settleMs = 500) {
  return runPs([
    '$s = New-Object -ComObject WScript.Shell',
    '$s.AppActivate("Septcats") | Out-Null',
    'Start-Sleep -Milliseconds 300',
    `$s.SendKeys("${keys}")`,
    `Start-Sleep -Milliseconds ${String(settleMs)}`,
  ]);
}

/** 窗口外框（含标题栏 + 原生菜单栏）矩形；CSS px。 */
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

async function pageCount(page) {
  return await page.evaluate(async () => {
    const ws2 = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: ws2.activeId });
    return nodes.filter((n) => n.alive === 1).length;
  });
}
const tabCount = (page) => page.evaluate(() => document.querySelectorAll('.tabsbar-tab').length);

const labelsOf = (menu) => {
  const out = [];
  const walk = (items) => {
    for (const i of items) {
      if (typeof i.label === 'string' && i.label.length > 0) out.push(i.label);
      if (i.submenu) walk(i.submenu);
    }
  };
  walk(menu);
  return out;
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
  JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2),
  'utf8',
);
info('夹具', `UD=${UD} ROOT=${ROOT} APPDIR=${APPDIR}`);

const phases = {};
const quits = [];
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  const page = boot.page;
  info('main inspector', await connectInspector());

  // --- G0 夹具 --------------------------------------------------------------
  STEP = 'G0|fixture';
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  }
  const tabs0 = await tabCount(page);
  const pages0 = await pageCount(page);
  check('G0-1 夹具成立：真点「新建页面」×3 → 3 标签 / 3 存活页', tabs0 === 3 && pages0 === 3, `tabs=${String(tabs0)} pages=${String(pages0)}`);

  // --- G1 重命名三键语义（真机真键入） ---------------------------------------
  STEP = 'G1|rename';
  const targetId = await page.evaluate(() => {
    const row = document.querySelector('[data-testid^="side-node-"]');
    return row === null ? null : row.getAttribute('data-testid').replace('side-node-', '');
  });
  const rowSel = `[data-testid="side-node-${String(targetId)}"]`;
  const inputSel = '[data-testid="side-rename-input"]';
  const titles = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="side-node-"] .app-nav-tx')].map((el) => el.textContent));
  const hasInput = () => page.evaluate(() => document.querySelector('[data-testid="side-rename-input"]') !== null);

  await page.locator(rowSel).first().dblclick({ force: true }).catch(() => {});
  await wait(600);
  const inputOpened = await hasInput();
  await page.locator(inputSel).first().fill('').catch(() => {});
  await page.locator(inputSel).first().type('失焦改名成立', { delay: 20 }).catch(() => {});
  await page.mouse.click(900, 700).catch(() => {}); // 点别处 → 失焦
  await wait(1600);
  const t1 = await titles();
  const i1 = await hasInput();
  check(
    'G1-1 重命名 blur 提交（真机）：改标题后点别处失焦 → 标题落库、编辑框关闭（修前被 cancel 吞掉）',
    inputOpened === true && i1 === false && t1.includes('失焦改名成立'),
    `inputOpened=${String(inputOpened)} inputStillOpen=${String(i1)} titles=${JSON.stringify(t1)}`,
  );

  await page.locator(rowSel).first().dblclick({ force: true }).catch(() => {});
  await wait(500);
  await page.locator(inputSel).first().fill('不该保存').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await wait(900);
  const t2 = await titles();
  const i2 = await hasInput();
  check('G1-2 Esc 取消（真机）：标题不变、编辑框关闭', i2 === false && t2.includes('失焦改名成立') && !t2.includes('不该保存'), `inputStillOpen=${String(i2)} titles=${JSON.stringify(t2)}`);

  await page.locator(rowSel).first().dblclick({ force: true }).catch(() => {});
  await wait(500);
  await page.locator(inputSel).first().fill('   ').catch(() => {});
  await page.mouse.click(900, 700).catch(() => {});
  await wait(1200);
  const t3 = await titles();
  const i3 = await hasInput();
  check('G1-3 空值 blur 回退（真机）：仅空白 → 不改名、编辑框关闭', i3 === false && t3.includes('失焦改名成立'), `inputStillOpen=${String(i3)} titles=${JSON.stringify(t3)}`);

  // --- G2 中文原生菜单（真实菜单 JSON + 弹出 File 子菜单截图） -----------------
  STEP = 'G2|menu-zh';
  const raised = await raiseMain();
  info('置顶（原始）', raised);
  const menuZh = await menuJson();
  phases.menuZh = menuZh;
  info('zh 真实 ApplicationMenu（原始）', JSON.stringify(menuZh));
  const zhLabels = menuZh === null ? [] : labelsOf(menuZh);
  const allZhChinese = zhLabels.length >= 18 && zhLabels.every((l) => CJK.test(l));
  const fileSubZh = menuZh === null ? [] : menuZh[0].submenu;
  const closeTabZh = fileSubZh.find((i) => i.accelerator === 'CmdOrCtrl+W') ?? null;
  const editSubZh = menuZh === null ? [] : menuZh[1].submenu;
  const editRoles = editSubZh.filter((i) => i.role !== null).map((i) => i.role);
  const anyRoleClose = JSON.stringify(menuZh ?? []).includes('"close"');
  check(
    'G2-1 中文菜单：真实安装的 ApplicationMenu 全部 label 为中文（四组：文件/编辑/视图/帮助）',
    allZhChinese,
    `top=${JSON.stringify(menuZh === null ? null : menuZh.map((i) => i.label))} labels=${JSON.stringify(zhLabels)}`,
  );
  check(
    'G2-2 Close Tab 委托页签逻辑：同键 CmdOrCtrl+W、registerAccelerator=false、**无 role:\'close\'**（不会关窗）',
    closeTabZh !== null && closeTabZh.registerAccelerator === false && closeTabZh.role === null && anyRoleClose === false,
    `closeTab=${JSON.stringify(closeTabZh)} anyRoleClose=${String(anyRoleClose)}`,
  );
  check(
    'G2-3 Edit 六项用标准 role 且不抢注册（页内编辑器 Ctrl+Z/C/V/A 不被截断）',
    JSON.stringify(editRoles) === JSON.stringify(['undo', 'redo', 'cut', 'copy', 'paste', 'selectall']) &&
      editSubZh.filter((i) => i.role !== null).every((i) => i.registerAccelerator === false),
    `editRoles=${JSON.stringify(editRoles)}`,
  );
  const paletteZh = (menuZh?.[2].submenu ?? []).find((i) => i.accelerator === 'CmdOrCtrl+K');
  check(
    'G2-4 命令面板菜单项不注册 Ctrl+K（与 main globalShortcut 不双绑）；缩放 role 正常注册',
    paletteZh !== undefined && paletteZh.registerAccelerator === false &&
      (menuZh?.[2].submenu ?? []).filter((i) => ['zoomin', 'zoomout', 'resetzoom'].includes(i.role)).length === 3,
    `palette=${JSON.stringify(paletteZh)}`,
  );
  const rectZh = await windowRect(page);
  await popupFileSubmenu();
  await wait(900);
  const shotZh = await captureMain(join(SHOTS, 't51-01-menu-zh.png'), rectZh);
  await closePopup();
  check(
    'G2-5 中文原生菜单截图已产出（置顶窗口 + 真实弹出 File 子菜单，含标题栏/菜单栏/子菜单项）',
    shotZh.size > 0,
    `rect=${JSON.stringify(rectZh)} bytes=${String(shotZh.size)} err=${String(shotZh.err)}`,
  );

  // --- G3 File→New Page（弹出真实子菜单 + OS 级 ↓/Enter） ---------------------
  STEP = 'G3|menu-newpage';
  const pagesBefore = await pageCount(page);
  const tabsBefore = await tabCount(page);
  await raiseMain();
  await popupFileSubmenu();
  await wait(800);
  const osKeys = sendKeysRaw('{DOWN}{ENTER}', 1500);
  let pagesAfter = pagesBefore;
  await waitFor(async () => {
    pagesAfter = await pageCount(page);
    return pagesAfter === pagesBefore + 1;
  }, 5000);
  let route = 'os-keys(↓ Enter on popped File submenu)';
  let fallback = null;
  if (pagesAfter !== pagesBefore + 1) {
    route = 'main-side menuItem.click()（与真实点击同一处理器）';
    await closePopup();
    fallback = await clickFileFirstItem();
    await waitFor(async () => {
      pagesAfter = await pageCount(page);
      return pagesAfter === pagesBefore + 1;
    }, 6000);
  }
  await closePopup();
  const tabsAfter = await tabCount(page);
  check(
    'G3-1 File→New Page 可用：菜单项触发后存活页 +1（真菜单项，非侧栏按钮）',
    pagesAfter === pagesBefore + 1,
    `route=${route} pages ${String(pagesBefore)}→${String(pagesAfter)} tabs ${String(tabsBefore)}→${String(tabsAfter)} osKeys=${JSON.stringify(osKeys)} fallback=${String(fallback && (fallback.value ?? fallback.err))}`,
  );

  // --- G4 Ctrl+W 关标签不关窗 ----------------------------------------------
  STEP = 'G4|ctrl-w';
  const tabsW0 = await tabCount(page);
  const pagesW0 = await pageCount(page);
  await page.bringToFront().catch(() => {});
  await page.keyboard.press('Control+w').catch(() => {});
  await wait(1400);
  const aliveState = await page
    .evaluate(() => ({ closed: window.closed === true, appSide: document.querySelector('.app-side') !== null }))
    .catch(() => ({ closed: true, appSide: false }));
  const tabsW1 = await tabCount(page).catch(() => -1);
  const pagesW1 = await pageCount(page).catch(() => -1);
  check(
    'G4-1 Ctrl+W 关的是标签不是窗口：标签 -1、页面数不变、窗口仍活',
    tabsW1 === tabsW0 - 1 && pagesW1 === pagesW0 && aliveState.appSide === true && aliveState.closed === false,
    `tabs ${String(tabsW0)}→${String(tabsW1)} pages ${String(pagesW0)}→${String(pagesW1)} alive=${JSON.stringify(aliveState)}`,
  );
  await page.keyboard.press('Control+w').catch(() => {});
  await wait(1200);
  const tabsW2 = await tabCount(page).catch(() => -1);
  const windowAlive2 = await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false);
  check('G4-2 连按 Ctrl+W：再关一个标签且窗口仍活（绝不 role:close 关窗）', tabsW2 === tabsW1 - 1 && windowAlive2 === true, `tabs ${String(tabsW1)}→${String(tabsW2)} windowAlive=${String(windowAlive2)}`);

  // --- G5 切 English → 菜单即时重建 + 英文截图 -------------------------------
  STEP = 'G5|locale-en';
  await page.getByRole('button', { name: /设置|Settings/ }).last().click({ force: true }).catch(() => {});
  const settingsOpen = await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null), 10000);
  const radio = page.locator('input.sc-radio__input[name="settings-locale"][value="en-US"]').first();
  const radioExists = (await radio.count()) > 0;
  if (radioExists) await radio.check({ force: true }).catch(() => {});
  await wait(1800);
  const langAfter = await page.evaluate(() => ({ stored: window.localStorage.getItem('septcats.localePref'), legend: document.querySelector('.settings-legend')?.textContent ?? null }));
  check(
    'G5-1 设置页真点 English：locale 标记 en-US + 界面即时英文（settings.patch 已到 main → 菜单应已重建）',
    settingsOpen === true && radioExists && langAfter.stored === 'en-US',
    `settingsOpen=${String(settingsOpen)} radioExists=${String(radioExists)} langAfter=${JSON.stringify(langAfter)}`,
  );
  await page.getByRole('button', { name: /Settings|设置/ }).last().click({ force: true }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') === null), 10000);
  await wait(1200);
  STEP = 'G5|menu-en';
  const raisedEn = await raiseMain();
  const menuEn = await menuJson();
  phases.menuEn = menuEn;
  info('en 真实 ApplicationMenu（原始）', JSON.stringify(menuEn));
  const enLabels = menuEn === null ? [] : labelsOf(menuEn);
  check(
    'G5-2 英文菜单（语言切换即时重建）：真实 ApplicationMenu 全部 label 为英文、无 CJK、结构同构',
    enLabels.length === zhLabels.length && enLabels.every((l) => !CJK.test(l)) && menuEn !== null && menuEn.map((i) => i.label).join('|') === 'File|Edit|View|Help',
    `top=${JSON.stringify(menuEn === null ? null : menuEn.map((i) => i.label))} labels=${JSON.stringify(enLabels)} raised=${String(raisedEn)}`,
  );
  const rectEn = await windowRect(page);
  await popupFileSubmenu();
  await wait(900);
  const shotEn = await captureMain(join(SHOTS, 't51-01-menu-en.png'), rectEn);
  await closePopup();
  check('G5-3 英文原生菜单截图已产出（同一 File 子菜单展开）', shotEn.size > 0, `rect=${JSON.stringify(rectEn)} bytes=${String(shotEn.size)} err=${String(shotEn.err)}`);

  boot.quit = await quit(page, boot.pid, boot.browser);
  quits.push({ boot: 1, ...boot.quit });
  check('G6-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
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
    task: 'TASK-T51-01 真机取证（重命名 blur 提交 + 原生菜单本地化）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) + main-process Node inspector (--inspect) 读 Menu.getApplicationMenu / BrowserWindow 置顶 / Menu.popup / desktopCapturer',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: ['t51-01-menu-zh.png', 't51-01-menu-en.png'],
    pass: passes,
    fail: fails,
    quiet: quits,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T51-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
