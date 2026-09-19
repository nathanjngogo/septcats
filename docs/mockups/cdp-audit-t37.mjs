/* TASK-T37-01 真机取证：编辑区多页签（§1.1/§1.3/§1.4 数值化 + 截图）。
 * 以 electron . 跑 freshly-built out/（build 前置 ensure-abi electron）；
 * 独立夹具根（--user-data-dir + rootPath），不触碰默认根/真实数据。
 * 流程：开 5 个标签 → 乱序点击切换 → 取证（集合/顺序/选中项）→ 杀进程重启
 * → 还原断言（集合+顺序+选中项）→ Ctrl+W 相邻回落 → 双主题截图 → 零滚动红线。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPDIR = 'E:/Hermes Agent工作空间/Septcats/apps/desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t37-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t37-data';
const PORT = 9391;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t37';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok, detail: String(d).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 220) : ''}`); };
/** 优雅退出（window.close → 进程自然结束、localStorage 落盘），killAll 仅兜底。 */
const quitApp = async (pg) => {
  try { await pg.evaluate(() => window.close()); } catch { /* already gone */ }
  await wait(3000);
  killAll();
  await wait(1000);
};

async function launch() {
  const p = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, detached: true, stdio: 'ignore' });
  p.unref();
  let br = null;
  for (let k = 0; k < 30 && br === null; k++) {
    await wait(1000);
    try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
  }
  if (br === null) { throw new Error('CDP connect failed'); }
  const page = br.contexts()[0].pages()[0];
  for (let k = 0; k < 30; k++) {
    if (await page.evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.create === 'function').catch(() => false)) break;
    await wait(800);
  }
  await wait(1500);
  return { br, page };
}

const tabSnapshot = (page) => page.evaluate(() => ({
  count: document.querySelectorAll('.tabsbar-tab').length,
  titles: [...document.querySelectorAll('.tabsbar-tab .tabsbar-title')].map((el) => el.textContent),
  activeIndex: [...document.querySelectorAll('.tabsbar-tab')].findIndex((el) => el.getAttribute('aria-selected') === 'true'),
}));

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const { br, page } = await launch();
const shot = (pg, name) => pg.screenshot({ path: `${SHOTS}/${name}.png` });

// ---------- ① 开 5 个标签（侧栏「新建页面」×5，逐个行内改名） ----------
const names = ['T37-甲', 'T37-乙', 'T37-丙', 'T37-丁', 'T37-戊'];
for (const name of names) {
  await page.getByTestId('side-new-page').click();
  const input = page.locator('.app-side input').first();
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(name);
  await input.press('Enter');
  await wait(600);
}
await wait(800);
const snap5 = await tabSnapshot(page);
check('§1.1 开 5 个标签 → 标签条 5 个页签', snap5.count === 5, `count=${snap5.count}`);
check('§0.2 标签标题=改名后的标题（改名实时刷新）', names.every((n) => snap5.titles.includes(n)), JSON.stringify(snap5.titles));
await shot(page, 't37-tabs-5-light');

// ---------- ② 乱序点击切换（每次断言选中项跟随） ----------
const order = [3, 0, 4, 1];
let switchOk = true;
for (const i of order) {
  await page.locator('.tabsbar-tab').nth(i).click();
  await wait(350);
  const snap = await tabSnapshot(page);
  if (snap.activeIndex !== i) { switchOk = false; }
}
check('§1.1 乱序点击切换 → 选中项逐一跟随（4 次乱序）', switchOk, `order=${JSON.stringify(order)}`);
await wait(400);
const beforeClose = await tabSnapshot(page);
await shot(page, 't37-tabs-scrambled-light');

// ---------- ③ Ctrl+W 关当前 → 回落右邻 ----------
const activeBeforeClose = beforeClose.activeIndex;
await page.keyboard.press('Control+w');
await wait(600);
const afterClose = await tabSnapshot(page);
check('§1.3 Ctrl+W 关当前 → 相邻回落（右优先）',
  afterClose.count === beforeClose.count - 1 && afterClose.activeIndex === Math.min(activeBeforeClose, afterClose.count - 1) && afterClose.activeIndex !== -1,
  `before(active=${activeBeforeClose}, n=${beforeClose.count}) → after(active=${afterClose.activeIndex}, n=${afterClose.count})`);

// ---------- ④ 窗口零滚动红线（T30） ----------
const scroll = await page.evaluate(() => ({
  doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  win: window.scrollY,
}));
check('回归·窗口零滚动（T30）', scroll.doc <= 0 && scroll.win === 0, `overflow=${scroll.doc}px, scrollY=${scroll.win}`);

// ---------- ⑤ 重启 → 还原集合+顺序+选中项 ----------
const expected = await tabSnapshot(page);
await quitApp(page);
const relaunch = await launch();
const after = await tabSnapshot(relaunch.page);
check('§1.1 重开应用 → 标签集合+顺序全部还原', after.count === expected.count && JSON.stringify(after.titles) === JSON.stringify(expected.titles),
  `before=${JSON.stringify(expected.titles)} after=${JSON.stringify(after.titles)}`);
check('§1.1 重开应用 → 当前选中项还原', after.activeIndex === expected.activeIndex, `active ${expected.activeIndex} → ${after.activeIndex}`);
await shot(relaunch.page, 't37-tabs-restore-light');

// ---------- ⑥ 深色主题截图（四态截图集由 PM 复跑补齐） ----------
await relaunch.page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await wait(400);
await shot(relaunch.page, 't37-tabs-restore-dark');
await relaunch.page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });

// ---------- ⑦ 全关 → .pv-empty 空态（回收既有口径） ----------
for (let k = 0; k < after.count + 2; k++) { await relaunch.page.keyboard.press('Control+w'); await wait(250); }
await wait(500);
const emptied = await relaunch.page.evaluate(() => ({
  tabs: document.querySelectorAll('.tabsbar-tab').length,
  empty: document.querySelector('.pv-empty') !== null,
}));
check('§1.3 全关 → 既有 .pv-empty 空态出现', emptied.tabs === 0 && emptied.empty, JSON.stringify(emptied));

await quitApp(relaunch.page);
writeFileSync(`${SHOTS}\\t37-results.json`, JSON.stringify(results, null, 2), 'utf8');
const fails = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fails}/${results.length} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${fails} 项失败`}`);
process.exit(fails === 0 ? 0 : 1);
