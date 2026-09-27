/*
 * cdp-e2e-t65-01.mjs —— 主题设置真机取证（TASK-T65-01 画廊版 → 老板 09-27 令后改口径）。
 *
 * **老板 09-27 原话**：「2. 根本没有毛玻璃等主题 … 4. 取消主题画廊」→ 画廊浮层/顶栏
 * 入口钮/命令面板 theme.palette 一并删除，配色 + 质感**内联进「设置→外观」两行**。
 * 本探针钉住改口径后的真机事实（真实 UI 路径，非直写 localStorage）：
 *   T1 设置→外观：配色 6 项 + 质感 3 项（像素/Linear 极简/毛玻璃）在位；
 *   T2 画廊零残留：无 theme-gallery 浮层、无 theme-gallery-entry 入口钮、无顶栏 palette-open 钮；
 *   T3 点「苔青」→ data-palette=moss 即时生效 + localStorage 持久；
 *   T4 oled×light 回退：浅色基底置灰不可选（disabled），深色基底可选并落 oled；
 *   T5 重启后 data-palette/data-look 仍在（持久链）；
 *   T6 真实档案根 mtime 未变（零触碰）。
 * 夹具双隔离（settings rootPath + user-data-dir）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t65-pm';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t65');
const PORT = 9561;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

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
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}

async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
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
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  return { child, browser, page };
}

/** 打开设置页 → 等主题两行就位（老板口径：这里是唯一入口）。 */
async function openSettings(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));
  await page.waitForSelector('[data-testid="theme-look-section"]', { timeout: 15000 });
  await wait(400);
}

async function rootSig(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme') ?? 'none',
    palette: document.documentElement.getAttribute('data-palette') ?? 'none',
    look: document.documentElement.getAttribute('data-look') ?? 'none',
    bodyBg: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem('septcats.palette') ?? 'none',
  }));
}

async function rowFacts(page) {
  return page.evaluate(() => {
    const lookRow = document.querySelector('[data-testid="theme-look-section"]');
    const paletteRow = document.querySelector('[data-testid="theme-section"]');
    const labels = (row) => [...(row?.querySelectorAll('.sc-radio__label') ?? [])].map((el) => el.textContent ?? '');
    const oled = paletteRow?.querySelector('input[value="oled"]');
    return {
      lookLabels: labels(lookRow),
      lookCount: lookRow?.querySelectorAll('input[type="radio"]').length ?? 0,
      paletteCount: paletteRow?.querySelectorAll('input[type="radio"]').length ?? 0,
      oledDisabled: oled ? oled.disabled === true : null,
      galleryOverlay: document.querySelector('[data-testid="theme-gallery"]') !== null,
      galleryEntry: document.querySelector('[data-testid="theme-gallery-entry"]') !== null,
      paletteOpenBtn: document.querySelector('[data-testid="palette-open"]') !== null,
    };
  });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  const app = await launch();
  try {
    // ===== T1 设置→外观 两行在位（老板「根本没有毛玻璃等主题」的正面钉）=====
    STEP = 'T1|两行在位';
    await openSettings(app.page);
    let f = await rowFacts(app.page);
    check('T1-a 质感行 3 项 = 像素/Linear 极简/毛玻璃',
      f.lookCount === 3 && f.lookLabels.includes('像素') && f.lookLabels.includes('Linear 极简') && f.lookLabels.includes('毛玻璃'),
      JSON.stringify(f.lookLabels));
    check('T1-b 配色行 6 项', f.paletteCount === 6, String(f.paletteCount));
    await app.page.screenshot({ path: join(SHOTS, 't1-theme-rows.png') });

    // ===== T2 画廊零残留 =====
    STEP = 'T2|画廊取消';
    check('T2-a 无画廊浮层', f.galleryOverlay === false, String(f.galleryOverlay));
    check('T2-b 无设置页画廊入口钮', f.galleryEntry === false, String(f.galleryEntry));
    check('T2-c 无顶栏调色板钮 palette-open', f.paletteOpenBtn === false, String(f.paletteOpenBtn));

    // ===== T3 点「苔青」→ 即时生效 + 持久 =====
    STEP = 'T3|点选生效';
    const sig0 = await rootSig(app.page);
    await app.page.click('[data-testid="theme-section"] input[value="moss"]');
    await wait(600);
    const sig1 = await rootSig(app.page);
    check('T3-a data-palette=moss', sig1.palette === 'moss', JSON.stringify(sig1));
    check('T3-b localStorage septcats.palette=moss', sig1.stored === 'moss', sig1.stored);
    check('T3-c body 背景随派系变化（代表色真落）', sig0.bodyBg !== sig1.bodyBg, `${sig0.bodyBg} -> ${sig1.bodyBg}`);

    // ===== T4 oled×light 回退（浅色置灰 / 深色可选）=====
    STEP = 'T4|oled×light';
    f = await rowFacts(app.page);
    check('T4-a 浅色基底「纯黑」置灰（disabled）', f.oledDisabled === true, String(f.oledDisabled));
    // 明暗基底切换走设置页内真实通路：同一「外观」节的「主题（明暗）」单选（name=settings-theme）
    await app.page.click('input[name="settings-theme"][value="dark"]');
    await wait(700);
    let darkApplied = false;
    for (let i = 0; i < 20; i += 1) {
      const sig = await rootSig(app.page);
      if (sig.theme === 'dark') { darkApplied = true; break; }
      await wait(500);
    }
    check('T4-b 切深色基底生效（data-theme=dark）', darkApplied, 'theme switch');
    f = await rowFacts(app.page);
    check('T4-c 深色基底「纯黑」可选（disabled=false）', f.oledDisabled === false, String(f.oledDisabled));
    if (darkApplied) {
      await app.page.click('[data-testid="theme-section"] input[value="oled"]');
      await wait(600);
      const sigOled = await rootSig(app.page);
      check('T4-d 深色下选「纯黑」→ data-palette=oled', sigOled.palette === 'oled', JSON.stringify(sigOled));
    } else {
      check('T4-d 深色下选「纯黑」→ data-palette=oled', false, 'skipped: dark not applied');
    }

    // ===== T5 重启后持久 =====
    STEP = 'T5|重启持久';
    const sigBeforeRestart = await rootSig(app.page);
    await app.page.evaluate(() => window.septcats.sync.restart().catch(() => undefined));
    await wait(5000);
    let re = null;
    for (let i = 0; i < 30 && re === null; i += 1) {
      try {
        const b = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
        const p = b.contexts()[0]?.pages()?.[0];
        if (p !== undefined) {
          await p.waitForSelector('.app-side', { timeout: 20000 });
          await wait(2000);
          re = { browser: b, page: p };
        }
      } catch { /* relaunch 未就绪 */ }
      if (re === null) await wait(1500);
    }
    if (re === null) {
      check('T5-a 重启后 CDP 重连', false, '30 次轮询超时');
    } else {
      const sig2 = await rootSig(re.page);
      check('T5-a 重启后 CDP 重连', true, 'reconnected');
      check('T5-b 重启后 data-palette 与重启前一致', sig2.palette === sigBeforeRestart.palette, `${sigBeforeRestart.palette} -> ${sig2.palette}`);
      check('T5-c 重启后 data-look 随存储恢复', sig2.look !== 'none', sig2.look);
      await re.browser.close().catch(() => undefined);
    }
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't65-results.json'), JSON.stringify({ task: 'T65', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T65：${pass} PASS / ${fail} FAIL =====`);
    check('T6 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  try { writeFileSync(join(SHOTS, 't65-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2)); } catch { /* */ }
  process.exit(3);
});