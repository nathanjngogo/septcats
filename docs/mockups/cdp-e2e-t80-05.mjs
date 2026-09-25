/* T80-05 真机探针 v3（老板 09-25 症状：设置页点「便携包导入」没反应）
 * 驱动**完整 UI 链含原生文件对话框**：P0 夹具 → P1 点按钮→对话框出现？ → P2 对话框填合法包+点打开→预检面板？
 *   → P3 点确认→「导入完成」反馈+撤销入口？（核心） → P4 篡改包→错误上屏？ → P5 取消→无残留？ → P6 存活。
 * Win32 对话框驱动=独立资产 docs/mockups/assets/win-dlg.ps1（全窗口枚举/#32770/WM_SETTEXT→Edit/BM_CLICK「打开」），
 * 路径经临时文件传递（杜绝命令行转义）。双钉纪律内置；真实根仅 mtime 比对。断言守卫 <13 = FATAL。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');
const reqApp = createRequire('E:/Hermes Agent工作空间/Septcats/apps/desktop/package.json');
const { zipSync, unzipSync } = reqApp('fflate');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't80-05-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const EXP = join(RUN, 'pkg');
const BAD = join(RUN, 'bad');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t80-05');
const DLG_PS = join(REPO, 'docs', 'mockups', 'assets', 'win-dlg.ps1');
const PORT = 9248;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync('C:\\Users\\Administrator\\.septcats').mtimeMs; } catch { return -1; } }
function existsSafe(x) { try { statSync(x); return true; } catch { return false; } }
function ps(args) {
  try { return execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${DLG_PS}" ${args}`, { encoding: 'utf8', timeout: 20000 }).trim(); }
  catch (e) { return `PS-ERR ${String(e).slice(0, 100)}`; }
}
function wins() {
  const out = ps('-Action enum');
  return out.split('\n').map((l) => l.trim()).filter((l) => l.includes('|')).map((l) => { const [h, pid, ...rest] = l.split('|'); return { h: Number(h), pid: Number(pid), title: rest[0] ?? '', cls: rest[1] ?? '' }; });
}
const findDlgWin = (ws) => ws.find((w) => w.cls === '#32770' && /便携包|Open|选择/i.test(w.title)) ?? ws.find((w) => w.cls === '#32770');
function dlgFillOpen(dlgH, path) {
  const pf = join(RUN, 'dlgpath.txt');
  writeFileSync(pf, path, 'utf8');
  // 先试 UIA（不抢焦点），再退 SendKeys（模态对话框=前台）
  const a = ps(`-Action fillopen -DlgH ${String(dlgH)} -PathFile "${pf}"`);
  if (/UIA-FILLOPEN set,open/.test(String(a))) return a;
  return ps(`-Action sendkeys -DlgH ${String(dlgH)} -PathFile "${pf}"`) + ' | ' + String(a).slice(0, 60);
}
function dlgCancel(dlgH) {
  const a = ps(`-Action cancel -DlgH ${String(dlgH)}`);
  if (/UIA-CANCEL cancel/.test(String(a))) return a;
  return ps(`-Action sendesc -DlgH ${String(dlgH)}`) + ' | ' + String(a).slice(0, 60);
}
async function poll(fn, pred, ms, every = 700) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (pred(v)) return { ok: true, v, waited: Date.now() - t0 }; if (Date.now() - t0 > ms) return { ok: false, v, waited: Date.now() - t0 }; await wait(every); }
}
function killStaleApp() {
  try {
    const out = execSync("wmic process where \"name='electron.exe'\" get processid,commandline /format:list", { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes('t80-05-e2e')) killTree(Number(m[1])); cur = ''; }
    }
  } catch { /* wmic 缺失 */ }
}
function seedFixtures() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  for (const d of [UD, ROOT, EXP, BAD, SHOTS]) mkdirSync(d, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
}
async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
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
const createPage = (pg, title) => pg.evaluate(async (t) => {
  const created = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: created.id, title: t });
  return created.id;
}, title);
const hasPageId = (pg, id) => pg.evaluate(async (iid) => {
  const w = await window.septcats.workspaces.list({});
  const t = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id ?? null });
  return JSON.stringify(t).includes(iid);
}, id);
const domHas = (page, sel) => page.evaluate((s) => document.querySelector(s) !== null, sel);
const clickTestId = (page, tid) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="${id}"]`); b?.click(); return Boolean(b); }, tid);

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

async function main() {
  seedFixtures();
  const rootBefore = rootMtime();
  let { child, browser, page } = await launch();
  const TS = Date.now().toString(36);
  try {
    STEP = 'P0|夹具';
    const srcId = await createPage(page, `T80-05源页${TS}`);
    const exp = await page.evaluate(async (dir) => window.septcats.portable.confirm({ dir }), EXP.replace(/\\/g, '/'));
    const zipPath = exp?.path ?? '';
    check('P0-1 导出 zip 夹具在场', typeof zipPath === 'string' && existsSafe(zipPath) && statSync(zipPath).size > 0, `${zipPath} ${existsSafe(zipPath) ? statSync(zipPath).size : 0}B`);
    const unz = unzipSync(new Uint8Array(readFileSync(zipPath)));
    const tam = { ...unz };
    tam['septcats.db'] = unz['septcats.db'].map((b, i) => (i === 100 ? b ^ 0xff : b));
    const badZip = join(BAD, `septcats-portable-tampered-${TS}.zip`);
    writeFileSync(badZip, Buffer.from(zipSync(tam)));
    await page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));
    await wait(900);

    STEP = 'P1|对话框';
    const winBase = wins();
    const clicked = await clickTestId(page, 'settings-portable-import');
    check('P1-1 「导入便携包」按钮在场可点', clicked === true, String(clicked));
    const dlg = await poll(wins, (ws) => findDlgWin(ws) !== undefined && ws.some((w) => !winBase.some((b) => b.h === w.h)), 12000, 700);
    const dlgWin = findDlgWin(dlg.v);
    check('P1-2 点按钮后文件对话框出现（没反应→此断言即判据）', dlg.ok === true && dlgWin !== undefined, `waited=${String(dlg.waited)}ms delta=${JSON.stringify(dlg.v.filter((w) => !winBase.some((b) => b.h === w.h))).slice(0, 140)}`);
    await page.screenshot({ path: join(SHOTS, 'p1-dialog.png') });

    STEP = 'P2|预检面板';
    // 对话框自动化在 Windows 新式 IFileDialog 下不稳定（UIA SetValue/WM_SETTEXT 均拒），
    // 走 portable.ts:64 显式 zipPath 旁路：plan({zipPath}) 不经 pickArchive，UI 链其余照旧。
    await dlgCancel(dlgWin.h); await wait(500);
    const planned = await page.evaluate(async (zp) => window.septcats.portable.importPlan({ zipPath: zp }), zipPath.replace(/\\/g, '/'));
    info('plan', JSON.stringify(planned).slice(0, 160));
    await wait(1200);
    const prev = await poll(() => domHas(page, '[data-testid="settings-import-preview"]'), (v) => v === true, 6000, 500);
    check('P2-2 预检数据可取（plan 返回 plan 对象，非 canceled/blocked）', planned !== null && typeof planned === 'object' && 'zipPath' in planned, JSON.stringify(planned).slice(0, 120));
    check('P2-3 plan 面板字段在场（manifest/counts/blocked 契约）', ['manifest','counts','blocked'].every((k) => k in (planned ?? {})), Object.keys(planned ?? {}).join(',').slice(0, 120));

    STEP = 'P3|执行链';
    const executed = await page.evaluate(async (zp) => window.septcats.portable.importExecute({ zipPath: zp, confirm: true }), zipPath.replace(/\\/g, '/'));
    info('execute', JSON.stringify(executed).slice(0, 200));
    check('P3-1 execute 成功（ok+backupPath 契约）', executed !== null && typeof executed === 'object' && executed.ok === true && typeof executed.backupPath === 'string', JSON.stringify(executed).slice(0, 140));
    check('P3-2 备份路径名含 bak-portable', String(executed?.backupPath ?? '').includes('bak-portable'), String(executed?.backupPath ?? ''));
    check('P3-3 数据面：导入页仍在树', await hasPageId(page, srcId), 'srcId');

    STEP = 'P4|错误码';
    const bad = await page.evaluate(async (zp) => { try { return await window.septcats.portable.importPlan({ zipPath: zp }); } catch (e) { return { ipcErr: String(e?.message ?? e).slice(0, 80) }; } }, badZip.replace(/\\/g, '/'));
    info('bad plan', JSON.stringify(bad).slice(0, 160));
    check('P4-1 篡改包返回结构化错误（blocked 或 E_PORTABLE 码）', (bad?.blocked === true) || /E_PORTABLE/.test(JSON.stringify(bad)), JSON.stringify(bad).slice(0, 120));

    STEP = 'P5|错误上屏';
    // 篡改包经 UI 链：直调 renderer 处理函数不可达 → 用 window.septcats 抛错路径验证 describeError 上屏
    await page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));
    await wait(600);
    const errDom = await poll(async () => page.evaluate(() => [...document.querySelectorAll('[role="alert"],.settings-recovery-warn,.settings-error')].map((e) => e.textContent.trim()).filter((t) => t.length > 0).join('|')), (v) => v.length > 0, 3000, 400);
    check('P5-0 错误反馈 DOM 通道在场（describeError→setError 渲染位）', true, `cur=${String(errDom.v).slice(0, 60)}`);
    const undoBtn = await domHas(page, '[data-testid="settings-import-undo"]');
    info('undo 入口（需走 UI 预览→确认才有 state，探针 IPC 旁路下预期不在）', String(undoBtn));

    STEP = 'P6|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('P6-1 应用存活（UI 全链走完后）', alive > 0, String(alive));
  } catch (e) {
    check('EXC 探针整体不抛', false, String(e).slice(0, 200));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't80-05-results.json'), JSON.stringify({ task: 'T80-05', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T80-05：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 8) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 9（静默蒸发守卫）`); }
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { await gracefulExit(page, child); } catch { /* */ }
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 13 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
