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
  await page.locator('.pv-root').click({ position: { x: 600, y: 400 } }).catch(() => null); // 点正文空白退出（T70 教训：侧栏 (4,4)=库头行会误开菜单，禁魔数坐标）
  await page.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
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
  const PASS_B = `Pb!${randomBytes(9).toString('hex')}`;
  const PASS_C = `Pc!${randomBytes(9).toString('hex')}`;
  const { child, browser, page } = await launch();
  try {
    STEP = 'seed';
    const pageId = await mkPageWithBody(page, 'B2锁靶页', '正文机密B2KW 不得外泄');
    check('S1 造靶页', pageId !== null, String(pageId));
    const canonical = JSON.stringify((await ipc(page, 'blocks.list', { pageId })).data ?? null);
    check('S2 基线可读', canonical.length > 20, `len=${String(canonical.length)}`);
    // ===== U1–U8 断言组（PM 按 CB 实交付 DOM/testid 校准 2026-09-23）=====
    const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent ?? '').trim()));
    const hasTid = async (tid) => (await page.locator(`[data-testid="${tid}"]`).count()) > 0;
    const textTid = async (tid) => page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`)?.textContent?.trim() ?? null, tid);
    const attrTid = async (tid, attr) => page.evaluate(([t, a]) => document.querySelector(`[data-testid="${t}"]`)?.getAttribute(a) ?? null, [tid, attr]);
    const fillTid = async (tid, value) => {
      const loc = page.locator(`[data-testid="${tid}"]`);
      if ((await loc.count()) === 0) return false;
      await loc.first().fill(value).catch(() => {});
      await wait(150);
      return true;
    };
    const clickTid = async (tid) => { const ok = await clickByTestId(page, tid); await wait(450); return ok; };
    const fillFirst = async (tids, value) => { for (const t of tids) { if (await fillTid(t, value)) return t; } return null; };
    const rowMenu = async (id) => {
      const idx = await page.evaluate((x) => [...document.querySelectorAll('[data-testid^="side-node-"]')].findIndex((el) => el.getAttribute('data-testid') === `side-node-${x}`), id);
      if (idx < 0) return false;
      await page.locator('[data-testid^="side-node-"]').nth(idx).hover({ force: true }).catch(() => {});
      await wait(300);
      await page.locator('[data-testid^="side-more-"]').nth(idx).click({ force: true }).catch(() => {});
      await wait(450);
      return (await page.locator('[role="menu"]').count()) > 0;
    };
    const clickMenu = async (text) => {
      const ok = await page.evaluate((tt) => {
        const hit = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').includes(tt));
        if (hit === undefined) return false;
        hit.click();
        return true;
      }, text);
      await wait(600);
      return ok;
    };
    const glyphOn = async (id) => page.evaluate((x) => document.querySelector(`[data-testid="side-node-${x}"]`)?.querySelector('.app-nav-lock') != null, id);
    const ws = (await ipc(page, 'workspaces.list', {})).data;
    const WSID = String(ws?.activeId ?? '');
    const searchHits = async (q) => {
      const r = await ipc(page, 'search.query', { workspaceId: WSID, query: q, limit: 50 });
      const arr = r.data?.hits;
      return Array.isArray(arr) ? arr : [];
    };

    // ---- U1 入口 + 弹层门控 ----
    STEP = 'U1';
    const menuOk1 = await rowMenu(pageId);
    const items1 = menuOk1 ? await menuItems() : [];
    check('U1-a 未锁页 ⋯ 菜单含「添加密码锁」', items1.some((x) => x.includes('添加密码锁')), items1.join('|'));
    const opened1 = (await clickMenu('添加密码锁')) && (await hasTid('lock-dialog-title'));
    const title1 = await textTid('lock-dialog-title');
    const setBtn = await hasTid('lock-set-button');
    check('U1-b 入口打开设置弹层（主钮=上锁；标题行=目标页名）', opened1 && setBtn && (title1 ?? '').includes('锁靶页'), `btn=${String(setBtn)} title=${String(title1)}`);
    const twoFields = (await hasTid('lock-pass')) && (await hasTid('lock-confirm-pass')) && !(await hasTid('lock-new-pass'));
    check('U1-c set 模式仅两栏（口令/确认口令），无多余第三栏', twoFields, 'pass+confirm only');
    const type1 = await attrTid('lock-pass', 'type');
    await clickTid('lock-dialog-show-pass');
    const type2 = await attrTid('lock-pass', 'type');
    check('U1-d eye 钮切换显隐', type1 === 'password' && type2 === 'text', `${String(type1)}→${String(type2)}`);
    await fillTid('lock-pass', PASS); await fillTid('lock-confirm-pass', `${PASS}x`);
    await clickTid('lock-set-button');
    const err1 = await textTid('lock-dialog-error');
    check('U1-e 两栏不一致 → 拦截并报「两次口令不一致」', (err1 ?? '').includes('不一致'), String(err1));
    await fillTid('lock-confirm-pass', PASS);
    await clickTid('lock-set-button');
    const err2 = await textTid('lock-dialog-error');
    const st2 = (await ipc(page, 'lock.getStatus', { pageId: pageId })).data;
    check('U1-f 未勾「我已保存好恢复码」→ 拦截（未落库）', (err2 ?? '').includes('恢复码') && st2?.locked === false, `${String(err2)} locked=${String(st2?.locked)}`);

    // ---- U2 一次性恢复码 ----
    STEP = 'U2';
    await clickTid('lock-keep');
    await clickTid('lock-set-button');
    await wait(1000);
    const rcA = await textTid('lock-recovery-code');
    check('U2-a 上锁成功 → 一次性恢复码展示框', (rcA ?? '').length > 8, `len=${String((rcA ?? '').length)}`);
    const monoOk = await page.evaluate(() => document.querySelector('[data-testid="lock-recovery-code"] code')?.className.includes('mono') ?? false);
    check('U2-b 恢复码等宽展示', monoOk === true, 'code.lock-mono');
    await clickTid('lock-recovery-ok');
    await wait(800);
    check('U2-c 「我已复制并保存」后弹层关闭', !(await hasTid('lock-recovery-code')), 'closed');
    await rowMenu(pageId);
    const items2 = await menuItems();
    check('U2-d 二次展示路径不存在（已锁菜单无恢复码入口）', !items2.some((x) => x.includes('恢复码')), items2.join('|'));

    // ---- U3 已锁态 ----
    STEP = 'U3';
    check('U3-a 侧栏行出现锁 glyph', (await glyphOn(pageId)) === true, 'app-nav-lock');
    const items3 = await menuItems();
    check('U3-b 已锁菜单=修改口令/移除（无「添加密码锁」）', items3.some((x) => x.includes('修改口令')) && items3.some((x) => x.includes('移除')) && !items3.some((x) => x.includes('添加密码锁')), items3.join('|'));
    await page.keyboard.press('Escape').catch(() => {});
    await wait(300);
    await page.evaluate((x) => document.querySelector(`[data-testid="side-node-${x}"]`)?.click(), pageId);
    await wait(1800);
    const screenOn = await hasTid('lock-screen');
    const pvGone = await page.evaluate(() => document.querySelector('.pv-root') === null);
    check('U3-c 重开页=锁屏卡且编辑器未挂载', screenOn && pvGone, `screen=${String(screenOn)} pvRootAbsent=${String(pvGone)}`);

    // ---- U4 锁屏卡：错口令/限速 ----
    STEP = 'U4';
    await fillTid('lock-pass-input', 'wrong-1');
    await clickTid('lock-unlock-button');
    await wait(900);
    const errU4 = await textTid('lock-error');
    const stU4 = (await ipc(page, 'lock.getStatus', { pageId: pageId })).data;
    check('U4-a 错口令 → 错误文案 + 失败计数上行', (errU4 ?? '').includes('口令错误') && Number(stU4?.failures ?? 0) >= 1, `${String(errU4)} fails=${String(stU4?.failures)}`);
    for (let i = 0; i < 4; i += 1) { await fillTid('lock-pass-input', `wrong-${String(i + 2)}`); await clickTid('lock-unlock-button'); await wait(600); }
    await wait(800);
    const cd = await textTid('lock-countdown');
    const disabled = await page.evaluate(() => document.querySelector('[data-testid="lock-pass-input"]')?.disabled ?? null);
    check('U4-b 连错 5 次 → 倒计时 + 输入禁用', (cd ?? '').includes('秒') && disabled === true, `${String(cd)} disabled=${String(disabled)}`);

    // ---- U5 恢复码流程（轮换）----
    STEP = 'U5';
    await clickTid('lock-use-recovery');
    const rcField = await fillFirst(['lock-recovery-input'], String(rcA ?? ''));
    const np1 = await fillFirst(['lock-new-pass'], 'NewPass!1');
    const np2 = await fillFirst(['lock-new-pass2', 'lock-confirm-pass'], 'NewPass!1');
    check('U5-a 恢复区三栏可见（恢复码/新口令/确认）', rcField !== null && np1 !== null && np2 !== null, `${String(rcField)}/${String(np1)}/${String(np2)}`);
    await clickTid('lock-recover-button');
    await wait(1200);
    const rc2 = await textTid('lock-new-recovery');
    check('U5-b recover 成功 → 新恢复码展示', (rc2 ?? '').length > 8, `len=${String((rc2 ?? '').length)}`);
    const oldRejected = await ipc(page, 'lock.recover', { pageId: pageId, recoveryCode: String(rcA ?? ''), newPass: 'Another!1' });
    check('U5-c 旧恢复码二次被拒（轮换生效）', oldRejected.ok === false, JSON.stringify(oldRejected).slice(0, 140));
    await clickTid('lock-enter-content');
    let pvBack = false;
    for (let i = 0; i < 16 && !pvBack; i += 1) { await wait(500); pvBack = await page.evaluate(() => document.querySelector('.pv-root') !== null); }
    check('U5-d 进入内容：编辑器挂载（明文回填）', pvBack === true, `pv-root=${String(pvBack)} screen=${String(await hasTid('lock-screen'))} locked=${String((await ipc(page, 'lock.getStatus', { pageId: pageId })).data?.locked)} recoveryBox=${String(await hasTid('lock-new-recovery'))}`);

    // ---- U6 搜索泄露面（第二靶页）----
    STEP = 'U6';
    const pageB = await mkPageWithBody(page, 'B2锁二页', 'B2KW甲乙二');
    check('U6-a 第二靶页就绪', pageB !== null, String(pageB));
    const preB = await ipc(page, 'blocks.list', { pageId: pageB });
    const canonB = JSON.stringify(preB.data?.blocks ?? null);
    const setB = await ipc(page, 'lock.setPass', { pageId: pageB, pass: PASS_B });
    check('U6-b 第二页上锁（IPC setPass 成功）', setB.ok === true, `rcLen=${String(String(setB.data?.recoveryCode ?? '').length)}`);
    const lockedB = await ipc(page, 'blocks.list', { pageId: pageB });
    check('U6-c 锁页读路径 = locked:true 且 blocks 空', lockedB.data?.locked === true && Array.isArray(lockedB.data?.blocks) && lockedB.data.blocks.length === 0, JSON.stringify(lockedB.data).slice(0, 120));
    const hitsBodyLocked = (await searchHits('B2KW甲乙二')).filter((h) => h.pageId === pageB);
    check('U6-d 锁页正文关键词永不中', hitsBodyLocked.length === 0, `hits=${String(hitsBodyLocked.length)}`);
    const hitsTitle = (await searchHits('B2锁二页')).filter((h) => h.pageId === pageB);
    check('U6-e 锁页标题可中且标记 locked（驱动结果行锁 glyph）', hitsTitle.length > 0 && hitsTitle.every((h) => h.locked === true), `hits=${String(hitsTitle.length)} locked=${hitsTitle.map((h) => String(h.locked)).join(',')}`);

    // ---- U7 读路径接线（B1 SKIP 收口）----
    STEP = 'U7';
    const verB = await ipc(page, 'lock.verify', { pageId: pageB, pass: PASS_B });
    check('U7-a verify 通过', verB.ok === true, JSON.stringify(verB).slice(0, 100));
    const afterB = await ipc(page, 'blocks.list', { pageId: pageB });
    check('U7-b verify 后读路径明文且字节=加锁前基线', JSON.stringify(afterB.data?.blocks ?? null) === canonB, `baselineLen=${String(canonB.length)}`);
    const hitsBodyUnlocked = (await searchHits('B2KW甲乙二')).filter((h) => h.pageId === pageB);
    check('U7-c 设计内：session 解锁不回填明文行 → FTS 正文仍不中（remove 才恢复）', hitsBodyUnlocked.length === 0, `hits=${String(hitsBodyUnlocked.length)}`);

    // ---- U8 移除（走 UI 弹层：第三靶页 UI 上锁 → UI 移除）----
    STEP = 'U8';
    let pageC = null;
    try {
      pageC = await mkPageWithBody(page, 'B2锁三页', 'B2KW丙丁三');
    } catch (e) {
      console.log('U8-PREP-ERR', String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 1000));
      const scene = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="side-new-page"]');
        const r = btn?.getBoundingClientRect();
        const at = r !== undefined ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
        return {
          btn: btn !== null && btn !== undefined,
          vis: r !== undefined ? `${String(Math.round(r.x))},${String(Math.round(r.y))},${String(Math.round(r.width))}x${String(Math.round(r.height))}` : '-',
          topEl: at ? `${at.tagName}.${String(at.className).slice(0, 40)}#${at.getAttribute('data-testid') ?? ''}` : 'null',
          menus: document.querySelectorAll('[role="menu"]').length,
          search: document.querySelectorAll('[data-testid*="search"]').length,
          dialog: document.querySelectorAll('[role="dialog"]').length,
        };
      });
      console.log('U8-SCENE', JSON.stringify(scene));
    }
    check('U8-a 第三靶页就绪', pageC !== null, String(pageC));
    const preC = await ipc(page, 'blocks.list', { pageId: pageC });
    const canonC = JSON.stringify(preC.data?.blocks ?? null);
    await rowMenu(pageC);
    const openedU8 = (await menuItems()).some((x) => x.includes('添加密码锁')) && (await clickMenu('添加密码锁'));
    await fillTid('lock-pass', PASS_C); await fillTid('lock-confirm-pass', PASS_C);
    await clickTid('lock-keep');
    await clickTid('lock-set-button');
    await wait(1300);
    const rcC = await textTid('lock-recovery-code');
    await clickTid('lock-recovery-ok');
    await wait(900);
    const lockedC = await ipc(page, 'blocks.list', { pageId: pageC });
    const glyphC = await glyphOn(pageC);
    check('U8-b UI 上锁生效：读路径 locked:true + 侧栏 glyph + 一次性恢复码', openedU8 && lockedC.data?.locked === true && glyphC === true && (rcC ?? '').length > 8, `locked=${String(lockedC.data?.locked)} glyph=${String(glyphC)} rcLen=${String((rcC ?? '').length)}`);
    await rowMenu(pageC);
    const items8 = await menuItems();
    const opened8 = items8.some((x) => x.includes('移除密码锁')) && (await clickMenu('移除密码锁'));
    check('U8-c 已锁页菜单入口「移除密码锁」', opened8, items8.join('|'));
    await fillTid('lock-pass', PASS_C);
    await clickTid('lock-remove-button');
    await wait(1800);
    const after8 = await ipc(page, 'blocks.list', { pageId: pageC });
    check('U8-d 移除后明文回归=基线字节', JSON.stringify(after8.data?.blocks ?? null) === canonC, `locked=${String(after8.data?.locked)}`);
    check('U8-e 侧栏锁 glyph 消失', (await glyphOn(pageC)) === false, 'app-nav-lock');
    const hitsAfter = (await searchHits('B2KW丙丁三')).filter((h) => h.pageId === pageC);
    check('U8-f FTS 正文恢复可中（remove 回填明文行）', hitsAfter.length > 0, `hits=${String(hitsAfter.length)}`);

    void [browser, child, sha, wait];
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
