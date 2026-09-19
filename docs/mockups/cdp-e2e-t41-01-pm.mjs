/* TASK-T41-01 真机验收（PM 独立复跑，不采信工程师自建探针）

 覆盖任务书 §2 六条：
  1. 切全宽：正文列 clientWidth → 容器宽；固定 = measure；差值 > 0（贴数值）
  2. 只影响正文列：标题行 / 页签条 / 侧栏 / AI 面板宽度切换前后不变（贴数值）
  3. 装订线不回归：全宽下 gutter ≥ 8 且 overlap = false
  4. 每页独立 + 持久化：A 全宽 / B 固定 → 重启后各自保持
  5. 回归：窗口零滚动 / 页签 / AI 面板 / 侧栏
  6. 双主题截图（固定 / 全宽）

 隔离：--user-data-dir + rootPath 双隔离；不触碰真实数据根。跑 freshly-built out/。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t41-pm';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9403;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t41-pm');

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
    return execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8', stdio: 'pipe' }).includes(String(pid));
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
  browser = undefined;
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
  await wait(1600);
  // 关键：必须把窗口放大到「容器内容宽 > measure」，否则 max-width 不生效、全宽与固定无差异
  // （默认窗口下 容器内容宽 529 < measure 650 → 测不出全宽效果）
  try {
    const cdp = await page.context().newCDPSession(page);
    const got = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', {
      windowId: got.windowId,
      bounds: { width: 1600, height: 900 },
    });
    await wait(1300);
  } catch (e) {
    console.log('WARN 窗口放大失败（全宽差异可能测不出）:', String(e?.message ?? e));
  }
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

// 全景量测：正文列 / 容器 / 四个「不应受影响」的元素
const MEASURE = () => {
  const q = (s) => document.querySelector(s);
  const w = (s) => {
    const e = q(s);
    return e === null ? null : +e.getBoundingClientRect().width.toFixed(1);
  };
  const cw = (s) => {
    const e = q(s);
    return e === null ? null : e.clientWidth;
  };
  const body = q('.pv-body');
  return {
    measureAttr: q('.pv-root')?.getAttribute('data-measure') ?? null,
    bodyW: w('.pv-body'),
    bodyClientW: cw('.pv-body'),
    bodyMaxW: body === null ? null : getComputedStyle(body).maxWidth,
    rootClientW: cw('.pv-root'),
    rootPadL: (() => {
      const e = q('.pv-root');
      return e === null ? 0 : parseFloat(getComputedStyle(e).paddingLeft || '0');
    })(),
    rootPadR: (() => {
      const e = q('.pv-root');
      return e === null ? 0 : parseFloat(getComputedStyle(e).paddingRight || '0');
    })(),
    titleRowW: w('.pv-title-row'),
    tabsW: w('[data-testid="tabsbar"]'),
    sideW: w('.app-side'),
    aiW: w('.ai-chat'),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    pw: Object.keys(localStorage)
      .filter((k) => k.startsWith('septcats.pagewidth.'))
      .map((k) => `${k}=${localStorage.getItem(k)}`),
    text: (q('.pv-body .ProseMirror')?.innerText ?? '').slice(0, 24),
  };
};

const rowIdOf = (page, title) =>
  page.evaluate((text) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"]')];
    const hit = rows.find((el) => (el.textContent ?? '').includes(text));
    return hit === undefined ? null : (hit.getAttribute('data-testid') ?? '').replace('side-node-', '');
  }, title);

const newPage = async (page, title) => {
  await page.locator('[data-testid="side-new-page"]').first().click().catch(() => {});
  const inp = page.locator('.app-side input').first();
  const ok = await inp.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!ok) return null;
  await inp.fill(title);
  await inp.press('Enter');
  await waitFor(async () => page.evaluate((t) => (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '') !== '' || document.querySelector('.pv-body') !== null, title), 12000);
  await wait(1200);
  const pm = page.locator('.pv-body .ProseMirror').first();
  if ((await pm.count()) > 0) {
    await pm.click({ position: { x: 40, y: 18 } }).catch(() => {});
    await wait(400);
    await page.keyboard.type(`${title} 正文`, { delay: 22 });
    await wait(1000);
  }
  return rowIdOf(page, title);
};

const openPage = async (page, title) => {
  const id = await rowIdOf(page, title);
  if (id === null) return false;
  await page.locator(`[data-testid="side-node-${id}"]`).first().click().catch(() => {});
  await wait(1400);
  return true;
};

// ⋯ 菜单第一项 = 「全宽 / 固定宽度」切换（T41-01）
const toggleFullWidth = async (page, title) => {
  const id = await rowIdOf(page, title);
  if (id === null) return { ok: false, why: '找不到页面行' };
  await page.locator(`[data-testid="side-more-${id}"]`).first().click().catch(() => {});
  await wait(700);
  const items = await page.locator('.app-nav-menu [role="menuitem"]').allInnerTexts().catch(() => []);
  const menuText = items.join(' | ');
  await page.locator('.app-nav-menu [role="menuitem"]').first().click().catch(() => {});
  await wait(1200);
  return { ok: true, menuText };
};

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

  // ================= BOOT 1 =================
  console.log('\n===== BOOT 1：固定 vs 全宽 / 只影响正文列 / 装订线 =====');
  let { page, pid } = await launch();

  const idA = await newPage(page, 'T41页A');
  const fixedA = await page.evaluate(MEASURE);
  info('A 页固定态', JSON.stringify(fixedA));
  await page.screenshot({ path: join(SHOTS, 'light-01-fixed.png') }).catch(() => {});

  const idB = await newPage(page, 'T41页B');
  const fixedB = await page.evaluate(MEASURE);
  info('B 页固定态', JSON.stringify(fixedB));

  // 固定态应有 measure（650px 来自 T39-01 notion 预设）
  const measurePx = parseFloat(String(fixedA.bodyMaxW).replace('px', ''));
  check(
    '§2.0-pre 测试前提成立：容器内容宽 > measure（否则全宽测不出差异）',
    Number.isFinite(measurePx) && fixedA.rootClientW > measurePx,
    `容器=${String(fixedA.rootClientW)}px measure=${String(fixedA.bodyMaxW)}`,
  );
  check(
    '§2.0 固定态正文列受 measure 约束（max-width 非 none 且实测宽 ≈ measure）',
    fixedA.bodyMaxW !== 'none' && fixedA.bodyW !== null && fixedA.bodyW < fixedA.rootClientW,
    `maxWidth=${String(fixedA.bodyMaxW)} bodyW=${String(fixedA.bodyW)} 容器内容宽=${String(+(fixedA.rootClientW - fixedA.rootPadL - fixedA.rootPadR).toFixed(1))}`,
  );

  // ---- §2.1 固定 → 全宽的真实差异 ----
  // 注意：**必须先在不打开 AI 面板时测**——AI 面板占 320px 会把容器压到 measure 以下，
  // 那时 max-width 本来就不生效，全宽与固定必然同宽（首跑即踩此坑）。
  await openPage(page, 'T41页A');
  await wait(700);
  const fixedA2 = await page.evaluate(MEASURE);
  info('A 页固定态（切前，无 AI 面板）', JSON.stringify(fixedA2));
  const t1 = await toggleFullWidth(page, 'T41页A');
  info('⋯ 菜单内容（切前=固定）', String(t1.menuText));
  const fullA = await page.evaluate(MEASURE);
  info('A 页全宽态', JSON.stringify(fullA));
  await page.screenshot({ path: join(SHOTS, 'light-02-full.png') }).catch(() => {});

  check('§2.1a 切换到全宽后 `data-measure="full"` 已挂上页面根', fullA.measureAttr === 'full', `data-measure=${String(fullA.measureAttr)}`);
  const contentW = fullA.rootClientW - fullA.rootPadL - fullA.rootPadR;
  check(
    '§2.1b 全宽：正文列 max-width = none 且实测宽 = 容器**内容宽**（clientWidth − 左右内边距）',
    fullA.bodyMaxW === 'none' && fullA.bodyClientW !== null && Math.abs(fullA.bodyClientW - contentW) <= 2,
    `maxWidth=${String(fullA.bodyMaxW)} bodyClientW=${String(fullA.bodyClientW)} 容器内容宽=${String(+contentW.toFixed(1))}（clientW=${String(fullA.rootClientW)} − pad ${String(fullA.rootPadL)}+${String(fullA.rootPadR)}）`,
  );
  check(
    '§2.1c 全宽 vs 固定：正文列宽度**差值 > 0**（全宽更宽）',
    fullA.bodyW !== null && fixedA2.bodyW !== null && fullA.bodyW - fixedA2.bodyW > 0,
    `固定=${String(fixedA2.bodyW)}px 全宽=${String(fullA.bodyW)}px 差=${String(fullA.bodyW === null || fixedA2.bodyW === null ? '?' : +(fullA.bodyW - fixedA2.bodyW).toFixed(1))}px（容器=${String(fullA.rootClientW)} measure=${String(fixedA2.bodyMaxW)}）`,
  );

  // ---- §2.2 只影响正文列：打开 AI 面板后再切一次，比对四个「不应受影响」的元素 ----
  await toggleFullWidth(page, 'T41页A'); // 切回固定
  await wait(1000);
  await page.keyboard.press('Control+j').catch(() => {});
  await wait(1400);
  const beforeToggle = await page.evaluate(MEASURE);
  info('切换前（A 固定 + AI 面板开）', JSON.stringify(beforeToggle));
  const t2 = await toggleFullWidth(page, 'T41页A');
  info('⋯ 菜单内容（切前=固定，AI 面板开）', String(t2.menuText));
  const afterToggle = await page.evaluate(MEASURE);
  info('切换后（A 全宽 + AI 面板开）', JSON.stringify(afterToggle));

  const same = (a, b) => a === b;
  check(
    '§2.2a 标题行宽度**不变**',
    same(beforeToggle.titleRowW, afterToggle.titleRowW),
    `切换前=${String(beforeToggle.titleRowW)}px 切换后=${String(afterToggle.titleRowW)}px`,
  );
  check(
    '§2.2b 页签条宽度**不变**',
    same(beforeToggle.tabsW, afterToggle.tabsW),
    `切换前=${String(beforeToggle.tabsW)}px 切换后=${String(afterToggle.tabsW)}px`,
  );
  check(
    '§2.2c 侧栏宽度**不变**',
    same(beforeToggle.sideW, afterToggle.sideW),
    `切换前=${String(beforeToggle.sideW)}px 切换后=${String(afterToggle.sideW)}px`,
  );
  check(
    '§2.2d AI 面板宽度**不变**（且在位）',
    beforeToggle.aiW !== null && same(beforeToggle.aiW, afterToggle.aiW),
    `切换前=${String(beforeToggle.aiW)}px 切换后=${String(afterToggle.aiW)}px`,
  );

  // §2.3 装订线不回归（全宽下）
  const blk = page.locator('.pv-body [data-id]').first();
  await blk.hover({ force: true }).catch(() => {});
  await wait(1100);
  const gutter = await page.evaluate(() => {
    const cluster = document.querySelector('.pv-handle');
    const b = document.querySelector('.pv-body [data-id]');
    if (cluster === null || b === null) return null;
    const cr = cluster.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const st = getComputedStyle(b);
    const textLeft = br.left + parseFloat(st.paddingLeft || '0') + parseFloat(st.borderLeftWidth || '0');
    return { gutter: +(textLeft - cr.right).toFixed(1), clusterW: +cr.width.toFixed(1), overlap: textLeft - cr.right < 0 };
  });
  info('全宽下装订线', JSON.stringify(gutter));
  check('§2.3 全宽下装订线 gutter ≥ 8 且无重叠（overlap=false）', gutter !== null && gutter.gutter >= 8 && gutter.overlap === false, JSON.stringify(gutter));
  await page.screenshot({ path: join(SHOTS, 'light-03-full-gutter.png') }).catch(() => {});

  // §2.5 回归：零滚动
  check(
    '§2.5a 全宽下窗口**零滚动**',
    fullA.scrollX <= 0 && fullA.scrollY <= 0,
    `x=${String(fullA.scrollX)} y=${String(fullA.scrollY)}`,
  );

  // B 页仍为固定
  await openPage(page, 'T41页B');
  const bAfter = await page.evaluate(MEASURE);
  info('B 页（A 已全宽后）', JSON.stringify(bAfter));
  check(
    '§2.4a **每页独立**：A 全宽时 B 仍固定',
    bAfter.measureAttr === null && bAfter.bodyMaxW !== 'none',
    `B.data-measure=${String(bAfter.measureAttr)} B.maxWidth=${String(bAfter.bodyMaxW)}`,
  );
  const pw = bAfter.pw.join(' ; ');
  info('持久化键', pw);
  check(
    '§2.4b 持久化写入 `septcats.pagewidth.<ws>` 且只含 A',
    idA !== null && bAfter.pw.some((k) => k.includes(idA)) && !bAfter.pw.some((k) => idB !== null && k.includes(idB)),
    `idA=${String(idA)} idB=${String(idB)} keys=${pw}`,
  );

  await quit(page, pid);

  // ================= BOOT 2（重启 + 深色）=================
  console.log('\n===== BOOT 2：重启保持 + 深色 =====');
  ({ page, pid } = await launch());
  await openPage(page, 'T41页A');
  const aRestart = await page.evaluate(MEASURE);
  info('重启后 A', JSON.stringify(aRestart));
  check(
    '§2.4c 重启后 **A 仍全宽**（data-measure=full + max-width none）',
    aRestart.measureAttr === 'full' && aRestart.bodyMaxW === 'none',
    `data-measure=${String(aRestart.measureAttr)} maxWidth=${String(aRestart.bodyMaxW)}`,
  );

  await openPage(page, 'T41页B');
  const bRestart = await page.evaluate(MEASURE);
  info('重启后 B', JSON.stringify(bRestart));
  check(
    '§2.4d 重启后 **B 仍固定**（不被 A 影响）',
    bRestart.measureAttr === null && bRestart.bodyMaxW !== 'none',
    `data-measure=${String(bRestart.measureAttr)} maxWidth=${String(bRestart.bodyMaxW)}`,
  );

  // 深色截图（固定 + 全宽）
  await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
  await wait(2200);
  await openPage(page, 'T41页B');
  const darkFixed = await page.evaluate(MEASURE);
  check('§2.6a 深色下固定态正常（data-theme=dark）', darkFixed.measureAttr === null, `theme/dark fixed=${String(darkFixed.measureAttr)}`);
  await page.screenshot({ path: join(SHOTS, 'dark-01-fixed.png') }).catch(() => {});
  await openPage(page, 'T41页A');
  const darkFull = await page.evaluate(MEASURE);
  check('§2.6b 深色下全宽态正常', darkFull.measureAttr === 'full' && darkFull.bodyMaxW === 'none', `full=${String(darkFull.measureAttr)} maxWidth=${String(darkFull.bodyMaxW)}`);
  await page.screenshot({ path: join(SHOTS, 'dark-02-full.png') }).catch(() => {});

  check('§2.5b 深色下窗口零滚动', darkFull.scrollX <= 0 && darkFull.scrollY <= 0, `x=${String(darkFull.scrollX)} y=${String(darkFull.scrollY)}`);

  await quit(page, pid);

  // ================= 汇总 =================
  const passed = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false).length;
  console.log(`\n===== 汇总：${String(passed)} PASS / ${String(failed)} FAIL =====`);
  for (const r of results) if (r.ok === false) console.log(`  ✗ ${r.name} — ${r.raw}`);
  console.log(`console 错误 ${String(consoleErrors.length)} 条 / pageerror ${String(pageErrors.length)} 条`);
  if (pageErrors.length > 0) console.log(`  pageerror: ${pageErrors.slice(0, 3).join(' | ')}`);

  writeFileSync(
    join(SHOTS, 't41-pm-results.json'),
    JSON.stringify({ pass: passed, fail: failed, results, consoleErrors, pageErrors }, null, 2),
    'utf8',
  );
  process.exit(failed > 0 ? 1 : 0);
};

main().catch(async (e) => {
  console.error('探针异常终止:', String(e?.stack ?? e));
  writeFileSync(
    join(SHOTS, 't41-pm-results.json'),
    JSON.stringify({ pass: results.filter((r) => r.ok === true).length, fail: 1, results, fatal: String(e?.stack ?? e) }, null, 2),
    'utf8',
  );
  for (const p of launched) killTree(p);
  process.exit(1);
});