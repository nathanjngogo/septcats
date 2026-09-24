/* T79 定性：UD 夹具内 dump「T79 导出页」块真相——code 块在库否？cell 文本在哪？ */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { join } from 'node:path';

const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const UD = join(REPO, '..', '_scratch', 't79-e2e', 'ud');
const PORT = 9240;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* */ } }
const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(2500); }
const dump = await page.evaluate(async () => {
  const w = await window.septcats.workspaces.list({});
  const r = await window.septcats.pages.tree({ workspaceId: w.activeId ?? w.items?.[0]?.id });
  const arr = Array.isArray(r) ? r : (r?.pages ?? r?.nodes ?? []);
  const hit = [...arr].reverse().find((x) => (x?.title ?? '').includes('T79 导出页 mufe5m7d'));
  if (!hit) return 'NO_PAGE';
  const b = await window.septcats.blocks.list({ pageId: hit.id });
  return (b.blocks ?? []).map((x) => `${x.type} | PROPS=${JSON.stringify(x.props).slice(0,300)} | content=${JSON.stringify(x.content)} | ${JSON.stringify(x.content).slice(0, 420)}`).join('\n');
});
console.log(dump);
try { await page.evaluate(() => window.close()); } catch { /* */ }
await wait(1500);
try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* */ }
process.exit(0);
