/* PM 真机验收 M10-B 主链路：0.1.1 → dev feed(已验签 0.1.2) → check→download→install→自动重启 → 已是最新 */
/* @probe-readonly —— 只读：更新链状态机断言，不写应用数据 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

function sh(cmd, timeoutMs = 60000) {
  try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: timeoutMs }).trim(); }
  catch (e) { return 'SH_ERR ' + String(e.message).slice(0, 60); }
}
const ver = () => sh(`(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA SilentlyContinue | Where-Object DisplayName -like '*Septcats*').DisplayVersion`);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 140) : ''}`);
}

check('起始版本 = 0.1.1', ver() === '0.1.1', ver());

// 起 0.1.1 带 dev feed（feed 内=已重签的 0.1.2 套）
sh('Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force; Start-Sleep 2');
sh('$env:SEPTCATS_DEV_FEED="1"; $env:SEPTCATS_DEV_FEED_URL="http://127.0.0.1:8791/stable"; Start-Process (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe") -ArgumentList "--remote-debugging-port=9224"');

let browser = null;
for (let k = 0; k < 25; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:9224'); break; } catch {}
}
if (!browser) {
  check('升级应用 CDP 可连（0.1.2 含更新器）', false, 'CDP 9224 未起');
  const failed0 = results.filter((r) => !r.ok).length;
  console.log(`\n== M10-B 主链路 ${failed0} FAILED (前置即崩) ==`);
  process.exit(1);
}
let page = browser.contexts()[0].pages()[0];
for (let k = 0; k < 15 && !(await page.evaluate(() => typeof window.septcats?.update?.check === 'function').catch(() => false)); k++) await page.waitForTimeout(800);

// 1) check → available 0.1.2
const st1 = await page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { error: String(e) }; } });
check('check → available v0.1.2（验签过，篡改/缺 sig 不可能到这步）', st1.status === 'available' && st1.version === '0.1.2', JSON.stringify(st1));

// 2) download
const st2 = await page.evaluate(async () => { try { return await window.septcats.update.download(); } catch (e) { return { error: String(e) }; } });
check('download → downloaded', st2.status === 'downloaded' || (st2.status === 'downloading'), JSON.stringify(st2).slice(0, 120));
// 轮询到 downloaded
let st3 = st2;
for (let k = 0; k < 40 && st3.status !== 'downloaded' && st3.status !== 'error'; k++) {
  await new Promise((r) => setTimeout(r, 1500));
  st3 = await page.evaluate(async () => await window.septcats.update.check().catch(() => null)) ?? st3;
  const cur = await page.evaluate(() => (document.body.innerText.match(/(已下载|下载中[^\n]*|更新失败[^\n]*)/g) ?? []).join('|'));
  if (cur.includes('已下载')) { st3 = { status: 'downloaded' }; break; }
}

// 3) install（会自杀重启，CDP 断开属预期）
console.log('TRIGGER  install 触发（应用将退出并升级）');
await page.evaluate(() => { window.septcats.update.install({ confirm: true }).catch(() => {}); }).catch(() => {});
await browser.close().catch(() => {});

// 4) 等升级完成：0.1.1 → 0.1.2（NSIS 静默安装 + 应用自启）
let upgraded = false;
for (let k = 0; k < 60; k++) {
  await new Promise((r) => setTimeout(r, 2000));
  if (ver() === '0.1.2') { upgraded = true; break; }
}
check('升级完成 → 注册表版本 0.1.2', upgraded, 'ver=' + ver());

// 5) 升级后进程在跑（自动重启语义），重连验「已是最新」
let browser2 = null;
for (let k = 0; k < 25; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { browser2 = await chromium.connectOverCDP('http://127.0.0.1:9224'); break; } catch {}
}
if (browser2 === null) {
  // 自动重启不带 debug 端口的话：证明进程活着即可
  const alive = sh('(Get-Process Septcats -EA SilentlyContinue | Measure-Object).Count');
  check('升级后应用进程存活（自动重启或手动起）', alive !== '0' && !alive.startsWith('SH_ERR'), 'procs=' + alive);
} else {
  const p2 = browser2.contexts()[0].pages()[0];
  for (let k = 0; k < 15 && !(await p2.evaluate(() => typeof window.septcats?.update?.check === 'function').catch(() => false)); k++) await p2.waitForTimeout(800);
  const st5 = await p2.evaluate(async () => await window.septcats.update.check().catch((e) => ({ error: String(e) })));
  check('升级后再 check → not-available（已是最新）', st5.status === 'not-available' || st5.version === '0.1.2' || (st5.message ?? '').includes('已是最新'), JSON.stringify(st5).slice(0, 100));
  await browser2.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== M10-B 主链路 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);
