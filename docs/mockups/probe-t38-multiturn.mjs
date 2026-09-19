/* TASK-T38-01 真机取证（本轮）：AI 对话面板 · **真实多轮对话** 对**真实本机模型端点**。
 *
 * 口径与上一轮 docs/mockups/probe-t38-ai.mjs 一致（本文件是它的多轮专项分支）：
 * - 直接以 electron . 跑仓库已有的 out/（不重打包、不改产品源码）；
 * - 独立夹具：--user-data-dir + rootPath 全在 _scratch/probe-t38-multiturn/ 下，
 *   绝不触碰 C:\Users\Administrator\.septcats\（真实数据根）；
 * - 优雅退出 = window.close()（等落盘），仅在窗口关不掉时对**本进程 PID 树** taskkill；
 * - 端点 = 本机真实模型 http://127.0.0.1:1234/v1（OpenAI 兼容，纯本地，零外网、零代理）。
 *
 * 夹具 AI 设置字段名来源（读源码，非猜测）：
 * - 落盘文件 `<userData>/septcats.settings.json`（packages/platform/src/settings.ts
 *   SETTINGS_FILE_NAME='septcats.settings.json'）；
 * - ai 段形状 = packages/platform/src/settings.ts appSettingsSchema.
 *   ai{enabled,cloudConsent,activeProviderId,providers[{id,kind,name,baseUrl,model}]}；
 *   参考 apps/desktop/test/ai-service.test.ts 的 LOCAL_PROVIDER fixture；
 * - baseUrl 指向 127.0.0.1 → main/ai/policy.ts isLocalBaseUrl=true，
 *   不走云端 consent 门禁（cloudConsent 保持 false）。
 *
 * 产品侧既有事实（本轮实测一并记录，未改源码）：
 * - AiChatPanel.send() 调 window.septcats.ai.chat({providerId, messages})，
 *   **不传 maxTokens** → 实际请求体无 max_tokens 字段（端点用自身默认值）；
 * - main/ai/client.ts DEFAULT_CHAT_TIMEOUT_MS = 120_000（产品侧 chat 超时 120s，
 *   不改源码无法调到 180s）；本探针每轮**等待上限 180s**，即若模型 120~180s 才回，
 *   产品侧会先抛 E_AI_TIMEOUT —— 如实记录错误文案。
 * - 「请求给足 max_tokens」在本探针中以 0 号轮（直连 IPC，显式 maxTokens:800，
 *   走同一 AiService/同一端点）取证，面板轮则按产品真实形态发（无 max_tokens）。
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_FROM_SCRIPT = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO_FROM_SCRIPT, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO_FROM_SCRIPT, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t38-multiturn';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9399;
const SHOTS = join(REPO_FROM_SCRIPT, 'docs', 'mockups', 'screens-t38');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const ENDPOINT = 'http://127.0.0.1:1234/v1';
const MODEL = 'ternary-bonsai-2-27b-pq2_0';
const PROVIDER_ID = 'probe-local';

const ROUND1_MSG = '请记住这个数字：7391。只回复四个字：已记住。';
const ROUND2_MSG = '请只依据当前页面内容回答：本页第一段写了什么？回答时在句末加上出处标记。';
const ROUND3_MSG = '我第一轮让你记住的数字是多少？只回答数字。';
const ROUND_TIMEOUT_MS = 180_000;

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

const killTree = (pid) => {
  if (typeof pid !== 'number') return;
  try {
    execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退出 */
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
  for (let k = 0; k < 40 && br === null; k++) {
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
  for (let k = 0; k < 40; k++) {
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
    histRefs: Array.isArray(hist?.messages)
      ? hist.messages.map((m) => (Array.isArray(m.refs) ? m.refs.map((r) => `${r.pageTitle}:${r.blockId}`) : null))
      : null,
    histRawLen: histKey !== undefined ? out[histKey].length : null,
    hasSecret: /sk-|Bearer /.test(JSON.stringify(out)),
  };
};
const storage = (page) => page.evaluate(STORAGE);

const PANDOM = () => ({
  userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
  userTexts: [...document.querySelectorAll('.ai-chat__msg--user .ai-chat__bubble')].map((el) => el.textContent),
  assistantMsgs: document.querySelectorAll('.ai-chat__msg--assistant').length,
  assistantTexts: [...document.querySelectorAll('.ai-chat__msg--assistant .ai-chat__bubble')].map((el) => el.textContent),
  busy: document.querySelector('.ai-chat__busy-row') !== null,
  errorText: document.querySelector('.ai-chat__error')?.textContent ?? null,
  gateText: document.querySelector('.ai-chat__gate-text')?.textContent ?? null,
  refChips: [...document.querySelectorAll('.ai-chat__ref')].map((el) => ({
    text: el.textContent,
    title: el.getAttribute('title'),
  })),
  rawRefMarks: [...document.querySelectorAll('.ai-chat__bubble-text')]
    .map((el) => el.textContent)
    .filter((t) => t.includes('⟦#')),
  winOverflow:
    document.scrollingElement !== null
      ? document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight
      : null,
});
const panelDom = (page) => page.evaluate(PANDOM);

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
  await wait(600);
};

const mtime = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return 'absent';
  }
};
const dirMtime = (p) => mtime(p);

/** 递归找夹具里的 ai.log（main 侧隐私请求日志：`ai chat ... → ok(Nms)`）。 */
function findLogs(dir, depth = 0, acc = []) {
  if (depth > 4) return acc;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    const full = join(dir, name);
    let st = null;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) findLogs(full, depth + 1, acc);
    else if (name === 'ai.log') acc.push(full);
  }
  return acc;
}

// ===========================================================================
const realRootBefore = dirMtime(REAL_ROOT);
rmSync(RUN, { recursive: true, force: true });
// 只清理**本探针自己的**产物（不动同目录下别的探针的截图/结果）
if (existsSync(SHOTS)) {
  for (const name of readdirSync(SHOTS)) {
    if (name.startsWith('t38-multiturn') || name === 'probe-ai.log') {
      rmSync(join(SHOTS, name), { recursive: true, force: true });
    }
  }
}
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

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
    activeProviderId: PROVIDER_ID,
    providers: [
      { id: PROVIDER_ID, kind: 'lmstudio', name: '本机真实端点', baseUrl: ENDPOINT, model: MODEL },
    ],
  },
};
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify(settings, null, 2), 'utf8');
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\nSHOTS=${SHOTS}\nENDPOINT=${ENDPOINT} MODEL=${MODEL}\n`);

const rounds = [];
const pushRound = (r) => {
  rounds.push(r);
  console.log(`ROUND ${String(r.round)} ${r.channel} ${r.elapsed_s}s content=${JSON.stringify(r.reply)} err=${JSON.stringify(r.error)}`);
};

// ======================= 第 1 次启动 =======================
const r1 = await launch('run1');
const page = r1.page;

// 建页 + 两段正文（给引用解析一个真实块清单）
await page.getByTestId('side-new-page').click();
const nameInput = page.locator('.app-side input').first();
await nameInput.waitFor({ state: 'visible', timeout: 15000 });
await nameInput.fill('T38 多轮探针页');
await nameInput.press('Enter');
await wait(900);
await page.locator('.pv-body').first().click();
await page.keyboard.type('探针第一段：本页项目代号为云雀。', { delay: 20 });
await page.keyboard.press('Enter');
await page.keyboard.type('探针第二段：交付窗口为 2027 年 3 月。', { delay: 20 });
await wait(1500);

// 打开 AI 面板
await page.getByRole('button', { name: /AI 对话/ }).first().click();
await wait(900);
const opened = await page.evaluate(() => ({
  panelCount: document.querySelectorAll('.ai-chat').length,
  panelW: document.querySelector('.ai-chat')?.getBoundingClientRect().width ?? null,
}));
check('① 顶栏 AI 钮 → 面板 .ai-chat 打开（宽度 320px）', opened.panelCount === 1 && opened.panelW === 320,
  JSON.stringify(opened));

// 夹具 AI 门禁快照：必须指向真本机端点 + 判为本地（不走云端 consent）
const aiState = await page.evaluate(() =>
  window.septcats.ai
    .state()
    .then((s) => ({
      enabled: s.enabled,
      cloudConsent: s.cloudConsent,
      active: s.activeProviderId,
      providers: s.providers.map((p) => ({ id: p.id, baseUrl: p.baseUrl, isLocal: p.isLocal, model: p.model, hasKey: p.hasKey })),
    }))
    .catch((e) => ({ error: String(e?.message ?? e) })),
);
info('② renderer 侧 ai.state() 快照', JSON.stringify(aiState));
const pv = aiState.providers?.find((p) => p.id === PROVIDER_ID);
check('② 夹具 provider 命中真本机端点且判为本地（isLocal=true、model=目标模型）',
  pv !== undefined && pv.baseUrl === ENDPOINT && pv.isLocal === true && pv.model === MODEL,
  JSON.stringify(pv ?? aiState));
check('② 云端 consent 保持 false（本地端点无需同意，未触发云端门禁）', aiState.cloudConsent === false,
  `cloudConsent=${String(aiState.cloudConsent)}`);

// 端点可达性：**探针侧（Node）直连**一次 /v1/models（纯本机，零外网）。
// 注：不能用渲染器 fetch —— 产品 CSP（apps/desktop/src/renderer/index.html）
// `connect-src 'self' asset: attachment: ws://localhost:* http://localhost:*`
// 不放行 http://127.0.0.1:1234，渲染器直连会被拦；产品真实 AI 调用走
// main 侧 net.fetch（不受该 CSP 约束），故此处用 Node 侧探测。
const modelsOk = await (async () => {
  try {
    const res = await fetch(`${ENDPOINT}/models`);
    const body = await res.json();
    return { ok: res.ok, status: res.status, ids: (body.data ?? []).map((m) => m.id), via: 'node-probe' };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e), via: 'node-probe' };
  }
})();
check('③ 端点 /v1/models 可达且含目标模型（探针侧 Node 直连）',
  modelsOk.ok === true && (modelsOk.ids ?? []).includes(MODEL), JSON.stringify(modelsOk));

// ============ 0 号轮：直连 IPC（显式 maxTokens:800）——「请求给足 max_tokens」取证 ============
const t0 = Date.now();
const ipcRound = await page.evaluate(
  async (args) => {
    try {
      const res = await window.septcats.ai.chat({
        providerId: args.providerId,
        messages: [{ role: 'user', content: args.msg }],
        maxTokens: 800,
        temperature: 0,
      });
      return { ok: true, text: res.text, model: res.model };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), name: String(e?.name ?? '') };
    }
  },
  { providerId: PROVIDER_ID, msg: ROUND1_MSG },
);
pushRound({
  round: 0,
  channel: 'renderer IPC 直连（显式 maxTokens:800，非面板）',
  sent: ROUND1_MSG,
  elapsed_s: ((Date.now() - t0) / 1000).toFixed(2),
  reply: ipcRound.ok === true ? ipcRound.text : null,
  error: ipcRound.ok === true ? null : `${ipcRound.name} ${ipcRound.error}`,
  note: '未写入面板历史（纯 IPC 取证）',
});
check('④ 0 号轮（maxTokens:800 显式）经真实端点返回非空 content',
  ipcRound.ok === true && typeof ipcRound.text === 'string' && ipcRound.text.length > 0,
  JSON.stringify(ipcRound));

// ============ 面板三轮：真实多轮 ============
const sendViaPanel = async (msg, roundNo, sentSoFar) => {
  const before = await panelDom(page);
  await page.locator('.ai-chat__input').click();
  await page.locator('.ai-chat__input').fill(msg);
  const t = Date.now();
  await page.locator('.ai-chat__input').press('Enter');
  let dom = before;
  let timedOut = false;
  const deadline = Date.now() + ROUND_TIMEOUT_MS;
  for (;;) {
    await wait(1000);
    dom = await panelDom(page);
    const replied = dom.assistantMsgs > before.assistantMsgs;
    const errored = (dom.errorText ?? '') !== '' && !dom.busy;
    if (replied || errored || !dom.busy) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }
  const elapsed = ((Date.now() - t) / 1000).toFixed(2);
  const st = await storage(page);
  const rawReply = Array.isArray(st.histTexts)
    ? st.histTexts.filter((_, i) => st.histRoles[i] === 'assistant').slice(-1)[0] ?? null
    : null;
  const lastUser = Array.isArray(st.histTexts)
    ? st.histTexts.filter((_, i) => st.histRoles[i] === 'user').slice(-1)[0] ?? null
    : null;
  return { dom, elapsed, timedOut, st, rawReply, lastUser, before };
};

// 轮 1
const R1 = await sendViaPanel(ROUND1_MSG, 1);
pushRound({
  round: 1,
  channel: 'AI 面板 UI（Enter 发送，产品真实请求形态=无 max_tokens）',
  sent: ROUND1_MSG,
  elapsed_s: R1.elapsed,
  reply: R1.rawReply,
  error: R1.dom.errorText,
  note: `historyUserEcho=${JSON.stringify(R1.lastUser)} busyAfter=${String(R1.dom.busy)} timedOut=${String(R1.timedOut)}`,
});
check('⑤ 轮1：面板收到 AI 回复且原样落盘（非错误态）',
  typeof R1.rawReply === 'string' && R1.rawReply.length > 0 && (R1.dom.errorText ?? '') === '',
  `reply=${JSON.stringify(R1.rawReply)} error=${JSON.stringify(R1.dom.errorText)} assistantMsgs=${String(R1.dom.assistantMsgs)}`);

// 轮 2（尝试引出 ⟦#N⟧ 引用）
const R2 = await sendViaPanel(ROUND2_MSG, 2);
pushRound({
  round: 2,
  channel: 'AI 面板 UI（页面内容问答，期望产出出处标记）',
  sent: ROUND2_MSG,
  elapsed_s: R2.elapsed,
  reply: R2.rawReply,
  error: R2.dom.errorText,
  note: `chipCount=${String(R2.dom.refChips.length)} rawMarks=${JSON.stringify(R2.dom.rawRefMarks)} timedOut=${String(R2.timedOut)}`,
});
check('⑥ 轮2：面板收到 AI 回复且原样落盘（非错误态）',
  typeof R2.rawReply === 'string' && R2.rawReply.length > 0 && (R2.dom.errorText ?? '') === '',
  `reply=${JSON.stringify(R2.rawReply)} error=${JSON.stringify(R2.dom.errorText)}`);

// 轮 3（多轮上下文证据）
const R3 = await sendViaPanel(ROUND3_MSG, 3);
pushRound({
  round: 3,
  channel: 'AI 面板 UI（第三轮追问第一轮记忆）',
  sent: ROUND3_MSG,
  elapsed_s: R3.elapsed,
  reply: R3.rawReply,
  error: R3.dom.errorText,
  note: `contains7391=${String(typeof R3.rawReply === 'string' && R3.rawReply.includes('7391'))} timedOut=${String(R3.timedOut)}`,
});
check('⑦ 轮3 回复原文包含「7391」（多轮上下文真的传通的直接证据）',
  typeof R3.rawReply === 'string' && R3.rawReply.includes('7391'),
  `第三轮原文=${JSON.stringify(R3.rawReply)} error=${JSON.stringify(R3.dom.errorText)}`);
check('⑦ 轮3 无错误态', (R3.dom.errorText ?? '') === '', `errorText=${JSON.stringify(R3.dom.errorText)}`);

// 消息计数（DOM + localStorage）
const stAfter3 = await storage(page);
const domAfter3 = await panelDom(page);
check('⑧ 面板消息数 user=3 / assistant=3（DOM）',
  domAfter3.userMsgs === 3 && domAfter3.assistantMsgs === 3,
  `user=${String(domAfter3.userMsgs)} assistant=${String(domAfter3.assistantMsgs)}`);
check('⑧ localStorage 历史 user=3 / assistant=3（共 6 条，交错）',
  stAfter3.histCount === 6 && JSON.stringify(stAfter3.histRoles) === JSON.stringify(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']),
  `count=${String(stAfter3.histCount)} roles=${JSON.stringify(stAfter3.histRoles)}`);
check('⑧ localStorage 无密钥痕迹（sk-/Bearer）', stAfter3.hasSecret === false,
  `hasSecret=${String(stAfter3.hasSecret)} keys=${JSON.stringify(stAfter3.allKeys)}`);
info('⑧ 三轮原文（localStorage 逐字）', JSON.stringify(stAfter3.histTexts));

// ④ 引用 chip：模型是否产出可解析引用标记
const hasMark = (typeof R2.rawReply === 'string' && /⟦#\d+⟧/.test(R2.rawReply)) ||
  (typeof R1.rawReply === 'string' && /⟦#\d+⟧/.test(R1.rawReply)) ||
  (typeof R3.rawReply === 'string' && /⟦#\d+⟧/.test(R3.rawReply));
const anyMark = stAfter3.histTexts?.some((t) => /⟦#\d+⟧/.test(t)) === true;
info('⑨ 模型是否产出可解析引用标记 ⟦#N⟧（产品实际标记语法）',
  `markInRounds=${String(anyMark)} round2=${String(typeof R2.rawReply === 'string' && /⟦#\d+⟧/.test(R2.rawReply))}`);
if (anyMark) {
  const chipInfo = R2.dom.refChips.length > 0 || R3.dom.refChips.length > 0 || domAfter3.refChips.length > 0
    ? domAfter3.refChips
    : [];
  info('⑨ chip DOM 文本', JSON.stringify(chipInfo));
  check('⑨ 引用标记已渲染为 chip（≠ 原样 ⟦#N⟧ 文本）', domAfter3.refChips.length > 0 && domAfter3.rawRefMarks.length === 0,
    `chips=${JSON.stringify(chipInfo)} rawMarks=${JSON.stringify(domAfter3.rawRefMarks)}`);
  if (domAfter3.refChips.length > 0) {
    const seedBlock = await page.evaluate(() => {
      const wsKey = Object.keys(localStorage).find((k) => k.startsWith('septcats.aichat.history.'));
      const ws = wsKey === undefined ? null : wsKey.replace('septcats.aichat.history.', '');
      const blocks = [...document.querySelectorAll('.pv-body [data-id]')]
        .map((el) => ({ id: el.getAttribute('data-id'), text: el.textContent.trim() }))
        .filter((b) => b.id !== null && b.text.length > 0);
      return { ws, blocks };
    });
    info('⑨ 当前页块清单（探针侧）', JSON.stringify(seedBlock));
    const beforeJump = await page.evaluate(() => {
      const root = document.querySelector('.ProseMirror');
      const editor = root?.editor ?? null;
      const state = editor?.state ?? null;
      return { pvScrollTop: Math.round(document.querySelector('.pv-root')?.scrollTop ?? -1), hasEditor: state !== null };
    });
    await page.locator('.ai-chat__ref').first().click();
    await wait(1500);
    const afterJump = await page.evaluate(() => {
      const root = document.querySelector('.ProseMirror');
      const editor = root?.editor ?? null;
      const state = editor?.state ?? null;
      const sel = state === null ? null : state.selection;
      let selBlockId = null;
      if (sel !== null && state !== null) {
        if (sel.node !== undefined && sel.node !== null) selBlockId = sel.node.attrs['id'] ?? null;
        if (selBlockId === null) {
          const $pos = state.doc.resolve(sel.from);
          if ($pos.depth >= 1) selBlockId = $pos.node(1).attrs['id'] ?? null;
          else if ($pos.nodeAfter !== null) selBlockId = $pos.nodeAfter.attrs['id'] ?? null;
          else if ($pos.nodeBefore !== null) selBlockId = $pos.nodeBefore.attrs['id'] ?? null;
        }
      }
      return { selBlockId, pvScrollTop: Math.round(document.querySelector('.pv-root')?.scrollTop ?? -1) };
    });
    check('⑨ 点 chip → 编辑器选区落在被引用块（真实跳转）',
      afterJump.selBlockId !== null && seedBlock.blocks.some((b) => b.id === afterJump.selBlockId),
      `selBlockId=${String(afterJump.selBlockId)} before=${JSON.stringify(beforeJump)} after=${JSON.stringify(afterJump)} blocks=${JSON.stringify(seedBlock.blocks)}`);
  } else {
    info('⑨ chip 未渲染（标记未解析成 ref）', '模型产出 ⟦#N⟧ 但 n 不在本次上下文块清单内 → resolveCitations 不产出 ref');
  }
} else {
  info('⑨ 引用链路未验证', '模型三轮均未产出 ⟦#N⟧ 出处标记 → 无 chip 可点，「页名 › 块锚点」渲染/跳转链路本轮未验证（不编造）');
}

// 截图：三轮完成态 · 浅色 / 深色
await setTheme(page, 'light');
const sLight = await shot(page, 't38-multiturn-light');
await setTheme(page, 'dark');
const sDark = await shot(page, 't38-multiturn-dark');
await setTheme(page, 'light');
info('⑩ 截图（三轮完成态）', `light ${String(sLight.w)}x${String(sLight.h)} / dark ${String(sDark.w)}x${String(sDark.h)}`);

const stBeforeQuit = await storage(page);
const domBeforeQuit = await panelDom(page);
check('⑪ 三轮完成态窗口零滚动（T30 红线）', (domBeforeQuit.winOverflow ?? 1) <= 0,
  `docOverflow=${String(domBeforeQuit.winOverflow)}px`);

// ⑦ 优雅退出 → 重启
const quit1 = await quit(page, r1.pid);
info('⑫ 第 1 次优雅退出（window.close → 自退，不强杀）',
  `gracefulExited=${String(quit1.gracefulExited)} panelRaw=${JSON.stringify(stBeforeQuit.panelRaw)} histCount=${String(stBeforeQuit.histCount)}`);

// ======================= 第 2 次启动（重启还原） =======================
const r2 = await launch('run2');
const page2 = r2.page;
await wait(1500);
if ((await page2.locator('.ai-chat').count()) === 0) {
  await page2.getByRole('button', { name: /AI 对话/ }).first().click();
  await wait(1000);
}
const st2 = await storage(page2);
const dom2 = await panelDom(page2);
check('⑬ 重启后 localStorage 历史逐字还原（6 条 + 原文逐字一致）',
  st2.histCount === stBeforeQuit.histCount && JSON.stringify(st2.histTexts) === JSON.stringify(stBeforeQuit.histTexts),
  `count=${String(st2.histCount)}(quit前 ${String(stBeforeQuit.histCount)}) textsEq=${String(JSON.stringify(st2.histTexts) === JSON.stringify(stBeforeQuit.histTexts))}`);
check('⑬ 重启后面板渲染出 3 轮 user + 3 轮 assistant 气泡（原文一致）',
  dom2.userMsgs === 3 && dom2.assistantMsgs === 3 && JSON.stringify(dom2.userTexts) === JSON.stringify(domBeforeQuit.userTexts),
  `user=${String(dom2.userMsgs)} assistant=${String(dom2.assistantMsgs)} userTextsEq=${String(JSON.stringify(dom2.userTexts) === JSON.stringify(domBeforeQuit.userTexts))}`);
info('⑬ 重启后第三轮 assistant 原文（逐字）',
  JSON.stringify(st2.histTexts?.[5] ?? null));
check('⑬ 重启后第三轮原文仍含 7391', (st2.histTexts?.[5] ?? '').includes('7391'),
  `text=${JSON.stringify(st2.histTexts?.[5] ?? null)}`);
const sRestoreLight = await shot(page2, 't38-multiturn-restored-light');
await setTheme(page2, 'dark');
const sRestoreDark = await shot(page2, 't38-multiturn-restored-dark');
await setTheme(page2, 'light');
info('⑬ 截图（重启还原态）', `light ${String(sRestoreLight.w)}x${String(sRestoreLight.h)} / dark ${String(sRestoreDark.w)}x${String(sRestoreDark.h)}`);

// ⑭ 全程错误计数
check('⑭ 全程 pageerror 计数 = 0', pageErrors.length === 0,
  `pageErrors=${String(pageErrors.length)} ${JSON.stringify(pageErrors.slice(0, 3))}`);
check('⑭ 全程 renderer console error 计数 = 0', consoleErrors.length === 0,
  `consoleErrors=${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 5))}`);

const quit2 = await quit(page2, r2.pid);
info('⑭ 第 2 次优雅退出', `gracefulExited=${String(quit2.gracefulExited)}`);

// ⑮ 夹具隔离自检
const realRootAfter = dirMtime(REAL_ROOT);
check('⑮ 真实数据根 C:\\Users\\Administrator\\.septcats 未被触碰（mtime 前后一致）',
  realRootBefore === realRootAfter, `before=${realRootBefore} after=${realRootAfter}`);

// ⑯ 夹具内 main 侧 ai.log（隐私请求日志，含 app 自计的 ms）
const logFiles = findLogs(RUN);
const aiLogLines = [];
for (const f of logFiles) {
  try {
    aiLogLines.push(...readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('ai chat') || l.includes('ai listModels')));
  } catch {
    /* 忽略 */
  }
}
info('⑯ main 侧 ai.log 原始行（app 自计耗时）', JSON.stringify(aiLogLines));
writeFileSync(join(SHOTS, 'probe-ai.log'), aiLogLines.join('\n'), 'utf8');

const fails = results.filter((r) => r.ok === false).length;
const passes = results.filter((r) => r.ok === true).length;
const payload = {
  task: 'TASK-T38-01 真机探针（真实多轮 · 真实本机端点）',
  ranAt: new Date().toISOString(),
  appdir: APPDIR,
  endpoint: ENDPOINT,
  model: MODEL,
  fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
  probeProductFacts: {
    panelSendPassesMaxTokens: false,
    note: 'AiChatPanel.send() 调 ai.chat({providerId, messages})，不带 maxTokens → 真实请求体无 max_tokens；main/ai/client.ts 默认 chatTimeoutMs=120_000（未改源码）。探针每轮等待上限 180s。',
    cspNote: '渲染器 CSP（apps/desktop/src/renderer/index.html）：connect-src \'self\' asset: attachment: ws://localhost:* http://localhost:* —— 渲染器直连 http://127.0.0.1:1234 会被拦（本探针首轮误用渲染器 fetch 探测时实测到该 console 错误；产品真实调用走 main 侧 net.fetch，不受此限），故本轮端点探测改为探针侧 Node 直连。',
    endpointMirror: '端点直连摸底（探针侧，非面板路径）见 _scratch/endpoint-probe.json：max_tokens=800 → 9.9s content="已记住。" finish_reason=stop reasoning 1033 字符；无 max_tokens → 12.48s content="收到。" finish_reason=stop；多轮 → 11.17s content="7391"。',
  },
  messages: { round1: ROUND1_MSG, round2: ROUND2_MSG, round3: ROUND3_MSG },
  rounds,
  pass: passes,
  fail: fails,
  assertions: results,
  screenshots: shots,
  pageErrors,
  consoleErrors,
  realRootMtime: { before: realRootBefore, after: realRootAfter },
  aiLogLines,
};
writeFileSync(join(SHOTS, 't38-multiturn-results.json'), JSON.stringify(payload, null, 2), 'utf8');
console.log(`\n${String(passes)}/${String(passes + fails)} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${String(fails)} 项失败`}`);
console.log(`results → ${join(SHOTS, 't38-multiturn-results.json')}`);
process.exit(fails === 0 ? 0 : 1);