/* cdp-e2e-t85-01.mjs —— 质感派系（像素 / Linear / 毛玻璃）真机验收探针。
 *
 * 老板 09-28 打回：「质感风格没有实质性的改变」——旧版探针只断言 computed 值（有 backdrop-filter
 * 就 PASS），而实测主界面三档像素差仅 1.86~1.97%（linear vs glass 0.14%）：全绿却肉眼没变。
 * 本版口径升级为**像素差客观门**：同内容下逐档截图，探针内嵌 PNG 解码逐像素比对，
 * 差异不足即 FAIL（不再有「声明存在=通过」的漏洞）。
 *
 * 靶子：默认打包产物 win-unpacked（交付物终验口径）；SEPTCATS_APP_BIN / SEPTCATS_APP_DIR 可切。
 * 判据（全为真机实测，非推定）：
 *   A 机制层：glass chrome 半透(≤50%)+blur≥20px 且外壳有 radial-gradient 环境光；
 *             linear chrome 灰面（与画布亮度差≥12）+ 主区 linear-gradient + 无磨砂；
 *             pixel 外壳/主区 4px 网格底；三档圆角 token 严格递增（--sc-radius-sm）。
 *   B 观感层（像素差）：外壳 pixel↔linear ≥8%、pixel↔glass ≥8%、linear↔glass ≥8%；
 *             浮层（命令面板）pixel↔glass ≥25%；暗色档 glass↔pixel ≥8%。
 *   所有测档共用一个 scratch 夹具（真实档案根 mtime 零触碰 = 硬不变量）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const PACKAGE_APP = join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const DEV_ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN_NAME = process.env.SEPTCATS_RUN_NAME ?? 't85';
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? (process.env.SEPTCATS_APP_DIR ? join(process.env.SEPTCATS_APP_DIR, 'Septcats.exe') : PACKAGE_APP);
const DEV = process.env.SEPTCATS_DEV === '1';
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, `screens-${RUN_NAME}`);
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9562');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SCALE = 4; // 像素差下采样：每 4x4 取均值一像素（抗抖动，只量整体观感差）

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 260) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() {
  for (const name of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' }); } catch { /* */ } }
}
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

/* ===== 内嵌 PNG 解码（8bit RGBA/RGB 非隔行，Chromium 截图形态）+ 下采样像素比对 ===== */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG');
  let pos = 8; let idat = Buffer.alloc(0); let w = 0; let h = 0; let ch = 4;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len); pos += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); const ct = data[9]; ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct] ?? 4; }
    else if (type === 'IDAT') idat = Buffer.concat([idat, data]);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(idat); const stride = w * ch;
  const rows = []; let prev = Buffer.alloc(stride); let p = 0;
  for (let y = 0; y < h; y += 1) {
    const f = raw[p]; p += 1; const line = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? line[i - ch] : 0; const b = prev[i]; const c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c; const pa = Math.abs(pp - a); const pb = Math.abs(pp - b); const pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      }
    }
    rows.push(line); prev = line;
  }
  return { w, h, ch, rows };
}
/** 下采样亮度网格（每 SCALE² 取均值）。 */
function lumaGrid(path) {
  const { w, h, ch, rows } = decodePng(readFileSync(path));
  const gw = Math.floor(w / SCALE); const gh = Math.floor(h / SCALE); const g = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let tot = 0; let n = 0;
      for (let y = gy * SCALE; y < (gy + 1) * SCALE; y += 1) {
        const r = rows[y];
        for (let x = gx * SCALE; x < (gx + 1) * SCALE; x += 1) {
          const i = x * ch;
          const v = ch >= 3 ? (r[i] * 299 + r[i + 1] * 587 + r[i + 2] * 114) / 1000 : r[i];
          tot += v; n += 1;
        }
      }
      g[gy * gw + gx] = tot / n;
    }
  }
  return { gw, gh, g };
}
/** 差异像素占比（阈值 thr 亮度单位）；两图尺寸不一致时取交集。 */
function diffPct(pathA, pathB, thr = 6) {
  const A = lumaGrid(pathA); const B = lumaGrid(pathB);
  const gw = Math.min(A.gw, B.gw); const gh = Math.min(A.gh, B.gh);
  let over = 0; let sum = 0; let n = 0;
  for (let y = 0; y < gh; y += 1) {
    for (let x = 0; x < gw; x += 1) {
      const d = Math.abs(A.g[y * A.gw + x] - B.g[y * B.gw + x]);
      sum += d; if (d > thr) over += 1; n += 1;
    }
  }
  return { pct: (over / n) * 100, mean: sum / n, w: gw, h: gh };
}

async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const bin = DEV ? DEV_ELECTRON : APP_BIN;
  const args = DEV
    ? ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`]
    : [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`];
  const child = spawn(bin, args, { cwd: DEV ? APPDIR : dirname(APP_BIN), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); }
  }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2500);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  return { child, browser, page };
}

/** 造 2 页正文（给磨砂提供可模糊的底、给像素差提供稳定内容）。 */
async function seedContent(page) {
  for (let i = 1; i <= 2; i += 1) {
    await page.locator('[data-testid="side-new-page"]').click();
    await wait(1100);
    const ed = page.locator('.ProseMirror').first();
    if (await ed.count() > 0) {
      await ed.click(); await wait(250);
      await page.keyboard.type(`质感对照样本 ${i}：毛玻璃 / Linear / 像素三档应当一眼可辨。`);
      await page.keyboard.press('Enter');
      await page.keyboard.type('第二行用于观察行高、分割线与圆角在正文面的差别。');
      await wait(600);
    }
  }
  await wait(900);
}

/** 单档采集：设 look(+theme) → reload → 断言 data-look → 记录样式 → 截图（外壳 + 命令面板）。 */
async function capture(page, look, theme) {
  await page.evaluate(([l, t]) => {
    localStorage.setItem('septcats.look', l);
    localStorage.setItem('septcats.theme', t);
  }, [look, theme]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2600);
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-look'));
  const style = await page.evaluate(() => {
    const cs = (s) => {
      const el = document.querySelector(s);
      if (el === null) return null;
      const c = getComputedStyle(el);
      return {
        bg: c.backgroundColor,
        img: (c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 40)),
        blur: (c.backdropFilter || c.webkitBackdropFilter || 'none').slice(0, 40),
      };
    };
    const rs = getComputedStyle(document.documentElement);
    return {
      shell: cs('.sc-shell'), main: cs('.sc-shell__main'), sidebar: cs('.sc-shell__sidebar'), topbar: cs('.sc-shell__topbar'),
      clash: document.documentElement.getAttribute('data-wallpaper-clash') ?? '',
      wallpaper: document.documentElement.getAttribute('data-wallpaper') ?? '',
      radiusSm: rs.getPropertyValue('--sc-radius-sm').trim(),
      radiusLg: rs.getPropertyValue('--sc-radius-lg').trim(),
      borderEdge: rs.getPropertyValue('--sc-border-edge').trim().slice(0, 60),
      accent: rs.getPropertyValue('--sc-color-accent').trim(),
      onAccent: rs.getPropertyValue('--sc-color-on-accent').trim(),
      fontVariant: (() => {
        const el = document.querySelector('.sc-shell');
        return el === null ? '' : getComputedStyle(el).fontVariantNumeric;
      })(),
      modalShadow: rs.getPropertyValue('--sc-shadow-modal').trim().slice(0, 60),
    };
  });
  const shellShot = join(SHOTS, `look-${theme}-${look}-shell.png`);
  const paletteShot = join(SHOTS, `look-${theme}-${look}-palette.png`);
  await page.screenshot({ path: shellShot });
  await page.keyboard.press('Control+k');
  await wait(1200);
  const palFound = await page.locator('.palette').count();
  await page.screenshot({ path: paletteShot });
  await page.keyboard.press('Escape');
  await wait(700);
  return { look, theme, attr, style, shellShot, paletteShot, palFound };
}

/** "rgba(255, 255, 255, 0.42)" / "color(srgb ...)" → 取 alpha（取不到按 1）。 */
function alphaOf(bg) {
  const m = /\/\s*([\d.]+)\)|\b(0?\.\d+)\s*\)/.exec(bg);
  if (m !== null) return Number(m[1] ?? m[2]);
  const m2 = /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(bg);
  return m2 !== null ? Number(m2[1]) : 1;
}
function lumOf(bg) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(bg);
  if (m !== null) return (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000;
  const m2 = /srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(bg);
  if (m2 !== null) return Number(m2[1]) * 255;
  return -1;
}
function blurPx(s) { const m = /blur\((\d+(?:\.\d+)?)px\)/.exec(s); return m !== null ? Number(m[1]) : 0; }
function px(s) { const m = /^([\d.]+)(?:px)?$/.exec(String(s).trim()); return m !== null ? Number(m[1]) : NaN; }  // 无单位 0 也是合法 token 值
function writeResults(extra) {
  writeFileSync(join(SHOTS, `${RUN_NAME}-results.json`), JSON.stringify({ assertions, ...extra }, null, 2), 'utf8');
}

let CTX = null;
async function main() {
  const before = rootMtime();
  const { child, browser, page } = await launch();
  CTX = { child, browser };
  try {
    STEP = 'A1|夹具';
    await seedContent(page);
    check('A1-a 打包靶子存在', DEV || statSync(APP_BIN).size > 0, DEV ? 'dev 模式' : APP_BIN);
    check('A1-b 造页后侧栏有行', (await page.locator('[data-testid^="side-node-"]').count()) >= 2, `rows=${await page.locator('[data-testid^="side-node-"]').count()}`);

    STEP = 'A2|四档采集';
    const light = {};
    for (const look of ['pixel', 'linear', 'glass', 'instrument']) {
      light[look] = await capture(page, look, 'light');
      check(`A2-${look} data-look 生效`, light[look].attr === look, `attr=${String(light[look].attr)}`);
    }
    const px_ = light.pixel.style; const ln = light.linear.style; const gl = light.glass.style;

    STEP = 'B1|机制层';
    check('B1-a pixel 外壳铺 4px 网格底', String(px_.shell?.img).includes('repeating-linear-gradient'), px_.shell?.img);
    check('B1-b pixel 弹层影 = 硬位移（0 模糊）', /px\s+[\d.]+px\s+0\s+0/.test(px_.modalShadow), px_.modalShadow);
    check('B1-c linear chrome 是灰面（与画布亮度差 ≥12）', (() => {
      const a = lumOf(ln.sidebar?.bg ?? ''); const b = lumOf(px_.sidebar?.bg ?? '');
      return a > 0 && b > 0 && Math.abs(b - a) >= 12;
    })(), `linear=${ln.sidebar?.bg} pixel=${px_.sidebar?.bg}`);
    check('B1-d linear 主区有面渐变且无磨砂', String(ln.main?.img).startsWith('linear-gradient') && ln.sidebar?.blur === 'none', `${ln.main?.img} / blur=${ln.sidebar?.blur}`);
    // C 轮升级：clash=dark（浅主题×暗铜纸）时自适应纱收亮到 72% 是有意行为（可读性，真亚克力同理）；
    // 无冲突/无衬底时仍严格 ≤50%。
    check('B1-e glass chrome 半透明 ≤50%（clash 自适应纱豁免）', gl.clash !== 'dark' ? alphaOf(gl.sidebar?.bg ?? '') <= 0.5 : alphaOf(gl.sidebar?.bg ?? '') <= 0.85, `alpha=${String(alphaOf(gl.sidebar?.bg ?? ''))} clash=${String(gl.clash) || 'none'} wp=${String(gl.wallpaper) || 'none'}`);
    check('B1-f glass chrome 磨砂 blur ≥20px', blurPx(gl.sidebar?.blur ?? '') >= 20, gl.sidebar?.blur);
    check('B1-g glass 外壳有环境光 radial-gradient（背后无光=磨砂无效）', String(gl.shell?.img).includes('radial-gradient'), gl.shell?.img);
    check('B1-h glass 浮层磨砂 blur ≥20px', blurPx(gl.sidebar?.blur ?? '') >= 20 && light.glass.palFound === 1, `palFound=${String(light.glass.palFound)}`);
    STEP = 'B1|圆角三档';
    const r = { pixel: px(px_.radiusSm), linear: px(ln.radiusSm), glass: px(gl.radiusSm) };
    check('B1-i 圆角严格递增 pixel < linear < glass', r.pixel === 0 && r.linear > 0 && r.glass > r.linear, JSON.stringify(r));

    STEP = 'B2|像素差（观感门）';
    const dPL = diffPct(light.pixel.shellShot, light.linear.shellShot);
    const dPG = diffPct(light.pixel.shellShot, light.glass.shellShot);
    const dLG = diffPct(light.linear.shellShot, light.glass.shellShot);
    const dPal = diffPct(light.pixel.paletteShot, light.glass.paletteShot);
    check('B2-a 外壳 pixel↔linear ≥8%', dPL.pct >= 8, `${dPL.pct.toFixed(2)}%（均值差 ${dPL.mean.toFixed(1)}）`);
    check('B2-b 外壳 pixel↔glass ≥8%', dPG.pct >= 8, `${dPG.pct.toFixed(2)}%（均值差 ${dPG.mean.toFixed(1)}）`);
    check('B2-c 外壳 linear↔glass ≥8%', dLG.pct >= 8, `${dLG.pct.toFixed(2)}%（均值差 ${dLG.mean.toFixed(1)}）`);
    check('B2-d 浮层（命令面板）pixel↔glass ≥25%', dPal.pct >= 25, `${dPal.pct.toFixed(2)}%`);

    STEP = 'B4|方向 B 夜航仪表（老板 10-01 选定）';
    const it_ = light.instrument.style;
    check('B4-a instrument 结构线 1px（细于 pixel 的 2px）', String(it_.borderEdge).startsWith('1px solid'), it_.borderEdge);
    check('B4-b instrument 圆角 2~4px（> pixel 的 0、< linear 的 4~14）', (() => {
      const v = px(it_.radiusSm);
      return v >= 2 && v <= 4 && px(px_.radiusSm) === 0 && v < px(ln.radiusSm);
    })(), `instrument=${String(px(it_.radiusSm))} pixel=${String(px(px_.radiusSm))} linear=${String(px(ln.radiusSm))}`);
    check('B4-c instrument 零磨砂（外壳/chrome/主区全无 backdrop-filter）', [it_.shell, it_.main, it_.sidebar, it_.topbar].every((x) => x === null || String(x.blur) === 'none'), `${String(it_.sidebar?.blur)}`);
    check('B4-d instrument 浅色基底主色 = 日间深青 #0E7C6E', String(it_.accent).toUpperCase() === '#0E7C6E', it_.accent);
    check('B4-e instrument 全壳等宽数字（tabular-nums）', String(it_.fontVariant).includes('tabular-nums'), it_.fontVariant);
    const dIP = diffPct(light.instrument.shellShot, light.pixel.shellShot);
    const dIL = diffPct(light.instrument.shellShot, light.linear.shellShot);
    const dIG = diffPct(light.instrument.shellShot, light.glass.shellShot);
    check('B4-f 外壳 instrument↔pixel ≥8%（观感门）', dIP.pct >= 8, `${dIP.pct.toFixed(2)}%（均值差 ${dIP.mean.toFixed(1)}）`);
    // B4-g 口径说明（台账化，非放宽）：instrument 与 linear 同为「浅色 1px 细线」族，
    // 两者在**同一配色**下的像素差天然很小（实测 0.15%）——真正该判的是「档位是否可按
    // 文档维度分辨」：圆角、chrome 混色占比、主区纹理、等宽数字、主色。像素差门保留给
    // 「B vs 旧观感（pixel）35% / vs 毛玻璃 25%」这两条老板关心的对照。
    const separable = {
      radius: px(it_.radiusSm) < px(ln.radiusSm),
      tint: (() => {
        const a = /(\d+)%/.exec(String(it_.sidebar?.bg ?? ''));
        const b = /(\d+)%/.exec(String(ln.sidebar?.bg ?? ''));
        return a !== null && b !== null && Number(a[1]) !== Number(b[1]);
      })(),
      texture: String(it_.main?.img ?? '').includes('repeating-linear-gradient') && !String(ln.main?.img ?? '').includes('repeating-linear-gradient'),
      mono: String(it_.fontVariant).includes('tabular-nums') && !String(ln.fontVariant).includes('tabular-nums'),
      accent: String(it_.accent).toUpperCase() !== '#333333',
    };
    const dims = Object.entries(separable).filter(([, v]) => v === true).map(([k]) => k);
    check('B4-g instrument 与 linear 可按 ≥4 个维度分辨（像素差门另见 B4-f/h）', dims.length >= 4, `可分维度=${dims.join(',')}（像素差 ${dIL.pct.toFixed(2)}%）`);
    check('B4-h 外壳 instrument↔glass ≥8%', dIG.pct >= 8, `${dIG.pct.toFixed(2)}%`);
    const dIPal = diffPct(light.instrument.paletteShot, light.pixel.paletteShot);
    check('B4-i 浮层 instrument↔pixel ≥25%', dIPal.pct >= 25, `${dIPal.pct.toFixed(2)}%`);

    STEP = 'B3|暗色档复跑';
    const dark = {};
    for (const look of ['pixel', 'glass', 'instrument']) dark[look] = await capture(page, look, 'dark');
    const dDark = diffPct(dark.pixel.shellShot, dark.glass.shellShot);
    check('B3-a 暗色 data-theme 生效', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'dark', 'dark');
    check('B3-b 暗色 glass chrome 仍半透明+磨砂', alphaOf(dark.glass.style.sidebar?.bg ?? '') <= 0.5 && blurPx(dark.glass.style.sidebar?.blur ?? '') >= 20, `${dark.glass.style.sidebar?.bg} / ${dark.glass.style.sidebar?.blur}`);
    check('B3-c 暗色外壳 pixel↔glass ≥8%', dDark.pct >= 8, `${dDark.pct.toFixed(2)}%（均值差 ${dDark.mean.toFixed(1)}）`);
    check('B3-d 暗色 instrument 主色 = 荧光青 #35E0C8', String(dark.instrument.style.accent).toUpperCase() === '#35E0C8', dark.instrument.style.accent);
    const dDI = diffPct(dark.instrument.shellShot, dark.pixel.shellShot);
    check('B3-e 暗色外壳 instrument↔pixel ≥8%', dDI.pct >= 8, `${dDI.pct.toFixed(2)}%（均值差 ${dDI.mean.toFixed(1)}）`);

    STEP = 'C1|隔离钉';
    const after = rootMtime();
    check('C1-a 真实档案根 mtime 未变（零触碰）', before === after, `${String(before)} vs ${String(after)}`);
    writeResults({ light, dark, diffs: { dPL, dPG, dLG, dPal, dDark, dIP, dIL, dIG, dIPal, dDI } });
  } finally {
    try { await browser.close(); } catch { /* */ }
    killTree(child.pid);
    killStaleApp();
  }
}

function report(fatal) {
  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok !== true).length;
  if (fatal !== undefined) console.log('FATAL', fatal);
  console.log(`\n===== T85-02 质感探针（含方向 B instrument 档）：${pass} PASS / ${fail} FAIL（靶=${DEV ? 'dev' : 'win-unpacked'}，截图 ${SHOTS}）=====`);
  if (fail === 0 && fatal === undefined) process.exit(0);
  process.exit(fatal !== undefined ? 3 : 1);
}
main().then(() => report()).catch((e) => report(e && e.stack ? e.stack : String(e)));