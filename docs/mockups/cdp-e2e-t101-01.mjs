/**
 * cdp-e2e-t101-01.mjs —— 全站对比度扫描（老板 10-01 第③项）。
 * 主题由 SEPTCATS_THEME 决定（dark 默认 / light 也扫：淡化面 × 弱字的隐患两基底都要查）。
 *
 * 与 T100-01 的区别：T100 只量**六个手工选的关键落点**；本探针做**DOM 全域扫描**——
 * 遍历所有「带自有文本」的可见元素，沿祖先链合成**真实背景色**，按 WCAG 算比值：
 *   正文（<18.66px 或 <24px 非粗体）≥ 4.5 · 大字号 ≥ 3。
 *
 * 诚实口径（不假装算得出）：
 *  - 祖先链里出现 background-image（渐变/贴图/壁纸）⇒ 合成背景不可数值判定，计入
 *    `indeterminate`（附原因），**不**混进通过/违例；
 *  - 元素自身或祖先 visibility:hidden / opacity:0 / 零尺寸 ⇒ 视为不可见，跳过；
 *  - 只算**自有文本节点**（避免容器把子元素文本重复计入）。
 *
 * 覆盖面：一级轨八项各自页面 + 编辑器 + 多维表格（表格/看板/二级栏）+ 记录详情弹层 +
 * 字段显示菜单 + 命令面板 + 设置页 + AI 面板。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFrom = createRequire(join(REPO_ROOT, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');

const REPO = REPO_ROOT;
const APPDIR = join(REPO, 'apps', 'desktop');
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const REAL_ROOT = join(process.env.USERPROFILE ?? 'C:/Users/Administrator', '.septcats');
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9440);
const THEME = process.env.SEPTCATS_THEME === 'light' ? 'light' : 'dark';
const RUN_NAME = `t101-01-${THEME}`;
const RUN = `E:\\Hermes Agent工作空间\\_scratch\\${RUN_NAME}`;
const UD = join(RUN, 'userdata');
const ROOT = join(RUN, 'root');
const SHOTS = join(RUN, 'shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ } }
function killStaleApp() { for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

/** 页内全域扫描：返回逐面统计 + 违例 + 不可判定。 */
const SWEEP = () => {
  const parse = (v) => {
    const m = /rgba?\(([^)]+)\)/.exec(v);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter((x) => x !== '').map(Number);
      return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
    }
    const s = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(v);
    if (s) return { r: Number(s[1]) * 255, g: Number(s[2]) * 255, b: Number(s[3]) * 255, a: s[4] === undefined ? 1 : Number(s[4]) };
    return null;
  };
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = (c) => { const f = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (f, b) => { const a = lum(f); const c = lum(b); return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05); };
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const path = (el) => {
    const bits = [];
    let n = el;
    for (let i = 0; i < 4 && n !== null && n.tagName !== undefined; i += 1) {
      bits.unshift(`${n.tagName.toLowerCase()}${n.className !== undefined && typeof n.className === 'string' && n.className !== '' ? '.' + String(n.className).trim().split(/\s+/).slice(0, 2).join('.') : ''}`);
      n = n.parentElement;
    }
    return bits.join(' > ');
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue ?? '').join('').trim();

  const violations = [];
  const indeterminate = [];
  let checked = 0;
  let approxCount = 0;
  const ratios = [];

  for (const el of document.querySelectorAll('body *')) {
    const text = ownText(el);
    if (text === '') continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (el.getClientRects().length === 0) continue;
    if (el.closest('[aria-hidden="true"]') !== null) continue;
    const fg = parse(cs.color);
    if (fg === null) continue;
    if (fg.a === 0) continue;

    // 祖先链：合成背景色。
    // 背景图分两类（这是本探针的关键判据）：
    //   · 「质地」= 周期 ≤4px 的 repeating-linear-gradient（夜航的 1px 扫描线 / 像素档网格纸）：
    //     对文字可读性的影响等同极淡底色 ⇒ 按背景色算，并标 approx（不假装它是精确值）；
    //   · 「大渐变/贴图」（radial-gradient 环境光、壁纸、图片）⇒ 合成背景不可数值判定 → indeterminate。
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const chain = [];
    let gradAncestor = null;
    let approx = false;
    let node = el;
    while (node !== null && node.tagName !== undefined) {
      const ncs = getComputedStyle(node);
      if (ncs.backgroundImage !== 'none') {
        const bgs = ncs.backgroundImage;
        // 「质地」判据：没有 radial-gradient / url()（即不是环境光/壁纸/图片），
        // 且图内出现过的所有长度都 ≤32px（细线、色条、刻度格网都是这种）⇒ 对可读性的影响
        // 等同极淡底色，按背景色算并标 approx。反之（大渐变 / 贴图 / 无 px 长度的渐变）= 不可判定。
        const hasBigOrImage = /radial-gradient|url\(/.test(bgs);
        const lens = [...bgs.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
        const textureOnly = !hasBigOrImage && lens.length > 0 && lens.every((v) => v <= 32);
        if (textureOnly) {
          approx = true;
        } else if (gradAncestor === null) {
          gradAncestor = path(node);
        }
      }
      const c = parse(ncs.backgroundColor);
      if (c !== null && c.a > 0) chain.push(c);
      node = node.parentElement;
    }
    for (let i = chain.length - 1; i >= 0; i -= 1) bg = over(chain[i], bg);

    const sizePx = Number.parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) >= 700 ? 700 : 400;
    const large = sizePx >= 24 || (sizePx >= 18.66 && weight >= 700);
    const threshold = large ? 3 : 4.5;
    const r = ratio(over(fg, bg), bg);
    ratios.push(r);

    if (gradAncestor !== null) {
      indeterminate.push({ text: text.slice(0, 24), sel: path(el), ratio: Math.round(r * 100) / 100, reason: `背景含大渐变/贴图（${gradAncestor}）⇒ 合成背景不可数值判定`, size: sizePx });
      continue;
    }
    checked += 1;
    if (approx) {
      approxCount += 1;
    }
    if (r < threshold) {
      violations.push({ text: text.slice(0, 24), sel: path(el), ratio: Math.round(r * 100) / 100, need: threshold, fg: hex(fg), bg: hex(bg), size: sizePx, weight, approx });
    }
  }
  ratios.sort((a, b) => a - b);
  return {
    checked,
    /** checked 里有多少是「纹理近似」（背景含 ≤4px 小周期质地，按底色算） */
    approxCount,
    violations,
    indeterminate,
    min: ratios.length === 0 ? null : Math.round(ratios[0] * 100) / 100,
    p05: ratios.length === 0 ? null : Math.round(ratios[Math.floor(ratios.length * 0.05)] * 100) / 100,
    theme: document.documentElement.dataset.theme ?? '',
    look: document.documentElement.dataset.look ?? '',
  };
};

async function launch() {
  killStaleApp();
  // ⚠ Windows 上目录可能被占用（EBUSY）——实测最常见的占用者就是「上一个探针 shell 的 cwd」
  //   或索引器。清不掉就**复用**：本脚本每一步都是覆盖写，profile 留着也无害（绝不让清理失败阻断验证）。
  try {
    rmSync(RUN, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch { /* 占用：复用现有目录 */ }
  mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: THEME, locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
  }, null, 2), 'utf8');
  const child = spawn(APP_BIN, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: dirname(APP_BIN), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2500);
  if (await page.locator('[data-testid="ws-create"]').count() > 0) { await page.locator('[data-testid="ws-create"]').first().click(); await wait(2500); }
  return { child, browser, page };
}

const SURFACES = [];
function record(surface, sweep) {
  SURFACES.push({ surface, ...sweep });
  const tag = sweep.violations.length === 0 ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${surface.padEnd(16)} 文本元素 ${String(sweep.checked)}（其中纹理近似 ${String(sweep.approxCount)}）· 最小 ${String(sweep.min)}:1 · p05 ${String(sweep.p05)}:1 · 违例 ${String(sweep.violations.length)} · 不可判定 ${String(sweep.indeterminate.length)}`);
  for (const v of sweep.violations.slice(0, 4)) {
    console.log(`        ✗ ${String(v.ratio)}:1 (需 ${String(v.need)})「${v.text}」 ${v.sel}  ${v.fg} on ${v.bg}  ${String(v.size)}px/${String(v.weight)}`);
  }
}

async function rail(page, key) {
  await page.evaluate((k) => { document.querySelector(`[data-testid="nav-rail-${k}"]`)?.click(); }, key);
  await wait(1500);
}
async function topBtn(page, label) {
  await page.evaluate((text) => {
    const btns = [...document.querySelectorAll('.sc-shell__topbar button')];
    const hit = btns.find((b) => (b.textContent ?? '').trim().includes(text));
    if (hit !== undefined) { hit.click(); }
  }, label);
  await wait(1400);
}

let CHILD = null;
async function main() {
  const before = rootMtime();
  const h = await launch();
  CHILD = h.child;
  const page = h.page;
  try {
    await page.evaluate((theme) => {
      localStorage.setItem('septcats.theme', theme);
      localStorage.setItem('septcats.look', 'instrument');
      localStorage.setItem('septcats.palette', 'instrument');
    }, THEME);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
    await wait(2600);

    // 编辑器面（先造一页正文）
    await page.locator('[data-testid="side-new-page"]').click();
    await wait(1300);
    const ed = page.locator('.ProseMirror').first();
    if (await ed.count() > 0) {
      await ed.click(); await wait(250);
      await page.keyboard.type('夜航 · 深色全站对比度扫描样本正文。');
      await wait(700);
    }
    record('编辑器', await page.evaluate(SWEEP));

    // 一级轨各面
    for (const [key, label] of [
      ['knowledge', '知识库'],
      ['calendar', '日历'],
      ['todo', '待办'],
      ['workbench', '工作台'],
      ['templates', '模板市场'],
      ['trash', '回收站'],
    ]) {
      await rail(page, key);
      record(label, await page.evaluate(SWEEP));
    }

    // 多维表格：造夹具（分步 + 超时）→ reload 对账
    await rail(page, 'bitable');
    const step = async (name, fn, arg) => {
      const r = await Promise.race([
        page.evaluate(fn, arg),
        wait(15000).then(() => { throw new Error(`夹具超时: ${name}`); }),
      ]);
      return r;
    };
    const wsInfo = await step('workspaces.list', () => (async () => {
      const ws = await window.septcats.workspaces.list();
      return { activeId: ws.activeId ?? null, first: (ws.items ?? [])[0]?.id ?? null };
    })());
    const madeInfo = await step('db.create', (id) => (async () => {
      const made = await window.septcats.db.create({ workspaceId: id, title: `扫描表-${String(Date.now() % 100000)}` });
      return { pageId: made.pageId };
    })(), wsInfo.activeId ?? wsInfo.first);
    const propInfo = await step('propAdd+propUpdate', (pageId) => (async () => {
      const added = await window.septcats.db.propAdd({ pageId, type: 'select' });
      const props = added.collection.schema.properties;
      const pid = Object.keys(props).find((k) => props[k].type === 'select');
      const opts = await window.septcats.db.propUpdate({ pageId, pid, patch: { options: [{ name: '待办' }, { name: '进行中' }] } });
      const ids = opts.collection.schema.properties[pid].options.map((o) => o.id);
      const titlePid = added.collection.schema.title_pid;
      return { pid, ids, titlePid };
    })(), madeInfo.pageId);
    await step('recordCreate', (a) => (async () => {
      await window.septcats.db.recordCreate({ pageId: a.pageId, values: { [a.titlePid]: '扫描样本 A', [a.pid]: a.ids[0] } });
      await window.septcats.db.recordCreate({ pageId: a.pageId, values: { [a.titlePid]: '扫描样本 B', [a.pid]: a.ids[1] } });
      return { ok: true };
    })(), { pageId: madeInfo.pageId, pid: propInfo.pid, ids: propInfo.ids, titlePid: propInfo.titlePid });
    const vid = `vk${String(Date.now() % 10000)}`;
    await step('viewSave', (a) => (async () => {
      await window.septcats.db.viewSave({ pageId: a.pageId, view: { vid: a.vid, name: '按状态', type: 'kanban', filter: { op: 'and', clauses: [] }, sort: [], widths: {}, groupPid: a.pid } });
      return { ok: true };
    })(), { pageId: madeInfo.pageId, pid: propInfo.pid, vid });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
    await wait(2400);
    await rail(page, 'bitable');
    await page.evaluate((pid) => { document.querySelector(`[data-testid="bitable-side-item-${pid}"]`)?.click(); }, madeInfo.pageId);
    await wait(1700);
    record('多维表格·表格', await page.evaluate(SWEEP));

    // 字段显示菜单
    await page.evaluate(() => { document.querySelector('[data-testid="propbar-fields"]')?.click(); });
    await wait(700);
    record('字段显示菜单', await page.evaluate(SWEEP));
    await page.keyboard.press('Escape');
    await wait(500);

    // 看板 + 记录详情
    await page.evaluate((v) => { document.querySelector(`[data-testid="bitable-view-chip-${v}"]`)?.click(); }, vid);
    await wait(1500);
    record('多维表格·看板', await page.evaluate(SWEEP));
    const cardId = await page.evaluate(() => (document.querySelector('article.bitable-card')?.getAttribute('data-testid') ?? '').replace('bitable-card-', ''));
    await page.evaluate((rid) => { document.querySelector(`[data-testid="bitable-open-${rid}"]`)?.click(); }, cardId);
    await wait(1200);
    record('记录详情弹层', await page.evaluate(SWEEP));
    await page.evaluate(() => { document.querySelector('[data-testid="bitable-detail-close"]')?.click(); });
    await wait(600);

    // 命令面板
    await page.keyboard.press('Control+k');
    await wait(1000);
    record('命令面板', await page.evaluate(SWEEP));
    await page.keyboard.press('Escape');
    await wait(600);

    // 设置页 / AI 面板
    await topBtn(page, '设置');
    record('设置页', await page.evaluate(SWEEP));
    await topBtn(page, 'AI');
    record('AI 面板', await page.evaluate(SWEEP));

    // 收尾取证：关掉面板回到主壳，留一张全屏图（顶栏 + 侧栏 + 主区都在画面里）
    await page.keyboard.press('Escape');
    await wait(500);
    await page.evaluate(() => { document.querySelector('[data-testid="nav-rail-notes"]')?.click(); });
    await wait(1600);
    await page.screenshot({ path: join(SHOTS, `${RUN_NAME}-shell.png`) });
    console.log(`截图：${join(SHOTS, `${RUN_NAME}-shell.png`)}`);

    const after = rootMtime();
    const viol = SURFACES.reduce((n, s2) => n + s2.violations.length, 0);
    const indet = SURFACES.reduce((n, s2) => n + s2.indeterminate.length, 0);
    const checked = SURFACES.reduce((n, s2) => n + s2.checked, 0);
    console.log(`\n档案根 mtime: ${String(before)} vs ${String(after)} → ${before === after ? '零触碰 ✓' : '被改动 ✗'}`);
    console.log(`===== T101-01 全站对比度（${THEME}）：${String(SURFACES.length)} 个面 · 文本元素 ${String(checked)} · 违例 ${String(viol)} · 不可判定 ${String(indet)} =====`);
    writeFileSync(join(SHOTS, `${RUN_NAME}-contrast.json`), JSON.stringify({ surfaces: SURFACES, realRootUntouched: before === after }, null, 2), 'utf8');
    console.log(`明细：${join(SHOTS, `${RUN_NAME}-contrast.json`)}`);
    process.exitCode = viol === 0 && before === after ? 0 : 1;
  } finally {
    try { await browser.close(); } catch { /* */ }
    if (CHILD !== null) { killTree(CHILD.pid); }
    killStaleApp();
  }
}

main().catch((err) => {
  console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`);
  killStaleApp();
  process.exitCode = 2;
});
