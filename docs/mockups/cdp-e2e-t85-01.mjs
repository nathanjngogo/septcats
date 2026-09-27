/* T85-01 真机探针（质感派系层：Linear + 毛玻璃在 Electron 内真实生效）
 * 链：L0 默认 pixel 态（顶栏框线 computed=2px + 按钮零圆角）→
 *     L1 同会话真实 UI 点「Linear」卡 → 顶栏框线即时=1px + 按钮圆角>0 +
 *        柔影非硬 bevel（CSS 级联真实换肤，不止 data 属性挂着）→
 *     L2 点「毛玻璃」卡 → 画廊弹层 backdrop-filter≠none + 背景 rgba 半透明
 *        （color-mix/backdrop-filter 在 Electron 内核支持性 = 物理墙探测）→
 *     L3 优雅重启（sync:restart → app.quit 冲刷 localStorage → relaunch 同 argv）→
 *        重连后 data-look=glass 自动恢复 + 顶栏框线仍 1px（持久化链闭环）→
 *     L4 布局无破洞 + 真实根 C:\Users\Administrator\.septcats 零触碰（mtime 钉）。
 * 桥面：无新 IPC——纯前端质感层；探针经 CDP 走**真实 UI 路径**（派画廊事件 +
 *   点卡按钮），比直写 localStorage 更强：连 lookActions.setLook 一起验。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <8 = FATAL（静默蒸发守卫）。
 * 教训（上一版 9/16）：force-kill 下 Chromium localStorage 不落盘——重启验证必须走
 *   app.quit 优雅通道（sync:restart 自带 relaunch）；换肤验证放同会话点卡完成。
 * 点卡 jsdom 路径已由 test/t85-looks.test.tsx（12 测）覆盖；本探针证明
 *   **Electron 内核里 CSS 级联真实换肤**。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', process.env['SEPTCATS_RUN_NAME'] ?? 't85-01-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = Number(process.env['SEPTCATS_CDP_PORT'] ?? '9255');
// 靶子可切：默认 dev electron；SEPTCATS_APP_BIN 指向打包产物 exe（交付物终验口径）
const APP_BIN = process.env['SEPTCATS_APP_BIN'] ?? '';
const PACKAGED = APP_BIN !== '';
const ELECTRON = PACKAGED ? APP_BIN : join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARGS = PACKAGED ? [] : ['.'];
const RUN_DIR_TAG = process.env['SEPTCATS_RUN_NAME'] ?? 't85-01-e2e';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  // 打包靶子的进程名是 Septcats.exe，dev 靶子是 electron.exe——两个都扫（命中判据=命令行含本探针 RUN 目录）
  for (const pname of ['electron.exe', 'Septcats.exe']) {
    try {
      const out = execSync(`wmic process where "name='${pname}'" get processid,commandline /format:list`, { encoding: 'utf8' });
      let cur = '';
      for (const line of out.split('\n')) {
        if (line.startsWith('CommandLine=')) cur = line;
        else if (line.startsWith('ProcessId=')) { const m = line.match(/^ProcessId=(\d+)/); if (m !== null && cur.includes(RUN_DIR_TAG)) killTree(Number(m[1])); cur = ''; }
      }
    } catch { /* wmic 缺失 */ }
  }
}
async function launch() {
  const child = spawn(ELECTRON, [...APP_ARGS, `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function shut({ child, browser }) {
  try { await browser.close(); } catch { /* */ }
  killTree(child.pid);
  await wait(1200);
}
/** 开画廊 → 点指定质感卡 → Esc 关画廊（全真实 UI 路径）。 */
async function clickLookCard(page, id) {
  await page.evaluate(() => window.dispatchEvent(new Event('septcats:open-theme-gallery')));
  await page.waitForSelector('[data-testid="theme-gallery"]', { timeout: 8000 });
  await page.click(`[data-testid="theme-gallery-card-${id}"]`);
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForSelector('[data-testid="theme-gallery"]', { state: 'detached', timeout: 5000 }).catch(() => undefined);
}
const probeBox = () => {
  const topbar = document.querySelector('.sc-shell__topbar');
  const btn = document.querySelector('.sc-btn--secondary') ?? document.querySelector('button');
  return {
    dataLook: document.documentElement.dataset.look ?? '',
    topBorder: topbar ? getComputedStyle(topbar).borderBottomWidth : 'NO-TOPBAR',
    radius: btn ? getComputedStyle(btn).borderTopLeftRadius : 'NO-BTN',
    shadow: btn ? getComputedStyle(btn).boxShadow.slice(0, 70) : '',
  };
};

const assertions = [];
let STEP = '-';
function check(name, ok, extra = '') {
  assertions.push({ name: `${STEP}|${name}`, pass: Boolean(ok), extra: String(extra).slice(0, 170) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${STEP} ${name}${extra ? ` :: ${String(extra).slice(0, 130)}` : ''}`);
}
function seedSettings() {
  mkdirSync(UD, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ rootPath: ROOT, theme: 'light', locale: 'zh-CN' }));
  mkdirSync(ROOT, { recursive: true });
}

try {
  rmSync(RUN, { recursive: true, force: true });
  seedSettings();
  killStaleApp();
  const stamp0 = realRootStamp();

  // ===== L0 默认 pixel =====
  STEP = 'L0|pixel 默认';
  let app = await launch();
  {
    const r = await app.page.evaluate(probeBox);
    check('L0-1 data-look=pixel（启动 init 挂属性）', r.dataLook === 'pixel', JSON.stringify(r));
    check('L0-2 顶栏下沿 computed = 2px', r.topBorder === '2px', r.topBorder);
    check('L0-3 按钮零圆角（像素态）', r.radius === '0px', r.radius);
  }

  // ===== L1 点 Linear 卡 → 即时换肤 =====
  STEP = 'L1|linear 级联';
  {
    await clickLookCard(app.page, 'linear');
    // 柔影验证量「确实吃 --sc-pixel-out 的浮层」（主屏首钮是 ghost 无框钮，量它=探针缺陷）
    await app.page.evaluate(() => window.dispatchEvent(new Event('septcats:open-theme-gallery')));
    await app.page.waitForSelector('[data-testid="theme-gallery"]', { timeout: 8000 });
    const r = await app.page.evaluate(() => {
      const topbar = document.querySelector('.sc-shell__topbar');
      const btn = document.querySelector('.sc-btn--secondary') ?? document.querySelector('button');
      const gallery = document.querySelector('[data-testid="theme-gallery"]');
      return {
        dataLook: document.documentElement.dataset.look ?? '',
        topBorder: topbar ? getComputedStyle(topbar).borderBottomWidth : 'NO-TOPBAR',
        radius: btn ? getComputedStyle(btn).borderTopLeftRadius : 'NO-BTN',
        cardShadow: gallery ? getComputedStyle(gallery).boxShadow.slice(0, 90) : 'NO-GALLERY',
      };
    });
    await app.page.keyboard.press('Escape').catch(() => undefined);
    await app.page.waitForSelector('[data-testid="theme-gallery"]', { state: 'detached', timeout: 5000 }).catch(() => undefined);
    check('L1-1 点卡后 data-look=linear', r.dataLook === 'linear', JSON.stringify(r));
    check('L1-2 顶栏框线即时收细 = 1px（token 级联真实生效）', r.topBorder === '1px', r.topBorder);
    check('L1-3 按钮圆角 >0（linear 圆角阶）', parseFloat(r.radius) > 0, r.radius);
    check('L1-4 面板影=柔影（rgba/oklab 且非 inset 硬 bevel）', r.cardShadow.includes('rgba') || /rgb\(/.test(r.cardShadow) ? !r.cardShadow.includes('inset') : false, r.cardShadow);
  }

  // ===== L2 点毛玻璃卡 → backdrop 生效 =====
  STEP = 'L2|glass 毛玻璃';
  {
    await clickLookCard(app.page, 'glass');
    await app.page.evaluate(() => window.dispatchEvent(new Event('septcats:open-theme-gallery')));
    await app.page.waitForSelector('[data-testid="theme-gallery"]', { timeout: 8000 });
    const r = await app.page.evaluate(() => {
      const gallery = document.querySelector('[data-testid="theme-gallery"]');
      const cs = gallery ? getComputedStyle(gallery) : null;
      return {
        dataLook: document.documentElement.dataset.look ?? '',
        backdrop: cs ? (cs.backdropFilter || cs.webkitBackdropFilter || '') : 'NO-GALLERY',
        bg: cs ? cs.backgroundColor : '',
        galleryOpen: gallery !== null,
      };
    });
    check('L2-1 点卡后 data-look=glass', r.dataLook === 'glass', JSON.stringify(r));
    check('L2-2 画廊 backdrop-filter 生效（Electron 内核支持性）', r.galleryOpen && r.backdrop !== '' && r.backdrop !== 'none', r.backdrop);
    check('L2-3 画廊背景半透明（color-mix 解析成功）', /rgba\([\d.,\s]+0?\.\d/.test(r.bg) || /color\(srgb[^)]*0?\.\d/.test(r.bg), r.bg);
    await app.page.keyboard.press('Escape').catch(() => undefined);
    await wait(400);
  }

  // ===== L3 优雅重启 → 持久化恢复 =====
  STEP = 'L3|重启恢复';
  {
    await app.page.evaluate(() => window.septcats.sync.restart().catch(() => undefined));
    await wait(4000); // 原进程退出 + relaunch 启动
    let reconnected = null;
    for (let i = 0; i < 30; i += 1) {
      try {
        const b = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
        const p = b.contexts()[0]?.pages()[0];
        if (p !== undefined) {
          await p.waitForFunction(() => window.septcats !== undefined, null, { timeout: 20000 });
          reconnected = { browser: b, page: p };
          break;
        }
        await b.close().catch(() => undefined);
      } catch { /* relaunch 未就绪 */ }
      await wait(1500);
    }
    if (reconnected === null) {
      check('L3-1 relaunch 后 CDP 重连', false, '30 次轮询超时');
    } else {
      const r = await reconnected.page.evaluate(probeBox);
      check('L3-1 重启后 data-look=glass 自动恢复（localStorage 冲刷链）', r.dataLook === 'glass', JSON.stringify(r));
      check('L3-2 重启后顶栏框线仍 1px（质感跨会话）', r.topBorder === '1px', r.topBorder);
      await reconnected.browser.close().catch(() => undefined);
    }
  }

  // ===== L4 收尾 =====
  STEP = 'L4|无破洞+零触碰';
  {
    killTree(app.child.pid);
    killStaleApp();
    await wait(1200);
    app = await launch();
    const r = await app.page.evaluate(() => {
      const shell = document.querySelector('.sc-shell');
      const topbar = document.querySelector('.sc-shell__topbar');
      return {
        shellW: shell ? shell.getBoundingClientRect().width : 0,
        shellH: shell ? shell.getBoundingClientRect().height : 0,
        topVisible: topbar ? topbar.getBoundingClientRect().height > 20 : false,
      };
    });
    check('L4-1 glass 态壳宽高>0（无塌陷）', r.shellW > 400 && r.shellH > 300, JSON.stringify(r));
    check('L4-2 顶栏可见', r.topVisible, String(r.topVisible));
    await shut(app);
  }
  check('L4-3 真实档案 mtime 未变', realRootStamp() === stamp0, `${realRootStamp()} vs ${stamp0}`);
} catch (e) {
  assertions.push({ name: `${STEP}|FATAL`, pass: false, extra: String(e) });
  console.log('FATAL', e);
} finally {
  killStaleApp();
}

const fails = assertions.filter((a) => !a.pass);
console.log(`\nRESULT ${String(assertions.length - fails.length)}/${String(assertions.length)} PASS`);
for (const f of fails) console.log('MISS', f.name, f.extra);
if (assertions.length < 8) { console.log('TOO FEW ASSERTIONS — FATAL'); process.exit(2); }
process.exit(fails.length === 0 ? 0 : 1);
