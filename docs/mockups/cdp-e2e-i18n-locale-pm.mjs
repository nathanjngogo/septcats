/* PM 回归探针：i18n 语言解析 —— 缺陷 **T43-01-1**（P2，既有，非 T43-01 引入）

 症状：中文系统上把界面语言显式设为 English → **重启应用后回到中文**。
 根因：`setLocalePref('en-US')` 会**清掉** localePref 标记（i18n/index.ts:118-127），
       而 `initLocale` 在「无标记」时把 getLocalePref() 当作 'system' 走 systemLocale()
       分支并 **early return**（index.ts:136-139），**从不读 settings.locale**
       → 用户显式选择在重启后丢失。
 期望（修好后）：组合 B 应渲染**英文**。
 口径：四种组合各起一次，看界面实际渲染语言（非文件断言）。 */
const EXPECT = { A: 'zh-CN', B: 'en-US', C: 'en-US', D: 'zh-CN' };
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPDIR = 'E:\\Hermes Agent工作空间\\Septcats\\apps\\desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\diag-locale';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9421;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (pid) => { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch { /* */ } };

async function boot(prep) {
  killTree(0);
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${PORT}`], {
    cwd: APPDIR, detached: true, stdio: 'ignore',
  });
  child.unref();
  const deadline = Date.now() + 45000;
  let browser = null;
  while (Date.now() < deadline) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); break; } catch { await wait(700); }
  }
  if (browser === null) throw new Error('CDP 失败');
  let page = null;
  while (Date.now() < deadline) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('file://'));
    if (page !== null && page !== undefined) break;
    await wait(500);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await wait(1800);
  if (prep !== null) { await prep(page); await wait(600); await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await wait(2200); }
  const out = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      localePref: (() => { try { return localStorage.getItem('septcats.localePref'); } catch { return 'ERR'; } })(),
      lang: document.documentElement.getAttribute('lang'),
      nav: navigator.language,
      sidebarNewPageLabel: (document.querySelector('[data-testid="side-new-page"]')?.getAttribute('aria-label') ?? null),
      hasZh: txt.includes('新建') || txt.includes('设置') || txt.includes('同步'),
      hasEn: /New page|Settings|Search/i.test(txt),
      zhSample: (txt.match(/[\u4e00-\u9fff]+/g) ?? []).slice(1, 5).join('|'),
    };
  });
  await page.evaluate(() => { try { window.close(); } catch { /* */ } }).catch(() => {});
  await wait(1200);
  killTree(child.pid);
  await wait(800);
  return out;
}

rmSync(RUN, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({
  schema: 1, rootPath: ROOT, theme: 'light', locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true }, data: { note: '' },
  sync: { enabled: true, encrypt: false, gc: false },
}, null, 2), 'utf8');

console.log('夹具 settings.locale 初始 = zh-CN\n');

// A) 现状（无标记 + settings.locale=zh-CN）
console.log('A 无标记 + settings.locale=zh-CN  →', JSON.stringify(await boot(null)));

// B) 无标记 + settings.locale=en-US（模拟「显式选英文」后的重启）
console.log('B 无标记 + settings.locale=en-US  →', JSON.stringify(await boot(async (page) => {
  await page.evaluate(async () => {
    localStorage.removeItem('septcats.localePref');
    await window.septcats.settings.patch({ locale: 'en-US' });
  });
})));

// C) localePref=en-US + settings.locale=en-US
console.log('C localePref=en-US + settings=en-US →', JSON.stringify(await boot(async (page) => {
  await page.evaluate(async () => {
    localStorage.setItem('septcats.localePref', 'en-US');
    await window.septcats.settings.patch({ locale: 'en-US' });
  });
})));

// D) localePref=system + settings=en-US（模拟「跟随系统」标记）
console.log('D localePref=system + settings=en-US →', JSON.stringify(await boot(async (page) => {
  await page.evaluate(async () => {
    localStorage.setItem('septcats.localePref', 'system');
    await window.septcats.settings.patch({ locale: 'en-US' });
  });
})));