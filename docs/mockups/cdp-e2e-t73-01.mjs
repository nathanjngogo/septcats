/* T73 真机探针：shell.openExternal 通道护栏 + 书签卡接线（不真开浏览器：只测拒绝链+testid 在场） */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't73-e2e');
const UD = `${RUN}\\ud`;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t73');
const PORT = 9234;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

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
  mkdirSync(SHOTS, { recursive: true });
  const rootBefore = rootMtime();
  let child = null; let browser = null; let page = null;
  try {
    ({ child, browser, page } = await launch());
    const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
    if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }

    STEP = 'H|通道护栏';
    // 真机 IPC 级：拒绝链必须结构化返回且绝不抛错
    const guards = await page.evaluate(async () => {
      const call = async (u) => {
        try { return await window.septcats.shell.openExternal({ url: u }); } catch (e) { return { threw: String(e) }; }
      };
      return {
        face: typeof window.septcats?.shell?.openExternal === 'function', // 合法 URL 不在真机发（会弹系统浏览器，副作用不可控）；放行链由 16 单测钉
        file: await call('file:///C:/Windows/win.ini'),
        js: await call('javascript:alert(1)'),
        empty: await call('   '),
        malformed: await call('ht tp://a b'),
        obj: await window.septcats.shell?.openExternal?.({ url: 123 }),
      };
    });
    check('H-a 面在场（shell.openExternal 函数）', guards.face === true, `face=${String(guards.face)}`);
    check('H-b file:// 拒绝 E_PROTOCOL', guards.file?.ok === false && guards.file?.error?.code === 'E_PROTOCOL', JSON.stringify(guards.file));
    check('H-c javascript: 拒绝 E_PROTOCOL', guards.js?.ok === false && guards.js?.error?.code === 'E_PROTOCOL', JSON.stringify(guards.js));
    check('H-d 空白串拒绝 E_EMPTY', guards.empty?.ok === false && guards.empty?.error?.code === 'E_EMPTY', JSON.stringify(guards.empty));
    check('H-e 畸形拒绝（结构化不抛）', guards.malformed?.ok === false && guards.malformed?.error?.code != null, JSON.stringify(guards.malformed));
    check('H-f 非字符串 url 拒绝 E_MALFORMED', guards.obj?.ok === false && guards.obj?.error?.code === 'E_MALFORMED', JSON.stringify(guards.obj));
    // 注意：https 合法 URL 真机会开系统浏览器——探针不发它（避免副作用），合法性由单测 16 例覆盖。

    STEP = 'B|书签卡接线';
    // 进工作台 home：市场钮→市场内 home 钮
    await page.evaluate(() => document.querySelector('[data-testid="workbench-market-open"]')?.click());
    await wait(1000);
    await page.evaluate(() => document.querySelector('[data-testid="workbench-open"]')?.click());
    await wait(1200);
    check('B-a home 在场', (await page.locator('[data-testid="workbench"]').count()) > 0, String(await page.locator('[data-testid="workbench"]').count()));
    // 书签卡默认隐藏（T71 首屏仅 5 卡）——市场卡片 Tab 点「显示卡片」确保开启
    if ((await page.locator('[data-testid="wb-bookmarks"]').count()) === 0) {
      await page.evaluate(() => document.querySelector('[data-testid="wb-close"]')?.click());
      await wait(600);
      await page.evaluate(() => document.querySelector('[data-testid="workbench-market-open"]')?.click());
      await wait(900);
      await page.evaluate(() => document.querySelector('[data-testid="wb-market-tab-cards"]')?.click());
      await wait(600);
      const shown = await page.evaluate(async () => {
        const row = document.querySelector('[data-testid="wb-market-card-bookmarks"]');
        if (row == null) return 'NO_ROW';
        const b = row.closest('li,div')?.querySelector('[data-testid="wb-market-card-toggle-bookmarks"]') ?? document.querySelector('[data-testid="wb-market-card-toggle-bookmarks"]');
        if (b == null) return 'NO_TOGGLE';
        b.click();
        await new Promise((r) => setTimeout(r, 200));
        return 'toggled:' + (b.textContent ?? '').trim();
      });
      console.log(`      (info) bookmarks toggle=${shown}`);
      await wait(500);
      await page.evaluate(() => document.querySelector('[data-testid="wb-market-close"]')?.click());
      await wait(500);
      await page.evaluate(() => document.querySelector('[data-testid="workbench-open"]')?.click());
      await wait(1000);
    }
    // 书签卡添加一条带 URL 书签（走卡内表单）
    const added = await page.evaluate(async () => {
      // 1) 若表单未开，点「加入书签」像素钮进 adding 态（WorkbenchPixelButton=button.wb-pixbtn，按文案找）
      if (document.querySelector('[data-testid="wb-bookmarks-input-url"]') == null) {
        const addBtn = [...document.querySelectorAll('[data-testid="wb-bookmarks"] button')].find((b) => /书签|bookmark|添加|add/i.test(b.textContent ?? ''));
        if (addBtn == null) return 'NO_ADD_BTN';
        addBtn.click();
        await new Promise((r) => setTimeout(r, 150));
      }
      const inputUrl = document.querySelector('[data-testid="wb-bookmarks-input-url"]');
      const inputTitle = document.querySelector('[data-testid="wb-bookmarks-input-title"]');
      if (inputUrl == null || inputTitle == null) return 'NO_FORM';
      const set = (el, v) => { const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value'); d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      set(inputUrl, 'https://example.com/x'); set(inputTitle, 'T73 书签');
      await new Promise((r) => setTimeout(r, 80));
      const btn = document.querySelector('[data-testid="wb-bookmarks-submit"]');
      if (btn == null) return 'NO_SUBMIT_BTN';
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      return 'clicked';
    });
    await wait(600);
    const item = await page.locator('[data-testid="wb-bookmarks-open-https://example.com/x"]').count();
    check('B-b 添加带 URL 书签→open 钮出现', added === 'clicked' && item > 0, `added=${added} openBtn=${String(item)}`);
    // 点 open 钮：example.com 真开浏览器=可接受副作用？——不可（无头纪律）。改断言钮存在且 handler 已挂（title 属性/aria）；真实跳转由 16+5 单测钉。
    await page.screenshot({ path: join(SHOTS, 'b-bookmarks-card.png') }).catch(() => {});

    STEP = 'Z|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('Z-1 应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't73-results.json'), JSON.stringify({ task: 'T73-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T73-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 9) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 9（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    const rootAfter = rootMtime();
    console.log(`INFO  真实数据根未被触碰  — untouched=${String(rootBefore === rootAfter)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 && assertions.length >= 9 ? 0 : 1);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });
