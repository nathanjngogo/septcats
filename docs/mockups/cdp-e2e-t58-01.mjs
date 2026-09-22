/* cdp-e2e-t58-01.mjs —— TASK-T58-01 真机取证（AI 钮像素化 + 全仓图标像素族接线）
 *
 * 范围：
 *   G0 夹具：隔离 user-data-dir + rootPath（_scratch/t58-01/），真档案只读自检；
 *   G1 顶栏图标钮全量 = 像素族（viewBox 0 0 16 16 + crispEdges + rect 网格，一个不漏）；
 *   G2 工具条图标**像素级证据**：AI 钮区域 8× 放大截图 → 逐像素采样 —— 全部像素必须落在
 *      「底色 ∪ 前景×合法 opacity 档」的离散集合里（硬边、零抗锯齿中间色），并把渲染掩码
 *      与像素 glyph 资产矩阵逐格比对（不只看截图好看）；
 *   G3 AI 钮两态**明暗实测**：关态 getComputedStyle(眼/天线).opacity = 0.35/0.55、
 *      开态 = 1/1；两态下 glyph 几何完全一致（只有明暗变）；面板标题图标同族；
 *   G4 截图 ≥4 张：浅色主界面 / 顶栏放大 / AI 面板开（浅）/ 深色主界面 / 设置页（浅）→ screens-t58/；
 *   G5 退出干净：window.close() 优雅退出（未强杀才 PASS）。
 *
 * 纪律（同 T52/T53 探针）：
 *  - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build`，electron ABI）；
 *  - 数据隔离：一切读写都在 _scratch/t58-01/ 下，绝不碰 C:\Users\Administrator\.septcats\，
 *    并做 mtime 前后自检；
 *  - 优雅退出只用 window.close()；未退出才强杀（如实记录）；
 *  - 一次性探针：只开公开调试端口，不改产品代码。
 *
 * 运行：node docs/mockups/cdp-e2e-t58-01.mjs
 * 产物：docs/mockups/screens-t58/t58-01-results.json + 截图
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main')) ? join(REPO, 'apps', 'desktop') : join(MAIN_REPO, 'apps', 'desktop');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t58-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9477;
const INSPECT = 9237;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t58');
const OUT_JSON = join(SHOTS, 't58-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const AI_LABEL = 'AI 对话（Ctrl+J）';

/* ---------- 运行时 glyph 矩阵（从源码解析，避免 import 资产脚本的写盘副作用） ---------- */
function parseRuntimeGlyphs(src) {
  const block = /export const PIXEL_GLYPHS = \{([\s\S]*?)\n\} as const satisfies/.exec(src);
  if (block === null) throw new Error('pixelIcons.tsx 未找到 PIXEL_GLYPHS 块');
  const out = new Map();
  for (const m of block[1].matchAll(/^ {2}(\w+): \[\r?\n([\s\S]*?)^ {2}\],/gm)) {
    out.set(m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1]));
  }
  return out;
}
function parseOpacityTable(src) {
  const m = /export const TONE_OPACITY = \{([^}]*)\}/.exec(src);
  if (m === null) throw new Error('pixelIcons.tsx 未找到 TONE_OPACITY');
  const table = new Map();
  for (const pair of m[1].matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)) table.set(Number(pair[1]), Number(pair[2]));
  return table;
}
const UI_SRC = readFileSync(join(REPO, 'packages', 'ui', 'src', 'pixelIcons.tsx'), 'utf8');
const GLYPHS = parseRuntimeGlyphs(UI_SRC);
const TONE_OPACITY = parseOpacityTable(UI_SRC);
const OPACITY_OF_CHAR = new Map([['#', TONE_OPACITY.get(1)], ['o', TONE_OPACITY.get(0.45)], ['x', TONE_OPACITY.get(0.3)]]);

/* ---------- 最小 PNG 解码（CDP 截图：8bit，RGB/RGBA，非隔行） ---------- */
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
      JSON.stringify({ task: 'TASK-T58-01 真机取证（AI 钮像素化 + 全仓图标像素族）', partial: true, ranAt: new Date().toISOString(), assertions: results }, null, 2),
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

let page = null;
async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, `--inspect=${String(INSPECT)}`], {
    cwd: APPDIR,
    detached: false,
    stdio: 'ignore',
  });
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

const shot = (name) => page.screenshot({ path: join(SHOTS, name) }).catch(() => null);
const shotClip = (name, clip) => page.screenshot({ path: join(SHOTS, name), clip }).catch(() => null);
/** 放大截图：走 CDP `Page.captureScreenshot` 的 clip.scale（矢量重采样到 N 倍设备像素，
 *  crispEdges 的 rect 在整数倍下仍是硬边）。返回 PNG Buffer 供逐像素采样。 */
async function shotZoom(name, clip, scale) {
  if (clip === undefined) return null;
  const cdp = await page.context().newCDPSession(page);
  const result = await cdp
    .send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale } })
    .catch(() => null);
  await cdp.detach().catch(() => {});
  if (result === null || typeof result.data !== 'string') return null;
  const buf = Buffer.from(result.data, 'base64');
  writeFileSync(join(SHOTS, name), buf);
  return buf;
}

/** 按可访问名点击顶栏图标钮（避免 CSS 选择器里塞 CJK/括号）。 */
const clickAi = () =>
  page.evaluate((label) => {
    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-iconbtn')].find((n) => n.getAttribute('aria-label') === label);
    if (btn === undefined) return false;
    btn.click();
    return true;
  }, AI_LABEL);

const boxOf = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.left.toFixed(2), y: +r.top.toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
  }, selector);

const AI_PROBE = () =>
  page.evaluate((label) => {    const btn = [...document.querySelectorAll('.sc-shell__actions .sc-iconbtn')].find(
      (n) => n.getAttribute('aria-label') === label,
    );
    if (btn === undefined) return null;
    const svg = btn.querySelector('svg');
    const eye = btn.querySelector('.sc-icon__eye');
    const antenna = btn.querySelector('.sc-icon__antenna');
    const rectOf = (r) => ({ x: r.getAttribute('x'), y: r.getAttribute('y'), w: r.getAttribute('width'), op: r.getAttribute('opacity') });
    const sr = svg.getBoundingClientRect();
    return {
      pressed: btn.getAttribute('aria-pressed'),
      viewBox: svg.getAttribute('viewBox'),
      shapeRendering: svg.getAttribute('shape-rendering'),
      strokeWidth: svg.getAttribute('stroke-width'),
      rectCount: svg.querySelectorAll('rect').length,
      eyeOpacity: eye === null ? null : getComputedStyle(eye).opacity,
      antennaOpacity: antenna === null ? null : getComputedStyle(antenna).opacity,
      eyeRects: [...btn.querySelectorAll('.sc-icon__eye rect')].map(rectOf),
      antennaRects: [...btn.querySelectorAll('.sc-icon__antenna rect')].map(rectOf),
      allRects: [...svg.querySelectorAll('rect')].map(rectOf),
      iconBox: { x: +sr.left.toFixed(2), y: +sr.top.toFixed(2), width: +sr.width.toFixed(2), height: +sr.height.toFixed(2) },
      buttonBox: (() => {
        const b = btn.getBoundingClientRect();
        return { x: +b.left.toFixed(2), y: +b.top.toFixed(2), width: +b.width.toFixed(2), height: +b.height.toFixed(2) };
      })(),
      color: getComputedStyle(svg).color,
    };
  }, AI_LABEL);

const TOOLBAR_AUDIT = () =>
  page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.sc-shell__actions .sc-iconbtn')];
    return {
      count: buttons.length,
      rows: buttons.map((b) => {
        const svg = b.querySelector('svg');
        return {
          label: b.getAttribute('aria-label') ?? '',
          viewBox: svg === null ? null : svg.getAttribute('viewBox'),
          crisp: svg === null ? null : svg.getAttribute('shape-rendering'),
          rects: svg === null ? 0 : svg.querySelectorAll('rect').length,
          stroke: svg === null ? null : svg.getAttribute('stroke-width'),
        };
      }),
    };
  });

const rgbTuple = (css) => {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (m === null) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2]];
};
const blend = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

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
info('运行时 glyph 表', `${String(GLYPHS.size)} 枚；tone 档 ${[...TONE_OPACITY.values()].join('/')}`);

const phases = {};
const shotsTaken = [];
let boot = null;
try {
  STEP = 'G0|boot';
  boot = await launch();
  page = boot.page;

  STEP = 'G0|fixture';
  for (let i = 0; i < 2; i += 1) {
    await page.locator('[data-testid="side-new-page"]').first().click({ force: true }).catch(() => {});
    await wait(1100);
  }
  const body = page.locator('.pv-body .ProseMirror, .pv-body [contenteditable]').first();
  await body.click({ force: true }).catch(() => {});
  await page.keyboard.type('T58 像素图标复验第一段').catch(() => {});
  await page.keyboard.press('Enter').catch(() => {});
  await page.keyboard.type('T58 像素图标复验第二段').catch(() => {});
  await wait(1500);
  const counts = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const nodes = await window.septcats.pages.tree({ workspaceId: ws.activeId });
    return {
      tabs: document.querySelectorAll('.tabsbar-tab').length,
      alive: nodes.filter((n) => n.alive === 1).length,
      blocks: document.querySelectorAll('.pv-body [data-id]').length,
    };
  });
  check('G0-1 夹具成立：真建页 + 真键入正文（存活页 ≥2、编辑器块 ≥2）', counts.alive >= 2 && counts.blocks >= 2, JSON.stringify(counts));

  // --- G1 顶栏图标族全量 -----------------------------------------------------
  STEP = 'G1|toolbar-family';
  const audit = await TOOLBAR_AUDIT();
  phases.toolbar = audit;
  info('顶栏图标钮（原始）', JSON.stringify(audit.rows));
  const notPixel = audit.rows.filter((r) => r.viewBox !== '0 0 16 16' || r.crisp !== 'crispEdges' || r.rects <= 0);
  check(
    'G1-1 顶栏图标钮一个不漏都是像素族（viewBox 0 0 16 16 + crispEdges + rect 网格）',
    audit.count >= 5 && notPixel.length === 0,
    `钮数=${String(audit.count)} 非像素族=${JSON.stringify(notPixel)}`,
  );
  check(
    'G1-2 无描边残留（phosphor 时代 stroke-width 属性在顶栏图标上一律不存在）',
    audit.rows.every((r) => r.stroke === null),
    audit.rows.map((r) => `${r.label}:${String(r.stroke)}`).join(' '),
  );

  // --- G2 像素级证据（8× 放大 + 逐像素采样） --------------------------------
  STEP = 'G2|pixel-proof';
  const ai0 = await AI_PROBE();
  phases.aiClosed = ai0;
  check(
    'G2-0 AI 钮定位 + 像素族几何（viewBox/crispEdges/无 stroke-width）',
    ai0 !== null && ai0.viewBox === '0 0 16 16' && ai0.shapeRendering === 'crispEdges' && ai0.strokeWidth === null,
    ai0 === null ? 'NULL' : JSON.stringify({ pressed: ai0.pressed, viewBox: ai0.viewBox, crisp: ai0.shapeRendering, rects: ai0.rectCount }),
  );
  const clip = { x: Math.floor(ai0.buttonBox.x), y: Math.floor(ai0.buttonBox.y), width: 28, height: 28 };
  const zoomBuf = await shotZoom('t58-01-ai-closed-zoom8x.png', clip, 8);
  info('AI 钮 8× 放大截图', `bytes=${String(zoomBuf === null ? -1 : zoomBuf.length)} clip=${JSON.stringify(clip)}`);
  let pixelReport = null;
  if (zoomBuf !== null && ai0 !== null) {
    const img = decodePng(zoomBuf);
    const fg = rgbTuple(ai0.color);
    const bg = rgbTuple(await page.evaluate(() => getComputedStyle(document.querySelector('.sc-shell__topbar')).backgroundColor));
    const opacities = [...new Set([...OPACITY_OF_CHAR.values(), 0.35, 0.55])];
    const legal = new Map([[bg.join(','), 'bg']]);
    for (const a of opacities) legal.set(blend(fg, bg, a).join(','), `t${String(a)}`);
    const illegal = new Map();
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const key = pxAt(img, x, y).join(',');
        if (!legal.has(key)) illegal.set(key, (illegal.get(key) ?? 0) + 1);
      }
    }
    // 渲染掩码 vs 资产矩阵：按 8 倍放大采样每个 glyph 格的中心像素
    const scale = 8;
    const icon = ai0.iconBox;
    const cell = icon.width / 16;
    const expected = GLYPHS.get('AiRobot');
    let mismatch = 0;
    const maskRows = [];
    for (let gy = 0; gy < 16; gy += 1) {
      let row = '';
      for (let gx = 0; gx < 16; gx += 1) {
        const cssX = icon.x - clip.x + (gx + 0.5) * cell;
        const cssY = icon.y - clip.y + (gy + 0.5) * cell;
        const sx = Math.min(img.width - 1, Math.max(0, Math.round(cssX * scale)));
        const sy = Math.min(img.height - 1, Math.max(0, Math.round(cssY * scale)));
        row += pxAt(img, sx, sy).join(',') === bg.join(',') ? '.' : '#';
      }
      maskRows.push(row);
    }
    for (let gy = 0; gy < 16; gy += 1) {
      for (let gx = 0; gx < 16; gx += 1) {
        const want = (expected[gy][gx] ?? '.') === '.' ? '.' : '#';
        if (maskRows[gy][gx] !== want) mismatch += 1;
      }
    }
    pixelReport = { illegal: [...illegal.entries()].slice(0, 6), illegalCount: [...illegal.values()].reduce((a, b) => a + b, 0), mismatch, size: { w: img.width, h: img.height } };
    phases.pixelProof = pixelReport;
    info('像素采样（原始）', JSON.stringify(pixelReport));
    check(
      `G2-1 硬边证明：8× 放大图全部像素落在「底色 ∪ 前景×{${[...OPACITY_OF_CHAR.values()].join(',')}} ∪ 关态眼档{0.35,0.55}」离散集内（零抗锯齿中间色）`,
      pixelReport.illegalCount === 0,
      `非法像素=${String(pixelReport.illegalCount)} 样本=${JSON.stringify(pixelReport.illegal)}`,
    );
    check(
      'G2-2 像素级证据：8× 放大图逐格采样掩码 == AiRobot 资产矩阵（16×16 全等）',
      mismatch === 0,
      `不等格数=${String(mismatch)}`,
    );
  } else {
    check('G2-1 硬边证明：8× 放大图已落盘并解码', false, 'zoomBuf 为空');
    check('G2-2 像素级证据：掩码 == 资产矩阵', false, '未取得放大图');
  }

  // --- G3 AI 钮两态 ---------------------------------------------------------
  STEP = 'G3|ai-two-state';
  const closedEye = ai0.eyeOpacity;
  const closedAntenna = ai0.antennaOpacity;
  check(
    'G3-1 关态明暗实测（getComputedStyle）：眼 = 0.35、天线 = 0.55',
    closedEye === '0.35' && closedAntenna === '0.55',
    `eye=${String(closedEye)} antenna=${String(closedAntenna)} aria-pressed=${String(ai0.pressed)}`,
  );
  const geometryOf = (probe) => JSON.stringify(probe.allRects);
  await clickAi();
  await wait(1200);
  const ai1 = await AI_PROBE();
  phases.aiOpen = ai1;
  check(
    'G3-2 开态明暗实测：眼 = 1、天线 = 1（与关态唯一差别是明暗，几何完全一致）',
    ai1 !== null && ai1.eyeOpacity === '1' && ai1.antennaOpacity === '1' && geometryOf(ai1) === geometryOf(ai0) && ai1.pressed === 'true',
    ai1 === null ? 'NULL' : `eye=${String(ai1.eyeOpacity)} antenna=${String(ai1.antennaOpacity)} 几何同=${String(geometryOf(ai1) === geometryOf(ai0))} pressed=${String(ai1.pressed)}`,
  );
  const panelState = await page.evaluate(() => {
    const panel = document.querySelector('.ai-chat');
    return {
      open: panel !== null,
      headEyes: panel === null ? 0 : panel.querySelectorAll('.ai-chat__head-icon .sc-icon__eye rect').length,
      headCrisp: panel === null ? null : panel.querySelector('.ai-chat__head-icon svg')?.getAttribute('shape-rendering') ?? null,
    };
  });
  check('G3-3 面板打开且标题栏图标同族（像素机器人头：眼分组 4 条横条 + crispEdges）', panelState.open === true && panelState.headEyes === 4 && panelState.headCrisp === 'crispEdges', JSON.stringify(panelState));
  await shot('t58-01-ai-panel-open.png');
  shotsTaken.push({ file: 't58-01-ai-panel-open.png', expect: 'ai-open', ok: panelState.open === true });
  await clickAi();
  await wait(1000);
  const ai2 = await AI_PROBE();
  check(
    'G3-4 再点回关态：眼/天线明暗回 0.35/0.55 且面板已收起（两态可反复往返）',
    ai2 !== null && ai2.eyeOpacity === '0.35' && ai2.antennaOpacity === '0.55' && ai2.pressed === 'false',
    ai2 === null ? 'NULL' : `eye=${String(ai2.eyeOpacity)} antenna=${String(ai2.antennaOpacity)} pressed=${String(ai2.pressed)}`,
  );

  // --- G4 截图（≥4 张） -----------------------------------------------------
  STEP = 'G4|screens';
  const before = await page.evaluate(() => ({
    pvRoot: document.querySelector('.pv-root') !== null,
    tabRow: document.querySelector('.app-tabrow') !== null,
    settings: document.querySelector('[data-testid="settings-page"]') !== null,
  }));
  info('浅色主界面视图态', JSON.stringify(before));
  const b1 = await shot('t58-01-editor-light.png');
  shotsTaken.push({ file: 't58-01-editor-light.png', ok: b1 !== null && before.pvRoot === true });
  const actionsBox = await boxOf('.sc-shell__actions');
  const b2 = await shotZoom('t58-01-actions-zoom4x.png', actionsBox === null ? undefined : { x: actionsBox.x - 4, y: actionsBox.y - 4, width: actionsBox.width + 8, height: actionsBox.height + 8 }, 4);
  shotsTaken.push({ file: 't58-01-actions-zoom4x.png', ok: b2 !== null });

  await page.evaluate(() => window.localStorage.setItem('septcats.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  const darkTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const darkAudit = await AI_PROBE();
  phases.aiDark = darkAudit;
  check(
    'G4-1 深色主题下同为像素族且两态明暗按同一 CSS 档生效（关态 0.35/0.55）',
    darkTheme === 'dark' && darkAudit !== null && darkAudit.viewBox === '0 0 16 16' && darkAudit.eyeOpacity === '0.35',
    `data-theme=${String(darkTheme)} eye=${String(darkAudit?.eyeOpacity)} antenna=${String(darkAudit?.antennaOpacity)}`,
  );
  const b3 = await shot('t58-01-editor-dark.png');
  shotsTaken.push({ file: 't58-01-editor-dark.png', ok: b3 !== null });
  const b4 = await shotZoom('t58-01-actions-dark-zoom4x.png', actionsBox === null ? undefined : { x: actionsBox.x - 4, y: actionsBox.y - 4, width: actionsBox.width + 8, height: actionsBox.height + 8 }, 4);
  shotsTaken.push({ file: 't58-01-actions-dark-zoom4x.png', ok: b4 !== null });

  // 设置页（浅色）
  await page.evaluate(() => window.localStorage.setItem('septcats.theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => document.querySelector('.app-side') !== null), 30000);
  await wait(2200);
  await page.getByRole('button', { name: /设置|Settings/ }).last().click({ force: true }).catch(() => {});
  const settingsOpen = await waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null), 12000);
  await wait(1200);
  const b5 = await shot('t58-01-settings-light.png');
  shotsTaken.push({ file: 't58-01-settings-light.png', ok: b5 !== null && settingsOpen === true });
  const settingsAudit = await page.evaluate(() => {
    const svgs = [...document.querySelectorAll('svg.sc-icon')];
    return {
      count: svgs.length,
      allPixel: svgs.every((s) => s.getAttribute('viewBox') === '0 0 16 16' && s.getAttribute('shape-rendering') === 'crispEdges'),
    };
  });
  info('设置页/整屏图标族抽样', JSON.stringify(settingsAudit));
  check(
    'G4-2 整屏图标（侧栏 + 顶栏 + 设置页）零漏网：全部是像素族几何（无 phosphor 混族残留）',
    settingsAudit.count > 0 && settingsAudit.allPixel === true,
    JSON.stringify(settingsAudit),
  );
  check(
    'G4-3 截图 ≥4 张且逐张拍在对的视图（浅色主界面 / 顶栏放大 / AI 面板开 / 深色主界面 / 设置页）',
    shotsTaken.length >= 4 && shotsTaken.every((s) => s.ok === true),
    shotsTaken.map((s) => `${s.file}${s.ok === false ? '(MISS)' : ''}`).join(' '),
  );

  STEP = 'G5|exit';
  boot.quit = await quit(boot.pid, boot.browser);
  check('G5-1 退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
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
    task: 'TASK-T58-01 真机取证（AI 钮像素化 + 全仓图标像素族接线）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    method: 'renderer CDP (playwright-core over --remote-debugging-port) 量测/点击/截图 + Emulation.setDeviceMetricsOverride 放大 + 自写 PNG 解码逐像素采样',
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: { realRoot: REAL_ROOT, realRootMtimeBefore, realRootMtimeAfter, untouched: realRootMtimeBefore === realRootMtimeAfter },
    screenshots: shotsTaken.map((s) => s.file),
    pass: passes,
    fail: fails,
    quiet: boot?.quit ?? null,
    phases,
    assertions: results,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T58-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
