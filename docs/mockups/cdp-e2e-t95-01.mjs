/* cdp-e2e-t95-01.mjs —— T95-01/02「开合弹簧 + 材质成形」真机验收
 * （老板 09-29「你直接做到底」令；UI 评估 P2 首批：Apple《Designing Fluid Interfaces》）
 *
 * 两条机制：
 *   ① 侧栏开合弹簧（T95-01）：折叠从「删列 + display:none 硬切」改为「列宽走注册属性
 *      --sc-shell-sidebar-w（@property <length> 才能过渡）+ linear() 弹簧缓动（ζ=0.72，
 *      约 4% 过冲）」。收起后列宽 0 + visibility:hidden（延迟到动画结束才切）。
 *   ② 材质成形（T95-02）：换到玻璃档时模糊/饱和从 0 长到目标（450ms），
 *      由 lookState.markLookSettling 挂 data-look-settling 触发，到点自动摘除。
 *
 * 判据（全部 DOM/几何/计算样式客观量，不看截图下结论）：
 *   R1 基态：--sc-shell-sidebar-w = 240px 且过渡声明在位；侧栏 240、可见（几何零回归）。
 *   R2 收起在途：点折叠钮后 ~70ms 侧栏宽度**在 0 与 240 之间**（不是硬切）；900ms 后 = 0 且 hidden。
 *   R3 展开过冲：采样 700ms，宽度峰值 > 240（弹簧签名；纯 ease 无法过冲）。
 *   R4 可打断换手：收起在途反向点开 → 宽度回头上升；收口 240。
 *   R5 材质成形：设置页点「玻璃」→ data-look-settling=1 且侧栏 blur 远小于 30px；
 *      900ms 后 blur ≈ 30px 且标记已摘除。
 *   R6 真实档案根 mtime 不变（夹具零触碰红线）。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t95-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9610');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t95', 'result.log');

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
  for (let i = 0; i < 20; i++) {
    await wait(400);
    if (await page.evaluate(() => document.querySelector('.sc-shell__body') !== null)) break;
  }
  await wait(1200);
  return { child: CHILD, browser, page };
}

async function shot(page, name) {
  const target = await page.evaluate(() => {
    const el = document.querySelector('.sc-shell__body');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.min(900, Math.round(r.width)), height: Math.min(420, Math.round(r.height)) };
  });
  if (target === null) return null;
  const buf = await page.screenshot({ clip: target });
  writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
  return join(SHOT_DIR, `${name}.png`);
}

const SAMPLE = () => ({
  w: Math.round(document.querySelector('.sc-shell__sidebar')?.getBoundingClientRect().width ?? -1),
  vis: getComputedStyle(document.querySelector('.sc-shell__sidebar')).visibility,
  varW: getComputedStyle(document.querySelector('.sc-shell__body')).getPropertyValue('--sc-shell-sidebar-w').trim(),
  cols: getComputedStyle(document.querySelector('.sc-shell__body')).gridTemplateColumns,
  blurPx: (() => {
    const v = getComputedStyle(document.querySelector('.sc-shell__sidebar')).backdropFilter || '';
    const m = /blur\(([\d.]+)px\)/.exec(v);
    return m ? Number(m[1]) : -1;
  })(),
  settling: document.documentElement.dataset.lookSettling ?? '',
  look: document.documentElement.dataset.look ?? '',
});

async function main() {
  const realBefore = rootMtime();
  line(`[T95-01] 开合弹簧 + 材质成形；靶=${PACKAGE_APP}`);
  const h = await boot();
  const { page } = h;

  // ---------- R1 基态 ----------
  STEP = 'R1';
  const s1 = await page.evaluate(SAMPLE);
  const transProp = await page.evaluate(() => getComputedStyle(document.querySelector('.sc-shell__body')).transitionProperty);
  const hasProp = await page.evaluate(() => {
    // @property 在 CSSOM 里是 CSSPropertyRule（只此一处能可靠取证；查 <style>.textContent 会拿到注入样式）
    for (const sheet of document.styleSheets) {
      let rules = null;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.constructor.name === 'CSSPropertyRule' && r.name === '--sc-shell-sidebar-w') return true;
      }
    }
    return false;
  });
  const tracks = s1.cols.split(/\s+/);
  const sidebarTrack = tracks.length === 3 ? tracks[1] : tracks[0];
  check('R1a 基态侧栏列宽 = 240px（rail 在位时取第二轨）且侧栏可见（几何零回归）',
    s1.w === 240 && s1.vis === 'visible' && s1.varW === '240px' && sidebarTrack === '240px',
    JSON.stringify({ w: s1.w, vis: s1.vis, varW: s1.varW, cols: s1.cols, sidebarTrack }));
  const hasVisDelay = await page.evaluate(() => {
    // 折叠态侧栏规则里的 visibility 延迟（= 动画跑完才隐藏，观感「列在缩内容还在」）
    for (const sheet of document.styleSheets) {
      let rules = null;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        const sel = r.selectorText ?? '';
        if (sel.includes('.sc-shell--collapsed') && sel.includes('.sc-shell__sidebar')) {
          const t = r.style.transition ?? '';
          const tp = r.style.transitionProperty ?? '';
          if (t.includes('visibility') || tp.includes('visibility')) return true;
        }
      }
    }
    return false;
  });
  check('R1b 过渡吃注册属性（未注册的自定义属性是离散量、不插值）+ 折叠态 visibility 延迟切换',
    transProp.includes('--sc-shell-sidebar-w') && hasProp && hasVisDelay,
    `transitionProperty=${transProp} @property 在表内=${String(hasProp)} visibility 延迟=${String(hasVisDelay)}`);

  // ---------- R2 收起在途 ----------
  STEP = 'R2';
  await page.evaluate(() => document.querySelector('[data-testid="side-toggle"]').click());
  await wait(70);
  const mid = await page.evaluate(SAMPLE);
  const shotMid = await shot(page, 'collapse-inflight');
  await wait(900);
  const done = await page.evaluate(SAMPLE);
  check('R2a 收起在途（~70ms）宽度严格落在 0 与 240 之间 —— 弹簧在跑，不是硬切',
    mid.w > 0 && mid.w < 240, JSON.stringify({ w: mid.w, varW: mid.varW, cols: mid.cols }));
  check('R2b 收口：列宽 0 + visibility:hidden（退出 tab 序，T30 语义保持）',
    done.w === 0 && done.vis === 'hidden' && done.varW === '0px',
    JSON.stringify({ w: done.w, vis: done.vis, varW: done.varW }));

  // ---------- R3 展开过冲（弹簧签名） ----------
  STEP = 'R3';
  await page.evaluate(() => document.querySelector('[data-testid="side-toggle"]').click());
  const samples = [];
  for (let i = 0; i < 24; i++) {
    samples.push((await page.evaluate(SAMPLE)).w);
    await wait(30);
  }
  await wait(600);
  const peak = Math.max(...samples);
  const rest = await page.evaluate(SAMPLE);
  check('R3a 展开过程宽度峰值 > 240（约 4% 过冲 = 弹簧签名，纯 cubic-bezier 做不到）',
    peak > 240 && peak <= 262, `峰值=${String(peak)} 采样=${JSON.stringify(samples)}`);
  check('R3b 收口回到 240 且恢复可见', rest.w === 240 && rest.vis === 'visible',
    JSON.stringify({ w: rest.w, vis: rest.vis }));

  // ---------- R4 可打断换手 ----------
  STEP = 'R4';
  await page.evaluate(() => document.querySelector('[data-testid="side-toggle"]').click());
  await wait(110);
  const a = await page.evaluate(SAMPLE);
  await page.evaluate(() => document.querySelector('[data-testid="side-toggle"]').click()); // 在途反向
  await wait(80);
  const b = await page.evaluate(SAMPLE);
  await wait(900);
  const c = await page.evaluate(SAMPLE);
  check('R4 动画中途反向：从半途当前值续跑回头（可打断 + 速度换手，无需 JS）',
    a.w > 0 && a.w < 240 && b.w > a.w && c.w === 240 && c.vis === 'visible',
    JSON.stringify({ 在途: a.w, 反向80ms: b.w, 收口: c.w, vis: c.vis }));

  // ---------- R5 材质成形 ----------
  STEP = 'R5';
  const opened = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.sc-shell__topbar button')];
    const b = btns.find((x) => (x.getAttribute('aria-label') ?? '').includes('设置'));
    if (b === undefined) return false;
    b.click();
    return true;
  });
  await wait(700);
  const inSettings = await page.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null);
  // 换档与采样放进同一次 evaluate：点下去立刻逐帧读模糊（CDP 往返 ≈50ms，会把 450ms
  // 的成形过程整段跳过 —— 首版探针就踩了这个，读到 29.99 误判「没成形」）。
  const ramp = await page.evaluate(async () => {
    const radio = document.querySelector('[data-testid="theme-look-section"] input[value="glass"]');
    if (radio === null) return null;
    const el = document.querySelector('.sc-shell__sidebar');
    const readBlur = () => {
      const v = getComputedStyle(el).backdropFilter || '';
      const m = /blur\(([\d.]+)px\)/.exec(v);
      return m ? Number(m[1]) : -1;
    };
    const before = readBlur();
    radio.click();
    const series = [];
    const anims = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 900) {
      series.push(Number(readBlur().toFixed(2)));
      await new Promise((r) => { requestAnimationFrame(() => { r(undefined); }); });
    }
    for (const a of el.getAnimations()) {
      anims.push({ name: a.animationName ?? '', state: a.playState, ct: Math.round(a.currentTime ?? -1) });
    }
    return {
      before, series, anims,
      settlingAtEnd: document.documentElement.dataset.lookSettling ?? '',
      look: document.documentElement.dataset.look ?? '',
    };
  });
  const clicked = ramp !== null;
  await wait(500);
  const formed = await page.evaluate(SAMPLE);
  const shotGlass = await shot(page, 'glass-materialized');
  check('R5a 设置页可达 + 玻璃 radio 点得动（材质成形走真实 UI 路径）',
    opened === true && inSettings && clicked, JSON.stringify({ '打开设置': opened, '设置页': inSettings, '点到 glass': clicked }));
  const rampMin = ramp === null ? -1 : Math.min(...ramp.series);
  const rampMax = ramp === null ? -1 : Math.max(...ramp.series);
  const rampLow = ramp === null ? -1 : ramp.series.slice(0, 8).reduce((a, b) => Math.min(a, b), 999);
  check('R5b 材质成形：换档当帧逐帧采样，模糊由 ~0 长到 ~30（不是啪一下到位）',
    ramp !== null && ramp.look === 'glass' && rampLow >= 0 && rampLow < 18 && rampMax >= 29 && ramp.settlingAtEnd === '',
    JSON.stringify({ 换档前: ramp === null ? null : ramp.before, 前8帧最低: rampLow, 全程最低: rampMin, 峰值: rampMax, 末帧标记: ramp === null ? '' : ramp.settlingAtEnd, 动画: ramp === null ? [] : ramp.anims }));
  check('R5c 收口 900ms：blur ≈ 30px（= --sc-glass-blur-chrome）且标记已自动摘除',
    formed.blurPx >= 29 && formed.blurPx <= 31 && formed.settling === '',
    JSON.stringify({ blur: formed.blurPx, settling: formed.settling }));

  // ---------- R6 夹具零触碰 ----------
  STEP = 'R6';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('R6 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T95-01 弹簧/材质成形探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked）`);
  line(`截图：${String(shotMid)} | ${String(shotGlass)}`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});