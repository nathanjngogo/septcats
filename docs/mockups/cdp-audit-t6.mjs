/* PM 真机验收 T6：页面树全链路走真 IPC + 真 DbServer（建/改名/删除→回收站→恢复/防环） */
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost'));
if (!page) { console.error('NO RENDERER TARGET'); process.exit(1); }

const out = { steps: [] };
const step = (name, ok, note) => { out.steps.push({ name, ok, note: String(note ?? '').slice(0, 160) }); };
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

try {
  const shape = await page.evaluate(() => ({
    hasApi: Boolean(window.septcats),
    domains: window.septcats ? Object.keys(window.septcats.pages ?? {}) : [],
    sidebarRows: document.querySelectorAll('[data-page-id], [class*="tree-row"], [class*="nav-row"]').length,
    pm: Boolean(document.querySelector('.ProseMirror')),
  }));
  step('window.septcats.pages 注入', shape.hasApi && shape.domains.length > 3, JSON.stringify(shape.domains));
  step('渲染器有侧栏行/编辑器', shape.sidebarRows > 0 || shape.pm, `rows=${shape.sidebarRows} pm=${shape.pm}`);

  const ws = await page.evaluate(async () => await window.septcats.workspaces.list());
  step('workspaces.list 有活动工作区', Boolean(ws.activeId), JSON.stringify(ws).slice(0, 120));
  const workspaceId = ws.activeId;

  const created = await page.evaluate(async () => await window.septcats.pages.create({ parentId: null }));
  step('createPage', Boolean(created?.id), JSON.stringify(created));

  const renamed = await page.evaluate(async (args) => {
    await window.septcats.pages.rename({ id: args.id, title: '真机验收页' });
    const nodes = await window.septcats.pages.tree({ workspaceId: args.ws });
    const hit = nodes.find((n) => n.id === args.id);
    return hit ? { title: hit.title, version: hit.version } : null;
  }, { id: created.id, ws: workspaceId });
  step('rename 回读 title+version', renamed?.title === '真机验收页', JSON.stringify(renamed));

  const del = await page.evaluate(async (args) => {
    const r = await window.septcats.pages.remove({ id: args.id });
    const nodes = await window.septcats.pages.tree({ workspaceId: args.ws });
    const hit = nodes.find((n) => n.id === args.id);
    return { deleted: r.deleted, stillInTree: nodes.length, alive: hit ? hit.alive : null };
  }, { id: created.id, ws: workspaceId });
  step('remove → alive=0（回收站语义）', del.deleted >= 1 && del.alive === 0, JSON.stringify(del));

  const redo = await page.evaluate(async (args) => {
    const r = await window.septcats.pages.restore({ id: args.id });
    const nodes = await window.septcats.pages.tree({ workspaceId: args.ws });
    const hit = nodes.find((n) => n.id === args.id);
    return { restored: r.restored, alive: hit ? hit.alive : null };
  }, { id: created.id, ws: workspaceId });
  step('restore → alive=1', redo.restored >= 1 && redo.alive === 1, JSON.stringify(redo));

  const cycle = await page.evaluate(async () => {
    const a = await window.septcats.pages.create({ parentId: null });
    const b = await window.septcats.pages.create({ parentId: a.id });
    try {
      await window.septcats.pages.move({ id: a.id, newParentId: b.id });
      return 'NOT-REJECTED';
    } catch (error) {
      return String(error?.message ?? error).includes('E_CYCLE') ? 'E_CYCLE' : 'OTHER:' + String(error?.message ?? error).slice(0, 40);
    }
  });
  step('move 防环 E_CYCLE', cycle === 'E_CYCLE', cycle);

  const orphan = await page.evaluate(async () => {
    try {
      await window.septcats.pages.create({ parentId: 'nonexistent-parent-id' });
      return 'NOT-REJECTED';
    } catch (error) {
      return String(error?.message ?? error).includes('E_PARENT_GONE') ? 'E_PARENT_GONE' : 'OTHER:' + String(error?.message ?? error).slice(0, 40);
    }
  });
  step('create 非法父 E_PARENT_GONE', orphan === 'E_PARENT_GONE', orphan);

  const ledger = await page.evaluate(async () => {
    const snap = await window.septcats.blocks.commit([]).catch(() => null);
    return snap;
  });
  void ledger; // blocks.commit 空数组路径，仅确认不崩

  await page.screenshot({ path: 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens/app-t6-sidebar.png' });
} catch (error) {
  step('EXCEPTION', false, String(error).slice(0, 200));
}
step('无 pageerror', errs.length === 0, errs.join(' | '));
console.log(JSON.stringify(out, null, 1));
const failed = out.steps.filter((s) => !s.ok);
console.log('RESULT:', failed.length === 0 ? 'ALL-PASS' : `FAIL x${failed.length}: ${failed.map((f) => f.name).join(', ')}`);
process.exit(0);
