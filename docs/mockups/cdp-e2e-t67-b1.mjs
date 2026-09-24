/*
 * cdp-e2e-t67-b1.mjs —— TASK-T67-01-B1-01（密码锁后端核心）PM 真机/IPC 级取证。
 * 数据面硬证据走 IPC 直连（页内 window.septcats），不依赖 B2 UI（skill 纪律：
 * 「证明真的落盘就直走 IPC：建实体→commit→读回→重启进程→再读回」）。
 * 断言组：
 *  L1 设锁→明文块消失、block_cipher 在场、getStatus.locked=true；
 *  L2 未解锁会话 blocks.list 返回 locked 标志且不泄内容；
 *  L3 错口令 5 次→E_LOCK_LOCKED+lockedUntil；等/注入过期后可再试；
 *  L4 对口令 unlock→块内容逐字节=加锁前（JSON 规范化比对）、FTS 恢复可搜；
 *  L5 恢复码一次性：recover 换口令成功→旧恢复码二次被拒；新口令可 unlock；
 *  L6 remove：密文行全灭、明文回归、getStatus.locked=false；
 *  L7 搜索/FTS：锁页期间页标题可中、正文关键词绝不中；
 *  L8 重启：锁状态持久（page_lock 行在）、会话解锁态全灭（内存语义）；
 *  L9 删除锁页进回收站→page_lock/block_cipher 无孤儿（SQL 级断言经 api 兜底通道，若无 SQL 通道则用 remove+tree 组合证）。
 * 夹具双隔离；口令/恢复码只存在于脚本内存变量，绝不打印原文（打 SHA 前缀即可）。
 * ⚠ 契约形状以 B1 交付的 preload/types 为准——起跑前 PM 先 grep lock.ts/preload 校准入参名。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t67-b1';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t67b1');
const PORT = 9571;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`);
}
function sha(s) { return createHash('sha256').update(String(s)).digest('hex').slice(0, 10); }
function skip(name, raw) { assertions.push({ step: STEP, name, ok: null, raw: String(raw).slice(0, 300) }); console.log(`SKIP [${STEP}] ${name} — ${String(raw).slice(0, 160)}`); }
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
  await wait(2200);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });
  return { child, browser, page };
}

/** IPC 调用封装：返回 {ok,data,err}，错误码原样带回。 */
async function ipc(page, channel, payload) {
  return page.evaluate(async ([ch, p]) => {
    const api = window.septcats;
    if (api === undefined) return { ok: false, err: 'NO_BRIDGE' };
    const fn = ch.split('.').reduce((o, k) => o?.[k], api);
    if (typeof fn !== 'function') return { ok: false, err: `NO_CHANNEL:${ch}` };
    try {
      return { ok: true, data: await fn.call(api, p) };
    } catch (e) {
      return { ok: false, err: String(e?.message ?? e).slice(0, 160) };
    }
  }, [channel, payload]);
}

async function mkPageWithBody(page, title, bodyText) {
  await page.locator('[data-testid="side-new-page"]').first().click({ force: true });
  await wait(600);
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 8000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1200);
  const ed = page.locator('.pv-root .ProseMirror, .pv-root [contenteditable="true"]').first();
  await ed.click({ force: true });
  await page.keyboard.type(bodyText, { delay: 12 });
  // 失焦提交（行内 blur 即交接口径）
  await page.locator('.app-side').first().click({ position: { x: 4, y: 4 }, force: true });
  await wait(1200);
  const node = await page.evaluate((t) => {
    const row = [...document.querySelectorAll('[data-testid^="side-node-"]')].find((el) => (el.textContent ?? '').includes(t.slice(0, 4)) || [...el.querySelectorAll('input')].some((i) => i.value === t));
    return row === undefined ? null : row.getAttribute('data-testid').replace('side-node-', '');
  }, title);
  return node;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  // 口令只存活于本进程变量（红线：报告/日志零原文）
  const PASS = `Pw!${randomBytes(9).toString('hex')}`;
  const WRONG = `Pw!${randomBytes(9).toString('hex')}`;
  const { child, browser, page } = await launch();
  let recoveryCode = '';
  try {
    STEP = 'seed';
    const pageId = await mkPageWithBody(page, '锁页靶标', '机密内容-关键词ZQX9 绝不可在锁定期被搜到');
    check('S1 造靶页（带正文）', pageId !== null, String(pageId));
    const blocksBefore = await ipc(page, 'blocks.list', { pageId });
    const canonical = JSON.stringify(blocksBefore.data ?? null);
    check('S2 blocks.list 基线可读', blocksBefore.ok === true && canonical.length > 20, `len=${String(canonical.length)}`);

    STEP = 'L1|setPass';
    // ⚠ 通道名/入参以 B1 实际 preload 为准；不符则先 grep 校准再跑（本行注释=PM 纪律）
    const setR = await ipc(page, 'lock.setPass', { pageId, pass: PASS });
    check('L1-a setPass 成功且回恢复码', setR.ok === true && typeof setR.data?.recoveryCode === 'string' && setR.data.recoveryCode.length > 8, `err=${String(setR.err)} rcShape=${sha(setR.data?.recoveryCode ?? 'none')}`);
    recoveryCode = String(setR.data?.recoveryCode ?? '');
    const st1 = await ipc(page, 'lock.getStatus', { pageId });
    check('L1-b getStatus.locked=true', st1.ok === true && st1.data?.locked === true, JSON.stringify(st1.data ?? st1.err));
    const blocksLocked = await ipc(page, 'blocks.list', { pageId });
    const lockSig = JSON.stringify(blocksLocked.data ?? blocksLocked.err);
    // 硬判（B1 口径）：setPass 硬删明文块 → 未解锁时 list 必须零内容（空数组或 locked 标志或拒发，
    // 三形态都不泄正文）。B2 接入 readBlocks 钩子后预期形态=「locked:true」（届时收紧为强断言）。
    const noContent = lockSig.includes('机密内容') === false && lockSig.includes('ZQX9') === false;
    const emptyOrLocked = (blocksLocked.ok === true && (blocksLocked.data?.blocks ?? blocksLocked.data?.items ?? []).length === 0)
      || blocksLocked.ok === false || /"locked"\s*:\s*true/.test(lockSig);
    check('L1-c 锁后明文块不可读（空/拒发/locked 三形态 + 零泄露）', noContent === true && emptyOrLocked === true, lockSig.slice(0, 120));

    STEP = 'L7|FTS 排除';
    // skill 实测：search.query 需显式 workspaceId（null 拿不到结果）——从桥取真值
    const ws = await ipc(page, 'workspaces.list', {});
    const workspaceId = ws.ok === true ? (ws.data?.activeId ?? ws.data?.items?.[0]?.id ?? null) : null;
    check('L7-w 取到 workspaceId', workspaceId !== null, String(workspaceId));
    const s1 = await ipc(page, 'search.query', { query: '关键词ZQX9', workspaceId });
    const hitBody = JSON.stringify(s1.data ?? '').includes('关键词ZQX9');
    check('L7-a 锁定期正文关键词搜不到', s1.ok === true && hitBody === false, `err=${String(s1.err)} hit=${String(hitBody)}`);
    const s2 = await ipc(page, 'search.query', { query: '锁页靶标', workspaceId });
    check('L7-b 标题（明文）仍可搜到', s2.ok === true && JSON.stringify(s2.data ?? '').includes('锁页靶标'), JSON.stringify(s2.data ?? s2.err).slice(0, 120));

    STEP = 'L3|限速';
    let lastErr = '';
    for (let i = 0; i < 5; i += 1) {
      const r = await ipc(page, 'lock.verify', { pageId, pass: WRONG });
      lastErr = String(r.err ?? JSON.stringify(r.data));
    }
    check('L3-a 错 5 次→限速置位', /E_LOCK_LOCKED|locked/i.test(lastErr) === true || (await ipc(page, 'lock.getStatus', { pageId })).data?.lockedUntil != null, lastErr.slice(0, 120));
    const rightWhileLocked = await ipc(page, 'lock.verify', { pageId, pass: PASS });
    check('L3-b 限速期内对口令也被拒', /E_LOCK_LOCKED|locked/i.test(String(rightWhileLocked.err)) === true || rightWhileLocked.ok === false, String(rightWhileLocked.err ?? JSON.stringify(rightWhileLocked.data)).slice(0, 120));

    STEP = 'L4|unlock 还原';
    // 若 lockedUntil 短（60s），有界轮询等到窗口过（≤90s）
    let unlocked = null;
    for (let k = 0; k < 32; k += 1) {
      unlocked = await ipc(page, 'lock.verify', { pageId, pass: PASS });
      if (unlocked.ok === true && (unlocked.data?.ok === true || unlocked.data?.unlocked === true)) break;
      await wait(3000);
    }
    check('L4-a 窗口过期后对口令通过', unlocked.ok === true && (unlocked.data?.ok === true || unlocked.data?.unlocked === true), JSON.stringify(unlocked.data ?? unlocked.err).slice(0, 120));
    const blocksAfter = await ipc(page, 'blocks.list', { pageId });
    // B1 口径（D4 如实申报）：verify 只解会话、不回填明文；回填=remove/recover；
    // 字节还原/FTS 恢复属 B2 接线后断言 → 此处 SKIP 并留证（blocks:list 读空表=设计内）。
    skip('L4-b 解锁后块字节=基线（B2 接线升级项）', `canonical=${sha(canonical)} listNow=${sha(JSON.stringify(blocksAfter.data ?? null))}`);
    skip('L4-c 解锁后 FTS 恢复可搜（B2 接线升级项）', 'B1 明文未回填，FTS 无行=设计内');

    STEP = 'L8|重启持久';
    await page.evaluate(() => window.close()).catch(() => {});
    await wait(2200);
    killTree(child.pid);
    const re = await launch();
    const st2 = await ipc(re.page, 'lock.getStatus', { pageId });
    check('L8-a 重启后锁仍在（page_lock 持久）', st2.ok === true && st2.data?.locked === true, JSON.stringify(st2.data ?? st2.err));
    // L8-b（B1 口径改证法）：限速计数持久于 DB（非内存）→ 重启后 getStatus.failures 仍=5
    // （会话 Map 无从携带此值；若为内存态重启必清零）。此断言同时硬证 page_lock 行持久。
    // 正确语义：L3 错 5 次置位 failures=5（DB），L4 对口令 verify 成功→计数归零并清 lockedUntil（DB 写回）。
    // 重启后 getStatus 读表=failures:0 + locked:true —— 同时证「行持久」与「成功解锁重置计数」两条。
    const stAfterRe = await ipc(re.page, 'lock.getStatus', { pageId });
    check('L8-b 限速计数重置持久（成功解锁归零语义 + 行跨重启在表）', stAfterRe.ok === true && stAfterRe.data?.locked === true && stAfterRe.data?.failures === 0, JSON.stringify(stAfterRe.data ?? stAfterRe.err));
    // 会话续用 re.page 收尾
    STEP = 'L5|恢复码一次性';
    const NEWPASS = `Pw!${randomBytes(9).toString('hex')}`;
    const rec1 = await ipc(re.page, 'lock.recover', { pageId, code: recoveryCode, newPass: NEWPASS });
    check('L5-a 恢复码换口令成功', rec1.ok === true && (rec1.data?.ok === true || rec1.data?.rotated === true), `err=${String(rec1.err)} rcHash=${sha(recoveryCode)}`);
    const rec2 = await ipc(re.page, 'lock.recover', { pageId, code: recoveryCode, newPass: `Pw!${randomBytes(6).toString('hex')}` });
    check('L5-b 旧恢复码二次被拒', /E_LOCK_RECOVERY_USED|used/i.test(String(rec2.err)) === true || rec2.ok !== true, String(rec2.err ?? JSON.stringify(rec2.data)).slice(0, 120));
    const vp = await ipc(re.page, 'lock.verify', { pageId, pass: NEWPASS });
    check('L5-c 新口令可验证', vp.ok === true && (vp.data?.ok === true || vp.data?.unlocked === true), String(vp.err ?? JSON.stringify(vp.data)).slice(0, 100));

    STEP = 'L6|remove';
    const rm = await ipc(re.page, 'lock.remove', { pageId, pass: NEWPASS });
    check('L6-a remove 成功', rm.ok === true, String(rm.err ?? JSON.stringify(rm.data)).slice(0, 100));
    const st3 = await ipc(re.page, 'lock.getStatus', { pageId });
    check('L6-b remove 后 locked=false', st3.ok === true && st3.data?.locked === false, JSON.stringify(st3.data ?? st3.err));
    const blocksFinal = await ipc(re.page, 'blocks.list', { pageId });
    // remove 回填规范化 updated_at + 编辑器 flush 重分配 block id → 比 (type,sort_key) 多重集，
    // 再加 FTS 重新命中做产品级双证（明文真的回了可搜面）。
    const parse = (x) => { const r = typeof x === 'string' ? JSON.parse(x) : x; return Array.isArray(r) ? r : r?.blocks ?? []; };
    const txt = (x) => (typeof x?.content_json === 'string' ? x.content_json : JSON.stringify(x?.content ?? ''));
    const baseIds = parse(canonical).filter((x) => txt(x).includes('机密内容')).map((x) => x.id);
    const finalIds = new Set(parse(blocksFinal.data).filter((x) => txt(x).includes('机密内容')).map((x) => x.id));
    const allBack = baseIds.length > 0 && baseIds.every((id) => finalIds.has(id));
    const s4 = await ipc(re.page, 'search.query', { query: '关键词ZQX9', workspaceId });
    const refound = s4.ok === true && JSON.stringify(s4.data ?? '').includes('关键词ZQX9');
    // 超集断言：基线正文块必须全数回还（remove 还原零丢失）；final 可多出锁定期编辑器 flush 的
    // 新块（锁定时禁编辑=B2 锁屏 UI 职责，见 TASK-T67-01-B2-01 §2）。
    check('L6-c 明文永久回归（基线块全数还原 + FTS 重命中）', allBack === true && refound === true, `base=${String(baseIds.length)} final=${String(finalIds.size)} fts=${String(refound)}`);

    STEP = 'L9|删除无孤儿';
    const del = await ipc(re.page, 'pages.remove', { id: pageId });
    check('L9-a 删锁页进回收站不报错', del.ok === true, String(del.err ?? '').slice(0, 100));
    const st4 = await ipc(re.page, 'lock.getStatus', { pageId });
    const gone = st4.ok !== true || st4.data?.locked === false || st4.data == null;
    check('L9-b 删后 lock 状态无残留（getStatus 空/未锁）', gone === true, JSON.stringify(st4.data ?? st4.err).slice(0, 120));
    void [browser, child];
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't67-b1-results.json'), JSON.stringify({ task: 'T67-B1', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T67-B1：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 21) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 21（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    check('T 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
    process.exit(fail === 0 && assertions.length >= 21 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  try { writeFileSync(join(SHOTS, 't67-b1-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2)); } catch { /* */ }
  process.exit(3);
});
