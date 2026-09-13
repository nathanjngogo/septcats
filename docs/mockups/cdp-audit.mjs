/* PM 真机验收：attach 运行中的 Electron 渲染器，审查 T5 编辑器实际渲染 */
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const ctx = browser.contexts()[0];
const pages = ctx.pages();
console.log('targets:', pages.map((p) => p.url().slice(0, 60)));
const page = pages.find((p) => p.url().includes('localhost')) ?? pages[0];

const report = await page.evaluate(() => {
  const out = {};
  const pm = document.querySelector('.ProseMirror');
  out.pmFound = Boolean(pm);
  if (pm) {
    const blocks = [...pm.children].map((n) => n.getAttribute('class') || n.tagName);
    out.blockCount = pm.children.length;
    out.blockClasses = blocks.slice(0, 12);
    out.textSample = pm.textContent.slice(0, 80);
    // 字体与字号（token 生效证据）
    const first = pm.querySelector('p, h1, h2, h3');
    if (first) {
      const cs = getComputedStyle(first);
      out.bodyFont = cs.fontFamily.slice(0, 40);
      out.bodySize = cs.fontSize;
      out.bodyLine = cs.lineHeight;
      out.color = cs.color;
      out.bg = getComputedStyle(document.body).backgroundColor;
    }
    // code 块渲染（codeBlock 节点名生效证据）
    out.codeEl = Boolean(pm.querySelector('pre'));
    // 标题层级
    out.headings = [...pm.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ':' + h.textContent.slice(0, 10));
  }
  // 侧栏 + 顶栏（T4 壳）
  out.topbar = document.querySelectorAll('[class*="topbar"], header').length;
  out.sidebarText = (document.querySelector('[class*="sidebar"], aside')?.textContent ?? '').slice(0, 40);
  // 控制台错误兜底：React 崩溃边界会留 error 元素
  out.errorOverlay = document.body.textContent.includes('Uncaught') || document.body.textContent.includes('Cannot read');
  return out;
});
console.log(JSON.stringify(report, null, 1));

// 控制台报错：不 reload（reload 在 dev 环境会换 target 导致连接断），直接监听当前页
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.waitForTimeout(2500);
console.log('pageerrors:', errors.length ? errors : 'none');
await page.screenshot({ path: 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens/app-t5-editor.png' });
// connectOverCDP 的 close() 会杀掉 Electron 进程；直接退出脚本让 socket 自然断开
process.exit(0);
