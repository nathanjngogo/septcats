/* cdp-e2e-t59-01.mjs —— TASK-T59-01 真机取证（主区域像素风黑色边框 + T52 骑缝融合）
 *
 * 范围（对应任务书 §1.2/§1.3/§1.4/§1.8 + §3 验收锚）：
 *   G0 夹具自检：隔离夹具真点「新建页面」×2 → 2 标签 / 2 存活页；真键入正文（T52 装订线断言用）；
 *   G1 §1.2 五处主区域边界 computed style 实测（2px + ink-edge 色，浅/深两主题各一轮）：
 *      顶栏下沿 / 侧栏右缘 / 编辑区顶边 / AI 面板左缘 / AI 置底时的顶边；
 *   G2 §1.2 **像素线宽实测**：三条接缝各取局部截图解码 → 整列/整行纯 ink 像素数 = 2
 *      （证明「相邻边只画一次」，没有 4px 双拼）；
 *   G3 §1.3 T52 骑缝融合（本单最大风险）：
 *      - 活动标签盒与 .pv-root 顶边**重叠/贴边**（getBoundingClientRect 实测）；
 *      - 接缝采样：活动标签中心处 = 编辑区底色（非 ink-edge）；活动标签右侧空白处 = ink-edge；
 *      - 复跑 T57 G8-4 原式（bar 无下描边 / 活动标签无下描边 / 活动标签底 = pv-root 底 /
 *        belowActive 命中 pv-root）；
 *   G4 §3 老断言零回归：T57 G8 五断言 + T33 装订线 70/12 + T52 通高/折叠钮位置；
 *   G5 §3 1184/894 两宽度零滚动（纵向 + 横向）+ 侧栏 top 恒 0；
 *   G6 §1.4 浮层 2px：布局快选弹框（模态）computed border = 2px ink-edge + 边缘像素线宽 = 2；
 *   G7 §1.8 双主题 ≥8 张截图：浅/深 ×（主界面 / 活动标签接缝放大 / 模态 / AI 面板展开）；
 *   G8 隔离自检：真档案 `C:\Users\Administrator\.septcats` mtime 前后一致（untouched）；
 *   G9 退出干净 + electron 进程计数 = 0。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t59-01/ 下，绝不读写 PM 真实数据根；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口；不改产品代码、不写产品数据。
 *
 * 运行：node docs/mockups/cdp-e2e-t59-01.mjs
 * 产物：docs/mockups/screens-t59/t59-01-results.json + ≥8 张 png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t59-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9481;
const INSPECT = 9241;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t59');
const OUT_JSON = join(SHOTS, 't59-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const WIDTHS = [1184, 894];

/* ---------- 最小 PNG 解码（CDP 截图：8bit，RGB/RGBA，非隔行；与 t58 探针同实现） ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('仅支持 8bit 非隔行 PNG');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (channels === 0) throw new Error(`不支持的 PNG colorType=${String(colorType)}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.from(line);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) cur[i] = (cur[i] + a) & 0xff;
      else if (filter === 2) cur[i] = (cur[i] + b) & 0xff;
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}
const pxAt = (img, x, y) => {
  const o = (y * img.width + x) * img.channels;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T59-01 真机取证（主区域像素风黑色边框 + T52 骑缝融合）',
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
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    includeCommandLineAPI: true,
  });
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
  await mainEval(
    `(() => { const { BrowserWindow } = require('electron'); const w = BrowserWindow.getAllWindows()[0]; if (w) w.setAlwaysOnTop(false); return 'ok'; })()`,
  ).catch(() => {});
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
/** 保证「有活动标签」（reload 后标签列表可能为空 → 点侧栏首行打开）。 */
async function ensureActiveTab() {
  const has = await page.evaluate(() => document.querySelector('.tabsbar-tab--active') !== null);
  if (has) return true;
  await page.locator('.app-nav-row:not(.app-nav-row--head)').first().click({ force: true }).catch(() => {});
  await wait(1200);
  return await page.evaluate(() => document.querySelector('.tabsbar-tab--active') !== null);
}
async function setThemeAndReload(theme) {
  await page.evaluate((t) => window.localStorage.setItem('septcats.theme', t), theme);
  await reload();
  await ensureActiveTab();
  await wait(600);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'null');
}
const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => null);
/** 局部截图（clip 省略 = 视口全幅）；返回 PNG buffer。 */
async function shotClip(name, clip) {
  const target = clip === undefined ? { path: join(SHOTS, name) } : { path: join(SHOTS, name), clip };
  return page.screenshot(target).catch(() => null);
}
/** 放大截图：CDP `Page.captureScreenshot` 的 clip.scale（矢量重采样，不改布局）。 */
async function shotZoom(name, clip, scale) {
  if (clip === undefined) return null;
  const cdpz = await page.context().newCDPSession(page);
  const r = await cdpz
    .send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale },
    })
    .catch(() => null);
  await cdpz.detach().catch(() => {});
  if (r?.data === undefined) return null;
  const buf = Buffer.from(r.data, 'base64');
  writeFileSync(join(SHOTS, name), buf);
  return buf;
}
/** 像素量测用截图：强制 deviceScaleFactor=1（1 设备像素 = 1 CSS 像素）。 */
async function shotDsf1(clip, scale = 1) {
  const s = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const cdpz = await page.context().newCDPSession(page);
  await cdpz.send('Emulation.setDeviceMetricsOverride', {
    width: s.w,
    height: s.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(500);
  let buf = null;
  if (scale === 1) {
    buf = await page.screenshot({ clip }).catch(() => null);
  } else {
    const r = await cdpz
      .send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale },
      })
      .catch(() => null);
    buf = r?.data === undefined ? null : Buffer.from(r.data, 'base64');
  }
  await cdpz.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await cdpz.detach().catch(() => {});
  await wait(500);
  return buf;
}

// --- 量测器 ------------------------------------------------------------------

const TRIM = (v) => v.replace(/\s+/g, ' ').trim();
/** 主题里 ink-edge 的期望 RGB（从 computed style 读，主题自适应）。 */
const INK_RGB = () =>
  page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge').trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw);
    if (hex === null) return null;
    const n = Number.parseInt(hex[1], 16);
    return { hex: raw, rgb: [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] };
  });
const rgbToHex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const sameRgb = (a, b) => a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** §1.2 五处边界的 computed style（真机实测）。 */
const BORDERS = () =>
  page.evaluate(() => {
    const grab = (el) => {
      if (el === null) return null;
      const s = getComputedStyle(el);
      return {
        bottom: `${s.borderBottomWidth} ${s.borderBottomStyle} ${s.borderBottomColor}`,
        top: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        left: `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`,
        right: `${s.borderRightWidth} ${s.borderRightStyle} ${s.borderRightColor}`,
      };
    };
    const q = (sel) => document.querySelector(sel);
    const bar = document.querySelector('.sc-shell__sidebar');
    const barStyle = bar === null ? null : getComputedStyle(bar, '::after');
    return {
      topbar: grab(q('.sc-shell__topbar')),
      sidebar: grab(q('.sc-shell__sidebar')),
      sidebarSeam: barStyle === null ? null : { width: barStyle.width, height: barStyle.height, bg: barStyle.backgroundColor, right: barStyle.right, pointerEvents: barStyle.pointerEvents },
      pvRoot: grab(q('.app-editor-col .pv-root')),
      aiChat: grab(q('.ai-chat')),
      mainRow: grab(q('.app-main-row')),
      tabrow: grab(q('.app-tabrow')),
      tabsbar: grab(q('.tabsbar')),
      activeTab: grab(q('.tabsbar-tab--active')),
      theme: document.documentElement.getAttribute('data-theme'),
      inkEdge: getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge').trim(),
    };
  });

/** §1.3 骑缝几何 + 接缝采样点（窗口坐标）。 */
const SEAM = () =>
  page.evaluate(() => {
    const active = document.querySelector('.tabsbar-tab--active');
    const pv = document.querySelector('.app-editor-col .pv-root');
    const bar = document.querySelector('.tabsbar');
    const tabs = [...document.querySelectorAll('.tabsbar-tab')];
    const body = document.querySelector('.app-side-scroll') ?? document.querySelector('.app-side');
    const ar = active === null ? null : active.getBoundingClientRect();
    const pr = pv === null ? null : pv.getBoundingClientRect();
    const br = bar === null ? null : bar.getBoundingClientRect();
    const last = tabs.length === 0 ? null : tabs[tabs.length - 1].getBoundingClientRect();
    const aStyle = active === null ? null : getComputedStyle(active);
    return {
      activeRect: ar === null ? null : { x: +ar.x.toFixed(2), y: +ar.y.toFixed(2), w: +ar.width.toFixed(2), h: +ar.height.toFixed(2), bottom: +ar.bottom.toFixed(2) },
      pvRect: pr === null ? null : { x: +pr.x.toFixed(2), y: +pr.y.toFixed(2), w: +pr.width.toFixed(2), bottom: +pr.bottom.toFixed(2) },
      barRect: br === null ? null : { x: +br.x.toFixed(2), y: +br.y.toFixed(2), bottom: +br.bottom.toFixed(2) },
      overlapPx: ar === null || pr === null ? null : +(ar.bottom - pr.top).toFixed(2),
      inactiveBottom: last === null ? null : +last.bottom.toFixed(2),
      activeBg: aStyle === null ? null : aStyle.backgroundColor,
      pvBg: pv === null ? null : getComputedStyle(pv).backgroundColor,
      activeBorder: aStyle === null ? null : [aStyle.borderTopWidth, aStyle.borderRightWidth, aStyle.borderBottomWidth, aStyle.borderLeftWidth].join('/'),
      // 采样点：① 活动标签中心（横跨接缝带）② 最后一个标签右侧空白（横跨接缝带）
      sampleActive: ar === null || pr === null ? null : { x: Math.round(ar.x + ar.width / 2), y: Math.round(pr.top + 1) },
      sampleBlank: last === null || pr === null || br === null ? null : { x: Math.round(Math.min(br.right - 4, last.right + 24)), y: Math.round(pr.top + 1) },
      appSideTop: body === null ? null : +body.getBoundingClientRect().top.toFixed(2),
      // 诊断：pv-root 滚动位 / 内容盒起点（接缝采样点是否落在不可滚动的描边带内）
      pvScrollTop: pv === null ? null : pv.scrollTop,
      pvBodyTop: (() => {
        const b = document.querySelector('.app-editor-col .pv-body');
        return b === null ? null : +b.getBoundingClientRect().top.toFixed(2);
      })(),
      stackBelow: (() => {
        const pts = [];
        if (ar !== null && br !== null) pts.push({ tag: 'active', x: Math.round(ar.x + ar.width / 2), y: Math.round(br.bottom + 1) });
        if (br !== null) pts.push({ tag: 'blank', x: Math.round(Math.min(br.right - 4, (tabs.length === 0 ? br.right : tabs[tabs.length - 1].getBoundingClientRect().right) + 24)), y: Math.round(br.bottom + 1) });
        return pts.map((p) => ({
          ...p,
          stack: document.elementsFromPoint(p.x, p.y).slice(0, 3).map((e) => `${e.className || e.tagName}`.slice(0, 40)),
        }));
      })(),
    };
  });

const SHELL_MEASURE = () => {
  const aside = document.querySelector('.sc-shell__sidebar');
  const side = document.querySelector('.app-side');
  const topbar = document.querySelector('.sc-shell__topbar');
  const main = document.querySelector('.sc-shell__main');
  const ar = aside === null ? null : aside.getBoundingClientRect();
  const sr = side === null ? null : side.getBoundingClientRect();
  const tr = topbar === null ? null : topbar.getBoundingClientRect();
  const mr = main === null ? null : main.getBoundingClientRect();
  return {
    sidebarWidth: ar === null ? null : +ar.width.toFixed(1),
    sidebarDisplay: aside === null ? null : getComputedStyle(aside).display,
    sidebarTop: ar === null ? null : +ar.top.toFixed(1),
    appSideWidth: sr === null ? null : +sr.width.toFixed(1),
    topbarLeft: tr === null ? null : +tr.left.toFixed(1),
    topbarRight: tr === null ? null : +tr.right.toFixed(1),
    mainWidth: mr === null ? null : +mr.width.toFixed(1),
    layoutSidebarVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-sidebar').trim(),
    layoutMeasureVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-measure').trim(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    nativeChromeH: Math.round(window.outerHeight - window.innerHeight),
  };
};

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

/** T57 G8-4 原式复跑（红线）。 */
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

const SCROLL_MEASURE = () => {
  const se = document.scrollingElement;
  const side = document.querySelector('.app-side');
  return {
    winScrollH: se.scrollHeight,
    winClientH: se.clientHeight,
    winScrollW: se.scrollWidth,
    winClientW: se.clientWidth,
    sideTop: side === null ? null : +side.getBoundingClientRect().top.toFixed(1),
  };
};

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
    };
  });
}

/** 像素线宽：在 clip 内找「纯 ink 色」的整列（竖直边）/ 整行（水平边）数量。 */
function lineWidth(buf, ink, axis) {
  const img = decodePng(buf);
  const exact = [];
  const near = [];
  const scan = axis === 'col' ? img.width : img.height;
  const span = axis === 'col' ? img.height : img.width;
  for (let i = 0; i < scan; i += 1) {
    let exactAll = true;
    let nearAll = true;
    for (let j = 0; j < span; j += 1) {
      const p = axis === 'col' ? pxAt(img, i, j) : pxAt(img, j, i);
      if (!sameRgb(p, ink.rgb)) exactAll = false;
      const close = Math.abs(p[0] - ink.rgb[0]) <= 24 && Math.abs(p[1] - ink.rgb[1]) <= 24 && Math.abs(p[2] - ink.rgb[2]) <= 24;
      if (!close) nearAll = false;
    }
    if (exactAll) exact.push(i);
    if (nearAll) near.push(i);
  }
  return { size: { w: img.width, h: img.height }, exact: exact.length, near: near.length, exactIdx: exact.slice(0, 8) };
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
info('electron 进程（开跑前）', String(electronCount()));

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
  await page.keyboard.type('T59 像素边框真机取证第一段').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.keyboard.type('T59 像素边框真机取证第二段').catch(() => {});
  await wait(1600);
  const tabs0 = await tabCount();
  const pages0 = await pageCount();
  check(
    'G0-1 夹具成立：真点「新建页面」×2 + 键入正文两段 → 2 标签 / 2 存活页',
    tabs0 === 2 && pages0 === 2,
    `tabs=${String(tabs0)} pages=${String(pages0)}`,
  );
  const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('G0-2 浅色主题就位（夹具 settings.theme=light）', theme0 === 'light', `data-theme=${String(theme0)}`);

  const runBorders = async (label) => {
    const ink = await INK_RGB();
    const b = await BORDERS();
    phases[`borders_${label}`] = { ink, ...b };
    info(`${label} ink-edge（原始）`, JSON.stringify(ink));
    info(`${label} 五处边界 computed（原始）`, JSON.stringify(b));
    const inkRgbStr = ink === null ? '' : `rgb(${ink.rgb.join(', ')})`;
    const is2 = (v) => TRIM(v).startsWith('2px solid ');
    check(
      `G1-1[${label}] §1.2 顶栏下沿 = 2px 实线 + ink-edge 色（${String(ink?.hex)}）`,
      b.topbar !== null && is2(b.topbar.bottom) && TRIM(b.topbar.bottom).includes(inkRgbStr),
      `topbar.bottom=${String(b.topbar?.bottom)}`,
    );
    check(
      `G1-2[${label}] §1.2 侧栏右缘 = 2px ink-edge 接缝条（定位条口径：不占盒模型 —— .app-side 仍 240）`,
      b.sidebarSeam !== null &&
        b.sidebarSeam.width === '2px' &&
        b.sidebarSeam.bg === inkRgbStr &&
        b.sidebarSeam.right === '0px' &&
        b.sidebarSeam.pointerEvents === 'none' &&
        TRIM(b.sidebar.right).startsWith('0px'),
      `seam=${JSON.stringify(b.sidebarSeam)} sidebar.borderRight=${String(b.sidebar?.right)}`,
    );
    check(
      `G1-3[${label}] §1.2 编辑区顶边（.pv-root）= 2px ink-edge，且编辑列不自画左右描边（只画一次）`,
      b.pvRoot !== null &&
        is2(b.pvRoot.top) &&
        TRIM(b.pvRoot.top).includes(inkRgbStr) &&
        TRIM(b.pvRoot.left).startsWith('0px') &&
        TRIM(b.pvRoot.right).startsWith('0px'),
      `pv.root top=${String(b.pvRoot?.top)} left=${String(b.pvRoot?.left)} right=${String(b.pvRoot?.right)}`,
    );
    check(
      `G1-4[${label}] §1.2 相邻边只画一次：标签条行宿主/标签条零下描边（接缝归 .pv-root 独占）`,
      b.tabrow !== null &&
        TRIM(b.tabrow.bottom).startsWith('0px') &&
        b.tabsbar !== null &&
        TRIM(b.tabsbar.bottom).startsWith('0px'),
      `tabrow.bottom=${String(b.tabrow?.bottom)} tabsbar.bottom=${String(b.tabsbar?.bottom)}`,
    );
    return { ink, b, inkRgbStr };
  };

  const pixelSeams = async (label, ink, b) => {
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    // ① 侧栏右缘（纵向）：取中部一段
    const sideX = Math.round(b.sidebar === null ? 0 : await page.evaluate(() => document.querySelector('.sc-shell__sidebar').getBoundingClientRect().right));
    const sidebarClip = { x: Math.max(0, sideX - 8), y: 300, width: 16, height: 40 };
    const sidebarBuf = await shotDsf1(sidebarClip);
    // ② 顶栏下沿（横向）
    const topY = Math.round(await page.evaluate(() => document.querySelector('.sc-shell__topbar').getBoundingClientRect().bottom));
    const topbarClip = { x: 420, y: Math.max(0, topY - 8), width: 40, height: 16 };
    const topbarBuf = await shotDsf1(topbarClip);
    // ③ 编辑区顶边（横向，取视口右侧空白处：活动标签右侧）
    const seam = await page.evaluate(() => {
      const pv = document.querySelector('.app-editor-col .pv-root');
      const bar = document.querySelector('.tabsbar');
      const pr = pv.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const x = Math.round(Math.min(window.innerWidth - 60, br.right + 40));
      return { x, y: Math.round(pr.top) };
    });
    const seamClip = { x: Math.max(0, seam.x - 20), y: Math.max(0, seam.y - 8), width: 40, height: 16 };
    const seamBuf = await shotDsf1(seamClip);
    const w1 = sidebarBuf === null ? null : lineWidth(sidebarBuf, ink, 'col');
    const w2 = topbarBuf === null ? null : lineWidth(topbarBuf, ink, 'row');
    const w3 = seamBuf === null ? null : lineWidth(seamBuf, ink, 'row');
    phases[`pixel_${label}`] = { sidebarClip, topbarClip, seamClip, w1, w2, w3, vp };
    info(`${label} 像素线宽（原始）`, JSON.stringify({ sidebar: w1, topbar: w2, seam: w3 }));
    check(
      `G2-1[${label}] 像素实测：侧栏右缘纵向整列纯 ink 像素 = 2（非 4）`,
      w1 !== null && w1.exact === 2,
      `exact=${String(w1?.exact)} near=${String(w1?.near)} idx=${JSON.stringify(w1?.exactIdx)} clip=${JSON.stringify(sidebarClip)}`,
    );
    check(
      `G2-2[${label}] 像素实测：顶栏下沿横向整行纯 ink 像素 = 2`,
      w2 !== null && w2.exact === 2,
      `exact=${String(w2?.exact)} near=${String(w2?.near)} idx=${JSON.stringify(w2?.exactIdx)} clip=${JSON.stringify(topbarClip)}`,
    );
    check(
      `G2-3[${label}] 像素实测：编辑区顶边横向整行纯 ink 像素 = 2（活动标签之外的空白处）`,
      w3 !== null && w3.exact === 2,
      `exact=${String(w3?.exact)} near=${String(w3?.near)} idx=${JSON.stringify(w3?.exactIdx)} clip=${JSON.stringify(seamClip)}`,
    );
    return { w1, w2, w3, seamClip };
  };

  const fusionChecks = async (label, ink, seamInfo) => {
    const inkRgbStr = `rgb(${ink.rgb.join(', ')})`;
    // 接缝采样（活动标签中心 / 空白处）：用 1×1 clip 截图取真实渲染像素
    const px = async (pt) => {
      const buf = await shotDsf1({ x: pt.x, y: pt.y, width: 1, height: 1 });
      if (buf === null) return null;
      const img = decodePng(buf);
      return pxAt(img, 0, 0);
    };
    const activePx = seamInfo.sampleActive === null ? null : await px(seamInfo.sampleActive);
    const blankPx = seamInfo.sampleBlank === null ? null : await px(seamInfo.sampleBlank);
    phases[`seamSample_${label}`] = { activePx, blankPx, points: { a: seamInfo.sampleActive, b: seamInfo.sampleBlank } };
    info(`${label} 接缝像素采样（原始）`, JSON.stringify({ activePx, blankPx, points: phases[`seamSample_${label}`].points, inkRgbStr }));
    const pvBgRgb = seamInfo.pvBg === null ? null : (/(\d+), (\d+), (\d+)/.exec(seamInfo.pvBg) ?? []).slice(1).map(Number);
    check(
      `G3-1[${label}] §1.3 接缝采样：活动标签中心处像素 = 编辑区底色（非 ink-edge）→ 接缝在此断开`,
      activePx !== null && pvBgRgb !== null && sameRgb(activePx, pvBgRgb) && !sameRgb(activePx, ink.rgb),
      `采样=${JSON.stringify(activePx)} pv-bg=${String(seamInfo.pvBg)} ink=${JSON.stringify(ink.rgb)}`,
    );
    check(
      `G3-2[${label}] §1.3 接缝采样：活动标签右侧空白处像素 = ink-edge → 接缝在其余处可见`,
      blankPx !== null && sameRgb(blankPx, ink.rgb),
      `采样=${JSON.stringify(blankPx)} ink=${JSON.stringify(ink.rgb)}`,
    );
    check(
      `G3-3[${label}] §1.3 骑缝几何：活动标签盒与 .pv-root 顶边重叠/贴边（rect 实测 ≥2px）`,
      seamInfo.overlapPx !== null && seamInfo.overlapPx >= 2,
      `activeBottom-pvTop=${String(seamInfo.overlapPx)}px activeRect=${JSON.stringify(seamInfo.activeRect)} pvRect=${JSON.stringify(seamInfo.pvRect)}`,
    );
    check(
      `G3-4[${label}] §1.3 活动标签 ∏ 轮廓：顶/左/右 2px、下缘 0px、底色 = 编辑区底色`,
      seamInfo.activeBorder === '2px/2px/0px/2px' && seamInfo.activeBg === seamInfo.pvBg,
      `border(上/右/下/左)=${String(seamInfo.activeBorder)} activeBg=${String(seamInfo.activeBg)} pvBg=${String(seamInfo.pvBg)}`,
    );
    const colors = await page.evaluate(FUSION_COLORS);
    phases[`fusionColors_${label}`] = colors;
    info(`${label} T57 G8-4 原式（原始）`, JSON.stringify(colors));
    check(
      `G3-5[${label}] T57 G8-4 复跑：标签连通（无整行分隔线 + 活动标签无下描边 + 底同色 + 下缘命中 pv-root）`,
      colors.barBorderBottom === '0px' &&
        colors.activeBorderBottom === '0px' &&
        colors.activeBg === colors.pvBg &&
        (colors.belowActive ?? '').includes('pv-root'),
      `barBorder=${String(colors.barBorderBottom)} activeBorder=${String(colors.activeBorderBottom)} activeBg=${String(colors.activeBg)} pvBg=${String(colors.pvBg)} below="${String(colors.belowActive)}"`,
    );
  };

  // --- 浅色：边界 + 像素线宽 + 接缝 -----------------------------------------
  STEP = 'G1|light-borders';
  const light = await runBorders('light');
  STEP = 'G2|light-pixels';
  await pixelSeams('light', light.ink, light.b);
  STEP = 'G3|light-seam';
  // 接缝采样点（bar.bottom+1）落在 .pv-root 顶部的 padding 区：T57/T52 原式断言在此处要求命中
  // `.pv-root` —— 仅当正文未滚动（scrollTop=0）时成立。此处先把正文滚回顶（几何断言与滚动位无关），
  // 并把 scrollTop 一并记入原始数据（T52 老断言同款脆弱点，登记为遗留风险）。
  const pvScrollReset = await page.evaluate(() => {
    const pv = document.querySelector('.app-editor-col .pv-root');
    if (pv === null) return null;
    const before = pv.scrollTop;
    pv.scrollTop = 0;
    return { before, after: pv.scrollTop };
  });
  info('正文滚动位复位（接缝采样前置）', JSON.stringify(pvScrollReset));
  await wait(400);
  const lightSeam = await SEAM();
  phases.seam_light = lightSeam;
  info('浅色骑缝几何（原始）', JSON.stringify(lightSeam));
  await fusionChecks('light', light.ink, lightSeam);

  // --- G4 T52/T57 老断言复跑 -------------------------------------------------
  STEP = 'G4|t52-t57-redlines';
  const fusionSide = await page.evaluate(SHELL_MEASURE);
  phases.shell = fusionSide;
  info('T52 通高量测（原始）', JSON.stringify(fusionSide));
  check(
    'G4-1 T52 红线：侧栏通高（top=0 / 宽 240 / 原生菜单 chrome 高 > 0）',
    fusionSide.sidebarTop === 0 && Math.abs(fusionSide.appSideWidth - 240) <= 1 && fusionSide.nativeChromeH > 0,
    `sidebarTop=${String(fusionSide.sidebarTop)} sidebarW=${String(fusionSide.sidebarWidth)} chromeH=${String(fusionSide.nativeChromeH)}`,
  );
  check(
    'G4-2 T52 红线：顶栏左缘 = 侧栏右缘（顶栏不通栏横切侧栏上方）',
    Math.abs((fusionSide.topbarLeft ?? -1) - (fusionSide.sidebarWidth ?? -2)) <= 1 && (fusionSide.topbarLeft ?? 0) > 0,
    `topbarLeft=${String(fusionSide.topbarLeft)} sidebarW=${String(fusionSide.sidebarWidth)} winW=${String(fusionSide.innerWidth)}`,
  );
  const toggle = await page.evaluate(TOGGLE_MEASURE);
  phases.toggle = toggle;
  info('折叠钮量测（原始）', JSON.stringify(toggle));
  check(
    'G4-3 T52 红线：折叠钮在标签行最左（中心 x ∈ [行左, 行左+64]、|Δy| ≤ 2、24px、视口内）',
    toggle !== null &&
      toggle.btnCenterX >= toggle.barLeft &&
      toggle.btnCenterX <= toggle.barLeft + 64 &&
      Math.abs(toggle.btnCenterY - toggle.barCenterY) <= 2 &&
      toggle.btnW === 24 &&
      toggle.inViewport === true,
    toggle === null
      ? 'NULL'
      : `centerX=${String(toggle.btnCenterX)} barLeft=${String(toggle.barLeft)} Δy=${String(Math.abs(toggle.btnCenterY - toggle.barCenterY).toFixed(1))} w=${String(toggle.btnW)} inViewport=${String(toggle.inViewport)}`,
  );
  const gutter = await measureGutter();
  phases.gutter = gutter;
  info('装订线量测（原始）', JSON.stringify(gutter));
  check(
    'G4-4 T33/T52 红线：.pv-body 左侧装订线 70px + 手柄簇↔文本 gutter=12 且无重叠',
    gutter !== null && gutter.bodyPaddingLeft === '70px' && Math.abs(gutter.gutter - 12) <= 0.6 && gutter.overlap === false,
    `bodyPaddingLeft=${String(gutter?.bodyPaddingLeft)} gutter=${String(gutter?.gutter)} overlap=${String(gutter?.overlap)}`,
  );

  // --- G5 1184/894 两宽度零滚动 ---------------------------------------------
  STEP = 'G5|two-widths';
  const cdp = await page.context().newCDPSession(page);
  const rows = [];
  for (const w of WIDTHS) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 0, mobile: false });
    await wait(800);
    rows.push({ w, ...(await page.evaluate(SCROLL_MEASURE)) });
    if (w === 1184) await shot('t59-01-light-main-1184.png');
    if (w === 894) await shot('t59-01-light-main-894.png');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await wait(800);
  phases.widths = rows;
  info('两宽度零滚动（原始）', JSON.stringify(rows));
  check(
    'G5-1 §3：1184/894 两宽度零滚动（纵向 + 横向）且侧栏 top 恒 0',
    rows.every((r) => r.winScrollH <= r.winClientH + 1 && r.winScrollW <= r.winClientW + 1 && r.sideTop === 0),
    rows
      .map((r) => `${String(r.w)}:{h ${String(r.winScrollH)}/${String(r.winClientH)},w ${String(r.winScrollW)}/${String(r.winClientW)},top=${String(r.sideTop)}}`)
      .join(' '),
  );

  // --- G6 浅色截图（主界面 / 接缝放大 / 模态 / AI 面板） ----------------------
  STEP = 'G6|light-shots';
  await wait(600);
  await shot('t59-01-light-main.png');
  const seamBox = await page.evaluate(() => {
    const active = document.querySelector('.tabsbar-tab--active');
    const pv = document.querySelector('.app-editor-col .pv-root');
    const bar = document.querySelector('.tabsbar');
    const ar = active.getBoundingClientRect();
    const pr = pv.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(ar.left - 24, br.right - 320));
    return { x: Math.round(x), y: Math.round(pr.top - 44), width: Math.min(420, Math.round(window.innerWidth - x - 20)), height: 56 };
  });
  const seamZoom = await shotZoom('t59-01-light-seam-zoom6x.png', seamBox, 6);
  info('浅色接缝放大截图', `bytes=${String(seamZoom?.length ?? -1)} clip=${JSON.stringify(seamBox)}`);
  // 模态（布局快选）
  await page.locator('[data-testid="layout-open"]').click({ force: true }).catch(() => {});
  await wait(900);
  const modal = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="layout-picker"]');
    if (el === null) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      role: el.getAttribute('role'),
      borderTop: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      borderLeft: `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    };
  });
  phases.modal = modal;
  info('布局快选弹框（原始）', JSON.stringify(modal));
  check(
    'G6-1 §1.4 浮层 2px：布局快选（模态）外轮廓 = 2px solid ink-edge',
    modal !== null &&
      modal.borderTop.startsWith('2px solid') &&
      modal.borderLeft.startsWith('2px solid') &&
      modal.borderTop.includes(`rgb(${light.ink.rgb.join(', ')})`),
    `borderTop=${String(modal?.borderTop)} borderLeft=${String(modal?.borderLeft)}`,
  );
  if (modal !== null) {
    const mbClip = { x: Math.max(0, modal.rect.x - 6), y: Math.round(modal.rect.y + modal.rect.h / 2 - 5), width: 14, height: 10 };
    const mbBuf = await shotDsf1(mbClip);
    const mw = mbBuf === null ? null : lineWidth(mbBuf, light.ink, 'col');
    phases.modalPixel = { mbClip, mw };
    info('模态左缘像素线宽（原始）', JSON.stringify({ mbClip, mw }));
    check(
      'G6-2 §1.4 浮层 2px：模态左缘像素实测整列纯 ink = 2',
      mw !== null && mw.exact === 2,
      `exact=${String(mw?.exact)} near=${String(mw?.near)} clip=${JSON.stringify(mbClip)}`,
    );
  } else {
    check('G6-2 §1.4 浮层 2px：模态左缘像素实测 = 2', false, '弹框未打开');
  }
  await shot('t59-01-light-modal.png');
  await page.keyboard.press('Escape').catch(() => {});
  await wait(700);
  // AI 面板展开（只点带 AI 标签的那个钮，避免误触其它工具钮）
  const aiOpen = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-topbtn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('AI'),
    );
    if (btn === null || btn === undefined) return false;
    btn.click();
    return true;
  });
  await wait(1200);
  const aiChatOpen = await page.evaluate(() => document.querySelector('.ai-chat') !== null);
  info('AI 面板展开', `clicked=${String(aiOpen)} aiChat=${String(aiChatOpen)}`);
  check('G6-3 §1.8 AI 面板可展开（截图四态之一）', aiChatOpen === true, `aiChat=${String(aiChatOpen)}`);
  if (aiChatOpen) {
    const aiB = await page.evaluate(() => {
      const el = document.querySelector('.ai-chat');
      const s = getComputedStyle(el);
      return {
        left: `${s.borderLeftWidth} ${s.borderLeftStyle} ${s.borderLeftColor}`,
        width: +el.getBoundingClientRect().width.toFixed(1),
      };
    });
    phases.aiBorder = aiB;
    info('AI 面板左缘（原始）', JSON.stringify(aiB));
    check(
      'G6-4 §1.2 AI 面板左缘 = 2px solid ink-edge（真机 computed）',
      aiB.left.startsWith('2px solid') && aiB.left.includes(`rgb(${light.ink.rgb.join(', ')})`),
      `aiChat.left=${String(aiB.left)} width=${String(aiB.width)}`,
    );
    const aiClip = await page.evaluate(() => {
      const r = document.querySelector('.ai-chat').getBoundingClientRect();
      return { x: Math.max(0, Math.round(r.left) - 8), y: Math.round(r.top + r.height / 2 - 6), width: 16, height: 12 };
    });
    const aiBuf = await shotDsf1(aiClip);
    const aiW = aiBuf === null ? null : lineWidth(aiBuf, light.ink, 'col');
    phases.aiPixel = { aiClip, aiW };
    info('AI 面板左缘像素线宽（原始）', JSON.stringify({ aiClip, aiW }));
    check(
      'G6-5 §1.2 AI 面板左缘像素实测整列纯 ink = 2（与侧栏/正文接缝同谱，禁 4px 双拼）',
      aiW !== null && aiW.exact === 2,
      `exact=${String(aiW?.exact)} near=${String(aiW?.near)} clip=${JSON.stringify(aiClip)}`,
    );
  }
  await shot('t59-01-light-ai.png');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-topbtn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('AI'),
    );
    if (btn !== null && btn !== undefined) btn.click();
  });
  await wait(900);

  // --- G7 深色：同套断言 + 截图 ---------------------------------------------
  STEP = 'G7|dark';
  const themeAttr = await setThemeAndReload('dark');
  check('G7-1 深色主题就位（data-theme=dark）', themeAttr === 'dark', `data-theme=${String(themeAttr)}`);
  const dark = await runBorders('dark');
  check(
    'G7-2 §1.1 深色口径：ink-edge = #EDEDED（亮边；近黑底上黑描边不可见，故取亮边）',
    dark.ink !== null && dark.ink.hex.toUpperCase() === '#EDEDED',
    `--sc-color-ink-edge=${String(dark.ink?.hex)} rgb=${JSON.stringify(dark.ink?.rgb)}`,
  );
  await pixelSeams('dark', dark.ink, dark.b);
  await page.evaluate(() => {
    const pv = document.querySelector('.app-editor-col .pv-root');
    if (pv !== null) pv.scrollTop = 0;
  });
  await wait(400);
  const darkSeam = await SEAM();
  phases.seam_dark = darkSeam;
  info('深色骑缝几何（原始）', JSON.stringify(darkSeam));
  await fusionChecks('dark', dark.ink, darkSeam);
  const darkToggle = await page.evaluate(TOGGLE_MEASURE);
  check(
    'G7-3 T52 红线（深色）：折叠钮位置/尺寸/视口内不变',
    darkToggle !== null &&
      darkToggle.btnCenterX >= darkToggle.barLeft &&
      darkToggle.btnCenterX <= darkToggle.barLeft + 64 &&
      Math.abs(darkToggle.btnCenterY - darkToggle.barCenterY) <= 2 &&
      darkToggle.btnW === 24 &&
      darkToggle.inViewport === true,
    darkToggle === null ? 'NULL' : JSON.stringify(darkToggle),
  );
  const darkScroll = await page.evaluate(SCROLL_MEASURE);
  check(
    'G7-4 §3 深色 1184 零滚动（纵向 + 横向）',
    darkScroll.winScrollH <= darkScroll.winClientH + 1 && darkScroll.winScrollW <= darkScroll.winClientW + 1,
    JSON.stringify(darkScroll),
  );
  await wait(600);
  await shot('t59-01-dark-main.png');
  const darkSeamBox = await page.evaluate(() => {
    const active = document.querySelector('.tabsbar-tab--active');
    const pv = document.querySelector('.app-editor-col .pv-root');
    const bar = document.querySelector('.tabsbar');
    const ar = active.getBoundingClientRect();
    const pr = pv.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(ar.left - 24, br.right - 320));
    return { x: Math.round(x), y: Math.round(pr.top - 44), width: Math.min(420, Math.round(window.innerWidth - x - 20)), height: 56 };
  });
  const darkSeamZoom = await shotZoom('t59-01-dark-seam-zoom6x.png', darkSeamBox, 6);
  info('深色接缝放大截图', `bytes=${String(darkSeamZoom?.length ?? -1)} clip=${JSON.stringify(darkSeamBox)}`);
  await page.locator('[data-testid="layout-open"]').click({ force: true }).catch(() => {});
  await wait(900);
  await shot('t59-01-dark-modal.png');
  const darkModal = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="layout-picker"]');
    if (el === null) return null;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      borderTop: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    };
  });
  phases.darkModal = darkModal;
  check(
    'G7-5 §1.4 深色：模态外轮廓 = 2px solid ink-edge（#EDEDED）',
    darkModal !== null && darkModal.borderTop.startsWith('2px solid') && darkModal.borderTop.includes(`rgb(${dark.ink.rgb.join(', ')})`),
    JSON.stringify(darkModal),
  );
  if (darkModal !== null) {
    const mbClip = { x: Math.max(0, darkModal.rect.x - 6), y: Math.round(darkModal.rect.y + darkModal.rect.h / 2 - 5), width: 14, height: 10 };
    const mbBuf = await shotDsf1(mbClip);
    const mw = mbBuf === null ? null : lineWidth(mbBuf, dark.ink, 'col');
    phases.darkModalPixel = { mbClip, mw };
    check(
      'G7-6 §1.4 深色：模态左缘像素实测整列纯 ink = 2',
      mw !== null && mw.exact === 2,
      `exact=${String(mw?.exact)} near=${String(mw?.near)} clip=${JSON.stringify(mbClip)}`,
    );
  }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(700);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-topbtn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('AI'),
    );
    if (btn !== null && btn !== undefined) btn.click();
  });
  await wait(1200);
  await shot('t59-01-dark-ai.png');
  const winShot = await captureWindow(join(SHOTS, 't59-01-window-dark.png'));
  check('G7-7 窗口级补充截图（含标题栏 + 原生菜单栏）', winShot.size > 0, `bytes=${String(winShot.size)} err=${String(winShot.err)}`);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-topbtn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').startsWith('AI'),
    );
    if (btn !== null && btn !== undefined) btn.click();
  });
  await wait(800);
  await setThemeAndReload('light');

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
    task: 'TASK-T59-01 真机取证（主区域像素风黑色边框 + T52 骑缝融合）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method:
      'renderer CDP（playwright-core over --remote-debugging-port）量测/点击/截图 + Emulation.setDeviceMetricsOverride 两宽度与 dsf=1 像素量测 + Page.captureScreenshot clip.scale 放大取证 + main 进程 --inspect desktopCapturer 窗口级补拍',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: [
      't59-01-light-main.png',
      't59-01-light-main-1184.png',
      't59-01-light-main-894.png',
      't59-01-light-seam-zoom6x.png',
      't59-01-light-modal.png',
      't59-01-light-ai.png',
      't59-01-dark-main.png',
      't59-01-dark-seam-zoom6x.png',
      't59-01-dark-modal.png',
      't59-01-dark-ai.png',
      't59-01-window-dark.png',
    ],
    pass: passes,
    fail: fails,
    electronFinal,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T59-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}  electron 最终计数=${String(electronFinal)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
