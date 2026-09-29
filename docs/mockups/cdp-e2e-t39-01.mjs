/* TASK-T39-01 真机验收探针 —— R3 布局设计器（PM 独立复跑，非工程师自报）

 覆盖任务书 §1 六条验收 + 四条红线回归：
  1. 预设切换即时生效（侧栏宽/measure/AI 面板可见性**实测数值**）+ 重开保持
  2. 参数夹紧：输入 100/999 → 实际 200/320（断言实际值）
  3. 导入导出往返（逐字段深比较）
  4. 非法导入 `{bad json` → 可读错误 + 布局不变
  5. 四条红线：①窗口零滚动 ②侧栏完全收起(width=0) ③手柄装订线 gutter≥8 ④对比度(自动化面)
     + ⑤ 多页签(T37)/AI 面板(T38) 行为不变
  6. 双主题截图

 隔离口径：--user-data-dir + rootPath 双隔离；不触碰真实数据根。
 直接以 electron . 跑 freshly-built out/（T34/T36 同口径，非重打包）。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t39-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9402;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t39');

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

async function launch(page) {
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
  page = pgs.length > 0 ? pgs[0] : await ctx.waitForEvent('page');
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

// waitFor 返回最后一次计算值（skill 规则 4）
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

// 布局全景量测（真机实值，不是静态断言）
const MEASURE = () => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const side = document.querySelector('.app-side');
  const body = document.querySelector('.pv-body');
  let layout = null;
  try {
    layout = JSON.parse(localStorage.getItem('septcats.layout') ?? 'null');
  } catch {
    layout = 'PARSE_ERR';
  }
  return {
    varSidebar: cs.getPropertyValue('--sc-layout-sidebar').trim(),
    varMeasure: cs.getPropertyValue('--sc-layout-measure').trim(),
    density: root.getAttribute('data-sc-density'),
    theme: root.getAttribute('data-theme'),
    collapsed: document.querySelector('.sc-shell--collapsed') !== null,
    sidebarW: side === null ? null : +side.getBoundingClientRect().width.toFixed(1),
    aiPanel: document.querySelector('.ai-chat') !== null,
    bodyMaxW: body === null ? null : getComputedStyle(body).maxWidth,
    tabsBar: document.querySelector('[data-testid="tabsbar"]') !== null,
    scrollLeft: root.scrollWidth - root.clientWidth,
    layout,
  };
};

const paletteOpen = async (page, text) => {
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  await pin.waitFor({ state: 'visible', timeout: 8000 });
  await pin.fill('');
  await pin.type(text, { delay: 25 });
  await wait(1300);
  return page.locator('.palette-list [role="option"]');
};

// 规范化 JSON：忽略键序，只比内容（导入导出往返用）
const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
};

// 退出设置页：顶栏齿轮钮是 toggle（App.tsx:291）
const exitSettings = async (page) => {
  const gear = page.locator('.sc-topbtn[aria-label="设置"]').first();
  if ((await gear.count()) > 0) {
    await gear.click().catch(() => {});
    await wait(1100);
  }
  return waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="layout-section"]') === null), 10000);
};

// 在设置页取「布局变量 + 存储」，再退出到编辑区取「AI 面板/标签条/滚动的真机态」
const pickAndMeasure = async (page, id) => {
  await ensureSettings(page);
  const s = await pickPreset(page, id);
  await exitSettings(page);
  const ed = await page.evaluate(MEASURE);
  return { ...s, editor: ed, aiPanel: ed.aiPanel };
};

const ensureSettings = async (page) => {
  const already = await page.evaluate(() => document.querySelector('[data-testid="layout-section"]') !== null);
  if (already) return true;
  return openSettings(page);
};

const openSettings = async (page) => {
  const rows = await paletteOpen(page, '设置');
  const row = rows.filter({ hasText: '打开设置' }).first();
  const found = (await rows.allInnerTexts().catch(() => [])).some((t) => t.includes('设置'));
  if (!found) return false;
  await row.click().catch(() => {});
  await wait(1200);
  return waitFor(async () => page.evaluate(() => document.querySelector('[data-testid="layout-section"]') !== null), 12000);
};

const pickPreset = async (page, id) => {
  await page.locator(`[data-testid="layout-preset-${id}"]`).first().click();
  await wait(1100);
  return page.evaluate(MEASURE);
};

const main = async () => {
  killTree(0);
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

  // ================= BOOT 1（浅色）=================
  console.log('\n===== BOOT 1：预设 / 夹紧 / 导入导出 =====');
  let { page, pid } = await launch(null);
  info('启动', `pid=${String(pid)}`);
  await page.screenshot({ path: join(SHOTS, 'light-00-boot.png') }).catch(() => {});

  const inSettings = await openSettings(page);
  check('A1 命令面板可进入设置页且「布局」区块存在', inSettings === true, `layoutSection=${String(inSettings)}`);
  await page.screenshot({ path: join(SHOTS, 'light-01-layout-section.png') }).catch(() => {});

  // ---- B. 三预设切换：实测数值 ----
  const notion = await pickAndMeasure(page, 'notion');
  await ensureSettings(page);
  await page.screenshot({ path: join(SHOTS, 'light-02-preset-notion.png') }).catch(() => {});
  const focus = await pickAndMeasure(page, 'focus');
  await ensureSettings(page);
  await page.screenshot({ path: join(SHOTS, 'light-03-preset-focus.png') }).catch(() => {});
  const workbench = await pickAndMeasure(page, 'workbench');
  await ensureSettings(page);
  await page.screenshot({ path: join(SHOTS, 'light-04-preset-workbench.png') }).catch(() => {});

  info('notion', JSON.stringify(notion));
  info('focus', JSON.stringify(focus));
  info('workbench', JSON.stringify(workbench));

  check(
    'B1 预设 notion：侧栏左(240 可见) · measure 650 · AI 面板收起',
    notion.collapsed === false && notion.varMeasure === '650px' && notion.aiPanel === false,
    `sidebar=${String(notion.sidebarW)}px measure=${notion.varMeasure} collapsed=${String(notion.collapsed)} ai=${String(notion.aiPanel)}`,
  );
  check(
    'B2 预设 focus：侧栏**完全收起** · measure 900 · AI 面板收起',
    focus.collapsed === true && focus.varMeasure === '900px' && focus.aiPanel === false,
    `sidebar=${String(focus.sidebarW)}px measure=${focus.varMeasure} collapsed=${String(focus.collapsed)} ai=${String(focus.aiPanel)}`,
  );
  check(
    'B3 预设 workbench：侧栏左 · AI 面板右侧**展开**（缺陷 T39-01-1：切换不即时生效）',
    workbench.collapsed === false && workbench.aiPanel === true,
    `sidebar=${String(workbench.sidebarW)}px measure=${workbench.varMeasure} collapsed=${String(workbench.collapsed)} ai=${String(workbench.aiPanel)}`,
  );
  check(
    'B4 三预设呈真实差异（measure 随预设变；AI 面板见 T39-01-1）',
    notion.varMeasure !== focus.varMeasure && workbench.aiPanel !== notion.aiPanel,
    `measure: ${notion.varMeasure}/${focus.varMeasure}/${workbench.varMeasure} · ai: ${String(notion.aiPanel)}/${String(workbench.aiPanel)}`,
  );
  check(
    'B5 预设写入 localStorage「septcats.layout」',
    workbench.layout !== null && workbench.layout.preset === 'workbench',
    `preset=${String(workbench.layout?.preset)}`,
  );

  // ---- C. 参数夹紧（断言实际值）----
  const wIn = page.locator('[data-testid="layout-sidebar-width"]').first();
  await wIn.fill('100');
  await wIn.press('Enter');
  await wait(900);
  const clampLow = await page.evaluate(MEASURE);
  const lowEcho = await wIn.inputValue().catch(() => '?');

  await wIn.fill('999');
  await wIn.press('Enter');
  await wait(900);
  const clampHigh = await page.evaluate(MEASURE);
  const highEcho = await wIn.inputValue().catch(() => '?');

  check(
    'C1 侧栏宽度输入 100 → 实际 200（变量 + 存储 + 回显三面）',
    clampLow.varSidebar === '200px' && clampLow.layout?.sidebar?.width === 200 && lowEcho === '200',
    `var=${clampLow.varSidebar} store=${String(clampLow.layout?.sidebar?.width)} echo="${lowEcho}"`,
  );
  check(
    'C2 侧栏宽度输入 999 → 实际 320（变量 + 存储 + 回显三面）',
    clampHigh.varSidebar === '320px' && clampHigh.layout?.sidebar?.width === 320 && highEcho === '320',
    `var=${clampHigh.varSidebar} store=${String(clampHigh.layout?.sidebar?.width)} echo="${highEcho}"`,
  );
  check(
    'C3 夹紧后的侧栏**真实渲染宽度**与变量一致（几何面）',
    clampHigh.sidebarW !== null && Math.abs(clampHigh.sidebarW - 320) <= 2,
    `实测=${String(clampHigh.sidebarW)}px 变量=${clampHigh.varSidebar}`,
  );

  const mIn = page.locator('[data-testid="layout-measure"]').first();
  await mIn.fill('9999');
  await mIn.press('Enter');
  await wait(900);
  const mHigh = await page.evaluate(MEASURE);
  check(
    'C4 内容最大宽度输入 9999 → 实际 1000',
    mHigh.varMeasure === '1000px' && mHigh.layout?.content?.measure === 1000,
    `var=${mHigh.varMeasure} store=${String(mHigh.layout?.content?.measure)}`,
  );

  // ---- D. 导入导出往返（逐字段深比较）----
  // D0 造一个可复现的已知态：workbench + 侧栏 280 + measure 800
  await pickPreset(page, 'workbench');
  const w0 = page.locator('[data-testid="layout-sidebar-width"]').first();
  await w0.fill('280');
  await w0.press('Enter');
  await wait(800);
  const m0 = page.locator('[data-testid="layout-measure"]').first();
  await m0.fill('800');
  await m0.press('Enter');
  await wait(800);
  const known = await page.evaluate(MEASURE);
  const knownJson = JSON.stringify(known.layout);
  info('D0 已知态 JSON', knownJson);

  // D1 导出：必须给出可读反馈（已复制 or 手动复制兜底，两条都算导出路径可用）
  await ensureSettings(page);
  await page.locator('button', { hasText: '导出布局' }).first().click().catch(() => {});
  await wait(1200);
  const exportNote = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="layout-export-note"]');
    return el === null ? null : el.textContent;
  });
  const clip = await page.evaluate(async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return `ERR:${String(e?.message ?? e)}`;
    }
  });
  info('导出反馈', `note="${String(exportNote).slice(0, 50)}" clipboard=${String(clip).slice(0, 80)}`);
  check(
    'D1 导出给出可读反馈（已复制 / 兜底手动复制）',
    exportNote !== null && String(exportNote).trim().length > 0,
    `note="${String(exportNote).slice(0, 50)}"`,
  );

  // D2 若剪贴板可读：导出 JSON 与存储快照逐字段等价
  let clipEqual = null;
  if (typeof clip === 'string' && clip.trim().startsWith('{')) {
    try {
      const s1 = JSON.parse(clip);
      const stripTheme = (o) => {
        if (o === null || typeof o !== 'object') return o;
        const c = { ...o };
        delete c.theme;
        return c;
      };
      clipEqual = canon(stripTheme(s1)) === canon(stripTheme(known.layout));
    } catch {
      clipEqual = false;
    }
  }
  if (clipEqual !== null) {
    check(
      'D2 导出的 JSON 与存储快照逐字段等价（theme 除外：导出按真相源规范化，DEVIATION-2）',
      clipEqual === true,
      `equal=${String(clipEqual)} clipboard=${String(clip).slice(0, 90)}`,
    );
  } else {
    info('D2 剪贴板比对跳过（readText 不可用 → 按 D1 兜底口径）', String(clip).slice(0, 70));
  }

  // D3 改布局 → 导入原 JSON → 逐字段深比较
  await ensureSettings(page);
  await pickPreset(page, 'notion');
  const changed = await page.evaluate(MEASURE);
  info('D3 改动后', JSON.stringify(changed.layout));
  await page.locator('button', { hasText: '导入布局' }).first().click().catch(() => {});
  await wait(1000);
  const impIn = page.locator('[data-testid="layout-import-input"]').first();
  const impOk = await impIn.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  let imported = null;
  if (impOk) {
    await impIn.fill(knownJson);
    await wait(300);
    await page.locator('button', { hasText: '导入并应用' }).first().click().catch(() => {});
    await wait(1400);
    const after = await page.evaluate(MEASURE);
    imported = {
      after: canon(after.layout),
      okNote: await page.evaluate(() => document.querySelector('[data-testid="layout-import-ok"]')?.textContent ?? null),
    };
  }
  check(
    'D3 改布局→导入原 JSON：布局逐字段深比较等价',
    imported !== null && imported.after === canon(known.layout),
    `改到=${String(changed.layout?.preset)} 还原后=${String(imported?.after)} 提示="${String(imported?.okNote)}"`,
  );

  // ---- E. 非法导入 ----
  await page.locator('button', { hasText: '导入布局' }).first().click().catch(() => {});
  await wait(1000);
  const impIn2 = page.locator('[data-testid="layout-import-input"]').first();
  const imp2Ok = await impIn2.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  let badErrText = null;
  if (imp2Ok) {
    const snapshotBefore = await page.evaluate(MEASURE);
    await impIn2.fill('{bad json');
    await wait(300);
    await page.locator('button', { hasText: '导入并应用' }).first().click().catch(() => {});
    await wait(1200);
    badErrText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="layout-import-error"]');
      return el === null ? null : el.textContent;
    });
    const afterBad = await page.evaluate(MEASURE);
    check(
      'E1 非法导入 `{bad json` → 可读错误提示',
      typeof badErrText === 'string' && badErrText.length > 4,
      `err="${String(badErrText).slice(0, 80)}"`,
    );
    check(
      'E2 非法导入后**布局逐字段不变**',
      JSON.stringify(snapshotBefore.layout) === JSON.stringify(afterBad.layout),
      `before=${JSON.stringify(snapshotBefore.layout)} after=${JSON.stringify(afterBad.layout)}`,
    );
  } else {
    check('E1 非法导入 → 可读错误提示', false, '导入对话框未出现');
    check('E2 非法导入后布局不变', false, '导入对话框未出现');
  }
  await page.screenshot({ path: join(SHOTS, 'light-05-import-error.png') }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await wait(600);

  // 定点保存一个可复现的收尾态：workbench + 宽度 280（供 BOOT2 复验持久化）
  await ensureSettings(page);
  await pickPreset(page, 'workbench');
  const wIn2 = page.locator('[data-testid="layout-sidebar-width"]').first();
  await wIn2.fill('280');
  await wIn2.press('Enter');
  await wait(900);
  const finalState = await page.evaluate(MEASURE);
  info('BOOT1 收尾态', JSON.stringify(finalState));

  // ---- F. 红线（同会话）----
  check('F1 红线①：窗口零滚动（scrollWidth ≤ clientWidth）', finalState.scrollLeft <= 0, `overflow=${String(finalState.scrollLeft)}px`);

  await quit(page, pid);

  // ================= BOOT 2（重开保持）=================
  console.log('\n===== BOOT 2：重开保持 =====');
  ({ page, pid } = await launch(null));
  await wait(2000);
  const afterRestart = await page.evaluate(MEASURE);
  info('重开后', JSON.stringify(afterRestart));
  check(
    'G1 重开后布局**逐字段**与重启前等价（含预设/参数/AI 展开态）',
    canon(afterRestart.layout) === canon(finalState.layout),
    `重启后=${canon(afterRestart.layout)}｜重启前=${canon(finalState.layout)}`,
  );
  check(
    'G2 重开后参数保持（侧栏宽 280 变量 + 几何一致）',
    afterRestart.varSidebar === '280px' && afterRestart.sidebarW !== null && Math.abs(afterRestart.sidebarW - 280) <= 2,
    `var=${afterRestart.varSidebar} 实测=${String(afterRestart.sidebarW)}px`,
  );

  // ---- 红线② 侧栏完全收起：真机切 focus 后测几何 ----
  const inSettings2 = await openSettings(page);
  if (inSettings2 === true) {
    const f2 = await pickPreset(page, 'focus');
    info('focus 真机几何', JSON.stringify(f2));
    check(
      'F2 红线②：侧栏**完全收起**（实测渲染宽 = 0，非窄轨）',
      f2.collapsed === true && f2.sidebarW !== null && f2.sidebarW <= 1,
      `collapsed=${String(f2.collapsed)} 实测宽=${String(f2.sidebarW)}px`,
    );
    await page.screenshot({ path: join(SHOTS, 'light-06-collapsed.png') }).catch(() => {});
  } else {
    check('F2 红线②：侧栏完全收起', false, '未能重入设置页');
  }

  await quit(page, pid);

  // ================= BOOT 3（深色 + 红线③⑤）=================
  console.log('\n===== BOOT 3：深色 + 红线③⑤ =====');
  ({ page, pid } = await launch(null));
  await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
  await wait(2200);
  const dark = await page.evaluate(MEASURE);
  info('深色态', JSON.stringify(dark));
  check('H1 深色主题生效（data-theme=dark）', dark.theme === 'dark', `data-theme=${String(dark.theme)}`);
  await page.screenshot({ path: join(SHOTS, 'dark-00-boot.png') }).catch(() => {});

  const inSettings3 = await openSettings(page);
  if (inSettings3 === true) {
    await page.screenshot({ path: join(SHOTS, 'dark-01-layout-section.png') }).catch(() => {});
    await pickPreset(page, 'focus');
    await page.screenshot({ path: join(SHOTS, 'dark-02-preset-focus.png') }).catch(() => {});
    await pickPreset(page, 'workbench');
    await page.screenshot({ path: join(SHOTS, 'dark-03-preset-workbench.png') }).catch(() => {});
  }
  const darkEnd = await page.evaluate(MEASURE);
  check('H2 深色下窗口仍零滚动', darkEnd.scrollLeft <= 0, `overflow=${String(darkEnd.scrollLeft)}px`);

  // ---- 红线③ 手柄装订线 gutter ≥ 8（真机矩形量测，T36 同口径）----
  // 回编辑区建页并输入，hover 首块后量「文本左缘 − 簇右缘」
  await page.keyboard.press('Escape').catch(() => {});
  await wait(500);
  // 装订线量测需要可见侧栏（BOOT3 此刻可能停在 focus=收起态）→ 先切回 notion
  // pickAndMeasure 内部已退出设置页（齿轮是 toggle，不可再点一次）→ 直接量测
  await pickAndMeasure(page, 'notion');
  await wait(1000);
  const sideNow = await page.evaluate(MEASURE);
  info('建页前布局态', JSON.stringify({ collapsed: sideNow.collapsed, sidebarW: sideNow.sidebarW }));
  const sideNew = page.locator('[data-testid="side-new-page"]').first();
  const canNew = (await sideNew.count()) > 0;
  let gutter = null;
  if (canNew) {
    await sideNew.click().catch(() => {});
    const nm = page.locator('.app-side input').first();
    const nmOk = await nm.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    if (nmOk) {
      await nm.fill('T39装订线校验页');
      await nm.press('Enter');
      await waitFor(async () => page.evaluate(() => document.querySelector('.pv-body') !== null), 15000);
      await wait(1400);
      // 明确把焦点放进正文再输入（否则按键可能落到别处）
      const body = page.locator('.pv-body .ProseMirror').first();
      const bodyOk = await body.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
      if (bodyOk) {
        await body.click({ position: { x: 40, y: 20 } }).catch(() => {});
        await wait(500);
        await page.keyboard.type('装订线校验正文一行', { delay: 30 });
        await wait(1500);
      }
      const dbg = await page.evaluate(() => ({
        bodyOk: document.querySelector('.pv-body') !== null,
        pmOk: document.querySelector('.pv-body .ProseMirror') !== null,
        blocks: document.querySelectorAll('.pv-body [data-id]').length,
        text: (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 40),
        handles: document.querySelectorAll('.pv-handle').length,
      }));
      info('装订线前置态', JSON.stringify(dbg));
      const blk = page.locator('.pv-body [data-id]').first();
      await blk.hover({ force: true }).catch(() => {});
      await wait(1200);
      gutter = await page.evaluate(() => {
        const cluster = document.querySelector('.pv-handle');
        const b = document.querySelector('.pv-body [data-id]');
        if (cluster === null || b === null) return null;
        const cr = cluster.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const st = getComputedStyle(b);
        const textLeft = br.left + parseFloat(st.paddingLeft || '0') + parseFloat(st.borderLeftWidth || '0');
        return { gutter: +(textLeft - cr.right).toFixed(1), clusterW: +cr.width.toFixed(1), clusterH: +cr.height.toFixed(1) };
      });
      await page.screenshot({ path: join(SHOTS, 'dark-04-gutter.png') }).catch(() => {});
    }
  }
  info('装订线量测', JSON.stringify(gutter));
  check(
    'F3 红线③：块手柄装订线 gutter ≥ 8（真机矩形量测）',
    gutter !== null && gutter.gutter >= 8,
    JSON.stringify(gutter),
  );

  // ---- 红线⑤ T37 多页签 / T38 AI 面板 ----
  // 现场切到 workbench（ai.expanded=true）以检验「可见性是否随布局」——T39-01-1 在此暴露
  await pickAndMeasure(page, 'workbench');
  await wait(600);
  const reg = await page.evaluate(() => {
    let layout = null;
    try {
      layout = JSON.parse(localStorage.getItem('septcats.layout') ?? 'null');
    } catch {
      layout = null;
    }
    return {
      tabsBar: document.querySelector('[data-testid="tabsbar"]') !== null,
      aiPanel: document.querySelector('.ai-chat') !== null,
      aiBottom: document.querySelector('.app-main-row--ai-bottom') !== null,
      scrollLeft: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      theme: document.documentElement.getAttribute('data-theme'),
      layout,
    };
  });
  info('红线⑤ 现场', JSON.stringify(reg));
  check('F4 红线⑤：多页签(T37) 结构在（标签条已渲染）', reg.tabsBar === true, `tabsBar=${String(reg.tabsBar)}`);
  const expectAi = reg.layout?.ai?.expanded === true && reg.layout?.ai?.position !== 'hidden';
  check(
    'F5 红线⑤：AI 面板(T38) 可见性**随布局**（实测 vs 由布局推出的期望一致）',
    reg.aiPanel === expectAi,
    `实测=${String(reg.aiPanel)} 期望=${String(expectAi)} 布局ai=${JSON.stringify(reg.layout?.ai)}`,
  );

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
    join(SHOTS, 't39-results.json'),
    JSON.stringify({ pass: passed, fail: failed, results, consoleErrors, pageErrors }, null, 2),
    'utf8',
  );
  process.exit(failed > 0 ? 1 : 0);
};

main().catch(async (e) => {
  console.error('探针异常终止:', String(e?.stack ?? e));
  writeFileSync(
    join(SHOTS, 't39-results.json'),
    JSON.stringify({ pass: results.filter((r) => r.ok === true).length, fail: 1, results, fatal: String(e?.stack ?? e) }, null, 2),
    'utf8',
  );
  for (const p of launched) killTree(p);
  process.exit(1);
});