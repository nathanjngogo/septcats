/* T80-02 真机探针骨架（便携包导入）——等 CB 交付后按真实契约补实再首跑
 * 五段式：①roundtrip：T80-01 导出夹具 zip → import plan → execute → 页/块/附件计数等
 * ②安全闸：checksums 篡改拒 / zip slip 名拒 / 半截 zip 结构化错误（禁白屏）
 * ③三段式回滚：重放中途失败 → 原库逐字节还原（备份 bak-portable-<ts> 在场）
 * ④非空库冲突预检拒（confirm 前）；幂等：同包二次导入同结果
 * ⑤真实根 untouched（双钉纪律）。
 * 双钉纪律内置：--user-data-dir=<scratch ud> + UD/septcats.settings.json rootPath→scratch 独立目录。
 * ⚠ 探针只读写 scratch 夹具，绝不触碰 C:/Users/Administrator/.septcats。
 * @probe-readonly=false（写夹具库）
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't80-02-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');          // 夹具 A：源库（先导出）
const ROOT2 = join(RUN, 'data2');        // 夹具 B：目标库（导入侧）
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t80-02');
const PORT = 9242;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const TS = Date.now().toString(36);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
// sha 用于附件/原库字节级对照
const sha = (b) => createHash('sha256').update(b).digest('hex');
void sha;
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

/** 夹具：UD settings 钉 rootPath → ROOT（导入执行时按任务书应切换/替换——以 CB 真实契约为准补实）。 */
function seedFixtures() {
  rmSync(RUN, { recursive: true, force: true });
  for (const d of [UD, ROOT, ROOT2, SHOTS]) mkdirSync(d, { recursive: true });
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
  return { child, browser, page };
}

async function main() {
  seedFixtures();
  const rootBefore = rootMtime();
  const { child, browser, page } = await launch();
  try {
    await wait(3000);

    // ---- P1 源侧建夹具页+导出（复用 T80-01 链，拿真实 zip）----
    STEP = 'P1|导出夹具';
    const src = await page.evaluate(async (tn) => {
      const pg = await window.septcats.pages.create({ title: `T80-02源页${tn}` });
      return pg.id;
    }, TS);
    info('源页 id', src);
    const EXP1 = join(RUN, 'export-src');
    mkdirSync(EXP1, { recursive: true });
    const zip = await page.evaluate(async (dirArg) => window.septcats.portable.confirm({ dir: dirArg }), EXP1.replace(/\\/g, '/'));
    const zipOk = typeof zip?.path === 'string' && (() => { try { return statSync(zip.path).size > 0; } catch { return false; } })();
    check('P1-1 导出 zip 落盘非空（T80-01 链复用）', zipOk === true, JSON.stringify({ path: zip?.path, counts: zip?.counts }));

    // ---- P2 import plan：预检报告结构（条目/checksums/目标库现状/schema 版本）----
    STEP = 'P2|plan';
    check('P2-1 plan 返回结构化预检', false, 'skeleton——以 CB shared/portable.ts 真实契约补实');

    // ---- P3 execute 三段式：备份→重放→回滚 ----
    STEP = 'P3|execute';
    // TODO: 备份名 bak-portable-<ts> 在场；页/块/附件计数=源侧；失败注入（篡改段文件字节触发拒）→ 原库逐字节还原断言（sha256 前后等）
    check('P3-1 execute 重放后计数等', false, 'skeleton');

    // ---- P4 安全闸 ----
    STEP = 'P4|安全闸';
    // TODO: checksums 篡改 zip → plan 拒；zip slip 条目名 → 拒；半截 zip → 结构化错误码；encrypted=true → E_PORTABLE_ENCRYPTED_UNSUPPORTED；非空库无 confirm → 冲突拒
    check('P4-1 checksums 篡改整体拒', false, 'skeleton');

    // ---- P5 幂等 + 存活 + 真实根 ----
    STEP = 'P5|幂等存活';
    // TODO: 同包二次 execute → 结果逐值等；重启后页仍在
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('P5-1 应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't80-02-results.json'), JSON.stringify({ task: 'T80-02', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T80-02：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 10) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 10（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    process.exitCode = fail === 0 && assertions.length >= 10 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });