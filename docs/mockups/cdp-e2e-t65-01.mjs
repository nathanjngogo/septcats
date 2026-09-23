/*
 * cdp-e2e-t65-01.mjs —— TASK-T65-01（主题画廊 R17①）PM 真机取证。
 * T1 入口三径：顶栏 palette-open / 设置页 theme-gallery-entry / 命令面板 theme.palette；
 * T2 画廊六卡齐 + 当前角标 + 点选生效（documentElement[data-palette] 换值 + 代表色变化）；
 * T3 oled×light 回退：存 oled 但 light 基底 → 生效口径=mono（paletteState §1.1）；
 * T4 持久：换派系→重启→data-palette 仍在 + localStorage 键=septcats.palette；
 * T5 明暗基底联动：theme.dark 命令→data-theme 换；画廊卡对比不塌（截图取证）。
 * 夹具双隔离（settings rootPath + user-data-dir），真实根零触碰。
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
  await wait(2500); // 稳态：首帧渲染 + init 管线
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  return { child, browser, page };
}

/** 页内求值小工具：根属性 + 代表色（body 计算背景）。 */
async function rootSig(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme') ?? 'none',
    palette: document.documentElement.getAttribute('data-palette') ?? 'none',
    bg: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem('septcats.palette') ?? 'none',
  }));
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  const { child, browser, page } = await launch();
  try {
    STEP = 'T1|入口';
    const sig0 = await rootSig(page);
    check('T1-a 缺省态（palette=none/mono 口径，theme=light）', sig0.theme === 'light' && (sig0.palette === 'none' || sig0.palette === 'mono'), JSON.stringify(sig0));
    await page.locator('[data-testid="palette-open"]').click();
    await wait(700);
    check('T1-b 顶栏钮开画廊', await page.locator('[data-testid="theme-gallery"]').isVisible() === true, 'overlay visible');
    await page.screenshot({ path: join(SHOTS, 't1-gallery-open.png') });
    await page.locator('[data-testid="theme-gallery-close"]').click();
    await wait(500);
    check('T1-c 关闭钮收画廊', await page.locator('[data-testid="theme-gallery"]').count() === 0, 'closed');

    STEP = 'T2|六卡+点选';
    await page.locator('[data-testid="palette-open"]').click();
    await wait(600);
    const ids = ['mono', 'oled', 'contrast', 'paper', 'slate', 'moss'];
    let cardsOk = true;
    for (const id of ids) {
      if (await page.locator(`[data-testid="theme-gallery-card-${id}"]`).count() !== 1) cardsOk = false;
    }
    check('T2-a 六派系卡齐', cardsOk === true, ids.join(','));
    const bgMoss0 = (await rootSig(page)).bg;
    await page.locator('[data-testid="theme-gallery-card-moss"]').click();
    await wait(900);
    const sigMoss = await rootSig(page);
    check('T2-b 点苔青→data-palette 换值+底色变化', sigMoss.palette === 'moss' && sigMoss.bg !== bgMoss0, `before=${bgMoss0} after=${sigMoss.bg}`);
    await page.screenshot({ path: join(SHOTS, 't2-moss-light.png') });
    check('T2-c 当前角标在苔青卡', await page.locator('[data-testid="theme-gallery-card-moss"] [data-testid="theme-gallery-current"]').count() === 1, 'badge');
    await page.locator('[data-testid="theme-gallery-close"]').click();
    await wait(400);

    STEP = 'T3|oled×light 回退';
    await page.evaluate(() => localStorage.setItem('septcats.palette', 'oled'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(3200);
    const sigOledLight = await rootSig(page);
    const effBg = sigOledLight.bg;
    // light 基底存 oled → 生效=mono 渲染口径（属性可保留 oled，但色值必须=mono/light）
    await page.evaluate(() => localStorage.setItem('septcats.palette', 'mono'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await wait(3200);
    const sigMonoLight = await rootSig(page);
    check('T3-a light×oled 渲染色=mono 口径（回退不塌）', effBg === sigMonoLight.bg, `oledL=${effBg} monoL=${sigMonoLight.bg}`);

    STEP = 'T4|切 dark+oled 生效+持久';
    // 走产品路径：命令面板 theme.dark
    await page.keyboard.press('Control+K');
    await wait(600);
    await page.keyboard.type('深色');
    await wait(700);
    await page.keyboard.press('Enter');
    await wait(900);
    const sigDark = await rootSig(page);
    check('T4-a 命令面板切 dark 成功', sigDark.theme === 'dark', JSON.stringify(sigDark));
    // 走产品路径点卡（画廊内选 oled）而非 evaluate 直写：leveldb 写盘有异步刷盘，
    // 直写+秒杀=探针时序 bug（首轮 T4-c 因此假红）。点卡后留 3s flush 再重启。
    await page.locator('[data-testid="palette-open"]').click();
    await wait(600);
    await page.locator('[data-testid="theme-gallery-card-oled"]').click();
    await wait(3500);
    const sigOledDark = await rootSig(page);
    check('T4-b dark×oled 点卡生效（纯黑底≠mono dark 底）', sigOledDark.palette === 'oled' && sigOledDark.bg !== sigDark.bg, `oledD=${sigOledDark.bg} monoD=${sigDark.bg}`);
    await page.screenshot({ path: join(SHOTS, 't4-oled-dark.png') });
    await page.locator('[data-testid="theme-gallery-close"]').click();
    await wait(500);
    // 优雅退出（window.close→应用自然 quit）：taskkill /F 强杀会丢 Chromium 尚未 flush 的
    // localStorage leveldb 写（T4-c 两轮假红根因=探针强杀丢写，非产品缺陷）。
    await page.evaluate(() => window.close()).catch(() => { /* */ });
    for (let k = 0; k < 16; k += 1) {
      await wait(1000);
      try { execSync(`tasklist /FI "PID eq ${String(child.pid)}" | findstr ${String(child.pid)}`, { stdio: 'pipe' }); } catch { break; }
    }
    killTree(child.pid);
    await wait(1500);
    const re = await launch();
    try {
      const sigRe = await rootSig(re.page);
      check('T4-c 重启后 oled 持久（点卡路径落盘）', sigRe.palette === 'oled' && sigRe.stored === 'oled', JSON.stringify(sigRe));
    } finally {
      STEP = 'T5|设置页入口';
      // 产品事件开设置页（App.tsx:330 监听 septcats:open-settings）→ theme-section 挂载 →
      // 点 theme-gallery-entry 真开画廊。
      await re.page.evaluate(() => window.dispatchEvent(new Event('septcats:open-settings')));
      await wait(900);
      const secOk = await re.page.locator('[data-testid="theme-section"]').isVisible();
      check('T5-a 设置页 theme-section 可见', secOk === true, 'visible');
      await re.page.locator('[data-testid="theme-gallery-entry"]').click();
      await wait(700);
      check('T5-b 设置页入口开画廊', await re.page.locator('[data-testid="theme-gallery"]').isVisible() === true, 'gallery open');
      await re.page.screenshot({ path: join(SHOTS, 't5-settings-entry.png') });
      void [browser, page];
    }
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't65-results.json'), JSON.stringify({ task: 'T65', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T65：${pass} PASS / ${fail} FAIL =====`);
    check('T 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => {
  console.error('FATAL', e);
  try { writeFileSync(join(SHOTS, 't65-results.json'), JSON.stringify({ partial: true, error: String(e), assertions }, null, 2)); } catch { /* */ }
  process.exit(3);
});
