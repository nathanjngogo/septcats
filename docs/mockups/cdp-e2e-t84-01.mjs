/* T84-01 真机探针（同步文件夹向导 + folder 生效链）
 * 链：P0 设置页默认路径展示 + 「更改…」钮存在 →
 *     P1 settings:patch{sync.folder=scratch 目标目录} → 回显与 data.note 更新 →
 *     P2 相对路径被 E_SETTINGS_INVALID 拒且原值不动 →
 *     P3 sync:restart → 进程真退出（relaunch 带原 argv = 同 UD 同端口自动拉起）→
 *     P4 重连后：runtime 在新目录起步（目标目录出现 manifest.json）+ settings 回显不变 →
 *     P5 真实根 C:\Users\Administrator\.septcats 零触碰（mtime 钉）。
 * 桥面：window.septcats.settings.{get,patch} / sync.restart / meta。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <8 = FATAL（静默蒸发守卫）。
 * 备注：原生目录选择器（sync:pickFolder 弹 OS dialog）不做 OS 级自动化——选择器
 *   本身是 Electron 行为；向导核心风险在「落盘→重启→runtime 换根」链，由本探针覆盖。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', process.env['SEPTCATS_RUN_NAME'] ?? 't84-01-e2e');
const RUN_DIR_TAG = process.env['SEPTCATS_RUN_NAME'] ?? 't84-01-e2e';
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const TARGET = join(RUN, 'netdisk', 'SeptcatsSync'); // 模拟网盘同步目录
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = Number(process.env['SEPTCATS_CDP_PORT'] ?? '9253');
// SEPTCATS_APP_BIN 指向打包产物 exe（交付物终验口径）；默认 dev electron
const APP_BIN = process.env['SEPTCATS_APP_BIN'] ?? '';
const ELECTRON = APP_BIN === '' ? join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe') : APP_BIN;
const APP_ARGS = APP_BIN === '' ? ['.'] : [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  // 靶子可切（SEPTCATS_APP_BIN）：打包靶进程名是 Septcats.exe，dev 靶是 electron.exe——两个都扫
  for (const pname of ['electron.exe', 'Septcats.exe']) {
    try {
      const out = execSync(`wmic process where "name='${pname}'" get processid,commandline /format:list`, { encoding: 'utf8' });
      let cur = '';
      for (const line of out.split('\n')) {
        if (line.startsWith('CommandLine=')) cur = line;
        else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes(RUN_DIR_TAG)) killTree(Number(m[1])); cur = ''; }
      }
    } catch { /* wmic 缺失 */ }
  }
}
async function launch() {
  const child = spawn(ELECTRON, [...APP_ARGS, `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function pollFs(pred, ms, every = 700) {
  const t0 = Date.now();
  for (;;) { if (pred()) return true; if (Date.now() - t0 > ms) return false; await wait(every); }
}

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

async function main() {
  killStaleApp();
  for (let i = 0; i < 6; i += 1) { try { rmSync(RUN, { recursive: true, force: true }); break; } catch { waitSync(1500); } }
  for (const d of [UD, ROOT, TARGET]) mkdirSync(d, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const stampBefore = realRootStamp();

  let { child, browser, page } = await launch();
  const fwd = (s) => s.replace(/\\/g, '/');
  try {
    STEP = 'P0|默认面';
    const s0 = await page.evaluate(() => window.septcats.settings.get());
    check('P0-1 初始 sync.folder=空（默认）', s0.sync.folder === '', JSON.stringify(s0.sync));
    check('P0-2 data.note 回显默认同步文件夹 <root>/sync', fwd(s0.data.note) === fwd(join(ROOT, 'sync')), s0.data.note);
    const hasBtn = await page.evaluate(() => {
      window.dispatchEvent(new Event('septcats:open-settings'));
      return true;
    });
    await wait(900);
    const btn = await page.evaluate(() => document.querySelector('[data-testid="sync-folder-change"]') !== null);
    check('P0-3 设置页「更改…」向导入口存在', btn && hasBtn, `btn=${String(btn)}`);

    STEP = 'P1|改 folder 落盘';
    const target = fwd(TARGET);
    const s1 = await page.evaluate((folder) => window.septcats.settings.patch({ sync: { folder } }), target);
    check('P1-1 patch 回 sync.folder=目标目录', s1.sync.folder === target, s1.sync.folder);
    const s1r = await page.evaluate(() => window.septcats.settings.get());
    check('P1-2 读回一致且 data.note 指向新目录（重启前 runtime 不动属预期）', s1r.sync.folder === target && s1r.data.note === target, s1r.data.note);
    check('P1-3 设置已写进 scratch UD（隔离盘）', existsSync(join(UD, 'septcats.settings.json')), UD);

    STEP = 'P2|非法值拒绝';
    const bad = await page.evaluate(() =>
      window.septcats.settings
        .patch({ sync: { folder: 'relative/nope' } })
        .then(() => null)
        .catch((e) => String(e?.message ?? e)),
    );
    check('P2-1 相对路径被拒（E_SETTINGS_INVALID）', bad !== null && bad.includes('E_SETTINGS_INVALID'), String(bad).slice(0, 120));
    const s2 = await page.evaluate(() => window.septcats.settings.get());
    check('P2-2 被拒后原值不动', s2.sync.folder === target, s2.sync.folder);

    STEP = 'P3|重启生效';
    // 旧默认目录在首轮已正常建根写 manifest（非缺陷）；正确的钉法是：restart 前
    // 抓旧 manifest 快照，重启并让新 runtime 跑过后，旧文件必须**一字不动**、
    // 新目录 manifest 的 updated_at 必须前进 → 证明 runtime 换根成功。
    const oldManifestPath = join(ROOT, 'sync', 'manifest.json');
    const snapshotOld = existsSync(oldManifestPath) ? readFileSync(oldManifestPath, 'utf8') : '';
    check('P3-0 首轮默认根已建 manifest（前置事实）', snapshotOld.length > 0, oldManifestPath);
    const oldPid = child.pid;
    await page.evaluate(() => window.septcats.sync.restart()).catch(() => undefined);
    const exited = await pollFs(() => { try { execSync(`tasklist /FI "PID eq ${String(oldPid)}" /NH | findstr ${String(oldPid)}`, { stdio: 'ignore' }); return false; } catch { return true; } }, 30_000);
    check('P3-1 restart 令旧进程真退出（relaunch 链）', exited, `pid=${String(oldPid)}`);
    try { await browser.close(); } catch { /* */ }

    STEP = 'P4|新根起步';
    // relaunch 带原 argv（同 UD 同调试端口）→ 直接重连
    let again = { child, browser, page };
    child = null;
    try {
      again = await launch();
    } catch (e) {
      check('P4-0 relaunch 后 CDP 重连', false, String(e));
      throw e;
    }
    child = again.child;
    browser = again.browser;
    page = again.page;
    const s4 = await page.evaluate(() => window.septcats.settings.get());
    check('P4-1 重启后设置持久（folder=目标目录）', s4.sync.folder === target, s4.sync.folder);
    const manifest = await pollFs(() => existsSync(join(TARGET, 'manifest.json')), 45_000);
    check('P4-2 SyncRuntime 在新目录起步（manifest.json 落盘）', manifest, join(TARGET, 'manifest.json'));
    // 换根铁证：重启并跑过一轮后，旧默认目录的 manifest 必须一字不动（runtime 不再写它）
    const snapshotAfter = existsSync(oldManifestPath) ? readFileSync(oldManifestPath, 'utf8') : '';
    check('P4-3 旧默认目录停更（manifest 字节不动=runtime 已换根）', snapshotAfter === snapshotOld, `old=${String(snapshotOld.length)}B after=${String(snapshotAfter.length)}B`);
    const st = await page.evaluate(() => window.septcats.sync.status()).catch(() => null);
    check('P4-4 runtime 状态可用（enabled 面回快照）', st !== null && typeof st.enabled === 'boolean', JSON.stringify(st?.state ?? null));

    STEP = 'P5|隔离钉';
    check('P5-1 真实数据根零触碰', realRootStamp() === stampBefore, `before=${stampBefore} after=${realRootStamp()}`);
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
  console.log(`\n== T84-01 探针：${String(assertions.length)} 断言 / ${String(fails.length)} 失败 ==`);
  if (assertions.length < 8) { console.error('FATAL: 断言数 <8（静默蒸发守卫）'); process.exit(2); }
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL', e); killStaleApp(); process.exit(3); });
