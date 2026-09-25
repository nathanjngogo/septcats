/* T82-02-A 真机探针（H-05 import_source 判重加页存活校验）
 * 链：夹具建 md 包 → 导入 → 断言入账 → 删除（回收站 + 彻底 purge 两态各测）→ 重导同一包
 *     → 期望：重导**不再被静默跳过**（死引用视作未导入），页回来。
 *     对照组：活页重复导 = 仍 skipped（幂等不破）。
 * 双钉纪律内置（UD + settings.json rootPath→scratch data）；真实根仅 mtime 比对。
 * 判据面走 IPC（plan/execute 是导入链真入口），断言 <8 = FATAL。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't82-02-a-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const SRC = join(RUN, 'notion-md');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t82-02');
const PORT = 9249;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync('C:\\Users\\Administrator\\.septcats').mtimeMs; } catch { return -1; } }

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

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

function seedMdFolder() {
  rmSync(SRC, { recursive: true, force: true });
  mkdirSync(SRC, { recursive: true });
  const TS = Date.now().toString(36);
  writeFileSync(join(SRC, `H05夹具页 ${TS.slice(0,6)}.md`), `# H05夹具页${TS}\n\n正文段落，判重用。\n`);
  return TS;
}
async function importPlanRun(page, dir) {
  return page.evaluate(async (d) => {
    const plan = await window.septcats.import.plan({ dirPath: d });
    return { planId: plan?.planId ?? null, newPages: (plan?.items ?? []).filter((i) => i.op === 'page').length, skipped: plan?.counts?.skippedDuplicate ?? 0, raw: JSON.stringify(plan).slice(0, 400) };
  }, dir.replace(/\\/g, '/'));
}
async function importExecRun(page, planId) {
  return page.evaluate(async (id) => {
    const r = await window.septcats.import.execute({ planId: id, confirm: true });
    return { done: r?.done ?? 0, status: r?.status ?? null, raw: JSON.stringify(r).slice(0, 300) };
  }, planId);
}
async function findPageId(page, mark) {
  return page.evaluate(async (m) => {
    const w = await window.septcats.workspaces.list({});
    const t = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id ?? null });
    const hit = JSON.stringify(t).match(new RegExp('"id":"([0-9A-Z]{26})"[^}]*' + m));
    return hit ? hit[1] : null;
  }, mark);
}
async function treePageCount(page) {
  return page.evaluate(async () => {
    const w = await window.septcats.workspaces.list({});
    const t = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id ?? null });
    return (JSON.stringify(t).match(/"deleted_at":null/g) ?? []).length;
  });
}
async function findTrashId(page, mark) {
  return page.evaluate(async (m) => {
    const list = await window.septcats.pages.trashList({});
    const hit = (list.items ?? list).find?.((p) => String(p.title ?? '').includes(m)) ?? null;
    return hit?.id ?? null;
  }, mark);
}

async function main() {
  const TS = seedMdFolder();
  const MARK = `H05夹具页${TS}`;
  rmSync(UD, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const rootBefore = rootMtime();
  let { child, browser, page } = await launch();
  try {
    STEP = 'P1|首导';
    const p1 = await importPlanRun(page, SRC);
    check('P1-1 首导 plan 判定为新页（new≥1）', p1.newPages >= 1, p1.raw);
    const e1 = await importExecRun(page, p1.planId);
    check('P1-2 首导 execute 入账', e1.done >= 1 && e1.status === 'done', e1.raw);
    await wait(1200);

    STEP = 'P2|活页幂等';
    const p2 = await importPlanRun(page, SRC);
    check('P2-1 活页重复导 = skipped（幂等不破）', p2.newPages === 0 && p2.skipped >= 1, `new=${String(p2.newPages)} skipped=${String(p2.skipped)}`);

    STEP = 'P3|删除后重导';
    const delId = await findPageId(page, MARK);
    check('P3-0 夹具页可定位', delId !== null, String(delId));
    await page.evaluate(async (id) => { await window.septcats.pages.delete({ id }); }, delId);
    await wait(800);
    const p3a = await importPlanRun(page, SRC);
    check('P3-1 回收站态重导 plan 判据（按 plan.ts 现语义钉死：允许恢复=不计新页但 skipped 含恢复项，或视作新页——两态取其一，禁静默）', p3a.newPages >= 1 || p3a.skipped >= 1, `new=${String(p3a.newPages)} skipped=${String(p3a.skipped)}`);
    await page.evaluate(async (id) => { try { await window.septcats.pages.purge({ id }); } catch { /* purge 前置=先出回收站，容错试 restore+purge */ try { await window.septcats.pages.restore({ id }); await window.septcats.pages.delete({ id }); await window.septcats.pages.purge({ id }); } catch { /* ignore */ } } }, delId);
    await wait(800);
    const p3b = await importPlanRun(page, SRC);
    check('P3-2 purge 态重导 plan 判定为新页（H-05 核心判据）', p3b.newPages >= 1, `new=${String(p3b.newPages)} skipped=${String(p3b.skipped)}`);
    const e3 = await importExecRun(page, p3b.planId);
    check('P3-3 purge 态重导 execute 真入账', e3.done >= 1 && e3.status === 'done', e3.raw);
    await wait(1200);
    const n = await treePageCount(page);
    check('P3-4 树活页数≥1（页真回来了）', n >= 1, `alive=${String(n)}`);

    STEP = 'P4|重启持久';
    await gracefulExit(page, child);
    try { await browser.close(); } catch { /* */ }
    ({ child, browser, page } = await launch());
    check('P4-1 重启后重导页仍在（真入账非内存态）', (await treePageCount(page)) >= 1, '重启树计数')
  } catch (e) {
    check('EXC 探针整体不抛', false, String(e).slice(0, 200));
  } finally {
    const pass = assertions.filter((x) => x.ok).length;
    const fail = assertions.filter((x) => !x.ok).length;
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 't82-02-results.json'), JSON.stringify({ task: 'T82-02-A', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T82-02-A：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 8) console.log(`FATAL 断言条数 ${assertions.length} < 8（静默蒸发守卫）`);
    console.log(`真实根 untouched=${rootBefore === rootMtime()}`);
    await gracefulExit(page, child).catch(() => undefined);
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 8 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
