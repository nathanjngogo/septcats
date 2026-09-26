/* T83-02 真机探针（附件目录孤儿回收对账 assetGc）
 * 链：P0 造夹具（scratch 附件目录摆 5 个内容寻址文件 + commit 引用它们的块 op）→
 *     P1 设置页预览（放行 2 孤儿 / 保住 3 引用）→ P2 取消=零删除 →
 *     P3 确认真删（孤儿没了、被引用者逐字节还在）→ P4 再预览=空 →
 *     P5 失明面：锁页使明文扫描看不见其块引用 → referencesComplete=false 全扣 →
 *     P6 解锁后 run=零删除（引用恢复）→ P7 真实根零触碰。
 * 桥面（读实现真契约）：window.septcats.assetgc.preview() / run()（无参）；
 *     设置页 testid：settings-assetgc-preview / -preview-panel / -meta / -held /
 *     -blind / -retention / -cancel / -confirm / -done。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <12 = FATAL（静默蒸发守卫）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't83-02-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const ATT = join(ROOT, 'attachments');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t83-02');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9252;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const DAY = 24 * 60 * 60 * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  try {
    const out = execSync(`wmic process where "name='electron.exe'" get processid,commandline /format:list`, { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes('t83-02-e2e')) killTree(Number(m[1])); cur = ''; }
    }
  } catch { /* wmic 缺失 */ }
}
async function poll(fn, pred, ms, every = 600) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (pred(v)) return { ok: true, v, waited: Date.now() - t0 }; if (Date.now() - t0 > ms) return { ok: false, v, waited: Date.now() - t0 }; await wait(every); }
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

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

const domHas = (page, sel) => page.evaluate((s) => document.querySelector(s) !== null, sel);
const domText = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.textContent ?? '').trim(), sel);
const clickTestId = (page, tid) => page.evaluate((id) => { const b = document.querySelector(`[data-testid="${id}"]`); b?.click(); return Boolean(b); }, tid);
const confirmDisabled = (page) => page.evaluate(() => Boolean(document.querySelector('[data-testid="settings-assetgc-confirm"]')?.disabled ?? true));
const openSettings = (page) => page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));

/** 64 位小写 hex 夹具哈希（与单测同构造思路：xorshift 打散）。 */
function fixtureHash(seed) {
  const table = '0123456789abcdef';
  let x = 0x9e3779b9;
  for (const ch of seed) { x = (x * 31 + ch.charCodeAt(0)) >>> 0; }
  let out = '';
  for (let i = 0; i < 64; i += 1) {
    x ^= (x << 13); x >>>= 0; x ^= (x >> 17); x ^= (x << 5); x >>>= 0;
    out += table[x & 15];
  }
  return out;
}

async function main() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  for (const d of [UD, ROOT, ATT, SHOTS]) mkdirSync(d, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const stampBefore = realRootStamp();

  // P0 附件夹具：5 个内容寻址文件，mtime 全部摆旧（否则 30 天保护期先扣成 recent，测不到引用面）
  const H_REF1 = fixtureHash('probe-ref1');
  const H_REF2 = fixtureHash('probe-ref2');
  const H_REF3 = fixtureHash('probe-ref3');
  const H_ORPHAN1 = fixtureHash('probe-orphan1');
  const H_ORPHAN2 = fixtureHash('probe-orphan2');
  const OLD = new Date(Date.now() - 400 * DAY);
  const put = (name, bytes) => { const p = join(ATT, name); writeFileSync(p, Buffer.alloc(bytes, 0x2a)); utimesSync(p, OLD, OLD); };
  put(H_REF1, 111); put(`${H_REF3}.png`, 333); put(H_REF2, 222);
  put(H_ORPHAN1, 400); put(H_ORPHAN2, 900);
  const byteSum = 400 + 900;

  let { child, browser, page } = await launch();
  const TS = Date.now().toString(36);
  try {
    STEP = 'P0|夹具';
    check('P0-0 附件夹具 5 个就位', [H_REF1, `${H_REF3}.png`, H_REF2, H_ORPHAN1, H_ORPHAN2].every((n) => statSync(join(ATT, n)).isFile()), ATT);
    const ids = await page.evaluate(async (a) => {
      const mk = async (title) => { const c = await window.septcats.pages.create({ parentId: null }); await window.septcats.pages.rename({ id: c.id, title }); return c.id; };
      const pageLock = await mk(`T83锁页${a.TS}`);
      const pageB = await mk(`T83乙页${a.TS}`);
      const ops = [
        { op_id: `blk1${a.TS}`, lamport: { c: 1, d: 't8302aaa' }, at: Date.now(), actor: 't8302aaa', target: { table: 'block', id: `blk1${a.TS}` }, kind: 'upsert',
          payload: { page_id: pageLock, type: 'image', props: { caption: `attachment://${a.H_REF2}` }, content: { src: `attachment://${a.H_REF1}` }, parent_id: null, sort_key: 'A00000000', alive: 1 } },
        { op_id: `blk2${a.TS}`, lamport: { c: 2, d: 't8302bbb' }, at: Date.now(), actor: 't8302bbb', target: { table: 'block', id: `blk2${a.TS}` }, kind: 'upsert',
          payload: { page_id: pageB, type: 'image', props: {}, content: { src: `asset://${a.H_REF3}.png` }, parent_id: null, sort_key: 'A00000000', alive: 1 } },
      ];
      const n = await window.septcats.blocks.commit({ ops });
      return { pageLock, pageB, committed: n };
    }, { TS, H_REF1, H_REF2, H_REF3 });
    check('P0-1 造页+提交引用块（2 op 落库）', ids.committed === 2 && typeof ids.pageLock === 'string', JSON.stringify(ids));

    STEP = 'P1|预览';
    await openSettings(page);
    const hasBtn = await poll(() => domHas(page, '[data-testid="settings-assetgc-preview"]'), (v) => v === true, 8000);
    check('P1-1 设置页「清理未引用附件」按钮在场', hasBtn.ok, String(hasBtn.ok));
    await clickTestId(page, 'settings-assetgc-preview');
    const panel = await poll(() => domHas(page, '[data-testid="settings-assetgc-preview-panel"]'), (v) => v === true, 8000);
    check('P1-2 点预览出预览面板', panel.ok, String(panel.ok));
    const meta = await domText(page, '[data-testid="settings-assetgc-meta"]');
    check('P1-3 面板放行条数=2（仅孤儿；1.3KB 合计）', /文件\s*2\s*个/.test(meta) && /1\.3\s*KB/.test(meta), `meta=${meta}`);
    const ret = await domText(page, '[data-testid="settings-assetgc-retention"]');
    check('P1-4 保护期 30 天 + 非寻址名保留明示', /30/.test(ret), `ret=${ret}`);
    const pv = await page.evaluate(() => window.septcats.assetgc.preview());
    check('P1-5 IPC 预览对账：cands=5 del=2 held=3(ref=3) refs=3 blind=false bytes=1300',
      pv?.candidates === 5 && pv?.deletable === 2 && pv?.held === 3 && pv?.heldByReason?.referenced === 3
      && pv?.referencedHashes === 3 && pv?.referencesComplete === true && pv?.estimatedBytes === byteSum, JSON.stringify(pv));

    STEP = 'P2|取消零删';
    await clickTestId(page, 'settings-assetgc-cancel');
    await wait(800);
    check('P2-1 取消后 5 个文件全在（零删除）', [H_REF1, `${H_REF3}.png`, H_REF2, H_ORPHAN1, H_ORPHAN2].every((n) => statSync(join(ATT, n)).isFile()), 'all present');
    check('P2-2 取消后面板收起', (await domHas(page, '[data-testid="settings-assetgc-preview-panel"]')) === false, 'panel gone');

    STEP = 'P3|确认真删';
    await clickTestId(page, 'settings-assetgc-preview');
    await poll(() => domHas(page, '[data-testid="settings-assetgc-preview-panel"]'), (v) => v === true, 8000);
    await clickTestId(page, 'settings-assetgc-confirm');
    const done = await poll(() => domHas(page, '[data-testid="settings-assetgc-done"]'), (v) => v === true, 12000);
    check('P3-1 确认后出「完成」反馈', done.ok, String(done.ok));
    await wait(1200);
    const goneOk = !statExists(join(ATT, H_ORPHAN1)) && !statExists(join(ATT, H_ORPHAN2));
    check('P3-2 两个孤儿文件已真删', goneOk, `${H_ORPHAN1.slice(0, 8)}=${statExists(join(ATT, H_ORPHAN1))} ${H_ORPHAN2.slice(0, 8)}=${statExists(join(ATT, H_ORPHAN2))}`);
    const keepOk = readFileSync(join(ATT, H_REF1)).equals(Buffer.alloc(111, 0x2a))
      && readFileSync(join(ATT, `${H_REF3}.png`)).equals(Buffer.alloc(333, 0x2a))
      && readFileSync(join(ATT, H_REF2)).equals(Buffer.alloc(222, 0x2a));
    check('P3-3 被引用 3 文件逐字节完好（含 .png 变体名）', keepOk, 'bytes match');
    const runPv = await page.evaluate(() => window.septcats.assetgc.preview());
    check('P3-4 删后再预览=空（del=0 held=3）', runPv?.deletable === 0 && runPv?.candidates === 3 && runPv?.held === 3, JSON.stringify(runPv));

    STEP = 'P4|失明面';
    // 新摆一个孤儿：锁页使「扫描看不见其引用」无从谈起 → 它应被 blind 扣留而非放行
    const H_ORPHAN3 = fixtureHash('probe-orphan3');
    put(H_ORPHAN3, 500);
    const lockRes = await page.evaluate(async (id) => window.septcats.lock.setPass({ pageId: id, pass: 't83-probe-1234' }), ids.pageLock);
    check('P4-1 锁页成功（setPass 返回恢复码）', typeof lockRes?.recoveryCode === 'string' && lockRes.recoveryCode.length > 0, 'ok');
    const blindPv = await page.evaluate(() => window.septcats.assetgc.preview());
    // 注意：H_REF2 仍算 referenced——op_ledger 保留其历史 op（重放会重建块=引用仍有效，设计如此）
    check('P4-2 锁页后 preview：del=0 新孤儿被 blind 扣留（blind=1）',
      blindPv?.deletable === 0 && blindPv?.referencesComplete === false && blindPv?.heldByReason?.blind === 1, JSON.stringify(blindPv));
    await clickTestId(page, 'settings-assetgc-preview');
    await poll(() => domHas(page, '[data-testid="settings-assetgc-preview-panel"]'), (v) => v === true, 8000);
    const blindNote = await domHas(page, '[data-testid="settings-assetgc-blind"]');
    check('P4-3 面板失明警示在场', blindNote === true, 'blind note');
    check('P4-4 可删=0 时确认钮禁用', (await confirmDisabled(page)) === true, 'disabled');
    await clickTestId(page, 'settings-assetgc-cancel');
    const blindRun = await page.evaluate(() => window.septcats.assetgc.run());
    check('P4-5 失明态 run 也零删除（IPC 直调仍守）', blindRun?.deletedFiles === 0 && [H_REF1, H_REF2, `${H_REF3}.png`].every((n) => statExists(join(ATT, n))), JSON.stringify(blindRun));

    STEP = 'P5|解锁复原';
    await page.evaluate(async (a) => window.septcats.lock.remove({ pageId: a.id, pass: 't83-probe-1234' }), { id: ids.pageLock });
    const unPv = await page.evaluate(() => window.septcats.assetgc.preview());
    check('P5-1 解锁后引用面复原 + 新孤儿恢复可删（refs=3 del=1）',
      unPv?.referencedHashes === 3 && unPv?.referencesComplete === true && unPv?.deletable === 1, JSON.stringify(unPv));
    const unRun = await page.evaluate(() => window.septcats.assetgc.run());
    check('P5-2 run 删掉恢复放行的孤儿（del=1，其余 3 引用完好）',
      unRun?.deletedFiles === 1 && !statExists(join(ATT, H_ORPHAN3))
      && [H_REF1, H_REF2, `${H_REF3}.png`].every((n) => statExists(join(ATT, n))), JSON.stringify(unRun));

    STEP = 'P6|隔离';
    check('P6-1 真实根未被触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);
  } catch (e) {
    check('EXC 探针整体不抛', false, String(e).slice(0, 200));
  } finally {
    const pass = assertions.filter((x) => x.ok).length;
    const fail = assertions.filter((x) => !x.ok).length;
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, 't83-02-results.json'), JSON.stringify({ task: 'T83-02', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T83-02：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 12) console.log(`FATAL 断言条数 ${assertions.length} < 12（静默蒸发守卫）`);
    await gracefulExit(page, child).catch(() => undefined);
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
    process.exitCode = fail === 0 && assertions.length >= 12 ? 0 : 1;
  }
}
function statExists(p) { try { return statSync(p).isFile(); } catch { return false; } }
void main();
