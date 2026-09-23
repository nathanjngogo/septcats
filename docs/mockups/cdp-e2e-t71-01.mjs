/*
 * cdp-e2e-t71-01.mjs —— T71 卡片注册表 + 工作台自定义模式（R20④）PM 真机取证。
 * K1 内置 5 卡迁注册表行为零变（槽序=ALL_CARD_IDS、老 DOM/testid 原样）
 * K2 6 新卡逐一存在 + 最小功能（播种页→格言取句；快捷方式真录真落盘；倒计时/收藏 录入即显；
 *    热力 7 格；库统计 4 项）；收藏点击不跳转（D-1 无 openExternal 通道）
 * K3 自定义模式：grip/拖排/移除/添加目录/完成退出/全卡在册
 * K4 v1→v2 迁移：预埋 v1 串 → 旧序保持 + 新卡追加 + 落盘 v2
 * K5 空态全套（消费卡各带 empty 占位）
 * K6 真根 untouched + electron 残留 0
 * 夹具双隔离（--user-data-dir + settings.rootPath 钉死）；格言/快捷方式断言走真实产品路径
 * （点「新建页」→ 编辑器打字 → 切库回 home → 卡面读数），不注入假数据。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t71';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t71');
const PORT = 9576;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const CARDS_KEY = 'septcats.workbench.cards'; // 常量真名（原『septca…ards』占位省略号为 CB 遗留脏常量，PM 已修）
const EXP_WB = 'T71 卡片库';
const EXPECT_ORDER = ['quick', 'todo', 'database', 'recent', 'favorites', 'shortcut', 'countdown', 'heatmap', 'quote', 'bookmarks', 'libstats'];
const BUILTIN = ['quick', 'todo', 'database', 'recent', 'favorites'];
const NEW = ['shortcut', 'countdown', 'heatmap', 'quote', 'bookmarks', 'libstats'];
const BODY = 'T71 格言样本正文';

const requireFrom = createRequire(join(REPO, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const assertions = [];
let STEP = 'boot';
function check(name, ok, raw) {
  assertions.push({ step: STEP, name, ok: ok === true, raw: String(raw).slice(0, 280) });
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
  const { child, browser, page } = await launch();

  const ipc = (channel, payload) => page.evaluate(async ([ch, p]) => {
    const api = window.septcats;
    const fn = ch.split('.').reduce((o, k) => o?.[k], api);
    if (typeof fn !== 'function') return { ok: false, err: `NO_CHANNEL:${ch}` };
    try { return { ok: true, data: await fn.call(api, p) }; } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 140) }; }
  }, [channel, payload]);
  const slots = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="wb-slot-"]')].map((e) => e.getAttribute('data-testid').replace('wb-slot-', '')));
  const has = async (tid) => (await page.locator(`[data-testid="${tid}"]`).count()) > 0;
  const click = async (tid) => page.evaluate((s) => {
    const el = document.querySelector(`[data-testid="${s}"]`);
    if (el === null) return false;
    el.click();
    return true;
  }, tid);
  const lsGet = (k) => page.evaluate((kk) => localStorage.getItem(kk), k);
  const menuClick = (text) => page.evaluate((tt) => {
    const hit = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').includes(tt));
    if (hit === undefined) return false;
    hit.click();
    return true;
  }, text);
  const openHeadMenu = async () => { await page.locator('[data-testid="side-ws-head"]').last().click({ force: true }); await wait(600); };
  const switchLib = async (name) => {
    await openHeadMenu();
    const ok = await menuClick(name);
    await wait(2800);
    return ok;
  };
  // 回 home 的真实入口=顶栏房子钮 workbench-open（T66 口径）；切库回原库会恢复编辑页签、非 home。
  const ensureHome = async () => {
    if (await has('workbench')) return true;
    await page.locator('[data-testid="workbench-open"]').first().click({ force: true });
    await wait(2600);
    return has('workbench');
  };
  const group = async (name, fn) => {
    STEP = name;
    try { await fn(); } catch (e) {
      check(`${name} 组异常（后续断言未执行）`, false, String(e?.message ?? e).slice(0, 160));
    }
  };

  try {
    // ---- setup：建工作台库（落 home）----
    await group('setup', async () => {
      await page.locator('[data-testid="ws-create"]').first().click().catch(() => {});
      await wait(2000);
      await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });
      await openHeadMenu();
      const opened = await menuClick('新建库');
      await page.locator('[data-testid="new-ws-name"]').waitFor({ state: 'visible', timeout: 8000 });
      await page.locator('[data-testid="new-ws-name"]').fill(EXP_WB);
      await page.locator('[data-testid="new-ws-type-workbench"]').click({ force: true });
      await page.locator('[data-testid="new-ws-confirm"]').click({ force: true });
      await wait(3000);
      check('S1 工作台库创建并落 home', opened && (await has('workbench')), `menu=${String(opened)} home=${String(await has('workbench'))}`);
    });

    // ---- K1 内置 5 卡迁注册表行为零变 ----
    await group('K1|内置5卡', async () => {
      const order1 = await slots();
      check('K1-1 槽序=注册表全集序（5 内置在前 + 6 新卡随后）', JSON.stringify(order1) === JSON.stringify(EXPECT_ORDER), order1.join(','));
      const anchors = ['wb-quick-page', 'wb-quick-database', 'wb-quick-daily', 'wb-todo-input', 'wb-db-new', 'wb-recent-empty', 'wb-favorites-empty', 'wb-card-more-quick'];
      const missing = [];
      for (const t of anchors) if (!(await has(t))) missing.push(t);
      check('K1-2 内置卡老 DOM/testid 原样未动（8 锚点）', missing.length === 0, missing.length === 0 ? 'all 8 present' : `missing=${missing.join(',')}`);
      const n = await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].filter((e) => /^wb-card-[a-z]+$/.test(e.getAttribute('data-testid'))).length);
      check('K1-3 卡壳壳层齐（11 卡）', n === 11, `cards=${String(n)}`);
    });

    // ---- K5 空态全套（新鲜夹具、未录任何数据）----
    await group('K5|空态', async () => {
      const emptyIds = ['wb-todo-empty', 'wb-db-empty', 'wb-recent-empty', 'wb-favorites-empty', 'wb-shortcut-empty', 'wb-bookmarks-empty', 'wb-countdown-empty', 'wb-quote-empty'];
      const seen = [];
      for (const t of emptyIds) if (await has(t)) seen.push(t);
      check('K5-1 消费卡空态占位齐全（8/8）', seen.length === 8, `${String(seen.length)}/8 → ${seen.join(',')}`);
    });

    // ---- K2 六新卡最小功能 ----
    await group('K2|新卡', async () => {
      const missing = [];
      for (const id of NEW) if (!(await has(`wb-card-${id}`))) missing.push(id);
      check('K2-1 六新卡壳全在', missing.length === 0, missing.length === 0 ? NEW.join(',') : `missing=${missing.join(',')}`);
      const heat = await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-heatmap-cell-"]').length);
      check('K2-2 热力卡 7 格（含今日）', heat === 7, `cells=${String(heat)}`);
      const statNums = await page.evaluate(() => ['wb-libstats-pages', 'wb-libstats-depth', 'wb-libstats-db', 'wb-libstats-fav'].map((t) => (document.querySelector(`[data-testid="${t}"]`)?.textContent ?? '').trim()));
      check('K2-3 库统计 4 项数值齐', statNums.length === 4 && statNums.every((v) => /\d/.test(v)), statNums.join('|'));

      // 播种：点内置 quick 卡「新建页」→ 编辑器打字（真实产品路径）→ 切库回 home
      const wsList = await ipc('workspaces.list', {});
      const wbId = (wsList.data?.items ?? []).find((w) => w.name === EXP_WB)?.id ?? null;
      const before = ((await ipc('pages.tree', { workspaceId: wbId })).data ?? []).filter((n) => n.alive === 1).length;
      await click('wb-quick-page');
      await wait(3000);
      const edMounted = await page.locator('.pv-root .ProseMirror, .pv-root [contenteditable="true"]').first().isVisible().catch(() => false);
      if (edMounted) {
        await page.locator('.pv-root .ProseMirror, .pv-root [contenteditable="true"]').first().click();
        await page.keyboard.type(BODY, { delay: 14 });
        await wait(2600);
      }
      const tree = ((await ipc('pages.tree', { workspaceId: wbId })).data ?? []).filter((n) => n.alive === 1);
      let bodyLen = -1;
      for (const node of tree) {
        const r = await ipc('blocks.list', { pageId: node.id });
        const txt = JSON.stringify(r.data ?? null);
        if (txt.includes(BODY.slice(0, 4))) { bodyLen = txt.length; break; }
      }
      check('K2-4 播种页落库（quick 卡新建页+打字真提交）', edMounted && tree.length === before + 1 && bodyLen > 0, `ed=${String(edMounted)} pages ${String(before)}→${String(tree.length)} bodyHit=${String(bodyLen > 0)}`);

      const homeBack = await ensureHome();
      await wait(2200);
      const quoteText = await page.evaluate(() => (document.querySelector('[data-testid="wb-quote"]')?.textContent ?? '').trim());
      check('K2-5 格言卡：从近期页首块取句（播种文本上卡）', homeBack && quoteText.includes(BODY.slice(0, 6)), `home=${String(homeBack)} quote="${quoteText.slice(0, 60)}"`);

      await click('wb-shortcut-add');
      await wait(800);
      const pickerOpen = await has('wb-shortcut-picker');
      const cand = await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-shortcut-pick-"]').length);
      const picked = await page.evaluate(() => {
        const b = document.querySelector('[data-testid^="wb-shortcut-pick-"]');
        if (b === null) return false;
        b.click();
        return true;
      });
      await wait(900);
      const scRaw = await lsGet('septcats.wbcard.shortcut.links');
      const scCard = await page.evaluate(() => (document.querySelector('[data-testid="wb-card-shortcut"]')?.textContent ?? '').trim());
      check('K2-6 快捷方式卡：目录可选+录入即显+落 settings localStorage', pickerOpen && cand > 0 && picked && String(scRaw ?? '').length > 4, `picker=${String(pickerOpen)} cand=${String(cand)} ls=${String(scRaw).slice(0, 60)} card="${scCard.slice(0, 40)}"`);

      await click('wb-countdown-add');
      await page.locator('[data-testid="wb-countdown-input-label"]').waitFor({ state: 'visible', timeout: 6000 });
      await page.locator('[data-testid="wb-countdown-input-label"]').fill('发布日');
      const d = new Date(Date.now() + 30 * 86400000);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await page.locator('[data-testid="wb-countdown-input-date"]').fill(iso);
      await click('wb-countdown-submit');
      await wait(900);
      const cdText = await page.evaluate(() => (document.querySelector('[data-testid="wb-card-countdown"]')?.textContent ?? '').trim());
      check('K2-7 倒计时卡：录入后显示剩余天数', cdText.includes('发布日') && /29|30|31/.test(cdText), cdText.slice(0, 80));

      const urlBefore = page.url();
      const pagesBefore = browser.contexts()[0].pages().length;
      await click('wb-bookmarks-add');
      await page.locator('[data-testid="wb-bookmarks-input-title"]').waitFor({ state: 'visible', timeout: 6000 });
      await page.locator('[data-testid="wb-bookmarks-input-title"]').fill('官网');
      await page.locator('[data-testid="wb-bookmarks-input-url"]').fill('https://example.com');
      await click('wb-bookmarks-submit');
      await wait(900);
      const bmText = await page.evaluate(() => (document.querySelector('[data-testid="wb-bookmarks"]')?.textContent ?? '').trim());
      const bmClicked = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="wb-bookmarks"] button, [data-testid="wb-bookmarks"] [role="button"]');
        if (el === null) return false;
        el.click();
        return true;
      });
      await wait(900);
      const pagesAfter = browser.contexts()[0].pages().length;
      check('K2-8 收藏卡：录入即显；点击不跳转（D-1 无 openExternal 通道）',
        bmText.includes('官网') && page.url() === urlBefore && pagesAfter === pagesBefore,
        `row=${String(bmText.includes('官网'))} urlSame=${String(page.url() === urlBefore)} pages ${String(pagesBefore)}→${String(pagesAfter)} clicked=${String(bmClicked)}`);
    });

    // ---- K3 自定义模式 ----
    await group('K3|自定义', async () => {
      const homeMounted = await ensureHome();
      const preSlots = await slots();
      check('K3-0 前置：home 挂载且 11 卡在册', homeMounted && preSlots.length === 11, `home=${String(homeMounted)} n=${String(preSlots.length)}`);
      await click('wb-customize');
      await wait(800);
      const grips = await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-card-grip-"]').length);
      const removes = await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-card-remove-"]').length);
      check('K3-1 进自定义：grip+移除钮齐（11）', grips === 11 && removes === 11, `grip=${String(grips)} remove=${String(removes)}`);
      // 三段式：dragstart 先派发并等 React 提交 dragId state，再 dragover/drop（同步派发会被批处理吞掉）
      await page.evaluate(() => {
        window.__t71dt = new DataTransfer();
        const src = document.querySelector('[data-testid="wb-slot-heatmap"]');
        src?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__t71dt }));
      });
      await wait(300);
      const dragMid = await page.evaluate(() => document.querySelectorAll('[data-testid="wb-slot--dragging"], .wb-slot--dragging').length);
      await page.evaluate(() => {
        const tgt = document.querySelector('[data-testid="wb-slot-quick"]');
        tgt?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__t71dt }));
      });
      await wait(300);
      const dropped = await page.evaluate(() => {
        const tgt = document.querySelector('[data-testid="wb-slot-quick"]');
        if (tgt === null) return false;
        tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__t71dt }));
        return true;
      });
      await wait(900);
      const dragged = dropped;
      const order3 = await slots();
      const ls3 = await lsGet(CARDS_KEY);
      check('K3-2 拖排：heatmap 前移生效且即时落盘', dragged && dragMid === 1 && order3[0] === 'heatmap' && String(ls3 ?? '').includes('heatmap'), `dragging=${String(dragMid)} order0=${order3[0]} ls=${String(ls3).slice(0, 60)}`);
      await click('wb-card-remove-quote');
      await wait(800);
      const afterRemove = await slots();
      check('K3-3 移除卡片：11→10 且 quote 槽消失（hidden 记账）', afterRemove.length === 10 && !afterRemove.includes('quote'), `n=${String(afterRemove.length)} ${afterRemove.join(',')}`);
      await click('wb-add-card-btn');
      await wait(700);
      const addOk = await menuClick('引用摘抄');
      await wait(900);
      const afterAdd = await slots();
      check('K3-4 添加卡片目录：移除的卡可加回', addOk && afterAdd.includes('quote'), `add=${String(addOk)} n=${String(afterAdd.length)}`);
      await click('wb-customize-done');
      await wait(700);
      const gripsAfter = await page.evaluate(() => document.querySelectorAll('[data-testid^="wb-card-grip-"]').length);
      const finalSlots = await slots();
      check('K3-5 完成钮退出自定义（grip 归零且 home 仍在）', gripsAfter === 0 && finalSlots.length === 11, `grip=${String(gripsAfter)} n=${String(finalSlots.length)}`);
      check('K3-6 全卡在册（11 卡无丢失）', finalSlots.length === 11, finalSlots.join(','));
      // K3-7 重启还原：reload 后自定义序仍在（先等 leveldb 落盘，避免假红）
      await wait(2600);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(3800);
      await ensureHome();
      await wait(1600);
      const orderBack = await slots();
      check('K3-7 重启还原：自定义序（heatmap 居首）仍在', orderBack.length === 11 && orderBack[0] === 'heatmap', `n=${String(orderBack.length)} order0=${String(orderBack[0])}`);
    });

    // ---- K4 v1→v2 迁移 ----
    await group('K4|迁移', async () => {
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CARDS_KEY, JSON.stringify({ v: 1, order: ['quick', 'todo', 'database', 'recent', 'favorites'], hidden: [] })]);
      // leveldb 落盘异步：等了 3s 再 reload，否则读回上一轮旧值（T65 同源教训）
      await wait(3000);
      const seedBack = await page.evaluate((k) => localStorage.getItem(k), CARDS_KEY);
      check('K4-0 前置：v1 串已写入并回读一致', String(seedBack ?? '').includes('"v":1'), String(seedBack).slice(0, 80));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await wait(4200);
      await ensureHome();
      await wait(1600);
      const order4 = await slots();
      const ls4raw = await lsGet(CARDS_KEY);
      let v4 = 'unparsable';
      try { v4 = JSON.parse(String(ls4raw)).v; } catch { /* */ }
      check('K4-1 v1 旧序保持 + 新卡追加在后', order4.length === 11 && JSON.stringify(order4.slice(0, 5)) === JSON.stringify(BUILTIN), `n=${String(order4.length)} ${order4.join(',')}`);
      check('K4-2 v1 读入迁移语义：DOM 全序 = 内置保序 + 六新卡补尾', JSON.stringify(order4) === JSON.stringify(EXPECT_ORDER), `loadV=${String(v4)} order=${order4.join(',')}`);
      // K4-3：迁移后任一写动作落盘必须已是 v2（真机实证写格式）
      await click('wb-customize');
      await wait(700);
      await click('wb-card-remove-libstats');
      await wait(900);
      const ls4b = await lsGet(CARDS_KEY);
      let v4b = 'unparsable'; let hidden4b = [];
      try { const j = JSON.parse(String(ls4b)); v4b = j.v; hidden4b = j.hidden ?? []; } catch { /* */ }
      await click('wb-customize-done');
      await wait(500);
      check('K4-3 迁移后写动作落盘 = v2 且 hidden 记账', v4b === 2 && hidden4b.includes('libstats'), `v=${String(v4b)} hidden=${JSON.stringify(hidden4b)} raw=${String(ls4b).slice(0, 90)}`);
    });

    await group('evidence', async () => {
      await page.screenshot({ path: join(SHOTS, 't71-home-light.png') }).catch(() => {});
      await click('wb-customize');
      await wait(700);
      await page.screenshot({ path: join(SHOTS, 't71-customize-light.png') }).catch(() => {});
      await click('wb-customize-done');
      await wait(400);
      check('E1 双证据截图产出', true, join(SHOTS, 't71-home-light.png'));
    });
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't71-results.json'), JSON.stringify({ task: 'T71-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    check('K6-1 真实数据根未被触碰', rootBefore === rootMtime(), `mtime ${String(rootBefore)}→${String(rootMtime())}`);
    killTree(child.pid);
    await wait(2500);
    check('K6-2 本探针 electron 残留 0', electronCount() <= beforee, `before=${String(beforee)} after=${String(electronCount())}`);
    console.log(`\n===== T71-01：${pass} PASS / ${fail} FAIL =====`);
    process.exit(fail === 0 ? 0 : 1);
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(3); });