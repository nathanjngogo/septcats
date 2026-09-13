/* PM 真机审计：DbView 对齐 mockup 03（token 实测值 + 布局溢出） */
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('index.html')) ?? ctx.pages()[0];
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

// 进 DbPage：点「转为数据库」
await page.locator('button', { hasText: '转为数据库' }).first().click();
await page.waitForTimeout(1000);
// 建两条记录让表格出来
await page.evaluate(async () => {
  const grid = document.querySelector('.sc-dbgrid');
  if (grid) return;
});
// EmptyState 的新建记录按钮建一条
const empty = page.locator('.sc-empty');
if (await empty.isVisible().catch(() => false)) {
  await empty.locator('button', { hasText: '新建记录' }).click();
  await page.waitForTimeout(600);
}
await page.waitForTimeout(400);

const probe = await page.evaluate(() => {
  const out = { found: {}, overflow: [], notes: [] };
  const cs = (sel, prop) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return getComputedStyle(el)[prop];
  };
  // 行高/表头高（mockup 03：36px 行、32px 表头、token layout.*）
  out.found.row = { h: cs('.sc-dbgrid__row', 'height'), lh: cs('.sc-dbgrid__row', 'lineHeight') };
  out.found.header = cs('.sc-dbgrid__head', 'height');
  out.found.grid = !!document.querySelector('.sc-dbgrid');
  out.found.propbar = !!document.querySelector('.sc-propbar');
  out.found.empty = !!document.querySelector('.sc-empty');
  out.found.skel = !!document.querySelector('.sc-skeleton, [class*=skeleton]');
  // 数字单元格右对齐+mono（§16）
  const num = document.querySelector('.sc-dbc-input--num, [class*=--num]');
  out.found.numAlign = num ? getComputedStyle(num).textAlign : 'no-num-cell';
  // 溢出扫描
  for (const el of document.querySelectorAll('.sc-dbgrid *, .sc-propbar *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (el.scrollWidth > r.width + 2)) {
      const st = getComputedStyle(el);
      if (st.overflow === 'visible' && st.whiteSpace !== 'nowrap' && !el.className.toString().includes('viewport')) {
        out.overflow.push(el.className + ' scrollW=' + String(el.scrollWidth) + ' boxW=' + String(Math.round(r.width)));
      }
    }
  }
  return out;
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
