/* T8 取证：面板/搜索页双主题截图 + 溢出扫描 */
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];
const OUT = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-real/';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

async function openPalette(q) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(250);
  const combo = page.locator('input[role="combobox"]');
  if (q) { await combo.fill(q); await page.waitForTimeout(450); }
}

for (const mode of ['light', 'dark']) {
  await page.evaluate((m) => window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: m } })), mode);
  await page.waitForTimeout(350);
  await openPalette('审计');
  await page.screenshot({ path: `${OUT}t8-palette-${mode}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 搜索页
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes('搜索'));
    btn?.click();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}t8-searchpage-${mode}.png` });
}

// 溢出扫描（面板开着 + 搜索页开着两种状态下各扫一次）
const overflow = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (el.scrollWidth > r.width + 2) {
      const st = getComputedStyle(el);
      if (st.overflowX === 'visible' && st.whiteSpace !== 'nowrap') {
        bad.push((el.className?.toString?.() ?? el.tagName) + ` sw=${String(el.scrollWidth)} w=${String(Math.round(r.width))}`);
      }
    }
  }
  return { doc: document.documentElement.scrollWidth > window.innerWidth, items: bad.slice(0, 6) };
});
console.log('SEARCHPAGE overflow:', JSON.stringify(overflow));
await browser.close();
