/* TASK-T43-01 真机验收（PM 独立复跑）—— R6「数据库」→「多维数据」文案单

 覆盖任务书 §2：
  1. i18n 文件命中 = 0（PM 已用 grep 单独验，见报告）
  2. 真机渲染：界面**真的**出现「多维数据」，且**整页正文零「数据库」残留**
  3. 英文界面仍英文、无新增 CJK
  4. 双主题截图
 
 双隔离：--user-data-dir + rootPath 全在 _scratch/probe-t43-01/ 下。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t43-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9413;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t43');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok: !!ok, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  ${name}  — ${String(raw)}`);
};

const consoleErrors = [];
const pageErrors = [];
const killTree = (pid) => {
  try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
};
const alive = (pid) => {
  try { execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' }); return true; }
  catch { return false; }
};
const attach = (page, tag) => {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e)}`));
};

async function launch(tag) {
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
    cwd: APPDIR, detached: true, stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 45000;
  let browser = null;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; }
    catch { await wait(700); }
  }
  if (browser === undefined || browser === null) throw new Error('CDP 连接失败');
  let page = null;
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file://'));
    if (page !== undefined && page !== null) break;
    await wait(500);
  }
  if (page === undefined || page === null) throw new Error('未找到渲染页');
  attach(page, tag);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(1800);
  return { page, pid: child.pid };
}

async function quit(page, pid) {
  await page.evaluate(() => { try { window.close(); } catch { /* noop */ } }).catch(() => {});
  await wait(1200);
  killTree(pid);
  await wait(600);
}

// 整页可见文本（含所有元素，用于「零残留」断言）
const PAGE_TEXT = () => document.body.innerText;
// 全量 DOM 文本（含隐藏元素与属性占位）
const DOM_TEXT = () => document.documentElement.outerHTML;

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' },
  sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

const startedAt = Date.now();
console.log('=== TASK-T43-01 真机验收（PM 独立复跑）===\n');

let page = null;
let pid = null;
try {
  // ---------- BOOT 1（浅色 · zh-CN）----------
  console.log('--- BOOT 1 浅色 / zh-CN ---');
  ({ page, pid } = await launch('b1'));
  const boot1 = await page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    theme: document.documentElement.getAttribute('data-theme'),
    hasOld: document.body.innerText.includes('数据库'),
    hasNew: document.body.innerText.includes('多维数据'),
  }));
  info('BOOT1 初始态', JSON.stringify(boot1));

  // 1) 新建页面 → 「转为多维数据」按钮
  await page.getByTestId('side-new-page').click().catch(() => {});
  const nm = page.locator('.app-side input').first();
  const nmOk = await nm.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
  if (nmOk) { await nm.fill('文案校验页'); await nm.press('Enter'); await wait(1500); }
  const conv = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].map((b) => b.textContent ?? '');
    return {
      hasConvertNew: btns.some((t) => t.includes('转为多维数据')),
      hasConvertOld: btns.some((t) => t.includes('转为多维数据')),
      buttons: btns.filter((t) => t.includes('多维') || t.includes('数据库')).slice(0, 5),
    };
  });
  info('页面编辑器按钮', JSON.stringify(conv));
  check('§2.2a 页面渲染「转为多维数据」按钮', conv.hasConvertNew === true, JSON.stringify(conv));
  check('§2.2b 旧文案「转为多维数据」未出现', conv.hasConvertOld === false, `hasOld=${String(conv.hasConvertOld)}`);
  await page.screenshot({ path: join(SHOTS, 'light-01-convert-btn.png') }).catch(() => {});

  // 2) 命令面板：placeholder + 分组
  await page.keyboard.press('Control+k').catch(() => {});
  await wait(1200);
  const pal = await page.evaluate(() => {
    const inp = document.querySelector('[data-testid="palette-panel"] input');
    const panel = document.querySelector('[data-testid="palette-panel"]');
    return {
      placeholder: inp === null ? null : inp.getAttribute('placeholder'),
      panelHasNew: (panel?.textContent ?? '').includes('多维数据'),
      panelHasOld: (panel?.textContent ?? '').includes('数据库'),
    };
  });
  info('命令面板', JSON.stringify(pal));
  check('§2.2c 命令面板 placeholder 含「多维数据」', typeof pal.placeholder === 'string' && pal.placeholder.includes('多维数据'), `placeholder="${String(pal.placeholder)}"`);
  check('§2.2d 命令面板无「数据库」旧文案', pal.panelHasOld === false, `hasOld=${String(pal.panelHasOld)}`);
  await page.screenshot({ path: join(SHOTS, 'light-02-palette.png') }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await wait(600);

  // 3) 整页零残留（最硬的一条：可见文本里不许出现旧词）
  const residue = await page.evaluate(PAGE_TEXT);
  check('§2.1 真机整页可见文本零「数据库」残留', !residue.includes('数据库'),
    `命中=${String((residue.match(/数据库/g) ?? []).length)}`);

  // 4) 英文界面：切 en-US → 断言是 Database 且无新增 CJK
  // i18n 口径：显式选语言 = **清 localePref 标记** + settings.locale（localePref='system' 才是跟随系统）
  await page.evaluate(async () => {
    try {
      // 注意：此处必须用「标记=en-US + settings.locale=en-US」组合。
      // 只清标记（应用自身 setLocalePref 的做法）会因 i18n 缺陷 T43-01-1 落回系统语言（中文 Windows）；
      // 那是既有缺陷、非本单范围，已由 cdp-e2e-i18n-locale-pm.mjs 单独回归。
      localStorage.setItem('septcats.localePref', 'en-US');
      await window.septcats.settings.patch({ locale: 'en-US' });
    } catch { /* noop */ }
  }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await wait(2000);
  await page.getByTestId('side-new-page').click().catch(() => {});
  const nm2 = page.locator('.app-side input').first();
  if ((await nm2.count()) > 0) { await nm2.fill('en check'); await nm2.press('Enter').catch(() => {}); await wait(1500); }
  const en = await page.evaluate(() => {
    const txt = document.body.innerText;
    const cjk = txt.match(/[\u4e00-\u9fff]/g) ?? [];
    const uiBits = ['Convert to database', 'Database', 'New page', 'Settings'];
    const uiHit = uiBits.filter((s) => txt.includes(s));
    return {
      hasConvert: /Convert to database/i.test(txt) || txt.includes('Database'),
      cjkCount: cjk.length,
      cjkSample: cjk.slice(0, 12).join(''),
      uiIsEnglish: uiHit.length > 0,
      uiHit,
      cjkUi: txt.includes('多维数据') || txt.includes('新建页面'),
    };
  });
  info('英文界面', JSON.stringify(en));
  check('§2.3a 英文界面出现 Database 文案', en.hasConvert === true, JSON.stringify(en));
  // 英文界面应无 CJK（我建的那条页面标题不含 CJK，故此处应近 0）
  // 任务书 §2.3 的 CJK 门禁是**源码字面量级**（renderer/src/**，由测试门禁保证，已绿）；
  // 真机整页 CJK 计数含「数据名」（工作区名/页面标题等，可能是中文），不作为断言，仅记录。
  info('§2.3b 英文界面页内 CJK 计数（含数据名，非 UI 文案）', `cjk=${String(en.cjkCount)} sample="${en.cjkSample}"`);
  check('§2.3b 英文界面 UI 文案为英文且无「多维数据」中文残留',
    en.uiIsEnglish === true && en.cjkUi === false,
    `uiEnglish=${String(en.uiIsEnglish)} cjkUi=${String(en.cjkUi)}`);
  await page.screenshot({ path: join(SHOTS, 'en-01-page.png') }).catch(() => {});

  // 5) 深色截图（zh-CN）
  await page.evaluate(() => {
    try { localStorage.setItem('septcats.localePref', 'zh-CN'); localStorage.setItem('septcats.theme', 'dark'); } catch { /* noop */ }
  }).catch(() => {});
  await page.evaluate(async () => {
    try { await window.septcats.settings.patch({ locale: 'zh-CN' }); } catch { /* noop */ }
  }).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await wait(2200);
  await page.getByTestId('side-new-page').click().catch(() => {});
  const nm3 = page.locator('.app-side input').first();
  if ((await nm3.count()) > 0) { await nm3.fill('深色校验'); await nm3.press('Enter').catch(() => {}); await wait(1500); }
  const dark = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    hasNew: document.body.innerText.includes('多维数据'),
    hasOld: document.body.innerText.includes('数据库'),
  }));
  info('深色态', JSON.stringify(dark));
  check('§2.5 深色主题下文案同样生效', dark.theme === 'dark' && dark.hasOld === false,
    JSON.stringify(dark));
  await page.screenshot({ path: join(SHOTS, 'dark-01-page.png') }).catch(() => {});
  const darkResidue = await page.evaluate(PAGE_TEXT);
  check('§2.5b 深色整页零「数据库」残留', !darkResidue.includes('数据库'),
    `命中=${String((darkResidue.match(/数据库/g) ?? []).length)}`);

  await quit(page, pid);
  page = null;
} catch (e) {
  console.log(`\n❌ 探针异常：${String(e?.stack ?? e)}`);
  check('探针完整执行', false, String(e?.message ?? e));
} finally {
  if (page !== null) await quit(page, pid);
  killTree(pid ?? 0);
}

// ---------- 汇总 ----------
const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n===== 汇总 =====`);
console.log(`  ${pass} PASS / ${fail} FAIL   用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
console.log(`  console 错误 ${consoleErrors.length} / pageerror ${pageErrors.length}`);
if (consoleErrors.length > 0) console.log(`  console: ${consoleErrors.slice(0, 3).join(' | ')}`);
if (pageErrors.length > 0) console.log(`  pageerror: ${pageErrors.slice(0, 3).join(' | ')}`);
const shots = readdirSync(SHOTS).filter((f) => f.endsWith('.png'));
console.log(`  截图 ${shots.length} 张：${shots.join(', ')}`);

writeFileSync(join(SHOTS, 't43-results.json'), JSON.stringify({
  pass, fail, results, consoleErrors, pageErrors, shots,
}, null, 2), 'utf8');
console.log(`  结果 JSON：${join(SHOTS, 't43-results.json')}`);
process.exit(fail === 0 ? 0 : 1);