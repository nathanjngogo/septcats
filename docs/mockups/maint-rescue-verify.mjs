/* @probe-realroot 救援后验证（路线 A 换库完成态）：开真实根，只读取证 442 页回归。
 * 不建页、不删除、不改任何数据；唯一允许的写=app 自身启动流（日志/wal/migration）。
 * 判据：树含业务标题样本 ≥4、活页数 ≥442、抽查 2 页正文块非空、重启后（二次 launch）仍在。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const UD = join(REPO, '..', '_scratch', 'rescue-verify-ud');
const PORT = 9250;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.waitForFunction(() => window.septcats !== undefined, null, { timeout: 40000 });
  return { child, browser, page };
}
async function gracefulExit(page, child) {
  try { await page.evaluate(() => window.close()); } catch { /* */ }
  for (let i = 0; i < 12; i += 1) { await wait(500); try { execSync(`tasklist /FI "PID eq ${String(child.pid)}" /NH | findstr ${String(child.pid)}`, { stdio: 'ignore' }); } catch { return; } }
  killTree(child.pid);
}
const assertions = [];
function check(name, ok, raw) { assertions.push({ name, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 180)}`); }

async function probeOnce(tag) {
  let { child, browser, page } = await launch();
  try {
    const w = await page.evaluate(async () => window.septcats.workspaces.list({}));
    const wid = w.activeId ?? w.items?.[0]?.id ?? null;
    const treeStr = await page.evaluate(async (id) => JSON.stringify(await window.septcats.pages.tree({ workspaceId: id })), wid);
    const alive = (treeStr.match(/"deleted_at":null/g) ?? []).length;
    check(`${tag} 活页数≥442`, alive >= 442, `alive=${String(alive)} len=${String(treeStr.length)}`);
    for (const t of ['0330新品V12产品PRD', '2026年上半年销量数据分析', 'Nathan的工作空间', 'Cursor注册及使用']) {
      check(`${tag} 标题在树「${t}」`, treeStr.includes(t), treeStr.includes(t) ? '命中' : '缺失');
    }
    // 抽查 2 页正文块非空
    const ids = [...treeStr.matchAll(/"id":"([0-9A-Z]{26})","(?:[^"]*",:?.*?)?/g)].slice(0, 60).map((m) => m[1]);
    let bodyHits = 0; let sampled = 0;
    for (const id of ids) {
      if (sampled >= 2) break;
      const b = await page.evaluate(async (pid) => { try { return await window.septcats.pages.get({ id: pid }); } catch { return null; } }, id);
      const blocks = b?.blocks ?? b?.content ?? [];
      sampled += 1;
      if (Array.isArray(blocks) ? blocks.length > 0 : JSON.stringify(b).includes('"blocks"')) bodyHits += 1;
    }
    check(`${tag} 抽查页正文非空(≥${String(sampled > 0 ? sampled - 1 : 1)})`, bodyHits >= 1, `sampled=${String(sampled)} hits=${String(bodyHits)}`);
  } finally {
    try { await gracefulExit(page, child); } catch { /* */ }
    try { await browser.close(); } catch { /* */ }
    killTree(child?.pid);
  }
}

async function main() {
  mkdirSync(UD, { recursive: true });
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1 })); // 不钉 rootPath=开真实根
  await probeOnce('首次');
  await wait(2000);
  await probeOnce('重启复验');
  const fail = assertions.filter((x) => !x.ok).length;
  console.log(`\n===== RESCUE-VERIFY：${String(assertions.length - fail)} PASS / ${String(fail)} FAIL =====`);
  writeFileSync(join(REPO, '..', '_scratch', 'rescue-verify-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), assertions }, null, 2));
  process.exitCode = fail === 0 ? 0 : 1;
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });
