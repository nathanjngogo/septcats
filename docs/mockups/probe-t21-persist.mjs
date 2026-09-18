/* T21-01 真机验收：编辑器持久化数据面（blocks:commit → blocks:list），含跨进程重启与 FTS 链
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t21-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t21-data';
const PORT = 9361;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 200) : ''}`); };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light' }), 'utf8');

async function boot() {
  const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
  p.unref();
  let br = null;
  for (let k = 0; k < 25 && br === null; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
  }
  const page = br.contexts()[0].pages()[0];
  for (let k = 0; k < 25; k++) {
    if (await page.evaluate(() => typeof window.septcats?.blocks?.commit === 'function').catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  return { br, page };
}
const TEXT = '持久化靶文T21';
const PAYLOAD = (pageId, blockId) => ({
  page_id: pageId, type: 'paragraph', props: {},
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }] },
  parent_id: null, sort_key: 'A00000000', alive: 1, last_edited: Date.now(),
});

// —— 首次启动：建页 + 提交 + 读回 ——
const { br: br1, page: p1 } = await boot();
const created = await p1.evaluate(async (text) => {
  const pg = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: pg.id, title: 'T21 持久化靶页' });
  const blockId = pg.id.slice(0, 20) + 'BK0001';
  const opId = pg.id.slice(0, 20) + 'OP0001';
  const op = {
    op_id: opId, lamport: { c: 1, d: 't21probe01' }, at: Date.now(), actor: 't21probe01',
    target: { table: 'block', id: blockId }, kind: 'upsert',
    payload: { page_id: pg.id, type: 'paragraph', props: {}, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, parent_id: null, sort_key: 'A00000000', alive: 1, last_edited: Date.now() },
  };
  await window.septcats.blocks.commit({ ops: [op] });
  const list = await window.septcats.blocks.list({ pageId: pg.id });
  return { pageId: pg.id, blockId, count: list.length, text: JSON.stringify(list[0]?.content ?? null).includes(text) };
}, TEXT);
check('建页 + blocks:commit 成功', created.count === 1, JSON.stringify(created).slice(0, 140));
check('blocks:list 读回内容含提交文本', created.text === true, `count=${created.count}`);
await br1.close().catch(() => {});
killAll();

// —— 二次启动（跨进程）：内容仍在 + FTS 链 ——
await new Promise((r) => setTimeout(r, 1500));
const { br: br2, page: p2 } = await boot();
const after = await p2.evaluate(async (pageId) => {
  const list = await window.septcats.blocks.list({ pageId });
  const ws = await window.septcats.workspaces.list();
  const search = await window.septcats.search.query({ workspaceId: ws.activeId, query: '持久化靶页', limit: 10 });
  return { count: list.length, text: JSON.stringify(list[0]?.content ?? null).includes('持久化靶文T21'), searchHits: search.hits.map((h) => h.title) };
}, created.pageId);
check('重启后 blocks:list 仍返回内容（真落库）', after.count === 1 && after.text === true, `count=${after.count} text=${String(after.text)}`);
check('FTS/搜索链命中该页（端到端一致）', after.searchHits.includes('T21 持久化靶页'), after.searchHits.join(','));
const errs = [];
p2.on('pageerror', (e) => errs.push(String(e)));
check('二次启动零 pageerror', errs.length === 0, `errors=${errs.length}`);
await br2.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T21-01 真机持久化 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);