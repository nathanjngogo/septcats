/* TASK-T44-01-1 §8.1 补充验证：回收站**恢复**分支（干净用例，不涉及改名）
   链路：A 链接到 B（已解析）→ 真机删除 B → 断言 unresolved
        → 回收站恢复 B → 断言**重新已解析**（防单向 bug）→ reload 后仍已解析
*/
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t44-restore';
const UD = RUN + '\\ud';
const ROOT = RUN + '\\data';
const PORT = 9448;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t44');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => { results.push({ name, ok: !!ok, raw: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`); };
const info = (name, raw) => { results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) }); console.log(`INFO  ${name}  — ${String(raw)}`); };
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* ignore */ } };
const alive = (pid) => { try { execSync(`tasklist /FI "PID eq ${pid}" /NH`, { stdio: 'pipe' }); return true; } catch { return false; } };

const consoleErrors = [];
const pageErrors = [];
async function launch(tag) {
  try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }); } catch { /* ignore */ }
  await wait(1500);
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], { cwd: APPDIR, detached: false, stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(800); } }
  if (browser === null || browser === undefined) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter((p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'));
    if (ps.length > 0) { page = ps[0]; break; }
    await wait(500);
  }
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`); });
  page.on('pageerror', (e) => pageErrors.push(`[${tag}] ${String(e && e.message ? e.message : e)}`));
  await page.bringToFront().catch(() => {});
  await wait(2000);
  return { page, pid: child.pid, browser };
}
async function quit(page, pid, browser) {
  await page.evaluate(() => { try { window.close(); } catch { /* ignore */ } }).catch(() => {});
  await wait(1200);
  if (alive(pid)) killTree(pid);
  await browser.close().catch(() => {});
  await wait(1200);
}
async function waitFor(fn, timeoutMs, stepMs = 250) {
  const dl = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < dl) { last = await fn(); if (last) return last; await wait(stepMs); }
  return last;
}
const state = () => ({
  wikilinks: document.querySelectorAll('.sc-wikilink').length,
  unresolved: document.querySelectorAll('.sc-wikilink--unresolved').length,
});

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' }, sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

async function openRow(page, title) {
  const tid = await page.evaluate((t) => {
    const rows = [...document.querySelectorAll('[data-testid^="side-node-"], [data-testid^="side-wiki-node-"]')];
    const r = rows.find((el) => (el.textContent || '').includes(t));
    return r ? r.getAttribute('data-testid') : null;
  }, title);
  if (tid === null) return false;
  await page.locator(`[data-testid="${tid}"]`).first().click({ force: true }).catch(() => {});
  await wait(1300);
  return true;
}
async function newPage(page, title) {
  await page.getByTestId('side-new-page').click();
  const inp = page.locator('.app-side input').first();
  await inp.waitFor({ state: 'visible', timeout: 15000 });
  await inp.fill(title);
  await inp.press('Enter');
  await wait(1500);
}

console.log('\n--- BOOT1：建链 → 真机删除 → 回收站恢复 ---');
let { page, pid, browser } = await launch('b1');
await newPage(page, '恢复源页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(400);
await page.keyboard.type('恢复用例源页', { delay: 25 });
await wait(600);
await page.keyboard.press('Enter');
await wait(300);
await newPage(page, '恢复目标页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(400);
await page.keyboard.type('恢复用例目标页', { delay: 25 });
await wait(600);

await openRow(page, '恢复源页');
await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
await wait(500);
await page.keyboard.press('Control+End').catch(() => {});
await page.keyboard.press('Enter');
await wait(300);
await page.keyboard.type('[[', { delay: 60 });
await wait(800);
await page.keyboard.type('恢复目标', { delay: 60 });
await wait(900);
await page.keyboard.press('Enter');
await wait(1200);
const s1 = await page.evaluate(state);
check('R1 建链后已解析', s1.wikilinks > 0 && s1.unresolved === 0, JSON.stringify(s1));

await quit(page, pid, browser);

console.log('\n--- BOOT2：删除 → 恢复 ---');
({ page, pid, browser } = await launch('b2'));
await openRow(page, '恢复源页');
await wait(900);
const targetId = await page.evaluate(async () => {
  const ws = await window.septcats.workspaces.list();
  const flat = await window.septcats.pages.tree({ workspaceId: ws.activeId });
  const f = flat.find((n) => String(n.title) === '恢复目标页');
  return f ? f.id : null;
});
info('目标页 id', String(targetId));

// 真机删除
await page.locator(`[data-testid="side-node-${targetId}"]`).first().hover().catch(() => {});
await wait(500);
await page.locator(`[data-testid="side-more-${targetId}"]`).first().click({ force: true }).catch(() => {});
await wait(900);
const delItem = page.locator('[role="menuitem"]', { hasText: '删除' }).first();
const hasDel = (await delItem.count()) > 0;
if (hasDel) await delItem.click({ force: true }).catch(() => {});
await wait(900);
const dlg = page.locator('[data-testid="page-delete-confirm"]').first();
const hasDlg = (await dlg.count()) > 0;
if (hasDlg) await dlg.click({ force: true }).catch(() => {});
await wait(1600);
await openRow(page, '恢复源页');
await wait(1200);
const s2 = await page.evaluate(state);
check('R2 真机删除目标后 → unresolved', hasDel && hasDlg && s2.unresolved > 0, `hasDel=${String(hasDel)} hasDlg=${String(hasDlg)} ${JSON.stringify(s2)}`);

// 回收站恢复（真机路径）
await page.getByTestId('side-trash').click().catch(() => {});
await wait(1500);
const restoreBtn = page.locator(`[data-testid="trash-restore-${targetId}"]`).first();
const hasRestore = (await restoreBtn.count()) > 0;
info('回收站恢复按钮', `hasRestore=${String(hasRestore)}`);
if (hasRestore) await restoreBtn.click({ force: true }).catch(() => {});
await wait(1800);
await openRow(page, '恢复源页');
await wait(1400);
const s3 = await page.evaluate(state);
check('R3 回收站恢复目标后 → 重新已解析（防单向 bug）', hasRestore && s3.unresolved === 0 && s3.wikilinks > 0, `hasRestore=${String(hasRestore)} ${JSON.stringify(s3)}`);
await page.screenshot({ path: join(SHOTS, 'restore-01-resolved.png') }).catch(() => {});

// reload 后仍已解析
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(async () => page.evaluate(() => typeof window.septcats?.pages?.tree === 'function'), 20000);
await wait(1500);
await openRow(page, '恢复源页');
await wait(1300);
const s4 = await page.evaluate(state);
check('R4 reload 后仍已解析（持久化正确）', s4.unresolved === 0 && s4.wikilinks > 0, JSON.stringify(s4));

await quit(page, pid, browser);

const pass = results.filter((r) => r.ok === true).length;
const fail = results.filter((r) => r.ok === false).length;
console.log(`\n========== 汇总：${pass} PASS / ${fail} FAIL ==========`);
console.log(`console 错误 ${consoleErrors.length} / pageerror ${pageErrors.length}`);
for (const e of consoleErrors.slice(0, 6)) console.log(`  console: ${e.slice(0, 150)}`);
for (const e of pageErrors.slice(0, 6)) console.log(`  pageerror: ${e.slice(0, 150)}`);
writeFileSync(join(SHOTS, 't44-restore-results.json'), JSON.stringify({ pass, fail, results, consoleErrors, pageErrors }, null, 2), 'utf8');