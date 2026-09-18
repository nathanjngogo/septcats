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
const afterPatch = show('patch 后');
console.log('patch 后 data-theme =', await page.evaluate(() => document.documentElement.getAttribute('data-theme')));
await br.close().catch(() => {});
killAll();
// —— 断言（T20-02 §0.A 验收）：patch 后 rootPath 必须保留；二次启动仍指向自定义根 ——
const failures = [];
if (!(typeof afterPatch.rootPath === 'string' && afterPatch.rootPath.length > 0)) {
  failures.push('patch 后 rootPath 丢失 ✗（T20-01-1 未修复）');
}
const p2 = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p2.unref();
let br2 = null;
for (let k = 0; k < 25 && br2 === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br2 = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const boot2 = JSON.parse(readFileSync(F, 'utf8'));
console.log('二次启动后:', `rootPath=${boot2.rootPath ?? '(丢失!)'}`, `theme=${boot2.theme}`);
if (boot2.rootPath !== afterPatch.rootPath) failures.push('二次启动后 rootPath 变化/丢失 ✗');
await br2?.close().catch(() => {});
killAll();
console.log(failures.length === 0 ? '\n== T20-02 §0.A 真机 ASSERT PASS（rootPath 全程保留）==' : '\n== T20-02 §0.A 真机 ASSERT FAILED: ' + failures.join('; ') + ' ==');
process.exit(failures.length === 0 ? 0 : 1);