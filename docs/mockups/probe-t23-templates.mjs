/* T23-01 真机验收（数据面）：模板另存 → 从模板建页 → 深拷贝语义 → 源页不变 → 搜索隔离 → 重启仍在
 * 独立夹具根；不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t23-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t23-data';
const PORT = 9373;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t23';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (n, ok, d = '') => { results.push({ name: n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 200) : ''}`); };

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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
const ready = async () => {
  for (let k = 0; k < 25; k++) {
    if (await page.evaluate(() => typeof window.septcats?.templates?.list === 'function').catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
};
await ready();
const SRC = '源页T23';
const TPL = '模板T23';
const TEXTS = ['模板正文甲', '模板正文乙'];
const ulidish = (seed) => `01T23PROBE${String(seed).padStart(12, '0')}`;

// ① 源页 + 两个块
const pageId = await page.evaluate(async () => {
  const r = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: r.id, title: '源页T23' });
  return r.id;
}, null);
const srcBlockIds = [];
for (let i = 0; i < TEXTS.length; i++) {
  const bid = ulidish(i);
  srcBlockIds.push(bid);
  await page.evaluate(async (a) => window.septcats.blocks.commit({
    ops: [{
      op_id: a.opId, lamport: { c: 1, d: 't23probe' }, at: Date.now(), actor: 't23probe',
      target: { table: 'block', id: a.bid }, kind: 'upsert',
      payload: {
        page_id: a.pid, type: 'paragraph', props: {},
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: a.text }] }] },
        parent_id: null, sort_key: a.sortKey, alive: 1, last_edited: Date.now(),
      },
    }],
  }), { opId: ulidish(100 + i), bid, pid: pageId, text: TEXTS[i], sortKey: `A0000000${String(i)}` });
}
const srcBefore = await page.evaluate(async (id) => await window.septcats.blocks.list({ pageId: id }), pageId);
check('① 源页就位（2 个块已落库）', srcBefore.length === TEXTS.length && srcBlockIds.every((b) => srcBefore.some((x) => x.id === b)), `blocks=${srcBefore.length}`);

// ② 另存为模板
const tplId = await page.evaluate(async (a) => (await window.septcats.templates.saveFromPage({ pageId: a.pid, title: a.title })).id, { pid: pageId, title: TPL });
const list1 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
check('② 另存为模板：kind=page 且入列（meta 不含 payload）', list1.some((t) => t.id === tplId && t.kind === 'page' && t.title === TPL) && !('payload' in (list1.find((t) => t.id === tplId) ?? {})), `count=${list1.length} kind=${list1.find((t) => t.id === tplId)?.kind}`);

// ②b 隔离（严格）：此刻尚未从模板建页 → 模板标题在页面检索里必须零命中
await page.keyboard.press('Control+k');
const pin0 = page.locator('[data-testid="palette-panel"] input').first();
await pin0.waitFor({ state: 'visible', timeout: 5000 });
await pin0.type(TPL, { delay: 25 });
await new Promise((r) => setTimeout(r, 1500));
const hits0 = (await page.locator('.palette-list [role="option"]').allInnerTexts().catch(() => [])).filter((t) => !t.includes('在搜索结果页打开'));
check('②b 隔离：模板未实例化时，其标题零页面命中', !hits0.some((t) => t.includes(TPL)), `hits=${hits0.length} ${hits0.join(' | ').slice(0, 100)}`);
await page.screenshot({ path: SHOTS + '/isolation.png' });
await page.keyboard.press('Escape').catch(() => {});

// ③ 从模板建页：结构一致 + 全 id 全新
const newPageId = await page.evaluate(async (a) => (await window.septcats.templates.createPage({ templateId: a.tid, parentId: null })).pageId, { tid: tplId });
const newBlocks = await page.evaluate(async (id) => await window.septcats.blocks.list({ pageId: id }), newPageId);
const newIds = newBlocks.map((b) => b.id);
const textsOf = (bs) => bs.map((b) => JSON.stringify(b.content)).join('|');
check('③ 从模板建页：新页 id ≠ 源页 id', newPageId !== pageId, `new=${newPageId.slice(0, 8)}… src=${pageId.slice(0, 8)}…`);
check('③b 副本块 id 与源块全不重合', newIds.length === srcBlockIds.length && newIds.every((id) => !srcBlockIds.includes(id)), `new=${newIds.length} 源=${srcBlockIds.length}`);
check('③c 副本结构与内容一致', textsOf(newBlocks) === textsOf(srcBefore) && TEXTS.every((t) => textsOf(newBlocks).includes(t)), 'texts 一致');

// ④ 源页未被修改
const srcAfter = await page.evaluate(async (id) => await window.septcats.blocks.list({ pageId: id }), pageId);
check('④ 源页前后完全一致（另存/实例化未改动源）', JSON.stringify(srcAfter.map((b) => [b.id, JSON.stringify(b.content)])) === JSON.stringify(srcBefore.map((b) => [b.id, JSON.stringify(b.content)])), `源块=${srcAfter.length}`);

// ⑤ 实例化后：检索命中应恰为「新页」（继承模板标题），而非模板本身
await page.keyboard.press('Control+k');
const pin = page.locator('[data-testid="palette-panel"] input').first();
await pin.waitFor({ state: 'visible', timeout: 5000 });
await pin.type(TPL, { delay: 25 });
await new Promise((r) => setTimeout(r, 1500));
const hits = (await page.locator('.palette-list [role="option"]').allInnerTexts().catch(() => [])).filter((t) => !t.includes('在搜索结果页打开'));
check('⑤ 实例化后：命中恰为 1 条=新页（标题继承），模板本身从未入检索', hits.length === 1 && hits[0].includes(TPL), `hits=${hits.length} ${hits.join(' | ').slice(0, 100)}`);
await page.screenshot({ path: SHOTS + '/after-instantiate.png' });
await page.keyboard.press('Escape').catch(() => {});

// ⑥ 重启（reload）后模板仍在（跨进程持久化）
await page.reload();
await ready();
await new Promise((r) => setTimeout(r, 2500));
const list2 = await page.evaluate(async () => (await window.septcats.templates.list({})).templates);
check('⑥ 重启后模板仍在（账本持久化）', list2.some((t) => t.id === tplId && t.title === TPL), `count=${list2.length}`);

check('全程零 pageerror', errs.length === 0, `errors=${errs.length} ${errs[0] ?? ''}`.slice(0, 140));
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T23-01 真机（数据面）${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);