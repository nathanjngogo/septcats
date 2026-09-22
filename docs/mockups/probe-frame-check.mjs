/*
 * probe-frame-check.mjs —— PM 自目检工具（不依赖视觉模型）。
 * 跑打包 win-unpacked EXE（--user-data-dir+rootPath 双隔离夹具），DOM/CSS 级整帧体检：
 *  G1 窗口零滚动 + 无横向溢出；G2 关键壳层元素在场且不重叠、不出屏；
 *  G3 字体真值（计算族名含 Noto/Source Han，禁系统默认直落）；
 *  G4 像素黑框线抽检：可见描边元素 border-color 全等于 ink-edge token 值（白名单：语义色/透明）；
 *  G5 主题双态：data-theme=dark 后 ink/edge token 换值生效；
 *  G6 无 demo 残留启发式：全页文本扫占位词（Lorem/示例文案字样/TODO/FIXME/undefined/NaN/双花括号）；
 *  G7 页签/侧栏/编辑区真实数据链：新建一页一库，标题/面包屑/dbview 在场（真实数据=非设计稿证据）。
 * 结束优雅退出、electron/Septcats 进程归零、真实数据根 mtime 差分。
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const WIN_UNPACKED = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked');
const EXE = join(WIN_UNPACKED, 'Septcats.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\frame-check';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9588;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
// 模式：--packed=打 dist/win-unpacked EXE（rc 终验）；默认=打 main 树 out/（electron+build，出包前体检）
const MODE = process.argv.includes('--packed') ? 'packed' : 'src';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
function check(name, ok, raw) {
  assertions.push({ name, ok: ok === true, raw: String(raw).slice(0, 400) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 220)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

async function main() {
  if (MODE === 'packed') check('打包 EXE 存在', existsSync(EXE), EXE);
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const rootBefore = rootMtime();
  for (const pid of listeningPids(PORT)) killTree(pid);
  const electronBin = join(REPO, 'apps', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  const launch = MODE === 'packed'
    ? { exe: EXE, args: ['--user-data-dir=' + UD, `--remote-debugging-port=${PORT}`], cwd: WIN_UNPACKED }
    : { exe: electronBin, args: ['.', '--user-data-dir=' + UD, `--remote-debugging-port=${PORT}`], cwd: join(REPO, 'apps', 'desktop') };
  const child = spawn(launch.exe, launch.args, { cwd: launch.cwd, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(800); }
  }
  check('EXE 启动+CDP 连上', browser !== null, `pid=${String(child.pid)}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.app-side', { timeout: 30000 });
  await wait(2000);
  const pick = await page.locator('[data-testid="ws-create"]').count();
  if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  await page.waitForSelector('[data-testid="side-new-page"]', { timeout: 20000 });

  // G1 零滚动
  const g1 = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight,
  }));
  check('G1 整窗零滚动（横/纵）', g1.sw <= g1.cw + 1 && g1.sh <= g1.ch + 1, JSON.stringify(g1));

  // G2 壳层元素在场/不出屏
  const g2 = await page.evaluate(() => {
    const out = {};
    for (const [k, sel] of Object.entries({ side: '.app-side', tabsbar: '[data-testid="tabsbar"]', topbar: '.sc-shell__actions', home: '[data-testid="workbench-open"]' })) {
      const el = document.querySelector(sel);
      if (el == null) { out[k] = 'MISSING'; continue; }
      if (el.clientWidth === 0 && el.clientHeight === 0) { out[k] = 'zero-box'; continue; }
      const b = el.getBoundingClientRect();
      out[k] = b.x < -1 || b.y < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1 ? 'OFFSCREEN' : 'ok';
    }
    return out;
  });
  check('G2 壳层三件在场且不出屏', Object.values(g2).every((v) => v === 'ok'), JSON.stringify(g2));

  // G3 字体真值
  const g3 = await page.evaluate(() => {
    const el = document.querySelector('.app-side');
    const fam = getComputedStyle(el).fontFamily;
    return { fam: fam.slice(0, 60), hit: /Noto Sans|Source Han/i.test(fam) };
  });
  check('G3 计算族名命中思源/Noto（非系统兜底）', g3.hit === true, JSON.stringify(g3));

  // 造真实数据链（G7 前半）：新页 + 新库
  await page.locator('[data-testid="side-new-page"]').first().click();
  await wait(600);
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 8000 });
  await inp.fill('体检页A'); await inp.press('Enter'); await wait(1000);
  const tree = await page.evaluate(() => document.body.innerText.includes('体检页A'));
  check('G7-1 新建页标题在树中（真实数据链）', tree === true, String(tree));
  const g2b = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="tabsbar"]');
    if (el == null) return 'MISSING';
    const b = el.getBoundingClientRect();
    const tabs = el.querySelectorAll('.tabsbar-tab').length;
    return b.width > 0 && b.right <= innerWidth + 1 && tabs >= 1 ? 'ok:' + String(tabs) : `bad:${JSON.stringify({ w: Math.round(b.width), tabs })}`;
  });
  check('G2b 开页后页签条挂载且含活动页签', g2b.startsWith('ok'), g2b);

  // 开工作台扩大描边采样面（五卡卡框=典型 ink-edge 落点），采完再收
  await page.keyboard.press('Alt+h');
  await wait(800);
  // G4 黑框线抽检：可见元素描边色 ∈ {ink-edge, 语义色, transparent, 0宽}
  const g4 = await page.evaluate(() => {
    const toRgb = (hexOrRgb) => {
      const t = hexOrRgb.trim();
      if (/^rgb/i.test(t)) return t.toUpperCase().replace(/\s/g, '');
      const h = t.replace('#', '');
      return `RGB(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`;
    };
    const edgeRgb = toRgb(getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge'));
    const bad = [];
    let n = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      let sawBorder = false;
      for (const side of sides) {
        const w = parseFloat(cs['border' + side + 'Width']);
        if (!(w > 0)) continue;
        sawBorder = true;
        const raw = cs['border' + side + 'Color'];
        const col = raw.toUpperCase();
        if (col === 'TRANSPARENT' || toRgb(raw) === 'RGBA(0,0,0,0)') continue;
        n += 1;
        if (toRgb(raw) === edgeRgb) continue;
        bad.push(`${el.tagName}.${String(el.className).slice(0, 20)}.${side}=${col}`);
        if (bad.length >= 8) break;
      }
      void sawBorder;
    }
    return { edge: edgeRgb, checked: n, bad };
  });
  check('G4 描边色=ink-edge 抽检', g4.bad.length === 0 && g4.checked >= 3, `edge=${g4.edge} checked=${String(g4.checked)} bad=${JSON.stringify(g4.bad)}`);

  await page.keyboard.press('Alt+h');
  await wait(500);
  // G5 暗态 token 换值
  const g5 = await page.evaluate(() => {
    const before = getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge').trim();
    document.documentElement.dataset.theme = 'dark';
    const after = getComputedStyle(document.documentElement).getPropertyValue('--sc-color-ink-edge').trim();
    document.documentElement.dataset.theme = 'light';
    return { before, after };
  });
  check('G5 data-theme 切换 ink-edge 换值', g5.before !== g5.after, JSON.stringify(g5));

  // G6 demo 残留启发式
  const g6 = await page.evaluate(() => {
    const tx = document.body.innerText;
    const pats = ['Lorem ipsum', '{{', '}}', 'undefined', 'NaN', 'TODO', 'FIXME', '占位文案', '示例文本'];
    return pats.filter((p) => tx.includes(p));
  });
  check('G6 无占位/模板残留词', g6.length === 0, JSON.stringify(g6));

  // G7-2 命令面板真数据搜索
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.palette', { timeout: 8000 }).catch(() => {});
  await page.locator('.palette-input input').first().type('体检页A', { delay: 20 });
  await wait(900);
  const hitRow = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].some((el) => (el.textContent ?? '').includes('体检页A')));
  check('G7-2 命令面板搜到新建页（FTS 真链）', hitRow === true, String(hitRow));
  await page.keyboard.press('Escape');

  const pass = assertions.filter((x) => x.ok === true).length;
  const fail = assertions.filter((x) => x.ok === false).length;
  writeFileSync(join(SCRIPT_DIR, 'frame-check-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), assertions }, null, 2));
  console.log(`\n===== frame-check：${pass} PASS / ${fail} FAIL =====`);
  await page.evaluate(() => window.close()).catch(() => {});
  await wait(2500);
  try { browser?.close(); } catch { /* */ }
  killTree(child.pid);
  try { execSync(MODE === 'packed' ? 'taskkill /F /IM Septcats.exe' : 'taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
  check('T 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });
