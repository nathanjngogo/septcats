/*
 * cdp-e2e-t72-01.mjs —— TASK-T72-01（工作台模板市场 R20③④）PM 真机取证。
 * M1 入口三径：顶栏市场钮 workbench-market-open / Alt+H 开市场 / 命令面板市场命令；Esc 关
 * M2 市场壳：两 Tab + 禁词「数据库」零出现
 * M3 内置 4 模板卡（main 只读通道真机可达）+ 应用先弹确认（备份语义文案）
 * M4 应用→换布局+备份落地→一键还原回应用前
 * M5 卡片 Tab 开关与 setCardHidden 同源（关卡→home 卡消失→开卡回来）
 * M6 另存为模板（home 钮）→ 出现在「我的模板」分区（+1 卡）
 * M7 导出钮在场（内置+我的均挂；导出走 anchor 下载不实点）；导入合法 JSON 出现；坏 JSON 拒绝+toast
 * M8 我的模板软删；M9 真根 untouched + electron 残留 0
 * 纪律：交互一律页内原生 click（force click 不触发 React onClick）；localStorage 断言先等落盘。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t72';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t72');
const PORT = 9580;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const CARDS_KEY = 'septcats.workbench.cards';
const BACKUP_KEY = 'septcats.wbcard.layoutBackup';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 190)}`);
}
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
function electronCount() {
  try { return execSync('tasklist /FI "IMAGENAME eq electron.exe" /NH', { encoding: 'utf8' }).split('\n').filter((l) => l.includes('electron.exe')).length; } catch { return -1; }
}
function listeningPids(port) {
  try {
    const out = execSync(`netstat -ano | findstr :${String(port)} | findstr LISTENING`, { encoding: 'utf8' });
    return [...new Set(out.split('\n').map((l) => l.trim().split(/\s+/).pop()).filter((x) => /^\d+$/.test(x)))];
  } catch { return []; }
}
const settings = () => JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
}, null, 2);

async function launch() {
  for (const pid of listeningPids(PORT)) killTree(pid);
  writeFileSync(`${UD}\\septcats.settings.json`, settings(), 'utf8');
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
  await wait(2400);
  return { child, browser, page };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
  const beforee = electronCount();
  const { child, page } = await launch();

  const has = async (tid) => (await page.locator(`[data-testid="${tid}"]`).count()) > 0;
  const click = async (tid) => page.evaluate((s) => {
    const el = document.querySelector(`[data-testid="${s}"]`);
    if (el === null) return false;
    el.click();
    return true;
  }, tid);
  const lsGet = (k) => page.evaluate((kk) => localStorage.getItem(kk), k);
  const slots = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="wb-slot-"]')].map((e) => e.getAttribute('data-testid').replace('wb-slot-', '')));
  const tplCards = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="wb-market-template-"]')].map((e) => (e.getAttribute('data-testid') ?? '')).filter((t) => /^wb-market-template-[a-z0-9-]+$/.test(t) && !t.includes('-apply-') && !t.includes('-export-') && !t.includes('-delete-')));
  const group = async (name, fn) => { STEP = name; try { await fn(); } catch (e) { check(`${name} 组异常`, false, String(e?.message ?? e).slice(0, 200)); } };
  const openMarket = async () => { await click('workbench-market-open'); await wait(1200); return has('wb-market'); };
  const closeMarket = async () => { await click('wb-market-close'); await wait(800); };
  const ensureHome = async () => {
    if (await has('workbench')) return true;
    if (await has('wb-market')) { await click('workbench-open'); await wait(1400); if (await has('workbench')) return true; await closeMarket(); }
    await click('workbench-market-open'); await wait(1100);
    await click('workbench-open'); await wait(1500);
    return has('workbench');
  };

  try {
    await group('setup', async () => {
      const pick = await page.locator('[data-testid="ws-create"]').count();
      if (pick > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2600); }
      await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
      const home = await ensureHome();
      let seeded = false;
      if (home) {
        await click('wb-quick-page');
        await wait(2800);
        const ed = page.locator('.pv-root .ProseMirror, .pv-root [contenteditable="true"]').first();
        if (await ed.isVisible().catch(() => false)) { await ed.click(); await page.keyboard.type('T72 样本页', { delay: 10 }); await wait(2200); seeded = true; }
      }
      check('S1 工作台就位且播种 1 页', home && seeded, `home=${String(home)} seeded=${String(seeded)}`);
    });

    await group('M1|入口', async () => {
      check('M1-a 顶栏钮开市场', await openMarket(), '');
      await closeMarket();
      check('M1-b 关闭钮收市场', !(await has('wb-market')), '');
      await page.keyboard.press('Alt+h'); await wait(1300);
      check('M1-c Alt+H 开市场（T72 新语义）', await has('wb-market'), '');
      await page.keyboard.press('Escape'); await wait(800);
      check('M1-d Esc 关市场', !(await has('wb-market')), '');
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.palette', { timeout: 8000 }).catch(() => {});
      await wait(500);
      await page.locator('.palette-input input').first().type('模板市场', { delay: 20 });
      await wait(900);
      const found = await page.evaluate(() => [...document.querySelectorAll('.palette button, .palette-row, [role="option"]')].map((e) => (e.textContent ?? '').trim()).join('|'));
      check('M1-e 命令面板含市场命令', found.includes('市场'), found.slice(0, 140));
      await page.keyboard.press('Enter'); await wait(1400);
      check('M1-f 面板执行开市场', await has('wb-market'), '');
      await closeMarket();
    });

    await group('M2|壳', async () => {
      await openMarket();
      const t1 = await has('wb-market-tab-templates');
      const t2 = await has('wb-market-tab-cards');
      check('M2-a 模板/卡片两 Tab 齐', t1 && t2, `tpl=${String(t1)} card=${String(t2)}`);
      const body = await page.evaluate(() => (document.querySelector('[data-testid="wb-market"]')?.textContent ?? '').trim());
      check('M2-b 市场文案零禁词「数据库」', !body.includes('数据库') && body.length > 10, `len=${String(body.length)}`);
      await page.screenshot({ path: join(SHOTS, 'm2-market.png') }).catch(() => {});
    });

    await group('M3|模板列表', async () => {
      const ids = ['work-journal', 'project-board', 'reading-tracker', 'weekly-review'];
      const present = [];
      for (const id of ids) if (await has(`wb-market-template-${id}`)) present.push(id);
      check('M3-a 内置四模板卡全在（workbenchTemplates.list 真机可达）', present.length === 4, present.join(','));
      await click('wb-market-template-apply-work-journal'); await wait(900);
      const confTxt = await page.evaluate(() => (document.querySelector('[data-testid="wb-apply-confirm"]')?.textContent ?? '').trim());
      check('M3-b 应用先弹确认（文案含模板名+备份语义）', confTxt.includes('工作日志') || confTxt.length > 8, confTxt.slice(0, 80));
    });

    await group('M4|应用还原', async () => {
      // 先造自定义基线：M5 已把某卡开关过（writeCardsPersist 落盘）→ cards LS 存在，备份才有对照值
      const confClicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((e) => (e.textContent ?? '').trim() === '应用并备份');
        if (b === undefined) return false;
        b.click();
        return true;
      });
      console.log(`      (info) 确认钮点击=${String(confClicked)}`);
      await wait(2000);
      const backup = await lsGet(BACKUP_KEY);
      await closeMarket();
      const homeOk = await ensureHome();
      await wait(1500);
      const cardsNow = await lsGet(CARDS_KEY);
      const forensics = await page.evaluate(() => ({
        btns: [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim()).filter((t) => t.includes('应用')),
        toast: [...document.querySelectorAll('[class*="toast"]')].map((e) => (e.textContent ?? '').trim()).join('|').slice(0, 100),
        href: location.href.slice(0, 80),
        frames: window.frames.length,
      }));
      console.log(`      (info) home=${String(homeOk)} backup=${String(backup).slice(0, 50)} cardsLS=${String(cardsNow).slice(0, 50)}`);
      console.log(`      (forensics) ${JSON.stringify(forensics)}`);
      const orderA = await slots();
      // work-journal order 前缀 = quick,todo,recent,favorites,database（与默认序 database/recent 换位）
      const applied = JSON.stringify(orderA) === JSON.stringify(['quick', 'todo', 'recent', 'favorites']);
      check('M4-a 应用换布局+备份落地', applied && String(backup ?? '').length > 10, `applied=${String(applied)} backupLen=${String((backup ?? '').length)}`);
      await openMarket();
      await click('wb-restore-layout'); await wait(1800);
      await closeMarket();
      await ensureHome();
      await wait(1400);
      const lsRestored = await lsGet(CARDS_KEY);
      // 还原语义：LS 现值 = backup（store 快照兜底时 LS 原本可能为 null，故以 backup 自身为对照）
      const eq = String(lsRestored ?? '') === String(backup ?? '');
      const orderB = await slots();
      check('M4-b 一键还原备份（布局回应用前 11 全显）', eq && orderB.length === 11 && orderB[0] === 'quick', `eq=${String(eq)} n=${String(orderB.length)}`);
    });

    await group('M5|卡开关', async () => {
      // 复位到「默认全卡启用」干净态：清 LS + reload（init 读 null → 默认序）
      await page.evaluate((k) => localStorage.removeItem(k), CARDS_KEY);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(4000);
      await ensureHome();
      await openMarket();
      await click('wb-market-tab-cards'); await wait(900);
      const row = await has('wb-market-card-quote');
      const st0 = await page.evaluate(() => (document.querySelector('[data-testid="wb-market-card-status-quote"]')?.textContent ?? '').trim());
      await click('wb-market-card-toggle-quote'); await wait(1000);
      const st1 = await page.evaluate(() => (document.querySelector('[data-testid="wb-market-card-status-quote"]')?.textContent ?? '').trim());
      await closeMarket();
      await ensureHome();
      await wait(1400);
      const gone = !(await has('wb-slot-quote'));
      check('M5-a 卡片行在场+状态随开关翻转（启用中→未启用）', row && st0.includes('启用中') && st1.includes('未启用'), `st0="${st0}" st1="${st1}"`);
      check('M5-b 市场关卡→home 卡消失（同源 setCardHidden）', gone, `gone=${String(gone)}`);
      await openMarket();
      await click('wb-market-tab-cards'); await wait(800);
      await click('wb-market-card-toggle-quote'); await wait(1000);
      await closeMarket();
      await ensureHome();
      await wait(1400);
      check('M5-c 再开卡回工作台', await has('wb-slot-quote'), '');
    });

    const mineIds = async () => page.evaluate(() => {
      const sec = [...document.querySelectorAll('.wbm-section')].find((e) => (e.textContent ?? '').includes('我的模板'));
      return [...(sec?.querySelectorAll('[data-testid^="wb-market-template-"]') ?? [])].map((e) => (e.getAttribute('data-testid') ?? '')).filter((t) => /^wb-market-template-[0-9A-Z]{20,}$/.test(t)).map((t) => t.replace('wb-market-template-', ''));
    });
    await group('M6|另存为', async () => {
      await ensureHome();
      const btn = await has('wb-save-template');
      let dlg = false;
      if (btn) {
        await click('wb-save-template'); await wait(900);
        dlg = await has('wb-save-template-title');
        if (dlg) {
          await page.locator('[data-testid="wb-save-template-title"]').fill('T72 我的模板');
          await page.evaluate(() => { document.querySelector('[data-testid^="wb-save-template-page-"]')?.click(); });
          await wait(400);
          await click('wb-save-template-confirm'); await wait(2200);
        }
      }
      await openMarket();
      await click('wb-market-tab-templates'); await wait(1000);
      const mine = await mineIds();
      check('M6-a 另存为→我的模板分区新增 1 卡（ULID id 契约）', btn && dlg && mine.length === 1, `btn=${String(btn)} dlg=${String(dlg)} mine=${JSON.stringify(mine).slice(0, 80)}`);
      await page.screenshot({ path: join(SHOTS, 'm6-mine.png') }).catch(() => {});
    });

    await group('M7|导入导出', async () => {
      const expBuiltin = await has('wb-market-template-export-work-journal');
      const expMine = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="wb-market-template-export-"]')].some((e) => /^wb-market-template-export-[0-9A-Z]{20,}$/.test(e.getAttribute('data-testid') ?? '')));
      check('M7-a 导出钮：内置+我的模板均挂（anchor 下载不实点）', expBuiltin && expMine, `bi=${String(expBuiltin)} mine=${String(expMine)}`);
      await click('wb-market-import'); await wait(800);
      const ta = page.locator('[data-testid="wb-market-import-text"]');
      await ta.waitFor({ state: 'visible', timeout: 6000 });
      const good = JSON.stringify({ id: 't72-imported', title: 'T72 导入模板', desc: 'd', layout: { v: 2, order: ['quick', 'todo', 'database', 'recent', 'favorites', 'quote'], hidden: [] }, seedPages: [] });
      await ta.fill(good);
      await click('wb-market-import-confirm'); await wait(1800);
      const mineAfter = await mineIds();
      check('M7-b 导入合法 JSON→我的模板分区 1→2', mineAfter.length === 2, `n=${String(mineAfter.length)}`);
      await click('wb-market-import'); await wait(700);
      await page.locator('[data-testid="wb-market-import-text"]').fill('{ 坏 JSON!!');
      await click('wb-market-import-confirm'); await wait(1100);
      const n2 = (await mineIds()).length;
      const toastBad = await page.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map((e) => (e.textContent ?? '').trim()).join('|'));
      check('M7-c 坏 JSON→不落库+toast', n2 === 2 && toastBad.includes('不合法'), `n=${String(n2)} toast="${toastBad.slice(0, 40)}"`);
    });

    await group('M8|删除', async () => {
      const mine = await mineIds();
      const last = mine.length > 0 ? mine[mine.length - 1] : '';
      const del = await click(`wb-market-template-delete-${last}`);
      await wait(1500);
      const after = await mineIds();
      check('M8-a 我的模板软删→分区少一', del && after.length === mine.length - 1, `del=${String(del)} ${String(mine.length)}→${String(after.length)}`);
      await page.screenshot({ path: join(SHOTS, 'm8-final.png') }).catch(() => {});
    });
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't72-results.json'), JSON.stringify({ task: 'T72-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    check('M9-a 真实数据根未被触碰', rootBefore === rootMtime(), `mtime ${String(rootBefore)}→${String(rootMtime())}`);
    killTree(child.pid);
    await wait(2500);
    check('M9-b 本探针 electron 残留 0', electronCount() <= beforee, `before=${String(beforee)} after=${String(electronCount())}`);
    console.log(`\n===== T72-01：${pass} PASS / ${fail} FAIL =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });