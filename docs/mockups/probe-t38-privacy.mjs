/* TASK-T38-01 真机取证 —— **网络层**「隐私零外呼」硬不变量（round: privacy/net-log）。
 *
 * 口径（沿用 docs/mockups/probe-t38-multiturn.mjs 的夹具/断言范式）：
 * - 不改产品源码、不重打包：直接以 `electron .` 跑仓库既有 out/；
 * - 夹具 = 把老板真实档案**整目录复制**到 _scratch/probe-t38-privacy/，
 *   --user-data-dir 指向副本 ud、rootPath 指向副本 data；
 *   **绝不向 C:\Users\Administrator\.septcats 或 %APPDATA%\@septcats\desktop 写入任何东西**；
 * - 优雅退出 = window.close()；窗口关不掉才对本进程 PID 树 taskkill；
 * - 全程本地：探针侧显式清空 *_proxy 环境变量；不加任何代理。
 *
 * 网络层证据 = Electron/Chromium **net-log**（--log-net-log），默认 captureMode=Default
 * （Chromium 语义：不记录 cookie / 认证等私有数据）。解析出「请求 URL → 主机名 → 次数」
 * 全表 + DNS（HOST_RESOLVER_MANAGER_REQUEST.host）+ hostResolver 缓存 + proxySettings，
 * 再用 netstat（本进程 PID 树）做系统层旁证。
 *
 * 场景：
 *   baseline   夹具启动、零 AI 交互（对照，用于把「启动噪声」从结论里剔除）
 *   A  本地端点 http://127.0.0.1:1234/v1（model=master）→ **面板真实发送**并等到回复
 *   B  云端端点 https://api-inference.modelscope.cn/v1（占位密钥）+ cloudConsent=false
 *      → 面板发送必须被拒（可读文案）且该主机请求数 = 0
 *
 * 隐私红线：本文件**不打印/不落盘任何密钥、Authorization、token 的值**；
 * 只输出主机名、计数、布尔判定。密钥扫描只报「条数」，且在**含哨兵值时也只报计数**。
 * 哨兵 = 一个**明确不是真密钥**的常量串，用于验证「请求头是否被 net-log 记录」。
 */
import { chromium } from 'playwright-core';
import { spawn, spawnSync, execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// --------------------------------------------------------------------------
// 常量 / 路径
// --------------------------------------------------------------------------
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const APPDIR = join(REPO, 'apps', 'desktop');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT_MAIN = join(APPDIR, 'out', 'main', 'index.js');
const OUT_RENDERER_DIR = join(APPDIR, 'out', 'renderer', 'assets');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t38');
const RESULTS_PATH = join(SHOTS, 't38-privacy-results.json');

const FIX = 'E:\\Hermes Agent工作空间\\_scratch\\probe-t38-privacy';
const FIX_UD = `${FIX}\\profile\\ud`;
const FIX_DATA = `${FIX}\\profile\\data`;
const NETDIR = `${FIX}\\netlog`;

const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
const REAL_UD = 'C:\\Users\\Administrator\\AppData\\Roaming\\@septcats\\desktop';

const LOCAL_ENDPOINT = 'http://127.0.0.1:1234/v1';
const LOCAL_MODEL = 'master';
const CLOUD_HOST = 'api-inference.modelscope.cn';
const CLOUD_BASEURL = `https://${CLOUD_HOST}/v1`;
const CLOUD_MODEL = 'placeholder-model';
/** 哨兵：**不是**真密钥（不含 sk- 形状），仅用于验证请求头是否被 net-log 落盘。 */
const SENTINEL = 'PROBE-NOT-A-REAL-KEY-7f3a1c9e';

const PORT = 9401;
const PANEL_MSG_A = 'Reply with exactly two characters: OK';
const PANEL_MSG_B = 'privacy probe: this message must never leave the machine';
const SEND_TIMEOUT_MS = 180_000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 全程本地：探针侧清干净代理环境变量（不改系统设置）
for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy', 'npm_config_proxy']) {
  delete process.env[k];
}

// --------------------------------------------------------------------------
// 小工具
// --------------------------------------------------------------------------
const results = [];
const check = (name, ok, raw) => {
  results.push({ name, ok, raw: String(raw), kind: 'assert' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw)}`);
};
const info = (name, raw) => {
  results.push({ name: `[info] ${name}`, ok: null, raw: String(raw), kind: 'info' });
  console.log(`INFO  ${name}  — ${String(raw)}`);
};

const sha256 = (file) => {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return 'absent';
  }
};
const mtimeMs = (p) => {
  try {
    return String(statSync(p).mtimeMs);
  } catch {
    return 'absent';
  }
};
/** 目录指纹：顶层条目名+mtime+size 的 sha256（任何增删改都会变）+ 指定关键文件 hash。 */
const fingerprintDir = (dir, keyFiles) => {
  let names = [];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return { dir, exists: false };
  }
  const listing = names.map((n) => {
    const st = statSync(join(dir, n));
    return `${n}|${st.isDirectory() ? 'd' : 'f'}|${String(st.size)}|${String(st.mtimeMs)}`;
  });
  const files = {};
  for (const f of keyFiles) {
    const full = join(dir, f);
    files[f] = { mtimeMs: mtimeMs(full), sha256: existsSync(full) ? sha256(full) : 'absent' };
  }
  return {
    dir,
    exists: true,
    dirMtimeMs: mtimeMs(dir),
    topLevelCount: names.length,
    listingSha256: createHash('sha256').update(listing.join('\n')).digest('hex'),
    files,
  };
};

/** 递归统计文件数/字节数/目录数（用于校验副本完整性）。 */
const treeStats = (root) => {
  let files = 0;
  let bytes = 0;
  let dirs = 0;
  const walk = (d) => {
    let names = [];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const full = join(d, n);
      let st = null;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        dirs += 1;
        walk(full);
      } else {
        files += 1;
        bytes += st.size;
      }
    }
  };
  walk(root);
  return { files, bytes, dirs };
};

/**
 * 目录复制（Windows 原生 robocopy，/E 全量 + 保留时间戳）。
 * 注：本机实测 `fs.cpSync(dir, dir, {recursive:true})` 对**目录**静默不生效
 * （单文件 cpSync 正常），故改用 robocopy 并做完整性核对。
 * robocopy 退出码 <8 = 成功（0 无变化 / 1 有文件 / 2 有额外文件 / 3 = 1+2）。
 */
const robocopyCopy = (src, dst) => {
  const t = Date.now();
  const r = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/R:1', '/W:1'], {
    encoding: 'utf8',
  });
  const exitCode = typeof r.status === 'number' ? r.status : 99;
  return { src, dst, exitCode, ok: exitCode < 8, tookMs: Date.now() - t };
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
/** 当前所有 electron.exe 的 PID（探针启动前应当为 0，用于证明没跑老板的真实实例）。 */
const electronPids = () => {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((l) => /\,"(\d+)",/.exec(l)?.[1])
      .filter((x) => x !== undefined)
      .map((x) => Number(x));
  } catch {
    return [];
  }
};
/** netstat 采样：给定 PID 集合，返回其全部 TCP 远端地址（含状态）计数。 */
const netstatPeers = (pids) => {
  const set = new Set(pids.map((p) => String(p)));
  const wanted = { listen: {}, peers: {} };
  let out = '';
  try {
    out = execSync('netstat -ano', { encoding: 'utf8' });
  } catch {
    return { error: 'netstat-failed' };
  }
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(TCP|TCPv6)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (m === null) continue;
    const pid = m[5];
    if (!set.has(pid)) continue;
    const local = m[2];
    const foreign = m[3];
    const state = m[4];
    if (state === 'LISTENING') {
      wanted.listen[local] = (wanted.listen[local] ?? 0) + 1;
    } else if (!/^0\.0\.0\.0/.test(foreign) && !/^\*:/.test(foreign)) {
      wanted.peers[`${local} → ${foreign} [${state}]`] = (wanted.peers[`${local} → ${foreign} [${state}]`] ?? 0) + 1;
    }
  }
  return wanted;
};
const isLocalHostName = (h) => h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]' || h === '';

// --------------------------------------------------------------------------
// net-log 解析（只输出主机名 / 计数 / 布尔；不输出任何 header 原文）
// --------------------------------------------------------------------------
function parseNetLog(path) {
  const report = { path, exists: existsSync(path), bytes: existsSync(path) ? statSync(path).size : 0 };
  if (!report.exists) return report;
  const raw = readFileSync(path, 'utf8');
  report.chars = raw.length;
  let o = null;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    report.parseError = String(e.message);
    return report;
  }
  const rev = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [String(v), k]));
  const et = rev(o.constants?.logEventTypes ?? {});
  const srct = rev(o.constants?.logSourceType ?? {});
  report.captureMode = o.constants?.logCaptureMode ?? null;
  report.eventCount = (o.events ?? []).length;

  const reqByHost = {};
  const reqByUrl = {};
  const dnsHosts = {};
  const dnsRaw = [];
  const srcTypes = {};
  for (const e of o.events ?? []) {
    const name = et[String(e.type)] ?? `#${String(e.type)}`;
    srcTypes[srct[String(e.source?.type)] ?? '?'] = (srcTypes[srct[String(e.source?.type)] ?? '?'] ?? 0) + 1;
    if (name === 'REQUEST_ALIVE' && typeof e.params?.url === 'string') {
      const u = e.params.url;
      const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(u);
      const key = m === null ? '(unparsed)' : `${m[1]}://${m[2] === '' ? '(no-host)' : m[2]}`;
      reqByHost[key] = (reqByHost[key] ?? 0) + 1;
      const path = m === null ? u : u.slice(u.indexOf('/', m[0].length) === -1 ? u.length : u.indexOf('/', m[0].length));
      const pathOnly = (path.split('?')[0] || '/').slice(0, 80);
      reqByUrl[`${key}${pathOnly}`] = (reqByUrl[`${key}${pathOnly}`] ?? 0) + 1;
    }
    if (name === 'HOST_RESOLVER_MANAGER_REQUEST' && typeof e.params?.host === 'string') {
      const hraw = e.params.host;
      // Chromium 该字段实测是「URL 形态」（如 `http://127.0.0.1:1234`），统一归一到主机名再判定
      let host = hraw;
      const um = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(hraw);
      if (um !== null) host = um[2].split(':')[0];
      else if (!hraw.includes(':')) host = hraw;
      else host = hraw.split(':')[0];
      dnsHosts[host] = (dnsHosts[host] ?? 0) + 1;
      dnsRaw.push(hraw);
    }
  }
  report.requestsByHost = reqByHost;
  report.requestsByUrl = reqByUrl;
  report.dnsLookupHosts = dnsHosts;
  report.dnsLookupRawValues = dnsRaw;
  report.sourceTypes = srcTypes;

  const polled = Array.isArray(o.polledData) ? o.polledData : [];
  const last = polled.length === 0 ? {} : polled[polled.length - 1];
  report.proxySettings = last.proxySettings ?? null;
  report.hostResolverCacheEntries = (last.hostResolverInfo ?? {}).cache?.entries ?? null;
  report.nameservers = (last.hostResolverInfo ?? {}).dns_config?.nameservers ?? null;

  // 主机名集合（判定用）
  const hosts = new Set();
  for (const k of Object.keys(reqByHost)) {
    const h = k.replace(/^[a-z]+:\/\//i, '').split(':')[0];
    hosts.add(h === '(no-host)' ? '' : h);
  }
  report.requestHosts = [...hosts].sort();
  report.externalRequestHosts = report.requestHosts.filter((h) => !isLocalHostName(h));
  report.externalRequestCount = Object.entries(reqByHost)
    .filter(([k]) => !isLocalHostName(k.replace(/^[a-z]+:\/\//i, '').split(':')[0]))
    .reduce((a, [, v]) => a + v, 0);

  // 密钥扫描：**只报条数/布尔**，绝不回显匹配内容
  const bearerMatches = [...raw.matchAll(/Bearer\s+([A-Za-z0-9._~+/=-]{8,})/g)].map((m) => m[1]);
  report.secretScan = {
    skShaped: (raw.match(/sk-[A-Za-z0-9_-]{6,}/g) ?? []).length,
    bearerReadableToken: (raw.match(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g) ?? []).length,
    authorizationMentions: (raw.match(/Authorization/gi) ?? []).length,
    /** 排除探针哨兵（非真密钥）后的「可读 token」条数——本项才是「有没有真密钥落盘」的判据。 */
    readableBearerTokensOtherThanSentinel: bearerMatches.filter((t) => t !== SENTINEL).length,
    /** 探针哨兵（非真密钥）出现次数：仅用于验证请求头是否被 net-log 落盘。 */
    probeSentinelOccurrences: raw.split(SENTINEL).length - 1,
  };
  /** Chromium net-log 的「采集模式行为」观察（与产品无关，但影响任何开 net-log 的排障流程）。 */
  report.authorizationCapture = {
    /** 被 Chromium 脱敏成「[N bytes were stripped]」的条数（HTTP 发送头事件）。 */
    strippedPlaceholders: (raw.match(/\[\d+ bytes? (?:were )?stripped\]/g) ?? []).length,
    /** CORS_REQUEST.headres 未脱敏路径上出现哨兵的次数（>0 = Default 模式也会明文落盘该头）。 */
    corsRequestSentinelHits: (o.events ?? []).filter(
      (e) =>
        et[String(e.type)] === 'CORS_REQUEST' &&
        (typeof e.params?.headers === 'string' ? e.params.headers.includes(SENTINEL) : false),
    ).length,
  };
  report.authHeaderNamesInRequest = (() => {
    const names = [];
    for (const e of o.events ?? []) {
      const hs = e.params?.headers;
      if (Array.isArray(hs) && et[String(e.type)] === 'HTTP_TRANSACTION_SEND_REQUEST_HEADERS') {
        for (const x of hs) if (typeof x === 'string') names.push(x.split(':')[0].trim());
      }
    }
    return names;
  })();
  report.authorizationHeaderValueShape = (() => {
    const out = [];
    for (const e of o.events ?? []) {
      const hs = e.params?.headers;
      if (!Array.isArray(hs)) continue;
      for (const x of hs) {
        if (typeof x === 'string' && /^authorization/i.test(x)) {
          const val = x.slice(x.indexOf(':') + 1).trim();
          out.push({
            valueLength: val.length,
            equalsBearerPlusSentinel: val === `Bearer ${SENTINEL}`,
            looksLikeStrippedPlaceholder: /^\[\d+ bytes? (?:were )?stripped\]$/.test(val),
          });
        }
      }
    }
    return out;
  })();
  return report;
}

/** 通用日志密钥扫描（只报条数）。 */
function scanFileForSecrets(file) {
  if (!existsSync(file)) return { file, exists: false };
  let raw = '';
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    try {
      raw = readFileSync(file).toString('base64');
    } catch {
      return { file, exists: true, unreadable: true };
    }
  }
  return {
    file,
    exists: true,
    bytes: raw.length,
    skShaped: (raw.match(/sk-[A-Za-z0-9_-]{6,}/g) ?? []).length,
    bearerReadableToken: (raw.match(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g) ?? []).length,
    authorizationMentions: (raw.match(/Authorization/gi) ?? []).length,
    probeSentinelOccurrences: raw.split(SENTINEL).length - 1,
  };
}

const findFiles = (dir, name, depth = 0, acc = []) => {
  if (depth > 4) return acc;
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const n of names) {
    const full = join(dir, n);
    let st = null;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) findFiles(full, name, depth + 1, acc);
    else if (n === name) acc.push(full);
  }
  return acc;
};

// --------------------------------------------------------------------------
// 夹具设置
// --------------------------------------------------------------------------
const baseSettings = (ai) => ({
  schema: 1,
  rootPath: FIX_DATA,
  theme: 'light',
  locale: 'zh-CN',
  privacy: { telemetry: false, linkPreviewOnType: true },
  editor: { defaultEditMode: 'rich', spellcheck: true },
  data: { note: '' },
  sync: { enabled: false, encrypt: false, gc: false },
  ai,
});
const SETTINGS_LOCAL = baseSettings({
  enabled: true,
  cloudConsent: false,
  activeProviderId: 'probe-local',
  providers: [{ id: 'probe-local', kind: 'lmstudio', name: '本机真实端点', baseUrl: LOCAL_ENDPOINT, model: LOCAL_MODEL }],
});
const SETTINGS_CLOUD = baseSettings({
  enabled: true,
  cloudConsent: false,
  activeProviderId: 'probe-cloud',
  providers: [
    { id: 'probe-cloud', kind: 'openai-compatible', name: '云端端点（占位）', baseUrl: CLOUD_BASEURL, model: CLOUD_MODEL },
  ],
});
const writeFixtureSettings = (s) => writeFileSync(join(FIX_UD, 'septcats.settings.json'), JSON.stringify(s, null, 2), 'utf8');

// --------------------------------------------------------------------------
// 启动 / 退出
// --------------------------------------------------------------------------
const pageErrors = [];
const consoleErrors = [];
const attach = (page, tag) => {
  page.on('pageerror', (err) => pageErrors.push(`[${tag}] ${String(err?.message ?? err)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${tag}] ${msg.text()}`);
  });
};

async function launch(tag, netlogPath) {
  const args = [
    '.',
    `--user-data-dir=${FIX_UD}`,
    `--remote-debugging-port=${String(PORT)}`,
    `--log-net-log=${netlogPath}`,
    // 安全网：即便出现缺陷，云端主机也被解析到本机（不发往真实外网）。net-log 仍记录真实 URL。
    `--host-resolver-rules=MAP ${CLOUD_HOST} 127.0.0.1`,
  ];
  const proc = spawn(ELECTRON, args, { cwd: APPDIR, detached: true, stdio: 'ignore' });
  proc.unref();
  let br = null;
  for (let k = 0; k < 45 && br === null; k++) {
    await wait(1000);
    try {
      br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
    } catch {
      /* retry */
    }
  }
  if (br === null) throw new Error(`CDP connect failed (${tag})`);
  const page = br.contexts()[0].pages()[0];
  attach(page, tag);
  for (let k = 0; k < 45; k++) {
    const ready = await page
      .evaluate(() => document.querySelector('.app-side') !== null && typeof window.septcats?.pages?.create === 'function')
      .catch(() => false);
    if (ready) break;
    await wait(800);
  }
  await wait(1500);
  return { br, page, pid: proc.pid, args };
}

async function quit(page, pid) {
  try {
    await page.evaluate(() => window.close());
  } catch {
    /* 页面已销毁 */
  }
  await wait(3000);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  await wait(1200);
  return { gracefulExited: !stillAlive, forcedKill: stillAlive };
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
      hist = null;
    }
  }
  const msgs = Array.isArray(hist?.messages) ? hist.messages : [];
  return {
    histKey: histKey ?? null,
    histCount: msgs.length,
    histRoles: msgs.map((m) => m.role),
    histTexts: msgs.map((m) => m.content),
    lastAssistant: msgs.filter((m) => m.role === 'assistant').slice(-1)[0]?.content ?? null,
    allKeys: Object.keys(out),
  };
};
const storage = (page) => page.evaluate(STORAGE);

const PANDOM = () => ({
  panelCount: document.querySelectorAll('.ai-chat').length,
  userMsgs: document.querySelectorAll('.ai-chat__msg--user').length,
  assistantMsgs: document.querySelectorAll('.ai-chat__msg--assistant').length,
  assistantTexts: [...document.querySelectorAll('.ai-chat__msg--assistant .ai-chat__bubble')].map((el) => el.textContent),
  busy: document.querySelector('.ai-chat__busy-row') !== null,
  errorText: document.querySelector('.ai-chat__error')?.textContent ?? null,
  gateText: document.querySelector('.ai-chat__gate-text')?.textContent ?? null,
  emptyHistory: document.querySelector('.ai-chat__empty') !== null,
  winOverflow:
    document.scrollingElement !== null
      ? document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight
      : null,
});
const panelDom = (page) => page.evaluate(PANDOM);

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const shots = [];
/** 只截「探针自己的 UI 片段」（pluck 指定的选择器），避免截入老板真实笔记内容。 */
const shotOf = async (page, selector, name) => {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) return null;
  const clip = {
    x: Math.max(0, Math.floor(box.x) - 4),
    y: Math.max(0, Math.floor(box.y) - 4),
    width: Math.ceil(box.width) + 8,
    height: Math.ceil(box.height) + 8,
  };
  const buf = await page.screenshot({ path: join(SHOTS, `${name}.png`), clip });
  const size = pngSize(buf);
  shots.push({ file: `${name}.png`, selector, clip, width: size.w, height: size.h, bytes: buf.length });
  return size;
};

const openPanel = async (page) => {
  const n = await page.locator('.ai-chat').count();
  if (n === 0) {
    await page.getByRole('button', { name: /AI 对话/ }).first().click();
    await wait(900);
  }
  return panelDom(page);
};

/** 清空面板历史（先走产品 UI 的「清空历史」，失败再退回夹具 localStorage 操作）。
 *  目的：保证发出去的消息上下文里**没有老板真实历史**，只有探针自己的文本。 */
const clearPanelHistory = async (page) => {
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  const before = await storage(page);
  await page.locator('.ai-chat__head button[aria-label="清空历史"]').first().click().catch(() => {});
  await wait(700);
  let after = await storage(page);
  let via = 'product-ui';
  if (after.histCount > 0) {
    via = 'fixture-localStorage+reload';
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('septcats.aichat.history.')) localStorage.removeItem(k);
      }
    });
    await page.reload();
    await wait(2500);
    await openPanel(page);
    after = await storage(page);
  }
  return { before, after, via };
};

/** 面板真实发送（Enter），等到 assistant 消息数增加或出现错误态。 */
const sendViaPanel = async (page, msg, timeoutMs = SEND_TIMEOUT_MS) => {
  const before = await panelDom(page);
  const histBefore = await storage(page);
  await page.locator('.ai-chat__input').click();
  await page.locator('.ai-chat__input').fill(msg);
  const t = Date.now();
  await page.locator('.ai-chat__input').press('Enter');
  let dom = before;
  let timedOut = false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await wait(1000);
    dom = await panelDom(page);
    const replied = dom.assistantMsgs > before.assistantMsgs || dom.errorText !== null;
    if (replied || (!dom.busy && Date.now() - t > 2000)) break;
    if (Date.now() > deadline) {
      timedOut = true;
      break;
    }
  }
  const elapsed = ((Date.now() - t) / 1000).toFixed(2);
  const histAfter = await storage(page);
  return { before, dom, elapsed, timedOut, histBefore, histAfter };
};

// ==========================================================================
// 阶段 0：前置检查 + 真实档案指纹（BEFORE）
// ==========================================================================
console.log(`repo=${REPO}\nappdir=${APPDIR}\nfixture=${FIX}\nnetlog=${NETDIR}\nshots=${SHOTS}\n`);

const outFingerprintBefore = {
  mainIndex: { mtimeMs: mtimeMs(OUT_MAIN), sha256: sha256(OUT_MAIN) },
  rendererAssets: (() => {
    try {
      const names = readdirSync(OUT_RENDERER_DIR).sort();
      return Object.fromEntries(names.map((n) => [n, sha256(join(OUT_RENDERER_DIR, n))]));
    } catch {
      return {};
    }
  })(),
};

const preflight = {
  ranAt: new Date().toISOString(),
  proxyEnvVars: ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy'].map((k) => `${k}=${process.env[k] ?? '(deleted)'}`),
  electronPidsBefore: electronPids(),
  endpointReachableProbeSide: null,
  localEndpoint: LOCAL_ENDPOINT,
  localModel: LOCAL_MODEL,
  cloudBaseUrl: CLOUD_BASEURL,
};
info('前置：探针进程代理环境变量', JSON.stringify(preflight.proxyEnvVars));
check('前置：探针启动前本机无 electron.exe 在跑（真实档案无活动写入者）', preflight.electronPidsBefore.length === 0,
  `electronPids=${JSON.stringify(preflight.electronPidsBefore)}`);

// 探针侧 Node 直连本机端点（纯本地，零外网）——证明端点真的活着、真的有该模型
const endpointProbe = await (async () => {
  try {
    const res = await fetch(`${LOCAL_ENDPOINT}/models`, { signal: AbortSignal.timeout(10_000) });
    const body = await res.json();
    return { ok: res.ok, status: res.status, ids: (body.data ?? []).map((m) => m.id) };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
})();
preflight.endpointReachableProbeSide = endpointProbe;
check('前置：本机端点 /v1/models 可达且含模型 master（探针侧 Node 直连）',
  endpointProbe.ok === true && (endpointProbe.ids ?? []).includes(LOCAL_MODEL), JSON.stringify(endpointProbe));

const realRootBefore = fingerprintDir(REAL_ROOT, ['septcats.db', 'septcats.db-wal', 'septcats.db-shm', 'logs\\main.log', 'logs\\ai.log', 'logs\\sync.log']);
const realUDBefore = fingerprintDir(REAL_UD, ['septcats.settings.json', 'Preferences', 'Local State']);
info('真实档案指纹（BEFORE）· 数据根', JSON.stringify(realRootBefore));
info('真实档案指纹（BEFORE）· userData', JSON.stringify(realUDBefore));

// ==========================================================================
// 阶段 1：复制真实档案 → 夹具
// ==========================================================================
rmSync(FIX, { recursive: true, force: true });
if (existsSync(SHOTS)) {
  for (const n of readdirSync(SHOTS)) if (n.startsWith('t38-privacy')) rmSync(join(SHOTS, n), { force: true });
}
mkdirSync(join(FIX, 'profile'), { recursive: true });
mkdirSync(NETDIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const tCopy = Date.now();
const copyInfo = {
  userData: robocopyCopy(REAL_UD, FIX_UD),
  dataRoot: robocopyCopy(REAL_ROOT, FIX_DATA),
};
const copyMs = Date.now() - tCopy;
const fixDataAfterCopy = fingerprintDir(FIX_DATA, ['septcats.db', 'septcats.db-wal', 'septcats.db-shm']);
const fixUDAfterCopy = fingerprintDir(FIX_UD, ['septcats.settings.json']);
const srcTree = treeStats(REAL_ROOT);
const dstTree = treeStats(FIX_DATA);
const srcUdTree = treeStats(REAL_UD);
const dstUdTree = treeStats(FIX_UD);
const fixUDCopiedSettingsOk = existsSync(join(FIX_UD, 'septcats.settings.json'));
info('夹具复制完成', JSON.stringify({ ...copyInfo, copyMs, dataTree: { src: srcTree, dst: dstTree }, udTree: { src: srcUdTree, dst: dstUdTree } }));
check('F-1 夹具副本完整（robocopy 退出码 <8，文件数/字节数与真实档案逐一相等）',
  copyInfo.userData.ok && copyInfo.dataRoot.ok &&
    srcTree.files === dstTree.files && srcTree.bytes === dstTree.bytes &&
    srcUdTree.files === dstUdTree.files && srcUdTree.bytes === dstUdTree.bytes,
  `data: robocopyExit=${String(copyInfo.dataRoot.exitCode)} files ${String(srcTree.files)}→${String(dstTree.files)} bytes ${String(srcTree.bytes)}→${String(dstTree.bytes)}；ud: robocopyExit=${String(copyInfo.userData.exitCode)} files ${String(srcUdTree.files)}→${String(dstUdTree.files)} bytes ${String(srcUdTree.bytes)}→${String(dstUdTree.bytes)}；耗时 ${String(copyMs)}ms`);
check('F-2 夹具副本 = 真实档案的忠实副本（septcats.db 与 settings.json 的 sha256 与真实一致）',
  fixDataAfterCopy.files['septcats.db'].sha256 === realRootBefore.files['septcats.db'].sha256 &&
    fixUDAfterCopy.files['septcats.settings.json'].sha256 === realUDBefore.files['septcats.settings.json'].sha256,
  `copyDbSha=${fixDataAfterCopy.files['septcats.db'].sha256.slice(0, 16)}… realDbSha=${realRootBefore.files['septcats.db'].sha256.slice(0, 16)}… copySettingsSha=${fixUDAfterCopy.files['septcats.settings.json'].sha256.slice(0, 16)}… realSettingsSha=${realUDBefore.files['septcats.settings.json'].sha256.slice(0, 16)}…`);
writeFixtureSettings(SETTINGS_LOCAL);

// ==========================================================================
// 阶段 2：baseline 运行（零 AI 交互，capture 启动噪声）
// ==========================================================================
const NET_BASE = join(NETDIR, 'baseline.json');
const runs = {};
{
  const r = await launch('baseline', NET_BASE);
  await wait(9000); // 覆盖 main 侧 updater 5s 自动检查窗口
  const dom = await panelDom(r.page);
  const st = await storage(r.page);
  runs.baseline = { pid: r.pid, args: r.args, panelOpened: dom.panelCount, histCount: st.histCount, dom };
  const q = await quit(r.page, r.pid);
  runs.baseline.exit = q;
  info('baseline 运行（零 AI 交互）', `panelCount=${String(dom.panelCount)} gracefulExited=${String(q.gracefulExited)} forcedKill=${String(q.forcedKill)}`);
}

// ==========================================================================
// 阶段 3：场景 A —— 本地端点，面板真实发送
// ==========================================================================
const NET_A = join(NETDIR, 'scenarioA-local.json');
{
  writeFixtureSettings(SETTINGS_LOCAL);
  const r = await launch('scenA', NET_A);
  const page = r.page;

  // 清空本工作区既有 AI 历史（副本内），保证发出去的上下文只有探针文本
  await openPanel(page);
  const clear = await clearPanelHistory(page);
  info('场景 A：清空面板历史（副本内）——老板真实历史条数（仅计数）',
    JSON.stringify({ via: clear.via, beforeCount: clear.before.histCount, afterCount: clear.after.histCount }));
  check('A-0 发送前面板历史已清空（保证请求上下文只有探针文本，无老板真实历史）',
    clear.after.histCount === 0, `count=${String(clear.after.histCount)} via=${clear.via}`);

  // 建探针页 + 合成正文（面板上下文 = 当前页 → 只发送探针自己的文本）
  await page.getByTestId('side-new-page').click();
  const nameInput = page.locator('.app-side input').first();
  await nameInput.waitFor({ state: 'visible', timeout: 15000 });
  await nameInput.fill('T38 privacy probe page');
  await nameInput.press('Enter');
  await wait(900);
  await page.locator('.pv-body').first().click();
  await page.keyboard.type('privacy probe line one: synthetic text only.', { delay: 10 });
  await wait(1500);
  const activeTitle = await page.evaluate(() => document.querySelector('.pv-title, .pv-header')?.textContent ?? null);
  info('场景 A：当前页（面板上下文来源）', JSON.stringify(activeTitle));

  // 哨兵密钥（**不是真密钥**）：验证请求头是否会被 net-log 记录
  const setKeyRes = await page.evaluate(
    async (sentinel) => {
      try {
        await window.septcats.ai.setKey({ providerId: 'probe-local', key: sentinel });
        const s = await window.septcats.ai.state();
        const p = s.providers.find((x) => x.id === 'probe-local');
        return { ok: true, hasKey: p?.hasKey ?? null, isLocal: p?.isLocal ?? null, enabled: s.enabled, cloudConsent: s.cloudConsent };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    SENTINEL,
  );
  info('场景 A：夹具 ai.state()（哨兵密钥写入后，hasKey 应为 true）', JSON.stringify(setKeyRes));

  const peersIdle = netstatPeers(electronPids());
  const send = await sendViaPanel(page, PANEL_MSG_A);
  const peersAfter = netstatPeers(electronPids());

  const domA = await panelDom(page);
  const stA = await storage(page);
  const reply = stA.lastAssistant;
  check('A-1 面板真实发送后收到 AI 回复（非空原文，非错误态）',
    typeof reply === 'string' && reply.length > 0 && domA.errorText === null,
    `reply=${JSON.stringify(reply)} errorText=${JSON.stringify(domA.errorText)} assistantMsgs=${String(domA.assistantMsgs)} userMsgs=${String(domA.userMsgs)} elapsed=${send.elapsed}s timedOut=${String(send.timedOut)}`);
  info('A-2 面板 DOM 快照', JSON.stringify({ userMsgs: domA.userMsgs, assistantMsgs: domA.assistantMsgs, assistantTexts: domA.assistantTexts, errorText: domA.errorText, busy: domA.busy }));
  info('A-3 面板历史（localStorage，副本内，逐字）', JSON.stringify({ histKey: stA.histKey, histCount: stA.histCount, histRoles: stA.histRoles, histTexts: stA.histTexts }));
  await shotOf(page, '.ai-chat__msg--assistant', 't38-privacy-a-assistant-reply');

  runs.scenarioA = {
    pid: r.pid,
    args: r.args,
    send: { elapsed_s: send.elapsed, timedOut: send.timedOut },
    dom: domA,
    storage: { histKey: stA.histKey, histCount: stA.histCount, histRoles: stA.histRoles, histTexts: stA.histTexts },
    reply,
    setKeyRes,
    activeTitle,
    historyClear: clear,
    netstat: { idle: peersIdle, after: peersAfter },
  };
  const q = await quit(page, r.pid);
  runs.scenarioA.exit = q;
  info('场景 A：优雅退出', `gracefulExited=${String(q.gracefulExited)} forcedKill=${String(q.forcedKill)}`);
}

// ==========================================================================
// 阶段 4：场景 B —— 云端端点 + cloudConsent=false
// ==========================================================================
const NET_B = join(NETDIR, 'scenarioB-cloud-denied.json');
{
  writeFixtureSettings(SETTINGS_CLOUD);
  const r = await launch('scenB', NET_B);
  const page = r.page;
  await openPanel(page);
  const clear = await clearPanelHistory(page);
  info('场景 B：清空面板历史（副本内，仅计数）', JSON.stringify({ via: clear.via, beforeCount: clear.before.histCount, afterCount: clear.after.histCount }));
  const setKeyRes = await page.evaluate(
    async (sentinel) => {
      try {
        await window.septcats.ai.setKey({ providerId: 'probe-cloud', key: sentinel });
        const s = await window.septcats.ai.state();
        const p = s.providers.find((x) => x.id === 'probe-cloud');
        return { ok: true, hasKey: p?.hasKey ?? null, isLocal: p?.isLocal ?? null, baseUrl: p?.baseUrl ?? null, model: p?.model ?? null, enabled: s.enabled, cloudConsent: s.cloudConsent };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    SENTINEL,
  );
  info('场景 B：夹具 ai.state()（云端 provider，占位密钥已写入，cloudConsent=false）', JSON.stringify(setKeyRes));
  check('B-0 夹具云端 provider 命中占位云端地址且被判为非本地', setKeyRes.isLocal === false && setKeyRes.baseUrl === CLOUD_BASEURL,
    JSON.stringify(setKeyRes));

  const peersIdle = netstatPeers(electronPids());
  const send = await sendViaPanel(page, PANEL_MSG_B, 30_000);

  // 断言②：netstat 多次采样（发出去之后 12s），看有没有非本地对端
  const peerSamples = [];
  for (let i = 0; i < 6; i += 1) {
    peerSamples.push(netstatPeers(electronPids()));
    await wait(2000);
  }
  const domB = await panelDom(page);
  const stB = await storage(page);
  const errText = domB.errorText;
  check('B-1 界面给出可读拒绝提示（role=alert 的 .ai-chat__error 非空，含 E_AI_CLOUD_DENIED 与中文说明）',
    typeof errText === 'string' && errText.includes('E_AI_CLOUD_DENIED') && errText.includes('非本地端点需在设置中显式开启云端调用'),
    `errorText=${JSON.stringify(errText)}`);
  info('B-2 拒绝提示原文（产品文案，非密钥）', JSON.stringify(errText));
  check('B-3 拒绝后没有新增 assistant 消息（数据未出网 → 无回复可落）',
    domB.assistantMsgs === 0 && stB.histCount === 1,
    `assistantMsgs=${String(domB.assistantMsgs)} histCount=${String(stB.histCount)} histRoles=${JSON.stringify(stB.histRoles)} histTexts=${JSON.stringify(stB.histTexts)}`);
  check('B-4 面板回到非 busy 态（未有在途请求挂住）', domB.busy === false, `busy=${String(domB.busy)}`);
  await shotOf(page, '.ai-chat__error', 't38-privacy-b-cloud-denied-error');

  runs.scenarioB = {
    pid: r.pid,
    args: r.args,
    send: { elapsed_s: send.elapsed, timedOut: send.timedOut },
    dom: domB,
    storage: { histKey: stB.histKey, histCount: stB.histCount, histRoles: stB.histRoles, histTexts: stB.histTexts },
    errorText: errText,
    setKeyRes,
    historyClear: clear,
    netstat: { idle: peersIdle, samples: peerSamples },
  };
  const q = await quit(page, r.pid);
  runs.scenarioB.exit = q;
  info('场景 B：优雅退出', `gracefulExited=${String(q.gracefulExited)} forcedKill=${String(q.forcedKill)}`);
}

// ==========================================================================
// 阶段 5：解析 net-log（网络层主证据）
// ==========================================================================
const netlogs = {
  baseline: parseNetLog(NET_BASE),
  scenarioA: parseNetLog(NET_A),
  scenarioB: parseNetLog(NET_B),
};
for (const [k, v] of Object.entries(netlogs)) {
  info(`net-log[${k}] 概览`, JSON.stringify({ exists: v.exists, bytes: v.bytes, events: v.eventCount, captureMode: v.captureMode, requestsByHost: v.requestsByHost, requestsByUrl: v.requestsByUrl, dnsLookupHosts: v.dnsLookupHosts, hostResolverCacheEntries: v.hostResolverCacheEntries, proxySettings: v.proxySettings, nameservers: v.nameservers }));
}
check('N-0 三份 net-log 均解析成功（事件数 > 0）',
  Object.values(netlogs).every((v) => v.parseError === undefined && (v.eventCount ?? 0) > 0),
  JSON.stringify(Object.fromEntries(Object.entries(netlogs).map(([k, v]) => [k, { bytes: v.bytes, events: v.eventCount ?? 0, parseError: v.parseError ?? null }]))));

const hostsA = netlogs.scenarioA.requestHosts ?? [];
const hostsB = netlogs.scenarioB.requestHosts ?? [];
const hostsBase = netlogs.baseline.requestHosts ?? [];

check('N-1 场景 A：所有网络请求主机名 ⊆ 本地（127.0.0.1/localhost/::1），零外部主机',
  (netlogs.scenarioA.externalRequestHosts ?? []).length === 0,
  `hosts=${JSON.stringify(netlogs.scenarioA.requestsByHost)} externalHosts=${JSON.stringify(netlogs.scenarioA.externalRequestHosts ?? [])}`);
check('N-2 场景 A：本机端点确实被请求（面板路径真实命中 127.0.0.1:1234）',
  Object.entries(netlogs.scenarioA.requestsByHost ?? {}).some(([k, c]) => k.includes('127.0.0.1:1234') && c > 0),
  `endpointRequests=${JSON.stringify(Object.fromEntries(Object.entries(netlogs.scenarioA.requestsByHost ?? {}).filter(([k]) => k.includes('1234'))))} byUrl=${JSON.stringify(netlogs.scenarioA.requestsByUrl)}`);
check('N-3 场景 A：相对 baseline 新增请求主机 ⊆ 本地集合（无新增外部主机）',
  hostsA.filter((h) => !hostsBase.includes(h)).every((h) => isLocalHostName(h)),
  `newVsBaseline=${JSON.stringify(hostsA.filter((h) => !hostsBase.includes(h)))} baseline=${JSON.stringify(hostsBase)}`);
check('N-4 场景 A：DNS 层只解析本地名（HOST_RESOLVER_MANAGER_REQUEST.host 全为本地）',
  Object.keys(netlogs.scenarioA.dnsLookupHosts ?? {}).every((h) => isLocalHostName(h)),
  `dnsLookupHosts=${JSON.stringify(netlogs.scenarioA.dnsLookupHosts)}`);
check('N-5 场景 B：对云端主机 api-inference.modelscope.cn 的请求次数 = 0（数据未出网）',
  (netlogs.scenarioB.requestsByHost?.[`https://${CLOUD_HOST}`] ?? 0) === 0 &&
    !Object.keys(netlogs.scenarioB.requestsByUrl ?? {}).some((u) => u.includes(CLOUD_HOST)),
  `cloudHostCount=${String(netlogs.scenarioB.requestsByHost?.[`https://${CLOUD_HOST}`] ?? 0)} requestsByHost=${JSON.stringify(netlogs.scenarioB.requestsByHost ?? {})} requestsByUrl=${JSON.stringify(netlogs.scenarioB.requestsByUrl ?? {})}`);
check('N-6 场景 B：整轮零外部主机请求（externalRequestHosts 为空）',
  (netlogs.scenarioB.externalRequestHosts ?? []).length === 0 && (netlogs.scenarioB.externalRequestCount ?? 0) === 0,
  `externalHosts=${JSON.stringify(netlogs.scenarioB.externalRequestHosts ?? [])} externalCount=${String(netlogs.scenarioB.externalRequestCount ?? 0)}`);
check('N-7 场景 B：DNS 层零云端主机解析（hostResolver 缓存与 DNS 事件双双为空/无该主机）',
  Object.keys(netlogs.scenarioB.dnsLookupHosts ?? {}).every((h) => isLocalHostName(h)) &&
    !JSON.stringify(netlogs.scenarioB.hostResolverCacheEntries ?? []).includes(CLOUD_HOST),
  `dnsLookupHosts=${JSON.stringify(netlogs.scenarioB.dnsLookupHosts ?? {})} resolverCache=${JSON.stringify(netlogs.scenarioB.hostResolverCacheEntries ?? null)}`);
check('N-8 三次运行均未使用显式代理（net-log proxySettings 无 fixed_servers/无自定义代理服务器）',
  Object.values(netlogs).every((v) => {
    const s = JSON.stringify(v.proxySettings ?? {});
    return !s.includes('fixed_servers') && !s.includes('pac_string') && v.proxySettings !== null;
  }),
  JSON.stringify(Object.fromEntries(Object.entries(netlogs).map(([k, v]) => [k, v.proxySettings]))));
check('N-9 baseline（零 AI 交互）net-log 里 URL 请求数 = 0（启动无任何后台外联/噪声，对照成立）',
  Object.keys(netlogs.baseline.requestsByHost ?? {}).length === 0,
  `baselineRequests=${JSON.stringify(netlogs.baseline.requestsByHost ?? {})} events=${String(netlogs.baseline.eventCount ?? 0)}`);
check('N-10 场景 B 全程该进程树 URL 请求数 = 0（连本机端点都没有；证明拒绝发生在请求构造之前）',
  Object.keys(netlogs.scenarioB.requestsByHost ?? {}).length === 0,
  `scenarioBRequests=${JSON.stringify(netlogs.scenarioB.requestsByHost ?? {})} events=${String(netlogs.scenarioB.eventCount ?? 0)}`);

// netstat 旁证
const flatten = (obj) => Object.entries(obj ?? {}).flatMap(([k, c]) => Array.from({ length: c }, () => k));
const allBPeers = (runs.scenarioB.netstat.samples ?? []).flatMap((s) => flatten(s.peers));
const nonLocalPeers = allBPeers.filter((p) => {
  const m = /→\s+(\S+)\s+\[/.exec(p);
  if (m === null) return true;
  const host = m[1].replace(/^\[|\]$/g, '').split(':')[0];
  return !['127.0.0.1', '::1', '0.0.0.0', '*'].includes(host);
});
check('S-1 场景 B：netstat 采样中进程树无任何非本地对端连接',
  nonLocalPeers.length === 0,
  `samples=${String((runs.scenarioB.netstat.samples ?? []).length)} peers=${JSON.stringify(allBPeers)} nonLocal=${JSON.stringify(nonLocalPeers)}`);
info('S-2 场景 A：进程树对端（含本机端点连接）', JSON.stringify({ idle: runs.scenarioA.netstat.idle, after: runs.scenarioA.netstat.after }));

// ==========================================================================
// 阶段 6：密钥不泄露（只报计数）
// ==========================================================================
const fixtureLogFiles = [...findFiles(FIX, 'ai.log'), ...findFiles(FIX, 'main.log'), ...findFiles(FIX, 'sync.log')];
const logScans = fixtureLogFiles.map((f) => scanFileForSecrets(f));
const aiLogs = fixtureLogFiles.filter((f) => f.endsWith('ai.log'));
const aiLogLines = aiLogs.flatMap((f) => {
  try {
    return readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('ai chat') || l.includes('ai listModels'));
  } catch {
    return [];
  }
});
info('L-1 main 侧 ai.log 原始行（产品自记：op provider host 耗时 结果码；无 prompt/响应体/密钥）', JSON.stringify(aiLogLines));
const localLogHits = aiLogLines.filter((l) => l.includes('probe-local') && l.includes('127.0.0.1:1234'));
const cloudLogHits = aiLogLines.filter((l) => l.includes('probe-cloud') || l.includes(CLOUD_HOST));
check('L-2 场景 A：ai.log 有本机端点成功行（ok(...)）——证明请求由 main 侧真实发出并成功',
  localLogHits.some((l) => l.includes('ok(')), JSON.stringify(localLogHits));
check('L-3 场景 B：ai.log 里云端 provider/host 命中行数 = 0（门禁拒绝早于日志/请求构造）',
  cloudLogHits.length === 0, `cloudLogHits=${JSON.stringify(cloudLogHits)}`);
check('L-4 场景 B：任何产品日志里都不出现云端主机名（连一行都没有）',
  cloudLogHits.length === 0 && aiLogLines.every((l) => !l.includes(CLOUD_HOST)),
  `logFiles=${JSON.stringify(logScans.map((s) => ({ f: s.file.replace(FIX, '<fix>'), bytes: s.bytes })))}`);

const netlogScans = Object.entries(netlogs).map(([k, v]) => ({ run: k, ...(v.secretScan ?? {}) }));
const authCaptures = Object.entries(netlogs).map(([k, v]) => ({ run: k, ...(v.authorizationCapture ?? {}), headerNames: v.authHeaderNamesInRequest ?? [], valueShape: v.authorizationHeaderValueShape ?? [] }));
const credFiles = findFiles(FIX, 'septcats__ai-probe-local.enc').concat(findFiles(FIX, 'septcats__ai-probe-cloud.enc'));
const credScans = credFiles.map((f) => {
  const raw = readFileSync(f, 'utf8');
  return { file: f.replace(FIX, '<fix>'), bytes: raw.length, looksBase64: /^[A-Za-z0-9+/=]+$/.test(raw.trim().slice(0, 200)), sentinelPlaintextOccurrences: raw.split(SENTINEL).length - 1 };
});
info('C-1 凭据文件（DPAPI 密文，仅计数与形状）', JSON.stringify(credScans));
const allSecretCounts = [
  ...netlogScans.map((s) => ({ where: `netlog:${String(s.run)}`, sk: s.skShaped, bearer: s.bearerReadableToken, auth: s.authorizationMentions, otherThanSentinel: s.readableBearerTokensOtherThanSentinel, sentinel: s.probeSentinelOccurrences })),
  ...logScans.map((s) => ({ where: `log:${s.file.replace(FIX, '<fix>')}`, sk: s.skShaped, bearer: s.bearerReadableToken, auth: s.authorizationMentions, otherThanSentinel: s.readableBearerTokensOtherThanSentinel, sentinel: s.probeSentinelOccurrences })),
];
check('C-2 产品自身日志/账本零密钥泄露（fixture ai.log / main.log / sync.log：sk- 形状 = 0、可读 Bearer = 0、Authorization 提及 = 0、哨兵 = 0）',
  logScans.every((s) => s.skShaped === 0 && s.bearerReadableToken === 0 && s.authorizationMentions === 0 && s.probeSentinelOccurrences === 0),
  JSON.stringify(logScans.map((s) => ({ f: s.file.replace(FIX, '<fix>'), sk: s.skShaped, bearer: s.bearerReadableToken, auth: s.authorizationMentions, sentinel: s.probeSentinelOccurrences }))));
check('C-3 net-log 中未出现**真**密钥/令牌（sk- 形状 = 0；排除探针哨兵后，可读 Bearer token = 0）',
  netlogScans.every((s) => s.skShaped === 0 && s.readableBearerTokensOtherThanSentinel === 0),
  JSON.stringify(netlogScans.map((s) => ({ run: s.run, sk: s.skShaped, bearerTotal: s.bearerReadableToken, otherThanSentinel: s.readableBearerTokensOtherThanSentinel, sentinel: s.probeSentinelOccurrences, authorizationMentions: s.authorizationMentions }))));
info('C-3b net-log 采集模式行为（Chromium 既有行为，非产品缺陷）· Authorization 头脱敏证据', JSON.stringify(authCaptures));
check('C-4 夹具凭据为 DPAPI 密文（不含哨兵明文）',
  credScans.length >= 1 && credScans.every((c) => c.sentinelPlaintextOccurrences === 0 && c.bytes > 0),
  JSON.stringify(credScans));
check('C-5 产品侧无任何把密钥写进日志的代码路径证据：ai.log 行只含 op/providerId/host/model/耗时/结果码，无 prompt、无响应体、无密钥',
  aiLogLines.every((l) => !/sk-|Bearer|Authorization/i.test(l)) && aiLogLines.length > 0,
  JSON.stringify(aiLogLines));

// ==========================================================================
// 阶段 7：只读合规自检（AFTER）
// ==========================================================================
const realRootAfter = fingerprintDir(REAL_ROOT, ['septcats.db', 'septcats.db-wal', 'septcats.db-shm', 'logs\\main.log', 'logs\\ai.log', 'logs\\sync.log']);
const realUDAfter = fingerprintDir(REAL_UD, ['septcats.settings.json', 'Preferences', 'Local State']);
const fixDataAfter = fingerprintDir(FIX_DATA, ['septcats.db', 'septcats.db-wal', 'septcats.db-shm']);
const fixUDAfter = fingerprintDir(FIX_UD, ['septcats.settings.json']);

check('R-1 真实数据根 C:\\Users\\Administrator\\.septcats 未被触碰（目录 mtime 前后一致 + 顶层条目指纹一致）',
  realRootBefore.dirMtimeMs === realRootAfter.dirMtimeMs && realRootBefore.listingSha256 === realRootAfter.listingSha256,
  `dirMtimeMs ${String(realRootBefore.dirMtimeMs)} → ${String(realRootAfter.dirMtimeMs)}；listingSha ${realRootBefore.listingSha256.slice(0, 16)}… → ${realRootAfter.listingSha256.slice(0, 16)}…`);
check('R-2 真实数据根关键文件 hash/mtime 前后一致（septcats.db / db-wal / logs/main.log）',
  JSON.stringify(realRootBefore.files) === JSON.stringify(realRootAfter.files),
  JSON.stringify(Object.fromEntries(Object.entries(realRootAfter.files).map(([k, v]) => [k, { mtimeMs: v.mtimeMs, sha: v.sha256.slice(0, 12) }]))));
check('R-3 真实 userData（%APPDATA%\\@septcats\\desktop）未被触碰（mtime + 指纹 + settings hash 一致）',
  realUDBefore.dirMtimeMs === realUDAfter.dirMtimeMs && realUDBefore.listingSha256 === realUDAfter.listingSha256 &&
    realUDBefore.files['septcats.settings.json'].sha256 === realUDAfter.files['septcats.settings.json'].sha256,
  `dirMtimeMs ${String(realUDBefore.dirMtimeMs)} → ${String(realUDAfter.dirMtimeMs)}；settingsSha ${realUDBefore.files['septcats.settings.json'].sha256.slice(0, 16)}… → ${realUDAfter.files['septcats.settings.json'].sha256.slice(0, 16)}…`);
check('R-4 应用确实写在**副本**上（副本 db/wal 指纹与初始副本不同，且副本 settings.rootPath 指向副本 data）',
  JSON.stringify(fixDataAfterCopy.files) !== JSON.stringify(fixDataAfter.files) &&
    JSON.parse(readFileSync(join(FIX_UD, 'septcats.settings.json'), 'utf8')).rootPath === FIX_DATA,
  `copyDb mtime ${fixDataAfterCopy.files['septcats.db'].mtimeMs} → ${fixDataAfter.files['septcats.db'].mtimeMs}；copyWal mtime ${fixDataAfterCopy.files['septcats.db-wal'].mtimeMs} → ${fixDataAfter.files['septcats.db-wal'].mtimeMs}；fixtureRootPath=${JSON.parse(readFileSync(join(FIX_UD, 'septcats.settings.json'), 'utf8')).rootPath}`);
check('R-5 副本 userData 也被使用（副本 ud 顶层指纹发生变化：settings 被探针改写）',
  fixUDAfter.files['septcats.settings.json'].sha256 !== realUDBefore.files['septcats.settings.json'].sha256,
  `fixtureUDSettingsSha=${fixUDAfter.files['septcats.settings.json'].sha256.slice(0, 16)}… realSha=${realUDBefore.files['septcats.settings.json'].sha256.slice(0, 16)}…`);

const outFingerprintAfter = {
  mainIndex: { mtimeMs: mtimeMs(OUT_MAIN), sha256: sha256(OUT_MAIN) },
  rendererAssets: (() => {
    try {
      const names = readdirSync(OUT_RENDERER_DIR).sort();
      return Object.fromEntries(names.map((n) => [n, sha256(join(OUT_RENDERER_DIR, n))]));
    } catch {
      return {};
    }
  })(),
};
check('R-6 产品构建产物（out/）未被改动（main/index.js 与 renderer assets hash 前后一致）',
  JSON.stringify(outFingerprintBefore) === JSON.stringify(outFingerprintAfter),
  `mainSha ${outFingerprintBefore.mainIndex.sha256.slice(0, 16)}… → ${outFingerprintAfter.mainIndex.sha256.slice(0, 16)}…`);

// ==========================================================================
// 阶段 7.5：把三份 net-log 原始证据归档进仓库（先过一遍密钥扫描，确保零真密钥）
// ==========================================================================
const netlogArchive = [];
const netlogSecretClean = Object.entries(netlogs).every(
  ([, v]) => (v.secretScan?.skShaped ?? 0) === 0 && (v.secretScan?.readableBearerTokensOtherThanSentinel ?? 0) === 0,
);
const archivePairs = [
  ['baseline', NET_BASE],
  ['scenarioA-local', NET_A],
  ['scenarioB-cloud-denied', NET_B],
];
for (const [tag, src] of archivePairs) {
  const dst = join(SHOTS, `t38-privacy-netlog-${tag}.json`);
  if (netlogSecretClean && existsSync(src)) {
    writeFileSync(dst, readFileSync(src));
    netlogArchive.push({ tag, archivedTo: dst, bytes: statSync(dst).size, sha256: sha256(dst) });
  } else {
    netlogArchive.push({ tag, archivedTo: null, reason: existsSync(src) ? 'blocked-by-secret-scan' : 'missing' });
  }
}
check('N-11 三份 net-log 原始证据已归档进 docs/mockups/screens-t38/（归档前通过密钥扫描：无 sk- 形状、无非哨兵可读 token）',
  netlogSecretClean && netlogArchive.every((n) => n.archivedTo !== null),
  JSON.stringify(netlogArchive));
info('N-12 归档 net-log 路径与 hash', JSON.stringify(netlogArchive));

// ==========================================================================
// 阶段 8：干净度 / 优雅退出
// ==========================================================================
check('E-1 全程 pageerror 计数 = 0', pageErrors.length === 0, `pageErrors=${String(pageErrors.length)} ${JSON.stringify(pageErrors.slice(0, 3))}`);
check('E-2 全程 renderer console error 计数 = 0', consoleErrors.length === 0, `consoleErrors=${String(consoleErrors.length)} ${JSON.stringify(consoleErrors.slice(0, 5))}`);
const exits = [runs.baseline.exit, runs.scenarioA.exit, runs.scenarioB.exit];
check('E-3 三次运行全部 window.close() 优雅退出（无强杀）',
  exits.every((e) => e !== undefined && e.gracefulExited === true && e.forcedKill === false),
  JSON.stringify(exits));
check('E-4 探针结束后本机无残留 electron.exe（进程树干净）',
  electronPids().length === 0, `electronPidsAfter=${JSON.stringify(electronPids())}`);

// ==========================================================================
// 结果落盘
// ==========================================================================
const passes = results.filter((r) => r.ok === true).length;
const fails = results.filter((r) => r.ok === false).length;
const payload = {
  task: 'TASK-T38-01 真机探针（网络层「隐私零外呼」硬不变量）',
  ranAt: new Date().toISOString(),
  method: {
    netlog: 'Electron/Chromium --log-net-log=<file>（captureMode=Default，不记录 cookie/认证等私有数据）；解析 REQUEST_ALIVE.url 得「主机名→请求次数」全表 + HOST_RESOLVER_MANAGER_REQUEST.host 得 DNS 层主机 + polledData.hostResolverInfo/proxySettings。',
    netstat: 'netstat -ano 按 electron.exe PID 过滤，取该进程树的 TCP 对端（辅助证据）。',
    hostResolverSafetyNet: `--host-resolver-rules=MAP ${CLOUD_HOST} 127.0.0.1（安全网：即便有缺陷也不会真的发往外网；net-log 仍记录真实 URL），映射不影响本断言口径。`,
    sentinel: '哨兵常量（**非真密钥**）作为 CredentialStore 里的 key 值写入夹具副本，用于验证请求头是否会被 net-log 落盘；只报计数。',
    privacyOfThisProbe: '本探针不打印/不落盘任何 Authorization、API key、token 的值；只输出主机名、计数、布尔。所有日志/账本扫描只报条数。',
  },
  findings: [
    'Chromium net-log 在 captureMode=Default 下：HTTP_TRANSACTION_SEND_REQUEST_HEADERS 的 authorization 头值被脱敏为「[N bytes were stripped]」（实测 1 处）；但同一个请求的 CORS_REQUEST.params.headers 字符串**未脱敏**，明文包含 authorization 头值（实测哨兵命中 1 处）。→ 结论：net-log 不是密钥安全通道；任何要求用户开 --log-net-log 的排障流程须提示先清除/轮换凭据。（与产品代码无关，属 Chromium 采集行为。）',
    '真实档案 %APPDATA%\\@septcats\\desktop\\septcats.settings.json 的 ai.providers 为 [] 且无 credentials 目录 → 本机没有已配置的云端端点，场景 B 的云端 baseUrl 采用任务书示例主机，密钥为占位哨兵（非真密钥）。',
    '本机（Node v22.23.2 / Windows）实测 fs.cpSync(dir, dir, {recursive:true}) 对**目录**静默不生效（单文件 cpSync 正常），故夹具复制改用 robocopy /E，并以「文件数/字节数/hash 逐项相等」核对完整性。',
    '真实档案里日志目录 C:\\Users\\Administrator\\.septcats\\logs 无 ai.log（本机从未有过 AI 请求日志）→ 场景 A 的 ai.log 是在副本 logs/ 里新生成的。',
  ],
  fixture: { dir: FIX, userDataDir: FIX_UD, rootPath: FIX_DATA, netlogDir: NETDIR, copiedFrom: { userData: REAL_UD, dataRoot: REAL_ROOT }, copyMs },
  preflight,
  productFacts: {
    realProfileHasNoAiProviders: true,
    note: `真实档案 %APPDATA%\\@septcats\\desktop\\septcats.settings.json 的 ai.providers = []（未配置任何 provider），故场景 B 的云端 baseUrl 采用任务书示例主机 ${CLOUD_BASEURL}（占位密钥，非真密钥）。`,
    cloudConsentSemantics: 'main/ai/service.ts gateForNetwork：ai.enabled → provider 存在 → assertAiUrlAllowed(baseUrl, cloudConsent)（非本地且无 consent 抛 E_AI_CLOUD_DENIED，**此处尚未发出任何网络请求**）→ 取 key → 发请求。',
  },
  runs,
  aiLogLines,
  netlogs,
  netlogArchive,
  secretScans: { netlog: netlogScans, logs: logScans.map((s) => ({ ...s, file: s.file.replace(FIX, '<fix>') })), credentials: credScans, authorizationCapture: authCaptures, allCounts: allSecretCounts },
  readonly: {
    realRootBefore,
    realRootAfter,
    realUDBefore,
    realUDAfter,
    fixDataAfterCopy,
    fixDataAfter,
    fixUDAfter,
    outFingerprintBefore,
    outFingerprintAfter,
  },
  assertions: results,
  screenshots: shots,
  pass: passes,
  fail: fails,
  errors: { pageErrors, consoleErrors },
};
writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2), 'utf8');
console.log(`\n${String(passes)}/${String(passes + fails)} PASS${fails === 0 ? '  ✓ 全部通过' : `  ✗ ${String(fails)} 项失败`}`);
console.log(`results → ${RESULTS_PATH}`);
console.log(`主证据 net-log → ${NETDIR}\\{baseline,scenarioA-local,scenarioB-cloud-denied}.json`);
process.exit(0);