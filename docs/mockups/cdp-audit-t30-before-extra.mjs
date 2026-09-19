/* TASK-T30-01 症状③补充证据：小视口（模拟老板 DPI 缩放后的可视高度）下数据库页主区被裁剪比例。
 * 用 CDP Emulation.setDeviceMetricsOverride 压缩视口；同一 rc.5 修复前 exe。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t30b-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t30b-data';
const PORT = 9389;
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-t30';
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };

killAll();
rmSync(UD, { recursive: true, force: true });
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ }
}
const page = br.contexts()[0].pages()[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let k = 0; k < 25; k++) {
  if (await page.evaluate(() => typeof window.septcats?.pages?.create === 'function' && document.querySelector('.app-side') !== null).catch(() => false)) break;
  await wait(800);
}
await wait(1200);

// 小视口：1184x560（≈125% DPI 笔记本可视高度量级）
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1184, height: 560, deviceScaleFactor: 0, mobile: false });
await wait(600);

await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('T30小窗转库');
await input.press('Enter');
await wait(2000);
await page.getByRole('button', { name: /转为数据库|Convert to Database/ }).click();
await wait(1800);
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建记录')); if (b) b.click(); });
  await wait(200);
}
await wait(1000);

const m = await page.evaluate(() => {
  const se = document.scrollingElement;
  const main = document.querySelector('.sc-shell__main');
  const r = main.getBoundingClientRect();
  const vh = se.clientHeight;
  const below = Math.max(r.bottom - vh, 0);
  const above = Math.max(-r.top, 0);
  let nulls = 0, total = 0;
  for (let iy = 0; iy < 10; iy++) {
    for (let ix = 0; ix < 10; ix++) {
      const x = r.left + ((ix + 0.5) * r.width) / 10;
      const y = r.top + ((iy + 0.5) * r.height) / 10;
      if (document.elementFromPoint(x, y) === null) nulls++;
      total++;
    }
  }
  return {
    viewportH: vh, winScrollH: se.scrollHeight, windowScrollable: se.scrollHeight > vh + 1,
    mainTop: r.top, mainBottom: r.bottom,
    clippedBelow: below, clippedBelowPct: Number(((below / vh) * 100).toFixed(1)),
    samplesOutsideViewport: `${String(nulls)}/${String(total)}`,
  };
});
console.log('=== T30 BEFORE-EXTRA (viewport 1184x560, DB page, 12 records) ===');
console.log(JSON.stringify(m, null, 2));
await page.screenshot({ path: `${SHOTS}/before-7-db-smallvp.png` });
killAll();
