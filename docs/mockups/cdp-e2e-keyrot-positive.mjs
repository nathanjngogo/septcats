/* 正面快检：装的 0.1.2（新 keygen 重打包）→ check 应 available 0.1.3（验签过=feedUrl 接线与轮换公钥双实证） */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
function sh(cmd, t = 30000) { try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: t }).trim(); } catch (e) { return 'SH_ERR'; } }
sh('Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force; Start-Sleep 2');
sh('$env:SEPTCATS_DEV_FEED="1"; $env:SEPTCATS_DEV_FEED_URL="http://127.0.0.1:8791/stable"; Start-Process (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe") -ArgumentList "--remote-debugging-port=9224"');
let browser = null;
for (let k = 0; k < 25; k++) { await new Promise((r) => setTimeout(r, 1000)); try { browser = await chromium.connectOverCDP('http://127.0.0.1:9224'); break; } catch {} }
if (!browser) { console.log('FAIL CDP'); process.exit(1); }
const page = browser.contexts()[0].pages()[0];
for (let k = 0; k < 15 && !(await page.evaluate(() => typeof window.septcats?.update?.check === 'function').catch(() => false)); k++) await page.waitForTimeout(800);
const st = await page.evaluate(async () => { try { return await window.septcats.update.check(); } catch (e) { return { err: String(e) }; } });
console.log('CHECK =', JSON.stringify(st));
// 不下载不安装（负向脚本会复用这台机器），退出前杀掉本次实例
await browser.close().catch(() => {});
sh('Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force');
const pass = st.status === 'available' && st.version === '0.1.3';
console.log(pass ? 'PASS 正面：0.1.3 available（验签过=公钥轮换+feedUrl 接线双生效）' : 'FAIL 正面');
process.exit(pass ? 0 : 1);
