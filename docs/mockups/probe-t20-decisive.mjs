/* T20-01 决定性诊断：全新夹具下分辨
 * ① search.query(active ws) 主进程链路是否有命中
 * ② 命令面板 UI 是否显示命中（renderer pagesStore.workspaceId 解析）
 * ③ 夹具 settings 的 rootPath 与 theme 是否被 app 重写丢失（数据根丢失缺陷取证）
 * 全程用独立夹具根，绝不触碰默认根/真实数据。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t20b-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t20b-data';
const PORT = 9353;
const SETTINGS = `${UD}\\septcats.settings.json`;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(SETTINGS, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'dark' }), 'utf8');
console.log('夹具写入:', JSON.stringify({ rootPath: ROOT, theme: 'dark' }));

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 160)));
for (let k = 0; k < 20; k++) {
  if (await page.evaluate(() => typeof window.septcats?.search?.query === 'function').catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 800));
}
// 出厂状态：是否已重写 settings？
const afterBoot = JSON.parse(readFileSync(SETTINGS, 'utf8'));
console.log('开机后 settings 键:', Object.keys(afterBoot).join(','), '| rootPath=', afterBoot.rootPath ?? '(丢失!)', '| theme=', afterBoot.theme);
console.log('开机后 data-theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));

// 造靶（标题含 2 字词）
const made = await page.evaluate(async () => {
  const a = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: a.id, title: '量子实验记录' });
  return a.id;
});
const q = await page.evaluate(async (pageId) => {
  const ws = await window.septcats.workspaces.list();
  const r1 = await window.septcats.search.query({ workspaceId: ws.activeId, query: '量子', limit: 10 });
  const r2 = await window.septcats.search.query({ workspaceId: ws.activeId, query: '量子实验', limit: 10 });
  const perPage = await window.septcats.dbview ? null : null;
  return { activeId: ws.activeId, pageId, wsIsSame: true, twoChar: { hits: r1.hits.length, titles: r1.hits.map((h) => h.title) }, fourChar: { hits: r2.hits.length, titles: r2.hits.map((h) => h.title) } };
}, made);
console.log('IPC search.query:', JSON.stringify(q));

// 命令面板 UI
await page.keyboard.press('Control+k');
const input = page.locator('[data-testid="palette-panel"] input').first();
await input.waitFor({ state: 'visible', timeout: 5000 });
await input.type('量子', { delay: 30 });
await new Promise((r) => setTimeout(r, 2000));
console.log('面板列表文本:', (await page.locator('.palette-list').first().innerText().catch(() => '(无)')).replace(/\s+/g, ' ').slice(0, 200));
console.log('renderer 日志:', logs.slice(0, 6).join(' || ') || '(无 error/warning)');
const afterRun = JSON.parse(readFileSync(SETTINGS, 'utf8'));
console.log('会话后 settings 键:', Object.keys(afterRun).join(','), '| rootPath=', afterRun.rootPath ?? '(丢失!)');
await br.close().catch(() => {});
killAll();