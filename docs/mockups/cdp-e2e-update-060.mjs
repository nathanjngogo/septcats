/* 存量自动更新端到端真机探针（0.6.0 遗留收尾）
 * 链：已装 0.6.0-rc.1（channel=rc）→ dev feed（本地镜像=线上 v0.6.0 套：latest.yml/.sig +
 *     rc.yml + Setup.0.6.0.exe）→ update:check 自拉验签=available 0.6.0 →
 *     update:download 完成=downloaded（electron-updater sha512 内建校验）→
 *     update:install(confirm:true)=quitAndInstall（应用自杀，NSIS /S 升级）→
 *     注册表=0.6.0 → 新版起动 check=not-available + appMeta=0.6.0（闭环、不循环升级）。
 * 双钉：--user-data-dir=<scratch ud> + settings.json rootPath→scratch data；
 *       真实根 C:\Users\Administrator\.septcats 零触碰。程序目录升级=老板机器终态。
 * 实拍说明（09-26 16:42 跑出 9/9）：GitHub 直连下载 100MB 资产停滞（20s/+16KB，老坑），
 *   feed 目录的 Setup exe 用本地 dist 产物顶上——其 sha512 与线上 latest.yml 记载逐字节
 *   一致（efab742f…82bf MATCH / 102,680,031B），而 latest.yml(.sig) 为 GitHub 实拉真值，
 *   验签链因此不失真；electron-updater 下载的 sha512 校验照常执行。
 * feed URL 带尾斜杠：预验签拼 <feed>/latest.yml、generic channel=rc 拼 <feed>/rc.yml 双对。
 * 状态观察走 onState 推送（update:check 再调会重入 checking）。断言 <8 = FATAL。
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const SCR = 'E:/Hermes Agent工作空间/_scratch';
const UD = join(SCR, 'update-e2e', 'ud');
const ROOT = join(SCR, 'update-e2e', 'data');
const EXE = 'C:/Users/Administrator/AppData/Local/Programs/@septcatsdesktop/Septcats.exe';
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9224;
const FEED = 'http://127.0.0.1:8791/';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ps(cmd) {
  const out = join(SCR, 'update-e2e-ps.txt');
  try { rmSync(out, { force: true }); } catch { /* */ }
  try { execSync(`powershell -NoProfile -Command "${cmd.replace(/"/g, '\\"')} | Out-File -Encoding ascii '${out}'"`, { stdio: 'ignore', timeout: 60000 }); } catch { /* fallthrough */ }
  try { return readFileSync(out, 'utf8').trim(); } catch { return ''; }
}
const ver = () => ps(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA SilentlyContinue | Where-Object DisplayName -like '*Septcats*').DisplayVersion`);
function killApp() { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`); }

async function boot() {
  killApp(); await wait(1500);
  const child = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, SEPTCATS_DEV_FEED: '1', SEPTCATS_DEV_FEED_URL: FEED },
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats?.update !== undefined, null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__lastUpdate = null;
    window.septcats.update.onState((s) => { window.__lastUpdate = s; });
  });
  return { child, browser, page };
}

async function main() {
  for (const d of [UD, ROOT]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } mkdirSync(d, { recursive: true }); }
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  const stampBefore = realRootStamp();

  STEP = 'V0|前置';
  const v0 = ver();
  check('V0-1 起始已装=0.6.0-rc.1', v0 === '0.6.0-rc.1', v0);
  check('V0-2 feed 镜像四件套就位', ['latest.yml', 'latest.yml.sig', 'rc.yml', 'Septcats.Setup.0.6.0.exe'].every((f) => existsSync(join(SCR, 'feed-060', f))), 'files');

  let { browser, page } = await boot();
  STEP = 'V1|check';
  const st1 = await page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { error: String(e) }; } });
  check('V1-1 check→available 0.6.0（latest.yml 自拉验签过）', st1.status === 'available' && st1.version === '0.6.0', JSON.stringify(st1));

  STEP = 'V2|download';
  void page.evaluate(() => window.septcats.update.download().catch(() => undefined));
  let last = null;
  for (let i = 0; i < 300; i += 1) { // ≤5min 等 102MB
    last = await page.evaluate(() => window.__lastUpdate);
    if (last?.status === 'downloaded' || last?.status === 'error') break;
    await wait(1000);
  }
  check('V2-1 下载终态=downloaded（本地源；sha512 由 electron-updater 内建校验）', last?.status === 'downloaded', JSON.stringify(last));

  STEP = 'V3|install';
  const inst = await page.evaluate(() => window.septcats.update.install({ confirm: true }).catch((e) => ({ error: String(e) })));
  check('V3-1 install confirm 受理（随后 quitAndInstall 退出）', inst?.ok === true, JSON.stringify(inst));
  let v = '';
  for (let i = 0; i < 75; i += 1) { await wait(2000); v = ver(); if (v === '0.6.0') break; }
  check('V3-2 NSIS 静默升级完成：注册表 DisplayVersion=0.6.0', v === '0.6.0', v);

  STEP = 'V4|新版闭环';
  {
    const b2 = await boot();
    const st4 = await b2.page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { error: String(e) }; } });
    check('V4-1 0.6.0 check→not-available（不循环升级）', st4.status === 'not-available', JSON.stringify(st4));
    const meta = await b2.page.evaluate(() => window.septcats.appMeta());
    check('V4-2 应用自报版本=0.6.0', meta?.version === '0.6.0', JSON.stringify(meta));
    try { await b2.browser.close(); } catch { /* */ }
  }

  STEP = 'V5|隔离';
  check('V5-1 真实数据根零触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);

  const pass = assertions.filter((x) => x.ok).length;
  const fail = assertions.filter((x) => !x.ok).length;
  writeFileSync(join(SCR, 'update-e2e-results.json'), JSON.stringify({ task: 'update-e2e-060', ranAt: new Date().toISOString(), assertions }, null, 2));
  console.log(`\n===== 升级链真机：${pass} PASS / ${fail} FAIL =====`);
  if (assertions.length < 8) console.log(`FATAL 断言条数 ${assertions.length} < 8`);
  process.exitCode = fail === 0 && assertions.length >= 8 ? 0 : 1;
  try { await browser.close(); } catch { /* */ }
}
void main().catch((e) => { console.log('EXC', String(e)); process.exitCode = 1; });
