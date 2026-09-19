/* TASK-T38-01 真机取证：AI 对话面板（右侧可收起 · 多轮 · 历史/面板态持久化 · 双主题 · 回归红线）。
 *
 * 口径（参照 docs/mockups/cdp-audit-t37.mjs）：
 * - 直接以 electron . 跑仓库已有的 out/（不重打包、不改产品源码）；
 * - 独立夹具根：--user-data-dir 与 rootPath 都在 _scratch/probe-t38-run/ 下，
 *   绝不触碰 C:\Users\Administrator\.septcats\（真实数据根）；
 * - 优雅退出 = window.close()（localStorage 尾部落盘），仅在窗口关不掉时对
 *   **本进程 PID 树** taskkill（不做全局 electron 强杀——同机可能有别的探针在跑）；
 * - 探针自种的 provider 指向本机未监听端口 http://127.0.0.1:45999（本地端点，
 *   不经云端门禁；ECONNREFUSED 即失败），全程零外网。
 *
 * 断言：面板存在/收展像素、面板态持久化（重启）、历史落盘与重启还原、
 * 零 pageerror、双主题截图、T30/T37 回归红线。
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_FROM_SCRIPT = join(SCRIPT_DIR, '..', '..');
/** 仓库根（本机主检出）：worktree 内无 node_modules/out/，只能跑主检出的已构建产物。 */
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO_FROM_SCRIPT, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO_FROM_SCRIPT, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t38-run';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9398;
const SHOTS = join(REPO_FROM_SCRIPT, 'docs', 'mockups', 'screens-t38');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const PROBE_ENDPOINT = 'http://127.0.0.1:45999';
const MSG = 'T38 探针消息：请引用当前页第一个块。';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  ${name}  — ${String(raw)}`);
};

/** 只杀本探针 own 的 electron 进程树（不做全局 kill）。 */
const killTree = (pid) => {
  if (typeof pid !== 'number') return;
  try {
    execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 进程已退出 */
  }
};
const alive = (pid) => {
  if (typeof pid !== 'number') return false;
  try {
    const out = execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
};

const consoleErrors = [];
const pageErrors = [];
const attach = (page, tag) => {
  page.on('pageerror', (err) => {
    pageErrors.push(`[${tag}] ${String(err?.message ?? err)}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`);
  });
};

const launched = [];
async function launch(tag) {
  const proc = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: APPDIR, detached: true, stdio: 'ignore' },
  );
  proc.unref();
  launched.push(proc.pid);
  let br = null;
  for (let k = 0; k < 30 && br === null; k++) {
    await wait(1000);
    try {
      br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      /* retry */
    }
  }
  if (br === null) throw new Error('CDP connect failed');
  const page = br.contexts()[0].pages()[0];
  attach(page, tag);
  for (let k = 0; k < 30; k++) {
    const ready = await page
      .evaluate(
        () =>
          document.querySelector('.app-side') !== null &&
          typeof window.septcats?.pages?.create === 'function',
      )
      .catch(() => false);
    if (ready) break;
    await wait(800);
  }
  await wait(1500);
  return { br, page, pid: proc.pid };
}

/** 优雅退出：window.close() → 等落盘；窗口关不掉才对本 PID 树兜底。 */
async function quit(page, pid) {
  try {
    await page.evaluate(() => window.close());
  } catch {
    /* 页面已销毁 */
  }
  await wait(2500);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  await wait(1200);
  return { gracefulExited: !stillAlive };
}

const MEASURE = () =>
  document.querySelector('.app-side') === null
    ? { boot: false }
    : (() => {
        const rect = (sel) => {
          const el = document.querySelector(sel);
          if (el === null) return null;
          const r = el.getBoundingClientRect();
          const round = (n) => Math.round(n * 100) / 100;
          return { w: round(r.width), h: round(r.height), left: round(r.left), right: round(r.right) };
        };
        const se = document.scrollingElement;
        return {
          boot: true,
          panelCount: document.querySelectorAll('.ai-chat').length,
          panel: rect('.ai-chat'),
          editorCol: rect('.app-editor-col'),
          mainRow: rect('.app-main-row'),
          sidebar: rect('.sc-shell__sidebar'),
          tabsbarCount: document.querySelectorAll('.tabsbar').length,
          tabCount: document.querySelectorAll('.tabsbar-tab').length,
          winW: window.innerWidth,
          winH: window.innerHeight,
          overflowY: se.scrollHeight - se.clientHeight,
          scrollY: window.scrollY,
          theme: document.documentElement.dataset.theme ?? 'unset',
        };
      })();

const measure = (page) => page.evaluate(MEASURE);

const STORAGE = () => {
  const out = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k !== null) out[k] = localStorage.getItem(k);
  }
  const histKey = Object.keys(out).find((k) => k.startsWith('septcats.aichat.history.'));
  let hist = null;
  if (histKey !== undefined) {
    try {
      hist = JSON.parse(out[histKey]);
    } catch {
      hist = 'parse-error';
    }
  }
  return {
    panelRaw: out['septcats.aichat.panel'] ?? null,
    allKeys: Object.keys(out),
    histKey: histKey ?? null,
    histCount: Array.isArray(hist?.messages) ? hist.messages.length : null,
    histRoles: Array.isArray(hist?.messages) ? hist.messages.map((m) => m.role) : null,
    histTexts: Array.isArray(hist?.messages) ? hist.messages.map((m) => m.content) : null,
    histRawLen: histKey !== undefined ? out[histKey].length : null,
    hasSecret: /sk-|Bearer /.test(JSON.stringify(out)),
  };
};
const storage = (page) => page.evaluate(STORAGE);

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const shots = [];
const shot = async (page, name) => {
  const buf = await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  const size = pngSize(buf);
  shots.push({ file: `${name}.png`, width: size.w, height: size.h, bytes: buf.length });
  return size;
};

const setTheme = async (page, theme) => {
  await page.evaluate((th) => {
    document.documentElement.dataset.theme = th;
  }, theme);
  await wait(500);
};

const mtime = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return 'absent';
  }
};

// ---------------------------------------------------------------------------
const realRootBefore = mtime(REAL_ROOT);
killTree(undefined);
rmSync(RUN, { recursive: true, force: true });
rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

/** 夹具 settings：独立 rootPath + 可用 AI（本地未监听端点）——不写真实数据根。 */
const settings = {
  schema: 1,
  rootPath: ROOT,
  theme: 'light',
  locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' },
  sync: { enabled: true, encrypt: false, gc: false },
  ai: {
    enabled: true,
    cloudConsent: false,
    activeProviderId: 'probe-local',
    providers: [
      { id: 'probe-local', kind: 'lmstudio', name: 'Probe Local', baseUrl: PROBE_ENDPOINT, model: 'probe' },
    ],
  },
};
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify(settings, null, 2), 'utf8');
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\nSHOTS=${SHOTS}\n`);

// ======================= 第 1 次启动 =======================
const r1 = await launch('run1');
const page = r1.page;

// 建一页并落一段文字（给对话上下文一个真实页面）
await page.getByTestId('side-new-page').click();
const nameInput = page.locator('.app-side input').first();
await nameInput.waitFor({ state: 'visible', timeout: 15000 });
await nameInput.fill('T38 探针页');
await nameInput.press('Enter');
await wait(900);
await page.locator('.pv-body').first().click();
await page.keyboard.type('探针页面第一段文字。', { delay: 25 });
await wait(1200);

// ① 基线（收起态）
const base = await measure(page);
check('① 基线：面板 DOM 不存在（收起）', base.panelCount === 0 && base.panel === null,
  `panelCount=${String(base.panelCount)} panelRect=${JSON.stringify(base.panel)}`);
info('① 基线主编辑列 .app-editor-col 宽度', `${String(base.editorCol?.w)}px`);
info('① 基线窗口/主题', `win=${String(base.winW)}x${String(base.winH)} theme=${base.theme} tabCount=${String(base.tabCount)}`);

// ② 展开（顶栏 AI 钮）
const aiBtn = page.getByRole('button', { name: /AI 对话/ });
const aiBtnCount = await aiBtn.count();
await aiBtn.first().click();
await wait(700);
const open1 = await measure(page);
check('② 点顶栏 AI 钮 → 面板 .ai-chat 出现', open1.panelCount === 1 && open1.panel !== null,
  `panelCount=${String(open1.panelCount)} panelW=${String(open1.panel?.w)}px panelH=${String(open1.panel?.h)}px`);
check('② 面板宽度 = 320px（DEVIATION-6 决策值）', open1.panel?.w === 320, `w=${String(open1.panel?.w)}px`);
check('② 展开态主编辑列变窄 = 基线 − 面板宽', base.editorCol !== null && open1.editorCol !== null &&
  Math.abs((base.editorCol.w - open1.editorCol.w) - 320) <= 1,
  `baseline=${String(base.editorCol?.w)}px → open=${String(open1.editorCol?.w)}px Δ=${String(base.editorCol && open1.editorCol ? Math.round((base.editorCol.w - open1.editorCol.w) * 100) / 100 : null)}px`);
check('② 顶栏 AI 钮 aria-pressed=true', await page.getByRole('button', { name: /AI 对话/ }).first().getAttribute('aria-pressed') === 'true',
  `aria-pressed=${String(await page.getByRole('button', { name: /AI 对话/ }).first().getAttribute('aria-pressed'))} matchButtons=${String(aiBtnCount)}`);
check('② 展开态窗口零滚动（T30 红线）', open1.overflowY <= 0 && open1.scrollY === 0,
  `docOverflow=${String(open1.overflowY)}px scrollY=${String(open1.scrollY)}`);

await setTheme(page, 'light');
const sOpenLight = await shot(page, 't38-panel-open-light');
await setTheme(page, 'dark');
const sOpenDark = await shot(page, 't38-panel-open-dark');
await setTheme(page, 'light');
info('截图（展开态）', `open-light ${String(sOpenLight.w)}x${String(sOpenLight.h)} / open-dark ${String(sOpenDark.w)}x${String(sOpenDark.h)}`);

// ③ AI 门控快照（夹具 provider 是否被读到）
const aiState = await page.evaluate(() =>
  window.septcats.ai.state().then((s) => ({ enabled: s.enabled, providers: s.providers.map((p) => p.id), active: s.activeProviderId, isLocal: s.providers.map((p) => p.isLocal) })).catch((e) => ({ error: String(e?.message ?? e) })),
);
info('③ renderer 侧 ai.state()', JSON.stringify(aiState));

// ④ 发送一条消息（本地未监听端点 → 预期 E_AI_UNREACHABLE；用户消息应先落盘）
await page.locator('.ai-chat__input').click();
await page.locator('.ai-chat__input').fill(MSG);
await page.locator('.ai-chat__input').press('Enter');
await wait(600);
const afterSend = await page.evaluate(() => ({
  userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
  userText: [...document.querySelectorAll('.ai-chat__msg--user .ai-chat__bubble')].map((el) => el.textContent),
  assistantMsgs: document.querySelectorAll('.ai-chat__msg--assistant').length,
  busy: document.querySelector('.ai-chat__busy-row') !== null,
  errorText: document.querySelector('.ai-chat__error')?.textContent ?? null,
  gateText: document.querySelector('.ai-chat__gate-text')?.textContent ?? null,
  inputValue: document.querySelector('.ai-chat__input')?.value ?? null,
}));
info('④ 发送后 600ms DOM 快照', JSON.stringify(afterSend));

// 等落定（错误出现或 busy 消失），最多 ~20s
let settled = afterSend;
for (let k = 0; k < 40; k++) {
  settled = await page.evaluate(() => ({
    busy: document.querySelector('.ai-chat__busy-row') !== null,
    errorText: document.querySelector('.ai-chat__error')?.textContent ?? null,
    assistantMsgs: document.querySelectorAll('.ai-chat__msg--assistant').length,
    userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
  }));
  if (!settled.busy) break;
  await wait(500);
}
info('④ 发送落定快照', JSON.stringify(settled));
const stAfterSend = await storage(page);
check('④ 用户消息落盘（发送即写 localStorage 历史）', stAfterSend.histCount === 1 && stAfterSend.histTexts?.[0] === MSG,
  `histKey=${String(stAfterSend.histKey)} count=${String(stAfterSend.histCount)} texts=${JSON.stringify(stAfterSend.histTexts)}`);
check('④ AI 回复未落盘（无本地模型 → 无 assistant 条）', (stAfterSend.histCount ?? 0) - (stAfterSend.histRoles ?? []).filter((r) => r === 'assistant').length === 1,
  `roles=${JSON.stringify(stAfterSend.histRoles)} assistantDomMessages=${String(settled.assistantMsgs)}`);
info('④ 错误文案（原文）', `errorText=${JSON.stringify(settled.errorText)}`);
check('④ 门控未被拦（未出现「未启用/未配置」引导）', (settled.errorText ?? '') !== '' || settled.assistantMsgs > 0,
  `errorText=${JSON.stringify(settled.errorText)} gateText=${JSON.stringify(afterSend.gateText)}`);
check('④ localStorage 无密钥痕迹（sk-/Bearer）', stAfterSend.hasSecret === false, `hasSecret=${String(stAfterSend.hasSecret)} keys=${JSON.stringify(stAfterSend.allKeys)}`);

await setTheme(page, 'dark');
const sErrDark = await shot(page, 't38-panel-open-dark-after-send');
await setTheme(page, 'light');

// ⑤ 收起面板（关闭钮）
await page.getByRole('button', { name: /关闭 AI 对话/ }).first().click();
await wait(700);
const closed1 = await measure(page);
const stClosed = await storage(page);
check('⑤ 点关闭钮 → 面板 DOM 移除（收起）', closed1.panelCount === 0 && closed1.panel === null,
  `panelCount=${String(closed1.panelCount)} panelRect=${JSON.stringify(closed1.panel)}`);
check('⑤ 收起态主编辑列宽度复原（= 基线）', closed1.editorCol?.w === base.editorCol?.w,
  `closed=${String(closed1.editorCol?.w)}px baseline=${String(base.editorCol?.w)}px`);
check('⑤ 收起态 localStorage septcats.aichat.panel === "0"', stClosed.panelRaw === '0', `panelRaw=${JSON.stringify(stClosed.panelRaw)}`);

await setTheme(page, 'light');
const sClosedLight = await shot(page, 't38-panel-collapsed-light');
await setTheme(page, 'dark');
const sClosedDark = await shot(page, 't38-panel-collapsed-dark');
await setTheme(page, 'light');
info('截图（收起态）', `collapsed-light ${String(sClosedLight.w)}x${String(sClosedLight.h)} / collapsed-dark ${String(sClosedDark.w)}x${String(sClosedDark.h)}`);

// ⑥ 回归抽查
const reg1 = await measure(page);
check('⑥ 回归·窗口零滚动（T30 红线）', reg1.overflowY <= 0 && reg1.scrollY === 0,
  `docOverflow=${String(reg1.overflowY)}px scrollY=${String(reg1.scrollY)}`);
check('⑥ 回归·页签条存在（T37）', reg1.tabsbarCount === 1 && reg1.tabCount >= 1,
  `.tabsbar=${String(reg1.tabsbarCount)} .tabsbar-tab=${String(reg1.tabCount)}`);
await page.getByRole('button', { name: /收起侧栏|Collapse/ }).click();
await wait(500);
const sideCollapsed = await measure(page);
check('⑥ 回归·侧栏完全收起（.sc-shell__sidebar 宽度 = 0）', sideCollapsed.sidebar?.w === 0,
  `sidebarW=${String(sideCollapsed.sidebar?.w)}px`);
await page.getByRole('button', { name: /展开侧栏|Expand/ }).click();
await wait(500);
const sideExpanded = await measure(page);
info('⑥ 侧栏复原宽度', `${String(sideExpanded.sidebar?.w)}px`);

// ⑦ 优雅退出 → 重启
const stBeforeQuit = await storage(page);
const q1 = await quit(page, r1.pid);
info('⑦ 第 1 次优雅退出（window.close → 自退）', `gracefulExited=${String(q1.gracefulExited)} panelRawBeforeQuit=${JSON.stringify(stBeforeQuit.panelRaw)} histCountBeforeQuit=${String(stBeforeQuit.histCount)}`);

// ======================= 第 2 次启动 =======================
const r2 = await launch('run2');
const page2 = r2.page;
await wait(1200);
const base2 = await measure(page2);
const st2 = await storage(page2);
check('⑧ 重启后面板仍为收起态（DOM 不存在）', base2.panelCount === 0 && base2.panel === null,
  `panelCount=${String(base2.panelCount)} panelRect=${JSON.stringify(base2.panel)}`);
check('⑧ 重启后 localStorage septcats.aichat.panel 仍为 "0"', st2.panelRaw === '0', `panelRaw=${JSON.stringify(st2.panelRaw)}`);
check('⑧ 重启后历史逐字还原（条数 + 原文）', st2.histCount === stBeforeQuit.histCount && JSON.stringify(st2.histTexts) === JSON.stringify(stBeforeQuit.histTexts),
  `count=${String(st2.histCount)} (quit前 ${String(stBeforeQuit.histCount)}) texts=${JSON.stringify(st2.histTexts)}`);

// 展开 → 断言历史渲染回面板
await page2.getByRole('button', { name: /AI 对话/ }).first().click();
await wait(900);
const restored = await page2.evaluate(() => ({
  panelCount: document.querySelectorAll('.ai-chat').length,
  panelW: document.querySelector('.ai-chat')?.getBoundingClientRect().width ?? null,
  userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
  userText: [...document.querySelectorAll('.ai-chat__msg--user .ai-chat__bubble')].map((el) => el.textContent),
  emptyState: document.querySelector('.ai-chat__empty') !== null,
}));
check('⑨ 重启后展开面板 → 上轮回的会话气泡渲染回来', restored.panelCount === 1 && restored.userMsgs === 1 && restored.userText[0] === MSG,
  JSON.stringify(restored));
const sRestore = await shot(page2, 't38-panel-restored-light');
info('截图（重启还原态）', `${String(sRestore.w)}x${String(sRestore.h)}`);

// ⑨b 引用出处 chip（夹具注入的 assistant 消息 —— 非真实模型产出；无本地模型时
// 唯一能真机验证「引用渲染 + 点击跳转」的途径；注入内容与来源在 results 里明示）。
// 先造一个长页（30 段），把被引用块推到视口外 —— 跳转才有可观测效果。
await page2.locator('.pv-body').first().click();
await page2.keyboard.press('Control+End');
for (let i = 1; i <= 30; i += 1) {
  await page2.keyboard.press('Enter');
  await page2.keyboard.insertText(`引用目标段落 ${String(i)}。`);
}
await wait(1500);
const seed = await page2.evaluate(() => {
  const wsKey = Object.keys(localStorage).find((k) => k.startsWith('septcats.aichat.history.'));
  const ws = wsKey === undefined ? null : wsKey.replace('septcats.aichat.history.', '');
  let pageId = null;
  try {
    pageId = JSON.parse(localStorage.getItem(`septcats.tabs.${String(ws)}`)).activeId;
  } catch {
    pageId = null;
  }
  const blocks = [...document.querySelectorAll('.pv-body [data-id]')]
    .map((el) => ({ id: el.getAttribute('data-id'), text: el.textContent.trim() }))
    .filter((b) => b.id !== null && b.text.length > 0);
  const idx = Math.max(0, blocks.length - 15);
  const target = blocks.length > 0 ? blocks[idx] : null;
  if (ws === null || pageId === null || target === null) {
    return { ok: false, ws, pageId, blockCount: blocks.length };
  }
  const messages = [
    { id: 'probe-u1', role: 'user', content: '（夹具）请引用最后一个有文字的块。', ts: Date.now() },
    {
      id: 'probe-a1',
      role: 'assistant',
      content: '这是夹具注入的助手回复，出处见 ⟦#9⟧（非真实模型产出）。',
      ts: Date.now(),
      refs: [{ n: 9, pageId, pageTitle: 'T38 探针页', blockId: target.id }],
    },
  ];
  localStorage.setItem(wsKey, JSON.stringify({ v: 1, messages }));
  return { ok: true, ws, pageId, blockId: target.id, blockText: target.text, blockIndex: idx, blockCount: blocks.length };
});
info('⑨b 夹具注入（assistant 引用消息）', JSON.stringify(seed));
check('⑨b 夹具就位（ws/pageId/目标块 id 均可解析）', seed.ok === true,
  `ok=${String(seed.ok)} ws=${String(seed.ws)} pageId=${String(seed.pageId)} blockId=${String(seed.blockId)} blockCount=${String(seed.blockCount)}`);
await page2.reload();
for (let k = 0; k < 20; k++) {
  if (await page2.evaluate(() => document.querySelector('.pv-body') !== null).catch(() => false)) break;
  await wait(500);
}
await wait(1800);
if ((await page2.locator('.ai-chat').count()) === 0) {
  await page2.getByRole('button', { name: /AI 对话/ }).first().click();
  await wait(900);
}
const chip = await page2.evaluate((bid) => {
  const el = document.querySelector('.ai-chat__ref');
  const t = document.querySelector(`[data-id="${bid}"]`);
  const r = t === null ? null : t.getBoundingClientRect();
  return {
    count: document.querySelectorAll('.ai-chat__ref').length,
    text: el?.textContent ?? null,
    title: el?.getAttribute('title') ?? null,
    panelOpen: document.querySelectorAll('.ai-chat').length,
    targetRectBefore: r === null ? null : { top: Math.round(r.top), bottom: Math.round(r.bottom) },
    winH: window.innerHeight,
    pvScrollTopBefore: Math.round(document.querySelector('.pv-root')?.scrollTop ?? -1),
  };
}, seed.blockId);
check('⑨b 引用出处 chip 渲染为「页名 › 块锚点」', chip.count === 1 && chip.text === 'T38 探针页 › 块9', JSON.stringify(chip));
check('⑨b 跳转前：被引用块在视口外（跳转效果可观测）',
  chip.targetRectBefore !== null && chip.targetRectBefore.top >= chip.winH,
  `rect=${JSON.stringify(chip.targetRectBefore)} winH=${String(chip.winH)} pvScrollTop=${String(chip.pvScrollTopBefore)}`);

await page2.locator('.ai-chat__ref').first().click();
await wait(1200);
const jump = await page2.evaluate((bid) => {
  const root = document.querySelector('.ProseMirror');
  // Tiptap 在 view.dom 上挂了 editor 实例（DOM 自省：.ProseMirror.editor / pmViewDesc）
  const editor = root?.editor ?? null;
  const state = editor?.state ?? null;
  const sel = state === null ? null : state.selection;
  let selBlockId = null;
  let selDepth = null;
  if (sel !== null && state !== null) {
    if (sel.node !== undefined && sel.node !== null) {
      selBlockId = sel.node.attrs['id'] ?? null;
    }
    if (selBlockId === null) {
      const $pos = state.doc.resolve(sel.from);
      selDepth = $pos.depth;
      if ($pos.depth >= 1) selBlockId = $pos.node(1).attrs['id'] ?? null;
      else if ($pos.nodeAfter !== null) selBlockId = $pos.nodeAfter.attrs['id'] ?? null;
      else if ($pos.nodeBefore !== null) selBlockId = $pos.nodeBefore.attrs['id'] ?? null;
    }
  }
  const el = document.querySelector(`[data-id="${bid}"]`);
  const r = el === null ? null : el.getBoundingClientRect();
  const center = r === null ? null : Math.round(r.top + r.height / 2);
  return {
    hasEditorState: state !== null,
    selKind: sel === null ? null : (sel.constructor?.name ?? 'unknown'),
    selFrom: sel === null ? null : sel.from,
    selDepth,
    selBlockId,
    rect: r === null ? null : { top: Math.round(r.top), bottom: Math.round(r.bottom) },
    centeredDelta: center === null ? null : Math.abs(center - Math.round(window.innerHeight / 2)),
    winH: window.innerHeight,
    pvScrollTop: Math.round(document.querySelector('.pv-root')?.scrollTop ?? -1),
  };
}, seed.blockId);
check('⑨b 点 chip → 编辑器选区落在被引用块内（Tiptap editor.state.selection）',
  jump.hasEditorState === true && jump.selBlockId === seed.blockId, JSON.stringify(jump));
check('⑨b 点 chip → 被引用块滚入视口且居中（scrollIntoView center）',
  jump.rect !== null && jump.rect.top >= 0 && jump.rect.bottom <= jump.winH && jump.centeredDelta <= 60,
  `rect=${JSON.stringify(jump.rect)} winH=${String(jump.winH)} 中心偏差=${String(jump.centeredDelta)}px`);
const sChip = await shot(page2, 't38-citation-chip-light');
info('截图（引用 chip 态）', `${String(sChip.w)}x${String(sChip.h)}`);
const longScroll = await page2.evaluate(() => {
  const se = document.scrollingElement;
  const pv = document.querySelector('.pv-root');
  return {
    docOverflow: se.scrollHeight - se.clientHeight,
    scrollY: window.scrollY,
    pvScrollHeight: pv === null ? null : pv.scrollHeight,
    pvClientHeight: pv === null ? null : pv.clientHeight,
    blocks: document.querySelectorAll('.pv-body [data-id]').length,
  };
});
check('⑨b 长页（30 段）+ 面板展开 → 窗口仍零滚动（T30 红线）',
  longScroll.docOverflow <= 0 && longScroll.scrollY === 0 && longScroll.pvScrollHeight > longScroll.pvClientHeight,
  JSON.stringify(longScroll));

// ⑩ 全程错误计数
check('⑩ 全程 pageerror 计数 = 0', pageErrors.length === 0,
  `pageErrors=${String(pageErrors.length)} ${JSON.stringify(pageErrors.slice(0, 3))}`);
check('⑩ 全程 renderer console error 计数 = 0', consoleErrors.length === 0,
  `consoleErrors=${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 5))}`);

const q2 = await quit(page2, r2.pid);
info('⑩ 第 2 次优雅退出', `gracefulExited=${String(q2.gracefulExited)}`);
const realRootAfter = mtime(REAL_ROOT);
check('⑪ 真实数据根 C:\\Users\\Administrator\\.septcats 未被触碰（mtime 不变）', realRootBefore === realRootAfter,
  `before=${realRootBefore} after=${realRootAfter}`);

const fails = results.filter((r) => r.ok === false).length;
const passes = results.filter((r) => r.ok === true).length;
const payload = {
  task: 'TASK-T38-01 真机探针',
  ranAt: new Date().toISOString(),
  appdir: APPDIR,
  fixture: { userDataDir: UD, rootPath: ROOT, endpoint: PROBE_ENDPOINT },
  message: MSG,
  pass: passes,
  fail: fails,
  assertions: results,
  screenshots: shots,
  pageErrors,
  consoleErrors,
};
writeFileSync(join(SHOTS, 't38-results.json'), JSON.stringify(payload, null, 2), 'utf8');
console.log(`\n${String(passes)}/${String(passes + fails)} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${String(fails)} 项失败`}`);
console.log(`results → ${join(SHOTS, 't38-results.json')}`);
process.exit(fails === 0 ? 0 : 1);