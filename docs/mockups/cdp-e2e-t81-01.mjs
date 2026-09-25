/* T81-01 真机探针（墓碑物理清除 db 面 GC）
 * 链：P0 造三类页（存活 / 回收站软删 / 彻底删除死引用）→ P1 设置页预览 →
 *     P2 取消=零写入 → P3 确认=真删（只删放行的：purge 页走人，软删页按 retention 扣留）
 *     → P4 重启后仍生效（真落盘）→ P5 真实根零触碰。
 * 桥面（读实现真契约）：window.septcats.dbgc.preview() / dbgc.run()（无参）；
 *     设置页 testid：settings-dbgc-preview / -preview-panel / -meta / -held / -retention / -cancel / -confirm / -done。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <12 = FATAL（静默蒸发守卫）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't81-01-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t81-01');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9250;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
// 模式：--packed=打 dist/win-unpacked EXE（rc 终验，证「打的是本轮产物」）；默认=打 main 树 out/
const PACKED = process.argv.includes('--packed');
const WIN_UNPACKED = join(APPDIR, 'dist', 'win-unpacked');
const LAUNCH_EXE = PACKED ? join(WIN_UNPACKED, 'Septcats.exe') : ELECTRON;
const LAUNCH_CWD = PACKED ? WIN_UNPACKED : APPDIR;
const LAUNCH_FIXED = PACKED ? [] : ['.'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  try {
    const img = PACKED ? 'Septcats.exe' : 'electron.exe';
    const out = execSync(`wmic process where "name='${img}'" get processid,commandline /format:list`, { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes('t81-01-e2e')) killTree(Number(m[1])); cur = ''; }
    }
  } catch { /* wmic 缺失 */ }
}
async function poll(fn, pred, ms, every = 600) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (pred(v)) return { ok: true, v, waited: Date.now() - t0 }; if (Date.now() - t0 > ms) return { ok: false, v, waited: Date.now() - t0 }; await wait(every); }
}
async function launch() {
  const child = spawn(LAUNCH_EXE, [...LAUNCH_FIXED, `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: LAUNCH_CWD, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function gracefulExit(page, child) {
  try { await page.evaluate(() => window.close()); } catch { /* */ }
  for (let i = 0; i < 12; i += 1) { await wait(500); try { execSync(`tasklist /FI "PID eq ${String(child.pid)}" /NH | findstr ${String(child.pid)}`, { stdio: 'ignore' }); } catch { return; } }
  killTree(child.pid);
}

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

const createPage = (pg, title) => pg.evaluate(async (t) => {
  const created = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: created.id, title: t });
  return created.id;
}, title);
const nodesMatching = (pg, mark) => pg.evaluate(async (m) => {
  const w = await window.septcats.workspaces.list({});
  const t = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id ?? null });
  return (t ?? []).filter((n) => String(n.title ?? '').includes(m)).map((n) => ({ id: n.id, alive: n.alive, deletedAt: n.deletedAt ?? null }));
}, mark);
const domHas = (page, sel) => page.evaluate((s) => document.querySelector(s) !== null, sel);
const domText = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent ?? '').trim(), sel);
const clickTestId = (page, tid) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="${id}"]`); b?.click(); return Boolean(b); }, tid);
const openSettings = (page) => page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));

async function main() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  for (const d of [UD, ROOT, SHOTS]) mkdirSync(d, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const stampBefore = realRootStamp();
  let { child, browser, page } = await launch();
  const TS = Date.now().toString(36);
  const MARK = `T81GC${TS}`;
  try {
    STEP = 'P0|夹具';
    const keepId = await createPage(page, `${MARK}-存活`);
    const softId = await createPage(page, `${MARK}-回收站`);
    const purgeId = await createPage(page, `${MARK}-彻底删`);
    await page.evaluate(async (i) => { await window.septcats.pages.remove({ id: i }); }, softId);
    await page.evaluate(async (i) => { await window.septcats.pages.remove({ id: i }); }, purgeId);
    await page.evaluate(async (i) => { await window.septcats.pages.purge({ id: i }); }, purgeId);
    await wait(1000);
    const seeded = await nodesMatching(page, MARK);
    check('P0-1 三类页就位（存活/回收站 deletedAt>0/彻底删 deletedAt=0）',
      seeded.length === 3 && seeded.some((n) => n.id === keepId && n.alive === 1)
      && seeded.some((n) => n.id === softId && n.alive === 0 && Number(n.deletedAt) > 0)
      && seeded.some((n) => n.id === purgeId && n.alive === 0 && Number(n.deletedAt) === 0),
      JSON.stringify(seeded));

    STEP = 'P1|预览';
    await openSettings(page);
    const hasBtn = await poll(() => domHas(page, '[data-testid="settings-dbgc-preview"]'), (v) => v === true, 8000);
    check('P1-1 设置页「清理已删除内容」预览按钮在场', hasBtn.ok, String(hasBtn.ok));
    await clickTestId(page, 'settings-dbgc-preview');
    const panel = await poll(() => domHas(page, '[data-testid="settings-dbgc-preview-panel"]'), (v) => v === true, 8000);
    check('P1-2 点预览出预览面板', panel.ok, String(panel.ok));
    const meta = await domText(page, '[data-testid="settings-dbgc-meta"]');
    const held = await domText(page, '[data-testid="settings-dbgc-held"]');
    const ret = await domText(page, '[data-testid="settings-dbgc-retention"]');
    // 面板 meta=「放行可删」条数（不是候选总数）；扣留条数在 held 行——两处分开断言
    check('P1-3 预览放行条数 = 1（仅彻底删页；软删页被扣留）', /页面\s*1\s*个/.test(meta), `meta=${meta}`);
    check('P1-4 扣留条数 = 1 且原因含 retention/未到期', /1\s*项/.test(held) && /未到期|retention/i.test(held), `held=${held}`);
    const pvIpc = await page.evaluate(() => window.septcats.dbgc.preview());
    check('P1-5 IPC 预览与 UI 对账：candidates=2 / deletable=1 / held=1(retention)',
      pvIpc?.candidates === 2 && pvIpc?.deletable === 1 && pvIpc?.held === 1 && pvIpc?.heldByReason?.retention === 1,
      JSON.stringify(pvIpc));
    check('P1-6 保留天数 30 明示', /30/.test(ret), `ret=${ret}`);

    STEP = 'P2|取消零写';
    await clickTestId(page, 'settings-dbgc-cancel');
    await wait(800);
    const afterCancel = await nodesMatching(page, MARK);
    check('P2-1 取消后三类页原样在场（零写入）', afterCancel.length === 3 && afterCancel.some((n) => n.id === purgeId), JSON.stringify(afterCancel));
    check('P2-2 取消后预览面板收起', (await domHas(page, '[data-testid="settings-dbgc-preview-panel"]')) === false, 'panel gone');

    STEP = 'P3|确认真删';
    await clickTestId(page, 'settings-dbgc-preview');
    await poll(() => domHas(page, '[data-testid="settings-dbgc-preview-panel"]'), (v) => v === true, 8000);
    await clickTestId(page, 'settings-dbgc-confirm');
    const done = await poll(() => domHas(page, '[data-testid="settings-dbgc-done"]'), (v) => v === true, 12000);
    check('P3-1 确认后出「完成」反馈', done.ok, String(done.ok));
    await wait(1200);
    const afterRun = await nodesMatching(page, MARK);
    check('P3-2 放行的死引用页被真删（树里不再出现）', afterRun.every((n) => n.id !== purgeId), JSON.stringify(afterRun));
    check('P3-3 存活页未被误删', afterRun.some((n) => n.id === keepId && n.alive === 1), JSON.stringify(afterRun));
    check('P3-4 回收站页按 retention 扣留仍在（未满 30 天不动）', afterRun.some((n) => n.id === softId), JSON.stringify(afterRun));

    STEP = 'P4|重启持久';
    await gracefulExit(page, child);
    try { await browser.close(); } catch { /* */ }
    ({ child, browser, page } = await launch());
    await wait(1500);
    const afterRestart = await nodesMatching(page, MARK);
    check('P4-1 重启后真删仍生效（非内存态）', afterRestart.every((n) => n.id !== purgeId), JSON.stringify(afterRestart));
    check('P4-2 重启后存活页与回收站页均在', afterRestart.some((n) => n.id === keepId) && afterRestart.some((n) => n.id === softId), JSON.stringify(afterRestart));

    STEP = 'P5|隔离';
    check('P5-1 真实根未被触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);
  } catch (e) {
    check('EXC 探针整体不抛', false, String(e).slice(0, 200));
  } finally {
    const pass = assertions.filter((x) => x.ok).length;
    const fail = assertions.filter((x) => !x.ok).length;
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 't81-01-results.json'), JSON.stringify({ task: 'T81-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T81-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 12) console.log(`FATAL 断言条数 ${assertions.length} < 12（静默蒸发守卫）`);
    await gracefulExit(page, child).catch(() => undefined);
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 12 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });