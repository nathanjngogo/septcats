/* PM 真机验收 T11：md-dir 导入全链路（plan→execute→页面树→attachment:// 协议→幂等重跑） */
import { chromium } from 'playwright-core';

const FIX = 'E:/Hermes Agent工作空间/_scratch/t11fixture';
const HASH = 'c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77';

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

// 1) plan（md-dir）
const plan = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('plan 返回 planId + counts（2 页 1 附件）', !!plan.planId && plan.counts.pages === 2 && plan.counts.assets >= 1, JSON.stringify(plan.counts));
check('GFM 表降级 warning（不静默）', plan.warnings.some((w) => w.action === 'degraded'), plan.warnings.map((w) => w.what).join('|'));

// 2) execute
const exec = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan.planId);
check('execute status=done 且 failedAt=null', exec.status === 'done' && exec.failedAt === null, JSON.stringify({ s: exec.status, done: exec.done, total: exec.total, e: exec.error }));

// 3) 页面树真有两页
const titles = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  return (await window.septcats.pages.tree({ workspaceId: ws.activeId })).map((n) => n.title);
});
check('页树含「实验计划」与「总览」', titles.includes('实验计划') && titles.some((t) => t.startsWith('总览')), titles.join(','));

// 4) attachment://<hash> 协议真取回 68 字节 PNG（渲染链靶心）
const img = await page.evaluate(async (h) => {
  const res = await fetch(`attachment://${h}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, len: buf.length, type: res.headers.get('content-type'), pngMark: buf[1] === 0x50 && buf[2] === 0x4e };
}, HASH);
check('attachment://hash → 200 PNG 字节', img.status === 200 && img.len === 68 && img.pngMark, JSON.stringify(img));

// 5) asset://<hash>.png 形态也可解析（导入器 preview 里 image 块的口径）
const img2 = await page.evaluate(async (h) => {
  const res = await fetch(`asset://${h}.png`);
  return { status: res.status, len: (await res.arrayBuffer()).byteLength };
}, HASH);
check('asset://hash.png → 200', img2.status === 200 && img2.len === 68, JSON.stringify(img2));

// 6) 幂等重跑：同目录重新 plan → skippedDuplicate 全命中
const plan2 = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('重跑 plan 全命中去重（skippedDuplicate≥2）', plan2.counts.skippedDuplicate >= 2, JSON.stringify(plan2.counts));
const exec2 = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan2.planId);
const titles2 = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  return (await window.septcats.pages.tree({ workspaceId: ws.activeId })).filter((n) => n.title === '实验计划').length;
});
check('重跑 execute 后「实验计划」仍唯一（0 重复页）', titles2 === 1, 'count=' + String(titles2) + ' exec2=' + JSON.stringify({ s: exec2.status, done: exec2.done, total: exec2.total }));

check('pageerror 为零', errors.length === 0, errors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T11 真机验收 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
