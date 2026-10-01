/**
 * cdp-e2e-idea-c.mjs —— 页内大纲（IDEA-C）真机验收。
 *
 * 链路：建页 → 敲 3 个标题（H1/H2/H3 各一）+ 正文 → 标题行下出现「目录 · 3」
 *       → 展开列表缩进分档 → 点「节一」→ 视口滚动到该块（data-id 锚在可视区）。
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
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9457);
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\idea-c';
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
    // 长正文先垫高（保证滚动有位移可测）
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.type(`垫高段落${String(i)}：夜航船上记着天地人物的旧事，读来有味。`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('# 总览'); await page.keyboard.press('Enter');
    await page.keyboard.type('正文一段。'); await page.keyboard.press('Enter');
    await page.keyboard.type('## 章一'); await page.keyboard.press('Enter');
    await page.keyboard.type('正文二段。'); await page.keyboard.press('Enter');
    await page.keyboard.type('### 节一'); await page.keyboard.press('Enter');
    await wait(1600);

    const toggle = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pv-outline-toggle"]');
      return el === null ? null : (el.textContent ?? '').trim();
    });
    check('① 三个标题 → 标题行下出现「目录 · 3」（少于 2 标题时它不渲染，这里反证）', toggle === '目录 · 3', String(toggle));
    if (toggle === null) { process.exitCode = 1; return; }

    await page.evaluate(() => { document.querySelector('[data-testid="pv-outline-toggle"]')?.click(); });
    await wait(600);
    const items = await page.evaluate(() => [...document.querySelectorAll('.pv-outline-item')].map((el) => ({
      text: (el.textContent ?? '').trim(),
      cls: el.className,
      top: Math.round(el.getBoundingClientRect().top),
    })));
    check('② 展开=3 条目、顺序=文档顺序、level 缩进类正确',
      items.length === 3 && items[0].text === '总览' && items[1].cls.includes('--l2') && items[2].cls.includes('--l3'),
      JSON.stringify(items.map((i) => `${i.text}/${i.cls.slice(-3)}`)));

    // 点击「节一」→ 视口滚动到该块（锚块出现在可视区）
    const jumped = await page.evaluate(async () => {
      document.querySelector('[data-testid^="pv-outline-item-"]:nth-child(3)')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
      const items = [...document.querySelectorAll('.pv-outline-item')];
      const last = items[items.length - 1];
      const id = last === null ? '' : (last.getAttribute('data-testid') ?? '').replace('pv-outline-item-', '');
      const anchor = document.querySelector(`[data-id="${id}"]`);
      if (anchor === null) return { found: false, id };
      const r = anchor.getBoundingClientRect();
      return { found: true, id, inView: r.top > -80 && r.top < window.innerHeight };
    });
    check('③ 点条目 → 滚动定位到目标块（jumpToBlockId 通道复用）',
      jumped.found === true && jumped.inView === true, JSON.stringify(jumped));
    await page.screenshot({ path: join(SHOTS, 'outline-open.png') });

    // 折叠回落
    await page.evaluate(() => { document.querySelector('[data-testid="pv-outline-toggle"]')?.click(); });
    await wait(500);
    const folded = await page.evaluate(() => document.querySelector('[data-testid="pv-outline-list"]') === null);
    check('④ 再点折叠（默认收起不是单向门）', folded === true, String(folded));

    const after = rootMtime();
    check('真实档案零触碰', before === after, `${String(before)} vs ${String(after)}`);
    const fails = results.filter((r) => !r.ok).length;
    console.log(`\n===== IDEA-C 页内大纲真机验收：${String(results.length - fails)} PASS / ${String(fails)} FAIL =====`);
    process.exitCode = fails === 0 ? 0 : 1;
  } finally {
    try { await BROWSER.close(); } catch { /* */ }
    try { if (CHILD !== null) { execSync(`taskkill /PID ${String(CHILD.pid)} /T /F`, { stdio: 'ignore' }); } } catch { /* */ }
    killStaleApp();
  }
}

main().catch((err) => { console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`); killStaleApp(); process.exitCode = 2; });
