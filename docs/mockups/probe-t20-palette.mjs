/* T20-01 诊断 3：命令面板为何不显示命中 —— 拦截 search.query 记录真实调用 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t20c-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t20c-data';
const PORT = 9354;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'light' }), 'utf8');

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
const made = await page.evaluate(async () => {
  const a = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: a.id, title: '量子实验记录' });
  return a.id;
});
// 拦截 search.query，记录调用与返回
await page.evaluate(() => {
  window.__calls = [];
  const api = window.septcats.search;
  const orig = api.query.bind(api);
  api.query = async (arg) => {
    const rec = { arg, ok: null, hits: null, error: null };
    window.__calls.push(rec);
    try {
      const r = await orig(arg);
      rec.ok = true; rec.hits = r.hits.length; rec.titles = r.hits.map((h) => h.title);
      return r;
    } catch (e) { rec.ok = false; rec.error = String(e).slice(0, 140); throw e; }
  };
});
await page.keyboard.press('Control+k');
const input = page.locator('[data-testid="palette-panel"] input').first();
await input.waitFor({ state: 'visible', timeout: 5000 });
await input.type('量子', { delay: 30 });
await new Promise((r) => setTimeout(r, 2500));
const dump = await page.evaluate(() => ({
  calls: window.__calls,
  listText: (document.querySelector('.palette-list')?.innerText ?? '(无)').replace(/\s+/g, ' ').slice(0, 160),
  themeOnHtml: document.documentElement.getAttribute('data-theme'),
  themeOnBody: document.body.getAttribute('data-theme'),
  paletteClasses: document.querySelector('[data-testid="palette-panel"]')?.className ?? '(无)',
  hitNodes: document.querySelectorAll('.palette-list [role="option"]').length,
}));
console.log('靶页:', made);
console.log(JSON.stringify(dump, null, 1).slice(0, 1500));
await br.close().catch(() => {});
killAll();