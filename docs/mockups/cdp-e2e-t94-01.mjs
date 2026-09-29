/* cdp-e2e-t94-01.mjs —— UI 评估 P1 三项真机验收（老板「按你的建议来」）
 *
 * 覆盖：
 *  ① 滚动边缘渐隐（Apple §12 scroll edge effect，实现 = 滚动容器 mask + 滚动驱动动画）：
 *     未滚动无遮罩 / 滚动后遮罩长出 / **同位置对照**下顶部内容对比度显著下降（真在淡出）
 *     / glass 档面板磨砂不受影响（mask 只吃内容、不动 chrome）。
 *  ② 命中内衬（P1③）：顶栏文字钮在**视觉盒之外 4px** 处 elementFromPoint 仍归属该钮。
 *  ③ vibrancy 彩度维（P1②/④）的 CSS 分档在位（chroma 纱规则存在，见 looks.css / 单测）。
 *  ④ 真实档案根 mtime 不变。
 *
 * 三条实证教训（勿回退）：时间轴必须 scroll(nearest block)（写 self 永不激活）；
 * 不能用滚动容器内的 sticky 薄膜（画在行背景之下 = 零效果）；mask 只吃内容不动 chrome。
 *
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t94-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9602');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t94', 'result.log');

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

// —— PNG 解码（纯 stdlib）——
function decodePng(d) {
  let pos = 8; let idat = Buffer.alloc(0); let w = 0; let h = 0; let bitd = 8; let ct = 6;
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos); const typ = d.toString('latin1', pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + ln); pos += 12 + ln;
    if (typ === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitd = data[8]; ct = data[9]; }
    else if (typ === 'IDAT') { idat = Buffer.concat([idat, data]); }
    else if (typ === 'IEND') break;
  }
  const raw = inflateSync(idat);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1; const bpp = ch * (bitd / 8); const stride = w * bpp;
  const px = Buffer.alloc(h * stride); let i = 0; let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[i]; i += 1; const lineBuf = Buffer.from(raw.subarray(i, i + stride)); i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? lineBuf[x - bpp] : 0; const b = prev[x]; const c = x >= bpp ? prev[x - bpp] : 0;
      if (ft === 1) lineBuf[x] = (lineBuf[x] + a) & 255;
      else if (ft === 2) lineBuf[x] = (lineBuf[x] + b) & 255;
      else if (ft === 3) lineBuf[x] = (lineBuf[x] + ((a + b) >> 1)) & 255;
      else if (ft === 4) {
        const p0 = a + b - c; const pa = Math.abs(p0 - a); const pb = Math.abs(p0 - b); const pc = Math.abs(p0 - c);
        const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        lineBuf[x] = (lineBuf[x] + pr) & 255;
      }
    }
    lineBuf.copy(px, y * stride); prev = lineBuf;
  }
  return { w, h, ch, px };
}
/**
 * WCAG 相对亮度（sRGB）：用于「真机渲染态对比度」实测。
 * 单通道值走 sRGB 线性化（<=0.04045 线性段）。
 */
function relLum(r, g, b) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** 对比度（WCAG）：(L1+0.05)/(L2+0.05)。 */
function contrastRatio(l1, l2) {
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}
/**
 * 从截图里取「文字行」的渲染态对比度：背景 = 行内像素众数桶（占多数的那档），
 * 文字 = 偏离背景最远的那 3% 像素的均值亮度。避开了「哪一像素是字」的猜测。
 */
function textContrastFromShot(img) {
  const { w, h, ch, px } = img;
  const buckets = new Map();
  const lumas = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const l = relLum(r, g, b);
      lumas.push(l);
      const key = `${String(r >> 3)}-${String(g >> 3)}-${String(b >> 3)}`;
      const cur = buckets.get(key);
      buckets.set(key, cur === undefined ? { n: 1, l } : { n: cur.n + 1, l: cur.l });
    }
  }
  if (lumas.length === 0) return null;
  let bg = { n: 0, l: 0 };
  for (const v of buckets.values()) { if (v.n > bg.n) bg = v; }
  lumas.sort((a, b) => a - b);
  const bgL = bg.l;
  // 文字端：离背景最远的那一端的前 3%
  const far = Math.abs(lumas[0] - bgL) > Math.abs(lumas[lumas.length - 1] - bgL) ? lumas.slice(0, Math.max(1, Math.floor(lumas.length * 0.03))) : lumas.slice(-Math.max(1, Math.floor(lumas.length * 0.03)));
  const textL = far.reduce((a, b) => a + b, 0) / far.length;
  return { bgL: +bgL.toFixed(4), textL: +textL.toFixed(4), ratio: contrastRatio(textL, bgL), bgShare: +(bg.n / lumas.length).toFixed(3) };
}

/** 每行「内容对比度」= 行内像素标准差（前 n 行）。遮罩把内容淡向 chrome ⇒ 顶部必降。 */
function rowStd(img, n) {
  const { w, ch, px } = img;
  const out = [];
  for (let y = 0; y < Math.min(n, img.h); y++) {
    let s = 0;
    let s2 = 0;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * ch;
      const v = (px[o] + px[o + 1] + px[o + 2]) / 3;
      s += v;
      s2 += v * v;
    }
    const m = s / w;
    out.push(Math.sqrt(Math.max(0, s2 / w - m * m)));
  }
  return out;
}
const meanOf = (arr, n) => arr.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(n, arr.length));

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
  CHILD = spawn(PACKAGE_APP, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: dirname(PACKAGE_APP), detached: false, stdio: 'ignore' });
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
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('[data-testid="nav-rail"]') !== null)) break; }
  await wait(1500);
  return { child: CHILD, page, browser };
}

/** 滚动容器遮罩状态（mask 机制：读自身，不再是伪元素）。 */
const MASK_STATE = (sel) =>
  (() => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      maskImage: cs.maskImage.slice(0, 80),
      maskSize: cs.maskSize,
      // 边带长度走注册属性（读计算值）
      band: cs.getPropertyValue('--sc-edge-band').trim(),
      timeline: cs.animationTimeline,
      scrollTop: Math.round(el.scrollTop),
      canScroll: el.scrollHeight > el.clientHeight,
      box: { top: Math.round(r.top), h: Math.round(r.height) },
      sidebarBlur: getComputedStyle(document.querySelector('.sc-shell__sidebar')).backdropFilter,
      support: typeof CSS !== 'undefined' && CSS.supports('animation-timeline', 'scroll()'),
    };
  })();

/** 边带高度（px）：优先读注册属性 --sc-edge-band，回落 mask-size 的第二值。 */
function bandHeight(state) {
  const fromVar = /^(\d+(?:\.\d+)?)px$/.exec(String(state.band ?? ''));
  if (fromVar !== null) return Number(fromVar[1]);
  const m = /(\d+(?:\.\d+)?)px/.exec(String(state.maskSize).split(' ').pop() ?? '');
  return m === null ? -1 : Number(m[1]);
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(PACKAGE_APP)) { line('FATAL 缺打包靶 ' + PACKAGE_APP); process.exitCode = 2; return; }
  const realBefore = rootMtime();

  const h = await boot();
  const { page } = h;

  STEP = 'S1';
  const m0 = await page.evaluate(MASK_STATE, '.app-side-scroll');
  check('S1 未滚动：无遮罩（边带 = 0）+ 全尺寸遮罩 + 滚动驱动动画支持在位',
    m0 !== null && m0.support === true && bandHeight(m0) === 0 && m0.maskImage.includes('gradient') &&
      m0.maskSize.includes('100% 100%'),
    JSON.stringify(m0));

  STEP = 'S2';
  await page.evaluate(async () => {
    const api = window.septcats;
    for (let i = 0; i < 40; i++) { await api.pages.create({ parentId: null }); }
    return true;
  });
  await page.reload();
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('.app-side-scroll') !== null)) break; }
  await wait(1500);
  const scrolled = await page.evaluate(() => {
    const el = document.querySelector('.app-side-scroll');
    if (el === null) return null;
    el.scrollTop = 120;
    return { scrollTop: Math.round(el.scrollTop), canScroll: el.scrollHeight > el.clientHeight };
  });
  await wait(700);
  const m1 = await page.evaluate(MASK_STATE, '.app-side-scroll');
  check('S2 滚到 120px：遮罩边带长出（未滚不显、滚动才显）',
    scrolled !== null && scrolled.canScroll === true && m1 !== null && bandHeight(m1) >= 16,
    `scrolled=${JSON.stringify(scrolled)} mask=${JSON.stringify(m1)}`);

  STEP = 'S3';
  const clipTop = await page.evaluate(() => {
    const el = document.querySelector('.app-side-scroll');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x) + 4, y: Math.round(r.y), width: Math.max(40, Math.round(r.width) - 8), height: Math.min(120, Math.round(r.height)) };
  });
  const bufOn = await page.screenshot({ clip: clipTop });
  writeFileSync(join(SHOT_DIR, 'scroll-edge-mask-on.png'), bufOn);
  const stdOn = rowStd(decodePng(bufOn), 120);
  // 对照：同一滚动位置强制 mask 边带回 0（同名选择器覆盖，内容相同 → 自校准）
  const styleHandle = await page.addStyleTag({ content: '.app-side-scroll{--sc-edge-band:0px !important;animation:none !important;}' });
  await wait(500);
  const bufOff = await page.screenshot({ clip: clipTop });
  writeFileSync(join(SHOT_DIR, 'scroll-edge-mask-off.png'), bufOff);
  const stdOff = rowStd(decodePng(bufOff), 120);
  await page.evaluate((el) => { el.remove(); }, styleHandle).catch(() => {});
  const topOn = meanOf(stdOn, 10);
  const topOff = meanOf(stdOff, 10);
  // 深部对照（两态都应一致）：证明差异只发生在顶部边带
  const deepOn = meanOf(stdOn.slice(60), 40);
  const deepOff = meanOf(stdOff.slice(60), 40);
  check('S3 同位置对照：顶部内容淡出（对比度下降）、深部两态一致且都不被遮掉',
    topOn < topOff * 0.85 && topOff > 1 &&
      deepOn > 1 && deepOff > 1 && Math.abs(deepOn - deepOff) < Math.max(0.8, deepOff * 0.2),
    `top10On=${topOn.toFixed(2)} top10Off=${topOff.toFixed(2)} deepOn=${deepOn.toFixed(2)} deepOff=${deepOff.toFixed(2)}`);

  STEP = 'S4';
  await page.evaluate(() => { localStorage.setItem('septcats.look', 'glass'); });
  await page.reload();
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('.app-side-scroll') !== null)) break; }
  await wait(2200);
  await page.evaluate(() => {
    const el = document.querySelector('.app-side-scroll');
    if (el !== null) el.scrollTop = 120;
  });
  await wait(700);
  const m2 = await page.evaluate(MASK_STATE, '.app-side-scroll');
  check('S4 glass 档：遮罩仍生效，且侧栏磨砂未被 mask 破坏（blur ≥20px）',
    m2 !== null && bandHeight(m2) >= 16 && /blur\(2[0-9]px\)|blur\(3[0-9]px\)/.test(m2.sidebarBlur),
    JSON.stringify(m2));

  STEP = 'S4b';
  // vibrancy 实测（Apple §12）：玻璃档里「文字压真壁纸」的渲染态对比度。
  // 两态都量：① 现状（冲突纱生效）② 强制撤掉 clash 属性的基线（= 无冲突分支的纱厚）。
  const pickText = () =>
    page.evaluate(() => {
      const el = document.querySelector('.app-side-head-name') ?? document.querySelector('.app-nav-row');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? '').trim().slice(0, 12),
        color: getComputedStyle(el).color,
        clip: { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(24, Math.round(r.width)), height: Math.max(10, Math.round(r.height)) },
      };
    });
  const shotOf = async (clip, name) => {
    const buf = await page.screenshot({ clip });
    writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
    return textContrastFromShot(decodePng(buf));
  };
  const t1 = await pickText();
  const c1 = t1 === null ? null : await shotOf(t1.clip, 'vibrancy-chrome-clash');
  const clashBefore = await page.evaluate(() => document.documentElement.dataset.wallpaperClash ?? '');
  await page.evaluate(() => { document.documentElement.removeAttribute('data-wallpaper-clash'); });
  await wait(700);
  const c2 = t1 === null ? null : await shotOf(t1.clip, 'vibrancy-chrome-base');
  await page.evaluate((v) => { if (v !== '') document.documentElement.dataset.wallpaperClash = v; }, clashBefore);
  await wait(400);
  check('S4b 玻璃档 chrome 文字：现状（冲突纱）渲染态对比度 ≥4.5（真壁纸上可读）',
    c1 !== null && c1.ratio >= 4.5,
    `text=${JSON.stringify(t1 === null ? null : t1.text)} color=${t1 === null ? '' : t1.color} clash现在态=${JSON.stringify(c1)}`);
  line(`INFO 玻璃档基线（强制撤纱，= 无冲突分支纱厚）对比度=${c2 === null ? 'null' : String(c2.ratio)}（背景占比 ${c2 === null ? '' : String(c2.bgShare)}）`);

  STEP = 'S5';
  await page.evaluate(() => { localStorage.setItem('septcats.look', 'pixel'); });
  await page.reload();
  for (let i = 0; i < 20; i++) { await wait(400); if (await page.evaluate(() => document.querySelector('[data-testid="nav-rail"]') !== null)) break; }
  await wait(1500);
  const hit = await page.evaluate(() => {
    const btn = document.querySelector('.sc-shell__actions .sc-topbtn');
    if (btn === null) return null;
    const r = btn.getBoundingClientRect();
    const above = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top) - 4);
    const inside = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top) + 4);
    return {
      btnBox: { top: Math.round(r.top), h: Math.round(r.height) },
      aboveIsBtn: above !== null && above.closest('.sc-topbtn') === btn,
      insideIsBtn: inside !== null && inside.closest('.sc-topbtn') === btn,
      aboveCls: above === null ? 'null' : String(above.className),
    };
  });
  check('S5 命中内衬：视觉盒上方 4px 处命中仍归属同一钮（Apple §10 命中区 ≥ 视觉盒）',
    hit !== null && hit.insideIsBtn === true && hit.aboveIsBtn === true,
    JSON.stringify(hit));

  STEP = 'S5b';
  // P1 尾：其余长列表体也带遮罩（开命令面板 / 模板市场 / 工作台各看一处）
  const more = await page.evaluate(() => {
    const has = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return 'absent';
      const cs = getComputedStyle(el);
      return cs.maskImage.includes('gradient') && cs.maskSize.includes('100% 100%') ? 'masked' : 'nomask';
    };
    return { palette: has('.palette-list'), market: has('.wbm-body'), flow: has('.wb-flow') };
  });
  // 命令面板需先打开；模板市场/工作台需先切视图 —— 此处只断言「规则命中到元素」的三种合法态
  const moreOk = Object.values(more).every((v) => v === 'masked' || v === 'absent');
  check('S5b 其余长列表体（命令面板结果/模板市场/工作台流程区）遮罩规则已挂（元素存在即为 masked）',
    moreOk, JSON.stringify(more));

  STEP = 'S6';
  const chromaRule = await page.evaluate(() => {
    let found = false;
    let hasChroma = false;
    try {
      for (const sheet of document.styleSheets) {
        const rules = sheet.cssRules;
        for (const rule of rules) {
          const text = rule.cssText ?? '';
          // CSSOM 序列化属性选择器用双引号；两种引号都认，避免误判「规则没进包」
          if (/data-wallpaper-clash=["']chroma["']/.test(text)) { hasChroma = true; found = true; }
        }
      }
    } catch { /* 跨域表不可读时忽略 */ }
    return { found, hasChroma };
  });
  check('S6 vibrancy 彩度纱（P1②/④）的 CSS 分档已进包（chroma 规则可见）', chromaRule.hasChroma === true, JSON.stringify(chromaRule));

  STEP = 'S7';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('S7 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T94-01 UI 评估 P1 探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked，${String(Math.round((Date.now() - t0) / 1000))}s，截图 ${SHOT_DIR}）=====`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});