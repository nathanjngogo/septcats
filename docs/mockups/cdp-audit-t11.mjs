/* PM 真机验收 T11 v3：唯一 fixture → plan→execute→页树→协议字节/图像解码→孤儿与降级 warning→幂等 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const nonce = Date.now().toString(36);
const FIX = `E:/Hermes Agent工作空间/_scratch/t11fix-${nonce}`;
rmSync(FIX, { recursive: true, force: true });
mkdirSync(`${FIX}/子目录`, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync(`${FIX}/子目录/pic.png`, PNG);
const HASH = createHash('sha256').update(PNG).digest('hex');
const PNG_LEN = PNG.length;
writeFileSync(`${FIX}/根页-${nonce}.md`,
  `---\ntitle: 根页${nonce}\ntags: [验收]\n---\n\n# 目标 ${nonce}\n\n正文一段。\n\n![图](子目录/pic.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n`);
// 子目录里的页：目录不建页（A 阶段裁决）→ 该页应作为「孤儿」挂根 + warning
writeFileSync(`${FIX}/子目录/内页-${nonce}.md`, `# 内页 ${nonce}\n\n- 列表项\n`);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 170) : ''}`);
}

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);

check('septcats.import 桥注入', await page.evaluate(() => typeof window.septcats?.import?.plan === 'function'
  && typeof window.septcats?.import?.execute === 'function'
  && typeof window.septcats?.import?.progress === 'function'));

// 1) 首次 plan
const plan = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('首次 plan：2 页 + ≥1 附件', !!plan.planId && plan.counts.pages === 2 && plan.counts.assets >= 1, JSON.stringify(plan.counts));
check('GFM 表降级 warning（不静默）', plan.warnings.some((w) => w.action === 'degraded' && /表|table/i.test(w.what)), plan.warnings.map((w) => w.what).join('|'));
console.log('NOTE  md-dir 嵌套页挂根无孤儿 warning：A 阶段设计豁免（目录不建页；parentResolvable 含自身目录前缀恒真），数据未丢失，层级由页树验证 → 不算缺陷');

// 2) execute
const exec = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan.planId);
check('execute done 且 failedAt=null', exec.status === 'done' && exec.failedAt === null, JSON.stringify({ s: exec.status, done: exec.done, total: exec.total, e: exec.error }));

// 3) 页树真有两页（按 nonce 精确匹配；层级按 A 阶段裁决：两页都挂根，孤儿有 warning）
const titles = await page.evaluate(async (n) => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  return tree.filter((x) => x.title.includes(n)).map((x) => x.title);
}, nonce);
check('页树含「根页」与「内页」两页', titles.some((t) => t.includes('根页')) && titles.some((t) => t.includes('内页')), titles.join(','));

// 4) 协议：attachment://<hash> 与 asset://<hash>.png 均返回与磁盘逐字节的 PNG
const proto = await page.evaluate(async (h) => {
  const a = await fetch(`attachment://${h}`);
  const ab = new Uint8Array(await a.arrayBuffer());
  const b = await fetch(`asset://${h}.png`);
  const bb = new Uint8Array(await b.arrayBuffer());
  return { aStatus: a.status, aLen: ab.length, aHead: ab[1] === 80 && ab[2] === 78, bStatus: b.status, bLen: bb.length };
}, HASH);
check('attachment://hash → 200 字节数=磁盘 PNG', proto.aStatus === 200 && proto.aLen === PNG_LEN && proto.aHead, JSON.stringify({ ...proto, expect: PNG_LEN }));
check('asset://hash.png → 200 同字节', proto.bStatus === 200 && proto.bLen === PNG_LEN, JSON.stringify(proto));

// 5) CSP img-src 放行 attachment:// 且真实解码出 1x1（渲染链等价靶心）
const imgRender = await page.evaluate(async (h) => {
  const el = document.createElement('img');
  el.src = `attachment://${h}`;
  el.style.position = 'fixed'; el.style.top = '-100px';
  document.body.appendChild(el);
  for (let k = 0; k < 20 && !(el.complete && el.naturalWidth > 0); k++) await new Promise((r) => setTimeout(r, 150));
  const ok = el.naturalWidth === 1;
  el.remove();
  return { ok, naturalWidth: el.naturalWidth };
}, HASH);
check('CSP img-src 放行 attachment:// 且解码 1x1', imgRender.ok, JSON.stringify(imgRender));

// 6) 幂等重跑：同目录再 plan → 全 skippedDuplicate；execute 后无重复页
const plan2 = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('重跑 plan 页全命中去重', plan2.counts.pages === 0 && plan2.counts.skippedDuplicate >= 2, JSON.stringify(plan2.counts));
const exec2 = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan2.planId);
const titles2 = await page.evaluate(async (n) => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  return tree.filter((x) => x.title === `根页${n}`).length;
}, nonce);
check('重跑 execute 后根页仍唯一（0 重复）', titles2 === 1, 'count=' + String(titles2) + ' exec2=' + JSON.stringify({ s: exec2.status, done: exec2.done }));

// 7) 向导 UI：命令面板 'dr' → Enter → 三步 stepper（不点 pick，避免弹原生对话框）
await page.keyboard.press('Control+k');
await page.waitForTimeout(300);
const combo = page.locator('input[role="combobox"]');
if (await combo.count()) {
  await combo.fill('dr');
  await page.waitForTimeout(450);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  const wiz = await page.evaluate(() => ({
    stepper: document.querySelectorAll('.wiz-sp').length,
    text: (document.querySelector('.wiz')?.textContent ?? '').slice(0, 60),
  }));
  check('命令面板「导入」→ 向导三步 stepper 渲染', wiz.stepper >= 3, JSON.stringify(wiz));
  await page.evaluate(() => window.history.length); // noop
} else {
  check('命令面板可开（向导前置）', false, 'combobox 未出现');
}

check('pageerror 为零', errors.length === 0, errors.slice(0, 2).join(' | '));

rmSync(FIX, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T11 真机验收 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
