/**
 * cdp-e2e-t100-01.mjs —— 方向 B「夜航仪表」深色档收口探针（老板 10-01 结构层之后的验证欠账）。
 *
 * 补三条欠账（都是此前只在单测/浅色层验过的）：
 *   R1 深色三档三页在位（编辑器 / 多维表格看板 / 日历）+ 截图（夜航是主打档，必须真机像素级取证）
 *   R2 **渲染态**对比度实测：文字色 × 其真实落点背景色（沿祖先链解出有效背景）按 WCAG 算比值，
 *      深色 chrome（color-mix 合成色）也必须 ≥AA —— 这是「淡化面 × 弱字」隐患的收官验证
 *   R3 「移到」下拉的**键盘路径**真机落库（补 D1：键盘可达此前只有单测证据）
 *
 * 纪律：双钉 scratch 夹具（settings.rootPath 指 scratch）；真实档案根 mtime 不变为硬断言。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// playwright 从仓内 playwright-core 解析（pnpm 严格布局下裸 require('playwright') 会 MODULE_NOT_FOUND）
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFrom = createRequire(join(REPO_ROOT, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const DEV = process.env.SEPTCATS_DEV === '1';
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const DEV_ELECTRON = join(REPO, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = join(process.env.USERPROFILE ?? 'C:/Users/Administrator', '.septcats');
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9411);
const RUN_NAME = 't100-01';
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = join(RUN, 'userdata');
const ROOT = join(RUN, 'root');
const SHOTS = join(RUN, 'shots');

let STEP = '';
const assertions = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 170)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() {
  for (const name of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' }); } catch { /* */ } }
}
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

/** 颜色解析：rgb()/rgba()/color(srgb r g b [/ a]) → {r,g,b,a}（0-255 / 0-1）。 */
function parseColor(value) {
  const rgb = /rgba?\(([^)]+)\)/.exec(value);
  if (rgb !== null) {
    const parts = rgb[1].split(/[,\s/]+/).filter((x) => x !== '').map(Number);
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
  }
  const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(value);
  if (srgb !== null) {
    return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
  }
  return null;
}
function luminance({ r, g, b }) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 页内采样：若干选择器 → 文字色 + 沿祖先链解出的有效背景色 → WCAG 比值。 */
const RENDERED_CONTRAST = (sels) => {
  const parse = (value) => {
    const rgb = /rgba?\(([^)]+)\)/.exec(value);
    if (rgb !== null) {
      const p = rgb[1].split(/[,\s/]+/).filter((x) => x !== '').map(Number);
      return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
    }
    const srgb = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(value);
    if (srgb !== null) {
      return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] === undefined ? 1 : Number(srgb[4]) };
    }
    return null;
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (f, b) => { const a = lum(f); const c = lum(b); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); };
  const effBg = (el) => {
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const chain = [];
    let node = el;
    while (node !== null) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c !== null && c.a > 0) chain.push(c);
      node = node.parentElement;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) bg = over(chain[i], bg);
    return bg;
  };
  const out = [];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el === null) { out.push({ sel, missing: true }); continue; }
    const fg = parse(getComputedStyle(el).color);
    const bg = effBg(el);
    out.push({
      sel,
      missing: false,
      text: getComputedStyle(el).color,
      bg: `rgb(${String(Math.round(bg.r))}, ${String(Math.round(bg.g))}, ${String(Math.round(bg.b))})`,
      ratio: fg === null ? 0 : Math.round(ratio(over(fg, bg), bg) * 100) / 100,
      size: getComputedStyle(el).fontSize,
    });
  }
  return out;
};

async function spawnAndConnect() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  return spawnAndConnect();
}

async function launch() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'dark', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const bin = DEV ? DEV_ELECTRON : APP_BIN;
  const args = DEV ? ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`]
    : [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`];
  const child = spawn(bin, args, { cwd: DEV ? APPDIR : dirname(APP_BIN), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2500);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  return { child, browser, page };
}

/** 导航到带正文的笔记页并写一行字（给深色正文面取证）。 */
async function seedEditor(page) {
  await page.locator('[data-testid="side-new-page"]').click();
  await wait(1400);
  const ed = page.locator('.ProseMirror').first();
  if (await ed.count() > 0) {
    await ed.click(); await wait(250);
    await page.keyboard.type('夜航仪表 · 深色档真机取证：正文面必须实心，文字过 AA。');
    await wait(700);
  }
}

let CTX = null;
async function main() {
  const before = rootMtime();
  let { child, browser, page } = await launch();
  CTX = { child, browser };
  try {
    STEP = 'R0|档位';
    await page.evaluate(() => {
      localStorage.setItem('septcats.theme', 'dark');
      localStorage.setItem('septcats.look', 'instrument');
      localStorage.setItem('septcats.palette', 'instrument');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
    await wait(2600);
    const attrs = await page.evaluate(() => ({
      look: document.documentElement.dataset.look ?? '',
      palette: document.documentElement.dataset.palette ?? '',
      theme: document.documentElement.dataset.theme ?? getComputedStyle(document.documentElement).colorScheme,
    }));
    check('R0-a 深色 + 夜航仪表 + 仪表冷灰 三轴齐（真机属性）',
      attrs.look === 'instrument' && attrs.palette === 'instrument' && String(attrs.theme).includes('dark'),
      JSON.stringify(attrs));

    STEP = 'R1|三页在位';
    await seedEditor(page);
    const editor = await page.evaluate(() => ({
      prose: document.querySelectorAll('.ProseMirror').length,
      rail: document.querySelectorAll('.nav-rail__item').length,
      readouts: document.querySelectorAll('[data-testid^="readout-"]').length,
    }));
    await page.screenshot({ path: join(SHOTS, 'dark-editor.png') });
    check('R1-a 编辑器页在位（正文 + 导轨八项 + 读数三格）',
      editor.prose >= 1 && editor.rail >= 8 && editor.readouts === 3, JSON.stringify(editor));

    // 夹具走渲染层真名 API，**分步 + 每步超时**（首版一次 evaluate 里串起全部调用 → 挂死无从定位）
    const step = async (name, fn, arg) => {
      const r = await Promise.race([
        page.evaluate(fn, arg),
        wait(15000).then(() => { throw new Error(`夹具步骤超时: ${name}`); }),
      ]);
      console.log(`  [fixture] ${name} ✓ ${JSON.stringify(r).slice(0, 160)}`);
      return r;
    };
    const wsInfo = await step('workspaces.list', () => (async () => {
      const ws = await window.septcats.workspaces.list();
      return { keys: Object.keys(ws), activeId: ws.activeId ?? null, items: (ws.items ?? []).length, first: (ws.items ?? [])[0]?.id ?? null };
    })());
    const wsId = wsInfo.activeId ?? wsInfo.first;
    const madeInfo = await step('db.create', (id) => (async () => {
      const made = await window.septcats.db.create({ workspaceId: id, title: `夜航看板-${String(Date.now() % 100000)}` });
      return { pageId: made.pageId ?? null, keys: Object.keys(made) };
    })(), wsId);
    const propInfo = await step('propAdd+propUpdate', (pageId) => (async () => {
      const added = await window.septcats.db.propAdd({ pageId, type: 'select' });
      const props = added.collection.schema.properties;
      const pid = Object.keys(props).find((k) => props[k].type === 'select');
      const opts = await window.septcats.db.propUpdate({ pageId, pid, patch: { options: [{ name: '待办' }, { name: '进行中' }] } });
      const ids = opts.collection.schema.properties[pid].options.map((o) => o.id);
      return { pid, ids };
    })(), madeInfo.pageId);
    await step('recordCreate×2', (a) => (async () => {
      await window.septcats.db.recordCreate({ pageId: a.pageId, values: { [a.pid]: a.ids[0] } });
      await window.septcats.db.recordCreate({ pageId: a.pageId, values: { [a.pid]: a.ids[1] } });
      return { ok: true };
    })(), { pageId: madeInfo.pageId, pid: propInfo.pid, ids: propInfo.ids });
    const vid = `vk${String(Date.now() % 10000)}`;
    await step('viewSave(kanban)', (a) => (async () => {
      await window.septcats.db.viewSave({
        pageId: a.pageId,
        view: { vid: a.vid, name: '按状态', type: 'kanban', filter: { op: 'and', clauses: [] }, sort: [], widths: {}, groupPid: a.pid },
      });
      return { ok: true };
    })(), { pageId: madeInfo.pageId, pid: propInfo.pid, vid });
    const built = { pageId: madeInfo.pageId, pid: propInfo.pid, optionIds: propInfo.ids, vid };
    // IPC 造数后渲染层页面树是旧的 ⇒ **reload 渲染页**对账（不用重启进程：
    // 重启会撞单实例锁/端口残留，首版就卡死在这里；持久化已由 T99-01 探针单独证过）
    await page.evaluate(() => {
      localStorage.setItem('septcats.theme', 'dark');
      localStorage.setItem('septcats.look', 'instrument');
      localStorage.setItem('septcats.palette', 'instrument');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
    await wait(2400);
    await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, 'bitable');
    await wait(1500);
    await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, built.pageId);
    await wait(1700);
    await page.evaluate((vid) => { document.querySelector(`[data-testid="bitable-view-chip-${vid}"]`)?.click(); }, built.vid);
    await wait(1500);
    const kanban = await page.evaluate(() => ({
      kanban: document.querySelector('[data-testid="bitable-kanban"]') !== null,
      cols: document.querySelectorAll('[data-testid^="bitable-kanban-col-"]').length,
      cards: document.querySelectorAll('article.bitable-card').length,
      count: document.querySelector('.bitable-kcol-count') !== null,
    }));
    await page.screenshot({ path: join(SHOTS, 'dark-kanban.png') });
    check('R1-b 多维表格看板在位（列 + 卡片 + 列头计数徽标）',
      kanban.kanban && kanban.cols >= 3 && kanban.cards >= 2 && kanban.count, JSON.stringify(kanban));

    await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, 'calendar');
    await wait(1500);
    const cal = await page.evaluate(() => ({
      page: document.querySelector('[data-testid="calendar-page"]') !== null,
      cells: document.querySelectorAll('[data-testid^="calendar-day-"]').length,
    }));
    await page.screenshot({ path: join(SHOTS, 'dark-calendar.png') });
    check('R1-c 日历页在位（42 格月网格）', cal.page && cal.cells >= 42, JSON.stringify(cal));

    STEP = 'R2|渲染态对比度';
    await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, 'notes');
    await wait(1600);
    const measured = await page.evaluate(RENDERED_CONTRAST, [
      '.ProseMirror p',
      '.sc-readouts__val',
      '.sc-readouts__lab',
      '.app-nav-row',
      '.app-nav-count',
      '.nav-rail__item',
    ]);
    const bad = measured.filter((m) => m.missing !== true && m.ratio < 4.5);
    check('R2-a 深色渲染态：正文/chrome 标签/侧栏行与计数/导轨 全 ≥4.5（真机取值 × 真落点背景）',
      bad.length === 0,
      `测得 ${measured.map((m) => `${m.sel}=${String(m.ratio)}`).join('  ')}`);
    writeFileSync(join(SHOTS, 'rendered-contrast.json'), JSON.stringify(measured, null, 2), 'utf8');

    STEP = 'R3|键盘路径（补 D1）';
    // 先回到看板（R2 把页面停在笔记页），再取卡片 id —— 顺序反了会取到空 id（首版就踩了）
    await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, 'bitable');
    await wait(1700);
    await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, built.pageId);
    await wait(1500);
    await page.evaluate((vid) => { document.querySelector(`[data-testid="bitable-view-chip-${vid}"]`)?.click(); }, built.vid);
    await wait(1400);
    const cardId = await page.evaluate(() => (document.querySelector('article.bitable-card')?.getAttribute('data-testid') ?? '').replace('bitable-card-', ''));
    const moveSel = `[data-testid="bitable-move-${cardId}"]`;
    const steps = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return { found: false };
      el.focus();
      return { found: true, focused: document.activeElement === el, value: el.value, tag: el.tagName };
    }, moveSel);
    // 纯键盘：ArrowDown 改选中项（Chromium 原生 select 聚焦后方向键即改值 + 派发 change）
    await page.keyboard.press('ArrowDown');
    await wait(900);
    const after = await page.evaluate(async (info) => {
      const el = document.querySelector(`[data-testid="bitable-move-${info.rid}"]`);
      const read = await window.septcats.db.load({ pageId: info.pageId });
      const rec = read.records.find((r) => r.id === info.rid);
      return {
        value: el === null ? '' : el.value,
        stored: rec === undefined ? null : (rec.values[info.propId] ?? null),
      };
    }, { rid: cardId, pageId: built.pageId, propId: built.pid });
    check('R3-a 「移到」下拉可聚焦且 Tag=SELECT（键盘可达）', steps.found === true && steps.focused === true && steps.tag === 'SELECT', JSON.stringify(steps));
    check('R3-b 纯键盘 ArrowDown 改值 → IPC 读回分组字段已落库（键盘路径真的写库）',
      after.value !== '' && after.stored === after.value,
      `select=${String(after.value)} stored=${String(after.stored)}`);

    STEP = 'R4|隔离钉';
    const afterM = rootMtime();
    check('R4-a 真实档案根 mtime 未变（零触碰）', before === afterM, `${String(before)} vs ${String(afterM)}`);
    writeFileSync(join(SHOTS, `${RUN_NAME}-results.json`), JSON.stringify({ assertions, measured, kanban, cal, editor }, null, 2), 'utf8');
  } finally {
    try { await browser.close(); } catch { /* */ }
    killTree(child.pid);
    killStaleApp();
  }
}

function report(fatal) {
  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok !== true).length;
  if (fatal !== undefined) console.log('FATAL', fatal);
  console.log(`\n===== T100-01 夜航仪表深色收口：${String(pass)} PASS / ${String(fail)} FAIL（靶=${DEV ? 'dev' : 'win-unpacked'}，截图 ${SHOTS}）=====`);
  process.exit(fail === 0 && fatal === undefined ? 0 : (fatal === undefined ? 1 : 3));
}
main().then(() => report()).catch((e) => report(e && e.stack ? e.stack : String(e)));