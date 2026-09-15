/* M10-B 端到端：打包版 0.1.0 经 UI 升级到 0.1.1（feed 已备好 pending 包） */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9224');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 150) : ''}`);
}

await page.waitForTimeout(1500);
check('CDP 连上打包应用', true, await page.title());

// 进设置页
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
  btn?.click();
});
await page.waitForTimeout(800);

// 关于区：找到检查更新按钮
const about = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('button'));
  const checkBtn = rows.find((b) => (b.textContent ?? '').includes('检查更新'));
  const verLine = Array.from(document.querySelectorAll('*')).find((el) => /0\.1\.0/.test(el.textContent ?? '') && el.children.length === 0);
  return { hasCheckBtn: !!checkBtn, ver: verLine ? verLine.textContent.slice(0, 40) : null };
});
check('设置页关于行显示 0.1.0 + 检查更新按钮', about.hasCheckBtn && (about.ver ?? '').includes('0.1.0'), JSON.stringify(about));

// 点检查更新（pending 已下载 → 期望直接到「已就绪」态）
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes('检查更新'));
  b.click();
});
let state = '';
for (let k = 0; k < 25; k++) {
  await page.waitForTimeout(700);
  state = await page.evaluate(() => document.body.innerText.match(/(发现新版本|下载中|已就绪[^。\n]*|重启更新|已是最新|更新失败[^\n]*)/g)?.join('|') ?? '');
  if (state.includes('重启更新') || state.includes('已就绪')) break;
}
check('状态机推进到「新版本已就绪/重启更新」', state.includes('重启更新') || state.includes('已就绪'), state.slice(0, 120));

// 点「重启更新」→ 确认 Dialog
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim() === '重启更新');
  b?.click();
});
await page.waitForTimeout(900);
const dlg = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"], dialog');
  const btn = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent ?? '').trim().match(/^(重启更新|确认|安装)$/));
  return { dialog: !!dialog, confirmText: btn ? btn.textContent.trim() : null };
});
check('确认对话框出现', dlg.dialog || dlg.confirmText !== null, JSON.stringify(dlg));
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[role="dialog"] button, dialog button'))
    .find((x) => (x.textContent ?? '').trim().match(/^(重启更新|确认|安装|重启)$/) ?? (x.textContent ?? '').includes('重启更新'));
  btn?.click();
});

// 应用退出→NSIS 静默装→自动重启。轮询版本变化（最多 120s）
await browser.close().catch(() => {});
let ver = '';
for (let k = 0; k < 40; k++) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    ver = execFileSync('powershell', ['-NoProfile', '-Command',
      '(Get-Item (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe")).VersionInfo.ProductVersion'],
      { encoding: 'utf8', timeout: 20000 }).trim();
  } catch { ver = 'ERR'; }
  if (ver.startsWith('0.1.1')) break;
}
check('升级到 0.1.1（文件版本实证）', ver.startsWith('0.1.1'), 'ProductVersion=' + ver);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== M10-B 升级主链 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} ==`);
process.exit(failed === 0 ? 0 : 1);
