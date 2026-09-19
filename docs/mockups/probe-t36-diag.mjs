/* T36 诊断：P→H1 转换后 inline 补偿是否写入、是否被后续重渲染抹掉。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const APPDIR = 'E:/Hermes Agent工作空间/Septcats/apps/desktop';
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\t36d-ud';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\t36d-data';
const PORT = 9397;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process electron -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
killAll();
for (const d of [UD, ROOT]) rmSync(d, { recursive: true, force: true });
for (const d of [UD, ROOT]) mkdirSync(d, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT }), 'utf8');
const p = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await wait(1000); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
page.on('console', (m) => { if (m.text().includes('T36DBG') || m.type() === 'error') console.log('[console]', m.text().slice(0, 400)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
for (let k = 0; k < 25; k++) { if (await page.evaluate(() => document.querySelector('.app-side') !== null).catch(() => false)) break; await wait(800); }
await page.locator('.app-side').getByText(/新建页面|New Page/).first().click();
const input = page.locator('.app-side input').first();
await input.waitFor({ state: 'visible', timeout: 10000 });
await input.fill('诊断页');
await input.press('Enter');
await wait(1500);
await page.locator('.pv-body').first().click();
await page.keyboard.type('诊断文本', { delay: 30 });
await wait(1200);

const dump = (tag) => page.evaluate((t) => {
  const el = document.querySelector('.pv-body [data-id]');
  const node = el.firstChild ?? el;
  const rng = document.createRange(); rng.selectNodeContents(node);
  const tr = rng.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const view = el.closest('.pv-root');
  return {
    t, tag: el.tagName, styleAttr: el.getAttribute('style'),
    pt: cs.paddingTop, mt: cs.marginTop, mb: cs.marginBottom,
    line: { top: +tr.top.toFixed(2), bottom: +tr.bottom.toFixed(2) },
    scrollTop: view?.scrollTop,
  };
}, tag);

console.log('before:', JSON.stringify(await dump('before')));
// 挂 MutationObserver：抓 .ProseMirror 里 pre/blockquote/p 元素的重建与属性变更
await page.evaluate(() => {
  window.__mutlog = [];
  const pm = document.querySelector('.ProseMirror');
  const rm = Element.prototype.remove;
  Element.prototype.remove = function (...a) {
    if (this.closest?.('.ProseMirror') && this.tagName !== 'BR') {
      window.__mutlog.push(`REMOVE ${this.tagName} style=${this.getAttribute('style') ?? '-'}\n${String(new Error().stack).split('\n').slice(1, 14).join('\n')}`);
    }
    return rm.apply(this, a);
  };
  const nodeRm = Node.prototype.removeChild;
  Node.prototype.removeChild = function (n) {
    if (n?.nodeType === 1 && n.closest?.('.ProseMirror') && /^(P|PRE|BLOCKQUOTE|UL|OL|H1|H2|H3)$/.test(n.tagName)) {
      window.__mutlog.push(`RMCHILD ${n.tagName} style=${n.getAttribute('style') ?? '-'}\n${String(new Error().stack).split('\n').slice(1, 14).join('\n')}`);
    }
    return nodeRm.apply(this, [n]);
  };
  const nodeIns = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (n, ref) {
    if (n?.nodeType === 1 && /^(P|PRE|BLOCKQUOTE|UL|OL|H1|H2|H3)$/.test(n.tagName) && this.closest?.('.ProseMirror')) {
      window.__mutlog.push(`INSERT ${n.tagName}\n${String(new Error().stack).split('\n').slice(1, 14).join('\n')}`);
    }
    return nodeIns.apply(this, [n, ref]);
  };
  const ap = Element.prototype.append;
  const ac = Element.prototype.appendChild;
  Element.prototype.appendChild = function (n) {
    if (n?.nodeType === 1 && n.tagName !== 'BR' && this.closest?.('.ProseMirror') && /^(P|PRE|BLOCKQUOTE|UL|OL|H1|H2|H3)$/.test(n.tagName)) {
      window.__mutlog.push(`APPEND ${n.tagName} to ${this.tagName}\n${String(new Error().stack).split('\n').slice(1, 14).join('\n')}`);
    }
    return ac.apply(this, [n]);
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) if (n.nodeType === 1 && n.tagName !== 'BR') window.__mutlog.push(`+ ${n.tagName} t=${performance.now().toFixed(0)}`);
        for (const n of m.removedNodes) if (n.nodeType === 1 && n.tagName !== 'BR') window.__mutlog.push(`- ${n.tagName} t=${performance.now().toFixed(0)}`);
      } else if (m.type === 'attributes' && m.attributeName === 'style') {
        window.__mutlog.push(`~ ${m.target.tagName} style→${m.target.getAttribute('style') ?? '-'} t=${performance.now().toFixed(0)}`);
      }
    }
  }).observe(pm, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
});
// 先转引用（探得 quote 场景），再转代码块（主探针失败场景 BLOCKQUOTE→code）
await page.locator('.pv-body [data-id]').first().hover();
await wait(700);
await page.evaluate(() => {
  const b = document.querySelector('.sc-blockcontrol__handle');
  if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true }));
});
await wait(700);
await page.locator('.sc-blockcontrol__menu').getByText('引用', { exact: true }).first().click();
await wait(900);
console.log('after quote:', JSON.stringify(await dump('quote')));
await page.locator('.pv-body [data-id]').first().hover();
await wait(700);
await page.evaluate(() => {
  const b = document.querySelector('.sc-blockcontrol__handle');
  if (b) for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) b.dispatchEvent(new MouseEvent(t, { bubbles: true }));
});
await wait(700);
await page.locator('.sc-blockcontrol__menu').getByText('代码块', { exact: true }).first().click();
await wait(80);
console.log('after code 80ms:', JSON.stringify(await dump('code80')));
await wait(1200);
console.log('after code 1280ms:', JSON.stringify(await dump('code1280')));
// 决定性实验：落定后从外部写 style，看 80ms / 1500ms 后是否还在
await page.evaluate(() => {
  const el = document.querySelector('.pv-body [data-id]');
  el.style.paddingTop = '20px';
  el.style.marginTop = '5.5px';
});
await wait(80);
console.log('ext write +80ms:', JSON.stringify(await dump('ext80')));
await wait(1500);
console.log('ext write +1580ms:', JSON.stringify(await dump('ext1580')));
console.log('mutations:', JSON.stringify(await page.evaluate(() => window.__mutlog), null, 0).slice(0, 3600));
await br.close().catch(() => {});
killAll();
process.exit(0);
