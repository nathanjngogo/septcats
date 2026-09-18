/* 定位「同步错误」根因：读 sync 状态 IPC 的错误字段 + 自愈观察
 * 独立夹具根。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\diag2-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\diag2-data';
const PORT = 9392;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const log = (...a) => console.log(...a);

killAll();
for (const d of [UD, ROOT]) rmSync(d, { recursive: true, force: true });
for (const d of [UD, ROOT]) mkdirSync(d, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');
const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await new Promise((r) => setTimeout(r, 1000)); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async () => { for (let k = 0; k < 25; k++) { if (await page.evaluate(() => typeof window.septcats?.sync !== 'undefined' || typeof window.septcats?.pages?.create === 'function').catch(() => false)) return true; await wait(800); } return false; };
await ready();
const side = page.locator('.app-side');
log('SYNC-API-KEYS:', await page.evaluate(() => Object.keys(window.septcats ?? {}).join(',')));
log('SYNC-METHODS:', await page.evaluate(() => Object.keys(window.septcats?.sync ?? {}).join(',')));
const syncStatus = async (tag) => {
  const s = await page.evaluate(async () => {
    const api = window.septcats?.sync ?? {};
    const out = {};
    for (const k of Object.keys(api)) {
      if (typeof api[k] !== 'function') continue;
      try { out[k] = JSON.parse(JSON.stringify(await api[k]())); } catch (e) { out[k] = `ERR: ${String(e).slice(0, 120)}`; }
    }
    return out;
  });
  log(`SYNC@${tag}:`, JSON.stringify(s).slice(0, 700));
};
await syncStatus('boot');
await side.getByText(/新建页面|New Page/).first().click({ timeout: 8000 }).catch(() => {});
const i = side.locator('input').first();
if (await i.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await i.fill('同步诊断页'); await i.press('Enter'); }
await wait(1800);
await syncStatus('after-create');
await page.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await page.keyboard.type('同步诊断正文', { delay: 15 });
await wait(2500);
await syncStatus('after-type');
log('ROOT-FILES-AFTER-TYPE:', readdirSync(ROOT, { withFileTypes: true }).map((d) => `${d.name}${d.isDirectory() ? '/' : ''}`).join(','));
try {
  const seg = `${ROOT}\\.septcats`;
  log('SEPTCATS-DIR:', readdirSync(seg).slice(0, 12).join(','), '(count=', readdirSync(seg).length, ')');
} catch (e) { log('SEPTCATS-DIR: (无)'); }
await wait(9000);
await syncStatus('after-9s-wait');
const pill = await page.evaluate(() => document.querySelector('.sc-sync-status__pill')?.textContent?.trim() ?? '(无)');
log('PILL-FINAL:', pill);
await br.close().catch(() => {});
killAll();
process.exit(0);