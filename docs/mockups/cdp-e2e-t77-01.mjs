/* T77 真机探针：代码块语言栏（聚焦浮出/选语言/淡标签/重启还原）+ 图片块拖拽柄存在性 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't77-e2e');
const UD = `${RUN}\\ud`;
const ROOT = join(RUN, 'data');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t77');
const PORT = 9236;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const PAGE_NAME = `T77 代码页 ${Date.now().toString(36)}`;
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(800);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ }
  }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { child, browser, page };
}

async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  // T79 事故根治：rootPath 夹具钉死（t60 先例）——绝不写真实数据根
  writeFileSync(
    `${UD}\\septcats.settings.json`,
    JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypted: false, relay: '' } }, null, 2),
    'utf8',
  );
  mkdirSync(SHOTS, { recursive: true });
  const rootBefore = rootMtime();
  let child = null; let browser = null; let page = null;
  try {
    ({ child, browser, page } = await launch());
    const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
    if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }

    STEP = 'C1|代码块语言栏';
    await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
    await wait(900);
    await page.evaluate((pn) => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, pn); i.dispatchEvent(new Event('input', { bubbles: true })); } }, PAGE_NAME);
    await wait(200);
    await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await wait(1500);
    const body = page.locator('.pv-body .ProseMirror').first();
    await body.click();
    await wait(300);
    await page.keyboard.type('```', { delay: 50 });
    await page.keyboard.press('Enter');
    await wait(500);
    await page.keyboard.type('const a = 1;', { delay: 20 });
    await wait(500);
    const cb = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid^="codebar-lang-"]');
      return { bar: bar != null, wrap: document.querySelector('[data-testid^="codebar-wrap-"]') != null };
    });
    check('C1-a 聚焦代码块→语言栏+换行钮浮出', cb.bar && cb.wrap, JSON.stringify(cb));
    await page.screenshot({ path: join(SHOTS, 'c1-codebar.png') }).catch(() => {});
    // 打开下拉选 python
    await page.evaluate(() => { document.querySelector('[data-testid^="codebar-lang-"]')?.click(); });
    await wait(500);
    const opt = await page.locator('[data-testid="codebar-lang-opt-python"]').count();
    check('C1-b 下拉含 python 选项', opt === 1, String(opt));
    await page.evaluate(() => document.querySelector('[data-testid="codebar-lang-opt-python"]')?.click());
    await wait(600);
    // blur（温和）：点正文空白区使代码块失焦 → 淡标签；勿点视口角落（会误触侧栏导航）
    await page.evaluate(() => { const a = document.activeElement; if (a != null && typeof a.blur === 'function') a.blur(); });
    await wait(900);
    const tag = await page.evaluate(() => {
      const t = document.querySelector('[data-testid^="code-lang-tag-"]');
      return { shown: t != null && t.offsetParent !== null, text: t?.textContent ?? '' };
    });
    check('C1-c blur 后淡标签显 python（lang attr 已写）', tag.shown && tag.text.toLowerCase().includes('python'), JSON.stringify(tag));
    await page.screenshot({ path: join(SHOTS, 'c1-tag.png') }).catch(() => {});

    STEP = 'C4|持久化链';
    // 同会话 IPC 先证写链：commit→truth 层 props.lang
    const ipcRead = async () => page.evaluate(async (pn) => {
      const ws = await window.septcats.workspaces.list({});
      const r = await window.septcats.pages.tree({ workspaceId: ws.activeId ?? ws.items?.[0]?.id });
      const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
      const hit = arr.find((x) => x?.title === pn);
      if (!hit) return { id: null, pn };
      const b = await window.septcats.blocks.list({ pageId: hit.id });
      const code = (b.blocks ?? []).find((x) => x.type === 'code');
      return { id: hit.id, lang: code?.props?.lang ?? null, hasX: (code?.content ?? '').includes('const a = 1'),
        dump: (b.blocks ?? []).map((x) => `${x.type}:${JSON.stringify(x.props)}:${(x.content ?? '').slice(0, 20)}`).join(' | ').slice(0, 300) };
    }, PAGE_NAME);
    await wait(3600);
    const same = await ipcRead();
    check('C4-a 写链：truth 层 lang=python（同会话 IPC）', same.id != null && same.lang === 'python' && same.hasX, JSON.stringify(same).slice(0, 400));
    // 重启还原（代码块此刻干净：C2/C3 未跑）
    await wait(3200);
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    for (let i = 0; i < 16; i += 1) { await wait(500); try { execSync('tasklist /FI "IMAGENAME eq electron.exe" | findstr /i electron.exe', { stdio: 'pipe' }); } catch { break; } }
    ({ child, browser, page } = await launch());
    await wait(2000);
    const persist = await ipcRead();
    check('C4-b 重启还原：truth 层 lang=python 持久', persist.id != null && persist.lang === 'python' && persist.hasX, JSON.stringify(persist).slice(0, 220));
    // 重启后导航进页（渲染层还原取证）
    await page.evaluate((pn) => {
      const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((e) => (e.textContent ?? '').includes(pn));
      if (row != null) row.click();
    }, PAGE_NAME);
    await wait(1500);
    const domBack = await page.evaluate(() => {
      const t = document.querySelector('[data-testid^="code-lang-tag-"]');
      return { text: t?.textContent ?? '', shown: t != null && t.offsetParent !== null };
    });
    check('C4-c 重启后渲染层 lang 标签还原', domBack.shown && domBack.text.toLowerCase().includes('python'), JSON.stringify(domBack));

    STEP = 'C2|wrap 开关（重启后测）';
    const body2 = page.locator('.pv-body .ProseMirror').first();
    await body2.click().catch(() => {});
    await wait(400);
    const wrapRes = await page.evaluate(async () => {
      // caret 进代码块：点 code 内容再走焦点链
      const cell = document.querySelector('pre [contenteditable], .sc-block--code, pre');
      if (cell != null) { const r = cell.getBoundingClientRect(); cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: r.x + 10, clientY: r.y + 10 })); cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }
      await new Promise((x) => setTimeout(x, 400));
      const w = document.querySelector('[data-testid^="codebar-wrap-"]');
      if (w == null) return { clicked: false, before: 'NO_WRAP_BTN' };
      const before = w.getAttribute('aria-pressed') ?? 'NONE';
      w.click();
      await new Promise((x) => setTimeout(x, 400));
      const after = (document.querySelector('[data-testid^="codebar-wrap-"]') ?? w).getAttribute('aria-pressed') ?? 'NONE';
      return { clicked: true, before, after };
    });
    check('C2-a 换行钮点击→aria-pressed 翻转', wrapRes.clicked === true && wrapRes.before === 'false' && wrapRes.after === 'true', JSON.stringify(wrapRes));

    STEP = 'C3|图片块拖拽柄（新页防污染）';
    await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
    await wait(900);
    await page.evaluate((pn) => { const i = document.querySelector('.app-side input'); if (i != null) { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i), 'value'); d.set.call(i, pn); i.dispatchEvent(new Event('input', { bubbles: true })); } }, PAGE_NAME + ' 图');
    await wait(200);
    await page.evaluate(() => { const i = document.querySelector('.app-side input'); i?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    await wait(1500);
    const body3 = page.locator('.pv-body .ProseMirror').first();
    await body3.click();
    await page.keyboard.type('/', { delay: 40 });
    await wait(600);
    const hasImg = (await page.locator('[data-testid="slash-item-image"]').count()) > 0;
    if (hasImg) {
      await page.evaluate(() => document.querySelector('[data-testid="slash-item-image"]')?.click());
      await wait(800);
      const handle = await page.evaluate(() => document.querySelector('[data-testid^="image-resize-handle-"]') != null);
      check('C3-a 图片块在场→拖拽柄 testid 挂上', handle, String(handle));
    } else {
      check('C3-a 图片块拖拽柄（斜杠无 image 项则显式失败）', false, 'slash-item-image 未找到');
    }
    await page.screenshot({ path: join(SHOTS, 'c3-image.png') }).catch(() => {});

    STEP = 'C5|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('C5-1 全流程后应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't77-results.json'), JSON.stringify({ task: 'T77-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T77-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 9) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 9（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exitCode = fail === 0 && assertions.length >= 9 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });
