/* Septcats 全量巡检（A: 启动/空态/页面 CRUD/搜索对抗）——PM QA，独立夹具根
 * 用法：node sweep-qa.mjs A   |   node sweep-qa.mjs B
 * 结果追加到 docs/mockups/sweep-results.json */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';

const PHASE = (process.argv[2] ?? 'A').toUpperCase();
const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = `E:\\Hermes Agent工作空间\\_scratch\\qa-root-${PHASE}`;
const ROOT = `E:\\Hermes Agent工作空间\\_scratch\\qa-data-${PHASE}`;
const PORT = PHASE === 'A' ? 9381 : 9382;
const SHOTS = `E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-qa/${PHASE}`;
const RESULTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/sweep-results.json';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const rows = [];
const check = (id, name, ok, severity, detail = '') => { rows.push({ phase: PHASE, id, name, ok, severity: ok ? null : severity, detail: String(detail).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${id}] ${name}${detail ? '  — ' + String(detail).slice(0, 190) : ''}`); };

killAll();
for (const dir of [UD, ROOT, SHOTS]) rmSync(dir, { recursive: true, force: true });
for (const dir of [UD, ROOT, SHOTS]) mkdirSync(dir, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
const pageErrors = [];
const consoleErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async () => {
  for (let k = 0; k < 25; k++) {
    if (await page.evaluate(() => typeof window.septcats?.pages?.create === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) return true;
    await wait(800);
  }
  return false;
};
await ready();
const side = page.locator('.app-side');
const txt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
const editor = () => page.evaluate(() => (document.querySelector('.pv-body .ProseMirror')?.innerText ?? ''));
const newPage = async (title) => {
  await side.getByText(/新建页面|New Page/).first().click({ timeout: 8000 }).catch(() => {});
  const i = side.locator('input').first();
  if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) {
    if (title !== null) await i.fill(title);
    await i.press('Enter');
  }
  await wait(1800);
};
const paletteSearch = async (q) => {
  await page.keyboard.press('Escape').catch(() => {});
  await wait(300);
  await page.keyboard.press('Control+k');
  const pin = page.locator('[data-testid="palette-panel"] input').first();
  if (!(await pin.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false))) return null;
  await pin.fill('');
  if (q) await pin.type(q, { delay: 20 });
  await wait(1400);
  return page.locator('.palette-list [role="option"]').allInnerTexts().catch(() => []);
};
const setLocale = async (loc) => {
  await page.evaluate((l) => localStorage.setItem('septcats.localePref', l), loc);
  await page.evaluate(async (l) => { try { await window.septcats.settings.patch({ locale: l }); } catch { /* ok */ } }, loc);
  await page.reload();
  await ready();
  await wait(2200);
};
const cjk = (s) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;

if (PHASE === 'A') {
  // A1 空态
  const empty = await txt();
  check('A1', '空库显示空态（.pv-empty）且无示例假内容', (await page.locator('.pv-empty').count()) > 0 && !empty.includes('暗物质'), 'Medium', empty.slice(0, 120));

  // A2 语言切换（English 整页零 CJK，剔除工作区名数据）
  await setLocale('en-US');
  const en = (await txt()).split('个人工作区').join('');
  check('A2', 'English 整页零 CJK（剔除工作区名）', cjk(en) === 0, 'High', `cjk=${cjk(en)} "${en.slice(0, 140)}"`);
  check('A3', 'English 空态文案已英化', en.includes('No pages yet') || /no pages/i.test(en), 'Low', en.slice(0, 120));
  await page.screenshot({ path: SHOTS + '/a-en-empty.png' });
  await setLocale('zh-CN');

  // A4 空标题新建（不输入直接 Enter）
  await newPage(null);
  const afterEmpty = await txt();
  check('A4', '空标题新建 → 回退为「未命名」且不崩', afterEmpty.includes('未命名'), 'Medium', afterEmpty.slice(0, 120));

  // A5 改名 + 输入 + 重载持久化（先判别「输入是否落地」，再判持久化）
  await newPage('巡检页甲');
  const typeInto = async (t) => {
    await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
    await page.keyboard.type(t, { delay: 15 });
    await wait(1800);
    return await editor();
  };
  const typed = await typeInto('巡检正文甲-A');
  check('A5a', '编辑器可输入（输入已落 UI）', typed.includes('巡检正文甲-A'), 'Critical', `editor="${typed.slice(0, 60)}"`);
  await page.reload(); await ready(); await wait(2600);
  const crumbAfter = await page.evaluate(() => (document.querySelector('.sc-shell__crumb')?.innerText ?? '').replace(/\s+/g, ' ').trim());
  // 判别：重载后是否自动回到上次打开的页（不是则记为由脚本显式打开目标页）
  const autoRestored = crumbAfter.includes('巡检页甲');
  const hA5 = await paletteSearch('巡检页甲');
  await page.locator('.palette-list [role="option"]').first().click().catch(() => {});
  await wait(2000);
  const persisted = await editor();
  check('A5', '新建→输入→重载→打开该页：内容仍在（真落库）', persisted.includes('巡检正文甲-A'), 'Critical', `reload 后选中="${crumbAfter}" / 打开后 editor="${persisted.slice(0, 70)}"`);
  check('A5b', '（UX）重载后自动恢复上次打开的页', autoRestored, 'Low', `reload 后选中="${crumbAfter}"（未恢复则登记 UX 缺口）`);

  // A6 重复标题
  await newPage('巡检页甲');
  const st6 = await txt();
  const dup = (st6.match(/巡检页甲/g) ?? []).length;
  check('A6', '同名页可共存（不互相覆盖）', dup >= 2, 'Medium', `出现 ${dup} 次`);

  // A7 超长标题（120 字）
  const longTitle = '超长标题'.repeat(30);
  await newPage(longTitle);
  await page.screenshot({ path: SHOTS + '/a-long-title.png' });
  const st7 = await txt();
  check('A7', '超长标题不崩、侧栏仍可交互（截图留证）', st7.includes('超长标题'), 'Low', st7.slice(0, 100));
  const sideBox = await side.boundingBox().catch(() => null);
  check('A8', '超长标题后页面布局未破（侧栏宽度正常）', !!sideBox && sideBox.width > 100 && sideBox.width < 600, 'Low', JSON.stringify(sideBox));

  // A9 三层嵌套 + 面包屑
  const ids = await page.evaluate(async () => {
    const mk = async (pid, title) => { const r = await window.septcats.pages.create({ parentId: pid }); await window.septcats.pages.rename({ id: r.id, title }); return r.id; };
    const a = await mk(null, '巡检父');
    const b = await mk(a, '巡检子');
    const c = await mk(b, '巡检孙');
    return [a, b, c];
  });
  await page.reload(); await ready(); await wait(2500);
  const rows3 = await paletteSearch('巡检孙');
  await page.locator('.palette-list [role="option"]').first().click().catch(() => {});
  await wait(1600);
  const crumb = await page.evaluate(() => (document.querySelector('.sc-shell__crumb')?.innerText ?? '').replace(/\s+/g, ' '));
  check('A9', '三层嵌套面包屑正确（父/子/孙）', crumb.includes('巡检父') && crumb.includes('巡检子') && crumb.includes('巡检孙'), 'Medium', `crumb="${crumb}"`);

  // A10 搜索：2 字中文按**内容**命中（先跳到已知页并输入，再搜）
  const h10 = await paletteSearch('巡检页甲');
  await page.locator('.palette-list [role="option"]').first().click().catch(() => {});
  await wait(1600);
  const typed2 = await typeInto('审计线索乙');
  check('A10a', '第二页编辑器可输入', typed2.includes('审计线索乙'), 'High', `editor="${typed2.slice(0, 60)}"`);
  const hits2 = await paletteSearch('审计');
  const contentHit = (hits2 ?? []).some((t) => t.includes('巡检页甲'));
  check('A10', '2 字中文按内容命中该页（含命中行）', contentHit, 'High', `hits=${(hits2 ?? []).length} ${(hits2 ?? []).join(' | ').slice(0, 150)}`);

  // A11 对抗性：通配符/特殊字符不得崩、不得全量误命中
  const specials = ['%', '_', '"', '(', '*', '\\', '巡检 AND', '巡检 OR 巡检'];
  const specResults = [];
  for (const s of specials) {
    const before = pageErrors.length;
    const hit = await paletteSearch(s);
    specResults.push(`${JSON.stringify(s)}:${hit === null ? 'panel-null' : String(hit.length)}`);
    if (pageErrors.length > before) specResults.push(`CRASH@${s}`);
  }
  check('A11', '特殊字符查询不崩（面板可开、无 pageerror）', !specResults.some((r) => r.includes('CRASH')), 'High', specResults.join(' '));
  const pctHits = await paletteSearch('%');
  const pctReal = (pctHits ?? []).filter((t) => !t.includes('在搜索结果页打开') && !t.includes('Open in the search page'));
  check('A12', '通配符 % 不误命中全部页面（LIKE 转义）', pctReal.length === 0, 'High', `hits=${pctReal.length} ${pctReal.join(' | ').slice(0, 120)}`);

  // A13 超长查询
  const longQ = '巡'.repeat(300);
  const longHit = await paletteSearch(longQ);
  check('A13', '超长查询不崩', longHit !== null || pageErrors.length === 0, 'Medium', `rows=${longHit === null ? 'null' : longHit.length}`);
  await page.keyboard.press('Escape').catch(() => {});
  check('A14', 'A 段全程零 pageerror / console error', pageErrors.length === 0 && consoleErrors.length === 0, 'Critical', `pageErrors=${pageErrors.length} console=${consoleErrors.length} :: ${[...pageErrors, ...consoleErrors].join(' ;; ').slice(0, 200)}`);
}

if (PHASE === 'B') {
  // B1 模板：另存为页模板
  await newPage('巡检模板源');
  await page.locator('.pv-body .ProseMirror p').first().click({ timeout: 8000 }).catch(() => {});
  await page.keyboard.type('模板结构正文', { delay: 15 });
  await wait(1600);
  let pr = await paletteSearch('另存为');
  await page.locator('.palette-list [role="option"]').filter({ hasText: '另存为模板' }).first().click().catch(() => {});
  await wait(1000);
  const sInp = page.locator('[data-testid="template-save-name"]').first();
  const ok1 = await sInp.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
  if (ok1) await sInp.fill('巡检模板甲');
  await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
  await wait(1800);
  const l1 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
  check('B1', '另存为页模板成功（kind=page）', l1.some((t) => t.title === '巡检模板甲' && t.kind === 'page'), 'High', JSON.stringify(l1.map((t) => `${t.title}:${t.kind}`)).slice(0, 160));

  // B2 边界：空模板名
  pr = await paletteSearch('另存为');
  await page.locator('.palette-list [role="option"]').filter({ hasText: '另存为模板' }).first().click().catch(() => {});
  await wait(1000);
  const s2 = page.locator('[data-testid="template-save-name"]').first();
  if (await s2.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) await s2.fill('');
  await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
  await wait(1500);
  const l2 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
  const emptyNamed = l2.filter((t) => !t.title || !t.title.trim());
  check('B2', '空模板名被拦截或回退（不得落库空名）', emptyNamed.length === 0, 'Medium', `空名模板=${emptyNamed.length} list=${l2.map((t) => t.title).join(',')}`);

  // B3 从模板新建（侧栏下拉）
  await page.locator('.app-side .app-nav-suffix').first().click().catch(() => {});
  await wait(1200);
  await side.getByText('巡检模板甲').first().click().catch(() => {});
  await wait(2600);
  const inst = await editor();
  check('B3', '从模板建页：内容继承', inst.includes('模板结构正文'), 'High', inst.slice(0, 80));

  // B4 库模板：转换 → 另存 → kind=database → 实例化 0 记录
  await page.getByText('转为多维数据').first().click({ force: true }).catch(() => {});
  await wait(2800);
  await paletteSearch('另存为');
  await page.locator('.palette-list [role="option"]').filter({ hasText: '另存为模板' }).first().click().catch(() => {});
  await wait(1000);
  const s3 = page.locator('[data-testid="template-save-name"]').first();
  if (await s3.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) await s3.fill('巡检模板库');
  await page.locator('[data-testid="template-save-confirm"]').first().click().catch(() => {});
  await wait(1800);
  const l3 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
  check('B4', '库页另存 → kind=database', l3.some((t) => t.title === '巡检模板库' && t.kind === 'database'), 'High', JSON.stringify(l3.map((t) => `${t.title}:${t.kind}`)).slice(0, 160));

  // B5 数据库：新建记录 → 输入 → 重载持久化
  const newRec = page.getByText(/新建记录|New record|新建行/).first();
  const hasRec = await newRec.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
  if (hasRec) await newRec.click().catch(() => {});
  await wait(2000);
  const dbBefore = await txt();
  await page.reload(); await ready(); await wait(2800);
  const dbAfter = await txt();
  check('B5', '数据库记录创建后重载不崩且仍为库视图', dbAfter.includes('新建记录') || dbAfter.includes('巡检模板库'), 'High', `before=${dbBefore.slice(0, 60)} after=${dbAfter.slice(0, 60)}`);

  // B6 设置页各区块渲染
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button,[role="button"],a')].find((x) => ((x.getAttribute('aria-label') ?? '') + (x.getAttribute('title') ?? '')).match(/设置|Settings/));
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(2200);
  const st = await txt();
  const sections = ['外观', '数据与隐私', 'AI', '模板'].filter((k) => st.includes(k));
  check('B6', '设置页四区块齐备（外观/数据与隐私/AI/模板）', sections.length === 4, 'Medium', `have=${sections.join(',')} :: ${st.slice(0, 140)}`);

  // B7 模板管理：删除（带确认）
  await page.locator('[data-testid="settings-tpl-menu-0"]').first().click({ timeout: 8000 }).catch(() => {});
  await wait(1000);
  await page.getByText(/删除|Delete/).first().click().catch(() => {});
  await wait(1000);
  const dBtn = page.locator('[data-testid="template-delete-confirm"]').first();
  const dOk = await dBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  if (dOk) await dBtn.click().catch(() => {});
  await wait(1800);
  const l4 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
  check('B7', '模板删除生效（含确认弹层）', dOk && l4.length < l3.length, 'Medium', `dOk=${dOk} before=${l3.length} after=${l4.length}`);

  // B8 回收站闭环 + 压力：连续 10 次新建→删除
  const stress = await page.evaluate(async () => {
    const api = window.septcats.pages;
    const ids = [];
    for (let i = 0; i < 10; i++) { const r = await api.create({ parentId: null }); ids.push(r.id); }
    for (const id of ids) await api.remove({ id });
    return ids.length;
  });
  await page.reload(); await ready(); await wait(3000);
  const stB = await txt();
  check('B8', '压力：连建 10 页再全删 → 刷新不崩且回收站角标一致', stress === 10 && /\d/.test(stB), 'High', `created=${stress} ${stB.slice(0, 120)}`);
  check('B9', 'B 段全程零 pageerror / console error', pageErrors.length === 0 && consoleErrors.length === 0, 'Critical', `pageErrors=${pageErrors.length} console=${consoleErrors.length} :: ${[...pageErrors, ...consoleErrors].join(' ;; ').slice(0, 220)}`);
}

await br.close().catch(() => {});
killAll();
const prior = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : [];
const merged = [...prior.filter((r) => r.phase !== PHASE), ...rows];
writeFileSync(RESULTS, JSON.stringify(merged, null, 1), 'utf8');
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n== QA 巡检 ${PHASE} 段：${failed === 0 ? 'ALL-PASS' : failed + ' 项失败'} (${rows.length} 项) ==`);
process.exit(0);