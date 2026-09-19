/* 归因 A/B：协作层报错是否只发生在「无编辑器的页被重新进入」这个既有模式？
 场景：打开 X（无编辑器页）→ 打开另一个普通页 → 回到 X → 看 console 错误。
 A：X = 转为数据库的页（既有路径，T7b）
 B：X = 转为 Wiki 的页（T42-01 新路径）
 若 A 也报错 → 属既有模式通病（非 T42-01 引入）。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPDIR = 'E:\\Hermes Agent工作空间\\Septcats\\apps\\desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* */ } };

async function runCase(kind, port) {
  const RUN = `E:\\Hermes Agent工作空间\\_scratch\\diag-rv-${kind}`;
  const UD = `${RUN}\\ud`;
  const ROOT = `${RUN}\\data`;
  rmSync(RUN, { recursive: true, force: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
    schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' },
    sync: { enabled: true, encrypt: false, gc: false },
  }, null, 2), 'utf8');

  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${port}`], {
    cwd: APPDIR, detached: true, stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 45000;
  let browser = null;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { await wait(700); }
  }
  let page = null;
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file://'));
    if (page !== null && page !== undefined) break;
    await wait(500);
  }
  let step = 'boot';
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[${step}] ${m.text().split('\n')[0].slice(0, 120)}`); });
  page.on('pageerror', (e) => errs.push(`[${step}] PAGEERROR ${String(e).split('\n')[0].slice(0, 120)}`));
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(2200);

  const mk = async (title) => {
    await page.getByTestId('side-new-page').click().catch(() => {});
    const nm = page.locator('.app-side input').first();
    if ((await nm.count()) > 0) { await nm.fill(title); await nm.press('Enter'); await wait(1500); }
    return page.evaluate((t) => {
      const rows = [...document.querySelectorAll('[data-testid^="side-node-"]')];
      const r = rows.find((el) => (el.textContent ?? '').includes(t));
      return r === undefined ? null : (r.getAttribute('data-testid') ?? '').replace('side-node-', '');
    }, title);
  };
  const open = async (id) => {
    const el = page.locator(`[data-testid="side-node-${id}"]`).first();
    if ((await el.count()) > 0) { await el.click().catch(() => {}); await wait(1500); return true; }
    return false;
  };

  step = '1-建 X 页并打字';
  const xid = await mk('X页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await page.keyboard.type('X正文', { delay: 20 });
  await wait(1500);
  step = '2-建 Y 页（普通对照）';
  const yid = await mk('Y页');
  await page.locator('.pv-body .ProseMirror').first().click().catch(() => {});
  await page.keyboard.type('Y正文', { delay: 20 });
  await wait(1500);

  step = `3-把 X 转为${kind === 'db' ? '数据库' : 'Wiki'}`;
  await open(xid);
  let converted = false;
  if (kind === 'db') {
    const btn = page.locator('button', { hasText: '转为多维数据' }).first();
    if ((await btn.count()) > 0) { await btn.click().catch(() => {}); converted = true; }
  } else {
    await page.locator(`[data-testid="side-more-${xid}"]`).first().hover().catch(() => {});
    await page.locator(`[data-testid="side-more-${xid}"]`).first().click({ force: true }).catch(() => {});
    await wait(700);
    const it = page.locator('[role="menuitem"]', { hasText: '转为 Wiki' }).first();
    if ((await it.count()) > 0) { await it.click().catch(() => {}); converted = true; }
  }
  await wait(2400);
  const errAtConvert = errs.length;
  const st1 = await page.evaluate(() => ({
    wiki: document.querySelector('.wiki-body') !== null,
    db: document.querySelector('.dbpage') !== null,
  }));

  // 关键：离开 X → 去 Y → 回到 X
  step = '4-去 Y 页';
  await open(yid);
  await wait(1500);
  const errAtY = errs.length;
  step = '5-回到 X 页（无编辑器页重进）';
  await open(xid);
  await wait(2600);
  const errAtBack = errs.length;

  await page.evaluate(() => { try { window.close(); } catch { /* */ } }).catch(() => {});
  await wait(1200);
  killTree(child.pid);
  await wait(700);
  return { kind, converted, xState: st1, errAtConvert, errAtY, errAtBack, errs };
}

const a = await runCase('db', 9451);
console.log('=== A：X = 转为数据库的页（既有路径）===');
console.log(`  converted=${a.converted} state=${JSON.stringify(a.xState)}`);
console.log(`  错误累计：转换后 ${a.errAtConvert} / 去 Y 后 ${a.errAtY} / **回到 X 后 ${a.errAtBack}**`);
for (const e of a.errs) console.log('   ', e);

const b = await runCase('wiki', 9452);
console.log('\n=== B：X = 转为 Wiki 的页（T42-01 新路径）===');
console.log(`  converted=${b.converted} state=${JSON.stringify(b.xState)}`);
console.log(`  错误累计：转换后 ${b.errAtConvert} / 去 Y 后 ${b.errAtY} / **回到 X 后 ${b.errAtBack}**`);
for (const e of b.errs) console.log('   ', e);

console.log('\n=== 归因结论 ===');
console.log(`  A（库页重进）报错 ${a.errAtBack} 条 → ${a.errAtBack > 0 ? '既有模式通病' : '干净'}`);
console.log(`  B（wiki 页重进）报错 ${b.errAtBack} 条 → ${b.errAtBack > 0 ? '报错' : '干净'}`);