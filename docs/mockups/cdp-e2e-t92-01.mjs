/* cdp-e2e-t92-01.mjs —— T92-01「顶栏同步状态那一行按键全部换中文按键」真机验收
 * （老板 09-29 令：「我说的是同步状态的那一行按键，全部换成中文按键。」）
 *
 * 方案：顶栏 actions 排（模板市场 / 搜索 / AI 对话 / 同步状态 / 导入 / 布局 / 设置）
 * 由「纯图标钮」升级为「像素 glyph + 可见中文文字」钮（TopBarButton.tsx）。
 * 关键契约（本探针逐条钉死）：
 *   - 中文可见：每个钮的可见文字非空且为中文短文案（不再只藏在 tooltip 里）；
 *   - 语义零破坏：aria-label / aria-pressed / aria-expanded / data-testid 原样，
 *     故 T57/T58/T66/T74 的既有测试与探针取钮路径不变；
 *   - 像素族保留：每钮仍带 16×16 + crispEdges 的像素 glyph（T58/T74 契约）；
 *   - 不裁切/不溢出：钮内文字未被截断，整排右缘不出顶栏；
 *   - 行为零回归：布局弹框开合、命令面板、设置页往返照旧；
 *   - 三轴随主题：切 dark+glass 后钮文字色随 token 变（不是硬编码色）。
 *
 * 判据（全部 DOM/几何客观量）：
 *   H1 顶栏 actions 七钮齐全且顺序 = 模板市场→搜索→AI 对话→同步状态→导入→布局→设置。
 *   H2 六枚文字钮可见中文非空；同步钮可见状态文字（sync.* 之一）。
 *   H3 无一钮文字被裁切（scrollWidth ≤ clientWidth+1）且整排右缘 ≤ 顶栏右缘。
 *   H4 六枚文字钮仍带像素族 svg（viewBox 0 0 16 16 + crispEdges）。
 *   H5 点「布局」→ 弹框开 + aria-pressed 翻 true；Esc → 关 + 回 false。
 *   H6 点「搜索」→ 命令面板开；Esc → 关。
 *   H7 点「设置」→ 设置页（面包屑「设置」）；再点 → 回编辑器（.pv-root 复现）。
 *   H8 切 dark+glass：钮文字色与 light+paper 不同（token 随主题，非硬编码）。
 *   H9 真实档案根 mtime 不变（夹具零触碰红线）。
 * 靶 = apps/desktop/dist/win-unpacked。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const PACKAGE_APP = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t92-01';
const UD = `${RUN}\\ud`;
const ROOTD = `${RUN}\\data`;
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? '9598');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const SHOT_DIR = `${RUN}\\shots`;
const RESULT = join(SCRIPT_DIR, 'screens-t92', 'result.log');

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
  line(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 180)}`);
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

async function waitReady(page) {
  for (let i = 0; i < 20; i++) {
    await wait(400);
    if (await page.evaluate(() => document.querySelector('[data-testid="title-bar-band"]') !== null)) break;
  }
  await wait(1500);
}

async function boot(theme, palette, look) {
  for (const pid of listeningPids(PORT)) killTree(pid);
  killStaleApp();
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOTD, { recursive: true }); mkdirSync(SHOT_DIR, { recursive: true });
  // 数据根钉进 scratch（probe-discipline：septcats.settings.json 夹具）
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOTD, theme, locale: 'zh-CN',
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
  await page.evaluate(([pal, lk]) => { localStorage.setItem('septcats.palette', pal); localStorage.setItem('septcats.look', lk); localStorage.setItem('septcats.theme', 'light'); }, [palette, look]);
  await page.reload();
  await waitReady(page);
  return { child: CHILD, browser, page };
}

/** 顶栏 actions 排全量转储（几何 + 可见文字 + 像素族 + 计算色）。 */
const BAR_DUMP = () => {
  const bar = document.querySelector('.sc-shell__actions');
  const topbar = document.querySelector('.sc-shell__topbar');
  if (bar === null || topbar === null) return null;
  const tr = topbar.getBoundingClientRect();
  const rows = [...bar.children].map((el) => {
    // 同步钮是 <div.sc-sync-status> 包着 <button>（其余钮直系即 button）→
    // 统一取「控件元素」读 label/pressed/几何，避免读到包装层（其无 aria-label）。
    const ctl = el.tagName === 'BUTTON' ? el : (el.querySelector('button') ?? el);
    const r = ctl.getBoundingClientRect();
    const svg = ctl.querySelector('svg');
    const textEl = ctl.querySelector('.sc-topbtn__text') ?? ctl.querySelector('.sc-sync-status__label');
    const tr2 = textEl === null ? null : textEl.getBoundingClientRect();
    return {
      cls: String(el.className),
      label: ctl.getAttribute('aria-label'),
      text: (textEl === null ? ctl.textContent : textEl.textContent) ?? '',
      pressed: ctl.getAttribute('aria-pressed'),
      expanded: ctl.getAttribute('aria-expanded'),
      w: Math.round(r.width), h: Math.round(r.height),
      // 裁切三判据：钮容器不溢出 + 文字 span 不溢出 + 文字几何被钮盒完全包含
      clipped: ctl.scrollWidth > ctl.clientWidth + 1,
      tClipped: textEl === null ? false : textEl.scrollWidth > textEl.clientWidth + 1,
      tW: tr2 === null ? 0 : Math.round(tr2.width),
      tInside: tr2 === null ? true : tr2.right <= r.right + 0.5 && tr2.left >= r.left - 0.5,
      font: textEl === null ? '' : getComputedStyle(textEl).fontSize,
      // 细项：图标盒宽 / 内边距 / 间距 / 页面缩放（查「按钮宽度 < 图标+文字」成因）
      iconW: svg === null ? 0 : Math.round(svg.getBoundingClientRect().width),
      padL: getComputedStyle(ctl).paddingLeft,
      gap: getComputedStyle(ctl).columnGap,
      bwStyle: getComputedStyle(ctl).width,
      zoom: window.devicePixelRatio,
      viewBox: svg === null ? null : svg.getAttribute('viewBox'),
      crisp: svg === null ? null : svg.getAttribute('shape-rendering'),
      color: getComputedStyle(ctl).color,
    };
  });
  return {
    rows,
    topbarRight: Math.round(tr.right),
    barRight: Math.round(bar.getBoundingClientRect().right),
    topbarW: Math.round(tr.width),
    winW: window.innerWidth,
  };
};

const LABELS = [
  '工作台模板市场',
  '搜索（Ctrl+K）',
  'AI 对话（Ctrl+J）',
  '同步状态',
  '导入',
  '布局',
  '设置',
];
const TEXTS = ['模板市场', '搜索', 'AI 对话', null, '导入', '布局', '设置'];
const SYNC_TEXT_RE = /已同步|同步中|同步未开启|同步错误|同步文件夹不可访问|密钥不匹配|同步状态加载中/;

async function topbarShot(page, name) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.sc-shell__topbar');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.max(24, Math.round(r.height)) };
  });
  if (box === null) throw new Error('顶栏元素缺失');
  const buf = await page.screenshot({ clip: box });
  writeFileSync(join(SHOT_DIR, `${name}.png`), buf);
  return join(SHOT_DIR, `${name}.png`);
}

async function main() {
  const t0 = Date.now();
  if (!existsSync(PACKAGE_APP)) { line('FATAL 缺打包靶 ' + PACKAGE_APP); process.exitCode = 2; return; }
  const realBefore = rootMtime();

  const h = await boot('light', 'paper', 'pixel');
  const { page } = h;

  STEP = 'H1/H2/H3/H4';
  const bar = await page.evaluate(BAR_DUMP);
  if (bar === null) { line('FATAL 顶栏 actions 未就绪'); await h.browser.close().catch(() => {}); h.child.kill(); process.exitCode = 1; return; }
  line(`顶栏 actions 转储：${JSON.stringify(bar, null, 0).slice(0, 900)}`);

  const labels = bar.rows.map((r) => r.label);
  line(`顶栏 aria-label 清单：${JSON.stringify(labels)}`);
  const mism = LABELS.findIndex((l, i) => labels[i] !== l);
  check('H1 七钮齐全且顺序 = 模板市场→搜索→AI 对话→同步状态→导入→布局→设置',
    bar.rows.length === 7 && mism === -1,
    `count=${String(bar.rows.length)} mismatchAt=${String(mism)} got=${JSON.stringify(labels)}`);

  const textOk = bar.rows.every((r, i) => {
    if (i === 3) return SYNC_TEXT_RE.test(r.text.trim());
    return (r.text ?? '').trim() === TEXTS[i];
  });
  check('H2 六钮可见中文文案逐字命中 + 同步钮可见状态文字（中文不再只藏 tooltip）',
    textOk, JSON.stringify(bar.rows.map((r) => r.text.trim())));

  const noClip = bar.rows.every((r) => r.clipped === false && r.tClipped === false && r.tInside === true);
  const noOverflow = bar.barRight <= bar.topbarRight + 1;
  check('H3 无一钮文字被裁切（钮/span/包含三判据）+ 整排右缘不出顶栏',
    noClip && noOverflow,
    `clipped=${JSON.stringify(bar.rows.map((r) => `${r.clipped}/${r.tClipped}/${r.tInside}`))} w=${JSON.stringify(bar.rows.map((r) => r.w))} textW=${JSON.stringify(bar.rows.map((r) => r.tW))} font=${bar.rows[0].font} barRight=${String(bar.barRight)} topbarRight=${String(bar.topbarRight)} winW=${String(bar.winW)}`);

  const glyphOk = bar.rows.every((r, i) => (i === 3 ? r.viewBox === null : r.viewBox === '0 0 16 16' && r.crisp === 'crispEdges'));
  check('H4 六枚文字钮仍带像素族 svg（16×16 + crispEdges，T58/T74 契约保活）',
    glyphOk, JSON.stringify(bar.rows.map((r) => `${r.viewBox}/${r.crisp}`)));

  const shot1 = await topbarShot(page, 'topbar-light-pixel');

  STEP = 'H3b';
  // Electron 的 CDP 无 Browser 域 → 用 Emulation 缩视口验窄窗布局（布局口径等价）
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await wait(1200);
  const barNarrow = await page.evaluate(BAR_DUMP);
  const rowW = barNarrow.barRight - (barNarrow.topbarRight - barNarrow.topbarW);
  check('H3b 窄窗（900 CSS px）整排仍不裁切不溢出（面包屑先让位）',
    barNarrow.rows.every((r) => r.clipped === false && r.tClipped === false && r.tInside === true) &&
      barNarrow.barRight <= barNarrow.topbarRight + 1,
    `rowW=${String(rowW)} barRight=${String(barNarrow.barRight)} topbarRight=${String(barNarrow.topbarRight)} widths=${JSON.stringify(barNarrow.rows.map((r) => r.w))}`);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 760, height: 700, deviceScaleFactor: 1, mobile: false });
  await wait(1200);
  const barMin = await page.evaluate(BAR_DUMP);
  check('H3c 近最小宽（760 CSS px）整排仍不裁切不溢出（含侧栏展开态）',
    barMin.rows.every((r) => r.clipped === false && r.tClipped === false && r.tInside === true) &&
      barMin.barRight <= barMin.topbarRight + 1,
    `barRight=${String(barMin.barRight)} topbarRight=${String(barMin.topbarRight)} widths=${JSON.stringify(barMin.rows.map((r) => r.w))}`);
  await session.send('Emulation.clearDeviceMetricsOverride');
  await wait(700);

  STEP = 'H5';
  await page.locator('[data-testid="layout-open"]').click({ force: true });
  await wait(700);
  const pickerOpen = await page.evaluate(() => document.querySelector('[data-testid="layout-picker"]') !== null);
  const pressedOn = await page.locator('[data-testid="layout-open"]').getAttribute('aria-pressed');
  await page.keyboard.press('Escape');
  await wait(600);
  const pickerClosed = await page.evaluate(() => document.querySelector('[data-testid="layout-picker"]') === null);
  const pressedOff = await page.locator('[data-testid="layout-open"]').getAttribute('aria-pressed');
  check('H5 「布局」钮：点击弹框开 + aria-pressed=true；Esc 关 + 回 false',
    pickerOpen && pressedOn === 'true' && pickerClosed && pressedOff === 'false',
    `open=${String(pickerOpen)} on=${String(pressedOn)} closed=${String(pickerClosed)} off=${String(pressedOff)}`);

  STEP = 'H6';
  await page.locator('.sc-shell__actions .sc-topbtn[aria-label^="搜索"]').click({ force: true });
  await wait(700);
  const paletteOpen = await page.evaluate(() => document.querySelector('[data-testid="palette-overlay"]') !== null);
  await page.keyboard.press('Escape');
  await wait(600);
  const paletteClosed = await page.evaluate(() => document.querySelector('[data-testid="palette-overlay"]') === null);
  check('H6 「搜索」钮：点击开命令面板；Esc 关', paletteOpen && paletteClosed,
    `open=${String(paletteOpen)} closed=${String(paletteClosed)}`);

  STEP = 'H7';
  await page.locator('.sc-shell__actions .sc-topbtn[aria-label="设置"]').click({ force: true });
  await wait(900);
  const inSettings = await page.evaluate(() => ({
    crumb: document.querySelector('.sc-shell__crumb')?.textContent ?? '',
    pv: document.querySelector('.pv-root') !== null,
  }));
  await page.locator('.sc-shell__actions .sc-topbtn[aria-label="设置"]').click({ force: true });
  await wait(900);
  const backToEditor = await page.evaluate(() => document.querySelector('.pv-root') !== null);
  check('H7 「设置」钮：进入设置页（面包屑「设置」）→ 再点回编辑器',
    inSettings.crumb.includes('设置') && inSettings.pv === false && backToEditor,
    `crumb=${JSON.stringify(inSettings.crumb)} pvInSettings=${String(inSettings.pv)} pvBack=${String(backToEditor)}`);

  STEP = 'H8';
  const lightColor = bar.rows[5].color;
  await page.evaluate(() => { localStorage.setItem('septcats.look', 'glass'); localStorage.setItem('septcats.theme', 'dark'); localStorage.setItem('septcats.palette', 'slate'); });
  await page.reload();
  await waitReady(page);
  const barDark = await page.evaluate(BAR_DUMP);
  const darkColor = barDark.rows[5].color;
  const shot2 = await topbarShot(page, 'topbar-dark-glass');
  check('H8 三轴随主题：dark+glass 下钮文字色随 token 变（非硬编码色）',
    lightColor !== darkColor && /rgb/.test(darkColor),
    `light=${lightColor} dark=${darkColor}`);

  STEP = 'H9';
  await h.browser.close().catch(() => {});
  h.child.kill();
  await wait(1200);
  killStaleApp();
  const realAfter = rootMtime();
  check('H9 真实档案根 mtime 不变（夹具零触碰红线）', realBefore === realAfter,
    `before=${String(realBefore)} after=${String(realAfter)}`);

  const pass = assertions.filter((a) => a.ok).length;
  const fail = assertions.length - pass;
  line(`===== T92-01 顶栏中文按键探针：${String(pass)} PASS / ${String(fail)} FAIL（靶=win-unpacked，${String(Math.round((Date.now() - t0) / 1000))}s，截图 ${SHOT_DIR}）=====`);
  line(`截图：${shot1} | ${shot2}`);
  if (fail > 0) { for (const a of assertions.filter((x) => !x.ok)) line(`FAILED ${a.step} ${a.name} — ${a.raw}`); }
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((err) => {
  line(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  try { if (CHILD !== null) CHILD.kill(); } catch { /* 已退 */ }
  killStaleApp();
  process.exitCode = 2;
});