/* 升级后验证：重启应用带 CDP → 检查更新应回「已是最新（0.1.1）」 */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

// 用带调试端口的方式重启（dev feed 也给上，让它认这个 feed 源）
try { execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Process Septcats -ErrorAction SilentlyContinue | Stop-Process -Force'], { timeout: 15000 }); } catch {}
await new Promise(r => setTimeout(r, 2000));
try { execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'E:\\HERMES~1\\_scratch\\launch-224.ps1'], { timeout: 30000 }); } catch {}
await new Promise(r => setTimeout(r, 8000));

const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
await page.waitForTimeout(1500);
console.log('TITLE:', await page.title());

await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
  btn?.click();
});
await page.waitForTimeout(800);
const ver = await page.evaluate(() => (document.body.innerText.match(/0\.1\.\d/g) ?? []).join(','));
console.log('VERSION_ON_PAGE:', ver);
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('检查更新'));
  b?.click();
});
let txt = '';
for (let k = 0; k < 12; k++) {
  await page.waitForTimeout(800);
  txt = await page.evaluate(() => (document.body.innerText.match(/(已是最新[^。\n]*|发现新版本|已就绪[^。\n]*|重启更新|更新失败[^\n]*)/g) ?? []).join('|'));
  if (txt) break;
}
console.log('CHECK_RESULT:', txt);
console.log(txt.includes('已是最新') && txt.includes('0.1.1') ? 'PASS 升级后已是最新(0.1.1)' : 'INFO 状态文案: ' + txt.slice(0, 80));
await browser.close();
