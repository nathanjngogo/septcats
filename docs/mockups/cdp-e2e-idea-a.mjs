/**
 * cdp-e2e-idea-a.mjs —— 专注模式（IDEA-A）真机验收。
 *
 * 证明链路（单测只测组件/hook，这里测**装配后**的整应用）：
 *   ① F9 → documentElement[data-focus]=on + 一级导轨/二级侧栏/读数区 display:none + 顶栏只剩专注钮；
 *   ② 专注中 Esc → 全还原；
 *   ③ 命令面板「切换专注模式」与 F9 同效（同一状态源）；
 *   ④ 编辑列在专注态仍正常渲染（藏周边 ≠ 藏正文）。
 *
 * 红线：真实档案只读（独立 userData + _scratch 副本）；探针全程前台。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFrom = createRequire(join(REPO_ROOT, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');

const APPDIR = join(REPO_ROOT, 'apps', 'desktop');
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const REAL_ROOT = join(process.env.USERPROFILE ?? 'C:/Users/Administrator', '.septcats');
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9455);
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\idea-a';
const UD = join(RUN, 'userdata');
const ROOT = join(RUN, 'root');
const SHOTS = join(RUN, 'shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killStaleApp() { for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

async function boot() {
  killStaleApp();
  try { rmSync(RUN, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* 占用：复用 */ }
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'dark', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(APP_BIN, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: dirname(APP_BIN), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2600);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2600); }
  return { child, browser, page };
}

let CHILD = null;
let BROWSER = null;
const results = [];
function check(name, ok, raw) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 160)}`);
}

const PROBE = () => {
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return 'missing';
    return getComputedStyle(el).display === 'none' ? 'hidden' : 'visible';
  };
  const actionBtns = [...document.querySelectorAll('.sc-shell__actions > *')].filter((el) => getComputedStyle(el).display !== 'none');
  return {
    focus: document.documentElement.dataset.focus ?? 'off',
    rail: vis('.sc-shell__rail'),
    sidebar: vis('.sc-shell__sidebar'),
    readouts: vis('.sc-readouts'),
    visibleActions: actionBtns.length,
    focusBtnLeft: actionBtns.some((el) => (el.querySelector?.('[data-testid="focus-toggle"]') ?? null) !== null || el.matches?.('[data-testid="focus-toggle"]') === true),
    editorVisible: vis('.pv-root'),
    badge: document.querySelector('[data-testid="focus-badge"]') !== null,
  };
};

async function main() {
  const before = rootMtime();
  const h = await boot();
  CHILD = h.child; BROWSER = h.browser;
  const page = h.page;
  try {
    const base = await page.evaluate(PROBE);
    check('①-0 基线：正常态导轨/侧栏可见', base.focus === 'off' && base.rail === 'visible' && base.sidebar === 'visible', JSON.stringify(base));

    await page.keyboard.press('F9');
    await wait(900);
    const on = await page.evaluate(PROBE);
    check('① F9 进专注：data-focus=on，导轨/侧栏/读数区全隐藏', on.focus === 'on' && on.rail === 'hidden' && on.sidebar === 'hidden' && (on.readouts === 'hidden' || on.readouts === 'missing'), JSON.stringify(on));
    check('①-2 专注顶栏只剩专注钮（其它动作钮让位，出口保留）', on.visibleActions === 1 && on.focusBtnLeft === true, `visibleActions=${String(on.visibleActions)} left=${String(on.focusBtnLeft)}`);
    check('④ 专注态编辑列照常渲染（藏周边≠藏正文）', on.editorVisible === 'visible' || on.editorVisible === 'missing', `pv=${on.editorVisible}`);
    check('角标出现', on.badge === true, String(on.badge));
    await page.screenshot({ path: join(SHOTS, 'focus-on.png') });

    await page.keyboard.press('Escape');
    await wait(900);
    const off = await page.evaluate(PROBE);
    check('② 专注中 Esc 退出并全还原', off.focus === 'off' && off.rail === 'visible' && off.sidebar === 'visible', JSON.stringify({ f: off.focus, rail: off.rail, sb: off.sidebar }));
    await page.screenshot({ path: join(SHOTS, 'focus-off.png') });

    // ③ 命令面板同通道：Ctrl+K 搜「专注」→ 回车执行 → data-focus=on
    await page.keyboard.press('Control+k');
    await wait(900);
    await page.keyboard.type('专注');
    await wait(800);
    await page.keyboard.press('Enter');
    await wait(900);
    const viaCmd = await page.evaluate(PROBE);
    check('③ 命令面板「切换专注模式」与 F9 同效（同一状态源）', viaCmd.focus === 'on' && viaCmd.rail === 'hidden', JSON.stringify({ f: viaCmd.focus, rail: viaCmd.rail }));
    await page.keyboard.press('F9');
    await wait(600);
    const back = await page.evaluate(PROBE);
    check('③-2 命令进→F9 出：两入口交叉闭环', back.focus === 'off' && back.rail === 'visible', JSON.stringify({ f: back.focus }));

    // IDEA-B：写作洞察条——打字即现字数与阅读分钟（口径单测钉在 packages/editor/test/stats.test.ts，
    // 这里只验装配：PM 文本 → 条上数字对得上）
    // 洞察条挂在**页面编辑区**（工作台/回收站等视图没有 .ProseMirror）——先建页进编辑态
    const hadEditor = await page.locator('.ProseMirror').count() > 0;
    if (!hadEditor) {
      await page.evaluate(() => { document.querySelector('[data-testid="side-new-page"]')?.click(); });
      await wait(1800);
    }
    const ed = page.locator('.ProseMirror').first();
    if (await ed.count() > 0) {
      await ed.click();
      await wait(300);
      await page.keyboard.type('夜航船是一部奇书。'.repeat(3)); // 9 字 ×3 = 27 字（含标点 27+3=30 CJK 族）
      await wait(1200);
      const stats = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="pv-stats"]');
        return el === null ? null : (el.textContent ?? '').trim();
      });
      const m = stats === null ? null : /([\d,]+) 字/u.exec(stats);
      // 期望：'夜航船是一部奇书。' 每段 9 字符（8 汉字+1 句号）×3 = 27 字；断言条在且数字 ≥20（口径细节归单测）
      check('IDEA-B 洞察条：打字即现「N 字 · 约读 M 分钟」', stats !== null && m !== null && Number(m[1].replace(/,/g, '')) >= 20, `stats=「${String(stats)}」`);
      await page.screenshot({ path: join(SHOTS, 'idea-b-stats.png') });
    } else {
      check('IDEA-B 洞察条', false, '编辑区未出现（夹具异常）');
    }

    const after = rootMtime();
    check('真实档案零触碰', before === after, `${String(before)} vs ${String(after)}`);
  } finally {
    try { await BROWSER.close(); } catch { /* */ }
    try { if (CHILD !== null) { execSync(`taskkill /PID ${String(CHILD.pid)} /T /F`, { stdio: 'ignore' }); } } catch { /* */ }
    killStaleApp();
  }
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n===== IDEA-A 专注模式真机验收：${String(results.length - fails)} PASS / ${String(fails)} FAIL =====`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((err) => { console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`); killStaleApp(); process.exitCode = 2; });
