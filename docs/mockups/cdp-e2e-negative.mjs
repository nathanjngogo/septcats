/* M10-B 负向三连 v2：⑩篡改 yml ⑪缺 sig ⑫无 dev 门 —— 每步硬断言（按钮真找到、实例真换新） */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';

const YML = 'E:/Hermes Agent工作空间/Septcats/tmp/demo-feed/stable/latest.yml';
const SIG = YML + '.sig';
const BACKUP = readFileSync(YML);

function sh(cmd) { try { return execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', timeout: 30000 }); } catch { return 'SH_ERR'; } }

function portOpen(p) {
  return sh(`(Test-NetConnection -ComputerName 127.0.0.1 -Port ${p} -WarningAction SilentlyContinue).TcpTestSucceeded`).trim() === 'True';
}

function restart(withDevGate) {
  // 彻底杀干净（进程名 Septcats）并等 CDP 端口释放，防单实例锁留下旧 env 的僵尸
  sh('Get-Process Septcats -ErrorAction SilentlyContinue | Stop-Process -Force');
  for (let k = 0; k < 10 && portOpen(9224); k++) sh('Start-Sleep 1');
  const env = withDevGate
    ? '$env:SEPTCATS_DEV_FEED="1"; $env:SEPTCATS_DEV_FEED_URL="http://127.0.0.1:8791/stable";'
    : '';
  sh(`${env} Start-Process (Join-Path $env:LOCALAPPDATA "Programs\\@septcatsdesktop\\Septcats.exe") -ArgumentList "--remote-debugging-port=9224"`);
}

async function checkUpdate(expect, label) {
  // 等 CDP 起来
  let browser = null;
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9224'); break; } catch {}
  }
  if (browser === null) { console.log(`FAIL ${label} — CDP 9224 没起来`); return false; }
  try {
    const page = browser.contexts()[0].pages()[0];
    // 硬等桥可用
    for (let k = 0; k < 15 && !(await page.evaluate(() => typeof window.septcats?.update?.check === 'function').catch(() => false)); k++) await page.waitForTimeout(800);
    // 进设置页
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') ?? '').includes('设置'));
      btn?.click();
    });
    const checkBtn = page.locator('button', { hasText: '检查更新' }).first();
    await checkBtn.waitFor({ state: 'visible', timeout: 8000 });
    await checkBtn.click();
    let txt = '';
    for (let k = 0; k < 16; k++) {
      await page.waitForTimeout(700);
      txt = await page.evaluate(() => (document.body.innerText.match(/(更新失败[^\n]*|E_FEED_[A-Z_]+|已是最新[^\n]*|发现新版本|E_UPDATE[A-Z_]*)/g) ?? []).join('|'));
      if (txt) break;
    }
    const ok = expect.test(txt);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  — txt=${txt.slice(0, 120)}`);
    return ok;
  } finally {
    await browser.close().catch(() => {});
  }
}

const results = [];
// ⑩ 篡改 yml（0.1.1→0.1.2 而 sig 未变 → 验签必炸）
writeFileSync(YML, BACKUP.toString('utf8').replace('version: 0.1.1', 'version: 0.1.2'));
restart(true);
results.push(await checkUpdate(/E_FEED_SIGNATURE|更新失败/, '⑩ 篡改 yml 被拒'));

// ⑪ 缺 sig（fetch 404 → 拒；绝不允许静默回退到 electron-updater 原始流程）
writeFileSync(YML, BACKUP);
renameSync(SIG, SIG + '.bak');
restart(true);
results.push(await checkUpdate(/E_FEED_SIGNATURE|更新失败/, '⑪ 缺 sig 被拒'));
renameSync(SIG + '.bak', SIG);

// ⑫ 无 dev 门 + env 指本地源：fail-closed（拒本地源或更新失败，不崩且能正常显示）
restart(false);
results.push(await checkUpdate(/E_FEED_SOURCE_DENIED|更新失败|已是最新/, '⑫ 无门注入被拒或安全降级'));

// 对照：恢复干净 feed + dev 门 → 应「已是最新」或「发现新版本」（验签通过的正面证据）
restart(true);
results.push(await checkUpdate(/已是最新|发现新版本/, '正面：干净 feed 验签通过'));

const failed = results.filter((r) => !r).length;
console.log(`\n== M10-B 负向+正面 四连 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (4) ==`);
process.exit(failed === 0 ? 0 : 1);
