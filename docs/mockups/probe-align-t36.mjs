/* TASK-T36-01 真机量测：①手柄簇与首行行框对齐 ②换块型视觉锚定（dScroll=0 +
 * 首行行框中心位移 ≤1px + 光标不跳出）③长页（≥30 块）中段换型 ④T35-01 斜杠
 * Enter 无残留 ⑤T33 装订线 gutter ≥8 / 块菜单 12 项 / 斜杠菜单 11 项回归。
 * 双主题截图（浅/深 × H1/列表 hover）。
 * 直接以 electron . 跑 freshly-built out/（T34-01 同口径，非重打包）；
 * 独立夹具根（--user-data-dir + rootPath），不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APPDIR = 'E:/Hermes Agent工作空间/Septcats/apps/desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t36-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t36-data';
const PORT = 9396;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t36';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, 1000 * ms / 1000));
const log = (...a) => console.log(...a);

killAll();
for (const d of [UD, ROOT, SHOTS]) rmSync(d, { recursive: true, force: true });
for (const d of [UD, ROOT, SHOTS]) mkdirSync(d, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await wait(1000); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
if (br === null) { console.log('FATAL: CDP connect failed'); killAll(); process.exit(1); }
const page = br.contexts()[0].pages()[0];
for (let k = 0; k < 25; k++) { if (await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false)) break; await wait(800); }

await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('T36 对齐量测页');
await input.press('Enter');
await wait(1800);
await page.locator('.pv-body').first().click();
await page.keyboard.type('对齐测试文本', { delay: 30 });
await wait(1500);

/** 打开块菜单并点指定项（hover 手柄块 → 点手柄 → 菜单点 label）。 */
async function convertViaMenu(label) {
  await page.evaluate(() => {
    const b = document.querySelector('.sc-blockcontrol__handle');
    if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true }));
  });
  await wait(700);
  await page.locator('.sc-blockcontrol__menu').getByText(label, { exact: true }).first().click({ timeout: 5000 });
  await wait(900);
}

/** 量测首块：首行行框（firstChild 文本盒/行框）+ 簇 + 滚动 + 光标归属块。 */
const MEASURE = () => {
  const blk = document.querySelector('.pv-body [data-id]');
  const cluster = document.querySelector('.sc-blockcontrol');
  const scroller = document.querySelector('.pv-root');
  const out = { scrollTop: Math.round(scroller?.scrollTop ?? -1), tag: blk?.tagName ?? null };
  if (blk) {
    const node = blk.firstChild ?? blk;
    const rng = document.createRange(); rng.selectNodeContents(node);
    const tr = rng.getBoundingClientRect();
    out.line = { top: +tr.top.toFixed(1), bottom: +tr.bottom.toFixed(1), centerY: +((tr.top + tr.bottom) / 2).toFixed(1) };
    out.text = (blk.textContent ?? '').slice(0, 24);
    const sel = document.getSelection();
    out.selBlock = sel && sel.anchorNode ? (sel.anchorNode.parentElement?.closest('[data-id]')?.getAttribute('data-id') ?? null) : null;
  }
  if (cluster) {
    const cr = cluster.getBoundingClientRect();
    out.cluster = { top: +cr.top.toFixed(1), bottom: +cr.bottom.toFixed(1), centerY: +((cr.top + cr.bottom) / 2).toFixed(1), right: +cr.right.toFixed(1) };
  }
  if (blk && out.cluster && out.line) {
    out.deltaCenterY = +(out.cluster.centerY - out.line.centerY).toFixed(1);
    // T33 装订线：块文本左缘到簇右缘的距离（≥8）
    const blkRect = blk.getBoundingClientRect();
    const style = getComputedStyle(blk);
    const textLeft = blkRect.left + parseFloat(style.paddingLeft || '0') + parseFloat(style.borderLeftWidth || '0');
    out.gutter = +(textLeft - out.cluster.right).toFixed(1);
  }
  return out;
};

const results = { align: {}, convert: {}, longPage: {}, slash: {}, regress: {} };

const main = async () => {
// ---------- ① 手柄 vs 首行：段落 / H1 / 无序列表 / 引用 ----------
for (const [kind, label] of [['paragraph', '文本'], ['h1', '标题 1'], ['list', '无序列表'], ['quote', '引用']]) {
  if (kind !== 'paragraph') await convertViaMenu(label);
  const blk = page.locator('.pv-body [data-id]').first();
  await blk.hover();
  await wait(900);
  results.align[kind] = await page.evaluate(MEASURE);
}
log('① 手柄-首行对齐（deltaCenterY 应 |·|≤1）:', JSON.stringify(results.align, null, 1));

// ---------- ② 换块型锚定：P→H1→H2→H3→列表→引用→代码→P ----------
const convertSeq = [['标题 1', 'h1'], ['标题 2', 'h2'], ['标题 3', 'h3'], ['无序列表', 'list'], ['引用', 'quote'], ['代码块', 'code'], ['文本', 'paragraph']];
await page.locator('.pv-body [data-id]').first().hover();
await wait(600);
let prev = await page.evaluate(MEASURE);
for (const [label, key] of convertSeq) {
  await convertViaMenu(label);
  const cur = await page.evaluate(MEASURE);
  results.convert[`${prev.tag}→${key}`] = {
    dScroll: cur.scrollTop - prev.scrollTop,
    dCenterY: +(cur.line.centerY - prev.line.centerY).toFixed(1),
    caretKept: cur.selBlock === prev.selBlock,
  };
  prev = cur;
}
log('② 换块型（dScroll=0 / dCenterY≤1 / 光标不跳）:', JSON.stringify(results.convert, null, 1));
await page.screenshot({ path: SHOTS + '/convert-light.png' });

// ---------- ③ T35-01 斜杠 Enter 无残留 ----------
await page.locator('.pv-body [data-id]').first().click();
await page.keyboard.press('End');
await page.keyboard.press('Enter'); // 新建第二块
await wait(400);
await page.keyboard.type('残留测试');
await wait(400);
await page.keyboard.press('/');
await wait(700);
const menuOpen = await page.evaluate(() => document.querySelector('[data-testid="septcats-slashmenu"]') !== null);
await page.keyboard.press('ArrowDown'); // → 标题 1
await wait(300);
await page.keyboard.press('Enter');
await wait(1200);
results.slash = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.pv-body [data-id]')];
  const target = blocks.map((b) => ({ tag: b.tagName, text: (b.textContent ?? '').slice(0, 24) }));
  return { menuOpenAfter: document.querySelector('[data-testid="septcats-slashmenu"]') !== null, blockCount: blocks.length, target };
});
log('③ 斜杠 Enter（应：菜单关、块数不变、无残留）:', JSON.stringify(results.slash));
await page.screenshot({ path: SHOTS + '/slash-enter.png' });

// ---------- ④ 长页 ≥30 块、滚动中段换型 ----------
await page.locator('.pv-body').first().click({ position: { x: 300, y: 400 } }).catch(() => {});
await page.evaluate(() => {
  const last = [...document.querySelectorAll('.pv-body [data-id]')].pop();
  last?.scrollIntoView();
});
await page.locator('.pv-body [data-id]').last().click();
await wait(400);
for (let i = 0; i < 32; i++) { await page.keyboard.type(`长页块 ${i + 1} 内容行`); await page.keyboard.press('Enter'); await wait(60); }
await wait(800);
const blockCount = await page.evaluate(() => document.querySelectorAll('.pv-body [data-id]').length);
await page.evaluate(() => {
  const scroller = document.querySelector('.pv-root');
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2; // 长页中段
});
await wait(500);
// 滚动到视口中段的那一块上 hover + 换型
const midInfo = await page.evaluate(() => {
  const scroller = document.querySelector('.pv-root');
  const midY = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of document.querySelectorAll('.pv-body [data-id]')) {
    const r = b.getBoundingClientRect();
    const dist = Math.abs((r.top + r.bottom) / 2 - midY);
    if (dist < bestDist) { bestDist = dist; best = b; }
  }
  return best?.getAttribute('data-id') ?? null;
});
if (midInfo === null) { console.log('FATAL: mid block not found'); await br.close().catch(() => {}); killAll(); process.exit(1); }
await page.locator(`.pv-body [data-id="${midInfo}"]`).hover();
await wait(700);
const beforeMid = await page.evaluate(MEASURE);
await convertViaMenu('标题 1');
await wait(400);
const afterMid = await page.evaluate(MEASURE);
await convertViaMenu('无序列表');
await wait(400);
const afterMid2 = await page.evaluate(MEASURE);
results.longPage = {
  blockCount,
  midBlock: midInfo,
  p_to_h1: { dScroll: afterMid.scrollTop - beforeMid.scrollTop, dCenterY: +(afterMid.line.centerY - beforeMid.line.centerY).toFixed(1), caretKept: afterMid.selBlock === beforeMid.selBlock },
  h1_to_list: { dScroll: afterMid2.scrollTop - afterMid.scrollTop, dCenterY: +(afterMid2.line.centerY - afterMid.line.centerY).toFixed(1), caretKept: afterMid2.selBlock === afterMid.selBlock },
};
log('④ 长页中段换型（dScroll=0 / dCenterY≤1）:', JSON.stringify(results.longPage, null, 1));
await page.screenshot({ path: SHOTS + '/longpage-mid-h1.png' });

// ---------- ⑤ 回归：块菜单 12 项 / 斜杠 11 项 / gutter ----------
await page.locator('.pv-body [data-id]').first().hover();
await wait(500);
await page.evaluate(() => {
  const b = document.querySelector('.sc-blockcontrol__handle');
  if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true }));
});
await wait(700);
results.regress.blockMenuItems = await page.evaluate(() => document.querySelectorAll('.sc-blockcontrol__menu [role="menuitem"]').length);
await page.keyboard.press('Escape');
await wait(300);
// 焦点回编辑器再触发斜杠菜单
await page.locator('.pv-body [data-id]').first().click();
await page.keyboard.press('End');
await wait(200);
await page.keyboard.press('/');
await wait(700);
results.regress.slashMenuItems = await page.evaluate(() => document.querySelectorAll('[data-testid="septcats-slashmenu"] [role="option"]').length);
await page.keyboard.press('Escape');
await wait(300);
results.regress.gutter = await page.evaluate(() => {
  const blk = document.querySelector('.pv-body [data-id]');
  const cluster = document.querySelector('.sc-blockcontrol');
  if (!blk || !cluster) return null;
  const st = getComputedStyle(blk);
  const textLeft = blk.getBoundingClientRect().left + parseFloat(st.paddingLeft || '0') + parseFloat(st.borderLeftWidth || '0');
  return +(textLeft - cluster.getBoundingClientRect().right).toFixed(1);
});
log('⑤ 回归（块菜单应 12 / 斜杠应 11 / gutter≥8）:', JSON.stringify(results.regress));

// ---------- ⑥ 双主题截图（H1 与列表 hover） ----------
// 深色
await page.evaluate(() => localStorage.setItem('septcats.theme', 'dark'));
await page.reload();
await wait(2500);
const darkBlk = page.locator('.pv-body [data-id]').first();
await darkBlk.hover();
await wait(900);
await page.screenshot({ path: SHOTS + '/dark-h1-hover.png' });
const darkAlign = await page.evaluate(MEASURE);
log('⑥ 深色 H1 对齐:', JSON.stringify(darkAlign));
// 深色列表
await page.locator('.pv-body [data-id]').nth(2).hover().catch(() => {});
await wait(700);
await page.screenshot({ path: SHOTS + '/dark-list-hover.png' });
// 回浅色
await page.evaluate(() => localStorage.setItem('septcats.theme', 'light'));
await page.reload();
await wait(2500);
await page.locator('.pv-body [data-id]').first().hover();
await wait(900);
await page.screenshot({ path: SHOTS + '/light-h1-hover.png' });

log('ALIGN-RESULT ' + JSON.stringify(results));
};
try { await main(); } finally { await br.close().catch(() => {}); killAll(); }
process.exit(0);
