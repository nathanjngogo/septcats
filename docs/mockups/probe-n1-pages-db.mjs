/* probe-n1-pages-db.mjs —— 真机深功能探针：**编辑器/页面 + 多维表格**（老板 10-07 报障：
 * 「还有很多Bug，功能都实现不了」，勾选区 = 编辑器与页面 + 多维表格，时间线 = 0.6.14/0.6.15 起）。
 *
 * 为什么要有它：jsdom 层 1500+ 测试全绿、IPC 接线全通（119 频道）、桥接面 0 缺——静态与单测
 * 都查不出「真机上用不了」。所以本探针在**真机**上从数据层到 UI 层各走一遍，逐项给 PASS/FAIL
 * ＋证据，失败自动截图，末尾落 JSON 报告。它不猜、不靠肉眼，直接回答「哪一层断的」。
 *
 * 判据分层：
 *   ① 数据层（window.septcats.* 直驱）：页面增改/外观/块落库/库页属性·记录·视图——绕过 UI，
 *      看 IPC + 落库本身是否可用；② UI 层（真点击/真输入）：数据层成功但 UI 没反映 = **接线断点**，
 *      这正是「功能实现不了」的典型形态；③ 路由层：库页重开是否仍进表格（不回落编辑器）。
 *
 * 安全：只动 _scratch 夹具档（--user-data-dir 隔离）；真实档案根 mtime 全程不变（G1 硬断言）。
 * 用法（Windows 仓根）：node docs/mockups/probe-n1-pages-db.mjs
 *   靶子默认 apps/desktop/dist/win-unpacked/Septcats.exe；
 *   验装好的版本：set SEPTCATS_APP_BIN=C:\Users\Administrator\AppData\Local\Programs\Septcats\Septcats.exe
 * 产物：docs/mockups/screens-probe-n1/（失败截图）+ docs/mockups/probe-n1-report.json
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 'n1';
const RUN = process.env.SEPTCATS_RUN_DIR ?? `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = `${RUN}\\ud`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9571');
const REAL_ROOT = process.env.SEPTCATS_REAL_ROOT ?? 'C:\\Users\\Administrator\\.septcats';
const SHOTS = join(SCRIPT_DIR, `screens-${RUN_NAME}`);
const REPORT = join(SCRIPT_DIR, `probe-${RUN_NAME}-report.json`);
const APP_BIN =
  process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const KEEP = process.env.SEPTCATS_KEEP === '1';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
let STEP = 'boot';
function check(name, ok, evidence) {
  results.push({ step: STEP, name, ok: Boolean(ok), evidence: evidence === undefined ? '' : String(evidence).slice(0, 300) });
  console.log(`${ok ? '✓' : '✗'} [${STEP}] ${name}${evidence === undefined ? '' : ` — ${String(evidence).slice(0, 160)}`}`);
  return Boolean(ok);
}
async function step(label, fn) {
  STEP = label;
  try {
    await fn();
  } catch (error) {
    check(`${label} 步骤未抛异常`, false, `抛错：${String(error).slice(0, 200)}`);
  }
}
async function waitFor(fn, timeout = 8000, interval = 250) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch { /* 重试到超时 */ }
    await wait(interval);
  }
  return false;
}
function realRootMtime() {
  try { return statSync(REAL_ROOT).mtimeMs; } catch { return null; }
}
function killAll() {
  for (const cmd of [
    `taskkill /F /IM Septcats.exe /T >NUL 2>NUL`,
    `powershell -NoProfile -Command "Get-Process Septcats -ErrorAction SilentlyContinue | Stop-Process -Force" >NUL 2>NUL`,
  ]) {
    try { execSync(cmd, { stdio: 'ignore', shell: 'cmd.exe' }); } catch { /* 没进程最好 */ }
  }
}
async function selectPage(page, id, title) {
  return page.evaluate(
    ([pid, ttl]) => {
      const row =
        document.querySelector(`[data-testid="side-node-${pid}"]`) ??
        [...document.querySelectorAll('.app-nav-row')].find((n) => (n.textContent ?? '').includes(ttl)) ??
        null;
      if (row === null) return false;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    },
    [id, title],
  );
}
async function clickByText(page, text, opts = {}) {
  return page.evaluate(
    ([t, tag]) => {
      const nodes = [...document.querySelectorAll(tag ?? 'button, [role=button], a, summary, div')];
      const hit = nodes.find((n) => (n.textContent ?? '').trim() === t) ??
        nodes.find((n) => (n.textContent ?? '').trim().includes(t));
      if (hit === undefined) return false;
      hit.click();
      return true;
    },
    [text, opts.tag],
  );
}
async function shot(page, slug) {
  try {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${String(results.length).padStart(2, '0')}-${slug}.png`) });
  } catch { /* 截图失败不影响判定 */ }
}

// ── 前置：夹具档 + 真实档案 mtime 基线 ────────────────────────────────────────
if (!existsSync(APP_BIN)) {
  console.log(`✗ 找不到应用二进制：${APP_BIN}\n  用 SEPTCATS_APP_BIN 指向已装版本或先 pnpm -C apps/desktop dist`);
  process.exit(2);
}
rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const REAL_BEFORE = realRootMtime();
console.log(`靶子：${APP_BIN}\n夹具：${RUN}\n真实档案根 mtime 基线：${String(REAL_BEFORE)}`);

killAll();
const proc = spawn(APP_BIN, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
  detached: true,
  stdio: 'ignore',
});
proc.unref();

// ── 连接 ────────────────────────────────────────────────────────────────────
let browser = null;
for (let i = 0; i < 60 && browser === null; i += 1) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
  } catch {
    await wait(500);
  }
}
if (browser === null) {
  check('CDP 连上应用实例', false, `端口 ${String(PORT)} 60 次重试未连上（应用是否启动失败？看 Windows 是否有报错窗）`);
  killAll();
  writeFileSync(REPORT, JSON.stringify({ results, fatal: 'no-cdp' }, null, 2), 'utf8');
  process.exit(1);
}
check('CDP 连上应用实例', true);

const ctx = browser.contexts()[0] ?? (await browser.newContext());
let page = ctx.pages().find((p) => !p.url().startsWith('devtools://')) ?? (await ctx.newPage());
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(String(e).slice(0, 200)); });
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 200)}`); });

async function bridgeReady(p) {
  return waitFor(async () => p.evaluate(() => typeof window.septcats === 'object' && window.septcats !== null), 30_000);
}
check('preload 桥就绪（window.septcats）', await bridgeReady(page));

// ── A 外壳 ──────────────────────────────────────────────────────────────────
await step('A 外壳', async () => {
  const shell = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.sc-shell'))), 20_000);
  check('A1 应用外壳挂载（.sc-shell）', shell);
  const side = await page.evaluate(() => ({
    sidebar: Boolean(document.querySelector('.sc-shell__sidebar')),
    rail: Boolean(document.querySelector('.nav-rail')),
    host: Boolean(document.querySelector('.app-overlay-host')),
  }));
  check('A2 侧栏 / 导轨 / 浮层宿主齐备', side.sidebar && side.rail, JSON.stringify(side));
  if (!shell) await shot(page, 'A-shell-missing');
});

// ── B 页面数据层（IPC 直驱）───────────────────────────────────────────────────
let wsId = null;
let pageId = null;
await step('B 页面数据层', async () => {
  const ws = await page.evaluate(async () => {
    const r = await window.septcats.workspaces.list();
    return { activeId: r.activeId, count: r.items.length };
  });
  wsId = ws.activeId;
  check('B1 workspaces.list 可用且活动工作区非空', typeof wsId === 'string' && wsId.length > 0, JSON.stringify(ws));

  const created = await page.evaluate(async () => window.septcats.pages.create({ parentId: null }));
  pageId = created.id;
  check('B2 pages.create 可用（返回 id）', typeof pageId === 'string' && pageId.length > 0, JSON.stringify(created));

  const renamed = await page.evaluate(async ([id]) => window.septcats.pages.rename({ id, title: '探针页面A' }), [pageId]);
  const tree1 = await page.evaluate(async ([w]) => window.septcats.pages.tree({ workspaceId: w }), [wsId]);
  const node1 = tree1.find((n) => n.id === pageId);
  check('B3 pages.rename 生效（树里标题一致）', node1?.title === '探针页面A' && renamed.id === pageId, `title=${String(node1?.title)}`);

  // ★ 新功能硬验证：外观（图标/封面）——patch op 是否真落库
  await page.evaluate(async ([id]) => window.septcats.pages.appearance({ id, icon: '📄', cover: 'aurora' }), [pageId]);
  const tree2 = await page.evaluate(async ([w]) => window.septcats.pages.tree({ workspaceId: w }), [wsId]);
  const node2 = tree2.find((n) => n.id === pageId);
  check(
    'B4 pages.appearance 落库（图标/封面写进 page 行并被树读回）',
    node2?.icon === '📄' && node2?.cover === 'aurora',
    `icon=${String(node2?.icon)} cover=${String(node2?.cover)}`,
  );
  check('B5 普通页 pageType=page（未转换时）', node2?.pageType === 'page', String(node2?.pageType));

  // 清掉外观，留给 F 段做 UI 验证
  await page.evaluate(async ([id]) => window.septcats.pages.appearance({ id, icon: null, cover: null }), [pageId]);
});

// ── C 编辑器（UI 真交互）─────────────────────────────────────────────────────
await step('C 编辑器', async () => {
  if (pageId === null) { check('C 前置：已有页面', false, 'B 段未建出页面'); return; }
  // 选中该页：走侧栏树真点击（命中 data-id=pageId 的行）
  const selected = await selectPage(page, pageId, '探针页面A');
  check('C0 侧栏能选中新页（真点击）', selected);
  const mounted = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.pv-body .ProseMirror'))), 12_000);
  check('C1 编辑器挂载（.pv-body .ProseMirror）', mounted, mounted ? '' : '编辑器未挂载——页面打不开时这是第一断点');
  if (!mounted) { await shot(page, 'C-editor-not-mounted'); return; }

  await page.click('.pv-body .ProseMirror');
  await page.keyboard.type('探针文本ABC');
  const typed = await waitFor(() => page.evaluate(() => (document.querySelector('.pv-body .ProseMirror')?.textContent ?? '').includes('探针文本ABC')), 5000);
  check('C2 真键盘输入进入编辑器 DOM', typed);

  const persisted = await waitFor(async () =>
    page.evaluate(async ([id]) => {
      const r = await window.septcats.blocks.list({ pageId: id });
      return (r.blocks ?? []).some((b) => JSON.stringify(b.content ?? '').includes('探针文本ABC')) ? true : false;
    }, [pageId]), 10_000);
  check('C3 输入落库（blocks.list 读回同一文本）', persisted, persisted ? '' : 'DOM 有但库里没有 = 保存通路断了');

  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const slash = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.sc-slashmenu, [role=menu]'))), 4000);
  check('C4 斜杠菜单可唤出', slash);
  await page.keyboard.press('Escape');
});

// ── D 转为多维数据 + 路由闭环 ────────────────────────────────────────────────
await step('D 库页路由', async () => {
  if (pageId === null) { check('D 前置：已有页面', false, 'B 段未建出页面'); return; }
  const clicked = await clickByText(page, '转为多维数据');
  check('D1 点「转为多维数据」按钮命中', clicked);
  const converted = await waitFor(async () =>
    page.evaluate(async ([id]) => {
      try {
        const r = await window.septcats.db.load({ pageId: id });
        return r.collection ? true : false;
      } catch { return false; }
    }, [pageId]), 12_000);
  check('D2 转换后 db.load 能读到 collection（数据层）', converted);

  const grid = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.dbpage .sc-dbgrid, .dbpage .sc-dbhead'))), 12_000);
  check('D3 库页 UI 挂载（表格网格出现）', grid, grid ? '' : '数据层有 collection 但 UI 没画表格 = 断点在此');
  if (!grid) await shot(page, 'D-grid-missing');

  const editorGone = await page.evaluate(() => !document.querySelector('.pv-body .ProseMirror'));
  check('D4 转换后编辑器已卸载（不再同时挂编辑器）', editorGone);

  // 路由闭环（真机口径）：切到别的页再切回本页，仍应是表格而非编辑器
  const away = await selectPage(page, wsId === null ? '' : await page.evaluate(async () => {
    const r = await window.septcats.pages.tree({ workspaceId: (await window.septcats.workspaces.list()).activeId });
    const other = r.find((n) => n.pageType !== 'database' && n.id !== null);
    return other?.id ?? '';
  }), '未命名');
  await wait(1200);
  await selectPage(page, pageId, '探针页面A');
  const stillGrid = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.dbpage .sc-dbgrid, .dbpage .sc-dbhead'))), 8000);
  check('D5 库页保持表格形态（路由未回落编辑器）', stillGrid);
});

// ── E 多维表格功能 ──────────────────────────────────────────────────────────
await step('E 多维表格', async () => {
  if (pageId === null) { check('E 前置：已有库页', false, 'B 段未建出页面'); return; }
  const before = await page.evaluate(async ([id]) => {
    const r = await window.septcats.db.load({ pageId: id });
    return { props: Object.keys(r.collection.schema.properties).length, records: r.records.length, views: (r.collection.views ?? []).length };
  }, [pageId]).catch(() => null);
  check('E0 db.load 基线可读', before !== null, JSON.stringify(before));

  // E1/E2 加属性：数据层 vs UI
  const prop = await page.evaluate(async ([id]) => window.septcats.db.propAdd({ pageId: id, type: 'text' }), [pageId]).catch((e) => `ERR ${String(e).slice(0, 80)}`);
  const afterProps = await page.evaluate(async ([id]) => {
    const r = await window.septcats.db.load({ pageId: id });
    return Object.keys(r.collection.schema.properties).length;
  }, [pageId]).catch(() => -1);
  check('E1 db.propAdd 数据层生效（属性数 +1）', typeof before?.props === 'number' && afterProps === before.props + 1, `${String(before?.props)} → ${String(afterProps)}`);
  const headAfter = await page.evaluate(() => document.querySelectorAll('.dbpage .sc-dbhead__cell').length);
  check('E2 加属性后 UI 表头列数跟随（接线断点判据）', typeof before?.props === 'number' && headAfter >= before.props + 1, `表头列=${String(headAfter)}`);

  // E3/E4 记录：数据层 + 真点击单元格编辑
  const rec = await page.evaluate(async ([id]) => window.septcats.db.recordCreate({ pageId: id }), [pageId]).catch((e) => `ERR ${String(e).slice(0, 80)}`);
  const recCount = await page.evaluate(async ([id]) => (await window.septcats.db.load({ pageId: id })).records.length, [pageId]).catch(() => -1);
  check('E3 db.recordCreate 数据层生效（记录数 +1）', typeof rec === 'object' && recCount === (before?.records ?? 0) + 1, `记录 ${String(before?.records)} → ${String(recCount)}`);
  const cellCount = await waitFor(() => page.evaluate(() => document.querySelectorAll('.dbpage .sc-dbcell').length > 0), 6000);
  check('E4 记录出现在 UI 网格（.sc-dbcell 出现）', cellCount);

  // E5 视图持久化
  const views = await page.evaluate(async ([id]) => (await window.septcats.db.load({ pageId: id })).collection.views ?? [], [pageId]).catch(() => []);
  check('E5 collection.views 可读（视图条数据源）', Array.isArray(views), `views=${Array.isArray(views) ? views.length : 'n/a'}`);

  // E6 筛选/排序 chip 面
  const chips = await page.evaluate(() => document.querySelectorAll('.dbpage .sc-chip').length);
  check('E6 属性条渲染（.sc-chip 数 ≥1）', chips >= 1, `chip=${String(chips)}`);

  // E7 CSV 导出（数据层）
  const csv = await page.evaluate(async ([id]) => {
    try { const r = await window.septcats.db.exportCsv({ pageId: id }); return String(r.csv ?? '').length; } catch (e) { return `ERR ${String(e).slice(0, 60)}`; }
  }, [pageId]).catch((e) => `ERR ${String(e).slice(0, 60)}`);
  check('E7 db.exportCsv 可用（CSV 非空）', typeof csv === 'number' && csv > 0, `csv 长度=${String(csv)}`);
  if (!cellCount) await shot(page, 'E-cells-missing');
});

// ── F 新功能：图标 / 封面（UI 真点）─────────────────────────────────────────
await step('F 图标与封面', async () => {
  if (pageId === null) { check('F 前置：已有页面', false, 'B 段未建出页面'); return; }
  // 回到普通页：新建一个空白页做外观验证
  const fresh = await page.evaluate(async () => window.septcats.pages.create({ parentId: null }));
  const freshId = fresh.id;
  await selectPage(page, freshId, '未命名');
  const titleRow = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('.pv-title-row'))), 10_000);
  check('F0 新页可打开（题头行出现）', titleRow);
  if (!titleRow) { await shot(page, 'F-title-missing'); return; }

  // 图标：hover 题头 → 点「添加图标」
  await page.hover('.pv-title-row').catch(() => {});
  const addIcon = await waitFor(() => page.evaluate(() => {
    const b = document.querySelector('[data-testid=page-add-icon]');
    if (b === null) return false;
    b.click();
    return true;
  }), 5000);
  check('F1 「添加图标」按钮可点（hover 显形后）', addIcon);
  const picker = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid=page-appearance-icon]'))), 4000);
  check('F2 图标画廊浮层出现', picker);
  if (picker) {
    const picked = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=page-icon-option-📄]') ?? document.querySelector('[data-testid^=page-icon-option-]');
      if (b === null) return false;
      b.click();
      return true;
    });
    const shown = await waitFor(() => page.evaluate(() => document.querySelector('[data-testid=page-icon]')?.textContent ?? ''), 5000);
    check('F3 选图标后题头出现图标（UI 生效）', picked && String(shown).length > 0, `icon=${String(shown)}`);
    const persisted = await page.evaluate(async ([w, id]) => {
      const tree = await window.septcats.pages.tree({ workspaceId: w });
      return tree.find((n) => n.id === id)?.icon ?? null;
    }, [wsId, freshId]).catch(() => null);
    check('F4 图标落库（树读回非空）', typeof persisted === 'string' && persisted.length > 0, `tree.icon=${String(persisted)}`);
  }

  // 封面
  await page.hover('.pv-title-row').catch(() => {});
  const addCover = await waitFor(() => page.evaluate(() => {
    const b = document.querySelector('[data-testid=page-add-cover]');
    if (b === null) return false;
    b.click();
    return true;
  }), 5000);
  check('F5 「添加封面」按钮可点', addCover);
  const coverPicker = await waitFor(() => page.evaluate(() => Boolean(document.querySelector('[data-testid=page-appearance-cover]'))), 4000);
  check('F6 封面画廊浮层出现', coverPicker);
  if (coverPicker) {
    const pickedCover = await page.evaluate(() => {
      const b = document.querySelector('[data-testid=page-cover-option-aurora]');
      if (b === null) return false;
      b.click();
      return true;
    });
    const coverEl = await waitFor(() => page.evaluate(() => document.querySelector('[data-testid=page-cover]')?.getAttribute('data-cover') ?? ''), 5000);
    check('F7 封面渲染（.pv-cover 出现且 data-cover 命中）', pickedCover && coverEl === 'aurora', `data-cover=${String(coverEl)}`);
    const persistedCover = await page.evaluate(async ([w, id]) => {
      const tree = await window.septcats.pages.tree({ workspaceId: w });
      return tree.find((n) => n.id === id)?.cover ?? null;
    }, [wsId, freshId]).catch(() => null);
    check('F8 封面落库（树读回）', persistedCover === 'aurora', `tree.cover=${String(persistedCover)}`);
    if (coverEl !== 'aurora') await shot(page, 'F-cover-not-rendered');
  }
});

// ── G 收尾：真实档案不被碰 ──────────────────────────────────────────────────
await step('G 硬不变量', async () => {
  const after = realRootMtime();
  check('G1 真实档案根 mtime 未变（夹具口径成立）', REAL_BEFORE === after, `before=${String(REAL_BEFORE)} after=${String(after)}`);
  check('G2 无效 UI 崩溃（pageerror/console-error 计数）', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
});

// ── 报告 + 收尾 ─────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
writeFileSync(
  REPORT,
  JSON.stringify(
    { at: new Date().toISOString(), app: APP_BIN, run: RUN, port: PORT, pageErrors, results },
    null,
    2,
  ),
  'utf8',
);
console.log(`\n报告：${REPORT}`);
console.log(`截图：${SHOTS}`);
if (pageErrors.length > 0) {
  console.log('\n捕获到的错误（前 10 条）：');
  for (const e of pageErrors.slice(0, 10)) console.log(`  ! ${e}`);
}
console.log(`\n== probe-n1 ${failed.length === 0 ? 'ALL-PASS' : `${String(failed.length)} FAILED`} / ${String(results.length)} 项 ==`);
console.log('失败项：');
for (const f of failed) console.log(`  ✗ [${f.step}] ${f.name} — ${f.evidence}`);

await browser.close().catch(() => {});
killAll();
if (!KEEP) rmSync(RUN, { recursive: true, force: true });
process.exit(failed.length === 0 ? 0 : 1);