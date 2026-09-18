/* T20-01 诊断探针：分辨零命中是主进程链路还是 renderer workspaceId 解析 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t20-root';
const PORT = 9352;
try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ }
const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
for (let k = 0; k < 20; k++) {
  if (await page.evaluate(() => typeof window.septcats?.search?.query === 'function').catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 800));
}
const out = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const active = ws.activeId;
  const probe = async (q, workspaceId) => {
    try {
      const r = await window.septcats.search.query({ workspaceId, query: q, limit: 10 });
      return { q, workspaceId, hits: r.hits.length, titles: r.hits.map((h) => h.title).slice(0, 3), tookMs: r.tookMs };
    } catch (e) { return { q, workspaceId, error: String(e).slice(0, 120) }; }
  };
  return {
    workspaces: ws,
    withActive: [await probe('量子', active), await probe('量子实验', active)],
    withRawId: [await probe('量子', '01M2TEP1PR8NMA4CSNAX89XPTF')],
    pagesTreeActive: (await window.septcats.pages.tree({ workspaceId: active })).map((t) => t.title),
  };
});
console.log(JSON.stringify(out, null, 1).slice(0, 1800));
await br.close().catch(() => {});
try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ }