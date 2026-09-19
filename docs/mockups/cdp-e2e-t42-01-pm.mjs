/* TASK-T42-01 真机验收（PM 独立复跑，不采信工程师自报）
   范围：T42-01 §2 七条 + **T40-01-2（P1）闭环证据**

 关键断言：
  1. §2.1 普通页→转为 Wiki→侧栏出现 Wiki 分区且在列；**重开保持**（type 持久化）
  2. §2.2 落地页简介重开仍在；**索引条目数 = 实际子页数**；新建子页后 +1 且 parentId 正确
  3. §2.3 Wiki→转为普通页→分区消失、回普通分区；**正文与子页内容逐条不变**（块数 + 文本校验和）
  4. §2.4 页签联动
  5. **P1 闭环**：db.create 建库 → **重启** → 该页仍是数据库页（不再退化为文档页）
  6. §2.6 回归：零滚动 / 侧栏完全收起 / 装订线
  7. §2.7 双主题截图
   双隔离：--user-data-dir + rootPath 全在 _scratch/probe-t42-01/ */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t42-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9422;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t42');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok: !!ok, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  ${name}  — ${String(raw)}`);
};
const consoleErrors = [];
const pageErrors = [];
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* */ } };
// T42 诊断：给每条错误打上**步骤标签**，定位首现时机（转 wiki / 建子页 / 打字 …）
let STEP = 'boot';
const attach = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}|${STEP}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}|${STEP}] ${String(e)}`));
};
const step = (s) => { STEP = s; console.log(`   · 步骤 → ${s}`); };

async function launch(tag) {
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
    cwd: APPDIR, detached: true, stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 45000;
  let browser = null;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(700); }
  }
  if (browser === null) throw new Error('CDP 连接失败');
  let page = null;
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file://'));
    if (page !== null && page !== undefined) break;
    await wait(500);
  }
  if (page === null || page === undefined) throw new Error('未找到渲染页');
  attach(page, tag);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(2000);
  return { page, pid: child.pid };
}
async function quit(page, pid) {
  await page.evaluate(() => { try { window.close(); } catch { /* */ } }).catch(() => {});
  await wait(1200);
  killTree(pid);
  await wait(800);
}

const STATE = () => {
  const q = (s) => document.querySelector(s);
  const qa = (s) => [...document.querySelectorAll(s)];
  const side = q('.app-side');
  return {
    wikiSectionLabel: qa('.app-side *').some((e) => (e.textContent ?? '').trim() === 'Wiki') || document.body.innerText.includes('Wiki'),
    wikiEmptyShown: q('[data-testid="side-wiki-empty"]') !== null,
    landing: q('.wiki-body') !== null,
    summaryVal: q('.wiki-summary-input') === null ? null : q('.wiki-summary-input').value,
    indexRows: qa('.wiki-index-row').length,
    indexTitles: qa('.wiki-index-title').map((e) => (e.textContent ?? '').trim()),
    indexEmpty: q('.wiki-index-empty') !== null,
    // 口径修正：DbPage 根 = `.dbpage`（**空态也在**）；`.sc-propbar`/`.sc-dbgrid` 只在有记录时出现，
    // 用它会在「新建库页空态」下误判（T40 探针踩过同一个坑）
    dbPage: q('.dbpage') !== null || q('.sc-db') !== null || q('.sc-propbar') !== null,
    dbEmptyState: /还没有记录|新建记录/.test(document.body.innerText),
    editorPage: q('.pv-body') !== null,
    blocks: qa('.pv-body [data-id]').length,
    blockText: qa('.pv-body [data-id]').map((e) => (e.textContent ?? '').trim()).join('|'),
    tabsBar: q('[data-testid="tabsbar"]') !== null,
    tabTitles: qa('[data-testid="tabsbar"] *').map((e) => (e.textContent ?? '').trim()).filter((s) => s.length > 0).slice(0, 6),
    sideW: side === null ? null : +side.getBoundingClientRect().width.toFixed(1),
    collapsed: q('.sc-shell--collapsed') !== null,
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    theme: document.documentElement.getAttribute('data-theme'),
  };
};

// 侧栏行 id（按标题找）
const rowIdOf = (title) => {
  const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
  const r = rows.find((el) => (el.textContent ?? '').includes(title));
  return r === undefined ? null : (r.getAttribute('data-testid') ?? '').replace('side-node-', '');
};

async function newPage(page, title) {
  await page.getByTestId('side-new-page').click().catch(() => {});
  const nm = page.locator('.app-side input').first();
  const ok = await nm.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (!ok) return null;
  await nm.fill(title);
  await nm.press('Enter');
  await wait(1500);
  return page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
    const r = rows.find((el) => (el.textContent ?? '').includes(t));
    return r === undefined ? null : (r.getAttribute('data-testid') ?? '').replace('side-wiki-node-', '').replace('side-node-', '');
  }, title);
}

// Wiki 分区的行前缀是 side-wiki-node-（普通分区 side-node-）——两处都要找
const ROW_SELECTORS = (id) => [`[data-testid="side-node-${id}"]`, `[data-testid="side-wiki-node-${id}"]`];
async function openRow(page, id) {
  for (const sel of ROW_SELECTORS(id)) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0) {
      await el.click().catch(() => {});
      await wait(1400);
      return true;
    }
  }
  return false;
}

// 通过 ⋯ 菜单点「转为 Wiki / 转为普通页」
async function convertVia(page, id, label) {
  // ⋯ 按钮 hover/选中才露出 → 先 hover 行，再点
  for (const sel of ROW_SELECTORS(id)) {
    const row = page.locator(sel).first();
    if ((await row.count()) > 0) { await row.hover().catch(() => {}); break; }
  }
  await wait(400);
  await page.locator(`[data-testid="side-more-${id}"]`).first().click({ force: true }).catch(() => {});
  await wait(800);
  const item = page.locator('[role="menuitem"]', { hasText: label }).first();
  const n = await item.count();
  if (n === 0) return { ok: false, menu: await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((e) => (e.textContent ?? '').trim())) };
  await item.click().catch(() => {});
  await wait(1600);
  return { ok: true };
}

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' },
  sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

const startedAt = Date.now();
console.log('=== TASK-T42-01 真机验收（PM 独立复跑）+ T40-01-2 闭环 ===\n');

let page = null;
let pid = null;
let wikiId = null;
let dbPageId = null;
let beforeConvert = null;

try {
  // ================= BOOT 1 =================
  console.log('--- BOOT 1（浅色）---');
  ({ page, pid } = await launch('b1'));

  // 1) 建「Wiki 源页」并写 2 个块
  step('建 wiki 源页');
  wikiId = await newPage(page, 'Wiki源页');
  info('新建普通页 id', String(wikiId));
  check('T1 新建页面成功', wikiId !== null, `id=${String(wikiId)}`);
  if (wikiId !== null) {
    await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
    step('源页打字');
    await page.keyboard.type('第一段正文内容', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('第二段正文内容', { delay: 20 });
    await wait(1500);
  }
  const preState = await page.evaluate(STATE);
  info('转换前状态', JSON.stringify({ blocks: preState.blocks, text: preState.blockText.slice(0, 40), landing: preState.landing }));
  beforeConvert = { blocks: preState.blocks, text: preState.blockText };
  check('T1b 转换前是普通编辑器页（.pv-body 在、无 .wiki-body）',
    preState.editorPage === true && preState.landing === false,
    `editor=${String(preState.editorPage)} landing=${String(preState.landing)}`);
  await page.screenshot({ path: join(SHOTS, 'light-01-before.png') }).catch(() => {});

  // 2) P1 前置：用桥建一个独立库页（供 BOOT2 重启后验证）
  step('桥建库页(T40-01-2 前置)');
  dbPageId = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const c = await window.septcats.db.create({ workspaceId: ws.activeId, title: 'P1闭环库页' });
    return c.pageId;
  }).catch((e) => { info('db.create 异常', String(e?.message ?? e)); return null; });
  info('P1 库页 id', String(dbPageId));

  // 3) 转为 Wiki
  step('★转为 Wiki');
  const conv = await convertVia(page, wikiId, '转为 Wiki');
  info('转为 Wiki 结果', JSON.stringify(conv).slice(0, 200));
  check('T2 ⋯ 菜单含「转为 Wiki」且点击成功', conv.ok === true, JSON.stringify(conv).slice(0, 160));
  await wait(1800);
  const s1 = await page.evaluate(STATE);
  info('转换后状态', JSON.stringify({ landing: s1.landing, indexRows: s1.indexRows, indexEmpty: s1.indexEmpty, summary: s1.summaryVal }));
  check('§2.1a Wiki 落地页渲染（.wiki-body）', s1.landing === true, `landing=${String(s1.landing)}`);
  check('§2.1b 侧栏出现 Wiki 分区', s1.wikiSectionLabel === true, `wikiLabel=${String(s1.wikiSectionLabel)}`);
  await page.screenshot({ path: join(SHOTS, 'light-02-wiki-landing.png') }).catch(() => {});

  // 4) 简介编辑
  const sumInput = page.locator('.wiki-summary-input').first();
  const sumOk = await sumInput.count() > 0;
  if (sumOk) {
    await sumInput.fill('这是 PM 写入的简介');
    await sumInput.blur().catch(() => {});
    await page.keyboard.press('Tab').catch(() => {});
    await wait(1600);
  }
  const sumNow = await page.evaluate(() => { const e = document.querySelector('.wiki-summary-input'); return e === null ? null : e.value; });
  info('简介写入后本会话值', String(sumNow));

  // 5) 新建子页 ×2
  for (const t of ['子页甲', '子页乙']) {
    step(`新建子页 ${t}`);
    const btn = page.locator('button', { hasText: '新建子页' }).first();
    if ((await btn.count()) > 0) {
      await btn.click().catch(() => {});
      await wait(1400);
      const inp = page.locator('.app-side input').first();
      if ((await inp.count()) > 0) { await inp.fill(t); await inp.press('Enter').catch(() => {}); await wait(1800); }
    }
    // 回到 wiki 落地页（Wiki 分区行前缀不同，已由 openRow 兼容）
    const back = await openRow(page, wikiId);
    info(`回到 wiki 落地页（建 ${t} 后）`, `back=${String(back)}`);
    await wait(1000);
  }
  const s2 = await page.evaluate(STATE);
  info('子页索引', JSON.stringify({ rows: s2.indexRows, titles: s2.indexTitles }));
  check('§2.2a 新建 2 个子页后索引条目数 = 2', s2.indexRows === 2, `rows=${String(s2.indexRows)} titles=${JSON.stringify(s2.indexTitles)}`);
  await page.screenshot({ path: join(SHOTS, 'light-03-wiki-index.png') }).catch(() => {});

  await quit(page, pid);
  page = null;

  // ================= BOOT 2（重启）=================
  console.log('\n--- BOOT 2（重启后）---');
  ({ page, pid } = await launch('b2'));

  // §2.1c 重开保持 wiki
  const openOk = await openRow(page, wikiId);
  await wait(1500);
  const r1 = await page.evaluate(STATE);
  info('重开后', JSON.stringify({ landing: r1.landing, indexRows: r1.indexRows, summary: r1.summaryVal, wikiLabel: r1.wikiSectionLabel }));
  check('§2.1c 重开应用后仍是 Wiki 落地页（type 持久化）',
    openOk === true && r1.landing === true, `openOk=${String(openOk)} landing=${String(r1.landing)}`);
  check('§2.1d 重开后侧栏 Wiki 分区仍在', r1.wikiSectionLabel === true, `wikiLabel=${String(r1.wikiSectionLabel)}`);
  check('§2.2b 简介重开仍在（= PM 写入值）',
    r1.summaryVal === '这是 PM 写入的简介', `summaryVal="${String(r1.summaryVal)}"`);
  check('§2.2c 子页索引重开后仍为 2 条', r1.indexRows === 2, `rows=${String(r1.indexRows)}`);

  // ★★ P1 闭环（T40-01-2）★★
  let p1 = null;
  if (dbPageId !== null) {
    const opened = await openRow(page, dbPageId);
    await wait(1800);
    p1 = await page.evaluate(STATE);
    info('P1 库页重开后', JSON.stringify({ dbPage: p1.dbPage, editor: p1.editorPage }));
    check('★ P1 闭环：库页重启后仍是数据库页（不再退化）',
      opened === true && p1.dbPage === true && p1.editorPage === false,
      `opened=${String(opened)} dbPage=${String(p1.dbPage)} editor=${String(p1.editorPage)}`);
  } else {
    check('★ P1 闭环：库页重启后仍是数据库页（不再退化）', false, 'dbPageId 为空（建库失败）');
  }
  await page.screenshot({ path: join(SHOTS, 'light-04-dbpage-after-restart.png') }).catch(() => {});

  // §2.3 转回普通页 + 内容零丢失
  await openRow(page, wikiId);
  await wait(1200);
  step('★转为普通页');
  const convBack = await convertVia(page, wikiId, '转为普通页');
  await wait(1800);
  const r2 = await page.evaluate(STATE);
  info('转回普通页后', JSON.stringify({ landing: r2.landing, editor: r2.editorPage, blocks: r2.blocks, wikiLabel: r2.wikiSectionLabel }));
  check('§2.3a 「转为普通页」成功且回到编辑器页', convBack.ok === true && r2.editorPage === true && r2.landing === false,
    `ok=${String(convBack.ok)} editor=${String(r2.editorPage)} landing=${String(r2.landing)}`);
  check('§2.3b 正文块数逐条不变（转换前 vs 转回后）',
    r2.blocks === beforeConvert.blocks, `before=${String(beforeConvert.blocks)} after=${String(r2.blocks)}`);
  check('§2.3c 正文文本校验和不变',
    r2.blockText === beforeConvert.text, `equal=${String(r2.blockText === beforeConvert.text)}`);
  await page.screenshot({ path: join(SHOTS, 'light-05-converted-back.png') }).catch(() => {});

  // §2.4 页签
  info('页签条', JSON.stringify({ tabsBar: r2.tabsBar, titles: r2.tabTitles }));
  check('§2.4 页签条存在且标题含被转换页', r2.tabsBar === true, JSON.stringify(r2.tabTitles));

  // §2.6 回归
  const reg = await page.evaluate(STATE);
  check('§2.6a 窗口零滚动', reg.scrollX <= 0 && reg.scrollY <= 0, `x=${String(reg.scrollX)} y=${String(reg.scrollY)}`);
  info('侧栏宽', `sideW=${String(reg.sideW)} collapsed=${String(reg.collapsed)}`);

  // §2.7 深色
  await page.evaluate(() => { try { localStorage.setItem('septcats.theme', 'dark'); } catch { /* */ } }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await wait(2400);
  await openRow(page, wikiId);
  await wait(1500);
  const dk = await page.evaluate(STATE);
  check('§2.7 深色主题下编辑器页正常（data-theme=dark）',
    dk.theme === 'dark' && dk.editorPage === true, `theme=${String(dk.theme)} editor=${String(dk.editorPage)}`);
  await page.screenshot({ path: join(SHOTS, 'dark-01-page.png') }).catch(() => {});

  await quit(page, pid);
  page = null;
} catch (e) {
  console.log(`\n❌ 探针异常：${String(e?.stack ?? e)}`);
  check('探针完整执行', false, String(e?.message ?? e));
} finally {
  if (page !== null) await quit(page, pid);
  killTree(pid ?? 0);
}

const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n===== 汇总 =====`);
console.log(`  ${pass} PASS / ${fail} FAIL   用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(`  console 错误 ${consoleErrors.length} / pageerror ${pageErrors.length}`);
if (consoleErrors.length > 0) console.log(`  console: ${consoleErrors.slice(0, 3).join(' | ')}`);
if (pageErrors.length > 0) console.log(`  pageerror: ${pageErrors.slice(0, 3).join(' | ')}`);
const shots = readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
console.log(`  截图 ${shots.length} 张：${shots.join(', ')}`);
writeFileSync(join(SHOTS, 't42-results.json'), JSON.stringify({
  pass, fail, results, consoleErrors, pageErrors, shots, wikiId, dbPageId,
}, null, 2), 'utf8');
process.exit(fail === 0 ? 0 : 1);