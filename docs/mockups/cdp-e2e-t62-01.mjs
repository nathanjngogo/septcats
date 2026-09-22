/* cdp-e2e-t62-01.mjs —— TASK-T62-01 真机取证（全局像素黑框线）
 *
 * 范围（对应任务书 §2.4 + §4 DoD）：
 *   G0 夹具自检：隔离夹具（`_scratch/t62-01`）造 1 张普通页 + 1 张 **≥3 列**多维数据页（3 条记录）；
 *   G1 双主题 × 8 组代表屏：每屏 `getComputedStyle` 实测代表框 ——
 *      外框 `borderWidth ≥ 2px && borderColor == ink-edge`、内线 `1px && ink-edge`：
 *        ① 编辑器 + AI 面板（顶栏下沿 / 正文顶边 / 活动标签 / AI 面板左缘 / AI 输入框 / 题栏区隔线 / 侧栏底行线）
 *        ② 设置页（RadioGroup 分段控件 / 分组标题线 / 设置行 hairline / AI provider 卡 / 按钮）
 *        ③ 命令面板（面板外框 / 输入区线 / 虚线占位钮 / 底栏线）
 *        ④ 导入向导（虚线拖放区 / 步骤节点环）
 *        ⑤ 布局编辑器（预设卡 / 大预览 / JSON 域 / 页头线）
 *        ⑥ DbView 表格页（表头外框 / 表体顶边=0「只画一次」/ 单元格网格 1px / 列头分隔 1px / 工具条 chip）
 *        ⑦ 说明书视图（顶栏下沿 / 顶栏钮 / 章表右缘接缝 / h2 横线 / 表格单元格 1px）
 *        ⑧ 关窗询问框（模态外框 2px / 备忘行区隔 1px）
 *   G2 §1.2 **像素线宽实测**：DbView 竖向网格线与表头外框各取 dsf=1 局部截图解码 →
 *      整列纯 ink-edge 像素数 = 1（网格）/ 2（外框）（证明「宽度分层」真机成立）；
 *   G3 §4 **ASCII/像素抽噪判**：DbView 表格区域降采样成 ASCII 墨迹图 + 黑线像素占比，
 *      量化「黑线是否噪到影响阅读」（占比须低）：两主题各出一份；
 *   G4 §1/§4 老成果零回归：T59 的 5 处接缝 + 活动标签骑缝（∉ ink-edge）computed 复跑；
 *   G5 双主题截图：8 组 × 2 主题 = 16 张，存 docs/mockups/screens-t62/；
 *   G6 隔离自检：真档案 `C:\Users\Administrator\.septcats` mtime 前后一致（untouched）；
 *   G7 退出干净 + electron 进程计数 = 0。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t62-01/ 下，绝不读写 PM 真实数据根；
 * - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 * - 一次性探针：只开公开调试端口；不改产品代码、不写产品数据。
 *
 * 运行：node docs/mockups/cdp-e2e-t62-01.mjs
 * 产物：docs/mockups/screens-t62/t62-01-results.json + 16 张 png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t62-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9482;
const INSPECT = 9242;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t62');
const OUT_JSON = join(SHOTS, 't62-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

/* ---------- 最小 PNG 解码（CDP 截图：8bit，RGB/RGBA，非隔行；与 t59 探针同实现） ---------- */
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
          task: 'TASK-T62-01 真机取证（全局像素黑框线）',
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
const electronCount = () => {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /NH', { encoding: 'utf8' });
    return out.split(/\r?\n/).filter((l) => /electron\.exe/i.test(l)).length;
  } catch {
    return 0;
  }
};
const nodeOrphans = () => {
  // T62 PM 修：绝对计数误伤——本机常态有 3 个 workbuddy MCP 宿主 node（sheetagent 等）。
  // 正确口径=相对开跑前基线的**净增**；基线由主流程在 boot 时记录。
  try {
    const out = execSync('wmic process where "name=\'node.exe\'" get ProcessId /format:csv', { encoding: 'utf8' });
    return out.split(/[\r\n]+/).filter((l) => /\d/.test(l) && !/ProcessId/i.test(l)).length;
  } catch {
    return -1;
  }
};
let nodeBaseline = 0;
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

// --- main 进程 inspector（关窗触发询问框用） --------------------------------
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
/** 等价用户点窗口关闭按钮（触发 BrowserWindow 'close' → 关窗询问框）。 */
async function requestClose() {
  return (
    await mainEval(`(() => {
    const { BrowserWindow } = require('electron');
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return 'NO_WINDOW';
    w.close();
    return 'close-requested';
  })()`)
  ).value;
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
    async () =>
      p.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.tree === 'function'),
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

async function reload() {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2400);
}
async function ensureActiveTab() {
  const has = await page.evaluate(() => document.querySelector('.tabsbar-tab--active') !== null);
  if (has) return true;
  await page.locator('.app-nav-row:not(.app-nav-row--head)').first().click({ force: true }).catch(() => {});
  await wait(1400);
  return await page.evaluate(() => document.querySelector('.tabsbar-tab--active') !== null);
}
async function setThemeAndReload(theme) {
  await page.evaluate((t) => window.localStorage.setItem('septcats.theme', t), theme);
  await reload();
  await ensureActiveTab();
  await wait(800);
  return page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? 'null');
}
const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => null);

/** 像素量测用截图：强制 deviceScaleFactor=1（1 设备像素 = 1 CSS 像素）。 */
async function shotDsf1(clip) {
  const s = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const cdpz = await page.context().newCDPSession(page);
  await cdpz.send('Emulation.setDeviceMetricsOverride', {
    width: s.w,
    height: s.h,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(400);
  const buf = await page.screenshot({ clip }).catch(() => null);
  await cdpz.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await cdpz.detach().catch(() => {});
  await wait(400);
  return buf;
}

// --- 量测器 ------------------------------------------------------------------
const INK_RGB = () =>
  page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge').trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw);
    if (hex === null) return null;
    const n = Number.parseInt(hex[1], 16);
    return { hex: raw, rgb: [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] };
  });
const parseRgb = (s) => {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(String(s));
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
};
const sameRgb = (a, b) => a !== null && b !== null && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * 一批代表框的 computed 实测。每个目标给 {key, sel, side, w, dashed?, optional?}。
 * 返回逐条 {key, ok, raw}（含四边原始值，便于报告直贴）。
 */
const probeTargets = (targets) =>
  page.evaluate((list) => {
    const out = [];
    for (const t of list) {
      const el = document.querySelector(t.sel);
      if (el === null) {
        out.push({ key: t.key, sel: t.sel, side: t.side, missing: true });
        continue;
      }
      const s = getComputedStyle(el);
      const cap = t.side.charAt(0).toUpperCase() + t.side.slice(1);
      out.push({
        key: t.key,
        sel: t.sel,
        side: t.side,
        missing: false,
        width: s[`border${cap}Width`],
        style: s[`border${cap}Style`],
        color: s[`border${cap}Color`],
        box: `${s.borderTopWidth}/${s.borderRightWidth}/${s.borderBottomWidth}/${s.borderLeftWidth} ${s.borderTopStyle}`,
      });
    }
    return out;
  }, targets);

/** 单条：宽度 == w 且色 == ink-edge（可选要求线型 dashed）。 */
function judge(t, got, ink) {
  if (got.missing === true) return { ok: t.optional === true ? 'skip' : false, raw: `${t.key} <元素缺失>` };
  const wOk = got.width === t.w;
  const cOk = sameRgb(parseRgb(got.color), ink.rgb);
  const sOk = t.dashed === undefined ? true : got.style === 'dashed';
  return {
    ok: wOk && cOk && sOk,
    raw:
      `${t.key} ${got.side}: ${got.width} ${got.style} ${got.color}` +
      `（期望 ${t.w} solid ${ink.hex}${t.dashed === true ? ' / dashed' : ''}；四边=${got.box}）`,
  };
}

/** 状态机：把一组目标跑成 PASS/FAIL 计数，并把每屏截图落盘。 */
async function runState(STEP_NAME, shotName, targets, ink) {
  STEP = STEP_NAME;
  const got = await probeTargets(targets);
  let pass = 0;
  const fails = [];
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    const g = got[i];
    const v = judge(t, g, ink);
    if (v.ok === true) {
      pass += 1;
      results.push({ step: STEP, name: `${t.key} 框线达标`, ok: true, raw: v.raw });
      console.log(`PASS  [${STEP}] ${v.raw}`);
    } else if (v.ok === 'skip') {
      results.push({ step: STEP, name: `[info] ${t.key} 本屏未渲染（可选目标）`, ok: null, raw: v.raw });
      console.log(`INFO  [${STEP}] ${v.raw}`);
    } else {
      fails.push(v.raw);
      results.push({ step: STEP, name: `${t.key} 框线不达标`, ok: false, raw: v.raw });
      console.log(`FAIL  [${STEP}] ${v.raw}`);
    }
    dump();
  }
  await shot(shotName);
  return { pass, total: targets.length, fails, got };
}

/* ---- 代表框清单（按屏） ---- */
const T = {
  editor: [
    { key: '顶栏下沿', sel: '.sc-shell__topbar', side: 'bottom', w: '2px' },
    { key: '正文顶边', sel: '.app-editor-col .pv-root', side: 'top', w: '2px' },
    { key: '活动标签顶边', sel: '.tabsbar-tab--active', side: 'top', w: '2px' },
    { key: 'AI 面板左缘', sel: '.ai-chat', side: 'left', w: '2px' },
    { key: 'AI 输入框顶边', sel: '.ai-chat__input', side: 'top', w: '2px' },
    { key: 'AI 题栏区隔线', sel: '.ai-chat__head', side: 'bottom', w: '1px' },
    { key: '侧栏底行区隔线', sel: '.app-side-foot', side: 'top', w: '1px' },
  ],
  settings: [
    { key: '分段控件外框', sel: '.sc-radio-group', side: 'top', w: '2px' },
    { key: '分组标题分隔线', sel: '.settings-legend', side: 'bottom', w: '1px' },
    { key: '设置行 hairline', sel: '.settings-row', side: 'bottom', w: '1px' },
    { key: 'AI provider 卡外框', sel: '.settings-ai-card', side: 'top', w: '2px', optional: true },
    { key: '次按钮外框', sel: '.sc-btn--secondary', side: 'top', w: '2px', optional: true },
    { key: '主按钮外框', sel: '.sc-btn--primary', side: 'top', w: '2px', optional: true },
  ],
  palette: [
    { key: '命令面板外框', sel: '.palette', side: 'top', w: '2px' },
    { key: '输入区下区隔线', sel: '.palette-input', side: 'bottom', w: '1px' },
    { key: '虚线占位钮', sel: '.palette-opensearch', side: 'top', w: '2px', dashed: true },
    { key: '面板底栏区隔线', sel: '.palette-foot', side: 'top', w: '1px' },
  ],
  import: [
    { key: '虚线拖放区', sel: '.wiz-drop', side: 'top', w: '2px', dashed: true },
    { key: '步骤节点环', sel: '.wiz-sp-no', side: 'top', w: '2px' },
    { key: '步骤节点环（当前）', sel: '.wiz-sp--on .wiz-sp-no', side: 'top', w: '2px', optional: true },
  ],
  layout: [
    { key: '预设卡外框', sel: '.layout-editor__card', side: 'top', w: '2px' },
    { key: '大预览面板外框', sel: '.layout-editor__preview', side: 'top', w: '2px' },
    { key: 'JSON 编辑域外框', sel: '.layout-editor__json', side: 'top', w: '2px' },
    { key: '页头区隔线', sel: '.layout-editor__bar', side: 'bottom', w: '1px' },
  ],
  db: [
    { key: '表头外框', sel: '.sc-dbgrid__header', side: 'top', w: '2px' },
    { key: '表体顶边（只画一次）', sel: '.sc-dbgrid__body', side: 'top', w: '0px' },
    { key: '单元格网格线', sel: '.sc-dbcell', side: 'right', w: '1px' },
    { key: '列头分隔线', sel: '.sc-dbhead__cell', side: 'right', w: '1px' },
    { key: '工具条 chip 外框', sel: '.sc-chip', side: 'top', w: '2px', optional: true },
    { key: '标签外框', sel: '.sc-dbtag--neutral', side: 'top', w: '2px', optional: true },
  ],
  manual: [
    { key: '顶栏下沿', sel: '.manual-view__bar', side: 'bottom', w: '2px' },
    { key: '顶栏钮外框', sel: '.manual-view__toggle', side: 'top', w: '2px' },
    { key: '章表右缘接缝', sel: '.manual-view__anchors', side: 'right', w: '2px' },
    { key: 'h2 横线', sel: '.manual-view__h2', side: 'bottom', w: '2px', optional: true },
    { key: '表格单元格网格', sel: '.manual-view__table th', side: 'top', w: '1px', optional: true },
  ],
  closeAsk: [
    { key: '询问框外框', sel: '.close-ask', side: 'top', w: '2px' },
    { key: '备忘行区隔线', sel: '.close-ask__remember', side: 'top', w: '1px' },
  ],
};

/* ---- 导航助手 ---- */
async function openPalette(alias) {
  await page.keyboard.press('Control+k').catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('.palette') !== null), 8000);
  const input = page.locator('.palette-input input').first();
  await input.fill('').catch(() => {});
  if (alias !== undefined) await input.type(alias, { delay: 30 }).catch(() => {});
  await wait(700);
}
async function closePalette() {
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
  await waitFor(async () => page.evaluate(() => document.querySelector('.palette') === null), 6000);
}
async function runPalette(alias, readySel, label) {
  await openPalette(alias);
  const row = page.locator('.palette-row').first();
  const n = await row.count();
  if (n === 0) return { ran: false, why: `无候选行（alias=${alias}）` };
  await row.click({ force: true }).catch(() => {});
  const ok = await waitFor(async () => page.evaluate((s) => document.querySelector(s) !== null, readySel), 12000);
  await wait(900);
  return { ran: ok, why: `${label}=${String(ok)}` };
}
/** 保证 AI 面板处于展开态（开合态跨 reload 由 layout 持久化，故先探测再切）。 */
async function ensureAiPanel() {
  const has = await page.evaluate(() => document.querySelector('.ai-chat') !== null);
  if (!has) {
    await page.keyboard.press('Control+j').catch(() => {});
    await wait(1500);
  }
  return page.evaluate(() => document.querySelector('.ai-chat') !== null);
}

async function openNormalPage() {
  // T62 PM 修：db/manual 轮后激活页非普通页 → reload 还原到 DbPage（无 .pv-root）。
  // 按夹具标题点回普通页，保证编辑器态成立。
  const row = page.locator('.app-nav-row', { hasText: 'T62 普通页' }).first();
  if (await row.count().catch(() => 0) > 0) await row.click({ force: true }).catch(() => {});
  else await page.locator('.app-nav-row:not(.app-nav-row--head)').first().click({ force: true }).catch(() => {});
  await wait(1400);
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-editor-col .pv-root') !== null), 10000);
}
async function backToEditor() {
  await page.locator('.app-nav-row:not(.app-nav-row--head)').first().click({ force: true }).catch(() => {});
  await wait(1400);
  await ensureActiveTab();
  await wait(700);
}

/* ---- 断言清单执行（单主题一轮） ---- */
async function themeRound(theme) {
  const ink = await INK_RGB();
  info(`${theme} ink-edge（原始）`, JSON.stringify(ink));
  const rounds = [];
  let frames = 0;

  // ① 编辑器 + AI 面板
  await openNormalPage(); // T62 PM 修：普通页态保证（reload 会还原最后激活页）
  const aiOpen = await ensureAiPanel();
  info(`${theme} AI 面板展开`, String(aiOpen));
  let r = await runState(`G1|editor|${theme}`, `t62-01-${theme}-editor.png`, T.editor, ink);
  rounds.push({ state: 'editor', ...r });
  frames += r.pass;

  // ② 命令面板
  await openPalette('链接'); // T62 PM 修：query 非空才渲染 .palette-opensearch
  r = await runState(`G1|palette|${theme}`, `t62-01-${theme}-palette.png`, T.palette, ink);
  rounds.push({ state: 'palette', ...r });
  frames += r.pass;
  await closePalette();

  // ③ 设置页
  await runPalette('settings', '[data-testid="settings-page"]', 'settingsOpen');
  await wait(800);
  r = await runState(`G1|settings|${theme}`, `t62-01-${theme}-settings.png`, T.settings, ink);
  rounds.push({ state: 'settings', ...r });
  frames += r.pass;

  // ④ 布局编辑器（从设置页经命令面板进入）
  const le = await runPalette('layout editor', '[data-testid="layout-editor"]', 'layoutEditorOpen');
  if (le.ran) {
    // T62 PM 修：JSON 编辑域=「导入布局」Dialog 内 textarea（导出走剪贴板不出 DOM）
    await page.locator('button.sc-btn', { hasText: /导入|Import/i }).last().click({ force: true }).catch(() => {});
    await waitFor(async () => page.evaluate(() => document.querySelector('.layout-editor__json') !== null), 6000);
    r = await runState(`G1|layout|${theme}`, `t62-01-${theme}-layout.png`, T.layout, ink);
    await page.keyboard.press('Escape').catch(() => {});
    await wait(400);
    rounds.push({ state: 'layout', ...r });
    frames += r.pass;
    await page.locator('[data-testid="layout-editor-done"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  } else {
    info('布局编辑器未打开', le.why);
  }
  await backToEditor();

  // ⑤ 导入向导
  const iw = await runPalette('import', '.wiz', 'importOpen');
  if (iw.ran) {
    r = await runState(`G1|import|${theme}`, `t62-01-${theme}-import.png`, T.import, ink);
    rounds.push({ state: 'import', ...r });
    frames += r.pass;
  } else {
    info('导入向导未打开', iw.why);
  }
  await backToEditor();

  // ⑥ 说明书视图
  const mv = await runPalette('manual', '[data-testid="manual-view"]', 'manualOpen');
  if (mv.ran) {
    r = await runState(`G1|manual|${theme}`, `t62-01-${theme}-manual.png`, T.manual, ink);
    rounds.push({ state: 'manual', ...r });
    frames += r.pass;
    await page.locator('[data-testid="manual-close"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  } else {
    info('说明书视图未打开', mv.why);
  }
  await backToEditor();

  // ⑦ DbView 表格页
  STEP = `G1|db|${theme}`;
  const dbRow = await page.locator('[data-testid^="side-node-"]').filter({ hasText: DB_TITLE }).first();
  if ((await dbRow.count()) > 0) {
    await dbRow.click({ force: true }).catch(() => {});
  }
  await waitFor(async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null), 15000);
  await wait(900);
  r = await runState(`G1|db|${theme}`, `t62-01-${theme}-db.png`, T.db, ink);
  rounds.push({ state: 'db', ...r });
  frames += r.pass;

  // ⑧ 关窗询问框
  STEP = `G1|ask|${theme}`;
  await requestClose();
  const asked = await waitFor(
    async () => page.evaluate(() => document.querySelector('[data-testid="close-ask"]') !== null),
    12000,
  );
  if (asked) {
    r = await runState(`G1|ask|${theme}`, `t62-01-${theme}-ask.png`, T.closeAsk, ink);
    rounds.push({ state: 'ask', ...r });
    frames += r.pass;
    await page.locator('[data-testid="close-ask-cancel"]').first().click({ force: true }).catch(() => {});
    await wait(1200);
  } else {
    info('询问框未出现', `theme=${theme}`);
  }

  return { ink, rounds, frames };
}

/** §1.2 像素线宽：DbView 竖向网格线 = 1px、表头外框 = 2px（dsf=1 真像素）。 */
async function pixelWidthProof(ink) {
  const geo = await page.evaluate(() => {
    const cell = document.querySelector('.sc-dbcell');
    const head = document.querySelector('.sc-dbgrid__header');
    if (cell === null || head === null) return null;
    const c = cell.getBoundingClientRect();
    const h = head.getBoundingClientRect();
    return {
      cellRight: c.right,
      cellTop: c.top,
      cellH: c.height,
      headTop: h.top,
      headLeft: h.left,
      headW: h.width,
    };
  });
  if (geo === null) return { ok: false, raw: '表格几何取不到' };
  // 网格线：跨越单元格右边界的窄条
  const v = await shotDsf1({
    x: Math.round(geo.cellRight) - 3,
    y: Math.round(geo.cellTop) + 4,
    width: 6,
    height: Math.max(6, Math.min(24, Math.round(geo.cellH) - 8)),
  });
  // 表头外框：表头顶边
  const hz = await shotDsf1({
    x: Math.round(geo.headLeft) + 20,
    y: Math.round(geo.headTop) - 2,
    width: 40,
    height: 6,
  });
  const countCols = (buf) => {
    if (buf === null) return -1;
    const img = decodePng(buf);
    let cols = 0;
    for (let x = 0; x < img.width; x += 1) {
      let all = true;
      for (let y = 0; y < img.height; y += 1) if (!sameRgb(pxAt(img, x, y), ink.rgb)) all = false;
      if (all) cols += 1;
    }
    return cols;
  };
  const countRows = (buf) => {
    if (buf === null) return -1;
    const img = decodePng(buf);
    let rows = 0;
    for (let y = 0; y < img.height; y += 1) {
      let all = true;
      for (let x = 0; x < img.width; x += 1) if (!sameRgb(pxAt(img, x, y), ink.rgb)) all = false;
      if (all) rows += 1;
    }
    return rows;
  };
  return { ok: true, gridCols: countCols(v), headRows: countRows(hz) };
}

/** §4 ASCII/像素抽噪判：DbView 表格区域降采样成墨迹图 + 黑线像素占比。 */
async function asciiNoise(ink, theme) {
  const geo = await page.evaluate(() => {
    const body = document.querySelector('.sc-dbgrid__body');
    if (body === null) return null;
    const r = body.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (geo === null) return { ok: false, raw: '表体取不到' };
  const CW = 360;
  const CH = 200;
  const buf = await shotDsf1({
    x: Math.round(geo.x),
    y: Math.round(geo.y),
    width: Math.min(CW, Math.round(geo.w)),
    height: Math.min(CH, Math.round(geo.h)),
  });
  if (buf === null) return { ok: false, raw: '抽噪截图失败' };
  const img = decodePng(buf);
  const CELL = 4;
  const cols = Math.floor(img.width / CELL);
  const rows = Math.floor(img.height / CELL);
  const RAMP = ' .:-=+*#%@';
  const lines = [];
  let inkPx = 0;
  let total = 0;
  for (let cy = 0; cy < rows; cy += 1) {
    let line = '';
    for (let cx = 0; cx < cols; cx += 1) {
      let dark = 0;
      let n = 0;
      for (let y = 0; y < CELL; y += 1) {
        for (let x = 0; x < CELL; x += 1) {
          const px = pxAt(img, cx * CELL + x, cy * CELL + y);
          const lum = (px[0] * 0.299 + px[1] * 0.587 + px[2] * 0.114) / 255;
          dark += 1 - lum;
          n += 1;
          total += 1;
          if (sameRgb(px, ink.rgb)) inkPx += 1;
        }
      }
      const density = dark / n;
      line += RAMP[Math.min(RAMP.length - 1, Math.round(density * (RAMP.length - 1)))];
    }
    lines.push(line);
  }
  const inkShare = total === 0 ? 1 : inkPx / total;
  const asciiFile = join(SHOTS, `t62-01-${theme}-db-ascii.txt`);
  writeFileSync(asciiFile, lines.join('\n') + '\n', 'utf8');
  return { ok: true, inkShare, lines, size: `${String(img.width)}x${String(img.height)}` };
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
rmSync(SHOTS, { recursive: true, force: true });
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
nodeBaseline = nodeOrphans();
info('node 孤儿进程（开跑前基线）', String(nodeBaseline));

const DB_TITLE = 'T62 黑框线数据页';
const phases = {};
let boot = null;
let exitInfo = { gracefulExited: null, forced: null };
try {
  STEP = 'G0|boot';
  boot = await launch();
  page = boot.page;
  info('main inspector', await connectInspector());

  // --- G0 夹具 --------------------------------------------------------------
  STEP = 'G0|fixture';
  const fixture = await page.evaluate(async (dbTitle) => {
    const ws = await window.septcats.workspaces.list();
    const wsId = ws.activeId;
    const plain = await window.septcats.pages.create({ parentId: null });
    await window.septcats.pages.rename({ id: plain.id, title: 'T62 普通页' });
    const db = await window.septcats.db.create({ workspaceId: wsId, title: dbTitle });
    await window.septcats.db.propAdd({ pageId: db.pageId, type: 'checkbox' });
    await window.septcats.db.propAdd({ pageId: db.pageId, type: 'number' });
    await window.septcats.db.propAdd({ pageId: db.pageId, type: 'text' });
    const loaded = await window.septcats.db.load({ pageId: db.pageId });
    const props = Object.entries(loaded.collection.schema.properties).map(([id, p]) => ({ id, type: p.type }));
    const titlePid = loaded.collection.schema.title_pid;
    const cb = props.find((p) => p.type === 'checkbox')?.id ?? null;
    const num = props.find((p) => p.type === 'number')?.id ?? null;
    const txt = props.find((p) => p.type === 'text')?.id ?? null;
    for (const n of [1, 2, 3]) {
      await window.septcats.db.recordCreate({
        pageId: db.pageId,
        values: { [titlePid]: `记录${String(n)}`, [cb]: n % 2 === 0, [num]: n * 5, [txt]: `文本${String(n)}` },
      });
    }
    return { wsId, plainPageId: plain.id, dbPageId: db.pageId, cols: props.length + 1 };
  }, DB_TITLE);
  phases.fixture = fixture;
  info('夹具对象（原始）', JSON.stringify(fixture));
  await reload();
  check('G0-1 夹具成立：多维数据页含 ≥3 列（title + 3 属性）', fixture.cols >= 4, `cols=${String(fixture.cols)}`);
  const themeNow = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  check('G0-2 浅色主题就位（夹具 settings.theme=light）', themeNow === 'light', `data-theme=${String(themeNow)}`);

  // --- G1 浅色一轮 ----------------------------------------------------------
  const light = await themeRound('light');
  phases.light = { ink: light.ink, frames: light.frames, rounds: light.rounds.map((x) => ({ state: x.state, pass: x.pass, total: x.total, fails: x.fails })) };
  check(
    'G1-light 代表框 computed 达标数 ≥12（外框 2px + 内线 1px，色 == ink-edge）',
    light.frames >= 12,
    `pass=${String(light.frames)}（逐屏：${light.rounds.map((x) => `${x.state} ${String(x.pass)}/${String(x.total)}`).join(' / ')}）`,
  );

  // --- G2 像素线宽 + G3 ASCII 抽噪（浅） ------------------------------------
  STEP = 'G2|width-light';
  await backToEditor();
  await page.locator('[data-testid^="side-node-"]').filter({ hasText: DB_TITLE }).first().click({ force: true }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null), 15000);
  await wait(900);
  const pwLight = await pixelWidthProof(light.ink);
  phases.pixelWidthLight = pwLight;
  check(
    'G2-1-light §1.2 宽度分层真机成立：DbView 竖向网格线 = 1 像素、表头外框 = 2 像素',
    pwLight.ok === true && pwLight.gridCols === 1 && pwLight.headRows === 2,
    JSON.stringify(pwLight),
  );
  const nzLight = await asciiNoise(light.ink, 'light');
  if (nzLight.ok === true) {
    info('G3-light DbView ASCII 墨迹图（原始）', `\n${nzLight.lines.join('\n')}`);
    check(
      'G3-1-light §4 抽噪判：表格区域黑线像素占比低（黑线成网格但不淹没内容）',
      nzLight.inkShare < 0.25,
      `inkShare=${(nzLight.inkShare * 100).toFixed(2)}% 区域=${nzLight.size} 阈值<25%`,
    );
  }

  // --- G1 深色一轮 ----------------------------------------------------------
  const darkTheme = await setThemeAndReload('dark');
  check('G1-dark 深色主题就位', darkTheme === 'dark', `data-theme=${String(darkTheme)}`);
  const dark = await themeRound('dark');
  phases.dark = { ink: dark.ink, frames: dark.frames, rounds: dark.rounds.map((x) => ({ state: x.state, pass: x.pass, total: x.total, fails: x.fails })) };
  check(
    'G1-dark 代表框 computed 达标数 ≥12（深色口径：外框 2px + ink-edge 亮边 #EDEDED）',
    dark.frames >= 12,
    `pass=${String(dark.frames)}（逐屏：${dark.rounds.map((x) => `${x.state} ${String(x.pass)}/${String(x.total)}`).join(' / ')}）`,
  );

  STEP = 'G2|width-dark';
  await backToEditor();
  await page.locator('[data-testid^="side-node-"]').filter({ hasText: DB_TITLE }).first().click({ force: true }).catch(() => {});
  await waitFor(async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null), 15000);
  await wait(900);
  const pwDark = await pixelWidthProof(dark.ink);
  phases.pixelWidthDark = pwDark;
  check(
    'G2-1-dark §1.2 深色同口径：网格线 1 像素 / 外框 2 像素',
    pwDark.ok === true && pwDark.gridCols === 1 && pwDark.headRows === 2,
    JSON.stringify(pwDark),
  );
  const nzDark = await asciiNoise(dark.ink, 'dark');
  if (nzDark.ok === true) {
    info('G3-dark DbView ASCII 墨迹图（原始）', `\n${nzDark.lines.join('\n')}`);
    check(
      'G3-1-dark §4 抽噪判：深色表格区域黑线像素占比低',
      nzDark.inkShare < 0.25,
      `inkShare=${(nzDark.inkShare * 100).toFixed(2)}% 区域=${nzDark.size} 阈值<25%`,
    );
  }

  // --- G4 T59 老成果零回归 --------------------------------------------------
  STEP = 'G4|regression';
  await setThemeAndReload('light');
  await openNormalPage(); // T62 PM 修：G4 接缝量测需普通页态
  const reg = await page.evaluate(() => {
    const g = (sel, side) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const s = getComputedStyle(el);
      const cap = side.charAt(0).toUpperCase() + side.slice(1);
      return `${s[`border${cap}Width`]} ${s[`border${cap}Style`]} ${s[`border${cap}Color`]}`;
    };
    const tabsbar = document.querySelector('.tabsbar');
    const active = document.querySelector('.tabsbar-tab--active');
    return {
      topbar: g('.sc-shell__topbar', 'bottom'),
      pvRoot: g('.app-editor-col .pv-root', 'top'),
      tabLeft: g('.tabsbar-tab', 'left'),
      activeBox: tabsbar === null || active === null ? null : `${active.getBoundingClientRect().top} vs ${tabsbar.getBoundingClientRect().top}`,
      activeBottomBorder: active === null ? null : getComputedStyle(active).borderBottomWidth,
      sidebarBar: (() => {
        const sb = document.querySelector('.sc-shell__sidebar');
        return sb === null ? null : getComputedStyle(sb, '::after').backgroundColor;
      })(),
    };
  });
  phases.t59Regression = reg;
  info('T59 零回归（原始）', JSON.stringify(reg));
  check(
    'G4-1 T59 五处接缝零回归：顶栏下沿 / 正文顶边 / 非活动标签左描边仍为 2px ink-edge',
    reg.topbar === '2px solid rgb(26, 26, 26)' &&
      reg.pvRoot === '2px solid rgb(26, 26, 26)' &&
      reg.tabLeft === '2px solid rgb(26, 26, 26)',
    JSON.stringify({ topbar: reg.topbar, pvRoot: reg.pvRoot, tabLeft: reg.tabLeft }),
  );
  check(
    'G4-2 T52 骑缝融合零回归：活动标签下缘无边（∏ 形轮廓），侧栏右缘接缝条仍为 ink-edge',
    reg.activeBottomBorder === '0px' && reg.sidebarBar === 'rgb(26, 26, 26)',
    `activeBottomBorder=${String(reg.activeBottomBorder)} sidebarBar=${String(reg.sidebarBar)}`,
  );

  // --- G6/G7 收尾 -----------------------------------------------------------
  STEP = 'G6|isolation';
  const realRootMtimeAfter = (() => {
    try {
      return String(statSync(REAL_ROOT).mtimeMs);
    } catch {
      return 'absent';
    }
  })();
  check(
    'G6-1 真档案只读：C:\\Users\\Administrator\\.septcats mtime 前后一致',
    realRootMtimeBefore === realRootMtimeAfter,
    `before=${realRootMtimeBefore} after=${realRootMtimeAfter}`,
  );

  exitInfo = await quit(boot.pid, boot.browser);
  STEP = 'G7|teardown';
  await wait(1500);
  const ec = electronCount();
  check('G7-1 退出干净：优雅退出（window.close）且 electron 进程计数 = 0', exitInfo.gracefulExited === true && ec === 0, `graceful=${String(exitInfo.gracefulExited)} forced=${String(exitInfo.forced)} electron=${String(ec)}`);
  check('G7-2 探针自身零 node 泄漏（净增=0；基线=workbuddy MCP 宿主 3 个）', nodeOrphans() <= nodeBaseline, `now=${String(nodeOrphans())} baseline=${String(nodeBaseline)}`);

  const shotsMade = (() => {
    try {
      return readdirSyncSafe(SHOTS).filter((f) => f.endsWith('.png')).length;
    } catch {
      return -1;
    }
  })();
  check('G5-1 截图落地：8 组 × 2 主题 = 16 张', shotsMade === 16, `pngCount=${String(shotsMade)}`);
} catch (e) {
  info('主流程异常（原始）', String(e?.stack ?? e));
} finally {
  if (boot !== null && exitInfo.gracefulExited === null) {
    exitInfo = await quit(boot.pid, boot.browser).catch(() => ({ gracefulExited: false, forced: true }));
  }
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        task: 'TASK-T62-01 真机取证（全局像素黑框线）',
        partial: false,
        ranAt: new Date().toISOString(),
        fixture: phases.fixture ?? null,
        rounds: { light: phases.light ?? null, dark: phases.dark ?? null },
        pixelWidth: { light: phases.pixelWidthLight ?? null, dark: phases.pixelWidthDark ?? null },
        t59Regression: phases.t59Regression ?? null,
        teardown: exitInfo,
        assertions: results,
      },
      null,
      2,
    ),
    'utf8',
  );
  const fails = results.filter((r) => r.ok === false);
  console.log(
    `\n==== T62-01 探针收束：PASS ${String(results.filter((r) => r.ok === true).length)} / FAIL ${String(fails.length)} / INFO ${String(results.filter((r) => r.ok === null).length)} ====`,
  );
  for (const f of fails) console.log(`FAIL  [${f.step}] ${f.name}\n      ${f.raw}`);
}

function readdirSyncSafe(dir) {
  return readdirSync(dir);
}
