/* 存量自动更新端到端真机探针（0.6.7 正式发布收口，模板=cdp-e2e-update-061.mjs）
 * 链：已装 0.6.5（rc，app-update.yml 默认 channel=latest）→ dev feed 本地镜像
 *     （latest.yml/.sig 实拉 GitHub 真值 + Setup.0.6.7.exe 本地终包，V0 当场对账 sha512）
 *     → update:check=available 0.6.7（验签链不失真）→ download=downloaded（内建 sha512 校验）
 *     → install(confirm) quitAndInstall → NSIS 静默升级 → 注册表=0.6.7
 *     → 新版 check=not-available（不循环升级）+ appMeta=0.6.7。
 * 双钉：--user-data-dir=scratch ud + settings.json rootPath=scratch data；真实根零触碰。
 * 镜像真值口径：latest.yml(.sig) 必须实拉 GitHub；exe 用本地 dist 终包，V0-3 断言
 *   sha512(本地 exe)==线上 yml 声明 → 验签/下载校验与线上等价。
 * feed URL 带尾斜杠。状态观察走 onState 推送。断言 <8 = FATAL。
 */
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const SCR = 'E:/Hermes Agent工作空间/_scratch';
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const FEED_DIR = join(SCR, 'feed-067');
const UD = join(SCR, 'update-e2e-067', 'ud');
const ROOT = join(SCR, 'update-e2e-067', 'data');
const EXE = 'C:/Users/Administrator/AppData/Local/Programs/@septcatsdesktop/Septcats.exe';
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9226;
const HTTP_PORT = 8793;
const FEED = `http://127.0.0.1:${String(HTTP_PORT)}/`;
const VER_NEW = '0.6.7';
const VER_OLD = '0.6.5';
const ASSET = 'Septcats.Setup.0.6.7.exe';
const GH = 'https://github.com/nathanjngogo/septcats-releases/releases/download/latest';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ps(cmd) {
  const out = join(SCR, 'update-e2e-067-ps.txt');
  try { rmSync(out, { force: true }); } catch { /* */ }
  try { execSync(`powershell -NoProfile -Command "${cmd.replaceAll('"', '\\"')} | Out-File -Encoding ascii '${out}'"`, { stdio: 'ignore' }); } catch { /* */ }
  try { return readFileSync(out, 'utf8').trim(); } catch { return ''; }
}
const ver = () => ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA SilentlyContinue | Where-Object DisplayName -like '*Septcats*' | Select-Object -First 1).DisplayVersion");
function killApp() { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function sha512b64(p) { return createHash('sha512').update(readFileSync(p)).digest('base64'); }
function ymlSha512(p) { return (readFileSync(p, 'utf8').match(/sha512:\s*(\S+)/) ?? [])[1] ?? ''; }

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 140)}`); }

async function boot() {
  killApp(); await wait(1500);
  const child = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, SEPTCATS_DEV_FEED: '1', SEPTCATS_DEV_FEED_URL: FEED },
  });
  child.unref();
  let browser = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(800);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ }
  }
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
  // 镜像准备：yml/sig 实拉线上真值；exe=本地终包（V0-3 断言等价）
  rmSync(FEED_DIR, { recursive: true, force: true }); mkdirSync(FEED_DIR, { recursive: true });
  execSync(`curl -sfL "${GH}/latest.yml" -o "${join(FEED_DIR, 'latest.yml')}"`, { stdio: 'ignore' });
  execSync(`curl -sfL "${GH}/latest.yml.sig" -o "${join(FEED_DIR, 'latest.yml.sig')}"`, { stdio: 'ignore' });
  copyFileSync(join(REPO, 'apps', 'desktop', 'dist', 'Septcats Setup 0.6.7.exe'), join(FEED_DIR, ASSET));
  const server = spawn('python', ['-m', 'http.server', String(HTTP_PORT), '--directory', FEED_DIR], { stdio: 'ignore', detached: true });
  server.unref();
  await wait(1500);

  for (const d of [UD, ROOT]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } mkdirSync(d, { recursive: true }); }
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/'), theme: 'light', locale: 'zh-CN', privacy: { telemetry: false, linkPreviewOnType: true }, editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false } }, null, 2), 'utf8');
  const stampBefore = realRootStamp();

  STEP = 'V0|前置';
  const v0 = ver();
  check(`V0-1 起始已装=${VER_OLD}`, v0 === VER_OLD, v0);
  check('V0-2 feed 镜像三件套就位', ['latest.yml', 'latest.yml.sig', ASSET].every((f) => existsSync(join(FEED_DIR, f))), FEED_DIR);
  const dec = ymlSha512(join(FEED_DIR, 'latest.yml'));
  const got = sha512b64(join(FEED_DIR, ASSET));
  check('V0-3 镜像不失真：sha512(本地终包)==线上 yml 声明', dec !== '' && dec === got, `${dec.slice(0, 16)}… vs ${got.slice(0, 16)}…`);
  check('V0-4 线上 yml 声明版本=目标版', readFileSync(join(FEED_DIR, 'latest.yml'), 'utf8').includes(`version: ${VER_NEW}`), 'version 行');

  let { browser, page } = await boot();
  STEP = 'V1|check';
  const st1 = await page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { error: String(e) }; } });
  check(`V1-1 check→available ${VER_NEW}（latest.yml 自拉验签过）`, st1.status === 'available' && st1.version === VER_NEW, JSON.stringify(st1).slice(0, 120));

  STEP = 'V2|download';
  void page.evaluate(() => window.septcats.update.download().catch(() => undefined));
  let last = null;
  for (let i = 0; i < 300; i += 1) {
    last = await page.evaluate(() => window.__lastUpdate);
    if (last?.status === 'downloaded' || last?.status === 'error') break;
    await wait(1000);
  }
  check('V2-1 下载终态=downloaded（本地源；sha512 由 electron-updater 内建校验）', last?.status === 'downloaded', JSON.stringify(last).slice(0, 120));

  STEP = 'V3|install';
  const inst = await page.evaluate(() => window.septcats.update.install({ confirm: true }).catch((e) => ({ error: String(e) })));
  check('V3-1 install confirm 受理（随后 quitAndInstall 退出）', inst?.ok === true, JSON.stringify(inst).slice(0, 100));
  let v = '';
  for (let i = 0; i < 90; i += 1) { await wait(2000); v = ver(); if (v === VER_NEW) break; }
  check(`V3-2 NSIS 静默升级完成：注册表 DisplayVersion=${VER_NEW}`, v === VER_NEW, v);
  try { await browser.close(); } catch { /* */ }
  killApp();

  STEP = 'V4|新版闭环';
  {
    const b2 = await boot();
    const st4 = await b2.page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { error: String(e) }; } });
    check(`${VER_NEW} check→not-available（不循环升级）`, st4.status === 'not-available', JSON.stringify(st4).slice(0, 120));
    const meta = await b2.page.evaluate(() => window.septcats.appMeta());
    check(`V4-2 应用自报版本=${VER_NEW}`, meta?.version === VER_NEW, JSON.stringify(meta).slice(0, 100));
    try { await b2.browser.close(); } catch { /* */ }
    killApp();
  }

  STEP = 'V5|隔离';
  check('V5-1 真实数据根零触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);

  const pass = assertions.filter((x) => x.ok).length;
  const fail = assertions.filter((x) => !x.ok).length;
  writeFileSync(join(SCR, 'update-e2e-067-results.json'), JSON.stringify({ task: 'update-e2e-067', ranAt: new Date().toISOString(), pass, fail, assertions }, null, 2), 'utf8');
  console.log(`\n===== 升级链真机（${VER_OLD} → ${VER_NEW}）：${pass} PASS / ${fail} FAIL =====`);
  if (assertions.length < 8) console.log(`FATAL 断言条数 ${assertions.length} < 8`);
  try { process.kill(-server.pid); } catch { /* */ }
  process.exit(fail === 0 && assertions.length >= 8 ? 0 : 1);
}
main().catch((e) => { console.log(`FATAL ${String(e?.stack ?? e).slice(0, 500)}`); process.exit(3); });
