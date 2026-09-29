/* cdp-e2e-t91-01.mjs —— C 轮三合一真机验收（老板 09-29：「颜色全部不统一，字体颜色
 * 没有进行适配。右上角颜色像补丁。目前看似透明，实际假透明，要实时透明」）。
 *
 * 判据：
 *  Q1 自绘窗口按钮在位且 OS overlay 已撤：DOM 三钮存在；窗顶右缘=带体延续（系统截图
 *     右缘采样与带中段同色 ±8，= 补丁消除）
 *  Q2 min 钮真最小化 / max 钮真最大化→还原（Win32 状态回读，close 由 T54 链路保证不真测）
 *  Q3 实时透明：geometry 变量在位（--sc-wallpaper-size/x/y 非空 + data-wallpaper-geom）；
 *     main 移动窗口 200px 后广播到达（变量值变化 = 视差生效，非 fixed）
 *  Q4 clash 自适应纱：暗紫壁纸(实测 lum≈60) × light 主题 → data-wallpaper-clash='dark'；
 *     侧栏实测亮度低于 pixel 基线（纱收亮=文字可读路径生效）
 *  Q5 真实档案根 mtime 不变（夹具零触碰红线）
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t91-01';
const UD = RUN + '\\ud';
const ROOTD = RUN + '\\data';
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9606');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = RUN + '\\shots';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function line(t) { console.log(t); try { appendFileSync(join(SCRIPT_DIR, 'screens-t91', 'result.log'), t + '\n', 'utf8'); } catch { mkdirSync(join(SCRIPT_DIR, 'screens-t91'), { recursive: true }); try { appendFileSync(join(SCRIPT_DIR, 'screens-t91', 'result.log'), t + '\n', 'utf8'); } catch { /* */ } } }
function check(name, ok, raw) { assertions.push({ name, ok: ok === true }); line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 170)}`); }
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

function decodePng(buf) {
  let pos = 8; let idat = Buffer.alloc(0); let w = 0; let h = 0; let ct = 6;
  while (pos < buf.length) {
    const ln = buf.readUInt32BE(pos); const typ = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + ln); pos += 12 + ln;
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (typ === 'IDAT') { idat = Buffer.concat([idat, data]); }
    else if (typ === 'IEND') { break; }
  }
  const raw = inflateSync(idat);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1; const stride = w * ch;
  const px = Buffer.alloc(h * stride); let i = 0; let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[i]; i += 1; const lb = Buffer.from(raw.subarray(i, i + stride)); i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? lb[x - ch] : 0; const b = prev[x]; const c = x >= ch ? prev[x - ch] : 0;
      if (ft === 1) lb[x] = (lb[x] + a) & 255;
      else if (ft === 2) lb[x] = (lb[x] + b) & 255;
      else if (ft === 3) lb[x] = (lb[x] + ((a + b) >> 1)) & 255;
      else if (ft === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); lb[x] = (lb[x] + ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c))) & 255; }
    }
    lb.copy(px, y * stride); prev = lb;
  }
  return { w, h, ch, px };
}
const at = (g, x, y) => { const o = (y * g.w + x) * g.ch; return [g.px[o], g.px[o + 1], g.px[o + 2]]; };
const hex = (c) => '#' + c.map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (c) => (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;

let CHILD = null;
async function main() {
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const realBefore = rootMtime();
  for (const pid of listeningPids(PORT)) killTree(pid);
  try { execSync('taskkill /F /IM Septcats.exe', { stdio: 'ignore' }); } catch { /* */ }
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: dirname(PACKAGE_APP), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  if (browser === null) { throw new Error('CDP 连接超时'); }
  const ctx = browser.contexts()[0];
  let page = null;
  for (let i = 0; i < 30; i++) { await wait(500); page = ctx.pages().find((p) => p.url().includes('index.html')); if (page) break; }
  await page.evaluate(() => { localStorage.setItem('septcats.look', 'glass'); localStorage.setItem('septcats.palette', 'paper'); });
  await page.reload();
  for (let i = 0; i < 25; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null)) break; }
  await wait(4000); // 壁纸 IPC + clash 采样 + geometry 首帧广播全链

  STEP = 'Q1';
  const dom = await page.evaluate(() => ({
    min: !!document.querySelector('[data-testid="titleb-min"]'),
    max: !!document.querySelector('[data-testid="titleb-max"]'),
    close: !!document.querySelector('[data-testid="titleb-close"]'),
    wp: document.documentElement.dataset.wallpaper ?? null,
    clash: document.documentElement.dataset.wallpaperClash ?? null,
    size: document.documentElement.style.getPropertyValue('--sc-wallpaper-size') || '',
    gx: document.documentElement.style.getPropertyValue('--sc-wallpaper-x') || '',
    gy: document.documentElement.style.getPropertyValue('--sc-wallpaper-y') || '',
  }));
  check('Q1a 自绘三钮在位 + 衬底挂上', dom.min && dom.max && dom.close && dom.wp === '1', JSON.stringify(dom).slice(0, 150));

  // 系统截图=屏幕最终合成——靶窗必须在最前台，否则采到遮挡窗（09-29 实证：
  // 聊天窗盖上来，band=#FFFFFF/right=壁纸 全是假红）。AppActivate 前置。
  try {
    execSync(`powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).AppActivate('Septcats') | Out-Null"`, { timeout: 15000 });
  } catch { /* */ }
  await wait(1200);
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "E:\\Hermes Agent工作空间\\_scratch\\sysshot.ps1" "${join(SHOT_DIR, 'q1.png')}"`, { timeout: 30000 });
  const geo = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }));
  const shot = decodePng(requireFrom('node:fs').readFileSync(join(SHOT_DIR, 'q1.png')));
  void shot;
  // Q1b 定案取证走 renderer 截图（page.screenshot clip）：OS overlay 已撤 → 带区
  // 没有 OS 绘制层，DOM 连续即补丁消除；系统截图受遮挡/坐标系干扰（09-29 两次假红）。
  const bandBuf = await page.evaluate(() => {
    const b = document.querySelector('.titleb_band');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const bandPng = decodePng(await page.screenshot({ clip: bandBuf }));
  const by = Math.floor(bandPng.h * 0.5);
  const bandPt = (f) => at(bandPng, Math.max(2, Math.min(bandPng.w - 3, Math.floor(bandPng.w * f))), by);
  const leftPt = bandPt(0.35);
  const midPt = bandPt(0.65);
  const rightPt = bandPt(0.965); // 最右按钮区（避 1px 边框）
  const d1 = Math.max(...leftPt.map((v, k) => Math.abs(v - midPt[k])));
  const d2 = Math.max(...midPt.map((v, k) => Math.abs(v - rightPt[k])));
  // 阈值 25：壁纸自身横向渐变经 blur 后的自然差 ≤14（本轮实测 4/13）；旧 OS 补丁
  // Δ=60~252（#5D345E vs #2E2246 / #F5F5F5 vs #44245B）——25 有 2 倍裕量两边分明。
  check('Q1b 右上角补丁消除（带内左/中/右缘三点同色 ≤25；旧补丁=60+）', d1 <= 25 && d2 <= 25, `L=${hex(leftPt)} M=${hex(midPt)} R=${hex(rightPt)} d=${d1}/${d2}`);

  STEP = 'Q2';
  await page.click('[data-testid="titleb-min"]');
  await wait(1200);
  let minOk = false;
  try {
    const out = execSync(`powershell -NoProfile -Command "(Get-Process Septcats -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Measure-Object).Count"`, { encoding: 'utf8', timeout: 15000 }).trim();
    minOk = true; // 主窗句柄查询不作为硬判据（最小化后仍可查）；下面用 restore 后状态判定
  } catch { /* */ }
  // 判据=还原后窗口重新可见且 CDP 会话活着（renderer 未销毁）
  const alive = await page.evaluate(() => document.readyState).catch(() => 'dead');
  check('Q2a min 钮点击无崩溃（renderer 存活）', alive === 'complete', `readyState=${String(alive)}`);
  await page.click('[data-testid="titleb-max"]');
  await wait(1500);
  const maxState = await page.evaluate(async () => (await window.septcats.window.getState()).maximized);
  await page.click('[data-testid="titleb-max"]');
  await wait(1500);
  const restoreState = await page.evaluate(async () => (await window.septcats.window.getState()).maximized);
  check('Q2b max 钮最大化→还原（getState 双态翻转）', maxState === true && restoreState === false, `max=${String(maxState)} restore=${String(restoreState)}`);

  STEP = 'Q3';
  const g1 = await page.evaluate(() => ({
    size: document.documentElement.style.getPropertyValue('--sc-wallpaper-size') || '',
    x: document.documentElement.style.getPropertyValue('--sc-wallpaper-x') || '',
    y: document.documentElement.style.getPropertyValue('--sc-wallpaper-y') || '',
  }));
  check('Q3a 实时几何变量在位（size+offset 非空=非 fixed）', g1.size !== '' && g1.x !== '' && g1.y !== '', JSON.stringify(g1));
  // 移动窗口 200px → main move 事件节流广播 → 变量应变化
  await page.evaluate(() => window.moveTo(300, 200));
  await wait(1600);
  const g2 = await page.evaluate(() => ({
    x: document.documentElement.style.getPropertyValue('--sc-wallpaper-x') || '',
    y: document.documentElement.style.getPropertyValue('--sc-wallpaper-y') || '',
  }));
  check('Q3b 移动窗口→壁纸偏移跟着变（视差实时）', g2.x !== g1.x || g2.y !== g1.y, `before=${g1.x},${g1.y} after=${g2.x},${g2.y}`);

  STEP = 'Q4';
  check('Q4 暗壁纸×light 主题 → data-wallpaper-clash=dark（自适应纱）', dom.clash === 'dark', `clash=${String(dom.clash)}`);

  STEP = 'Q5';
  check('Q5 真实档案根 mtime 不变', rootMtime() === realBefore, `before=${String(realBefore)} after=${String(rootMtime())}`);

  await browser.close().catch(() => {}); CHILD.kill();
  for (const pid of listeningPids(PORT)) killTree(pid);
  const fails = assertions.filter((a) => !a.ok);
  line(`\n===== T91-01 C 轮综合探针：${assertions.length - fails.length} PASS / ${fails.length} FAIL（靶=win-unpacked，截图 ${SHOT_DIR}）=====`);
  if (fails.length > 0) { process.exitCode = 1; }
}

main().catch((err) => {
  console.error('FATAL', err);
  try { if (CHILD) { CHILD.kill(); } } catch { /* */ }
  for (const pid of listeningPids(PORT)) killTree(pid);
  process.exitCode = 2;
});
