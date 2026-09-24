/* T80 真机探针骨架（便携包导出）——等 T80-01 交付后按真实契约微调再首跑
 * 三段式：① 设置页入口链（预览→取消=零落盘）② IPC confirm(dir) 显式目录落盘取证
 * ③ 包内清单核（zip 条目=manifest+段+attachments；排除清单在场；checksums 逐条验）。
 * 双钉纪律内置：--user-data-dir=<scratch ud> + UD/septcats.settings.json rootPath→scratch。
 * ⚠ 探针只读夹具库，绝不触碰 C:/Users/Administrator/.septcats。 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't80-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const EXP = join(RUN, 'export-target');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t80');
const PORT = 9241;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const TS = Date.now().toString(36);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

/** 夹具：scratch 数据根 + 双钉（settings 在 Chromium UD 里，rootPath 指 scratch 独立目录）。 */
function seedFixtures() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(EXP, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({
    schema: 1, rootPath: ROOT.replace(/\\/g, '/'),
  }));
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

function walkFiles(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walkFiles(p, out); } else { out.push(p); }
  }
  return out;
}

async function main() {
  seedFixtures();
  const rootBefore = rootMtime();
  const { child, browser, page } = await launch();
  try {
    await wait(2500);
    // P0 夹具建页（表格+代码+附件优先；附件若导入链有夹具页更好——CB 报告 §0 为准）
    STEP = 'P0|夹具';
    await page.evaluate((pn) => {
      const btn = [...document.querySelectorAll('[data-testid^="side-"]')].find((e) => (e.textContent ?? '').includes('新建') || (e.textContent ?? '').includes('New'));
      void btn; void pn;
    }, `T80 夹具页 ${TS}`);
    // TODO(CB 交付后)：真实建页链照 t76/t79 探针（newPageNamed + 表格 + 代码块 + 图片）
    check('P0-待填 夹具页建齐', false, 'skeleton——交付后按真实契约补齐');

    // P1 设置页入口：预览→取消=零落盘
    // P2 IPC portable:export confirm(dir) 显式目录落盘
    // P3 包内核：unzipSync 条目清单 / manifest-portable.json checksums 逐条 sha256 / 排除清单（logs|tmp|crashDumps|bak-）
    // P4 加密闸：默认关——若夹具开加密则期望 E_PORTABLE_ENCRYPTED_UNSUPPORTED
    // P5 应用存活 + 真实根 untouched

    STEP = 'P9|存活';
    const alive = await page.evaluate(() => document.querySelector('#root')?.childElementCount ?? 0);
    check('P9-1 应用存活', alive > 0, String(alive));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't80-results.json'), JSON.stringify({ task: 'T80-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T80-01：${pass} PASS / ${fail} FAIL =====`);
    if (assertions.length < 8) { console.log(`FATAL 断言条数 ${String(assertions.length)} < 8（静默蒸发守卫）`); }
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    process.exitCode = fail === 0 && assertions.length >= 8 ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
