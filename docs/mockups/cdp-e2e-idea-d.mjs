/**
 * cdp-e2e-idea-d.mjs —— 页内查找（IDEA-D，Ctrl+F）真机验收。
 *
 * 链路：建页 → 垫高正文（含两处「关键词」，一处在长段落中部）→ Ctrl+F 出查找条
 *       → 输入词 → 「1/2」计数 + 预览命中上下文 → Enter 游走 → 目标块滚进视口
 *       → Esc 关条。跳转断言走 data-id 锚 inView（与大纲探针同判据）。
 * 红线：独立 profile（_scratch 副本），真实档案只读 + mtime 双钉。
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
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9458);
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\idea-d';
const UD = join(RUN, 'userdata');
const ROOT = join(RUN, 'root');
const SHOTS = join(RUN, 'shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killStaleApp() { for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

async function boot() {
  killStaleApp();
  try { rmSync(RUN, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* 占用复用 */ }
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

const results = [];
function check(name, ok, raw) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 170)}`);
}

let CHILD = null;
let BROWSER = null;
async function main() {
  const before = rootMtime();
  const h = await boot();
  CHILD = h.child; BROWSER = h.browser;
  const page = h.page;
  try {
    await page.locator('[data-testid="side-new-page"]').click();
    await wait(1500);
    const ed = page.locator('.ProseMirror').first();
    await ed.click();
    await wait(400);
    await page.keyboard.type('第一段有 关键词 在这里。');
    await page.keyboard.press('Enter');
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.type(`垫高段落${String(i)}：夜航船上记着天地人物的旧事，读来有味。`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('末尾段落里也藏着 关键词 收尾。');
    await page.keyboard.press('Enter');
    await wait(1200);

    // Ctrl+F 出条
    await page.keyboard.press('Control+f');
    await wait(700);
    const barUp = await page.evaluate(() => document.querySelector('[data-testid="pv-find"]') !== null);
    check('① Ctrl+F → 查找条出现且输入框聚焦', barUp === true, String(barUp));
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
    check('①-b 焦点自动落进搜索框', focused === 'pv-find-input', focused);
    if (!barUp) { process.exitCode = 1; return; }

    // 输入关键词 → 计数 1/2 + 预览
    await page.keyboard.type('关键词');
    await wait(1400);
    const state1 = await page.evaluate(() => ({
      count: (document.querySelector('[data-testid="pv-find-count"]')?.textContent ?? '').trim(),
      hint: (document.querySelector('[data-testid="pv-find-hint"]')?.textContent ?? '').trim(),
    }));
    check('② 输入「关键词」→ 1/2 计数 + 预览含命中上下文',
      state1.count === '1/2' && state1.hint.includes('关键词'), JSON.stringify(state1));
    await page.screenshot({ path: join(SHOTS, 'find-open.png') });

    // Enter 游走 → 2/2 且目标块滚进视口
    await page.keyboard.press('Enter');
    await wait(1200);
    const state2 = await page.evaluate(() => {
      const items = document.querySelectorAll('.ProseMirror [data-id]');
      let inView = false;
      for (const el of items) {
        if ((el.textContent ?? '').includes('关键词')) {
          const r = el.getBoundingClientRect();
          if (r.top > -80 && r.top < window.innerHeight) { inView = true; }
        }
      }
      return {
        count: (document.querySelector('[data-testid="pv-find-count"]')?.textContent ?? '').trim(),
        inView,
      };
    });
    check('③ Enter → 2/2 且第二处命中块滚进视口', state2.count === '2/2' && state2.inView === true, JSON.stringify(state2));

    // 无匹配态
    await page.keyboard.press('Control+a');
    await page.keyboard.type('查无此词');
    await wait(900);
    const none = await page.evaluate(() => (document.querySelector('[data-testid="pv-find-count"]')?.textContent ?? '').trim());
    check('④ 无匹配 → 「无匹配」（不假装在工作）', none === '无匹配', none);

    // Esc 关条
    await page.keyboard.press('Escape');
    await wait(500);
    const closed = await page.evaluate(() => document.querySelector('[data-testid="pv-find"]') === null);
    check('⑤ Esc 关闭查找条', closed === true, String(closed));

    const after = rootMtime();
    check('真实档案零触碰', before === after, `${String(before)} vs ${String(after)}`);
    const fails = results.filter((r) => !r.ok).length;
    console.log(`\n===== IDEA-D 页内查找真机验收：${String(results.length - fails)} PASS / ${String(fails)} FAIL =====`);
    process.exitCode = fails === 0 ? 0 : 1;
  } finally {
    try { await BROWSER.close(); } catch { /* */ }
    try { if (CHILD !== null) { execSync(`taskkill /PID ${String(CHILD.pid)} /T /F`, { stdio: 'ignore' }); } } catch { /* */ }
    killStaleApp();
  }
}

main().catch((err) => { console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`); killStaleApp(); process.exitCode = 2; });
