/* dbg-t79-fail.mjs —— 最小 DOM 取证：编辑器面为何找不到 .pv-body .ProseMirror */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = require('playwright-core');
const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 'dbg-t79');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const PORT = 9247;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 40; i += 1) { await wait(800); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ } }
if (browser === null) { console.log('CDP-FAIL'); process.exit(2); }
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await wait(4000);
  const pick = await page.locator('[data-testid="ws-create"]').count().catch(() => 0);
  if (pick > 0) { await page.evaluate(() => document.querySelector('[data-testid="ws-create"]')?.click()); await wait(3000); }
  await page.evaluate(() => document.querySelector('[data-testid="side-new-page"]')?.click());
  await wait(1200);
  const dump = await page.evaluate(() => ({
    title: document.title,
    rootKids: [...(document.querySelector('#root')?.children ?? [])].map((e) => e.className).slice(0, 6),
    hasProseMirror: document.querySelectorAll('.ProseMirror').length,
    pmInPvBody: document.querySelectorAll('.pv-body .ProseMirror').length,
    pvBody: document.querySelectorAll('.pv-body').length,
    pageView: [...document.querySelectorAll('[class]')].map((e) => String(e.className)).filter((c) => /pv-|page-view|editor/.test(c)).slice(0, 18),
    bodyText: (document.body.innerText ?? '').slice(0, 260).replace(/\n/g, ' | '),
    inputs: document.querySelectorAll('input').length,
    sideInputs: [...document.querySelectorAll('.app-side input')].map((i) => i.value).slice(0, 4),
  }));
  console.log(JSON.stringify(dump, null, 1));
} finally {
  try { await page.evaluate(() => window.close()); } catch { /* */ }
  await wait(1500);
  try { browser.close(); } catch { /* */ }
  try { execSync(`taskkill /PID ${String(child.pid)} /T /F`, { stdio: 'ignore' }); } catch { /* */ }
}