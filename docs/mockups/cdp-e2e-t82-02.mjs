/* T82-02-A 真机探针 v2（H-05：import_source 判重加页存活校验）
 * 链：夹具 md 包 → 首导入账 → 活页重复导=skipped（幂等不破）
 *     → 软删（回收站 deletedAt>0）→ 重导：期望**新页**（不再静默跳过）
 *     → 软删+purge（deletedAt=0 死引用）→ 重导：期望**新页**
 *     → 重启后重导页仍在（真入账非内存态）；全程真实根 mtime 不变。
 * 桥面（读 preload 真契约）：import.plan({dirPath}) / import.execute({planId,confirm})
 *     pages.tree({workspaceId}) / pages.remove({id}) / pages.purge({id})
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <10 = FATAL（静默蒸发守卫）。
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
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9249;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }

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
  // 文件名与一级标题同源（标题=去掉 .md 的文件名），保证 MARK 能精确命中树节点标题
  writeFileSync(join(SRC, `H05夹具页-${TS}.md`), `# H05夹具页-${TS}\n\n正文段落，判重用。\n`);
  return TS;
}
async function importPlanRun(page, dir) {
  return page.evaluate(async (d) => {
    const plan = await window.septcats.import.plan({ dirPath: d });
    return {
      planId: plan?.planId ?? null,
      newPages: (plan?.items ?? []).filter((i) => i.op === 'page').length,
      skipped: plan?.counts?.skippedDuplicate ?? 0,
      raw: JSON.stringify(plan).slice(0, 260),
    };
  }, dir.replace(/\\/g, '/'));
}
async function importExecRun(page, planId) {
  return page.evaluate(async (id) => {
    const r = await window.septcats.import.execute({ planId: id, confirm: true });
    return { done: r?.done ?? 0, status: r?.status ?? null, raw: JSON.stringify(r).slice(0, 240) };
  }, planId);
}
/** 树节点是扁平数组：{id,title,alive,deletedAt,parentId} */
async function pagesMatching(page, mark) {
  return page.evaluate(async (m) => {
    const w = await window.septcats.workspaces.list({});
    const t = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id ?? null });
    return (t ?? [])
      .filter((n) => String(n.title ?? '').includes(m))
      .map((n) => ({ id: n.id, alive: n.alive, deletedAt: n.deletedAt ?? null, title: String(n.title ?? '') }));
  }, mark);
}
async function pageRemove(page, id) {
  return page.evaluate(async (i) => {
    try { return { ok: true, raw: JSON.stringify(await window.septcats.pages.remove({ id: i })).slice(0, 120) }; } catch (e) { return { ok: false, raw: String(e).slice(0, 160) }; }
  }, id);
}
async function pagePurge(page, id) {
  return page.evaluate(async (i) => {
    try { return { ok: true, raw: JSON.stringify(await window.septcats.pages.purge({ id: i })).slice(0, 120) }; } catch (e) { return { ok: false, raw: String(e).slice(0, 160) }; }
  }, id);
}

async function main() {
  const TS = seedMdFolder();
  const MARK = `H05夹具页-${TS}`;
  rmSync(UD, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const stampBefore = realRootStamp();
  let { child, browser, page } = await launch();
  try {
    STEP = 'P1|首导';
    const p1 = await importPlanRun(page, SRC);
    check('P1-1 首导 plan 判定为新页', p1.newPages >= 1, `new=${String(p1.newPages)} ${p1.raw}`);
    const e1 = await importExecRun(page, p1.planId);
    check('P1-2 首导 execute 真入账', e1.done >= 1 && e1.status === 'done', e1.raw);
    await wait(1200);
    const a1 = await pagesMatching(page, MARK);
    const alive1 = a1.filter((n) => n.alive === 1);
    check('P1-3 树里出现活页（导入落地）', alive1.length === 1, JSON.stringify(a1));
    const id1 = alive1[0]?.id ?? null;

    STEP = 'P2|活页幂等';
    const p2 = await importPlanRun(page, SRC);
    check('P2-1 活页重复导 = skipped（H-05 修复不破坏幂等）', p2.newPages === 0 && p2.skipped >= 1, `new=${String(p2.newPages)} skipped=${String(p2.skipped)}`);

    STEP = 'P3|回收站态重导';
    const rm1 = id1 === null ? { ok: false, raw: 'no id' } : await pageRemove(page, id1);
    check('P3-0 软删成功（进回收站）', rm1.ok, rm1.raw);
    await wait(1000);
    const a2 = await pagesMatching(page, MARK);
    check('P3-1 回收站态：alive=0 且 deletedAt>0（软删语义成立）', a2.some((n) => n.alive === 0 && Number(n.deletedAt) > 0), JSON.stringify(a2));
    const p3 = await importPlanRun(page, SRC);
    check('P3-2 H-05 核心：回收站态重导不再静默跳过（判定为新页）', p3.newPages >= 1, `new=${String(p3.newPages)} skipped=${String(p3.skipped)}`);
    const e3 = await importExecRun(page, p3.planId);
    check('P3-3 重导 execute 真入账', e3.done >= 1 && e3.status === 'done', e3.raw);
    await wait(1200);
    const a3 = await pagesMatching(page, MARK);
    const alive3 = a3.filter((n) => n.alive === 1);
    check('P3-4 重导产生新活页（新 id，非复活回收站页）', alive3.length >= 1 && alive3.every((n) => n.id !== id1), `alive=${String(alive3.length)} ids=${alive3.map((n) => n.id).join(',')}`);
    const id2 = alive3[0]?.id ?? null;

    STEP = 'P4|彻底删除态重导';
    const rm2 = id2 === null ? { ok: false, raw: 'no id2' } : await pageRemove(page, id2);
    check('P4-0 二次软删成功', rm2.ok, rm2.raw);
    const pg2 = id2 === null ? { ok: false, raw: 'no id2' } : await pagePurge(page, id2);
    check('P4-1 彻底删除成功（deleted_at=0 死引用态）', pg2.ok, pg2.raw);
    await wait(1000);
    const a4 = await pagesMatching(page, MARK);
    check('P4-2 死引用态：alive=0 且 deletedAt=0', a4.some((n) => n.alive === 0 && Number(n.deletedAt) === 0), JSON.stringify(a4));
    const p4 = await importPlanRun(page, SRC);
    check('P4-3 死引用态重导判定为新页（H-05）', p4.newPages >= 1, `new=${String(p4.newPages)} skipped=${String(p4.skipped)}`);
    const e4 = await importExecRun(page, p4.planId);
    check('P4-4 死引用态重导 execute 真入账', e4.done >= 1 && e4.status === 'done', e4.raw);
    await wait(1200);

    STEP = 'P5|重启持久';
    await gracefulExit(page, child);
    try { await browser.close(); } catch { /* */ }
    ({ child, browser, page } = await launch());
    await wait(1500);
    const a5 = await pagesMatching(page, MARK);
    check('P5-1 重启后重导页仍在（真入账，非内存态）', a5.filter((n) => n.alive === 1).length >= 1, JSON.stringify(a5));

    STEP = 'P6|隔离';
    check('P6-1 真实根未被触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);
  } catch (e) {
    check('EXC 探针整体不抛', false, String(e).slice(0, 200));
  } finally {
    const pass = assertions.filter((x) => x.ok).length;
    const fail = assertions.filter((x) => !x.ok).length;
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 't82-02-results.json'), JSON.stringify({ task: 'T82-02-A', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T82-02-A：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 10) console.log(`FATAL 断言条数 ${assertions.length} < 10（静默蒸发守卫）`);
    await gracefulExit(page, child).catch(() => undefined);
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 10 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });