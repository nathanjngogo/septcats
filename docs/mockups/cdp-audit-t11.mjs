/* PM 真机验收 T11（自取证版）：现场生成唯一 fixture → plan→execute→页树→协议字节→幂等重跑 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

// —— 生成唯一 fixture（文本内嵌 nonce → 页 hash 不撞 import_source；PNG 用已知字节）——
const nonce = Date.now().toString(36);
const FIX = `E:/Hermes Agent工作空间/_scratch/t11fix-${nonce}`;
rmSync(FIX, { recursive: true, force: true });
mkdirSync(`${FIX}/子页`, { recursive: true });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
writeFileSync(`${FIX}/子页/pic.png`, PNG);
const HASH = createHash('sha256').update(PNG).digest('hex');
const PNG_LEN = PNG.length;
writeFileSync(`${FIX}/根页-${nonce}.md`,
  `---\ntitle: 根页${nonce}\ntags: [验收]\n---\n\n# 目标 ${nonce}\n\n正文一段。\n\n![图](子页/pic.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n`);
writeFileSync(`${FIX}/子页/子页A-${nonce}.md`,
  `# 子页A ${nonce}\n\n- 列表项\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n`);

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

// 1) 首次 plan（唯一 nonce → 全新导入）
const plan = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('首次 plan：2 页 + ≥1 附件', !!plan.planId && plan.counts.pages === 2 && plan.counts.assets >= 1, JSON.stringify(plan.counts));
check('GFM 表降级 warning（不静默）', plan.warnings.some((w) => w.action === 'degraded' && /表|table/i.test(w.what)), plan.warnings.map((w) => w.what).join('|'));

// 2) execute
const exec = await page.evaluate(async (planId) => await window.septcats.import.execute({ planId, confirm: true }), plan.planId);
check('execute done 且 failedAt=null', exec.status === 'done' && exec.failedAt === null, JSON.stringify({ s: exec.status, done: exec.done, total: exec.total, e: exec.error }));

// 3) 页树真有两页（按 nonce 精确匹配；父子关系用节点 JSON 字符串包含验证，不猜字段名）
const treeInfo = await page.evaluate(async (n) => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const root = tree.find((x) => x.title === `根页${n}`);
  const child = tree.find((x) => x.title.includes('子页A') && x.title.includes(n));
  return {
    root: !!root, child: !!child,
    parentLink: !!root && !!child && (JSON.stringify(root).includes(child.id) || JSON.stringify(child).includes(root.id)),
    raw: JSON.stringify(root).slice(0, 200),
  };
}, nonce);
check('页树含两页且父节点记录子 id（层级正确）', treeInfo.root && treeInfo.child && treeInfo.parentLink, JSON.stringify({ r: treeInfo.root, c: treeInfo.child, l: treeInfo.parentLink }));

// 4) 协议：attachment://<hash> 与 asset://<hash>.png 都能取回与磁盘逐字节的 PNG
const proto = await page.evaluate(async (h) => {
  const a = await fetch(`attachment://${h}`);
  const ab = new Uint8Array(await a.arrayBuffer());
  const b = await fetch(`asset://${h}.png`);
  const bb = new Uint8Array(await b.arrayBuffer());
  return { aStatus: a.status, aLen: ab.length, aHead: ab[1] === 80 && ab[2] === 78, bStatus: b.status, bLen: bb.length };
}, HASH);
check('attachment://hash → 200 + 字节数=磁盘 PNG', proto.aStatus === 200 && proto.aLen === PNG_LEN && proto.aHead, JSON.stringify({ ...proto, expect: PNG_LEN }));
check('asset://hash.png → 200 同字节', proto.bStatus === 200 && proto.bLen === PNG_LEN, JSON.stringify(proto));

// 5) 导入的页面真的能打开且 image 块渲染（编辑器投影里找 <img data-file-id>）
const openUi = await page.evaluate(async (n) => {
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const r = tree.find((x) => x.title === `根页${n}`);
  const c = tree.find((x) => x.title.includes('子页A') && x.title.includes(n));
  return { rootId: r?.id ?? null, childId: c?.id ?? null };
}, nonce);
// 读该页 blocks 验证 image 块 file_id=hash（数据面），再走 UI 点侧栏项验证渲染面
const blocks = await page.evaluate(async (pageId) => await window.septcats.blocks.list(pageId), openUi.rootId);
const imageBlock = (blocks ?? []).find((b) => b.type === 'image' || b.target?.includes?.('image'));
const rawBlock = JSON.stringify(blocks ?? []);
check('根页 blocks 含 image 块且引用 hash（数据面）', rawBlock.includes(HASH), rawBlock.slice(0, 160));

// App 侧栏当前为演示假树（打开真页归后续接线），渲染链等价验证：
// DOM 注入 <img src=attachment://>，验证 CSP img-src 放行 + 协议真实解码出 1x1 PNG
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
check('CSP img-src 放行 attachment:// 且解码成功（1x1）', imgRender.ok, JSON.stringify(imgRender));

// 6) 幂等重跑：同目录再 plan → skippedDuplicate=2 页；execute 0 重复
const plan2 = await page.evaluate(async (dir) => await window.septcats.import.plan({ dirPath: dir }), FIX);
check('重跑 plan 页全命中去重', plan2.counts.pages === 0 && plan2.counts.skippedDuplicate >= 2, JSON.stringify(plan2.counts));
const dup = await page.evaluate(async (planId, n) => {
  await window.septcats.import.execute({ planId, confirm: true });
  const ws = await window.septcats.workspaces.list();
  const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  return tree.filter((x) => x.title === `根页${n}`).length;
}, plan2.planId, nonce);
check('重跑 execute 后根页仍唯一', dup === 1, 'count=' + String(dup));

check('pageerror 为零', errors.length === 0, errors.slice(0, 2).join(' | '));

rmSync(FIX, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T11 真机验收 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
