/* T84-02 真机探针（附件同步 files/ 引擎端到端：上行→下行→加密形态重推）
 * 链：E0 夹具（UD 指 scratch 数据根；ATA 放 被引用A1+未引用A2 两附件；TARGET 空）→
 *     E1 进程内 patch{sync.folder=TARGET}→commit 引用 A1 的块→sync.now →
 *        files/A1 字节等值出现（上行）；A2 不上行（引用闸）；status.attachments 在位 →
 *     E2 删 ATA/A1（模拟"B 机缺件"）→ TARGET 放 B1（模拟"B 已上传"）→ sync.now →
 *        ATA/A1 从 files/ 复验拉回（下行）+ ATA/B1 拉取字节等值 →
 *     E3 patch{sync.encrypt:true}+exportRecovery → restart（DEK 同 UD 存留）→
 *        files/A1.enc 出现（加密形态重推=pushedOk 形态分账的铁证）→ 再删 ATA 的
 *        A1/B1 → sync.now → A1 走密文信封拉回、B1 走明文拉回（混态口径），字节等值 →
 *     E4 真实档案根零触碰（双钉纪律）。
 * 桥面：settings.{get,patch} / sync.{now,status,restart,exportRecovery} / blocks.commit。
 * 双钉：--user-data-dir=<scratch ud> + ud 内 rootPath→scratch data。DEK 走本机 DPAPI
 * （CurrentUser），同用户两进程可互解 = 加密腿成立的前提。
 */
import { createHash } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't84-02-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const ATA = join(ROOT, 'attachments');
const TARGET = join(RUN, 'netdisk', 'SeptcatsSync'); // 模拟网盘同步目录
const FILES = join(TARGET, 'files'); // 附件落点（runtime rootDir=TARGET 生效时）
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9254;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
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
      else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes('t84-02-e2e')) killTree(Number(m[1])); cur = ''; }
    }
  } catch { /* wmic 缺失 */ }
}
async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, `--remote-debugging-address=127.0.0.1`], {
    cwd: APPDIR,
    stdio: 'ignore',
    env: { ...process.env, SEPTCATS_SYNC_MERGE_MS: '3000' }, // 探针钩子：merge 周期 3s
  });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function poll(pred, ms, every = 1000) {
  const t0 = Date.now();
  for (;;) { if (pred()) return true; if (Date.now() - t0 > ms) return false; await wait(every); }
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const eqFile = (a, b) => existsSync(a) && existsSync(b) && sha(readFileSync(a)) === sha(readFileSync(b));

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

async function main() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  for (const d of [UD, ROOT, ATA, TARGET]) mkdirSync(d, { recursive: true });
  const TARGET_FWD = TARGET.replace(/\\/g, '/');
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({
    schema: 1, rootPath: ROOT.replace(/\\/g, '/'),
    sync: { enabled: true, encrypt: false, gc: false, folder: TARGET_FWD },
  }));
  const stampBefore = realRootStamp();

  // 附件夹具：A1 将被块引用；A2 永远不被引用
  const A1 = Buffer.concat([Buffer.from('septcats-attach-A1-'), Buffer.alloc(70 * 1024, 0x41)]);
  const A2 = Buffer.from('septcats-attach-A2-unreferenced');
  const N1 = `${sha(A1)}.bin`;
  const N2 = `${sha(A2)}.bin`;
  writeFileSync(join(ATA, N1), A1);
  writeFileSync(join(ATA, N2), A2);

  let { child, browser, page } = await launch();
  const fwd = (s) => s.replace(/\\/g, '/');
  try {
    STEP = 'E1|上行';
    const target = fwd(TARGET);
    const s1 = await page.evaluate(() => window.septcats.settings.get());
    check('E1-1 sync.folder 启动即=TARGET（夹具直写）', s1.sync.folder === TARGET_FWD && s1.sync.enabled === true, JSON.stringify(s1.sync));
    const TS = Date.now().toString(36);
    const ids = await page.evaluate(async (a) => {
      const c = await window.septcats.pages.create({ parentId: null });
      await window.septcats.pages.rename({ id: c.id, title: `T84附件页${a.TS}` });
      const ops = [
        { op_id: `at1${a.TS}`, lamport: { c: 1, d: 't8402aaa' }, at: Date.now(), actor: 't8402aaa', target: { table: 'block', id: `at1${a.TS}` }, kind: 'upsert',
          payload: { page_id: c.id, type: 'file', props: {}, content: { src: `attachment://${a.N1}` }, parent_id: null, sort_key: 'A00000000', alive: 1 } },
      ];
      const n = await window.septcats.blocks.commit({ ops });
      return { n, pageId: c.id };
    }, { TS, N1 });
    check('E1-2 引用块 commit 成功', ids.n === 1, JSON.stringify(ids));
    await page.evaluate(() => window.septcats.sync.now()).catch(() => undefined);
    const up = await poll(() => existsSync(join(FILES, N1)) && eqFile(join(FILES, N1), join(ATA, N1)), 90_000);
    check('E1-3 上行：files/A1 出现且字节等值', up, `${N1.slice(0, 10)}…`);
    check('E1-4 引用闸：未引用的 A2 不在 files/', !existsSync(join(FILES, N2)), N2.slice(0, 10));
    const st = await page.evaluate(() => window.septcats.sync.status());
    check('E1-5 status.attachments 字段在位', st.attachments !== undefined && st.attachments !== null, JSON.stringify(st.attachments));

    STEP = 'E2|下行';
    // B1 由"乙机"上传到网盘（探针代写），A 机本地删 A1 模拟缺件 → sync 拉回
    const B1 = Buffer.concat([Buffer.from('septcats-attach-B1-'), Buffer.alloc(9 * 1024, 0x42)]);
    const NB = `${sha(B1)}.dat`;
    writeFileSync(join(FILES, NB), B1);
    rmSync(join(ATA, N1));
    await page.evaluate(() => window.septcats.sync.now()).catch(() => undefined);
    const dlA = await poll(() => existsSync(join(ATA, N1)) && sha(readFileSync(join(ATA, N1))) === sha(A1), 90_000);
    const dlB = await poll(() => existsSync(join(ATA, NB)) && sha(readFileSync(join(ATA, NB))) === sha(B1), 90_000);
    check('E2-1 下行：本地缺的 A1 从 files/ 复验拉回', dlA, N1.slice(0, 10));
    check('E2-2 下行：远端新到的 B1 拉进本地', dlB, NB.slice(0, 10));
    check('E2-3 files/ 只增不删：A1 原件仍在网盘位', existsSync(join(FILES, N1)), 'files/A1');

    STEP = 'E3|加密形态重推';
    const s3 = await page.evaluate(() => window.septcats.settings.patch({ sync: { encrypt: true } }));
    check('E3-0 encrypt 开关落盘', s3.sync.encrypt === true, JSON.stringify(s3.sync));
    // encrypt 开关 = cycleBody 动态读设置（runtime 既有口径），下一轮（3s 钩子周期）
    // 自动 ensureDek + 附件引擎 encNow=true → 直接观测 .enc 重推，无需重启。
    const rec = await page.evaluate(() => window.septcats.sync.exportRecovery()).catch((e) => ({ err: String(e) }));
    check('E3-1 恢复码可导出（DEK 已生成）', typeof rec.code === 'string' && rec.code.length > 10, JSON.stringify(rec).slice(0, 80));
    await page.evaluate(() => window.septcats.sync.now()).catch(() => undefined);
    const encUp = await poll(() => existsSync(join(FILES, `${N1}.enc`)), 120_000);
    check('E3-3 明文推过的 A1 加密形态重推 .enc（形态分账）', encUp, `${N1.slice(0, 10)}.enc`);
    // 再删本地 A1/B1 → A1 从 .enc 密文信封拉回；B1 仍明文 → 混态拉回
    rmSync(join(ATA, N1), { force: true });
    rmSync(join(ATA, NB), { force: true });
    await page.evaluate(() => window.septcats.sync.now()).catch(() => undefined);
    const dlA2 = await poll(() => existsSync(join(ATA, N1)) && sha(readFileSync(join(ATA, N1))) === sha(A1), 120_000);
    const dlB2 = await poll(() => existsSync(join(ATA, NB)) && sha(readFileSync(join(ATA, NB))) === sha(B1), 120_000);
    check('E3-4 加密腿下行：A1 经 SCAF1 信封拉回且字节等值', dlA2, 'A1 via .enc');
    check('E3-5 混态腿下行：远端明文 B1 照收（sha 复验闸）', dlB2, 'B1 via plain');

    STEP = 'E4|隔离钉';
    check('E4-1 真实数据根零触碰', realRootStamp() === stampBefore, `before=${stampBefore} after=${realRootStamp()}`);
  } finally {
    try { await page.evaluate(() => window.close()); } catch { /* */ }
    for (let i = 0; i < 12; i += 1) {
      await wait(500);
      try { execSync(`tasklist /FI "PID eq ${String(child?.pid)}" /NH | findstr ${String(child?.pid)}`, { stdio: 'ignore' }); } catch { break; }
    }
    if (child !== null && child !== undefined) killTree(child.pid);
    killStaleApp();
  }

  const fails = assertions.filter((a) => !a.ok);
  console.log(`\n== T84-02 探针：${String(assertions.length)} 断言 / ${String(fails.length)} 失败 ==`);
  if (assertions.length < 12) { console.error('FATAL: 断言数 <12（静默蒸发守卫）'); process.exit(2); }
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); killStaleApp(); process.exit(3); });
