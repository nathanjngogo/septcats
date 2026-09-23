/*
 * cdp-e2e-t70-01.mjs —— 库层级 UI（R20①②/T70）PM 真机取证。
 * W1 头行=库切换器（Menu：库列表+新建/重命名项）；W2 建三类型库+切换列表增长+
 * 切库数据隔离；W3 知识库库=5 结构页且仅 MOC 一标签（雷区实证）；W4 工作台库=
 * 切过去即见 home（.wb-head）；W5 原地重命名→头行即变+ipc 列表同步；W6 zh 界面
 * 「工作区」仅剩库名；W7 老库页面无损；W8 真根 untouched+退出 electron=0。
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t70';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const SHOTS = join(SCRIPT_DIR, 'screens-t70');
const PORT = 9574;
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

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

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true });
  const rootBefore = rootMtime();
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
  await page.waitForSelector('[data-testid="side-ws-head"]', { timeout: 20000 });

  const ipc = (channel, payload) => page.evaluate(async ([ch, p]) => {
    const api = window.septcats;
    const fn = ch.split('.').reduce((o, k) => o?.[k], api);
    if (typeof fn !== 'function') return { ok: false, err: `NO_CHANNEL:${ch}` };
    try { return { ok: true, data: await fn.call(api, p) }; } catch (e) { return { ok: false, err: String(e?.message ?? e).slice(0, 140) }; }
  }, [channel, payload]);
  const wsList = async () => (await ipc('workspaces.list', {})).data;
  const treeOf = async (id) => {
    const r = await ipc('pages.tree', { workspaceId: id });
    return Array.isArray(r.data) ? r.data.filter((n) => n.alive === 1) : [];
  };
  const openHeadMenu = async () => {
    await page.locator('[data-testid="side-ws-head"]').last().click({ force: true }).catch(() => {});
    await wait(500);
    const items = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent ?? '').trim()));
    return items;
  };
  const clickMenu = async (text) => {
    const ok = await page.evaluate((tt) => {
      const hit = [...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? '').includes(tt));
      if (hit === undefined) return false;
      hit.click();
      return true;
    }, text);
    await wait(700);
    return ok;
  };
  const createWs = async (name, typeId) => {
    const items = await openHeadMenu();
    if (!items.some((i) => i.includes('新建库'))) return false;
    await clickMenu('新建库');
    await page.locator('[data-testid="new-ws-name"]').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="new-ws-name"]').fill(name);
    await page.locator(`[data-testid="new-ws-type-${typeId}"]`).click({ force: true });
    await page.locator('[data-testid="new-ws-confirm"]').click({ force: true });
    await wait(2600);
    return true;
  };
  const tabCount = () => page.evaluate(() => document.querySelectorAll('.tabsbar-tab').length);

  // ---- 基线：默认库（个人工作区）----
  STEP = 'W0|基线';
  const ws0 = await wsList();
  const baseId = ws0?.activeId ?? null;
  const baseName = (ws0?.items ?? []).find((w) => w.id === baseId)?.name ?? '';
  // 基线先造 1 页（无损回归需要非空样本）
  await ipc('pages.create', { parentId: null });
  await wait(800);
  const tree0 = (await treeOf(baseId)).map((n) => n.title).sort();
  check('W0-1 夹具默认库就位（含 1 基线页）', baseId !== null && baseName.includes('工作区') && tree0.length === 1, `name=${baseName} tree=${JSON.stringify(tree0)}`);

  // ---- W1 头行=库切换器 ----
  STEP = 'W1|切换器';
  const items1 = await openHeadMenu();
  check('W1-1 头行点击弹库 Menu（当前库 ✓ + 新建库… + 重命名当前库…）',
    items1.some((i) => i.startsWith('✓')) && items1.some((i) => i.includes('新建库')) && items1.some((i) => i.includes('重命名当前库')),
    items1.join('|'));
  await page.keyboard.press('Escape');
  await wait(400);

  // ---- W2 三类型建库 ----
  STEP = 'W2|建库';
  const okWB = await createWs('T70 工作台库', 'workbench');
  await page.locator('[data-testid="new-ws-name"]').waitFor({ state: 'hidden', timeout: 6000 }).catch(() => {});
  const wbVisible = await page.locator('.wb-head').count();
  const ws2 = await wsList();
  const wbId = (ws2?.items ?? []).find((w) => w.name === 'T70 工作台库')?.id ?? null;
  check('W2-1 工作台库创建成功且切过去即见 home（.wb-head）', okWB && wbVisible > 0 && wbId !== null, `home=${String(wbVisible > 0)}`);
  const okKN = await createWs('T70 知识库', 'knowledge');
  const ws3 = await wsList();
  const knId = (ws3?.items ?? []).find((w) => w.name === 'T70 知识库')?.id ?? null;
  check('W2-2 知识库库创建成功；切换列表=3 库', okKN && (ws3?.items ?? []).length === 3, `n=${String((ws3?.items ?? []).length)}`);
  // W3 紧接 knowledge 建库后断言（此刻活动库=知识库，标签现场未被后续切库冲掉）
  const treeKN = (await treeOf(knId)).map((n) => n.title);
  const want = ['收件箱', 'MOC 目录', '资料', '日志', '归档'];
  check('W3-1 知识库=5 结构页（收件箱/MOC 目录/资料/日志/归档）', want.every((w) => treeKN.includes(w)), treeKN.join('|'));
  const tabsKN = await tabCount();
  const tabText = await page.evaluate(() => [...document.querySelectorAll('.tabsbar-tab')].map((el) => el.textContent ?? ''));
  check('W3-2 雷区实证：仅 MOC 目录 1 个标签，无卡死重命名态', tabsKN === 1 && tabText.some((x) => x.includes('MOC')) && (await page.locator('[data-testid="side-rename-input"]').count()) === 0, `tabs=${String(tabsKN)} ${JSON.stringify(tabText)}`);
  await page.screenshot({ path: join(SHOTS, 't70-01-moc-tab.png') }).catch(() => null);
  const okBL = await createWs('T70 空白库', 'blank');
  const ws4 = await wsList();
  const blId = (ws4?.items ?? []).find((w) => w.name === 'T70 空白库')?.id ?? null;
  const treeBL = await treeOf(blId);
  check('W2-3 空白库创建成功且无种子页', okBL && (ws4?.items ?? []).length === 4 && treeBL.length === 0, `pages=${String(treeBL.length)}`);
  await page.screenshot({ path: join(SHOTS, 't70-01-wsmenu.png') }).catch(() => null);

  // ---- W5 重命名当前库（现在活动=空白库）----
  STEP = 'W5|重命名';
  await openHeadMenu();
  await clickMenu('重命名当前库');
  const renInput = page.locator('[data-testid="side-ws-rename-input"]');
  const renVisible = await renInput.count();
  if (renVisible > 0) { await renInput.fill('T70 空白库改'); await renInput.press('Enter'); await wait(1200); }
  const ws5 = await wsList();
  const headText = await page.evaluate(() => document.querySelector('[data-testid="side-ws-head"]')?.textContent ?? '');
  const renamed = (ws5?.items ?? []).some((w) => w.name === 'T70 空白库改');
  check('W5-1 原地重命名→头行即变+列表同步', renVisible > 0 && renamed && headText.includes('T70 空白库改'), `head=${headText.trim()}`);

  // ---- W7 切回老库数据无损 + W6 文案 ----
  STEP = 'W6|回归';
  await openHeadMenu();
  await clickMenu(baseName);
  await wait(1800);
  const treeBack = (await treeOf(baseId)).map((n) => n.title).sort();
  check('W7-1 切回默认库：页面与基线一致（老数据无损）', JSON.stringify(treeBack) === JSON.stringify(tree0) && tree0.length > 0, `before=${JSON.stringify(tree0)} after=${JSON.stringify(treeBack)}`);
  const bodyText = await page.evaluate(() => document.body.innerText ?? '');
  const residue = bodyText.replace(new RegExp(baseName, 'g'), '').includes('工作区');
  check('W6-1 zh 界面「工作区」零残留（除默认库名本体）', !residue, `residue=${String(residue)} sample=${bodyText.replace(/\s+/g, ' ').slice(0, 120)}`);
  await page.screenshot({ path: join(SHOTS, 't70-01-final.png') }).catch(() => null);

  check('W8-1 真实数据根未被触碰', rootBefore === rootMtime(), `before=${String(rootBefore)}`);
  await browser.close().catch(() => {});
  killTree(child.pid);
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; })
  .finally(() => {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't70-01-results.json'), JSON.stringify({ task: 'T70-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T70-01：${pass} PASS / ${fail} FAIL =====`);
    try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
    setTimeout(() => {
      let n = '?';
      try { n = execSync('powershell -NoProfile -Command "(Get-Process electron -ErrorAction SilentlyContinue | Measure-Object).Count"', { encoding: 'utf8' }).trim(); } catch { /* */ }
      console.log('realRoot untouched + electron 最终计数=', n);
      process.exit(fail === 0 && n === '0' ? 0 : 1);
    }, 1500);
  });
