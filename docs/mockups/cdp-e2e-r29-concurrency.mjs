/* R29 并发压测真机探针（路5「竞态与时序 · 并发压测待排」收口）
 * 链：P0 双钉前置（包靶 + scratch ud/data + 真实根 mtime 快照）→
 *     P1 基线页数 → P2 并发创建 30 页（Promise.all 同刻入队）→
 *     P3 同页 20 并发提交（20 个不同块，各 1 op）= 无丢写 →
 *     P4 同块 10 并发覆盖（LWW 无撕裂：最终文本 ∈ 写入集合，且该块在 list 中唯一）→
 *     P5 FTS 并发批：40 并发 search.query 与 20 并发 blocks.commit 交错同刻 →
 *        全部 resolve（无 database is locked / E_* 错误）→
 *     P6 links.rebuild() 三连并发 + 20 并发查询 = 重建与读并发无异常 →
 *     P7 同一页 5 并发 remove = 幂等（只删一次，页数恰 -1，无 reject）→
 *     P8 5 页并发 remove → 并发 restore = 计数回位（无幽灵页）→
 *     P9 pageerror 未捕获异常 = 0 → P10 离线只读 PRAGMA integrity_check=ok →
 *     P11 真实根 C:\Users\Administrator\.septcats mtime 零触碰。
 * 靶子：默认打包产物 win-unpacked（交付物终验口径），SEPTCATS_APP_BIN 可切。
 * 桥面（读实现真契约，不发明）：pages.create/rename/tree/remove/restore、
 *     blocks.commit({ops})/list({pageId})、search.query({workspaceId,query,limit})、
 *     links.rebuild()、workspaces.list()。
 * 双钉纪律：--user-data-dir=<scratch ud> 且 ud/septcats.settings.json 的 rootPath→scratch data。
 * 断言 <10 = FATAL（静默蒸发守卫）。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 'r29-concurrency');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const DB = join(ROOT, 'septcats.db');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PORT = 9281;
const APP_BIN = process.env['SEPTCATS_APP_BIN'] ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const PACKAGED = APP_BIN.endsWith('Septcats.exe');
const ELECTRON = PACKAGED ? APP_BIN : join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const APP_ARGS = PACKAGED ? [] : ['.'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function realRootStamp() { try { return String(statSync(REAL_ROOT).mtimeMs); } catch { return '-1'; } }
function killStaleApp() {
  try {
    const out = execSync(`wmic process where "name='Septcats.exe' or name='electron.exe'" get processid,commandline /format:list`, { encoding: 'utf8' });
    let cur = '';
    for (const line of out.split('\n')) {
      if (line.startsWith('CommandLine=')) cur = line;
      else if (line.startsWith('ProcessId=')) {
        const m = line.match(/^ProcessId=(\d+)/);
        if (m !== null && cur.includes('r29-concurrency')) killTree(Number(m[1]));
        cur = '';
      }
    }
  } catch { /* wmic 缺失 */ }
}

const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }

/** 把 N 个 Promise 同刻入队（并发压测本意：不 await 逐个，全部先发再收）。 */
async function allSettled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r) => r.status === 'fulfilled').length,
    rejected: results.filter((r) => r.status === 'rejected'),
    values: results.map((r) => (r.status === 'fulfilled' ? r.value : null)),
  };
}

async function launch() {
  killStaleApp();
  await wait(800);
  const child = spawn(ELECTRON, [...APP_ARGS, `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 30000 });
  return { child, browser, page };
}
async function gracefulExit(page, child) {
  try { await page.evaluate(() => window.close()); } catch { /* */ }
  await wait(2500);
  killTree(child.pid);
  killStaleApp();
}

/** 离线只读完整性检查（python 标准库 sqlite3，零 ABI 依赖）。 */
function dbCheck() {
  const py = join(RUN, 'dbcheck.py');
  writeFileSync(py, [
    'import sqlite3,sys',
    'c=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro",uri=True)',
    'print("integrity="+str(c.execute("PRAGMA integrity_check").fetchone()[0]))',
    'print("pages="+str(c.execute("select count(*) from page").fetchone()[0]))',
    'print("blocks="+str(c.execute("select count(*) from block").fetchone()[0]))',
    'print("ops="+str(c.execute("select count(*) from op_ledger").fetchone()[0]))',
  ].join('\n'));
  try { return execSync(`python "${py}" "${DB}"`, { encoding: 'utf8' }).trim(); } catch (e) { return `ERR ${String(e).slice(0, 160)}`; }
}

async function main() {
  rmSync(UD, { recursive: true, force: true });
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  // 便携包产物校验器（python 标准库 zipfile：逐包 testzip + 条目数，判「无半成品/无截断」）
  writeFileSync(join(RUN, 'zipcheck.py'), [
    'import glob,os,sys,zipfile',
    'd=sys.argv[1]',
    'zips=[p for p in glob.glob(os.path.join(d,"**","*.zip"),recursive=True)]',
    'ok=True;entries=0',
    'for p in zips:',
    '    try:',
    '        z=zipfile.ZipFile(p)',
    '        if z.testzip() is not None or len(z.namelist())==0: ok=False',
    '        entries+=len(z.namelist())',
    '    except Exception:',
    '        ok=False',
    'print(f"zips={len(zips)} ok={str(ok).lower()} entries={entries}")',
  ].join('\n'));
  const stampBefore = realRootStamp();

  STEP = 'P0|前置';
  let st = null;
  check('P0-1 靶子在产（打包产物优先，SEPTCATS_APP_BIN 可切）', statSync(APP_BIN).isFile(), APP_BIN);

  const { child, browser, page } = await launch();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  try {
    st = await page.evaluate(async () => {
      const meta = await window.septcats.appMeta();
      const ws = await window.septcats.workspaces.list();
      return { version: meta?.version, wsId: ws?.activeId, wsCount: ws?.items?.length };
    });
    check('P0-2 应用自报版本 + 工作区就位', typeof st.version === 'string' && typeof st.wsId === 'string', JSON.stringify(st));

    const wsId = st.wsId;
    // 段落正文真相层 = ProseMirror doc JSON（blocks.ts blockContentOf 唯一实现：非 doc 一律回落空段落）
    const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
    // 存活页计数：`pages.tree` 含回收站条目（alive=0），计数口径必须按 alive 过滤
    const treeCount = () => page.evaluate(async (w) => (await window.septcats.pages.tree({ workspaceId: w })).filter((n) => n.alive !== 0).length, wsId);
    const mkPage = (title) => page.evaluate(async (t) => { const c = await window.septcats.pages.create({ parentId: null }); await window.septcats.pages.rename({ id: c.id, title: t }); return c.id; }, title);

    STEP = 'P1|基线';
    const n0 = await treeCount();
    check('P1-1 基线页树读取正常', Number.isInteger(n0), `pages=${String(n0)}`);

    STEP = 'P2|并发创建 30';
    const TS = Date.now().toString(36);
    const created = await allSettled(Array.from({ length: 30 }, (_v, i) => mkPage(`R29并发${TS}-${String(i)}`)));
    const ids = created.values.filter((v) => typeof v === 'string');
    check('P2-1 30 并发创建全部成功（0 reject）', created.ok === 30 && created.rejected.length === 0, `ok=${String(created.ok)} rej=${String(created.rejected.length)}`);
    check('P2-2 30 个 id 全唯一（无撞号复用）', new Set(ids).size === 30, `unique=${String(new Set(ids).size)}`);
    const n2 = await treeCount();
    check('P2-3 页树计数精确 +30', n2 === n0 + 30, `${String(n0)} → ${String(n2)}`);

    STEP = 'P3|同页 20 并发提交';
    const host = ids[0];
    const blk = (i, text) => ({ op_id: `r29c${TS}${String(i)}`, lamport: { c: i + 1, d: 'r29aaaa' }, at: Date.now(), actor: 'r29aaaa', target: { table: 'block', id: `r29blk${TS}${String(i)}` }, kind: 'upsert', payload: { page_id: host, type: 'paragraph', props: {}, content: docOf(`并发块${String(i)} ${text}`), parent_id: null, sort_key: `A${String(i).padStart(8, '0')}`, alive: 1 } });
    const commits = await allSettled(Array.from({ length: 20 }, (_v, i) => page.evaluate((op) => window.septcats.blocks.commit({ ops: [op] }), blk(i, 'alpha'))));
    const listed = await page.evaluate(async (p) => (await window.septcats.blocks.list({ pageId: p })).blocks.length, host);
    check('P3-1 20 并发提交全部 resolve（0 reject）', commits.ok === 20 && commits.rejected.length === 0, `ok=${String(commits.ok)} rej=${String(commits.rejected.length)} ${commits.rejected[0]?.reason ?? ''}`);
    check('P3-2 无丢写：该页存活块恰 20', listed === 20, `blocks=${String(listed)}`);

    STEP = 'P4|同块 10 并发覆盖';
    const dupId = `r29dup${TS}`;
    const overwrite = (i) => ({ op_id: `r29d${TS}${String(i)}`, lamport: { c: 100 + i, d: 'r29aaaa' }, at: Date.now(), actor: 'r29aaaa', target: { table: 'block', id: dupId }, kind: 'upsert', payload: { page_id: host, type: 'paragraph', props: {}, content: docOf(`覆盖值-${String(i)}`), parent_id: null, sort_key: 'Z00000000', alive: 1 } });
    const ov = await allSettled(Array.from({ length: 10 }, (_v, i) => page.evaluate((op) => window.septcats.blocks.commit({ ops: [op] }), overwrite(i))));
    const after = await page.evaluate(async (a) => {
      const res = await window.septcats.blocks.list({ pageId: a.p });
      return res.blocks.filter((b) => b.id === a.d).map((b) => JSON.stringify(b.content));
    }, { p: host, d: dupId });
    const legal = after.every((t) => /覆盖值-\d+/.test(t));
    check('P4-1 10 并发同块覆盖 0 reject', ov.ok === 10 && ov.rejected.length === 0, `ok=${String(ov.ok)}`);
    check('P4-2 无撕裂：list 中该块唯一且文本是写入集合之一', after.length === 1 && legal, `count=${String(after.length)} content=${after.join(',').slice(0, 120)}`);

    STEP = 'P5|FTS 与写并发交错';
    const q = (i) => page.evaluate((a) => window.septcats.search.query({ workspaceId: a.w, query: a.k, limit: 20 }), { w: wsId, k: i % 2 === 0 ? '并发' : 'R29' });
    const writes = Array.from({ length: 20 }, (_v, i) => page.evaluate((op) => window.septcats.blocks.commit({ ops: [op] }), blk(100 + i, 'burst')));
    const reads = Array.from({ length: 40 }, (_v, i) => q(i));
    const mixed = await allSettled([...writes, ...reads]);
    const errText = mixed.rejected.map((r) => String(r.reason)).join(' | ');
    check('P5-1 60 路读写交错全部 resolve（无 database is locked）', mixed.rejected.length === 0 && !/locked/i.test(errText), `rej=${String(mixed.rejected.length)} ${errText.slice(0, 160)}`);
    const hitsShape = mixed.values.slice(20).every((v) => v !== null && Array.isArray(v.hits));
    check('P5-2 40 次查询返回结构合法（hits 数组）', hitsShape, `sample=${JSON.stringify(mixed.values[20] ?? null).slice(0, 120)}`);

    STEP = 'P6|重建与读并发';
    const rebuild = await allSettled([0, 1, 2].map(() => page.evaluate(() => window.septcats.links.rebuild())));
    const r2 = await allSettled(Array.from({ length: 20 }, (_v, i) => q(i)));
    check('P6-1 links.rebuild 三连并发无异常', rebuild.rejected.length === 0, `rej=${String(rebuild.rejected.length)} ${String(rebuild.rejected[0]?.reason ?? '')}`);
    check('P6-2 重建后 20 并发查询全绿', r2.ok === 20 && r2.rejected.length === 0, `ok=${String(r2.ok)}`);

    STEP = 'P7|快速连点删除（幂等）';
    const victim = ids[1];
    const before = await treeCount();
    const del = await allSettled(Array.from({ length: 5 }, () => page.evaluate((id) => window.septcats.pages.remove({ id }), victim)));
    const after7 = await treeCount();
    check('P7-1 同页 5 并发删除 0 reject（连点不炸）', del.rejected.length === 0, `rej=${String(del.rejected.length)} ${String(del.rejected[0]?.reason ?? '')}`);
    check('P7-2 幂等：页数恰 -1（未重复扣减）', after7 === before - 1, `${String(before)} → ${String(after7)}`);

    STEP = 'P8|并发删 + 并发恢复';
    const five = ids.slice(2, 7);
    const before8 = await treeCount(); // 独立取样：P7 已删过一页，不能沿用 P7 的 before
    const dels = await allSettled(five.map((id) => page.evaluate((x) => window.septcats.pages.remove({ id: x }), id)));
    const mid = await treeCount();
    const rest = await allSettled(five.map((id) => page.evaluate((x) => window.septcats.pages.restore({ id: x }), id)));
    const fin = await treeCount();
    check('P8-1 5 并发删除 → 5 并发恢复 全 resolve', dels.rejected.length === 0 && rest.rejected.length === 0, `delRej=${String(dels.rejected.length)} restRej=${String(rest.rejected.length)}`);
    check('P8-2 无幽灵页：中间态 -5、恢复后回位', mid === before8 - 5 && fin === before8, `${String(before8)} → ${String(mid)} → ${String(fin)}`);

    STEP = 'P12|并发移动（同页多目标）';
    const mover = ids[7];
    const pa = ids[8];
    const pb = ids[9];
    const pc = ids[10];
    const before12 = await treeCount();
    const mv = await allSettled(Array.from({ length: 6 }, (_v, i) =>
      page.evaluate((a) => window.septcats.pages.move({ id: a.id, newParentId: [a.pa, a.pb, a.pc][a.i % 3] }), { id: mover, pa, pb, pc, i })));
    const placed = await page.evaluate(async (a) => {
      const tree = await window.septcats.pages.tree({ workspaceId: a.w });
      const node = tree.find((n) => n.id === a.id);
      return node === undefined ? null : { parentId: node.parentId ?? node.parent_id ?? null, count: tree.filter((n) => n.alive !== 0).length };
    }, { w: wsId, id: mover, i: 0 });
    check('P12-1 同页 6 并发移动 0 reject（连点不炸）', mv.rejected.length === 0, `rej=${String(mv.rejected.length)} ${String(mv.rejected[0]?.reason ?? '')}`);
    check('P12-2 无孤儿/无双父：落点 ∈ 目标集合且存活计数不变', [pa, pb, pc].includes(placed?.parentId) && placed?.count === before12, `parent=${String(placed?.parentId)} count=${String(before12)}→${String(placed?.count)}`);

    STEP = 'P13|并发重命名';
    const nm = await allSettled(Array.from({ length: 10 }, (_v, i) =>
      page.evaluate((a) => window.septcats.pages.rename({ id: a.id, title: `R29改名-${String(a.i)}` }), { id: mover, i })));
    const titleNow = await page.evaluate(async (a) => {
      const tree = await window.septcats.pages.tree({ workspaceId: a.w });
      return tree.find((n) => n.id === a.id)?.title ?? null;
    }, { w: wsId, id: mover });
    check('P13-1 10 并发重命名 0 reject 且终态标题 ∈ 写入集合', nm.rejected.length === 0 && /^R29改名-\d+$/.test(String(titleNow)), `rej=${String(nm.rejected.length)} title=${String(titleNow)}`);

    STEP = 'P14|并发类型转换';
    const conv = await allSettled(Array.from({ length: 6 }, (_v, i) =>
      page.evaluate((a) => window.septcats.pages.convert({ pageId: a.id, to: ['folder', 'page', 'wiki'][a.i % 3] }), { id: ids[11], i })));
    const typeNow = await page.evaluate(async (a) => {
      const tree = await window.septcats.pages.tree({ workspaceId: a.w });
      return tree.find((n) => n.id === a.id)?.pageType ?? null;
    }, { w: wsId, id: ids[11] });
    check('P14-1 6 并发转换 0 reject 且终态类型合法（folder/page/wiki）', conv.rejected.length === 0 && ['folder', 'page', 'wiki'].includes(String(typeNow)), `rej=${String(conv.rejected.length)} ${String(conv.rejected[0]?.reason ?? '')} type=${String(typeNow)}`);

    STEP = 'P15|并发便携导出（同目录原子写）';
    const OUT = join(RUN, 'export');
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
    const pe = await allSettled([0, 1, 2].map(() => page.evaluate((d) => window.septcats.portable.confirm({ dir: d }), OUT)));
    check('P15-1 同目录 3 并发导出 0 reject（原子写 tmp→rename）', pe.rejected.length === 0, `rej=${String(pe.rejected.length)} ${String(pe.rejected[0]?.reason ?? '')}`);
    const zipOut = execSync(`python "${join(RUN, 'zipcheck.py')}" "${OUT}"`, { encoding: 'utf8' }).trim();
    check('P15-2 产物 zip 完整可解（无半成品/无截断）', /^zips=\d+ ok=true/.test(zipOut) && !/ok=false/.test(zipOut), zipOut);

    STEP = 'P16|并发页面导出预览（只读零写）';
    const pv = await allSettled(Array.from({ length: 5 }, () =>
      page.evaluate((a) => window.septcats.pageExport.preview({ pageId: a.id, scope: 'single' }), { id: ids[12] })));
    const pvOk = pv.values.every((v) => v !== null && typeof v === 'object');
    check('P16-1 5 并发 pageExport.preview 0 reject 且结构合法', pv.rejected.length === 0 && pvOk, `rej=${String(pv.rejected.length)} ${String(pv.rejected[0]?.reason ?? '')}`);

    STEP = 'P9|未捕获异常';
    check('P9-1 全程 pageerror = 0（无未捕获 JS 异常）', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || `consoleErrors=${String(consoleErrors.length)}`);
  } finally {
    STEP = 'P10|收尾';
    await gracefulExit(page, child);
  }

  const dbOut = dbCheck();
  check('P10-1 离线只读 PRAGMA integrity_check=ok', /integrity=ok/.test(dbOut), dbOut.replace(/\s+/g, ' '));

  STEP = 'P11|隔离';
  check('P11-1 真实数据根零触碰（mtime 不变）', stampBefore === realRootStamp(), `before=${stampBefore} after=${realRootStamp()}`);

  const pass = assertions.filter((x) => x.ok).length;
  const fail = assertions.filter((x) => !x.ok).length;
  writeFileSync(join(RUN, 'r29-concurrency-results.json'), JSON.stringify({ task: 'r29-concurrency', ranAt: new Date().toISOString(), target: APP_BIN, dbCheck: dbOut, consoleErrors: consoleErrors.slice(0, 20), assertions }, null, 2));
  console.log(`\n===== R29 并发压测：${String(pass)} PASS / ${String(fail)} FAIL =====`);
  if (assertions.length < 10) console.log(`FATAL 断言条数 ${String(assertions.length)} < 10`);
  process.exitCode = fail === 0 && assertions.length >= 10 ? 0 : 1;
  try { await browser.close(); } catch { /* */ }
}
void main().catch((e) => { console.log('EXC', String(e)); process.exitCode = 1; });