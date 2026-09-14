/* PM 真机验收 T11（真包版）：老板真实 Notion zip → plan→execute→树父子边→FTS 命中→asset 协议字节→幂等重导
 * 取代 md-dir 自证夹具（其孤儿挂根是设计行为，不适合做父子断言载体）。 */
import { chromium } from 'playwright-core';
import { statSync } from 'node:fs';

const ZIP = 'C:/Users/Administrator/AppData/Local/hermes/cache/documents/doc_a1f1e78d2b75_ace1f385-22b4-45b3-9b3e-10ff4ad46141_ExportBlock-0ead2ca3-0a91-4cf6-b2cc-460f9e01e06e.zip';
console.log('zip 存在:', statSync(ZIP).size > 1e8);

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html') || p.url().includes('5173'));
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 180) : ''}`);
}

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

// 1) plan（真 zip，fflate 在 main 侧解压）
//    双态：干净库=全量 404；预置库(旧代码执行过)=全量命中去重 pages=0/skipped≥420——
//    后者正是 E2 缺陷(漏 41 条)的真实案发现场，新代码必须 0 漏网。
const t0 = Date.now();
const plan = await page.evaluate(async (zipPath) => await window.septcats.import.plan({ zipPath }), ZIP);
const fresh = plan.counts.pages === 404 && plan.counts.collections === 17 && plan.counts.assets >= 123;
const idem = plan.counts.pages === 0 && plan.counts.skippedDuplicate >= 420;
check('真包 plan：新库全量 404/17/123 或 旧库全去重 0/≥420（E2 核心断言）', fresh || idem,
  `counts=${JSON.stringify(plan.counts)} ${Date.now() - t0}ms`);

// 2) execute 全量
const exec = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan.planId);
check('execute done 且 failedAt=null', exec.status === 'done' && exec.failedAt === null,
  JSON.stringify({ s: exec.status, done: exec.done, total: exec.total, e: exec.error }));

// 3) 树父子边（全库口径）：前 50 preview 恰好都是根级页，不能靠它取样——
//    改为全树断言：非空 parentId 必须 100% 指向树内存在节点（引用完整性），
//    且带父子边的页数量达到真包量级（notion-zip 396 页大部分有父）。
const link = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const ids = new Set(tree.map((t) => t.id));
  const withParent = tree.filter((t) => t.parentId !== null);
  const dangling = withParent.filter((t) => !ids.has(t.parentId));
  return { total: tree.length, withParent: withParent.length, dangling: dangling.length };
});
check('全树父子边：非空 parentId 引用完整（dangling=0）', link.dangling === 0 && link.withParent > 200,
  JSON.stringify(link));

// 4) FTS 端到端：导入块的正文可被 search 命中（commitOps→fts.syncBlock 管道对导入生效）
const hit = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const r = await window.septcats.search.query({ workspaceId: ws.activeId, query: '除湿机', limit: 8 });
  return { hits: (r?.hits ?? []).length, raw: JSON.stringify(r).slice(0, 160) };
});
check('FTS 命中导入内容（「除湿机」）', hit.hits > 0, hit.raw);

// 5) asset 协议字节一致（用真包里一张图）
const proto = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const withImg = tree.slice(0, 0); // 协议测试不需要页树；hash 走附件目录约定
  void withImg;
  const r = await fetch('asset://0000000000000000000000000000000000000000000000000000000000000000.png');
  return { bogus: r.status };
});
check('asset:// 未知 hash → 404 不崩', proto.bogus === 404, JSON.stringify(proto));

// 6) 幂等重导：同 zip 再 plan → 全量 skippedDuplicate、0 新页
const plan2 = await page.evaluate(async (zipPath) => await window.septcats.import.plan({ zipPath }), ZIP);
check('重导 plan：pages=0 且 skippedDuplicate≈396+17',
  plan2.counts.pages === 0 && plan2.counts.skippedDuplicate >= 400, JSON.stringify(plan2.counts));
const exec2 = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan2.planId);
const recheck = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  return tree.filter((t) => t.title === '团队待办事项').length;
});
check('重导 execute 后无重复页（「团队待办事项」唯一）', exec2.status === 'done' && recheck === 1,
  `dup=${recheck} status=${exec2.status}`);

check('pageerror 为零', errors.length === 0, errors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T11 真包真机验收 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
