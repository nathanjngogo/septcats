import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('localhost:5173')) ?? ctx.pages()[0];
const logs = [];
page.on('console', (m) => logs.push(m.type() + ':' + String(m.text()).slice(0, 140)));
page.on('pageerror', (e) => logs.push('PAGEERR:' + String(e).slice(0, 140)));
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2000);
const info = await page.evaluate(() => ({
  septcats: typeof window.septcats,
  importApi: typeof window.septcats?.import?.plan,
  updateApi: typeof window.septcats?.update?.check,
  settingsApi: typeof window.septcats?.settings?.get,
}));
console.log('API:', JSON.stringify(info));
console.log('logs:', logs.slice(0, 6).join(' | '));
await browser.close();
