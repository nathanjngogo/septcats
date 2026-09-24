/* maint-verify-real-lib.mjs —— 清理后只读复核（真实库；零写操作，仅读 IPC + DOM）*/
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const EXE = join(REPO, 'apps', 'desktop', 'dist', 'win-unpacked', 'Septcats.exe');
const PORT = 9253;
const PROBE_TITLE = /^(T7|DBG|CELL|诊断|C4 诊断)/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } };

async function main() {
  const child = spawn(EXE, [`--remote-debugging-port=${String(PORT)}`], { stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40 && browser === null; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  let page = null;
  for (let i = 0; i < 40 && page === null; i += 1) {
    for (const cand of ctx.pages()) {
      try { if (await cand.evaluate(() => typeof window.septcats !== 'undefined' && typeof window.septcats.pages !== 'undefined') === true) { page = cand; break; } } catch { /* loading */ }
    }
    if (page === null) await wait(700);
  }
  if (page === null) throw new Error('未找到挂载 window.septcats 的渲染页');
  try {
    await wait(1500);
    const ws = await page.evaluate(async () => await window.septcats.workspaces.list());
    const wsId = ws.activeId ?? ws.items[0]?.id;
    const tree = await page.evaluate(async (w) => await window.septcats.pages.tree({ workspaceId: w }), wsId);
    const alive = tree.filter((n) => n.alive === 1);
    const probeAlive = alive.filter((n) => PROBE_TITLE.test(String(n.title ?? '')));
    const recent = await page.evaluate(async () => await window.septcats.recent.list());
    const favs = await page.evaluate(async () => await window.septcats.favorites.list());
    const aliveIds = new Set(alive.map((n) => n.id));
    const recentAlive = (recent.pageIds ?? []).filter((id) => aliveIds.has(id));
    // DOM 面：侧栏可见标题里是否还有探针页
    const domTitles = await page.evaluate(() => Array.from(document.querySelectorAll('.app-side, .pv-body')).map((el) => el.innerText).join('\n'));
    const domHit = PROBE_TITLE.test(domTitles) || /T76 表格页|T79 导出页/.test(domTitles);
    console.log(JSON.stringify({
      alivePages: alive.length,
      probeAlive: probeAlive.length,
      probeTitlesSample: probeAlive.slice(0, 4).map((n) => n.title),
      recentTotal: (recent.pageIds ?? []).length,
      recentSecondsToDeadPages: (recent.pageIds ?? []).length - recentAlive.length,
      recentAliveCount: recentAlive.length,
      favorites: (favs.pageIds ?? []).length,
      domShowsProbePage: domHit,
      aliveTitles: alive.map((n) => n.title).slice(0, 16),
    }, null, 1));
    await page.evaluate(() => window.close());
    await wait(2000);
  } finally {
    try { await browser.close(); } catch { /* noop */ }
    killTree(child.pid);
  }
}
main().catch((e) => { console.log('FATAL', String(e && e.message ? e.message : e)); process.exitCode = 1; });
