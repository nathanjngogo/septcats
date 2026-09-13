import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];
const OUT = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-real/';
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
for (const mode of ['light', 'dark']) {
  await page.evaluate((m) => window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: m } })), mode);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
    btn?.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}t10-settings-${mode}.png` });
  // 回编辑器以便下一次干净进设置页
  await page.evaluate(() => window.history.back?.());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}
console.log('shots done');
await browser.close();
