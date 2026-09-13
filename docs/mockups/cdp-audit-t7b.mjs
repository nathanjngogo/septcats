/* PM 真机验收 T7b：转为数据库 → DbView 渲染 → 真 IPC 建记录/改值（含 relation 双写落库） */
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

// 复位 UI 状态（dbPageId 是本地 state，reload 回编辑器首页），保证按钮可见性可断言
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// 1) preload 桥注入
const hasDb = await page.evaluate(() => typeof window.septcats?.db?.create === 'function'
  && typeof window.septcats?.db?.load === 'function'
  && typeof window.septcats?.db?.recordCreate === 'function');
check('septcats.db 桥注入（12 通道抽查 3）', hasDb);

// 2) UI：顶栏「转为数据库」存在
const convertBtn = page.locator('button', { hasText: '转为数据库' }).first();
const btnVisible = await convertBtn.isVisible().catch(() => false);
check('PageView 顶栏「转为数据库」按钮可见', btnVisible);

// 3) 点击 → DbPage 挂载 → 空态或表头出现（新库 0 记录 → EmptyState）
if (btnVisible) {
  await convertBtn.click();
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const empty = document.querySelector('.sc-empty');
    const grid = document.querySelector('.sc-dbgrid');
    const err = document.querySelector('.sc-error, .sc-errorpanel, [class*=error]');
    return {
      empty: empty ? (empty.textContent ?? '').slice(0, 60) : null,
      grid: !!grid,
      err: err ? (err.textContent ?? '').slice(0, 80) : null,
    };
  });
  check('点击后 DbView 挂载（empty 或 grid 二选一）', state.empty !== null || state.grid, JSON.stringify(state));
}

// 4) 纯 IPC 全链路（不依赖 UI 状态）：db:create → recordCreate → update → relation 双写 → countTargets 拒删 → delete → exportCsv
const ipc = await page.evaluate(async () => {
  const db = window.septcats.db;
  const ws = await window.septcats.workspaces.list();
  const wid = ws.activeId;
  const out = { steps: [] };
  try {
    const created = await db.create({ workspaceId: wid, parentPageId: null, title: '审计库·' + Date.now() });
    out.steps.push(['create', created.pageId ? true : false, created.collectionId]);
    let { collection } = await db.load({ pageId: created.pageId });
    const titlePid = collection.schema.title_pid;
    const a = await db.recordCreate({ pageId: created.pageId, values: { [titlePid]: '甲' } });
    const b = await db.recordCreate({ pageId: created.pageId, values: { [titlePid]: '乙' } });
    out.steps.push(['recordCreate×2', !!(a.record?.id && b.record?.id), '']);
    const upd = await db.recordUpdate({ pageId: created.pageId, recordId: a.record.id, patch: { [titlePid]: '甲改' } });
    out.steps.push(['update', upd.record.values[titlePid] === '甲改', String(upd.record.values[titlePid])]);
    // relation 列：addProperty relation → 双写
    const withRel = await db.propAdd({ pageId: created.pageId, type: 'relation' });
    const relPid = Object.keys(withRel.collection.schema.properties).find(
      (pid) => withRel.collection.schema.properties[pid].type === 'relation');
    await db.recordUpdate({ pageId: created.pageId, recordId: a.record.id, patch: { [relPid]: [b.record.id] } });
    const after = await db.load({ pageId: created.pageId });
    const recB = after.records.find((r) => r.id === b.record.id);
    out.steps.push(['relation 双写→b 的 backlinks 含 a', !!recB?.backlinks?.[collection.id]?.includes(a.record.id), JSON.stringify(recB?.backlinks ?? {})]);
    // 拒删被引用记录
    let refused = false;
    try { await db.recordDelete({ pageId: created.pageId, ids: [b.record.id] }); } catch (e) { refused = String(e?.message ?? e).includes('E_REFERRED'); }
    out.steps.push(['countTargets>0 拒删 E_REFERRED', refused, '']);
    // 解除引用后删除成功
    await db.recordUpdate({ pageId: created.pageId, recordId: a.record.id, patch: { [relPid]: [] } });
    await db.recordDelete({ pageId: created.pageId, ids: [b.record.id] });
    const afterDel = await db.load({ pageId: created.pageId });
    out.steps.push(['解除后删除→load 不含 b', !afterDel.records.some((r) => r.id === b.record.id), '']);
    const csv = await db.exportCsv({ pageId: created.pageId });
    out.steps.push(['exportCsv 含 BOM+甲改', csv.csv.includes('甲改') && csv.csv.charCodeAt(0) === 0xfeff, csv.csv.slice(0, 40)]);
  } catch (e) {
    out.fatal = String(e?.message ?? e);
  }
  return out;
});

for (const [name, ok, detail] of ipc.steps ?? []) check('IPC ' + name, ok, String(detail));
if (ipc.fatal) check('IPC 全链路（无致命错）', false, ipc.fatal.slice(0, 200));

check('pageerror 为零', errors.length === 0, errors.slice(0, 2).join(' | '));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T7b 真机验收 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
await browser.close();
process.exit(failed === 0 ? 0 : 1);
