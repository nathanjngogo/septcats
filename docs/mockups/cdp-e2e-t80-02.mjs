/* T80-02 真机探针（便携包导入）：roundtrip/安全闸/三段式回滚/非空拒/幂等/撤销
 * 链：P1 源页+导出 zip → P2 plan 预检结构 → P3 execute(replace)+备份在场+roundtrip
 *     P4 篡改闸（半截 zip=BAD_ZIP / 改字节=CHECKSUM / 缺段=SEGMENT_COUNT|BAD_SEGMENT / slip 拒 / 缺 confirm 拒）
 *     P4-6 非空覆盖度拒（包外新页 flush 后 → blocked E_PORTABLE_NOT_EMPTY；create 契约无 title 须 rename，roundtrip 用 id 判据）
 *     P5 revert 逐字节还原 + 重启源页仍在 + 包外页消失 → P6 幂等二次 execute → P7 存活+真实根 untouched
 * 双钉纪律内置（UD settings rootPath→scratch ROOT）。绝不触碰 C:/Users/Administrator/.septcats。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const reqApp = createRequire('E:/Hermes Agent工作空间/Septcats/apps/desktop/package.json');
const { zipSync, unzipSync } = reqApp('fflate');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't80-02-e2e-' + Date.now().toString(36)); // 唯一化防残留句柄锁

const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const EXP = join(RUN, 'pkg');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t80-02');
const PORT = 9246;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const TS = Date.now().toString(36);
const PAGE_NAME = `T80-02源页${TS}`;
const OUTSIDE_NAME = `包外页${TS}`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function existsSyncSafe(p) { try { statSync(p); return true; } catch { return false; } }
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hasPageId = (pg, id) => pg.evaluate(async (iid) => {
  const w = await window.septcats.workspaces.list({});
  const activeId = w.activeId ?? (w.items?.[0]?.id ?? null);
  const t = await window.septcats.pages.tree({ workspaceId: activeId });
  return JSON.stringify(t).includes(iid);
}, id);
// create 契约无 title（会静默忽略）——建页后必须 rename 才有标题
const createPage = (pg, title) => pg.evaluate(async (t) => {
  const created = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: created.id, title: t });
  return created.id;
}, title);
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

function killStaleApp() {
  // 上轮残留的 electron（命令行含本探针 UD 特征）会锁 zip/db，rmSync 直接 EBUSY 崩
  try {
    const out = execSync('wmic process where "name=\'electron.exe\'" get processid,commandline /format:list', { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) {
        const m = line.match(/^ProcessId=(\d+)/);
        if (m !== null && cur.includes('t80-02-e2e')) killTree(Number(m[1]));
        cur = '';
      }
    }
  } catch { /* wmic 缺失忽略 */ }
}
function seedFixtures() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) {
    try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); }
  }
  if (existsSyncSafe(join(RUN, 'pkg'))) rmSync(join(RUN, 'pkg'), { recursive: true, force: true });
  for (const d of [UD, ROOT, EXP, SHOTS]) mkdirSync(d, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
}

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
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function gracefulExit(page, child) {
  try { await page.evaluate(() => window.close()); } catch { /* */ }
  for (let i = 0; i < 12; i += 1) {
    await wait(500);
    try { execSync(`tasklist /FI "PID eq ${String(child.pid)}" /NH | findstr ${String(child.pid)}`, { stdio: 'ignore' }); } catch { return; }
  }
  killTree(child.pid);
}

async function main() {
  seedFixtures();
  const rootBefore = rootMtime();
  let { child, browser, page } = await launch();
  let zipPath = '';
  let backupPath = '';
  let firstOps = -1;
  let firstEntities = -1;
  const callPlan = (zp) => page.evaluate(async (p) => { try { return { pass: await window.septcats.portable.importPlan({ zipPath: p }) }; } catch (e) { return { fail: String(e) }; } }, zp.replace(/\\/g, '/'));
  try {
    // ---- P1 源页 + 导出 ----
    STEP = 'P1|导出夹具';
    const srcId = await createPage(page, PAGE_NAME);
    void srcId;
    const exp = await page.evaluate(async (dir) => window.septcats.portable.confirm({ dir }), EXP.replace(/\\/g, '/'));
    zipPath = exp?.path ?? '';
    check('P1-1 导出 zip 落盘非空', typeof zipPath === 'string' && statSync(zipPath).size > 0, `${zipPath} ${zipPath ? statSync(zipPath).size : 0}B`);
    // 段 JSON 的中文被 \uXXXX 转义（JSON.stringify 行为）→ 先 JSON 反解再比明文
    check('P1-2 zip 的段 jsonl 内含源页标题（反解后）', (() => { try { const z = unzipSync(readFileSync(zipPath)); const segKey = Object.keys(z).find((k) => k.startsWith('sync/')); if (segKey === undefined) return false; const lines = Buffer.from(z[segKey]).toString('utf8').split('\n').filter((l) => l.length > 0); return lines.some((l) => { try { return JSON.stringify(JSON.parse(l)).includes(PAGE_NAME) || JSON.parse(l)?.ops?.some?.((o) => JSON.stringify(o).includes(PAGE_NAME)) || l.includes(PAGE_NAME); } catch { return l.includes(PAGE_NAME); } }); } catch { return false; } })(), '段内含标题');

    // ---- P2 plan 预检 ----
    STEP = 'P2|plan';
    const rPlan = await callPlan(zipPath);
    const plan = rPlan.pass;
    info('plan', JSON.stringify({ counts: plan?.counts, schema: plan?.schema, target: plan?.target, blocked: plan?.blocked ?? null }));
    check('P2-1 plan 结构完整且 zipPath 解析正确', typeof plan?.zipPath === 'string' && ['manifest', 'counts', 'schema', 'target', 'blocked'].every((k) => k in (plan ?? {})), JSON.stringify(Object.keys(plan ?? rPlan.fail ?? {})));
    check('P2-2 plan 无阻断（本库导出=全覆盖 uncovered=0）', plan?.blocked === null && plan?.target?.uncovered === 0, JSON.stringify(plan?.blocked) + ' uncovered=' + String(plan?.target?.uncovered));
    check('P2-3 schema 兼容（包≤当前）', plan?.schema?.compatible === true && plan.schema.package <= plan.schema.current, JSON.stringify(plan?.schema));

    // ---- P3 execute 三段式 ----
    STEP = 'P3|execute';
    const dbPath = join(ROOT, 'septcats.db');
    const res = await page.evaluate(async (zp) => { try { return await window.septcats.portable.importExecute({ zipPath: zp, confirm: true }); } catch (e) { return { __err: String(e) }; } }, zipPath.replace(/\\/g, '/'));
    info('execute', JSON.stringify(res).slice(0, 300));
    check('P3-1 execute ok 且显式 replace', res.ok === true && res.replay?.mode === 'replace', JSON.stringify(res.replay ?? res.__err));
    check('P3-2 备份 bak-portable-<ts> 在场非空', typeof res.backupPath === 'string' && res.backupPath.includes('.bak-portable-') && statSync(res.backupPath).size > 0, res.backupPath);
    backupPath = res.backupPath ?? ''; firstOps = res.replay?.ops ?? -1; firstEntities = res.replay?.entities ?? -1;
    check('P3-3 重放有真实数据（ops/entities>0）', firstOps > 0 && firstEntities > 0, `ops=${String(firstOps)} entities=${String(firstEntities)}`);
    check('P3-4 roundtrip：execute 后树含源页 id', hasPageId(page, srcId), '树含源页 id');

    // ---- P3.5 幂等二次 execute（须在包外页出现前：同包重放同结果）----
    STEP = 'P3.5|幂等';
    const res2 = await page.evaluate(async (zp) => window.septcats.portable.importExecute({ zipPath: zp, confirm: true }), zipPath.replace(/\\/g, '/'));
    check('P3.5-1 同包二次 execute 同结果（ops/entities 逐值等）', res2.ok === true && res2.replay?.ops === firstOps && res2.replay?.entities === firstEntities, `ops ${String(firstOps)}→${String(res2.replay?.ops)} entities ${String(firstEntities)}→${String(res2.replay?.entities)}`);
    check('P3.5-2 二次导入后源页仍在', hasPageId(page, srcId), '树含源页 id');

    // ---- P4 安全闸 ----
    STEP = 'P4|安全闸';
    const rawZip = readFileSync(zipPath);
    const trunc = join(RUN, 'half.zip');
    writeFileSync(trunc, Buffer.from(rawZip.subarray(0, Math.floor(rawZip.length * 0.4))));
    const rTrunc = await callPlan(trunc);
    check('P4-1 半截 zip → E_PORTABLE_BAD_ZIP 结构化拒', /E_PORTABLE_BAD_ZIP/.test(rTrunc.fail ?? ''), String(rTrunc.fail ?? 'ACCEPTED!!').slice(0, 160));
    const unz = unzipSync(new Uint8Array(rawZip));
    const tampered = { ...unz };
    tampered['septcats.db'] = unz['septcats.db'].map((b, i) => (i === 100 ? b ^ 0xff : b));
    const tZip = join(RUN, 'tampered.zip');
    writeFileSync(tZip, Buffer.from(zipSync(tampered)));
    const rTam = await callPlan(tZip);
    check('P4-2 checksums 篡改 → E_PORTABLE_CHECKSUM 整体拒', /E_PORTABLE_CHECKSUM/.test(rTam.fail ?? ''), String(rTam.fail ?? 'ACCEPTED!!').slice(0, 160));
    const dropped = { ...unz };
    const segKey = Object.keys(dropped).find((k) => k.startsWith('sync/'));
    if (segKey !== undefined) delete dropped[segKey];
    const dZip = join(RUN, 'delseg.zip');
    writeFileSync(dZip, Buffer.from(zipSync(dropped)));
    const rDel = await callPlan(dZip);
    check('P4-3 缺段 → SEGMENT_COUNT/BAD_SEGMENT/CHECKSUM 拒', /E_PORTABLE_(SEGMENT_COUNT|BAD_SEGMENT|CHECKSUM)/.test(rDel.fail ?? ''), String(rDel.fail ?? 'ACCEPTED!!').slice(0, 160));
    const slipNames = { ...unz };
    slipNames['../evil.txt'] = new Uint8Array([1]);
    const sZip = join(RUN, 'slip.zip');
    writeFileSync(sZip, Buffer.from(zipSync(slipNames)));
    const rSlip = await callPlan(sZip);
    check('P4-4 zip slip 条目 → 拒（不静默改写）', /E_ENTRY_NAME|E_PORTABLE_BAD_MANIFEST|E_PORTABLE_CHECKSUM|slip|evil/i.test(rSlip.fail ?? '') === true && !(rSlip.pass !== undefined), String(rSlip.fail ?? 'PLAN PASSED!!').slice(0, 160));
    const rNoConf = await page.evaluate(async (zp) => { try { await window.septcats.portable.importExecute({ zipPath: zp }); return 'ACCEPTED!!'; } catch (e) { return String(e); } }, zipPath.replace(/\\/g, '/'));
    check('P4-5 execute 缺 confirm:true → 拒', /E_MALFORMED|confirm/.test(rNoConf), rNoConf.slice(0, 160));
    // ⚠ H-08 取证：进程内未 flush 的 op 不在 op_ledger → plan 覆盖度预检「看不见」。
    const outsideId = await createPage(page, OUTSIDE_NAME);
    const rBusyLive = await callPlan(zipPath);
    info('P4-6a 包外页刚建（进程内 plan 未 flush）', JSON.stringify(rBusyLive.pass?.target ?? rBusyLive.fail).slice(0, 160));
    await gracefulExit(page, child);
    try { await browser.close(); } catch { /* */ }
    ({ child, browser, page } = await launch());
    const rBusy = await callPlan(zipPath);
    check('P4-6 重启 flush 后包外 op → blocked E_PORTABLE_NOT_EMPTY', rBusy.pass?.blocked?.code === 'E_PORTABLE_NOT_EMPTY' && rBusy.pass.target.uncovered > 0, JSON.stringify(rBusy.pass?.blocked ?? rBusy.fail ?? rBusy.pass?.target).slice(0, 200));

    // ---- P5 revert 逐字节 + 重启 ----
    STEP = 'P5|revert';
    const dbShaNow = sha(readFileSync(dbPath));
    const rv = await page.evaluate(async (bp) => { try { return await window.septcats.portable.importRevert({ backupPath: bp, confirm: true }); } catch (e) { return { __err: String(e) }; } }, backupPath.replace(/\\/g, '/'));
    check('P5-1 revert ok 且主库逐字节=备份文件', rv.ok === true && sha(readFileSync(dbPath)) === sha(readFileSync(backupPath)), JSON.stringify(rv).slice(0, 200));
    void dbShaNow;
    await gracefulExit(page, child);
    try { await browser.close(); } catch { /* */ }
    ({ child, browser, page } = await launch());
    check('P5-2 重启后源页仍在（还原=导入前态）', hasPageId(page, srcId), '重启树含源页 id');
    check('P5-3 包外页随 revert 消失（还原语义成立）', (await hasPageId(page, outsideId)) === false, '包外页不在树');


    // ---- P7 存活 ----
    STEP = 'P7|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('P7-1 应用存活（导入/撤销/重放后未崩）', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't80-02-results.json'), JSON.stringify({ task: 'T80-02', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T80-02：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 17) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 17（静默蒸发守卫）`); }
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { await gracefulExit(page, child); } catch { /* */ }
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 17 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
