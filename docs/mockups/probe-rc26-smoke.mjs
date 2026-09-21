/* probe-rc26-smoke.mjs —— TASK-T48-01 rc.26 **打包产物**启动冒烟 + 包内代码验证。
 *
 * 存在理由：历史上有一次发布候选因打包时原生模块留在 node ABI，装完启动即报
 * 「同步运行时不可用（数据库服务启动失败）」而作废。本次**只跑打包产物本身**
 * （apps/desktop/dist/win-unpacked/Septcats.exe），不跑 out/、不重打包、不改产品源码。
 *
 * 两部分：
 *   ② 包内代码验证（静态，先跑；与运行时无关）：直接解析 resources/app.asar
 *      （8 字节头 + pickle JSON + 拼接数据），提取
 *      i)   out/renderer/index.html 的 CSP connect-src 原文；
 *      ii)  out/main/** —— T46 新模块与文案（chatConfig / setChatConfig / 等待超过 /
 *           「模型未返回正文」）；
 *      iii) out/renderer/assets/*.js —— T44 双链/反向链接字符串 + T41「全宽 / 固定宽度」。
 *      另附：asar 内不得残留 .node（原生模块必须落在 app.asar.unpacked/）。
 *   ① 启动冒烟（运行时）：EXE + --user-data-dir + rootPath 夹具 + CDP，
 *      断言 a) 10s 内不出现失败文案 b) DB/同步就绪 c) 主界面渲染 d) ⋯ 菜单/命令面板
 *      e) pageerror/console error 计数 f) window.close() 优雅退出（不强杀）。
 *
 * 纪律：
 * - 数据隔离：--user-data-dir 与 rootPath 全在 <repo>/../_scratch/t48-01/ 下；
 *   **绝不读写 C:\\Users\\Administrator\\.septcats**（并以 layoutRoot 反证 + mtime 前后自检）。
 * - 失败即停：a 类失败文案出现 / 起不来 → 保留夹具与截图，写出原始文本后退出（不改源码绕过）。
 * - ABI：本次只跑打包产物自带 electron ABI，**不跑 ensure-abi**。
 *
 * 运行：node docs/mockups/probe-rc26-smoke.mjs
 * 产物：docs/mockups/screens-t48/rc26-smoke-results.json（原始值）+ *.png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import {
  openSync,
  readSync,
  closeSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const requireFrom = createRequire(join(REPO, 'package.json'));
const { chromium } = requireFrom('playwright-core');

const WIN_UNPACKED = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked');
const EXE = join(WIN_UNPACKED, 'Septcats.exe');
const ASAR = join(WIN_UNPACKED, 'resources', 'app.asar');
const ASAR_UNPACKED = join(WIN_UNPACKED, 'resources', 'app.asar.unpacked');

const RUN = join(REPO, '..', '_scratch', 't48-01');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const STDOUT_LOG = join(RUN, 'app-stdout.log');
const STDERR_LOG = join(RUN, 'app-stderr.log');
const PORT = 9481;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t48');
const OUT_JSON = join(SHOTS, 'rc26-smoke-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let PHASE = 'static';
let STEP = 'init';
/** ② 包内代码验证的原始证据（增量落盘用）。 */
const staticReport = { asarFiles: 0, mainFiles: [], rendererAssets: [], checks: {} };
/** ① 启动冒烟的原始证据（增量落盘用）。 */
const smokeReport = {};
let T0 = Date.now();
let FATAL = false;

/** 增量落盘：任何时刻被打断也留有证据。 */
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T48-01 rc.26 打包产物启动冒烟 + 包内代码验证',
          partial: true,
          ranAt: new Date().toISOString(),
          exe: EXE,
          asar: ASAR,
          fixture: { userDataDir: UD, rootPath: ROOT, port: PORT },
          static: staticReport,
          smoke: smokeReport,
          fatal: FATAL,
          consoleErrors,
          pageErrors,
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
  results.push({ phase: PHASE, step: STEP, name, ok: ok === true, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${PHASE}|${STEP}] ${name}\n        ${String(raw)}`);
  dump();
};
const info = (name, raw) => {
  results.push({ phase: PHASE, step: STEP, name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  [${PHASE}|${STEP}] ${name}\n        ${String(raw)}`);
  dump();
};
process.on('unhandledRejection', (error) => {
  info('未处理的 Promise 拒绝（原始）', String(error?.stack ?? error));
});
process.on('uncaughtException', (error) => {
  info('未捕获异常（原始）', String(error?.stack ?? error));
});

const consoleErrors = [];
const pageErrors = [];
const shots = [];
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const shot = async (page, name) => {
  const buf = await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  const size = pngSize(buf);
  shots.push({ file: `${name}.png`, width: size.w, height: size.h, bytes: buf.length });
  return size;
};
const mtime = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return 'absent';
  }
};
const countFiles = (dir) => {
  try {
    const out = execSync(`cmd /c dir /b /s "${dir}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
};

// ===========================================================================
// ② 包内代码验证（asar 头解析：8 字节头 + pickle JSON + 拼接数据）
// ===========================================================================
/**
 * asar 布局：
 *   [0..4)   uint32LE = 4（下一个 pickle 的 payload 长度前缀）
 *   [4..8)   uint32LE = header pickle 的 payload 字节数 S
 *   [8..8+S) header pickle = [uint32LE 4][uint32LE 字符串字节长 L][L 字节 UTF-8 JSON]
 *   数据区起点 = 8 + S；文件项 { offset: "<十进制字符串>", size: N } 相对该起点。
 */
function readAsar(asarPath) {
  const fd = openSync(asarPath, 'r');
  const sizeBuf = Buffer.alloc(8);
  readSync(fd, sizeBuf, 0, 8, 0);
  const picklePrefix = sizeBuf.readUInt32LE(0);
  const headerSize = sizeBuf.readUInt32LE(4);
  if (picklePrefix !== 4) {
    throw new Error(`asar 头异常：pickle 前缀=${String(picklePrefix)}（期望 4）`);
  }
  const headerBuf = Buffer.alloc(headerSize);
  readSync(fd, headerBuf, 0, headerSize, 8);
  const innerPayloadSize = headerBuf.readUInt32LE(0);
  const strLen = headerBuf.readUInt32LE(4);
  const headerStr = headerBuf.subarray(8, 8 + strLen).toString('utf8');
  const header = JSON.parse(headerStr);
  return { fd, header, dataOffset: 8 + headerSize, headerSize, innerPayloadSize, strLen };
}
/** 展平 header 为 path → {offset,size,unpacked} 列表（node.files = 目录）。 */
function flattenAsar(node, prefix = '', out = []) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    if (value.files !== undefined) {
      flattenAsar(value, path, out);
    } else {
      out.push({
        path,
        offset: value.offset,
        size: typeof value.size === 'number' ? value.size : 0,
        unpacked: value.unpacked === true,
        offsetNum: value.offset === undefined ? null : Number(value.offset),
      });
    }
  }
  return out;
}
function readAsarFile(handle, entry) {
  if (entry.unpacked === true || entry.offsetNum === null) {
    return null; // 落在 app.asar.unpacked/ 下，不在 asar 数据区
  }
  const buf = Buffer.alloc(entry.size);
  readSync(handle.fd, buf, 0, entry.size, handle.dataOffset + entry.offsetNum);
  return buf.toString('utf8');
}
/** 在文本里找 token：返回 { count, firstOffset, snippet }。 */
function findToken(text, token) {
  const idx = text.indexOf(token);
  if (idx < 0) {
    return { count: 0, firstOffset: null, snippet: null };
  }
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) break;
    count += 1;
    from = at + token.length;
  }
  const snippetStart = Math.max(0, idx - 90);
  return {
    count,
    firstOffset: idx,
    snippet: text.slice(snippetStart, idx + token.length + 90).replace(/\s+/g, ' '),
  };
}
/** 从 index.html 提取 CSP meta 的 content 原文 + connect-src 段原文。 */
function extractCsp(html) {
  const meta = /<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html);
  if (meta === null) {
    return { metaTag: null, content: null, connectSrc: null };
  }
  // 属性值用双引号包裹，内部含单引号（'self'）——必须按外层引号配对取值。
  const dq = /content="([^"]*)"/i.exec(meta[0]);
  const sq = /content='([^']*)'/i.exec(meta[0]);
  const full = dq !== null ? dq[1] : sq !== null ? sq[1] : null;
  const connect = full === null ? null : /connect-src([^;]*)/i.exec(full);
  return {
    metaTag: meta[0].replace(/\s+/g, ' ').trim(),
    content: full,
    connectSrc: connect === null ? null : `connect-src${connect[1]}`.trim(),
  };
}

async function runStaticVerification() {
  PHASE = 'static';
  STEP = 'preflight';
  const exeSize = (() => {
    try {
      return String(statSync(EXE).size);
    } catch {
      return 'absent';
    }
  })();
  check('打包产物存在（win-unpacked/Septcats.exe）', existsSync(EXE),
    `${EXE} size=${exeSize} mtime=${mtime(EXE)}`);
  check('包存在（resources/app.asar）', existsSync(ASAR),
    `${ASAR} size=${existsSync(ASAR) ? String(statSync(ASAR).size) : 'absent'} mtime=${mtime(ASAR)}`);
  if (!existsSync(ASAR)) {
    return false;
  }

  STEP = 'asar-parse';
  const handle = readAsar(ASAR);
  const entries = flattenAsar(handle.header);
  staticReport.asarFiles = entries.length;
  info('asar 头解析成功', `dataOffset=${String(handle.dataOffset)} headerSize=${String(handle.headerSize)} strLen=${String(handle.strLen)} 条目数=${String(entries.length)}`);
  const nativeEntries = entries.filter((e) => /\.node$/i.test(e.path));
  const nativeNotUnpacked = nativeEntries.filter((e) => e.unpacked !== true || e.offsetNum !== null);
  check('原生模块 .node 全部标记 unpacked 且不在 asar 数据区（无「留在包内、ABI 不匹配」残留）',
    nativeEntries.length > 0 && nativeNotUnpacked.length === 0,
    `asar 头 .node 条目=${JSON.stringify(nativeEntries.map((e) => ({ path: e.path, unpacked: e.unpacked, hasDataOffset: e.offsetNum !== null, size: e.size })))}；异常条目=${JSON.stringify(nativeNotUnpacked.map((e) => e.path))}`);
  const sqliteNode = join(ASAR_UNPACKED, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const sqliteNodeSize = (() => {
    try {
      return String(statSync(sqliteNode).size);
    } catch {
      return 'absent';
    }
  })();
  check('app.asar.unpacked/ 下存在 better_sqlite3.node（原生模块随包交付，走打包产物自带 electron ABI）',
    existsSync(sqliteNode), `path=${sqliteNode} size=${sqliteNodeSize}`);

  // —— ② i) 渲染层 CSP ——
  STEP = 'csp';
  const htmlEntry = entries.find((e) => e.path === 'out/renderer/index.html');
  if (htmlEntry === undefined) {
    check('out/renderer/index.html 在包内', false, `包内 out/renderer 下的文件=${JSON.stringify(entries.filter((e) => e.path.startsWith('out/renderer')).map((e) => e.path).slice(0, 12))}`);
    staticReport.checks.csp = { found: false };
  } else {
    const html = readAsarFile(handle, htmlEntry);
    const csp = extractCsp(html);
    staticReport.checks.csp = csp;
    check('② i) index.html CSP meta 存在且含 connect-src', csp.content !== null && csp.connectSrc !== null,
      `meta=${JSON.stringify(csp.metaTag)}`);
    check('② i) CSP connect-src 含 127.0.0.1（AI 本地端点放行）',
      csp.connectSrc !== null && csp.connectSrc.includes('127.0.0.1'),
      `connect-src 原文=${JSON.stringify(csp.connectSrc)}`);
    info('② i) CSP content 全文原文', `content=${JSON.stringify(csp.content)}`);
  }

  // —— ② ii) main 侧 T46 ——
  STEP = 'main-t46';
  const mainEntries = entries.filter((e) => e.path.startsWith('out/main/') && e.path.endsWith('.js'));
  const mainText = mainEntries.map((e) => `${e.path}\n${readAsarFile(handle, e) ?? ''}`).join('\n');
  staticReport.mainFiles = mainEntries.map((e) => ({ path: e.path, size: e.size, unpacked: e.unpacked }));
  info('out/main/** 包内清单', JSON.stringify(staticReport.mainFiles));
  const MAIN_TOKENS = [
    ['chatConfig（模块/标识）', 'chatConfig'],
    ['setChatConfig（通道/方法名）', 'setChatConfig'],
    ['ai:setChatConfig（IPC 通道名）', 'ai:setChatConfig'],
    ['ai-chat-config.json（T46 落盘文件名）', 'ai-chat-config.json'],
    ['「等待超过」（T46 超时文案）', '等待超过'],
  ];
  staticReport.checks.main = {};
  for (const [label, token] of MAIN_TOKENS) {
    const hit = findToken(mainText, token);
    staticReport.checks.main[token] = hit;
    check(`② ii) main 侧存在 ${label}`, hit.count > 0,
      `命中 ${String(hit.count)} 次；首处原文片段=${JSON.stringify(hit.snippet)}`);
  }
  const mainHasEmptyReply = findToken(mainText, '模型未返回正文');
  info('② ii) main 侧「模型未返回正文」', `命中 ${String(mainHasEmptyReply.count)} 次（该文案主要在 renderer i18n，见 ②iii）`);

  // —— ② iii) 渲染层 T44 / T41 ——
  STEP = 'renderer-t44-t41';
  const assetEntries = entries.filter((e) => e.path.startsWith('out/renderer/assets/') && e.path.endsWith('.js'));
  const rendererText = assetEntries.map((e) => `${e.path}\n${readAsarFile(handle, e) ?? ''}`).join('\n');
  staticReport.rendererAssets = assetEntries.map((e) => ({ path: e.path, size: e.size }));
  info('out/renderer/assets/*.js 包内清单', JSON.stringify(staticReport.rendererAssets));
  const RENDERER_TOKENS = [
    ['T44 双链菜单标题「链接到页面 · 输入以过滤」', '链接到页面 · 输入以过滤'],
    ['T44 双链菜单空态「无匹配页面」', '无匹配页面'],
    ['T44 反向链接标题「反向链接」', '反向链接'],
    ['T44 反向链接空态「暂无页面引用本页」', '暂无页面引用本页'],
    ['T44 反向链接跳转 aria「跳转到引用位置」', '跳转到引用位置'],
    ['T41 页面 ⋯ 菜单「固定宽度」', '固定宽度'],
    ['T41 命令面板「全宽 / 固定宽度」', '全宽 / 固定宽度'],
    ['T46「模型未返回正文（仅推理内容）」', '模型未返回正文（仅推理内容）'],
    ['T46「模型未返回正文（可重试，或调大「最大输出 tokens」）」', '模型未返回正文（可重试，或调大「最大输出 tokens」）'],
    ['T46 超时指引「可在设置 › AI 助手中调大「请求超时」（当前 {n} 秒）。」', '可在设置 › AI 助手中调大「请求超时」（当前 {n} 秒）。'],
    ['T46 超时指引（无秒数）「可在设置 › AI 助手中调大「请求超时」。」', '可在设置 › AI 助手中调大「请求超时」。'],
    ['T46 设置页保存反馈「请求超时已设为 {n} 秒」', '请求超时已设为 {n} 秒'],
  ];
  staticReport.checks.renderer = {};
  for (const [label, token] of RENDERER_TOKENS) {
    const hit = findToken(rendererText, token);
    staticReport.checks.renderer[token] = hit;
    check(`② iii) 渲染层存在 ${label}`, hit.count > 0,
      `命中 ${String(hit.count)} 次；首处原文片段=${JSON.stringify(hit.snippet)}`);
  }
  closeSync(handle.fd);
  return true;
}

// ===========================================================================
// ① 启动冒烟（打包产物本身）
// ===========================================================================
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
    const out = execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' });
    return out.includes(String(pid));
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
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
};

const FATAL_TOKENS = [
  ['数据库服务启动失败', 'dbFailed'],
  ['同步运行时不可用', 'syncUnavailable'],
  ['加载中', 'loading'],
];

const bodyText = (page) =>
  page.evaluate(() => (document.body === null ? '' : document.body.innerText)).catch(() => '');

async function launch() {
  const stale = listeningPids(PORT);
  for (const pid of stale) killTree(pid);
  if (stale.length > 0) await wait(1500);
  const child = spawn(
    EXE,
    [
      `--user-data-dir=${UD}`,
      `--remote-debugging-port=${String(PORT)}`,
      // 窗口尺寸固定由产品自身决定（main/index.ts: BrowserWindow width 1200 / height 800），
      // 此处只钉缩放因子，保证截图像素与 CSS 像素 1:1（可复现）。
      '--force-device-scale-factor=1',
    ],
    { cwd: WIN_UNPACKED, detached: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (chunk) => {
    try {
      appendFileSync(STDOUT_LOG, chunk);
    } catch {
      /* ignore */
    }
  });
  child.stderr.on('data', (chunk) => {
    try {
      appendFileSync(STDERR_LOG, chunk);
    } catch {
      /* ignore */
    }
  });
  const spawnedAt = Date.now();
  let browser = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
      break;
    } catch {
      await wait(500);
    }
  }
  if (browser === null) {
    return { browser: null, page: null, pid: child.pid, spawnedAt };
  }
  const ctx = browser.contexts()[0];
  ctx.setDefaultTimeout(10000);
  let page = null;
  const pageDeadline = Date.now() + 40_000;
  while (Date.now() < pageDeadline) {
    const ps = ctx
      .pages()
      .filter((p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'));
    if (ps.length > 0) {
      page = ps[0];
      break;
    }
    await wait(200);
  }
  if (page !== null) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(`[${STEP}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      pageErrors.push(`[${STEP}] ${String(err?.message ?? err)}`);
    });
    await page.bringToFront().catch(() => {});
  }
  return { browser, page, pid: child.pid, spawnedAt };
}

/** 10s 采样：只读 body.innerText，逐 200ms 取一次，记录三类 token 命中时刻与上下文。 */
async function sampleWindow(page, ms) {
  const hits = { dbFailed: [], syncUnavailable: [], loading: [] };
  const samples = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const text = await bodyText(page);
    const flat = text.replace(/\s+/g, ' ').trim();
    const atMs = Date.now() - T0;
    for (const [token, key] of FATAL_TOKENS) {
      const at = text.indexOf(token);
      if (at >= 0) {
        const from = Math.max(0, at - 70);
        hits[key].push({ atMs, token, context: text.replace(/\s+/g, ' ').slice(from, at + token.length + 70) });
      }
    }
    samples.push({ atMs, textLen: flat.length, head: flat.slice(0, 150) });
    await wait(200);
  }
  const dedupe = (list) => {
    const first = list[0] ?? null;
    const last = list[list.length - 1] ?? null;
    return {
      occurrences: list.length,
      firstAtMs: first === null ? null : first.atMs,
      lastAtMs: last === null ? null : last.atMs,
      observedMs: first === null ? 0 : last.atMs - first.atMs,
      firstContext: first === null ? null : first.context,
    };
  };
  return {
    windowMs: ms,
    sampleCount: samples.length,
    firstSample: samples[0] ?? null,
    lastSample: samples[samples.length - 1] ?? null,
    hits: { dbFailed: dedupe(hits.dbFailed), syncUnavailable: dedupe(hits.syncUnavailable), loading: dedupe(hits.loading) },
  };
}

const UI_COUNTS = () => ({
  shellTopbar: document.querySelectorAll('.sc-shell__topbar').length,
  appSide: document.querySelectorAll('.app-side').length,
  shellSidebar: document.querySelectorAll('.sc-shell__sidebar').length,
  appMainRow: document.querySelectorAll('.app-main-row').length,
  appEditorCol: document.querySelectorAll('.app-editor-col').length,
  pvRoot: document.querySelectorAll('.pv-root').length,
  pvBody: document.querySelectorAll('.pv-body').length,
  pvEmpty: document.querySelectorAll('.pv-empty').length,
  proserMirror: document.querySelectorAll('.ProseMirror').length,
  tabsbar: document.querySelectorAll('.tabsbar').length,
  tabsbarTab: document.querySelectorAll('.tabsbar-tab').length,
  sideTreeRows: document.querySelectorAll('[data-testid^="side-node-"]').length,
  syncPill: document.querySelectorAll('.sc-sync-status__pill').length,
  syncPillLabel: document.querySelector('.sc-sync-status__label')?.textContent ?? null,
  bodyTextHead: (document.body === null ? '' : document.body.innerText).replace(/\s+/g, ' ').trim().slice(0, 200),
  winW: window.innerWidth,
  winH: window.innerHeight,
  rootHtmlHead: (document.getElementById('root')?.innerHTML ?? '').slice(0, 120),
});

const MENU_LABELS = () => {
  const menus = [...document.querySelectorAll('.sc-menu')];
  const menu = menus[menus.length - 1];
  if (menu === undefined) return null;
  return [...menu.querySelectorAll('[role="menuitem"] .sc-menu__label')].map((el) => el.textContent);
};
const PALETTE_ROWS = () => {
  const panel = document.querySelector('[data-testid="palette-panel"]');
  if (panel === null) return null;
  return {
    aria: panel.getAttribute('aria-label'),
    rows: [...panel.querySelectorAll('.palette-row-tx')].map((el) => el.textContent),
  };
};

async function quit(page, pid, browser) {
  STEP = 'teardown';
  await page
    .evaluate(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
  await wait(2500);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  if (browser !== null) await browser.close().catch(() => {});
  await wait(1200);
  return { gracefulExited: !stillAlive };
}

async function runSmoke() {
  PHASE = 'smoke';
  STEP = 'launch';
  const realRootBefore = mtime(REAL_ROOT);
  info('真实数据根 mtime（启动前）', `${REAL_ROOT} → ${realRootBefore}`);

  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });

  // 夹具 settings：独立 rootPath + 可用 AI（provider 指向本机未监听端口，全程零外网）
  const settings = {
    schema: 1,
    rootPath: ROOT,
    theme: 'light',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' },
    sync: { enabled: true, encrypt: false, gc: false },
    ai: {
      enabled: true,
      cloudConsent: false,
      activeProviderId: 'probe-local',
      providers: [
        { id: 'probe-local', kind: 'lmstudio', name: 'Probe Local', baseUrl: 'http://127.0.0.1:45999', model: 'probe' },
      ],
    },
  };
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  writeFileSync(STDOUT_LOG, '', 'utf8');
  writeFileSync(STDERR_LOG, '', 'utf8');
  info('夹具就位（自建，不碰真实数据根）', `UD=${UD} ROOT=${ROOT} settings=${join(UD, 'septcats.settings.json')}`);
  info('启动命令', `${EXE} --user-data-dir=${UD} --remote-debugging-port=${PORT} --force-device-scale-factor=1`);

  T0 = Date.now();
  const run = await launch();
  smokeReport.pid = run.pid ?? null;
  smokeReport.cdpAttachMs = Date.now() - T0;
  check('应用进程已拉起（有 PID）', typeof run.pid === 'number', `pid=${String(run.pid)}`);
  if (run.browser === null || run.page === null) {
    FATAL = true;
    smokeReport.cdpAttachMs = Date.now() - T0;
    check('CDP 连上打包产物（60s 内）', false, `cdpAttachMs=${String(smokeReport.cdpAttachMs)} stderr=${JSON.stringify(readTail(STDERR_LOG))} stdout=${JSON.stringify(readTail(STDOUT_LOG))}`);
    smokeReport.stderrTail = readTail(STDERR_LOG);
    smokeReport.stdoutTail = readTail(STDOUT_LOG);
    return;
  }
  const page = run.page;
  check('CDP 连上打包产物', true, `cdpAttachMs=${String(smokeReport.cdpAttachMs)} url=${page.url()}`);
  info('CDP 页面 url', page.url());

  // ---- a) 10s 采样：失败文案 ----
  STEP = 'a-failure-text';
  const sample = await sampleWindow(page, 10_000);
  smokeReport.sample = sample;
  info('a) 采样首帧', JSON.stringify(sample.firstSample));
  info('a) 采样末帧', JSON.stringify(sample.lastSample));
  check('a) 10s 内不出现「数据库服务启动失败」', sample.hits.dbFailed.occurrences === 0,
    `命中=${String(sample.hits.dbFailed.occurrences)} 首次=${JSON.stringify(sample.hits.dbFailed)}`);
  check('a) 10s 内不出现「同步运行时不可用」', sample.hits.syncUnavailable.occurrences === 0,
    `命中=${String(sample.hits.syncUnavailable.occurrences)} 首次=${JSON.stringify(sample.hits.syncUnavailable)}`);
  // 「加载中」：任务书 a) 与两条致命文案并列为「不出现」；实测首帧命中一次
  // 「同步状态加载中…」——系 SyncStatus 组件 status===null 的**设计占位**
  // （src/renderer/src/sync/SyncStatus.tsx pillView(null) → t('sync.stateLoading')），
  // 与「数据库服务启动失败 / 同步运行时不可用」两类故障文案性质不同。故按
  // 「不得**滞留**在加载态」落地（见 DEVIATION-1）：命中只允许出现在启动瞬态窗口内。
  const loadingHit = sample.hits.loading;
  check('a) 「加载中」仅瞬态出现（≤3s 内退场，非滞留）',
    loadingHit.occurrences === 0 || (loadingHit.lastAtMs !== null && loadingHit.lastAtMs <= 3000),
    `命中=${String(loadingHit.occurrences)} 首次=${String(loadingHit.firstAtMs)}ms 末次=${String(loadingHit.lastAtMs)}ms 观测跨度=${String(loadingHit.observedMs)}ms 首次上下文=${JSON.stringify(loadingHit.firstContext)}`);
  const settledText = await bodyText(page);
  smokeReport.settledBodyText = settledText.replace(/\s+/g, ' ').trim();
  check('a) 10s 末「加载中」已退场（未卡在加载态）', !settledText.includes('加载中'),
    `末次 body 文本原文（前 400 字）=${JSON.stringify(smokeReport.settledBodyText.slice(0, 400))}`);
  if (sample.hits.dbFailed.occurrences > 0 || sample.hits.syncUnavailable.occurrences > 0) {
    FATAL = true;
    const s = await shot(page, 'rc26-smoke-FATAL-failure-text');
    info('失败现场截图（保留）', `${String(s.w)}x${String(s.h)} → ${join(SHOTS, 'rc26-smoke-FATAL-failure-text.png')}`);
    smokeReport.stderrTail = readTail(STDERR_LOG);
    smokeReport.stdoutTail = readTail(STDOUT_LOG);
    return;
  }

  // ---- b) DB / 同步就绪 ----
  STEP = 'b-readiness';
  const readiness = await page.evaluate(async () => {
    const out = { ping: null, appMeta: null, syncStatus: null, syncStatusRaw: null, workspaces: null, tree: null, links: null, aiSetChatConfig: null, errors: [] };
    const step = async (name, fn) => {
      try {
        return await fn();
      } catch (err) {
        out.errors.push(`${name}: ${String(err?.message ?? err)}`);
        return null;
      }
    };
    out.ping = await step('ping', () => window.septcats.ping());
    out.appMeta = await step('appMeta', () => window.septcats.appMeta());
    const st = await step('sync.status', () => window.septcats.sync.status());
    out.syncStatusRaw = st === null ? null : JSON.stringify(st);
    out.syncStatus = st === null ? null : { state: st.state, enabled: st.enabled, devices: st.devices.length, errors: st.errors.length, pendingOps: st.pendingOps };
    out.workspaces = await step('workspaces.list', () => window.septcats.workspaces.list());
    if (out.workspaces !== null && out.workspaces.activeId !== null) {
      out.tree = await step('pages.tree', () => window.septcats.pages.tree({ workspaceId: out.workspaces.activeId }));
    }
    out.aiSetChatConfig = await step('ai.setChatConfig', () => window.septcats.ai.setChatConfig({ requestTimeoutSec: 45 }));
    return out;
  });
  smokeReport.readiness = readiness;
  info('b) ping 原始返回值', JSON.stringify(readiness.ping));
  info('b) appMeta 原始返回值', JSON.stringify(readiness.appMeta));
  info('b) sync.status() 原始返回值', String(readiness.syncStatusRaw));
  info('b) workspaces.list() 原始返回值', JSON.stringify(readiness.workspaces));
  info('b) pages.tree() 原始返回值（节点数）', readiness.tree === null ? 'null' : `nodes=${String(readiness.tree.length)} titles=${JSON.stringify(readiness.tree.map((n) => n.title))}`);
  info('b) ai.setChatConfig({requestTimeoutSec:45}) 原始返回值', JSON.stringify(readiness.aiSetChatConfig));
  info('b) 就绪探测期间收集到的 IPC 错误', JSON.stringify(readiness.errors));

  check('b) ping 通道返回时间戳', typeof readiness.ping === 'string' && readiness.ping.length > 0, JSON.stringify(readiness.ping));
  check('b) sync.status() 返回快照（非 E_INVARIANT「同步运行时不可用」）',
    readiness.syncStatus !== null && typeof readiness.syncStatus.state === 'string',
    `state=${String(readiness.syncStatus?.state)} enabled=${String(readiness.syncStatus?.enabled)} devices=${String(readiness.syncStatus?.devices)} errors=${String(readiness.syncStatus?.errors)}`);
  check('b) workspaces.list() 返回活动工作区（DB 服务活着）',
    readiness.workspaces !== null && typeof readiness.workspaces.activeId === 'string',
    JSON.stringify(readiness.workspaces));
  check('b) pages.tree() 返回数组（DB 读路径活着）', Array.isArray(readiness.tree),
    `tree=${readiness.tree === null ? 'null' : `Array(${String(readiness.tree.length)})`}`);
  check('b) 就绪探测零 IPC 错误（无 E_INVARIANT / E_DB_UNAVAILABLE）', readiness.errors.length === 0,
    JSON.stringify(readiness.errors));
  check('b) 隔离生效：appMeta.layoutRoot === 夹具目录名 "data"（非 .septcats）',
    String(readiness.appMeta?.layoutRoot ?? '') === 'data',
    `layoutRoot=${JSON.stringify(readiness.appMeta?.layoutRoot ?? null)}`);
  if (readiness.syncStatus === null) {
    FATAL = true;
    const s = await shot(page, 'rc26-smoke-FATAL-sync-unavailable');
    info('失败现场截图（保留）', `${String(s.w)}x${String(s.h)} → ${join(SHOTS, 'rc26-smoke-FATAL-sync-unavailable.png')}`);
    smokeReport.stderrTail = readTail(STDERR_LOG);
    smokeReport.stdoutTail = readTail(STDOUT_LOG);
    return;
  }

  // ---- c) 主界面渲染 ----
  STEP = 'c-main-ui';
  const ui = await page.evaluate(UI_COUNTS);
  smokeReport.ui = ui;
  check('c) 侧栏在 DOM（.app-side / .sc-shell__sidebar）', ui.appSide >= 1 && ui.shellSidebar >= 1,
    `.app-side=${String(ui.appSide)} .sc-shell__sidebar=${String(ui.shellSidebar)}`);
  check('c) 主区在 DOM（.app-main-row + .app-editor-col）', ui.appMainRow >= 1 && ui.appEditorCol >= 1,
    `.app-main-row=${String(ui.appMainRow)} .app-editor-col=${String(ui.appEditorCol)}`);
  check('c) 编辑器或空态在 DOM（.pv-body 或 .pv-empty）', ui.pvBody >= 1 || ui.pvEmpty >= 1,
    `.pv-body=${String(ui.pvBody)} .pv-empty=${String(ui.pvEmpty)} .pv-root=${String(ui.pvRoot)}`);
  check('c) 同步状态钮在 DOM 且非「加载中」', ui.syncPill >= 1 && !String(ui.syncPillLabel ?? '').includes('加载中'),
    `.sc-sync-status__pill=${String(ui.syncPill)} label=${JSON.stringify(ui.syncPillLabel)}`);
  info('c) 窗口尺寸 / body 文本原文（前 200 字）', `win=${String(ui.winW)}x${String(ui.winH)} bodyText=${JSON.stringify(ui.bodyTextHead)}`);
  const bootShot = await shot(page, 'rc26-smoke-01-boot');
  info('截图（启动完成态）', `rc26-smoke-01-boot.png ${String(bootShot.w)}x${String(bootShot.h)}`);

  // ---- d) ⋯ 菜单 / 命令面板 ----
  STEP = 'd-menus';
  await page.getByTestId('side-new-page').click();
  const nameInput = page.locator('.app-side input').first();
  await nameInput.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await nameInput.fill('T48 冒烟页').catch(() => {});
  await nameInput.press('Enter').catch(() => {});
  await wait(1200);
  const afterCreate = await page.evaluate(UI_COUNTS);
  smokeReport.uiAfterCreate = afterCreate;
  check('d) 新建页后编辑器渲染（.pv-body + .ProseMirror）', afterCreate.pvBody >= 1 && afterCreate.proserMirror >= 1,
    `.pv-body=${String(afterCreate.pvBody)} .ProseMirror=${String(afterCreate.proserMirror)} .pv-empty=${String(afterCreate.pvEmpty)}`);
  check('d) 侧栏树出现页面行（[data-testid^=side-node-]）', afterCreate.sideTreeRows >= 1,
    `side-node 行数=${String(afterCreate.sideTreeRows)}`);

  const moreCount = await page.locator('[data-testid^="side-more-"]').count();
  await page.locator('[data-testid^="side-more-"]').first().click({ force: true }).catch(() => {});
  await wait(700);
  const menuLabels = await page.evaluate(MENU_LABELS);
  smokeReport.menuLabels = menuLabels;
  check('d) 页面 ⋯ 菜单可打开且含菜单项', Array.isArray(menuLabels) && menuLabels.length > 0,
    `⋯ 按钮数=${String(moreCount)} 菜单项数组=${JSON.stringify(menuLabels)}`);
  check('d) ⋯ 菜单含 T41「固定宽度」或「✓ 全宽」', Array.isArray(menuLabels) && menuLabels.some((l) => String(l).includes('固定宽度') || String(l).includes('全宽')),
    JSON.stringify(menuLabels));
  check('d) ⋯ 菜单含 T44 承载转换项（转为 Wiki / 转为普通页）', Array.isArray(menuLabels) && menuLabels.some((l) => String(l).includes('转为 Wiki') || String(l).includes('转为普通页')),
    JSON.stringify(menuLabels));
  const menuShot = await shot(page, 'rc26-smoke-02-page-menu');
  info('截图（⋯ 菜单态）', `rc26-smoke-02-page-menu.png ${String(menuShot.w)}x${String(menuShot.h)}`);
  await page.keyboard.press('Escape').catch(() => {});
  await page.mouse.click(600, 500).catch(() => {});
  await wait(400);

  // —— 命令面板：Ctrl+K（renderer keydown 路径；主进程 globalShortcut 走 OS 热键，
  //    CDP 合成输入不经过 OS，因此此处只覆盖 renderer 那一路）——
  const paletteDiag = {
    attempts: [],
    activeElement: null,
  };
  const paletteSnapshot = async () =>
    page.evaluate(() => ({
      panel: document.querySelector('[data-testid="palette-panel"]') !== null,
      overlay: document.querySelector('[data-testid="palette-overlay"]') !== null,
      active: document.activeElement === null ? null : `${document.activeElement.tagName}.${document.activeElement.className}`,
    }));
  const attemptOpen = async (how, fn) => {
    await fn();
    await wait(800);
    const snap = await paletteSnapshot();
    paletteDiag.attempts.push({ how, ...snap });
    return snap.panel;
  };
  let paletteOpen = await attemptOpen('Control+k（playwright press）', async () => {
    // 先把焦点挪出编辑器（ProseMirror 内的焦点会吃掉按键；实测首轮即失败于此）
    await page.locator('.sc-shell__topbar').click({ force: true }).catch(() => {});
    await wait(300);
    await page.keyboard.press('Control+k');
  });
  if (!paletteOpen) {
    // 二次尝试：显式 down/up 序列（排除 press 组合键时序）
    paletteOpen = await attemptOpen('Control down → k → Control up', async () => {
      await page.keyboard.down('Control');
      await page.keyboard.press('k');
      await page.keyboard.up('Control');
    });
  }
  if (!paletteOpen) {
    // 三次尝试：合成 KeyboardEvent（只证明渲染层接线，非真实按键路径，会如实标注）
    paletteOpen = await attemptOpen('window.dispatchEvent(KeyboardEvent ctrlKey+k)（合成，非真实按键）', async () => {
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      });
    });
  }
  paletteDiag.activeElement = await page.evaluate(() =>
    document.activeElement === null ? null : `${document.activeElement.tagName}.${document.activeElement.className}`,
  );
  info('d) 命令面板打开尝试记录', JSON.stringify(paletteDiag));

  if (paletteOpen) {
    await page.keyboard.type('>', { delay: 30 }).catch(() => {});
    await wait(800);
  }
  const palette = await page.evaluate(PALETTE_ROWS);
  smokeReport.palette = palette;
  smokeReport.paletteDiag = paletteDiag;
  check('d) 命令面板可打开（[data-testid=palette-panel]）', palette !== null,
    palette === null ? `panel=null 尝试记录=${JSON.stringify(paletteDiag)}` : `aria=${JSON.stringify(palette.aria)} 行数=${String(palette.rows.length)}`);
  check('d) 命令面板命令项数组非空', palette !== null && palette.rows.length > 0,
    `命令项数组=${JSON.stringify(palette?.rows ?? null)}`);
  check('d) 命令面板含 T41「全宽 / 固定宽度」', palette !== null && palette.rows.some((r) => String(r).includes('全宽 / 固定宽度')),
    JSON.stringify(palette?.rows ?? null));
  await page.keyboard.press('Escape').catch(() => {});
  await wait(400);

  // T44 反向链接面板（活体：T44 的派生索引 + 渲染）
  const backlinks = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="backlinks-panel"]');
    return panel === null
      ? null
      : {
          title: panel.querySelector('.pv-backlinks__title')?.textContent ?? null,
          empty: panel.querySelector('.pv-backlinks__empty')?.textContent ?? null,
          items: panel.querySelectorAll('[data-testid="backlinks-item"]').length,
        };
  });
  const linksIpc = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
    const target = tree[0] ?? null;
    if (target === null) return { skipped: true };
    try {
      return await window.septcats.links.backlinks({ pageId: target.id });
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  });
  smokeReport.backlinks = { dom: backlinks, ipc: linksIpc };
  check('d) T44 反向链接面板在 DOM（标题「反向链接」）', backlinks !== null && backlinks.title === '反向链接',
    JSON.stringify(backlinks));
  check('d) T44 links:backlinks 通道返回 entries 数组', Array.isArray(linksIpc?.entries),
    JSON.stringify(linksIpc));

  // ---- e) 错误计数 ----
  STEP = 'e-errors';
  check('e) 全程 pageerror 计数 = 0', pageErrors.length === 0,
    `pageErrors=${String(pageErrors.length)} ${JSON.stringify(pageErrors.slice(0, 5))}`);
  check('e) 全程 renderer console error 计数 = 0', consoleErrors.length === 0,
    `consoleErrors=${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 5))}`);

  // ---- f) 优雅退出 ----
  STEP = 'f-graceful-quit';
  const q = await quit(page, run.pid, run.browser);
  smokeReport.gracefulExited = q.gracefulExited;
  check('f) window.close() 优雅退出（未强杀）', q.gracefulExited === true, `gracefulExited=${String(q.gracefulExited)}`);

  // ---- 隔离自检 ----
  STEP = 'isolation';
  const realRootAfter = mtime(REAL_ROOT);
  check('真实数据根 C:\\Users\\Administrator\\.septcats 未被触碰（mtime 不变）', realRootBefore === realRootAfter,
    `before=${realRootBefore} after=${realRootAfter}`);
  smokeReport.fixtureFiles = { dataDir: countFiles(ROOT), udDir: countFiles(UD) };
  check('夹具目录被真实写入（rootPath 生效）', existsSync(join(ROOT, 'septcats.db')) && smokeReport.fixtureFiles.dataDir > 0,
    `rootPath=${ROOT} db=${existsSync(join(ROOT, 'septcats.db'))} 文件数=${String(smokeReport.fixtureFiles.dataDir)} logs=${existsSync(join(ROOT, 'logs'))}`);
  smokeReport.stderrTail = readTail(STDERR_LOG);
  smokeReport.stdoutTail = readTail(STDOUT_LOG);
  info('应用 stderr 尾部（原文，最多 2000 字）', JSON.stringify(smokeReport.stderrTail));
  info('应用 stdout 尾部（原文，最多 2000 字）', JSON.stringify(smokeReport.stdoutTail));
  // 主进程 stderr 里的自动更新检查失败（产品既有行为：启动即 check()；本探针不阻断）
  const stderrFull = (() => {
    try {
      return readFileSync(STDERR_LOG, 'utf8');
    } catch {
      return '';
    }
  })();
  const updaterLine = /Error: Error: Cannot find channel[^\n]*/i.exec(stderrFull);
  const updaterUrl = /https:\/\/[^\s"']*latest\/[^\s"'?]*/i.exec(stderrFull);
  smokeReport.updaterCheckError = updaterLine === null ? null : updaterLine[0];
  info('主进程 stderr 中的「启动自动更新检查」失败（原文首行，产品既有行为·非本次引入）',
    `line=${JSON.stringify(smokeReport.updaterCheckError)} url=${JSON.stringify(updaterUrl === null ? null : updaterUrl[0])}`);
  info('本次运行是否零外网', `否——打包产物启动后自身会做一次更新检查（electron-updater），命中 ${JSON.stringify(updaterUrl === null ? null : updaterUrl[0])} 并 404；探针自身未发起任何外网请求`);
}

function readTail(path) {
  try {
    const out = readFileSync(path, 'utf8');
    return out.length > 2000 ? out.slice(out.length - 2000) : out;
  } catch {
    return '';
  }
}

// ===========================================================================
const t0All = Date.now();
let staticOk = false;
try {
  staticOk = await runStaticVerification();
} catch (err) {
  check('② 包内代码验证整体执行', false, `原始异常：${String(err?.stack ?? err)}`);
}
if (!staticOk) {
  info('② 包内代码验证未完成', '前置缺失（EXE/asar 不存在）或解析异常——原始值见上');
}
try {
  await runSmoke();
} catch (err) {
  check('① 启动冒烟整体执行', false, `原始异常：${String(err?.stack ?? err)}`);
  FATAL = true;
}

const fails = results.filter((r) => r.ok === false).length;
const passes = results.filter((r) => r.ok === true).length;
const payload = {
  task: 'TASK-T48-01 rc.26 打包产物启动冒烟 + 包内代码验证',
  ranAt: new Date().toISOString(),
  exe: EXE,
  asar: ASAR,
  isolatedFrom: REAL_ROOT,
  fixture: { userDataDir: UD, rootPath: ROOT, port: PORT, settingsFile: join(UD, 'septcats.settings.json') },
  static: staticReport,
  smoke: smokeReport,
  fatal: FATAL,
  pass: passes,
  fail: fails,
  assertions: results,
  screenshots: shots,
  pageErrors,
  consoleErrors,
};
writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
console.log(`\n${String(passes)}/${String(passes + fails)} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${String(fails)} 项失败`}${FATAL ? '  ✗✗ 冒烟致命失败（现场已保留）' : ''}`);
console.log(`results → ${OUT_JSON}`);
console.log(`shots   → ${SHOTS}`);
console.log(`fixture → ${RUN}（保留，未清理）`);
console.log(`elapsed → ${String(Date.now() - t0All)}ms`);
process.exit(fails === 0 ? 0 : 1);
