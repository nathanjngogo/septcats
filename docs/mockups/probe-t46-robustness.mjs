/* TASK-T46-01 真机取证：AI 对话健壮性（可配置超时 + 空正文/纯推理/length 可读提示）。
 *
 * 口径照 docs/mockups/probe-t38-multiturn.mjs：
 * - 直接以 `electron .` 跑仓库已有 out/（**不重打包**、不改产品源码）；
 * - 独立夹具：--user-data-dir + rootPath 全在 _scratch/probe-t46/ 下，
 *   绝不触碰 C:\Users\Administrator\.septcats\（真实数据根，前后 mtime 对账）；
 * - 端点：本探针进程内起一个 OpenAI 兼容桩服务（127.0.0.1，纯本地、零外网），
 *   通过切 mode 制造四种响应形态；产品真实链路 main/ai/client.ts → HTTP → 桩。
 *
 * 覆盖（对齐 TASK-T46-01 §2）：
 *   [A] 空正文 + reasoning_content + finish_reason=length → 提示文案 + 折叠区默认收起/
 *       可展开可逆 + **无空白气泡** + 历史落盘（reasoning/finishReason）→ 双主题截图；
 *   [B] 空正文且无推理 → 「未返回正文」提示 + 无折叠区（不渲染空白气泡）；
 *   [C] requestTimeoutSec=5 + 挂起端点 → 约 5s 中止，面板文案含「等待超过 5 秒已中止」+
 *       调大指引（不是只显示错误码）→ 截图；
 *   [D] requestTimeoutSec=300 + 600ms 慢响应 → 不提前中止，正常渲染；
 *   [E] 恢复未设置（null）→ 生效值回 120s；
 *   [F] maxOutputTokens=800 → 请求体带 max_tokens；清回 null → 请求体不带；
 *   [G] 真机层（SEPTCATS_T46_REAL=1）：真本机端点 http://127.0.0.1:1234/v1（model master）
 *       经面板正常回复 + 耗时。
 *
 * 用法：node docs/mockups/probe-t46-robustness.mjs
 *       SEPTCATS_T46_REAL=1 node docs/mockups/probe-t46-robustness.mjs
 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t46';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9401;
const MOCK_PORT = 18111;
const MOCK_BASE = `http://127.0.0.1:${String(MOCK_PORT)}`;
const MOCK_MODEL = 't46-stub';
const PROVIDER_ID = 't46-stub';
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t46');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const REAL_ENDPOINT = 'http://127.0.0.1:1234/v1';
const REAL_MODEL = 'master';
const REAL = process.env.SEPTCATS_T46_REAL === '1';

const REASONING = '先核对第一块：结论甲；再看第二块：口径乙。据此正文应写「两处一致」。';
const NORMAL_TEXT = '正常回复：本页两处结论一致。';

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
    return execSync(`tasklist /FI "PID eq ${String(pid)}" /NH`, { encoding: 'utf8' }).includes(String(pid));
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// 桩服务：mode 切换响应形态；记录收到的请求体（取证 max_tokens）
// ---------------------------------------------------------------------------
const mock = {
  mode: 'empty-reasoning',
  chatBodies: [],
  chatCount: 0,
};

function payloadForMode() {
  if (mock.mode === 'empty-reasoning') {
    return {
      model: MOCK_MODEL,
      choices: [
        {
          message: { role: 'assistant', content: '', reasoning_content: REASONING },
          finish_reason: 'length',
        },
      ],
    };
  }
  if (mock.mode === 'empty-plain') {
    return {
      model: MOCK_MODEL,
      choices: [{ message: { role: 'assistant', content: '   ' }, finish_reason: 'stop' }],
    };
  }
  return {
    model: MOCK_MODEL,
    choices: [{ message: { role: 'assistant', content: NORMAL_TEXT }, finish_reason: 'stop' }],
  };
}

function startMock() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const url = req.url ?? '';
    if (req.method === 'GET' && url.includes('/v1/models')) {
      res.end(JSON.stringify({ data: [{ id: MOCK_MODEL }] }));
      return;
    }
    if (req.method === 'POST' && url.includes('/v1/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        mock.chatCount += 1;
        mock.chatBodies.push(body);
        if (mock.mode === 'hang') {
          return; // 永不响应 → 走产品侧超时路径
        }
        const send = () => res.end(JSON.stringify(payloadForMode()));
        if (mock.mode === 'slow') {
          setTimeout(send, 600);
          return;
        }
        send();
      });
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  server.listen(MOCK_PORT, '127.0.0.1');
  return server;
}

// ---------------------------------------------------------------------------
// 启动 / 退出
// ---------------------------------------------------------------------------
const pageErrors = [];
const consoleErrors = [];
let launchedPid = null;

async function launch() {
  const proc = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], {
    cwd: APPDIR,
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  launchedPid = proc.pid;
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
  page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  for (let k = 0; k < 40; k++) {
    const ready = await page
      .evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.create === 'function')
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

// ---------------------------------------------------------------------------
// DOM / storage 取证
// ---------------------------------------------------------------------------
const SNAP = () => {
  const bubbles = [...document.querySelectorAll('.ai-chat__msg--assistant .ai-chat__bubble--assistant')];
  const lastBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;
  return {
    userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
    assistantMsgs: bubbles.length,
    busy: document.querySelector('.ai-chat__busy-row') !== null,
    errorText: document.querySelector('.ai-chat__error')?.textContent ?? null,
    gateText: document.querySelector('.ai-chat__gate-text')?.textContent ?? null,
    notices: [...document.querySelectorAll('.ai-chat__msg--assistant .ai-chat__reply-notice')].map((e) => e.textContent),
    lastBubbleText: lastBubble === null ? null : lastBubble.textContent,
    lastBubbleLen: lastBubble === null ? 0 : (lastBubble.textContent ?? '').length,
    toggles: [...document.querySelectorAll('.ai-chat__msg--assistant .ai-chat__reasoning-toggle')].map((e) => ({
      text: e.textContent,
      expanded: e.getAttribute('aria-expanded'),
    })),
    bodies: [...document.querySelectorAll('.ai-chat__reasoning-body')].map((e) => e.textContent),
  };
};
const snap = (page) => page.evaluate(SNAP);

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
      hist = null;
    }
  }
  const msgs = Array.isArray(hist?.messages) ? hist.messages : [];
  const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  return {
    histCount: msgs.length,
    lastRole: last?.role ?? null,
    lastContent: last?.content ?? null,
    lastReasoning: last?.reasoning ?? null,
    lastFinishReason: last?.finishReason ?? null,
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
  await wait(600);
};

const mtime = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return 'absent';
  }
};

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

/** 面板发送一条并等到「出现 assistant 气泡 或 出现错误」（都不出现则按上限超时）。 */
async function sendMsg(page, text, timeoutMs) {
  const before = await snap(page);
  await page.locator('.ai-chat__input').click();
  await page.locator('.ai-chat__input').fill(text);
  const startedAt = Date.now();
  await page.locator('.ai-chat__input').press('Enter');
  let dom = before;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await wait(400);
    dom = await snap(page);
    const replied = dom.assistantMsgs > before.assistantMsgs;
    const errored = (dom.errorText ?? '') !== '' && !dom.busy;
    if ((replied || errored) && !dom.busy) break;
    if (Date.now() > deadline) break;
  }
  return { elapsedMs: Date.now() - startedAt, before, dom };
}

// ===========================================================================
const realRootBefore = mtime(REAL_ROOT);
rmSync(RUN, { recursive: true, force: true });
if (existsSync(SHOTS)) {
  for (const name of readdirSync(SHOTS)) {
    if (name.startsWith('t46-')) rmSync(join(SHOTS, name), { recursive: true, force: true });
  }
}
mkdirSync(UD, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

writeFileSync(
  `${UD}\\septcats.settings.json`,
  JSON.stringify(
    {
      schema: 1,
      rootPath: ROOT,
      theme: 'light',
      locale: 'zh-CN',
      privacy: { telemetry: false, linkPreviewOnType: true },
      editor: { defaultEditMode: 'rich', spellcheck: true },
      data: { note: '' },
      sync: { enabled: false, encrypt: false, gc: false },
      ai: {
        enabled: true,
        cloudConsent: false,
        activeProviderId: PROVIDER_ID,
        providers: [{ id: PROVIDER_ID, kind: 'openai-compatible', name: 'T46 桩端点', baseUrl: MOCK_BASE, model: MOCK_MODEL }],
      },
    },
    null,
    2,
  ),
  'utf8',
);

const mockServer = startMock();
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\nSHOTS=${SHOTS}\nMOCK=${MOCK_BASE} (${MOCK_MODEL})\n`);

const { page, pid } = await launch();

// 建一页（给面板一个已就绪的 workspace，历史才按 ws 落盘）
await page.getByTestId('side-new-page').click();
const nameInput = page.locator('.app-side input').first();
await nameInput.waitFor({ state: 'visible', timeout: 15000 });
await nameInput.fill('T46 健壮性探针页');
await nameInput.press('Enter');
await wait(900);

// 打开 AI 面板
await page.getByRole('button', { name: /AI 对话/ }).first().click();
await wait(900);
const panelOpen = await page.evaluate(() => ({
  count: document.querySelectorAll('.ai-chat').length,
  width: document.querySelector('.ai-chat')?.getBoundingClientRect().width ?? null,
}));
check('① AI 面板打开（.ai-chat 存在，宽 320px）', panelOpen.count === 1 && panelOpen.width === 320, JSON.stringify(panelOpen));

const state0 = await page.evaluate(() => window.septcats.ai.state());
check(
  '① 未设置任何 AI 请求参数 → ai.state() 生效超时 = 120s、maxOutputTokens = null（默认不回归）',
  state0.chatTimeoutSec === 120 && state0.maxOutputTokens === null,
  `chatTimeoutSec=${String(state0.chatTimeoutSec)} maxOutputTokens=${String(state0.maxOutputTokens)}`,
);

// ============ [A] 空正文 + reasoning + length ============
mock.mode = 'empty-reasoning';
const A = await sendMsg(page, '本页讲了什么？', 20_000);
const aDom = A.dom;
check(
  'A1 空正文 + 推理 → 气泡出现「模型未返回正文（仅推理内容）」',
  aDom.notices.includes('模型未返回正文（仅推理内容）'),
  `notices=${JSON.stringify(aDom.notices)}`,
);
check(
  'A2 finish_reason=length → 「达到输出上限，可增大 max_tokens 或重试」',
  aDom.notices.includes('达到输出上限，可增大 max_tokens 或重试'),
  `notices=${JSON.stringify(aDom.notices)}`,
);
check('A3 无空白气泡（assistant 气泡可见文本非空）', aDom.lastBubbleLen > 0, `lastBubbleLen=${String(aDom.lastBubbleLen)} text=${JSON.stringify((aDom.lastBubbleText ?? '').slice(0, 80))}`);
check(
  'A4 折叠区默认收起：aria-expanded=false 且正文不在 DOM',
  aDom.toggles.length === 1 && aDom.toggles[0].expanded === 'false' && aDom.bodies.length === 0,
  `toggles=${JSON.stringify(aDom.toggles)} bodies=${String(aDom.bodies.length)}`,
);
check(
  `A5 折叠按钮文案 =「查看推理内容（${String(REASONING.length)} 字符）」`,
  aDom.toggles.length === 1 && aDom.toggles[0].text === `查看推理内容（${String(REASONING.length)} 字符）`,
  JSON.stringify(aDom.toggles[0] ?? null),
);

// 展开（真实鼠标点击）
await page.locator('.ai-chat__msg--assistant .ai-chat__reasoning-toggle').last().click();
await wait(400);
const aOpen = await snap(page);
check(
  'A6 点开 → 推理原文可见 + aria-expanded=true',
  aOpen.bodies.length === 1 && aOpen.bodies[0] === REASONING && aOpen.toggles[aOpen.toggles.length - 1]?.expanded === 'true',
  `bodies=${JSON.stringify(aOpen.bodies)} toggles=${JSON.stringify(aOpen.toggles)}`,
);

await setTheme(page, 'light');
const shotAOpenLight = await shot(page, 't46-empty-reasoning-expanded-light');
await setTheme(page, 'dark');
const shotAOpenDark = await shot(page, 't46-empty-reasoning-expanded-dark');
await setTheme(page, 'light');

// 收起（可逆）
await page.locator('.ai-chat__msg--assistant .ai-chat__reasoning-toggle').last().click();
await wait(400);
const aClosed = await snap(page);
check('A7 再点 → 折叠可逆（正文重新从 DOM 移除）', aClosed.bodies.length === 0 && aClosed.toggles[aClosed.toggles.length - 1]?.expanded === 'false', JSON.stringify(aClosed.toggles));
const shotAClosedLight = await shot(page, 't46-empty-reasoning-collapsed-light');
await setTheme(page, 'dark');
const shotAClosedDark = await shot(page, 't46-empty-reasoning-collapsed-dark');
await setTheme(page, 'light');
info('A8 截图尺寸', `expanded light ${shotAOpenLight.w}x${shotAOpenLight.h} / dark ${shotAOpenDark.w}x${shotAOpenDark.h}; collapsed light ${shotAClosedLight.w}x${shotAClosedLight.h} / dark ${shotAClosedDark.w}x${shotAClosedDark.h}`);

const aStored = await storage(page);
check(
  'A9 历史落盘：content 为空 + reasoning 保留 + finishReason=length（重启可还原折叠区）',
  aStored.lastRole === 'assistant' && aStored.lastContent === '' && typeof aStored.lastReasoning === 'string' && aStored.lastReasoning.includes('结论甲') && aStored.lastFinishReason === 'length',
  `role=${String(aStored.lastRole)} content=${JSON.stringify(aStored.lastContent)} reasoningLen=${String((aStored.lastReasoning ?? '').length)} finishReason=${String(aStored.lastFinishReason)}`,
);

// ============ [B] 空正文且无推理 ============
mock.mode = 'empty-plain';
const B = await sendMsg(page, '再来一次', 20_000);
check(
  'B1 空正文无推理 → 「模型未返回正文（可重试，或调大「最大输出 tokens」）」',
  B.dom.notices.includes('模型未返回正文（可重试，或调大「最大输出 tokens」）'),
  `notices=${JSON.stringify(B.dom.notices)}`,
);
check('B2 无推理 → 不出现折叠区', B.dom.toggles.length === 1, `toggles=${String(B.dom.toggles.length)}（应仍只有 A 轮那一个）`);
check('B3 无空白气泡（正文为空但气泡有提示文案）', B.dom.lastBubbleLen > 0, `lastBubbleLen=${String(B.dom.lastBubbleLen)}`);

// ============ [C] 超时 5s + 挂起端点 ============
const setC = await page.evaluate(() => window.septcats.ai.setChatConfig({ requestTimeoutSec: 5 }));
check('C1 setChatConfig({requestTimeoutSec:5}) → 生效 5s', setC.chatTimeoutSec === 5, JSON.stringify(setC));
const stateC = await page.evaluate(() => window.septcats.ai.state());
check('C2 ai.state().chatTimeoutSec 同步 = 5', stateC.chatTimeoutSec === 5, `chatTimeoutSec=${String(stateC.chatTimeoutSec)}`);

mock.mode = 'hang';
const C = await sendMsg(page, '慢问题', 30_000);
const cErr = C.dom.errorText ?? '';
check('C3 约 5s 中止（墙钟 4.7–7.0s）', C.elapsedMs >= 4_700 && C.elapsedMs <= 7_000, `elapsedMs=${String(C.elapsedMs)}`);
check('C4 面板文案含「等待超过 5 秒已中止」（不是只显示错误码）', cErr.includes('等待超过 5 秒已中止'), JSON.stringify(cErr));
check('C5 面板文案含调大指引「可在设置 › AI 助手中调大「请求超时」」', cErr.includes('可在设置 › AI 助手中调大「请求超时」'), JSON.stringify(cErr));
check('C6 面板文案不含裸错误码 E_AI_TIMEOUT', !cErr.includes('E_AI_TIMEOUT'), JSON.stringify(cErr));
check('C7 超时轮不落 assistant 历史（只有 user 追加）', C.dom.assistantMsgs === 2, `assistantMsgs=${String(C.dom.assistantMsgs)}（A、B 两轮）`);
await setTheme(page, 'light');
await shot(page, 't46-timeout-5s-light');
await setTheme(page, 'dark');
await shot(page, 't46-timeout-5s-dark');
await setTheme(page, 'light');

// ============ [D] 300s 不提前中止 ============
const setD = await page.evaluate(() => window.septcats.ai.setChatConfig({ requestTimeoutSec: 300 }));
check('D1 setChatConfig({requestTimeoutSec:300}) → 生效 300s', setD.chatTimeoutSec === 300, JSON.stringify(setD));
mock.mode = 'slow';
const D = await sendMsg(page, '慢但能回的请求', 30_000);
check(
  'D2 300s 下 600ms 慢响应正常返回（不提前中止）',
  D.dom.assistantMsgs === 3 && (D.dom.errorText ?? '') === '' && (D.dom.lastBubbleText ?? '').includes(NORMAL_TEXT),
  `elapsedMs=${String(D.elapsedMs)} assistantMsgs=${String(D.dom.assistantMsgs)} error=${JSON.stringify(D.dom.errorText)}`,
);

// ============ [E] 恢复未设置 ============
const setE = await page.evaluate(() => window.septcats.ai.setChatConfig({ requestTimeoutSec: null }));
check('E1 清回未设置（null）→ 生效值回 120s（默认行为）', setE.chatTimeoutSec === 120, JSON.stringify(setE));

// ============ [F] max_tokens 带上/不带 ============
mock.mode = 'normal';
mock.chatBodies.length = 0;
const setF = await page.evaluate(() => window.septcats.ai.setChatConfig({ maxOutputTokens: 800 }));
check('F1 setChatConfig({maxOutputTokens:800}) → 生效 800', setF.maxOutputTokens === 800, JSON.stringify(setF));
const F1 = await sendMsg(page, '带 max_tokens 的一轮', 20_000);
const bodyWith = mock.chatBodies.length > 0 ? JSON.parse(mock.chatBodies[mock.chatBodies.length - 1]) : null;
check(
  'F2 面板请求体带 max_tokens=800（设置生效）',
  bodyWith !== null && bodyWith.max_tokens === 800,
  `body.max_tokens=${String(bodyWith?.max_tokens)} elapsedMs=${String(F1.elapsedMs)}`,
);
await page.evaluate(() => window.septcats.ai.setChatConfig({ maxOutputTokens: null }));
mock.chatBodies.length = 0;
const F3 = await sendMsg(page, '不带 max_tokens 的一轮', 20_000);
const bodyWithout = mock.chatBodies.length > 0 ? JSON.parse(mock.chatBodies[mock.chatBodies.length - 1]) : null;
check(
  'F3 清回 null → 请求体不带 max_tokens（保持既有默认行为）',
  bodyWithout !== null && bodyWithout.max_tokens === undefined,
  `hasMaxTokens=${String(bodyWithout !== null && 'max_tokens' in bodyWithout)} elapsedMs=${String(F3.elapsedMs)}`,
);
info('F4 桩收到的全部请求体 max_tokens 轨迹', JSON.stringify(mock.chatBodies.map((b) => JSON.parse(b).max_tokens ?? null)));

// ============ [G] 真机层（可选） ============
if (REAL) {
  const patched = await page.evaluate(
    async (args) => {
      await window.septcats.settings.patch({
        ai: {
          enabled: true,
          cloudConsent: false,
          activeProviderId: args.id,
          providers: [{ id: args.id, kind: 'lmstudio', name: '真本机端点', baseUrl: args.endpoint, model: args.model }],
        },
      });
      return await window.septcats.ai.state();
    },
    { id: PROVIDER_ID, endpoint: REAL_ENDPOINT, model: REAL_MODEL },
  );
  check('G1 切到真本机端点（isLocal=true）', patched.providers[0]?.isLocal === true, JSON.stringify(patched.providers[0]));
  const real = await sendMsg(page, '用一句话回答：1+1 等于几？', 120_000);
  check(
    'G2 真机轮正常回复（无错误、气泡非空）',
    (real.dom.errorText ?? '') === '' && real.dom.lastBubbleLen > 0,
    `elapsedMs=${String(real.elapsedMs)} error=${JSON.stringify(real.dom.errorText)} text=${JSON.stringify((real.dom.lastBubbleText ?? '').slice(0, 80))}`,
  );
  info('G3 真机轮耗时（面板口径，含本地推理）', `${(real.elapsedMs / 1000).toFixed(2)}s`);
  await setTheme(page, 'light');
  await shot(page, 't46-real-light');
  await setTheme(page, 'dark');
  await shot(page, 't46-real-dark');
  await setTheme(page, 'light');
}

// ============ 卫生与隔离 ============
check('H1 全程 pageerror 计数 0', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
check('H2 全程 renderer console error 计数 0', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
const stFinal = await storage(page);
check('H3 localStorage 无密钥痕迹（sk-/Bearer）', stFinal.hasSecret === false, `hasSecret=${String(stFinal.hasSecret)}`);

const quitInfo = await quit(page, pid);
info('H4 优雅退出（window.close → 自退）', `gracefulExited=${String(quitInfo.gracefulExited)}`);

const realRootAfter = mtime(REAL_ROOT);
check('H5 真实数据根 .septcats 未被触碰（mtime 前后一致）', realRootBefore === realRootAfter, `before=${realRootBefore} after=${realRootAfter}`);

const logFiles = findLogs(RUN);
const aiLogLines = [];
for (const f of logFiles) {
  try {
    aiLogLines.push(...readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('ai chat') || l.includes('ai setChatConfig')));
  } catch {
    /* 忽略 */
  }
}
info('H6 main 侧 ai.log 原始行（app 自计耗时）', JSON.stringify(aiLogLines));
writeFileSync(join(SHOTS, 'probe-ai.log'), aiLogLines.join('\n'), 'utf8');

mockServer.close();
killTree(pid);

const fails = results.filter((r) => r.ok === false).length;
const passes = results.filter((r) => r.ok === true).length;
writeFileSync(
  join(SHOTS, 't46-results.json'),
  JSON.stringify(
    {
      task: 'TASK-T46-01 真机探针（可配置超时 + 空正文/纯推理/length 可读提示）',
      ranAt: new Date().toISOString(),
      appdir: APPDIR,
      fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
      mock: { base: MOCK_BASE, model: MOCK_MODEL, reasoningLength: REASONING.length, chatCount: mock.chatCount },
      real: REAL ? { endpoint: REAL_ENDPOINT, model: REAL_MODEL } : null,
      pass: passes,
      fail: fails,
      assertions: results,
      screenshots: shots,
      pageErrors,
      consoleErrors,
      aiLogLines,
      realRootMtime: { before: realRootBefore, after: realRootAfter },
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`\n${String(passes)}/${String(passes + fails)} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${String(fails)} 项失败`}`);
console.log(`results → ${join(SHOTS, 't46-results.json')}`);
process.exit(fails === 0 ? 0 : 1);
