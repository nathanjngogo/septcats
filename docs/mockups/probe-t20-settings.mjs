/* 取证：settings.patch 是否丢 rootPath + 开机主题是否被应用 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t20d-root';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t20d-data';
const PORT = 9355;
const F = `${UD}\\septcats.settings.json`;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const show = (label) => {
  const j = JSON.parse(readFileSync(F, 'utf8'));
  console.log(`${label}: keys=[${Object.keys(j).join(',')}] rootPath=${j.rootPath ?? '(丢失!)'} theme=${j.theme ?? '(无)'}`);
  return j;
};

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(F, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'dark' }), 'utf8');
show('写入夹具');
const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
for (let k = 0; k < 20; k++) {
  if (await page.evaluate(() => typeof window.septcats?.settings?.patch === 'function').catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 800));
}
console.log('开机 data-theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')), '(夹具写的是 dark)');
show('开机后');
const patched = await page.evaluate(async () => {
  try { return await window.septcats.settings.patch({ theme: 'light' }); } catch (e) { return 'ERR ' + String(e).slice(0, 120); }
}).catch((e) => 'ERR ' + String(e).slice(0, 120));
console.log('settings.patch({theme:light}) →', typeof patched === 'object' ? 'ok' : String(patched).slice(0, 100));
await new Promise((r) => setTimeout(r, 800));
show('patch 后');
console.log('patch 后 data-theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
await br.close().catch(() => {});
killAll();