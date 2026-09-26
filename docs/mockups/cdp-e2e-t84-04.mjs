/* T84-04 双端真机探针（附件同步 + §9.3 注入矩阵补 7.8 附件条目：PRD-T84 DoD 1-7）
 * 夹具 = 三独立数据根（A/B/C 各自 DB + DPAPI 凭据）+ settings.sync.folder 同指 SHARED
 *        （同盘目录=网盘客户端的本地替身，与 M8b twin 先例同构）；env 钩子 merge=3s。
 * 腿：F1 加密双端 E2E（A 开加密推 files/*.enc → B 导恢复码拉回 100MB 字节等值；
 *        传输窗口 electron 进程 CPU<20% = DoD 2 流式不轰炸）
 *    F2 混态（B 关加密推明文 → A 加密态照收，sha 复验闸）
 *    F3 暂停/恢复（setEnabled false 即停不推；.part 残尸恢复后被 sweep）
 *    F4 垃圾注入（files/ 真名假内容 → sha 不符隔离，不落活附件目录）
 *    F5 S10（C 无码首触 → key_mismatch 红条非静默；非法码拒；真码导入 → 全量追平）
 *    F6 双钉（真实档案根零触碰；files/ 只增不删）
 * 纪律：A/B/C 全在 _scratch；只经公开桥面 settings.{get,patch} / sync.{setEnabled,now,
 *       status,exportRecovery,importRecovery} / pages.* / blocks.commit / workspaces.list。
 */
import { createHash } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't84-04-twin');
const SHARED = join(RUN, 'netdisk'); // 网盘目录替身
const FILES = join(SHARED, 'files'); // 附件落点（runtime syncRoot/files）
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const MARKER = 't84-04-twin';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const WINS = [
  { name: 'A', root: join(RUN, 'root-a'), ud: join(RUN, 'ud-a'), port: 9261 },
  { name: 'B', root: join(RUN, 'root-b'), ud: join(RUN, 'ud-b'), port: 9262 },
  { name: 'C', root: join(RUN, 'root-c'), ud: join(RUN, 'ud-c'), port: 9263 },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const fwd = (s) => String(s).replace(/\\/g, '/');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
function coreCount() {
  try { return Math.max(1, Number(execSync('powershell -NoProfile -Command "[Environment]::ProcessorCount"', { encoding: 'utf8' }).trim()) || 8); } catch { return 8; }
}
const CORES = coreCount();
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  try {
    const out = execSync(`wmic process where "name='electron.exe'" get processid,commandline /format:list`, { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes(MARKER)) killTree(Number(m[1])); cur = ''; }
    }
  } catch { /* wmic 缺失 */ }
}
function cpuTicks() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Measure-Object -Sum CPU | ForEach-Object { $_.Sum }"', { encoding: 'utf8' });
    const v = Number(String(out).trim().split(/\r?\n/).pop());
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}
async function poll(fn, ms, every = 1500) {
  const t0 = Date.now();
  for (;;) { let ok = false; try { ok = await fn(); } catch { ok = false; } if (ok) return true; if (Date.now() - t0 > ms) return false; await wait(every); }
}
async function launch(w) {
  const out = openSync(join(RUN, `stdout-${w.name}.log`), 'w');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${w.ud}`, `--remote-debugging-port=${String(w.port)}`, `--remote-debugging-address=127.0.0.1`], {
    cwd: APPDIR, stdio: ['ignore', out, out], env: { ...process.env, SEPTCATS_SYNC_MERGE_MS: '3000' },
  });
  child.on('exit', (code) => logSync(`!! ${w.name} 进程退出 code=${String(code)}（证据在 stdout-${w.name}.log）`));
  let browser = null;
  for (let i = 0; i < 50; i += 1) { await wait(900); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(w.port)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error(`${w.name} CDP 连不上`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 40000 });
  return { child, browser, page };
}
const assertions = [];
let STEP = '-';
// process.exit 会截断异步 stdout 缓冲（重定向到文件时）→ 双写同步日志钉
const OUTLOG = join(RUN, 'result.log');
function logSync(line) { try { appendFileSync(OUTLOG, `${line}\n`); } catch { /* RUN 未建 */ } }
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); const t = `${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`; console.log(t); logSync(t); }
const syncNow = (p) => p.evaluate(() => window.septcats.sync.now()).catch(() => undefined);
const syncStatus = (p) => p.evaluate(() => window.septcats.sync.status()).catch((e) => ({ err: String(e) }));
const patch = (p, o) => p.evaluate((x) => window.septcats.settings.patch(x), o);
async function refBlock(p, hashName, slot) {
  // 在本机建页并 commit 一个引用 attachment://<hash> 的 file 块（引用闸的真源）
  return p.evaluate(async (a) => {
    const c = await window.septcats.pages.create({ parentId: null });
    await window.septcats.pages.rename({ id: c.id, title: `T84-${a.slot}页` });
    const ts = Date.now().toString(36);
    const ops = [{ op_id: `r${a.slot}${ts}`, lamport: { c: 1, d: `t8404${a.slot}` }, at: Date.now(), actor: `t8404${a.slot}`,
      target: { table: 'block', id: `r${a.slot}${ts}` }, kind: 'upsert',
      payload: { page_id: c.id, type: 'file', props: {}, content: { src: `attachment://${a.N}` }, parent_id: null, sort_key: 'A00000000', alive: 1 } }];
    const n = await window.septcats.blocks.commit({ ops }); // 契约：直接返回 applied 数
    return { pageId: c.id, n };
  }, { N: hashName, slot });
}
function logHit(root, kw) {
  try {
    const logs = join(root, 'logs');
    if (!existsSync(logs)) return false;
    for (const f of readdirSync(logs)) {
      try { if (readFileSync(join(logs, f), 'utf8').includes(kw)) return true; } catch { /* 占用中跳过 */ }
    }
    return false;
  } catch { return false; }
}
const byteEq = (dst, src) => existsSync(dst) && sha(readFileSync(dst)) === sha(src);

async function main() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  // 工作区名钉死（同根名会撞 workspace.name 唯一约束 → 首列冲突=运行时装不上）
  const NAMES = { A: 't8404wsA', B: 't8404wsB', C: 't8404wsC' };
  mkdirSync(SHARED, { recursive: true });
  for (const w of WINS) {
    mkdirSync(join(w.root, 'attachments'), { recursive: true }); mkdirSync(w.ud, { recursive: true });
    writeFileSync(join(w.ud, 'septcats.settings.json'), JSON.stringify({
      schema: 1, rootPath: fwd(w.root), sync: { enabled: false, encrypt: false, gc: false, folder: fwd(SHARED) },
    }));
  }
  const ATA = WINS.map((w) => join(w.root, 'attachments'));
  const stampBefore = realRootStamp();

  const A = await launch(WINS[0]);
  const B = await launch(WINS[1]);
  let C = null;
  const big = Buffer.alloc(100 * 1024 * 1024, 0x41); big.write('septcats-t84-04-big-A1-', 0);
  const N1 = `${sha(big)}.png`;
  try {
    STEP = 'F1|加密双端E2E';
    await patch(A.page, { sync: { enabled: true, encrypt: true } });
    await A.page.evaluate(() => window.septcats.sync.setEnabled({ on: true })).catch(() => undefined);
    const rec = await A.page.evaluate(() => window.septcats.sync.exportRecovery());
    check('F1-1 A 恢复码导出（DEK 就位）', typeof rec?.code === 'string' && rec.code.length > 10, `len=${String((rec?.code ?? '').length)}`);
    await patch(B.page, { sync: { encrypt: true } });
    await B.page.evaluate(() => window.septcats.sync.setEnabled({ on: true })).catch(() => undefined);
    const impB = await B.page.evaluate((c) => window.septcats.sync.importRecovery({ code: c }), rec.code);
    check('F1-2 B 导入恢复码 ok（同 DEK 接管）', impB?.ok === true, JSON.stringify(impB).slice(0, 60));
    writeFileSync(join(ATA[0], N1), big);
    const rb = await refBlock(A.page, N1, 'a');
    check('F1-3 A 引用块 commit 成功', rb?.n === 1, `applied=${String(rb?.n)}（number 契约）`);
    const cpuT0 = cpuTicks(); const wallT0 = Date.now();
    await syncNow(A.page);
    const upOk = await poll(() => existsSync(join(FILES, `${N1}.enc`)), 150_000, 1200);
    await syncNow(B.page);
    const dlOk = await poll(() => byteEq(join(ATA[1], N1), big), 180_000, 2000);
    const busy = ((cpuTicks() - cpuT0) / Math.max(1, (Date.now() - wallT0) / 1000)) / CORES * 100;
    check('F1-4 上行：files/A1.enc 密文信封出现（100MB 流式）', upOk, N1.slice(0, 12));
    check('F1-5 下行：B 经恢复码解出 A1 字节等值', dlOk, N1.slice(0, 12));
    check('F1-6 传输窗口 electron CPU<20%（流式分块不轰炸）', busy < 20, `${busy.toFixed(1)}%（${CORES}核折算）`);
    const stA = await syncStatus(A.page);
    check('F1-7 附件进度字段在位', stA.attachments != null, JSON.stringify(stA).slice(0, 160));

    STEP = 'F2|混态';
    await patch(B.page, { sync: { encrypt: false } });
    const b1 = Buffer.from(`septcats-t84-04-B1-${String(Date.now())}`);
    const NB = `${sha(b1)}.png`;
    writeFileSync(join(ATA[1], NB), b1);
    await refBlock(B.page, NB, 'b');
    await syncNow(B.page);
    const plainUp = await poll(() => existsSync(join(FILES, NB)), 120_000);
    const mixDown = await poll(() => byteEq(join(ATA[0], NB), b1), 150_000, 2000);
    check('F2-1 B 明文推 files/B1（加密关闭形态分账）', plainUp, NB.slice(0, 12));
    check('F2-2 A 加密态照收远端明文（sha 复验闸）', mixDown, NB.slice(0, 12));

    STEP = 'F3|暂停/恢复/残尸';
    await A.page.evaluate(() => window.septcats.sync.setEnabled({ on: false })).catch(() => undefined);
    await wait(2000);
    const a2 = Buffer.from(`septcats-t84-04-A2-paused-${String(Date.now())}`);
    const N2 = `${sha(a2)}.png`;
    writeFileSync(join(ATA[0], N2), a2);
    await refBlock(A.page, N2, 'c');
    writeFileSync(join(FILES, `${N2}.part-dead`), 'garbage'); // 模拟上轮半途死残尸
    await syncNow(A.page);
    await wait(12_000);
    check('F3-1 暂停：A2 不上行（enabled=false 闸）', !existsSync(join(FILES, N2)), 'files/A2 缺席');
    await A.page.evaluate(() => window.septcats.sync.setEnabled({ on: true })).catch(() => undefined);
    const resumeUp = await poll(() => existsSync(join(FILES, N2)) && !existsSync(join(FILES, `${N2}.part-dead`)), 120_000);
    check('F3-2 恢复：A2 上行 + .part 残尸被 sweep', resumeUp, `${N2.slice(0, 12)} 且残尸清除`);

    STEP = 'F4|垃圾隔离';
    const bad = Buffer.from('septcats-t84-04-corrupt-payload');
    const NBD = `${sha(Buffer.concat([bad, Buffer.from('x')]))}.png`; // 引用「真」hash
    writeFileSync(join(FILES, NBD), bad); // 网盘位：真名 + 假内容
    await refBlock(A.page, NBD, 'd');
    await syncNow(A.page);
    const iso = await poll(() => !existsSync(join(ATA[0], NBD)) && logHit(WINS[0].root, '隔离'), 150_000, 2000);
    check('F4-1 垃圾注入：sha 不符不落活附件+日志隔离留痕', iso, NBD.slice(0, 12));

    STEP = 'F5|S10 恢复码';
    C = await launch(WINS[2]);
    await patch(C.page, { sync: { encrypt: true } });
    await C.page.evaluate(() => window.septcats.sync.setEnabled({ on: true })).catch(() => undefined);
    await syncNow(C.page);
    const km = await poll(async () => (await syncStatus(C.page)).state === 'key_mismatch', 120_000, 2000);
    check('F5-1 无码首触：key_mismatch 红条态（明确失败非静默）', km, 'C 自产 DEK ≠ A 信封 key_id');
    const badImp = await C.page.evaluate(() => window.septcats.sync.importRecovery({ code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZ' })).catch((e) => ({ err: String(e) }));
    check('F5-2 非法恢复码拒收（ok≠true 或抛错）', badImp?.ok !== true, JSON.stringify(badImp).slice(0, 90));
    const okImp = await C.page.evaluate((c) => window.septcats.sync.importRecovery({ code: c }), rec.code);
    check('F5-3 真码导入 ok（恢复码流程走通）', okImp?.ok === true, JSON.stringify(okImp).slice(0, 60));
    const catchA1 = await poll(() => byteEq(join(ATA[2], N1), big), 240_000, 3000);
    const stC = await syncStatus(C.page);
    const treeC = await C.page.evaluate(async () => { const wid = (await window.septcats.workspaces.list()).activeId; return wid === null ? [] : (await window.septcats.pages.tree({ workspaceId: wid })).map((x) => x.title); }).catch(() => []);
    check('F5-4 追平：C 解出 A1（100MB 逐字节）', catchA1, N1.slice(0, 12));
    check('F5-5 段层同追：C 树含 A 建的引用页', treeC.some((t) => String(t).includes('T84-a页')), String(treeC).slice(0, 100));
    check('F5-6 追平后 C 离开 key_mismatch', stC.state !== 'key_mismatch', String(stC.state));

    STEP = 'F6|双钉';
    check('F6-1 真实数据根零触碰', realRootStamp() === stampBefore, `before=${stampBefore} after=${realRootStamp()}`);
    check('F6-2 files/ 只增不删（A1.enc 全程在场）', existsSync(join(FILES, `${N1}.enc`)), 'add-only 口径');
  } finally {
    for (const h of [A, B, C]) {
      if (h === null || h === undefined) continue;
      try { await h.page.evaluate(() => window.close()); } catch { /* */ }
      await wait(1500); killTree(h.child.pid);
    }
    killStaleApp();
  }
  const fails = assertions.filter((x) => !x.ok);
  const tail = `\n== T84-04 双端探针：${String(assertions.length)} 断言 / ${String(fails.length)} 失败 ==`;
  console.log(tail); logSync(tail);
  if (assertions.length < 16) { console.error('FATAL: 断言数 <16（静默蒸发守卫）'); process.exit(2); }
  process.exit(fails.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); logSync(`FATAL ${String(e && e.stack || e).slice(0, 500)}`); killStaleApp(); process.exit(3); });
