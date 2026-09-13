/* PM 工具：mockup 布局审计（溢出/重叠/token 生效/双主题） */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const f of process.argv.slice(2)) {
  await page.goto(pathToFileURL(resolve(f)).href);
  const light = await page.evaluate(() => {
    const vp = { w: innerWidth, h: innerHeight };
    const issues = [];
    if (document.documentElement.scrollWidth > vp.w + 1) issues.push('H-SCROLL:' + document.documentElement.scrollWidth);
    const rects = {};
    for (const sel of ['.menu', '.floating', '.overlay', '.palette', '.alertbar']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      rects[sel] = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
      if (b.right > vp.w + 1 || b.bottom > vp.h + 1 || b.x < -1 || b.y < -1) issues.push('OFFSCREEN:' + sel);
    }
    const m = document.querySelector('.menu'), fb = document.querySelector('.floating');
    if (m && fb) {
      const a = m.getBoundingClientRect(), b = fb.getBoundingClientRect();
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) issues.push('MENU-BAR-OVERLAP');
    }
    const cs = getComputedStyle(document.body);
    return { issues, rects, bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily.slice(0, 30) };
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(80);
  const dark = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { bg: cs.backgroundColor, color: cs.color };
  });
  console.log(resolve(f).split(/[\\/]/).pop(), JSON.stringify({ light, dark }));
}
await browser.close();
