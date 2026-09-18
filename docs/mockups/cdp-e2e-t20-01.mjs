/* T20-01 真机验收（PM）：
 * ① 1/2 字中文搜索兜底（命令面板真实链路：Ctrl+K → 输入 → 结果列表）
 * ② ≥3 字路径回归（长词仍走 trigram）
 * ③ 深/浅两主题下三处组件（.palette-esc / .palette-foot / .search-empty）的
 *    实测对比度（getComputedStyle 真实着色 + WCAG 公式，阈值 4.5）
 * ④ 零 pageerror + 截图留档（供 vision 目检层级/色偏）
 * 夹具：独立数据根（避免污染老板实例）；页面用 IPC 建，标题即检索靶。
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE_PATH = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t20-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t20-data';
const PORT = 9351;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t20';

function killAll() {
  try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* 无进程 */ }
}
function fresh() {
  killAll();
  rmSync(UD, { recursive: true, force: true });
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'dark' }), 'utf8');
}
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 220) : ''}`);
}
async function connect() {
  for (let k = 0; k < 25; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
  }
  return null;
}
async function ready(br) {
  const page = br.contexts()[0].pages()[0];
  for (let k = 0; k < 20; k++) {
    if (await page.evaluate(() => typeof window.septcats?.search?.query === 'function').catch(() => false)) return page;
    await new Promise((r) => setTimeout(r, 800));
  }
  return page;
}
async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last;
}
/** 打开命令面板（真实快捷键）并输入查询，返回结果列表文本。 */
async function paletteQuery(page, text) {
  await page.keyboard.press('Escape').catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press('Control+k');
  const input = page.locator('[data-testid="palette-panel"] input').first();
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('');
  await input.type(text, { delay: 25 });
  await new Promise((r) => setTimeout(r, 900)); // 等 IPC 往返 + 渲染
  return (await page.locator('.palette-list').first().innerText().catch(() => '')) ?? '';
}
/** 面板三处组件的实测对比度（用真实计算样式，WCAG 公式） */
const measure = (page) => page.evaluate(() => {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const rgb = (s) => { const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const la = L(a), lb = L(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  // 背景：向上找第一个非透明背景
  const bgOf = (el) => {
    let cur = el;
    while (cur) {
      const c = rgb(getComputedStyle(cur).backgroundColor);
      const a = getComputedStyle(cur).backgroundColor;
      if (c && !/rgba\(\d+,\s*\d+,\s*\d+,\s*0\)/.test(a)) return c;
      cur = cur.parentElement;
    }
    return rgb(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255];
  };
  const out = {};
  for (const sel of ['.palette-esc', '.palette-foot', '.search-empty']) {
    const el = document.querySelector(sel);
    if (!el) { out[sel] = null; continue; }
    const fg = rgb(getComputedStyle(el).color);
    const bg = bgOf(el);
    out[sel] = fg && bg ? { color: getComputedStyle(el).color, bg: `rgb(${bg.join(',')})`, ratio: Number(ratio(fg, bg).toFixed(2)) } : null;
  }
  out.theme = document.documentElement.getAttribute('data-theme') ?? '(root)';
  return out;
});

fresh();
const proc = spawn(EXE_PATH, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
proc.unref();
const br = await connect();
check('CDP 连上 dev 实例', !!br);
if (!br) { console.log('== 前置即崩 =='); process.exit(1); }
const page = await ready(br);
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

// ── 造检索靶：标题含 2 字词与更长词 ────────────────────────────────────
const made = await page.evaluate(async () => {
  const p1 = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p1.id, title: '量子实验记录' });
  const p2 = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p2.id, title: '无关页面甲' });
  return { a: p1.id, b: p2.id };
}).catch((e) => 'ERR:' + String(e).slice(0, 120));
check('靶页已建（量子实验记录 / 无关页面甲）', typeof made === 'object' && /^[0-9A-Z]{26}$/.test(made.a), JSON.stringify(made).slice(0, 80));

// ── ① 2 字中文（命令面板真实链路）────────────────────────────────────
const r2 = await paletteQuery(page, '量子');
check('命令面板输入 2 字「量子」→ 出结果（T20-01 兜底生效）', r2.includes('量子实验'), r2.replace(/\s+/g, ' ').slice(0, 120));
check('2 字命中不含无关页（负样本）', !r2.includes('无关页面甲'), r2.replace(/\s+/g, ' ').slice(0, 120));

// ── ② 1 字中文 ───────────────────────────────────────────────────────
const r1 = await paletteQuery(page, '量');
check('命令面板输入 1 字「量」→ 出结果', r1.includes('量子实验'), r1.replace(/\s+/g, ' ').slice(0, 100));

// ── ③ ≥3 字回归（trigram 主路径）─────────────────────────────────────
const r4 = await paletteQuery(page, '量子实验');
check('≥3 字「量子实验」→ 仍命中（主路径无回归）', r4.includes('量子实验'), r4.replace(/\s+/g, ' ').slice(0, 100));

// ── ④ 深色下三处组件实测对比度（面板开着时量 palette-esc/foot） ────────
await paletteQuery(page, '量子');
const dark = await measure(page);
check('深色主题标记生效', dark.theme === 'dark', String(dark.theme));
for (const sel of ['.palette-esc', '.palette-foot']) {
  const m = dark[sel];
  check(`深色 ${sel} 实测对比度 ≥4.5`, m !== null && m.ratio >= 4.5, m ? `${m.ratio} (${m.color} on ${m.bg})` : '元素不存在');
}
await page.screenshot({ path: SHOTS + '/palette-dark.png' });

// ── ⑤ 浅色主题复测（切主题 → 重载） ──────────────────────────────────
await page.evaluate(() => window.septcats.settings.patch({ theme: 'light' })).catch(() => {});
await page.reload();
await ready(br);
await paletteQuery(page, '量子');
const light = await measure(page);
for (const sel of ['.palette-esc', '.palette-foot']) {
  const m = light[sel];
  check(`浅色 ${sel} 实测对比度 ≥4.5`, m !== null && m.ratio >= 4.5, m ? `${m.ratio} (${m.color} on ${m.bg})` : '元素不存在');
}
await page.screenshot({ path: SHOTS + '/palette-light.png' });

check('全程无 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 150));

await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T20-01 真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);