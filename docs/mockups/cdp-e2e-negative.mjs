/* M10-B 负向三连：⑩篡改 yml ⑪无 sig ⑫无 dev 开关注入本地源 —— 全应拒绝且应用不崩 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const YML = 'E:/Hermes Agent工作空间/Septcats/tmp/demo-feed/stable/latest.yml';
const SIG = YML + '.sig';
const BACKUP = readFileSync(YML);

function restart(withDevGate) {
  try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process Septcats -ErrorAction SilentlyContinue | Stop-Process -Force'], { timeout: 15000 }); } catch {}
  const cmd = withDevGate
    ? '$env:SEPTCATS_DEV_FEED="1"; $env:SEPTCATS_DEV_FEED_URL="http://127.0.0.1:8791/stable"; Start-Process (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe") -ArgumentList "--remote-debugging-port=9224"; Start-Sleep 1; Remove-Item Env:SEPTCATS_DEV_FEED,Env:SEPTCATS_DEV_FEED_URL'
    : '$env:SEPTCATS_DEV_FEED_URL="http://127.0.0.1:8791/stable"; Start-Process (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe") -ArgumentList "--remote-debugging-port=9224"; Start-Sleep 1; Remove-Item Env:SEPTCATS_DEV_FEED_URL';
  try { execFileSync('powershell', ['-NoProfile', '-Command', cmd], { timeout: 30000 }); } catch {}
}

async function checkUpdate(expect) {
  await new Promise(r => setTimeout(r, 9000));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
  const page = browser.contexts()[0].pages()[0];
  await page.waitForTimeout(1500);
  const alive = await page.evaluate(() => typeof window.septcats?.update?.check === 'function');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
    btn?.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('检查更新'));
    b?.click();
  });
  let txt = '';
  for (let k = 0; k < 12; k++) {
    await page.waitForTimeout(800);
    txt = await page.evaluate(() => (document.body.innerText.match(/(更新失败[^。\n]*|E_FEED_[A-Z_]+|已是最新[^。\n]*|发现新版本|E_UPDATE[A-Z_]*)/g) ?? []).join('|'));
    if (txt && !txt.includes('发现新版本')) break;
  }
  await browser.close().catch(() => {});
  const ok = alive && expect.test(txt);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expect.source}  — alive=${String(alive)} txt=${txt.slice(0, 110)}`);
  return ok;
}

const results = [];
// ⑩ 篡改 yml（version 0.1.1→0.1.2）
writeFileSync(YML, BACKUP.toString('utf8').replace('version: 0.1.1', 'version: 0.1.2'));
restart(true);
results.push(await checkUpdate(/E_FEED_SIGNATURE|更新失败/));

// ⑪ 无 sig
writeFileSync(YML, BACKUP);
renameSync(SIG, SIG + '.bak');
restart(true);
results.push(await checkUpdate(/E_FEED_SIGNATURE|更新失败/));
renameSync(SIG + '.bak', SIG);

// ⑫ 无 dev 开关 + env 指本地源：应 fail-closed（不崩；日志有 E_FEED_SOURCE_DENIED）
restart(false);
results.push(await checkUpdate(/E_FEED_SOURCE_DENIED|更新失败|已是最新/));
writeFileSync(YML, BACKUP);

const failed = results.filter((r) => !r).length;
console.log(`\n== M10-B 负向三连 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (3) ==`);
process.exit(failed === 0 ? 0 : 1);
