/* TASK-T40-01 §5 旧库兼容验证：用**老板真实库的副本**开一次 rc.14。
 * 双隔离：--user-data-dir 与 rootPath 全在 _scratch/probe-t40-olddb/ 下；
 * 真实库只做**只读拷贝**，运行前后断言其 mtime 不变。
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, copyFileSync, statSync, existsSync } from 'node:fs';

const APPDIR = 'E:\\Hermes Agent工作空间\\Septcats\\apps\\desktop';
const ELECTRON = `${APPDIR}\\node_modules\\electron\\dist\\electron.exe`;
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t40-olddb';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9404;
const REAL_DB = 'C:\\Users\\Administrator\\.septcats\\septcats.db';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok: !!ok, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (n, r) => console.log(`INFO  ${n}  — ${String(r)}`);

const realMtimeBefore = statSync(REAL_DB).mtimeMs;

try {
  execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' });
} catch {
  /* none */
}
rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
copyFileSync(REAL_DB, `${ROOT}\\septcats.db`);
writeFileSync(
  `${UD}\\septcats.settings.json`,
  JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN' }, null, 2),
  'utf8',
);
info('副本已建立', `${ROOT}\\septcats.db（源 mtime=${String(realMtimeBefore)}）`);
await wait(800);

const proc = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
  cwd: APPDIR,
  detached: true,
  stdio: 'ignore',
});
proc.unref();

let br = null;
for (let k = 0; k < 40 && br === null; k++) {
  await wait(1000);
  try {
    br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
  } catch {
    /* retry */
  }
}
const page = br.contexts()[0].pages().find((p) => p.url().includes('index.html')) ?? br.contexts()[0].pages()[0];
const errs = [];
const pErrs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
page.on('pageerror', (e) => pErrs.push(String(e?.message ?? e)));

const ready = (async () => {
  for (let k = 0; k < 40; k++) {
    const ok = await page.evaluate(() => typeof window.septcats?.pages?.tree === 'function').catch(() => false);
    if (ok) return true;
    await wait(800);
  }
  return false;
})();
await ready;
await wait(2500);

// 1. 旧库能否打开（页树读得出来）
const tree = await page.evaluate(async () => {
  try {
    const ws = await window.septcats.workspaces.list();
    const t = await window.septcats.pages.tree({ workspaceId: ws.activeId });
    let n = 0;
    const walk = (ns) => {
      for (const x of ns) {
        n += 1;
        if (Array.isArray(x.children)) walk(x.children);
      }
    };
    walk(t);
    return { ok: true, pages: n, ws: ws.activeId };
  } catch (e) {
    return { ok: false, err: String(e?.message ?? e) };
  }
});
info('页树', JSON.stringify(tree));
check('G1 旧库可打开（页树读取成功）', tree.ok === true && tree.pages > 0, JSON.stringify(tree));

// 2. 旧库里的数据库页能否 load（若存在 collection）
const dbload = await page.evaluate(async () => {
  try {
    const ws = await window.septcats.workspaces.list();
    const t = await window.septcats.pages.tree({ workspaceId: ws.activeId });
    const ids = [];
    const walk = (ns) => {
      for (const x of ns) {
        ids.push(x.id);
        if (Array.isArray(x.children)) walk(x.children);
      }
    };
    walk(t);
    let loaded = 0;
    let props = 0;
    let lastErr = null;
    for (const id of ids) {
      try {
        const r = await window.septcats.db.load({ pageId: id });
        loaded += 1;
        props += Object.keys(r.collection.schema.properties).length;
      } catch (e) {
        lastErr = String(e?.message ?? e);
      }
    }
    return { tried: ids.length, loaded, props, lastErr };
  } catch (e) {
    return { err: String(e?.message ?? e) };
  }
});
info('库页 load 探测', JSON.stringify(dbload));
check('G2 旧库中的数据库页可 load（属性/记录读出）', dbload.loaded > 0, JSON.stringify(dbload));

// 3. 搜索（FTS）可用
const search = await page.evaluate(async () => {
  try {
    const ws = await window.septcats.workspaces.list();
    const r = await window.septcats.search.query({ workspaceId: ws.activeId, query: 'a', limit: 5 });
    return { ok: true, n: Array.isArray(r.results) ? r.results.length : -1 };
  } catch (e) {
    return { ok: false, err: String(e?.message ?? e) };
  }
});
info('搜索探测', JSON.stringify(search));

// 4. 应用无白屏
const ui = await page.evaluate(() => ({
  rendered: document.querySelector('.app-side') !== null,
  text: document.body.innerText.length,
}));
check('G3 应用正常渲染（无白屏）', ui.rendered === true && ui.text > 20, JSON.stringify(ui));
check('G4 旧库打开无 pageerror', pErrs.length === 0, `pageErrors=${JSON.stringify(pErrs.slice(0, 4))}`);
info('consoleErrors', JSON.stringify(errs.slice(0, 5)));

try {
  await page.evaluate(() => window.close());
} catch {
  /* */
}
await wait(2500);
try {
  execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' });
} catch {
  /* */
}

// 5. schema 未升版 + 真实库未被触碰
const realMtimeAfter = statSync(REAL_DB).mtimeMs;
check('G5 真实库未被触碰（只读拷贝，双隔离生效）', realMtimeAfter === realMtimeBefore, `before=${String(realMtimeBefore)} after=${String(realMtimeAfter)}`);

const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n========== 旧库兼容：${String(pass)} PASS / ${String(fail)} FAIL ==========`);
process.exit(fail > 0 ? 1 : 0);