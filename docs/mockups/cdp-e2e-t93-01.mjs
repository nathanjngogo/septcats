/* cdp-e2e-t93-01.mjs —— T93-01「一级侧边栏（NavRail）」真机验收
 * （老板 09-29 令：「请在左侧边栏再加一级侧边栏，用来区分笔记、知识库等一级菜单。」）
 *
 * 方案：AppShell 新增可选 rail 插槽（不传时两列网格零影响）→ 三列 = rail(56) | 侧栏(240) | 主区；
 * 一级八项 = 笔记 / 知识库 / 日历 / 多维表格 / 待办 / 工作台 / 模板 / 回收站（纯中文短标签，无图标）；
 * （日历/待办是 09-30 令新增的一级项，紧随知识库之后——R2 的标签序列一并升级。）
 * 「知识库」的二级栏 = 本机库列表（切换 / 新建），其余一级项的二级栏保持页面树。
 *
 * 判据（全部 DOM/几何客观量）：
 *   R1 三列几何：rail 宽 = 56±1、侧栏宽 = 240±2、主区右缘 = 窗口右缘；rail 在最左（rail.right ≤ sidebar.left+1）。
 *   R2 一级轨八项中文标签齐全（含日历/多维表格/待办）、默认「笔记」为当前项（aria-current=page）、整排无 svg。
 *   R3 二级栏分流：点「知识库」→ kb-panel 出现且页面树消失；点「笔记」→ 复原。
 *   R4 库列表内容：条目数 ≥ 1 且当前库带「当前」标记；「新建库…」入口在位。
 *   R5 折叠二级栏后一级轨保留（rail 仍在、宽度不变；侧栏列消失）。
 *   R6 工作台 / 模板 / 回收站 三项高亮跟随既有视图状态（aria-current）。
 *   R7 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t93-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9600');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t93', 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) {
  console.log(text);
  try { mkdirSync(dirname(RESULT), { recursive: true }); appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* 取证失败不阻断 */ }
}
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 240) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* 已退 */ } }
function killStaleApp() { try { execSync('taskkill /F /IM Septcats.exe', { stdio: 'ignore' }); } catch { /* 无进程 */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

let CHILD = null;

async function boot() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: dirname(PACKAGE_APP), detached: false, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(700); }
  }
  if (browser === null) throw new Error('CDP 连接超时');
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  let page = null;
  for (let i = 0; i < 30; i++) { await wait(500); page = ctx.pages().find((p) => p.url().includes('index.html')); if (page) break; }
  if (page === null) throw new Error('主窗口未就绪');
  for (let i = 0; i < 20; i++) {
    await wait(400);
    if (await page.evaluate(() => document.querySelector('[data-testid="nav-rail"]') !== null)) break;
  }
  await wait(1200);
  return { child: CHILD, browser, page };
}

/** 布局几何 + 一级轨状态转储。 */
const DUMP = () => {
  const rail = document.querySelector('[data-testid="nav-rail"]');
  const railCol = document.querySelector('.sc-shell__rail');
  const sidebar = document.querySelector('.sc-shell__sidebar');
  const main = document.querySelector('.sc-shell__main');
  const box = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
  };
  return {
    rail: box(railCol),
    sidebar: box(sidebar),
    main: box(main),
    winW: window.innerWidth,
    items: rail === null ? [] : [...rail.querySelectorAll('button')].map((b) => ({
      key: (b.getAttribute('data-testid') ?? '').replace('nav-rail-', ''),
      text: (b.textContent ?? '').trim(),
      current: b.getAttribute('aria-current'),
      hasSvg: b.querySelector('svg') !== null,
    })),
    kbPanel: document.querySelector('[data-testid="kb-panel"]') !== null,
    pageTree: document.querySelector('[data-testid="side-new-page"]') !== null,
    kbRows: document.querySelectorAll('[data-testid^="kb-row-"]').length,
    kbNew: document.querySelector('[data-testid="kb-new"]') !== null,
    kbCurrentTagged: [...document.querySelectorAll('[data-testid^="kb-row-"]')].some((r) => (r.textContent ?? '').includes('当前')),
  };
};

async function shot(page, name) {
  const target = await page.evaluate(() => {
    const el = document.querySelector('.sc-shell__body');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.min(900, Math.round(r.width)), height: Math.min(420, Math.round(r.height)) };
  });
  if (target === null) return null;
  const buf = await page.screenshot({ clip: target });
  writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
  return join(SHOT_DIR, `${name}.png`);
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(PACKAGE_APP)) { line('FATAL 缺打包靶 ' + PACKAGE_APP); process.exitCode = 2; return; }
  const realBefore = rootMtime();

  const h = await boot();
  const { page } = h;

  STEP = 'R1';
  const d0 = await page.evaluate(DUMP);
  const railOk = d0.rail !== null && Math.abs(d0.rail.w - 56) <= 1;
  const sideOk = d0.sidebar !== null && Math.abs(d0.sidebar.w - 240) <= 2;
  const orderOk = d0.rail !== null && d0.sidebar !== null && d0.rail.right <= d0.sidebar.x + 1;
  const mainOk = d0.main !== null && d0.main.right <= d0.winW + 1;
  check('R1 三列几何：rail=56±1 / 侧栏=240±2 / rail 在最左 / 主区右缘贴窗口',
    railOk && sideOk && orderOk && mainOk,
    `rail=${JSON.stringify(d0.rail)} sidebar=${JSON.stringify(d0.sidebar)} main=${JSON.stringify(d0.main)} winW=${String(d0.winW)}`);

  STEP = 'R2';
  const itemsOk = d0.items.length === 8 &&
    d0.items.map((i) => i.text).join('|') === '笔记|知识库|日历|多维表格|待办|工作台|模板|回收站' &&
    d0.items.every((i) => i.hasSvg === false) &&
    d0.items.filter((i) => i.current === 'page').length === 1 &&
    d0.items[0].current === 'page';
  check('R2 一级轨：八项中文标签齐全（含日历/多维表格/待办）、整排无图标、默认「笔记」为当前项',
    itemsOk, JSON.stringify(d0.items));

  const shot1 = await shot(page, 'rail-notes');

  STEP = 'R3';
  await page.locator('[data-testid="nav-rail-kb"]').click({ force: true });
  await wait(900);
  const d1 = await page.evaluate(DUMP);
  const kbOnOk = d1.kbPanel === true && d1.pageTree === false && d1.items[1].current === 'page';
  await page.locator('[data-testid="nav-rail-notes"]').click({ force: true });
  await wait(900);
  const d2 = await page.evaluate(DUMP);
  const kbOffOk = d2.kbPanel === false && d2.pageTree === true && d2.items[0].current === 'page';
  check('R3 二级栏分流：知识库 → 库列表（页面树隐去）；笔记 → 复原',
    kbOnOk && kbOffOk,
    `kbOn={panel:${String(d1.kbPanel)},tree:${String(d1.pageTree)},cur:${String(d1.items[1].current)}} kbOff={panel:${String(d2.kbPanel)},tree:${String(d2.pageTree)},cur:${String(d2.items[0].current)}}`);

  STEP = 'R4';
  await page.locator('[data-testid="nav-rail-kb"]').click({ force: true });
  await wait(900);
  const d3 = await page.evaluate(DUMP);
  check('R4 库列表：条目 ≥1 且当前库带标记；「新建库…」入口在位',
    d3.kbRows >= 1 && d3.kbCurrentTagged === true && d3.kbNew === true,
    `rows=${String(d3.kbRows)} currentTagged=${String(d3.kbCurrentTagged)} newEntry=${String(d3.kbNew)}`);
  const shot2 = await shot(page, 'rail-kb');

  STEP = 'R5';
  await page.locator('[data-testid="side-toggle"]').click({ force: true });
  await wait(1000);
  const d4 = await page.evaluate(DUMP);
  // 折叠 = 二级栏 display:none（rect 0×0），不是节点消失 —— 两种形态都算折叠成立
  const sideGone = d4.sidebar === null || d4.sidebar.w === 0;
  const collapsedOk =
    sideGone && d4.rail !== null && Math.abs(d4.rail.w - 56) <= 1 &&
    d4.main !== null && d4.main.x >= 56 - 1 && d4.main.w > d0.main.w;
  check('R5 折叠二级栏后一级导航保留（侧栏列消失、rail 仍 56px 且在位）',
    collapsedOk,
    `rail=${JSON.stringify(d4.rail)} sidebar=${JSON.stringify(d4.sidebar)} main=${JSON.stringify(d4.main)}`);
  const shot3 = await shot(page, 'rail-collapsed');
  await page.locator('[data-testid="side-toggle"]').click({ force: true }).catch(() => {});
  await wait(900);

  STEP = 'R6';
  const seq = [];
  for (const key of ['home', 'templates', 'trash', 'notes']) {
    await page.locator(`[data-testid="nav-rail-${key}"]`).click({ force: true });
    await wait(900);
    const d = await page.evaluate(DUMP);
    const active = d.items.find((i) => i.current === 'page');
    seq.push(`${key}->${active === undefined ? 'none' : active.key}`);
  }
  check('R6 工作台/模板/回收站/笔记 四项高亮跟随既有视图状态',
    seq.join(' ') === 'home->home templates->templates trash->trash notes->notes',
    seq.join(' '));

  STEP = 'R7';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('R7 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T93-01 一级侧边栏探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked，${String(Math.round((Date.now() - t0) / 1000))}s，截图 ${SHOT_DIR}）=====`);
  line(`截图：${String(shot1)} | ${String(shot2)} | ${String(shot3)}`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});