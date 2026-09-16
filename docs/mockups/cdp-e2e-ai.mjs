/* T18-03 真机 CDP 验收：编辑器块级 AI 动作（PM 跑）。
 * 两层：
 *   · 离线层（默认跑）：本地起一个 OpenAI 兼容 mock 服务（/v1/models + /v1/chat/completions），
 *     settings.patch 配好 provider → 走真 IPC 全链路（main→HTTP→mock），断言摘要应用后
 *     块文本变化 + 未配置空态引导。不 monkey-patch window.septcats.ai.chat（contextBridge
 *     暴露对象不可写，mock 服务层覆盖面更长：连 main 侧 client 一并覆盖）。
 *   · 真机层（SEPTCATS_AI_REAL=1 才跑）：LM Studio 已启动（127.0.0.1:1234），设置页
 *     「测试连接」出成功文案 + 真模型生成→应用→块文本变化。
 * 断言项对齐 TASK-T18-03 §4：设置页 AI 区块渲染/开关/provider 测试连接、面板出现→
 * 结果非空→应用→块文本变化、未配置空态引导 + 「打开设置」可点、pageerror 计数 0、
 * 截图双主题各 1 张（设置页 + 面板）→ docs/mockups/screens-ai/。
 * 用法：node docs/mockups/cdp-e2e-ai.mjs            （离线层）
 *       SEPTCATS_AI_REAL=1 node docs/mockups/cdp-e2e-ai.mjs （离线层 + 真机层）
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE_PATH = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const ROOT = 'E:\\Hermes Agent工作空间\\_scratch\\ai-root';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\ai-ud';
const DEBUG_PORT = 9233;
const MOCK_PORT = 18099;
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}`;
const MOCK_TEXT = 'AI离线摘要结果（mock）：要点一、要点二。';
const REAL = process.env.SEPTCATS_AI_REAL === '1';
const LMSTUDIO_BASE = 'http://127.0.0.1:1234';
const SHOTS = resolve(HERE, 'screens-ai');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 170) : ''}`);
}

function killAll() {
  try {
    execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' });
  } catch { /* 无进程时非零退出，忽略 */ }
}

function fresh() {
  killAll();
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(UD, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
  mkdirSync(UD, { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  // 文件名 = platform SETTINGS_FILE_NAME（septcats.settings.json，写错名=rootPath 被静默忽略）
  writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: ROOT, theme: 'system' }), 'utf8');
}

/** OpenAI 兼容 mock：GET /v1/models + POST /v1/chat/completions（固定摘要文案）。 */
function startMock() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && (req.url ?? '').includes('/v1/models')) {
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }
    if (req.method === 'POST' && (req.url ?? '').includes('/v1/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: MOCK_TEXT } }] }));
      });
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  server.listen(MOCK_PORT, '127.0.0.1');
  return server;
}

async function connect(port) {
  for (let k = 0; k < 25; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${String(port)}`); } catch { /* retry */ }
  }
  return null;
}

async function bridgeReady(br) {
  const page = br.contexts()[0].pages()[0];
  for (let k = 0; k < 20; k++) {
    if (await page.evaluate(() => typeof window.septcats?.ai?.state === 'function').catch(() => false)) return page;
    await new Promise((r) => setTimeout(r, 800));
  }
  return page;
}

async function clickButtonByText(page, text) {
  return page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label));
    if (button === undefined) return false;
    button.click();
    return true;
  }, text);
}

async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  // 返回「最后一次计算值」而非布尔 true：调用方有按值比较（=== MOCK_TEXT）的断言，
  // 旧实现恒回 true 会把成功判成 FAIL（假红，缺陷 #27/#31 同族）。
  return last;
}

async function configureAi(page, baseUrl, model) {
  return page.evaluate(async ({ baseUrl: url, model: m }) => {
    await window.septcats.settings.patch({
      ai: {
        enabled: true,
        cloudConsent: false,
        activeProviderId: 'mock1',
        providers: [{ id: 'mock1', kind: 'openai-compatible', name: 'Mock', baseUrl: url, model: m }],
      },
    });
    return await window.septcats.ai.state();
  }, { baseUrl, model });
}

async function triggerSummarize(page) {
  // 光标进第一个段落（无选中 → 块文本回退路径），再派发命令面板同款事件
  await page.evaluate(() => {
    const paragraph = document.querySelector('.pv-body .ProseMirror p');
    if (paragraph !== null) {
      paragraph.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    window.dispatchEvent(new CustomEvent('septcats:ai-action', { detail: { action: 'summarize' } }));
  });
}

fresh();
const mockServer = startMock();
const proc = spawn(EXE_PATH, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(DEBUG_PORT)}`], { detached: true, stdio: 'ignore' });
proc.unref();
const br = await connect(DEBUG_PORT);
check('CDP 连上 dev 实例', !!br);
if (!br) {
  mockServer.close();
  console.log('== T18-03 AI CDP 前置即崩 ==');
  process.exit(1);
}
const page = await bridgeReady(br);
const pageErrors = [];
page.on('pageerror', (error) => { pageErrors.push(String(error)); });

// ── 离线层 ─────────────────────────────────────────────────────────────
const state = await configureAi(page, MOCK_BASE, 'mock-model').catch((e) => 'ERR ' + String(e).slice(0, 100));
check('settings.patch 配 provider 后 ai.state() enabled + 1 provider', typeof state === 'object' && state.enabled === true && state.providers.length === 1, JSON.stringify(state).slice(0, 120));

const before = await page.evaluate(() => document.querySelector('.pv-body .ProseMirror p')?.textContent ?? '');
await triggerSummarize(page);
const panelOk = await waitFor(async () => page.evaluate(() => document.querySelector('.ai-panel__result')?.textContent ?? ''), 15_000);
check('面板出现且结果区非空（mock 全链路）', panelOk === MOCK_TEXT, `before=${String(before).slice(0, 40)} result=${String(panelOk).slice(0, 60)}`);
await page.screenshot({ path: join(SHOTS, 'panel-light.png') });

await clickButtonByText(page, '应用');
const after = await waitFor(async () => {
  const text = await page.evaluate(() => document.querySelector('.pv-body .ProseMirror p')?.textContent ?? '');
  return text === MOCK_TEXT ? text : false;
}, 8_000);
check('点「应用」→ 块文本变为结果（TipTap transaction + 既有保存路径）', after === MOCK_TEXT, String(after).slice(0, 60));

// 深色主题面板截图（走 ThemeProvider 同款事件管道）
await page.evaluate(() => window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: 'dark' } })));
await new Promise((r) => setTimeout(r, 600));
await triggerSummarize(page);
const darkPanel = await waitFor(async () => page.evaluate(() => document.querySelector('.ai-panel__result')?.textContent ?? ''), 15_000);
check('深色主题面板再次出结果', darkPanel === MOCK_TEXT);
await page.screenshot({ path: join(SHOTS, 'panel-dark.png') });
await clickButtonByText(page, '取消');
await waitFor(async () => page.evaluate(() => document.querySelector('.ai-panel__result') === null), 5_000);

// ── 未配置路径（空态引导）──────────────────────────────────────────────
await page.evaluate(async () => { await window.septcats.settings.patch({ ai: { enabled: false } }); });
await triggerSummarize(page);
const emptyShown = await waitFor(async () => page.evaluate(() => (document.querySelector('.ai-panel__empty')?.textContent ?? '').includes('AI 功能尚未启用')), 8_000);
check('未配置 → 空态引导文案出现（needEnable）', emptyShown);
await page.screenshot({ path: join(SHOTS, 'empty-dark.png') });
const settingsClicked = await clickButtonByText(page, '打开设置');
const inSettings = await waitFor(async () => page.evaluate(() => (document.body.textContent ?? '').includes('外观')), 8_000);
check('「打开设置」可点 → 跳到设置页', settingsClicked && inSettings);
await page.screenshot({ path: join(SHOTS, 'settings-dark.png') });

// ── 真机层（SEPTCATS_AI_REAL=1，LM Studio 已启动）─────────────────────
if (REAL) {
  const models = await page.evaluate(async () => {
    await window.septcats.settings.patch({
      ai: {
        enabled: true,
        activeProviderId: 'mock1',
        providers: [{ id: 'mock1', kind: 'openai-compatible', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234', model: null }],
      },
    }).catch(() => null);
    return await window.septcats.ai.listModels({ providerId: 'mock1', refresh: true }).catch((e) => 'ERR ' + String(e).slice(0, 80));
  }).catch((e) => 'ERR ' + String(e).slice(0, 100));
  const realModel = typeof models === 'object' && models.models.length > 0 ? models.models[0] : null;
  check('真机层：LM Studio /v1/models 可达', realModel !== null, JSON.stringify(models).slice(0, 100));
  if (realModel !== null) {
    await configureAi(page, LMSTUDIO_BASE, realModel);
    // AiSection 只在 mount 拉 ai.state()；上面是「旁路 patch」（绕过 UI 开关），
    // 必须 reload 让设置页重新挂载读到新状态，否则行卡片仍是旧态（enabled=false → 按钮禁用）。
    await page.reload();
    await bridgeReady(br);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('septcats:open-settings')));
    const settingsMounted = await waitFor(
      async () => page.evaluate(() => (document.body.textContent ?? '').includes('AI 助手')),
      15_000,
    );
    const testClicked = await clickButtonByText(page, '测试连接');
    const testOk = await waitFor(
      async () => page.evaluate(() => (document.body.textContent ?? '').includes('已连接')),
      60_000,
    );
    check('设置页「测试连接」成功文案出现', settingsMounted && testClicked && testOk,
      `mounted=${String(settingsMounted)} clicked=${String(testClicked)}`);
    await page.screenshot({ path: join(SHOTS, 'settings-real-light.png') });

    // 回编辑器：reload 回默认视图（设置视图里没有 .pv-body，事件会没人接）
    await page.reload();
    await bridgeReady(br);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('septcats:theme-mode', { detail: { mode: 'light' } })));
    const editorReady = await waitFor(
      async () => page.evaluate(() => document.querySelector('.pv-body .ProseMirror p') !== null),
      20_000,
    );
    check('真机层：reload 后编辑器视图就绪', editorReady);
    await triggerSummarize(page);
    const realResult = await waitFor(async () => {
      return await page.evaluate(() => {
        const result = document.querySelector('.ai-panel__result')?.textContent ?? '';
        if (result.length > 0) return result;
        const err = document.querySelector('.ai-panel__error')?.textContent ?? '';
        return err.length > 0 ? 'ERR:' + err : false; // 失败时回显错误原文（诊断用）
      });
    }, 120_000, 1_000);
    check('真机层：LM Studio 生成结果非空', typeof realResult === 'string' && !realResult.startsWith('ERR:'), String(realResult).slice(0, 90));
    if (realResult !== false) {
      const beforeReal = await page.evaluate(() => document.querySelector('.pv-body .ProseMirror p')?.textContent ?? '');
      await clickButtonByText(page, '应用');
      const changed = await waitFor(async () => {
        const text = await page.evaluate(() => document.querySelector('.pv-body .ProseMirror p')?.textContent ?? '');
        return text !== beforeReal && text.length > 0;
      }, 8_000);
      check('真机层：应用后块文本变化', changed);
    }
  }
}

check('pageerror 计数 0', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await br.close().catch(() => {});
mockServer.close();
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T18-03 AI CDP（${REAL ? '离线+真机' : '离线'}层）${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);
