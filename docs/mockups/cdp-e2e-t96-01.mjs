/* cdp-e2e-t96-01.mjs —— T96-01「外链与导航兜底」真机验收（0.6.9 包审 A8 修复的落地证据）
 *
 * 修复前：主进程既无 setWindowOpenHandler 也无 will-navigate → renderer 的 window.open /
 * target=_blank / 未拦下的 <a href> 会新开真窗口或把主窗导航到远端，绕过 shell:openExternal
 * 的协议白名单唯一出口（T73-01）。修复后：站内放行；站外 http(s) 转交系统浏览器后拦下；
 * 其他协议拦下且不外发。
 *
 * 判据（真机行为，不看源码）：
 *   G1 站外 window.open 被拦：返回 null 且**没有新窗口**、主窗 URL 不变（同一次里顺带
 *      验证「已转交系统浏览器」——系统浏览器会真的弹出一页，属预期副作用，只跑一次）。
 *   G2 站外导航被拦（非 http 协议，不外发）：location.href 指到 data: / javascript: 后
 *      主窗 URL 不变、应用仍活着（外壳没被远端页占用）。
 *   G3 站内导航放行：location.reload() 后应用照常起来（守卫不得把 reload 一起拦死 —— 回归红线）。
 *   G4 内部协议不开新窗：window.open('asset://…') 返回 null、无新窗口、无空白窗（实测放行会留空白窗）。
 *   G5 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t96-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9620');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t96', 'result.log');

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(text) {
  console.log(text);
  try { mkdirSync(dirname(RESULT), { recursive: true }); appendFileSync(RESULT, `${text}\n`, 'utf8'); } catch { /* 取证失败不阻断 */ }
}
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 240) });
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 200)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* 已退 */ } }
function killStaleApp() { try { execSync('taskkill /F /IM Septcats.exe', { stdio: 'ignore' }); } catch { /* 无进程 */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

let CHILD = null;

async function boot() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    cwd: dirname(PACKAGE_APP), stdio: 'ignore', detached: false,
  });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(700); }
  }
  if (browser === null) throw new Error('CDP 连接超时');
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  let page = null;
  for (let i = 0; i < 30; i++) { await wait(500); page = ctx.pages().find((p) => p.url().includes('index.html')); if (page) break; }
  if (page === null) throw new Error('主窗口未就绪');
  await wait(1500);
  return { child: CHILD, browser, ctx, page };
}

async function main() {
  const realBefore = rootMtime();
  line(`[T96-01] 外链/导航兜底；靶=${PACKAGE_APP}`);
  const h = await boot();
  let { page } = h;
  const urlOf = (p) => p.url();

  // ---------- G1 站外 window.open 被拦（并转交系统浏览器，只跑一次） ----------
  STEP = 'G1';
  const beforeUrl = urlOf(page);
  const r1 = await page.evaluate(() => String(window.open('https://example.com/', '_blank')));
  await wait(1800);
  const pagesAfter = h.ctx.pages().filter((p) => p.url().includes('index.html') || p.url().startsWith('https://example.com')).length;
  const nowUrl1 = urlOf(page);
  check('G1 站外 window.open：返回 null、无新窗口、主窗未被导航走（已转交系统浏览器=副作用预期）',
    r1 === 'null' && pagesAfter === 1 && nowUrl1 === beforeUrl,
    `window.open 返回=${r1} 相关页面数=${String(pagesAfter)} 主窗 URL 变化=${String(nowUrl1 !== beforeUrl)}`);

  // ---------- G2 站外导航被拦（non-http 协议 → 拦下且不外发） ----------
  STEP = 'G2';
  const r2 = await page.evaluate(() => {
    const before = location.href;
    location.href = 'data:text/html,<h1>hijack</h1>';
    return { before, after: location.href };
  });
  await wait(1200);
  const alive2 = await page.evaluate(() => document.querySelector('.sc-shell__body') !== null);
  const nowUrl2 = urlOf(page);
  check('G2 站外导航（data:）被拦：主窗 URL 不变、应用仍活着（外壳没被远端页占）',
    nowUrl2 === beforeUrl && alive2 && !nowUrl2.startsWith('data:'),
    `URL=${nowUrl2} 应用在位=${String(alive2)} 评估内 URL=${r2.after.slice(0, 40)}`);

  // ---------- G3 站内导航放行（reload 不被一起拦死） ----------
  STEP = 'G3';
  await page.evaluate(() => { location.reload(); });
  await wait(2500);
  const pages3 = h.ctx.pages().filter((p) => p.url().includes('index.html'));
  page = pages3[0] ?? page;
  let alive3 = false;
  for (let i = 0; i < 12; i++) {
    await wait(400);
    alive3 = await page.evaluate(() => document.querySelector('.sc-shell__body') !== null).catch(() => false);
    if (alive3) break;
  }
  check('G3 站内 reload 放行：重载后应用照常起来（守卫没把站内导航一起拦死）',
    alive3 && urlOf(page).includes('index.html'), `应用在位=${String(alive3)} URL=${urlOf(page).slice(0, 60)}`);

  // ---------- G4 自定义协议不外发 ----------
  STEP = 'G4';
  const totalBefore = h.ctx.pages().length;
  const r4 = await page.evaluate(() => String(window.open('asset://note/1.png', '_blank')));
  await wait(1500);
  const totalAfter = h.ctx.pages().length;
  const blanks = h.ctx.pages().filter((p) => p.url() === 'about:blank').length;
  check('G4 内部协议 window.open 被拦且不外发（无新窗口、无空白窗）',
    r4 === 'null' && totalAfter === totalBefore && blanks === 0,
    `返回=${r4} 页面前后=${String(totalBefore)}→${String(totalAfter)} about:blank=${String(blanks)}`);

  // ---------- G5 夹具零触碰 ----------
  STEP = 'G5';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('G5 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T96-01 外链/导航兜底探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked）`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});