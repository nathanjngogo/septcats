/* TASK-T41-01 真机验收探针 —— R4 编辑区全宽开关（Notion 式 Full width）

 覆盖任务书 §2 验收（数值化）：
  1. 切全宽：正文列 clientWidth = 容器宽；固定态 = measure 值；差值 > 0（贴数值）
  2. 只影响正文列：标题行 / 页签条 / 侧栏 / AI 面板宽度切换前后不变（贴数值）
  3. 装订线不回归：全宽下手柄×文本 overlap=false、gutter ≥ 8
  4. 每页独立 + 持久化：A 页全宽、B 页固定 → 重启后各自保持（贴断言）
  5. 回归：窗口零滚动 / 页签条在 / AI 面板开合不受影响
  6. 双主题 ×（固定/全宽）截图（screens-t41/）

 隔离口径：--user-data-dir + rootPath 双隔离（T39-01 探针同款）；不触碰真实数据根。
 直接以 electron . 跑 freshly-built out/。本文件为 T41 新增探针，不改既有探针。
*/
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t41-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9412;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t41');

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

const killTree = (pid) => {
  try {
    execSync(`taskkill /F /T /PID ${String(pid)}`, { stdio: 'ignore' });
  } catch {
    /* 已退出 */
  }
};
const alive = (pid) => {
  try {
    const out = execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8', stdio: 'pipe' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
};

const consoleErrors = [];
const pageErrors = [];
let browser;
const launched = [];

const attach = (page) => {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
};

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    cwd: APPDIR,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  launched.push(child.pid);
  for (let i = 0; i < 40; i += 1) {
    await wait(500);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
      break;
    } catch {
      /* 还没起来 */
    }
  }
  if (browser === undefined || browser === null) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  const pgs = ctx.pages();
  const page = pgs.length > 0 ? pgs[0] : await ctx.waitForEvent('page');
  attach(page);
  await page.waitForLoadState('domcontentloaded');
  for (let i = 0; i < 40; i += 1) {
    const ok = await page.evaluate(() => typeof window.septcats?.pages?.tree === 'function').catch(() => false);
    if (ok) break;
    await wait(400);
  }
  await wait(1500);
  return { page, pid: child.pid };
}

async function quit(page, pid) {
  await page.evaluate(() => window.close()).catch(() => {});
  await wait(1200);
  for (let i = 0; i < 12 && alive(pid); i += 1) await wait(500);
  killTree(pid);
  try {
    browser?.close();
  } catch {
    /* ignore */
  }
  browser = undefined;
}

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await wait(stepMs);
  }
  return last;
}

// 全景量测（真机实值）
const MEASURE = () => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : +el.getBoundingClientRect().width.toFixed(1);
  };
  const body = document.querySelector('.pv-body');
  const root = document.querySelector('.pv-root');
  const title = document.querySelector('.pv-title-row');
  return {
    // §2.1 正文列 vs 容器
    bodyCW: body === null ? null : body.clientWidth,
    bodyMaxW: body === null ? null : getComputedStyle(body).maxWidth,
    pvRootCW: root === null ? null : root.clientWidth,
    pvRootInnerW: root === null ? null : root.clientWidth - (parseFloat(getComputedStyle(root).paddingLeft) || 0) - (parseFloat(getComputedStyle(root).paddingRight) || 0),
    measureVar: getComputedStyle(document.documentElement).getPropertyValue('--sc-layout-measure').trim(),
    // §2.2 只影响正文列
    titleW: title === null ? null : +title.getBoundingClientRect().width.toFixed(1),
    tabsW: rect('[data-testid="tabsbar"]'),
    sideW: rect('.app-side'),
    aiW: rect('.ai-chat'),
    aiOpen: document.querySelector('.ai-chat') !== null,
    // 状态面
    dataMeasure: root === null ? null : root.getAttribute('data-measure'),
    pageAttrFull: root?.getAttribute('data-measure') === 'full',
    theme: document.documentElement.getAttribute('data-theme'),
    tabsCount: document.querySelectorAll('[data-testid^="tab-"]').length,
    tabIds: [...document.querySelectorAll('[data-testid^="tab-"]')].map((el) => el.getAttribute('data-testid')),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    pagewidthStore: Object.keys(localStorage)
      .filter((k) => k.startsWith('septcats.pagewidth.'))
      .map((k) => `${k}=${localStorage.getItem(k)}`),
  };
};

// 新建页面并重命名（T39 探针同款路径），返回该页侧栏行 testid 里的 node id
async function createPage(page, title) {
  await page.locator('[data-testid="side-new-page"]').first().click();
  const nm = page.locator('.app-side input').first();
  await nm.waitFor({ state: 'visible', timeout: 10000 });
  await nm.fill(title);
  await nm.press('Enter');
  await waitFor(async () => page.evaluate(() => document.querySelector('.pv-body') !== null), 15000);
  await wait(1200);
  const id = await page.evaluate(
    () => document.querySelector('.app-nav-row--active')?.getAttribute('data-testid')?.replace('side-node-', '') ?? null,
  );
  return id;
}

// 用侧栏 ⋯ 菜单切换某页全宽（走真实 UI 路径）
async function toggleFullWidthViaMenu(page, pageId) {
  await page.locator(`[data-testid="side-more-${pageId}"]`).first().click();
  const item = page.getByRole('menuitem', { name: /固定宽度|全宽/ }).first();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  const labelText = await item.innerText();
  await item.click();
  await wait(900);
  return labelText.trim();
}

async function openPage(page, pageId) {
  await page.locator(`[data-testid="side-node-${pageId}"]`).first().click();
  await wait(1200);
}

// 装订线量测（T36/T39 同口径：文本左缘 − 簇右缘）
async function measureGutter(page) {
  const blk = page.locator('.pv-body [data-id]').first();
  await blk.hover({ force: true }).catch(() => {});
  await wait(1200);
  return page.evaluate(() => {
    const cluster = document.querySelector('.pv-handle');
    const b = document.querySelector('.pv-body [data-id]');
    if (cluster === null || b === null) return null;
    const cr = cluster.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const st = getComputedStyle(b);
    const textLeft = br.left + parseFloat(st.paddingLeft || '0') + parseFloat(st.borderLeftWidth || '0');
    return { gutter: +(textLeft - cr.right).toFixed(1), overlap: textLeft < cr.right };
  });
}

const main = async () => {
  try {
    execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' });
  } catch {
    /* none */
  }
  await wait(1500);
  for (const d of [RUN, SHOTS]) rmSync(d, { recursive: true, force: true });
  for (const d of [UD, ROOT, SHOTS]) mkdirSync(d, { recursive: true });
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
        sync: { enabled: true, encrypt: false, gc: false },
      },
      null,
      2,
    ),
    'utf8',
  );

  // ================= BOOT 1（浅色：切换生效 / 仅正文列 / 装订线）=================
  console.log('\n===== BOOT 1：浅色 =====');
  let { page, pid } = await launch();
  info('启动', `pid=${String(pid)}`);

  const pageA = await createPage(page, 'A页');
  const pageB = await createPage(page, 'B页');
  info('页面 id', `A=${String(pageA)} B=${String(pageB)}`);
  check('P1 两页创建成功（侧栏行 id 可解析）', pageA !== null && pageB !== null && pageA !== pageB, `A=${String(pageA)} B=${String(pageB)}`);

  // 输入一行正文（块手柄/装订线量测前置）
  const pm = page.locator('.pv-body .ProseMirror').first();
  await pm.click({ position: { x: 40, y: 20 } }).catch(() => {});
  await page.keyboard.type('全宽校验正文一行', { delay: 30 });
  await wait(1200);

  // 打开 AI 面板（量 aiW 用；Ctrl+J 既有入口）
  await page.keyboard.press('Control+j');
  await waitFor(async () => page.evaluate(() => document.querySelector('.ai-chat') !== null), 10000);
  await wait(800);

  // ---- 固定态（B 页选中）----
  const fixedB = await page.evaluate(MEASURE);
  info('固定态（B 页，AI 开）', JSON.stringify(fixedB));
  check(
    'A1a 固定态：.pv-root 无 data-measure，正文列 max-width = measure 变量',
    fixedB.dataMeasure === null && fixedB.bodyMaxW === fixedB.measureVar,
    `data-measure=${String(fixedB.dataMeasure)} max-width=${fixedB.bodyMaxW} var=${fixedB.measureVar}`,
  );
  await page.screenshot({ path: join(SHOTS, 'light-fixed-B.png') }).catch(() => {});

  // ---- 切 A 页全宽（侧栏 ⋯ 菜单真实路径）----
  await openPage(page, pageA);
  const menuLabel = await toggleFullWidthViaMenu(page, pageA);
  info('菜单项点击前文案', menuLabel);
  const fullA = await page.evaluate(MEASURE);
  info('全宽态（A 页，AI 开）', JSON.stringify(fullA));
  check(
    'A1b 全宽态：data-measure=full，正文列 clientWidth = 容器内容宽',
    fullA.pageAttrFull === true && fullA.bodyCW !== null && Math.abs(fullA.bodyCW - fullA.pvRootInnerW) <= 1,
    `bodyCW=${String(fullA.bodyCW)} 容器内容宽=${String(fullA.pvRootInnerW)}（pv-root clientWidth=${String(fullA.pvRootCW)}）`,
  );

  // ---- §2.2 只影响正文列 + §2.1 差值（关 AI 面板后量：给容器足够宽度让 measure 生效钳制）----
  await page.keyboard.press('Control+j');
  await waitFor(async () => page.evaluate(() => document.querySelector('.ai-chat') === null), 10000);
  await wait(800);
  await toggleFullWidthViaMenu(page, pageA); // 全宽 → 固定
  const fixedA = await page.evaluate(MEASURE);
  info('固定态（A 页，AI 关）', JSON.stringify(fixedA));
  await toggleFullWidthViaMenu(page, pageA); // 固定 → 全宽
  const fullA2 = await page.evaluate(MEASURE);
  info('全宽态（A 页，AI 关）', JSON.stringify(fullA2));
  check(
    'A1c 固定 vs 全宽：正文列 clientWidth 差值 > 0（贴数值）',
    fixedA.bodyCW !== null && fullA2.bodyCW !== null && fullA2.bodyCW - fixedA.bodyCW > 0 && Math.abs(fixedA.bodyCW - 650) <= 2,
    `固定=${String(fixedA.bodyCW)}px（=measure 650）全宽=${String(fullA2.bodyCW)}px（=容器）差值=${String((fullA2.bodyCW ?? 0) - (fixedA.bodyCW ?? 0))}px`,
  );
  check(
    'A2a 标题行宽度不变（固定 vs 全宽，同页 A；且 ≤ 正文列全宽）',
    fixedA.titleW !== null && Math.abs(fixedA.titleW - fullA2.titleW) <= 1 && fullA2.titleW <= fullA2.bodyCW + 1,
    `标题行：固定=${String(fixedA.titleW)} 全宽=${String(fullA2.titleW)}｜正文列全宽=${String(fullA2.bodyCW)}`,
  );
  check(
    'A2b 页签条宽度不变',
    fixedA.tabsW !== null && Math.abs(fixedA.tabsW - fullA2.tabsW) <= 1,
    `页签条：固定=${String(fixedA.tabsW)} 全宽=${String(fullA2.tabsW)}`,
  );
  check(
    'A2c 侧栏宽度不变',
    fixedA.sideW !== null && Math.abs(fixedA.sideW - fullA2.sideW) <= 1,
    `侧栏：固定=${String(fixedA.sideW)} 全宽=${String(fullA2.sideW)}`,
  );

  // 重开 AI 面板（恢复开态，供后续 A8 / 截图面）
  await page.keyboard.press('Control+j');
  await waitFor(async () => page.evaluate(() => document.querySelector('.ai-chat') !== null), 10000);
  await wait(800);

  // A2d AI 面板宽度不变（开启态对比：同页 A 固定 vs 全宽）
  const fullA3 = await page.evaluate(MEASURE);
  await toggleFullWidthViaMenu(page, pageA); // 全宽 → 固定
  const fixedA3 = await page.evaluate(MEASURE);
  await toggleFullWidthViaMenu(page, pageA); // 固定 → 全宽（收尾态）
  check(
    'A2d AI 面板宽度不变（开启态对比）',
    fullA3.aiOpen === true && fixedA3.aiOpen === true && Math.abs(fullA3.aiW - fixedA3.aiW) <= 1,
    `AI 面板：固定=${String(fixedA3.aiW)} 全宽=${String(fullA3.aiW)} open=${String(fixedA3.aiOpen)}`,
  );

  // ---- §2.4 每页独立（B 仍固定）----
  await openPage(page, pageB);
  const fixedB2 = await page.evaluate(MEASURE);
  check(
    'A3 每页独立：A 全宽后 B 页仍固定（无 data-measure、正文列=measure）',
    fixedB2.dataMeasure === null && fixedB2.bodyMaxW === fixedB2.measureVar,
    `B data-measure=${String(fixedB2.dataMeasure)} max-width=${fixedB2.bodyMaxW}`,
  );

  // ---- §2.3 装订线（A 页全宽下）----
  await openPage(page, pageA);
  await wait(600);
  const gutter = await measureGutter(page);
  info('全宽装订线量测', JSON.stringify(gutter));
  check(
    'A4 装订线不回归：overlap=false 且 gutter ≥ 8',
    gutter !== null && gutter.overlap === false && gutter.gutter >= 8,
    JSON.stringify(gutter),
  );

  // ---- §2.4 持久化写入 + 回归面 ----
  const store = await page.evaluate(MEASURE);
  info('localStorage septcats.pagewidth.*', JSON.stringify(store.pagewidthStore));
  check(
    'A5 全宽记录已按 workspace 写 localStorage（septcats.pagewidth.<ws> 含 A 不含 B）',
    store.pagewidthStore.some((entry) => entry.includes(`"${String(pageA)}"`)) &&
      !store.pagewidthStore.some((entry) => entry.includes(`"${String(pageB)}"`)),
    JSON.stringify(store.pagewidthStore),
  );
  check('A6 回归：窗口零滚动（横向+纵向）', store.scrollX <= 0 && store.scrollY <= 0, `x=${String(store.scrollX)} y=${String(store.scrollY)}`);
  check(
    'A7 回归：页签条在（T37），A/B 两页各占一签',
    store.tabIds.some((t) => t === `tab-${String(pageA)}`) && store.tabIds.some((t) => t === `tab-${String(pageB)}`),
    `tabs=${JSON.stringify(store.tabIds)}`,
  );
  check('A8 回归：AI 面板仍开启（T38 开合不受影响）', store.aiOpen === true, `aiOpen=${String(store.aiOpen)}`);
  await page.screenshot({ path: join(SHOTS, 'light-full-A.png') }).catch(() => {});

  // 收尾态：A 全宽（含 AI 面板开着无妨——面板开合态由 T38 通道独立管理，不进 pagewidth 键）
  await quit(page, pid);

  // ================= BOOT 2（重开还原 + 深色）=================
  console.log('\n===== BOOT 2：重开还原 =====');
  ({ page, pid } = await launch());
  await wait(2000);
  // 重开后选中项还原为最后选中的 A 页（tabs 持久化通道）
  const afterA = await page.evaluate(MEASURE);
  info('重开后（A 页应选中且全宽）', JSON.stringify(afterA));
  check(
    'B1 重开还原：A 页 data-measure=full，正文列 clientWidth = 容器内容宽',
    afterA.pageAttrFull === true && Math.abs(afterA.bodyCW - afterA.pvRootInnerW) <= 1,
    `data-measure=${String(afterA.dataMeasure)} bodyCW=${String(afterA.bodyCW)} 容器=${String(afterA.pvRootInnerW)}`,
  );
  await openPage(page, pageB);
  const afterB = await page.evaluate(MEASURE);
  check(
    'B2 重开还原：B 页仍固定（无 data-measure，正文列 = measure）',
    afterB.dataMeasure === null && afterB.bodyMaxW === afterB.measureVar,
    `B data-measure=${String(afterB.dataMeasure)} max-width=${afterB.bodyMaxW}`,
  );

  // ---- 深色主题 ×（固定/全宽）截图 ----
  await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
  await wait(2200);
  await page.screenshot({ path: join(SHOTS, 'dark-fixed-B.png') }).catch(() => {});
  await openPage(page, pageA);
  await wait(800);
  const dark = await page.evaluate(MEASURE);
  check(
    'B3 深色 + 全宽：主题生效且全宽保持',
    dark.pageAttrFull === true && dark.theme === 'dark',
    `theme=${String(dark.theme)} data-measure=${String(dark.dataMeasure)}`,
  );
  await page.screenshot({ path: join(SHOTS, 'dark-full-A.png') }).catch(() => {});
  check('B4 重开后窗口零滚动', dark.scrollX <= 0 && dark.scrollY <= 0, `x=${String(dark.scrollX)} y=${String(dark.scrollY)}`);

  await quit(page, pid);

  // ================= 汇总 =================
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\n===== 汇总：${String(passed)} PASS / ${String(failed)} FAIL =====`);
  for (const r of results) {
    if (r.ok === false) console.log(`  ✗ ${r.name} — ${r.raw}`);
  }
  console.log(`console 错误 ${String(consoleErrors.length)} 条 / pageerror ${String(pageErrors.length)} 条`);
  if (pageErrors.length > 0) console.log(`  pageerror: ${pageErrors.slice(0, 3).join(' | ')}`);

  writeFileSync(
    join(SHOTS, 't41-results.json'),
    JSON.stringify({ pass: passed, fail: failed, results, consoleErrors, pageErrors }, null, 2),
    'utf8',
  );
  process.exit(failed > 0 ? 1 : 0);
};

main().catch(async (e) => {
  console.error('探针异常终止:', String(e?.stack ?? e));
  writeFileSync(
    join(SHOTS, 't41-results.json'),
    JSON.stringify({ pass: results.filter((r) => r.ok === true).length, fail: 1, results, fatal: String(e?.stack ?? e) }, null, 2),
    'utf8',
  );
  process.exit(1);
});
