/* PM 工具：mockup 截图（浅/深 + 桌面壳）。用法（在装有 playwright-core 的目录运行，NODE_PATH 指过去）：
   node shots.mjs <html文件...> */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(scriptDir, 'screens');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
for (const f of process.argv.slice(2)) {
  const abs = resolve(f);
  const url = 'file:///' + abs.replace(/\\/g, '/');
  for (const theme of ['light', 'dark']) {
    await page.goto(url);
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(150);
    const name = `${basename(abs, '.html')}.${theme}.png`;
    await page.screenshot({ path: resolve(outDir, name) });
    console.log('shot', name);
  }
}
await browser.close();
