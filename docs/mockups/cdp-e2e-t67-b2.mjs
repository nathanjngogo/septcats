/*
 * cdp-e2e-t67-b2.mjs —— TASK-T67-01-B2-01（密码锁前端）PM 真机取证。
 * ⚠ 选择器以 CB 交付后的真实 DOM 为准校准（本骨架断言组=任务书 §测试 的机器化口径）。
 * U1 入口：未锁页侧栏行 ⋯ 出「添加密码锁」；加锁 Dialog=口令两栏+必勾+eye 切换；
 *    两栏不一致→拦截（不发起 setPass）；勾未选→确认钮禁用。
 * U2 恢复码展示框：setPass 成功后必弹、等宽、无「我已抄写」不能关；关后再开画廊无第二次展示路径。
 * U3 已锁态：侧栏行锁 glyph；⋯ 菜单出「修改口令/移除」；重开页=锁屏卡（ProseMirror 不 mount：无 .pv-root）。
 * U4 锁屏卡：错口令→失败文案+剩余次数；连错 5 次→倒计时禁用；对口令→真内容渲染、可编辑、commit 正常。
 * U5 恢复码流：折叠区输入恢复码+新口令→recover→新恢复码再展示→旧码二次被拒。
 * U6 搜索：锁页标题可中（结果行带锁 glyph）、正文关键词永不中；解锁后正文恢复可中（L4-c 真机升级断言）。
 * U7 B1 SKIP 项收口：verify 后 blocks:list 出明文且字节=加锁前（读路径接线真机实证）。
 * U8 remove：口令验证→明文永久回归、锁 glyph 消失、FTS 恢复。
 * 夹具双隔离；口令/恢复码零原文（只 SHA）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t67-b2';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t67b2');
const PORT = 9572;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 260) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
}
function sha(s) { return createHash('sha256').update(String(s)).digest('hex').slice(0, 10); }
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}
async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2500);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });
  return { child, browser, page };
}
async function ipc(page, channel, payload) {
  return page.evaluate(async ([ch, p]) => {
    const api = window.septcats;
    if (api === undefined) return { ok: false, err: 'NO_BRIDGE' };
    const fn = ch.split('.').reduce((o, k) => o?.[k], api);
    if (typeof fn !== 'function') return { ok: false, err: `NO_CHANNEL:${ch}` };
    try { return { ok: true, data: await fn.call(api, p) }; } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 160) }; }
  }, [channel, payload]);
}
async function mkPageWithBody(page, title, bodyText) {
  await page.locator('[data-testid="side-new-page"]').first().click();
  await wait(600);
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 8000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1200);
  const ed = page.locator('.pv-root .ProseMirror, .pv-root [contenteditable="true"]').first();
  await ed.click();
  await page.keyboard.type(bodyText, { delay: 12 });
  await page.locator('.app-side').first().click({ position: { x: 4, y: 4 } });
  await wait(1200);
  return page.evaluate((t) => {
    const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((el) => (el.textContent ?? '').includes(t.slice(0, 4)));
    return row === undefined ? null : row.getAttribute('data-testid').replace('side-node-', '');
  }, title);
}
// 页内原生 click（skill 纪律：Playwright force click 可能不触发 React onClick）
async function clickByTestId(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(`[data-testid="${s}"]`) ?? document.querySelector(s);
    if (el === null) return false;
    el.click();
    return true;
  }, sel);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  const PASS = `Pw!${randomBytes(9).toString('hex')}`;
  const { child, browser, page } = await launch();
  try {
    STEP = 'seed';
    const pageId = await mkPageWithBody(page, 'B2锁靶页', '正文机密B2KW 不得外泄');
    check('S1 造靶页', pageId !== null, String(pageId));
    const canonical = JSON.stringify((await ipc(page, 'blocks.list', { pageId })).data ?? null);
    check('S2 基线可读', canonical.length > 20, `len=${String(canonical.length)}`);
    // ⚠⚠ 以下 U1–U8 断言组按任务书展开；CB 交付后由 PM 按真实 testid/文案逐组校准填入。
    // 骨架占位：交付未完成时此探针直接 FAIL 退出（禁假绿）。
    check('X0 B2 交付就绪（testid 校准后删除本行）', false, 'skeleton');
    void [browser, child, PASS, sha, clickByTestId, wait];
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't67-b2-results.json'), JSON.stringify({ task: 'T67-B2', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T67-B2：${pass} PASS / ${fail} FAIL =====`);
    check('T 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  process.exit(3);
});
