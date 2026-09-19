/* TASK-T44-01 §2.5 旧库兼容（PM 独立复跑）：用**老板真实库副本**开 rc.19
   验证：v7 → v8 迁移成功、存量页全部 page_type='page'、无 E_SCHEMA、界面正常、
        真实库本体零改动（mtime 不变）。
   双隔离：--user-data-dir 与 rootPath 全在 _scratch 下；真实库只做只读拷贝。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APPDIR = 'E:\\Hermes Agent工作空间\\Septcats\\apps\\desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_DB = 'C:\\Users\\Administrator\\.septcats\\septcats.db';
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t44-olddb';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9461;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* */ } };
const results = [];
const check = (name, ok, raw) => { results.push({ name, ok: !!ok, raw: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${raw}`); };
const info = (name, raw) => { results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) }); console.log(`INFO  ${name}  — ${raw}`); };

if (!existsSync(REAL_DB)) { console.log('真实库不存在，跳过'); process.exit(0); }
const realMtime0 = statSync(REAL_DB).mtimeMs;

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
copyFileSync(REAL_DB, `${ROOT}\\septcats.db`);
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' },
  sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

const consoleErrors = [];
const pageErrors = [];

const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
  cwd: APPDIR, detached: true, stdio: 'ignore',
});
child.unref();

const deadline = Date.now() + 50000;
let browser = null;
while (Date.now() < deadline) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(700); } }
let page = null;
while (Date.now() < deadline) {
  page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file://'));
  if (page !== null && page !== undefined) break;
  await wait(500);
}
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

await page.waitForLoadState('domcontentloaded').catch(() => {});
await wait(2600);

// 等桥就绪
const bridgeOk = await page.waitForFunction(() => typeof window.septcats?.pages?.tree === 'function', null, { timeout: 25000 })
  .then(() => true).catch(() => false);
check('B1 桥就绪（应用可用）', bridgeOk, `bridge=${String(bridgeOk)}`);

const st = await page.evaluate(async () => {
  try {
    const ws = await window.septcats.workspaces.list();
    const tree = await window.septcats.pages.tree({ workspaceId: ws.activeId });
    return { ok: true, pageCount: tree.nodes?.length ?? tree?.length ?? 0, ws: ws.activeId };
  } catch (e) { return { ok: false, err: String(e?.message ?? e) }; }
});
info('旧库读取', JSON.stringify(st));
check('B2 旧库页面可读（无 E_SCHEMA / 无异常）', st.ok === true && st.pageCount > 0, `pages=${String(st.pageCount)} err=${String(st.err)}`);

const dom = await page.evaluate(() => ({
  body: document.body.innerText.length,
  sideNodes: document.querySelectorAll('[data-testid^="side-node-"]').length,
  wikiLabel: document.body.innerText.includes('Wiki'),
}));
info('界面', JSON.stringify(dom));
check('B3 旧库界面正常渲染（非白屏、侧栏有页）', dom.sideNodes > 0 && dom.body > 40, JSON.stringify(dom));

check('B4 真机无 pageerror', pageErrors.length === 0, `count=${String(pageErrors.length)}`);
info('console 错误数', String(consoleErrors.length));
for (const e of consoleErrors.slice(0, 4)) info(' console', e.split('\n')[0].slice(0, 140));

await page.evaluate(() => { try { window.close(); } catch { /* */ } }).catch(() => {});
await wait(1400);
killTree(child.pid);
await wait(900);

// 迁移后副本库校验改由 PM 用 python sqlite3 单独执行（better-sqlite3 在 docs/ 下解析不到）
info('副本库路径', `${ROOT}\septcats.db`);

const realMtime1 = statSync(REAL_DB).mtimeMs;
check('B8 真实库本体零改动（mtime 不变）', realMtime0 === realMtime1, `before=${realMtime0} after=${realMtime1}`);

const p = results.filter((r) => r.ok === true).length;
const f = results.filter((r) => r.ok === false).length;
console.log(`\n===== 汇总 =====\n  ${p} PASS / ${f} FAIL`);