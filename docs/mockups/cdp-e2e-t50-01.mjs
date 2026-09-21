/* cdp-e2e-t50-01.mjs —— TASK-T50-01 真机取证（全局字体切换为自托管思源黑体）
 *
 * 范围：
 *   G0 夹具自检：独立夹具里新建一页并**用真实键入**写出 正文段 / h1 标题 / 代码块
 *      （键入走编辑器自身的输入规则 `# `→heading、```→code，是有内容的真页面，
 *       不是塞 DOM 假数据）；
 *   G1 字体真加载：document.fonts.check(...) 对 400/450/650 三个字重轴取值 + @font-face
 *      规则原文（证明 src 指向捆绑的 NotoSansSC-wght*.ttf、100 900 可变轴、swap、无 unicode-range）；
 *   G2 实际生效族名：getComputedStyle 取 body / 正文段 / h1 / 代码块 的 fontFamily 原文，
 *      并用 canvas measureText 做**独立度量对照**（捆绑族 vs 系统兜底族 vs serif 三串宽度必须互不相同
 *      → 证明「字真的换了」，而不是栈里写完就算数）；
 *   G3/G4 浅色 / 深色整页截图各 1 张（含正文/标题/代码块）。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build` = electron-vite build，非重打包）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t50-01/ 下，
 *   绝不读写 C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 优雅退出只用 window.close()；只有「未能优雅退出」时才记录强杀（并如实上报）。
 *
 * 运行：node docs/mockups/cdp-e2e-t50-01.mjs
 * 产物：docs/mockups/screens-t50/t50-01-results.json + t50-01-{light,dark}-typography.png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core')) ? REPO : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t50-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9467;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t50');
const DEBUG = `${RUN}\\debug`;
const OUT_JSON = join(SHOTS, 't50-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';
/** §0 已校验的捆绑字体指纹（防误替换）。 */
const FONT_BYTES = 17_772_300;
const FONT_SHA256_PREFIX = 'a3041811a78c361b';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let TAG = 'boot';
let STEP = 'boot';
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T50-01 真机取证（全局字体切换为自托管思源黑体）',
          partial: true,
          ranAt: new Date().toISOString(),
          appBundleMtime: (() => {
            try {
              return String(statSync(join(APPDIR, 'out', 'main', 'index.js')).mtime);
            } catch {
              return 'absent';
            }
          })(),
          consoleErrors,
          pageErrors,
          assertions: results,
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    /* 落盘失败不拦路 */
  }
};
const check = (name, ok, raw) => {
  results.push({ tag: TAG, step: STEP, name, ok: ok === true, raw: String(raw) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${TAG}|${STEP}] ${name}  — ${String(raw)}`);
  dump();
};
const info = (name, raw) => {
  results.push({ tag: TAG, step: STEP, name: `[info] ${name}`, ok: null, raw: String(raw) });
  console.log(`INFO  [${TAG}|${STEP}] ${name}  — ${String(raw)}`);
  dump();
};
process.on('unhandledRejection', (error) => {
  info('未处理的 Promise 拒绝（原始）', String(error?.stack ?? error));
});
process.on('uncaughtException', (error) => {
  info('未捕获异常（原始）', String(error?.stack ?? error));
});

const killTree = (pid) => {
  if (typeof pid !== 'number' || Number.isNaN(pid)) return;
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
const listeningPids = (port) => {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${String(port)}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
};

const consoleErrors = [];
const pageErrors = [];
const attach = (page, tag) => {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${tag}|${STEP}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`[${tag}|${STEP}] ${String(err?.message ?? err)}`);
  });
};

async function waitFor(fn, timeoutMs, stepMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    try {
      last = await fn();
    } catch {
      last = false;
    }
    if (last) return last;
    await wait(stepMs);
  }
  return last;
}

async function launch(tag) {
  const stale = listeningPids(PORT);
  for (const pid of stale) killTree(pid);
  if (stale.length > 0) await wait(1500);
  const child = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: APPDIR, detached: false, stdio: 'ignore' },
  );
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`);
      break;
    } catch {
      await wait(800);
    }
  }
  if (browser === null) throw new Error('CDP 连接失败');
  const ctx = browser.contexts()[0];
  ctx.setDefaultTimeout(8000);
  ctx.setDefaultNavigationTimeout(30000);
  let page = ctx.pages()[0];
  const t2 = Date.now() + 40000;
  while (Date.now() < t2) {
    const ps = ctx.pages().filter(
      (p) => String(p.url()).includes('index.html') || String(p.url()).startsWith('file:'),
    );
    if (ps.length > 0) {
      page = ps[0];
      break;
    }
    await wait(500);
  }
  attach(page, tag);
  await page.bringToFront().catch(() => {});
  await waitFor(
    async () =>
      page.evaluate(
        () =>
          document.querySelector('.app-side') !== null &&
          typeof window.septcats?.pages?.tree === 'function',
      ),
    45000,
  );
  await wait(1800);
  return { page, pid: child.pid, browser };
}

/** 优雅退出：只发 window.close()；未退出才强杀（如实记录）。 */
async function quit(page, pid, browser) {
  STEP = 'teardown';
  await page
    .evaluate(() => {
      try {
        window.close();
      } catch {
        /* ignore */
      }
    })
    .catch(() => {});
  await wait(2000);
  const stillAlive = alive(pid);
  if (stillAlive) killTree(pid);
  await browser.close().catch(() => {});
  await wait(1200);
  return { gracefulExited: !stillAlive };
}

// ---------------------------------------------------------------------------
// 页内探针（全部只读，不改应用状态）
// ---------------------------------------------------------------------------

const FONT_PROBE = {
  /** ① FontFaceSet 里到底有哪些面、什么状态 */
  faces: () => [...document.fonts].map((f) => ({
    family: f.family,
    weight: f.weight,
    style: f.style,
    status: f.status,
    display: f.display,
  })),
  /** ② 字重轴上取三个 DESIGN.md 真用到的档：450（ui-md）/ 650（h1）/ 400（正文） */
  checks: () => ({
    '400 16px "Noto Sans SC"': document.fonts.check('400 16px "Noto Sans SC"'),
    '450 14px "Noto Sans SC"': document.fonts.check('450 14px "Noto Sans SC"'),
    '650 28px "Noto Sans SC"': document.fonts.check('650 28px "Noto Sans SC"'),
    '400 16px "Source Han Sans SC"': document.fonts.check('400 16px "Source Han Sans SC"'),
    '400 14px "Geist Mono"': document.fonts.check('400 14px "Geist Mono"'),
    /** 对照组：本机绝不存在的族名。若它也是 true，说明 check() 在本 build 上不具区分力，不能当生效证据。 */
    '400 16px "__septcats_no_such_family__"': document.fonts.check(
      '400 16px "__septcats_no_such_family__"',
    ),
  }),
  /** ③ @font-face 规则原文（证明 src 指向捆绑 ttf / 可变轴 / swap / 无 unicode-range） */
  fontFaceRules: () => {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules = null;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules ?? []) {
        if (rule instanceof CSSFontFaceRule) out.push(rule.cssText);
      }
    }
    return out;
  },
  /** ④ computed 族名原文 + 元素身份 */
  computed: () => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        sel,
        fontFamily: cs.fontFamily,
        fontWeight: cs.fontWeight,
        fontSize: cs.fontSize,
        tag: el.tagName,
        cls: el.getAttribute('class'),
        text: (el.textContent ?? '').slice(0, 40),
      };
    };
    return {
      body: pick('body'),
      paragraph: pick('.ProseMirror p'),
      heading: pick('h1.sc-block--heading'),
      code: pick('.sc-block--code'),
    };
  },
  /** ⑤ 独立度量对照（canvas）：同串文字在若干族下的宽度 */
  metrics: () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const sample = '思源黑体字体验收 Septcats 0123456789';
    const width = (font) => {
      ctx.font = font;
      return Number(ctx.measureText(sample).width.toFixed(3));
    };
    return {
      sample,
      bundled: width('400 16px "Noto Sans SC"'),
      yahei: width('400 16px "Microsoft YaHei"'),
      serif: width('400 16px serif'),
      mono: width('400 16px "Geist Mono"'),
      nonexistent: width('400 16px "__septcats_no_such_family__"'),
    };
  },
  /**
   * ⑤b DOM 度量（权威口径）：真的把 span 挂进文档、量 offsetWidth。
   * 这是「实际渲染用的是哪个字」的直接证据——canvas 与 DOM 的族回退策略不完全一致，
   * 且 `document.fonts.check()` 在本 build 上对不存在的族也返回 true（见 checks 对照组），
   * 所以**生效判定以本组为准**。
   */
  domMetrics: () => {
    const sample = '思源黑体字体验收 Septcats 0123456789';
    const measure = (family, weight = '400', text = sample) => {
      const host = document.createElement('div');
      host.style.cssText =
        'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;letter-spacing:normal';
      const span = document.createElement('span');
      span.style.fontFamily = family;
      span.style.fontSize = '16px';
      span.style.fontWeight = weight;
      span.style.letterSpacing = 'normal';
      span.textContent = text;
      host.appendChild(span);
      document.body.appendChild(host);
      const width = Number(span.getBoundingClientRect().width.toFixed(3));
      host.remove();
      return width;
    };
    return {
      sample,
      bundled: measure('"Noto Sans SC"'),
      /** 对照组：不存在的族 → 纯兜底渲染。若与 bundled 相等，说明捆绑字根本没生效。 */
      nonexistent: measure('"__septcats_no_such_family__"'),
      yahei: measure('"Microsoft YaHei"'),
      sansSerif: measure('sans-serif'),
      serif: measure('serif'),
      bundledW650: measure('"Noto Sans SC"', '650'),
      nonexistentW650: measure('"__septcats_no_such_family__"', '650'),
      /** 拆分样本：中日韩字身（1em 宽的字体之间恒等）+ 西文（真正的区分位） */
      cjkBundled: measure('"Noto Sans SC"', '400', '思源黑体字体验收'),
      cjkNonexistent: measure('"__septcats_no_such_family__"', '400', '思源黑体字体验收'),
      latinBundled: measure('"Noto Sans SC"', '400', 'Septcats 0123456789'),
      latinNonexistent: measure('"__septcats_no_such_family__"', '400', 'Septcats 0123456789'),
      latinYahei: measure('"Microsoft YaHei"', '400', 'Septcats 0123456789'),
    };
  },
  /**
   * ⑤c 判定性实验：把我们声明的 FontFace 从 FontFaceSet 里**摘掉再量一次**。
   * - 若摘掉后宽度变了 → 说明「挂着的 @font-face（= 捆绑文件）真的在渲染」；
   * - 若摘掉后宽度不变 → 说明本机系统里也有同族名的同款字（registry 实证见报告 §环境），
   *   两条路渲染同形，此时「用哪份源」渲染上不可分辨，但族名/字形都是思源黑体，需求仍成立。
   * 实验后原样 add 回去，并复量证明已还原。
   */
  fontFaceToggle: () => {
    const sample = '思源黑体字体验收 Septcats 0123456789 Wm@#';
    const measure = () => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden';
      const span = document.createElement('span');
      span.style.fontFamily = '"Noto Sans SC"';
      span.style.fontSize = '16px';
      span.style.fontWeight = '400';
      span.style.letterSpacing = 'normal';
      span.textContent = sample;
      host.appendChild(span);
      document.body.appendChild(host);
      const width = Number(span.getBoundingClientRect().width.toFixed(3));
      host.remove();
      return width;
    };
    const face =
      [...document.fonts].find((f) => f.family.replace(/["']/g, '') === 'Noto Sans SC') ?? null;
    if (face === null) return { found: false };
    const withFace = measure();
    document.fonts.delete(face);
    const withoutFace = measure();
    document.fonts.add(face);
    const afterRestore = measure();
    return {
      found: true,
      sample,
      withFace,
      withoutFace,
      afterRestore,
      restoreOk: afterRestore === withFace,
      bundledFileIsTheOneRendering: withFace !== withoutFace,
    };
  },
  /** ⑥ 编辑器真内容（正文/标题/代码块三块都在） */
  content: () =>
    [...document.querySelectorAll('.ProseMirror > *')].map((el) => ({
      tag: el.tagName,
      cls: el.getAttribute('class'),
      text: (el.textContent ?? '').slice(0, 60),
    })),
  /**
   * ⑦ 源对照（判定性）：把三个面各自挂成独立族名再量同一串文字——
   *   app    = 应用生产栈里那个族名（"Noto Sans SC"，由本页 @font-face 定义）
   *   ours   = 直接指向构建产物 out/renderer/assets/NotoSansSC-wght-*.ttf（url 从 @font-face 原文取）
   *   system = local("Noto Sans SC")（本机 registry 里那份 NotoSansSC-VF.ttf）
   * app === ours 且 app ≠ system → 应用渲染的**就是捆绑文件**；
   * app === ours === system → 两份源同款同形（渲染不可分辨），如实登记。
   */
  fontSourceCompare: async () => {
    const rule = (() => {
      for (const sheet of document.styleSheets) {
        let rules = null;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of rules ?? []) {
          if (r instanceof CSSFontFaceRule && /Noto Sans SC/.test(r.style.getPropertyValue('font-family'))) {
            return { rule: r, href: sheet.href };
          }
        }
      }
      return null;
    })();
    if (rule === null) return { ok: false, reason: 'no-fontface-rule' };
    const src = rule.rule.style.getPropertyValue('src');
    const urlMatch = /url\((["']?)([^"')]+)\1\)/.exec(src);
    if (urlMatch === null) return { ok: false, reason: 'no-url-in-src', src };
    // css 里的 url 是**相对样式表**解析的（本目录 assets/），直接丢给 FontFace 会按文档基址解析而 404。
    const url = new URL(urlMatch[2], rule.href).href;

    const load = async (family, source) => {
      try {
        const face = new FontFace(family, source, { weight: '100 900' });
        await face.load();
        document.fonts.add(face);
        return 'loaded';
      } catch (error) {
        return `error:${String(error?.message ?? error).slice(0, 80)}`;
      }
    };
    const oursStatus = await load('T50ProbeBundled', `url("${url}")`);
    const systemStatus = await load('T50ProbeSystemLocal', 'local("Noto Sans SC")');

    const sample = '思源黑体字体验收 Septcats 0123456789 Wm@#';
    const measure = (family, weight = '400') => {
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden';
      const span = document.createElement('span');
      span.style.fontFamily = `"${family}"`;
      span.style.fontSize = '16px';
      span.style.fontWeight = weight;
      span.style.letterSpacing = 'normal';
      span.textContent = sample;
      host.appendChild(span);
      document.body.appendChild(host);
      const width = Number(span.getBoundingClientRect().width.toFixed(3));
      host.remove();
      return width;
    };
    return {
      ok: true,
      url,
      oursStatus,
      systemStatus,
      sample,
      app: measure('Noto Sans SC'),
      ours: oursStatus === 'loaded' ? measure('T50ProbeBundled') : null,
      system: systemStatus === 'loaded' ? measure('T50ProbeSystemLocal') : null,
      appW650: measure('Noto Sans SC', '650'),
      oursW650: oursStatus === 'loaded' ? measure('T50ProbeBundled', '650') : null,
    };
  },
  /**
   * ⑧ 自建浮层像素样本：一张由探针全权掌控的固定浮层，每行同一串文字换一个族。
   * 用浮层而不用改应用自己的 DOM——实测改应用元素的内联 font-family 会被上层重渲染抹掉
   * （见 G2-7 的 holdTest 原始值），拿它做像素证据会得到「全都一样」的假结论。
   */
  overlayShow: (families) => {
    const old = document.getElementById('t50-probe');
    if (old !== null) old.remove();
    const box = document.createElement('div');
    box.id = 't50-probe';
    box.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:2147483000',
      'background:#FFFFFF',
      'color:#101010',
      'padding:8px',
      'border:2px solid #101010',
      'font-size:28px',
      'line-height:1.4',
      'white-space:nowrap',
    ].join(';');
    for (const entry of families) {
      const line = document.createElement('div');
      line.setAttribute('data-t50-line', entry.id);
      line.style.fontFamily = entry.family;
      line.style.fontWeight = entry.weight ?? '400';
      line.textContent = entry.text;
      box.appendChild(line);
    }
    document.body.appendChild(box);
    return [...box.children].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-t50-line'),
        family: getComputedStyle(el).fontFamily,
        rect: {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.ceil(r.width),
          height: Math.ceil(r.height),
        },
      };
    });
  },
  overlayHide: () => {
    document.getElementById('t50-probe')?.remove();
  },
  /** ⑧b 内联样式保持性体检：改应用自己的 DOM 后立刻 / 500ms 后各回读一次。 */
  holdTestApply: (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    el.style.setProperty('font-family', 'serif', 'important');
    return {
      applied: true,
      immediate: getComputedStyle(el).fontFamily,
      styleAttr: el.getAttribute('style'),
    };
  },
  holdTestRead: (sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    return { later: getComputedStyle(el).fontFamily, styleAttr: el.getAttribute('style') };
  },
  holdTestRestore: (sel) => {
    const el = document.querySelector(sel);
    if (el !== null) el.style.removeProperty('font-family');
    return el === null ? null : getComputedStyle(el).fontFamily;
  },
};

async function openSettingsPage(page) {
  const btn = page.getByRole('button', { name: /设置|Settings/ }).last();
  if ((await btn.count()) > 0) await btn.click({ force: true }).catch(() => {});
  const ok = await waitFor(
    async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null),
    10000,
  );
  await wait(700);
  return ok === true;
}
async function pickTheme(page, value) {
  const input = page.locator(`input.sc-radio__input[name="settings-theme"][value="${value}"]`).first();
  if ((await input.count()) === 0) return false;
  await input.check({ force: true }).catch(() => {});
  await wait(1200);
  return true;
}
async function closeSettingsPage(page) {
  const btn = page.getByRole('button', { name: /设置|Settings/ }).last();
  if ((await btn.count()) > 0) await btn.click({ force: true }).catch(() => {});
  const gone = await waitFor(
    async () => page.evaluate(() => document.querySelector('[data-testid="settings-page"]') === null),
    10000,
  );
  await wait(900);
  return gone === true;
}

/**
 * 侧栏行点击。T49 已实证：处在设置页时点侧栏行**不会**离开设置页（既有缺陷候选），
 * 故本探针只在编辑器视图内用它切页；回编辑器一律走设置钮 toggle。
 */
async function clickRow(page, id, settleMs = 1400) {
  const testId = `side-node-${id}`;
  const loc = page.locator(`[data-testid="${testId}"]`).first();
  if ((await loc.count()) === 0) return { clicked: false, row: testId };
  await loc.click({ force: true }).catch(() => {});
  await wait(settleMs);
  const after = await page.evaluate(() => ({
    settingsPage: document.querySelector('[data-testid="settings-page"]') !== null,
    editor: document.querySelector('.sc-editor .ProseMirror') !== null,
  }));
  return { clicked: true, row: testId, after };
}

/** 把光标放进编辑器正文（点末尾空块的位置，避免误点已有文本）。 */
async function focusEditor(page) {
  const box = await page.evaluate(() => {
    const pm = document.querySelector('.sc-editor .ProseMirror');
    if (pm === null) return null;
    const r = pm.getBoundingClientRect();
    return { x: Math.round(r.x + 24), y: Math.round(r.y + 16), h: Math.round(r.height) };
  });
  if (box === null) return false;
  await page.mouse.click(box.x, box.y).catch(() => {});
  await wait(400);
  return (
    (await page.evaluate(
      () => document.activeElement?.closest?.('.ProseMirror') !== null &&
        document.activeElement !== document.body,
    )) === true
  );
}

// ===========================================================================
// 夹具（隔离）
// ===========================================================================
const realRootMtimeBefore = (() => {
  try {
    return String(statSync(REAL_ROOT).mtimeMs);
  } catch {
    return 'absent';
  }
})();

rmSync(RUN, { recursive: true, force: true });
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
      sync: { enabled: true, encrypt: false, gc: false },
    },
    null,
    2,
  ),
  'utf8',
);
console.log(`APPDIR=${APPDIR}\nUD=${UD}\nROOT=${ROOT}\n`);
const bundleMtime = (() => {
  try {
    return String(statSync(join(APPDIR, 'out', 'main', 'index.js')).mtime);
  } catch {
    return 'absent';
  }
})();
const bundledTtf = (() => {
  const hits = [];
  const dir = join(APPDIR, 'out', 'renderer', 'assets');
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.ttf')) {
        const full = join(dir, name);
        hits.push({ name, size: statSync(full).size });
      }
    }
  } catch {
    /* 产物缺失如实登记 */
  }
  return hits;
})();

const phases = {};
const quitInfo = [];
let boot = null;

try {
  TAG = 'G0';
  STEP = 'boot';
  boot = await launch('boot');
  const page = boot.page;

  // -------------------------------------------------------------------------
  // G0：夹具内容（真键入写正文/标题/代码块）
  // -------------------------------------------------------------------------
  STEP = 'fixture';
  const fixture = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const plain = await window.septcats.pages.create({ parentId: null });
    await window.septcats.pages.rename({ id: plain.id, title: 'T50 字体验收页' });
    return { wsId: ws.activeId, plainPageId: plain.id };
  });
  info('夹具对象（原始）', JSON.stringify(fixture));
  const { plainPageId } = fixture;

  STEP = 'fixture|reload';
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await waitFor(
    async () =>
      page.evaluate(
        () =>
          document.querySelector('.app-side') !== null &&
          typeof window.septcats?.pages?.tree === 'function',
      ),
    30000,
  );
  await wait(2200);
  const rowClick = await clickRow(page, plainPageId, 1600);
  const editorReady = await waitFor(
    async () => page.evaluate(() => document.querySelector('.sc-editor .ProseMirror') !== null),
    20000,
  );
  info('夹具页载入（原始）', JSON.stringify({ rowClick, editorReady: editorReady === true }));
  check('G0-0 夹具自检：普通页在真机渲染出编辑器（键入内容的前提成立）', editorReady === true, `rowClick=${JSON.stringify(rowClick)}`);

  // 真键入：走编辑器自己的输入规则（`# `→h1、```→code），产出的是真块
  STEP = 'fixture|typing';
  const focused = await focusEditor(page);
  const typed = [];
  const typeLine = async (text) => {
    await page.keyboard.type(text, { delay: 12 }).catch(() => {});
    await wait(260);
    typed.push(text);
  };
  await typeLine('字体验收：自托管思源黑体（Noto Sans SC 可变体）');
  await page.keyboard.press('Enter').catch(() => {});
  await wait(240);
  await typeLine('# 一级标题 思源黑体');
  await page.keyboard.press('Enter').catch(() => {});
  await wait(240);
  await typeLine('正文段落：中文正文、标点，。！？—— 数字 0123456789，西文 ABCdef。');
  await page.keyboard.press('Enter').catch(() => {});
  await wait(240);
  await typeLine('```');
  await wait(420);
  await typeLine("const 字族 = 'Noto Sans SC'; // mono 不受影响");
  await wait(900);
  const content = await page.evaluate(FONT_PROBE.content);
  phases.content = content;
  info('编辑器真内容（原始 DOM）', JSON.stringify(content));
  const hasHeading = content.some((b) => b.tag === 'H1');
  const hasPara = content.some((b) => b.tag === 'P' && b.text.includes('正文段落'));
  const hasCode = content.some((b) => String(b.cls ?? '').includes('sc-block--code'));
  check(
    'G0-1 夹具内容成立：正文段 / h1 标题 / 代码块三块都在（截图与断言的对象）',
    focused === true && hasHeading && hasPara && hasCode,
    `focused=${String(focused)} hasHeading=${String(hasHeading)} hasPara=${String(hasPara)} hasCode=${String(hasCode)} content=${JSON.stringify(content)}`,
  );

  // -------------------------------------------------------------------------
  // G1：字体真加载
  // -------------------------------------------------------------------------
  TAG = 'G1';
  STEP = 'G1|fonts';
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await wait(600);
  const faces = await page.evaluate(FONT_PROBE.faces);
  const checks = await page.evaluate(FONT_PROBE.checks);
  const fontFaceRules = await page.evaluate(FONT_PROBE.fontFaceRules);
  const resourceEntries = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((r) => /NotoSansSC-wght[\w-]*\.ttf/.test(r.name))
      .map((r) => ({
        name: r.name,
        encodedBodySize: r.encodedBodySize,
        decodedBodySize: r.decodedBodySize,
        transferSize: r.transferSize,
        duration: Number(r.duration.toFixed(1)),
      })),
  );
  phases.fonts = { faces, checks, fontFaceRules, resourceEntries, bundledTtf };
  info('document.fonts 面列表（原始）', JSON.stringify(faces));
  info('document.fonts.check 结果（原始）', JSON.stringify(checks));
  info('@font-face 规则原文', JSON.stringify(fontFaceRules));
  info('TTF 资源计时条目（原始）', JSON.stringify(resourceEntries));
  info('out/ 里的 ttf 产物（原始）', JSON.stringify(bundledTtf));

  const ourFace = faces.find((f) => f.family.replace(/["']/g, '') === 'Noto Sans SC') ?? null;
  check(
    'G1-1 FontFaceSet 含捆绑族 "Noto Sans SC" 且 status=loaded',
    ourFace !== null && ourFace.status === 'loaded' && ourFace.weight === '100 900',
    JSON.stringify(ourFace),
  );
  check(
    'G1-2 document.fonts.check 对 400 / 450 / 650 三档字重全 true（⚠ 该 API 在本 build 对不存在的族也返回 true，见 G2-4 对照组，此项仅作辅证不做生效依据）',
    checks['400 16px "Noto Sans SC"'] === true &&
      checks['450 14px "Noto Sans SC"'] === true &&
      checks['650 28px "Noto Sans SC"'] === true,
    JSON.stringify(checks),
  );
  const ruleText = fontFaceRules.join(' || ');
  check(
    'G1-3 @font-face 原文：src 指向 NotoSansSC-wght*.ttf（truetype-variations + truetype 兜底）、swap、无 unicode-range',
    fontFaceRules.length > 0 &&
      /NotoSansSC-wght[\w-]*\.ttf/.test(ruleText) &&
      ruleText.includes('truetype-variations') &&
      ruleText.includes('truetype') &&
      ruleText.includes('font-weight: 100 900') &&
      ruleText.includes('font-display: swap') &&
      !ruleText.includes('unicode-range'),
    JSON.stringify(fontFaceRules),
  );
  check(
    'G1-4 捆绑字体产物字节数与 §0 指纹一致（17 772 300 B）',
    bundledTtf.length === 1 && bundledTtf[0].size === FONT_BYTES,
    `bundledTtf=${JSON.stringify(bundledTtf)} expect=${String(FONT_BYTES)}`,
  );

  // -------------------------------------------------------------------------
  // G2：实际生效族名 + 独立度量对照
  // -------------------------------------------------------------------------
  TAG = 'G2';
  STEP = 'G2|computed';
  const metrics = await page.evaluate(FONT_PROBE.metrics);
  const domMetrics = await page.evaluate(FONT_PROBE.domMetrics);
  const computedLight = await page.evaluate(FONT_PROBE.computed);
  phases.computed = { light: computedLight, metrics, domMetrics };
  info('computed 族名原文（浅色）', JSON.stringify(computedLight));
  info('canvas 度量对照（原始）', JSON.stringify(metrics));
  info('DOM 度量对照（权威口径，原始）', JSON.stringify(domMetrics));

  const startsWithBundled = (value) =>
    typeof value === 'string' && /^"?Noto Sans SC"?/.test(value.trim());
  check(
    'G2-1 body / 正文段 / h1 的 computed fontFamily 均以 "Noto Sans SC" 打头（实际生效族 = 捆绑族）',
    startsWithBundled(computedLight.body?.fontFamily) &&
      startsWithBundled(computedLight.paragraph?.fontFamily) &&
      startsWithBundled(computedLight.heading?.fontFamily),
    JSON.stringify({
      body: computedLight.body?.fontFamily,
      paragraph: computedLight.paragraph?.fontFamily,
      heading: computedLight.heading?.fontFamily,
    }),
  );
  check(
    'G2-2 mono 未被动：代码块 computed fontFamily 仍以 "Geist Mono" 打头且不含 Noto Sans SC',
    typeof computedLight.code?.fontFamily === 'string' &&
      /^"?Geist Mono"?/.test(computedLight.code.fontFamily.trim()) &&
      !computedLight.code.fontFamily.includes('Noto Sans SC'),
    JSON.stringify(computedLight.code),
  );
  check(
    'G2-3 DOM 度量具区分力：捆绑族宽度 ≠「Microsoft YaHei」宽度（整串与西文子串两路都不同）→ 度量本身能分辨字体',
    domMetrics.bundled !== domMetrics.yahei && domMetrics.latinBundled !== domMetrics.latinYahei,
    JSON.stringify(domMetrics),
  );
  check(
    'G2-4 对照组披露：document.fonts.check() 对本机不存在的族同样返回 true → 该 API 在本 build 不具区分力，不作生效依据',
    checks['400 16px "__septcats_no_such_family__"'] === true,
    `check(nonexistent)=${String(checks['400 16px "__septcats_no_such_family__"'])} checks=${JSON.stringify(checks)}`,
  );
  const toggle = await page.evaluate(FONT_PROBE.fontFaceToggle);
  phases.fontFaceToggle = toggle;
  info('FontFace 摘除/还原实验（原始）', JSON.stringify(toggle));
  check(
    'G2-4b 判定性实验：摘掉本页 @font-face 后同串宽度变化 = 捆绑文件确实在渲染；不变 = 本机系统亦有同族同款字（两者都可接受，但必须如实定性）',
    toggle.found === true && toggle.restoreOk === true,
    JSON.stringify(toggle),
  );

  // ---- G2-5/G2-6/G2-7 生效证据（三层：源对照 → 浮层像素 → 内联保持性体检）
  STEP = 'G2|pixels';
  mkdirSync(DEBUG, { recursive: true });
  const clipOf = async (selector, extra) => {
    const clip = await page.evaluate(
      (args) => {
        const el = document.querySelector(args.sel);
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.floor(r.x),
          y: Math.floor(r.y),
          width: Math.max(1, Math.ceil(r.width)),
          height: Math.max(1, Math.ceil(r.height)),
        };
      },
      { sel: selector, extra },
    );
    if (clip === null) return { clip: null, buf: null };
    return { clip, buf: await page.screenshot({ clip }) };
  };

  // —— G2-5 源对照：应用族名 vs「直接指向构建产物」的族名 vs「系统 local()」的族名
  const sourceCompare = await page.evaluate(FONT_PROBE.fontSourceCompare);
  phases.sourceCompare = sourceCompare;
  info('源对照 app/ours/system（原始）', JSON.stringify(sourceCompare));
  check(
    'G2-5 源对照：应用族名的度量 = 直接指向 out/ 里 NotoSansSC-wght*.ttf 的族名度量（400 与 650 两档都等）→ 应用用的就是捆绑文件',
    sourceCompare.ok === true &&
      sourceCompare.oursStatus === 'loaded' &&
      sourceCompare.app === sourceCompare.ours &&
      sourceCompare.appW650 === sourceCompare.oursW650,
    JSON.stringify(sourceCompare),
  );
  info(
    '源对照之「本机系统同族字」定性',
    sourceCompare.ok === true
      ? `system(local "Noto Sans SC")=${String(sourceCompare.system)} status=${String(sourceCompare.systemStatus)}；` +
        `app=${String(sourceCompare.app)} ours=${String(sourceCompare.ours)} → ` +
        (sourceCompare.system === sourceCompare.app
          ? '系统那份与本文件同形（渲染不可分辨）'
          : '系统那份与本文件不同形 → 更坐实应用用的是捆绑文件')
      : JSON.stringify(sourceCompare),
  );

  // —— G2-6 浮层像素：探针全权掌控的浮层，同一串文字换族 → 同区域截图必须不同
  const overlayLines = await page.evaluate(FONT_PROBE.overlayShow, [
    { id: 'noto', family: '"Noto Sans SC"', text: '思源黑体 Septcats 0123456789 Wm@#' },
    { id: 'yahei', family: '"Microsoft YaHei"', text: '思源黑体 Septcats 0123456789 Wm@#' },
    { id: 'consolas', family: 'Consolas', text: '思源黑体 Septcats 0123456789 Wm@#' },
  ]);
  info('浮层样本（原始）', JSON.stringify(overlayLines));
  const overlayShots = [];
  for (const line of overlayLines) {
    const shot = await clipOf(`#t50-probe > [data-t50-line="${line.id}"]`);
    if (shot.buf !== null) writeFileSync(join(DEBUG, `overlay-${line.id}.png`), shot.buf);
    overlayShots.push({ id: line.id, family: line.family, clip: shot.clip, bytes: shot.buf === null ? -1 : shot.buf.length, buf: shot.buf });
  }
  const notoShot = overlayShots.find((s) => s.id === 'noto');
  const yaheiShot = overlayShots.find((s) => s.id === 'yahei');
  const consolasShot = overlayShots.find((s) => s.id === 'consolas');
  check(
    'G2-6 浮层像素：同一串文字在「Noto Sans SC」与「Microsoft YaHei」「Consolas」下同区域截图**互不相同**（族名真的换到了字形，不是只写在栈里）',
    notoShot.buf !== null &&
      yaheiShot.buf !== null &&
      consolasShot.buf !== null &&
      !notoShot.buf.equals(yaheiShot.buf) &&
      !notoShot.buf.equals(consolasShot.buf) &&
      !yaheiShot.buf.equals(consolasShot.buf),
    JSON.stringify(overlayShots.map((s) => ({ id: s.id, family: s.family, bytes: s.bytes }))),
  );
  await page.evaluate(FONT_PROBE.overlayHide);

  // —— G2-7 内联保持性体检：改应用自己的 DOM 是否会被抹掉（决定「能否用应用元素做像素对照」）
  const holdTarget = 'h1.sc-block--heading';
  const holdApply = await page.evaluate(FONT_PROBE.holdTestApply, holdTarget);
  await wait(500);
  const holdLater = await page.evaluate(FONT_PROBE.holdTestRead, holdTarget);
  const holdRestored = await page.evaluate(FONT_PROBE.holdTestRestore, holdTarget);
  const hold = { target: holdTarget, apply: holdApply, after500ms: holdLater, restored: holdRestored };
  phases.holdTest = hold;
  info('内联样式保持性体检（原始）', JSON.stringify(hold));
  check(
    'G2-7 体检结论：应用元素上的内联 font-family 会被上层重渲染抹掉（immediate≠later）→ 应用元素不能做像素对照；G2-6 的浮层样本承担该职责',
    holdApply?.immediate !== undefined &&
      holdApply.immediate !== holdLater?.later &&
      holdRestored !== null,
    JSON.stringify(hold),
  );


  // G3 / G4：双主题整页截图
  // -------------------------------------------------------------------------
  TAG = 'G3-G4';
  const shotPath = (name) => join(SHOTS, `t50-01-${name}.png`);
  const shots = [];
  for (const theme of ['light', 'dark']) {
    STEP = `shot|${theme}|theme`;
    let themed = false;
    let themeAttr = null;
    for (let attempt = 0; attempt < 3 && !themed; attempt += 1) {
      const settingsOpened = await openSettingsPage(page);
      const radioReady =
        (await waitFor(
          async () =>
            page.evaluate(
              (value) =>
                document.querySelector(`input.sc-radio__input[name="settings-theme"][value="${value}"]`) !== null,
              theme,
            ),
          8000,
        )) === true;
      if (!radioReady) {
        await wait(800);
        continue;
      }
      await pickTheme(page, theme);
      themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      themed = themeAttr === theme;
      if (!themed) await wait(800);
      if (settingsOpened !== true) await wait(300);
    }
    const settingsClosed = await closeSettingsPage(page);
    STEP = `shot|${theme}|page`;
    // 设置页关闭后重进本页（设置在编辑器视图内的侧栏切换是安全的）
    let ready = false;
    let reopened = null;
    for (let attempt = 0; attempt < 3 && !ready; attempt += 1) {
      reopened = await clickRow(page, plainPageId, 1500);
      ready =
        (await waitFor(
          async () =>
            page.evaluate(
              () =>
                document.querySelector('.sc-editor .ProseMirror') !== null &&
                document.querySelector('h1.sc-block--heading') !== null &&
                document.querySelector('.sc-block--code') !== null,
            ),
          15000,
        )) === true;
      if (!ready) await wait(1000);
    }
    await wait(900);
    const computed = await page.evaluate(FONT_PROBE.computed);
    const contentNow = await page.evaluate(FONT_PROBE.content);
    STEP = `shot|${theme}|capture`;
    const file = shotPath(`${theme}-typography`);
    await page.screenshot({ path: file }).catch(() => {});
    const size = (() => {
      try {
        return statSync(file).size;
      } catch {
        return -1;
      }
    })();
    shots.push({ theme, themed, themeAttr, settingsClosed, ready, reopened, computed, contentNow, file, size });
    info(`截图 ${theme}（原始）`, JSON.stringify(shots[shots.length - 1]));
    if (theme === 'light') phases.computed.light = computed;
    if (theme === 'dark') phases.computed.dark = computed;
  }
  phases.shots = shots;
  const light = shots.find((s) => s.theme === 'light');
  const dark = shots.find((s) => s.theme === 'dark');
  check(
    'G3 浅色整页截图已产出（data-theme=light + 正文/标题/代码块三块可见 + 文件非空）',
    light !== undefined &&
      light.themed === true &&
      light.contentNow.some((b) => b.tag === 'H1') &&
      light.contentNow.some((b) => b.tag === 'P') &&
      light.contentNow.some((b) => String(b.cls ?? '').includes('sc-block--code')) &&
      light.size > 0,
    JSON.stringify(light),
  );
  check(
    'G4 深色整页截图已产出（data-theme=dark + 正文/标题/代码块三块可见 + 文件非空）',
    dark !== undefined &&
      dark.themed === true &&
      dark.contentNow.some((b) => b.tag === 'H1') &&
      dark.contentNow.some((b) => b.tag === 'P') &&
      dark.contentNow.some((b) => String(b.cls ?? '').includes('sc-block--code')) &&
      dark.size > 0,
    JSON.stringify(dark),
  );
  check(
    'G4-1 深色下族名同样以 "Noto Sans SC" 打头（主题切换不换字）',
    dark !== undefined && startsWithBundled(dark.computed.paragraph?.fontFamily),
    JSON.stringify({ paragraph: dark?.computed?.paragraph?.fontFamily, heading: dark?.computed?.heading?.fontFamily }),
  );

  boot.quit = await quit(page, boot.pid, boot.browser);
  quitInfo.push({ boot: 1, ...boot.quit });
  check('退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
  for (const pid of listeningPids(PORT)) killTree(pid);

  const realRootMtimeAfter = (() => {
    try {
      return String(statSync(REAL_ROOT).mtimeMs);
    } catch {
      return 'absent';
    }
  })();
  const passes = results.filter((r) => r.ok === true).length;
  const fails = results.filter((r) => r.ok === false).length;
  const payload = {
    task: 'TASK-T50-01 真机取证（全局字体切换为自托管思源黑体）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    appBundleMtime: bundleMtime,
    fontFingerprint: { bytes: FONT_BYTES, sha256Prefix: FONT_SHA256_PREFIX, bundledTtf },
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: {
      realRoot: REAL_ROOT,
      realRootMtimeBefore,
      realRootMtimeAfter,
      untouched: realRootMtimeBefore === realRootMtimeAfter,
    },
    pass: passes,
    fail: fails,
    quiet: quitInfo,
    phases,
    assertions: results,
    consoleErrors,
    pageErrors,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n===== T50-01：${String(passes)} PASS / ${String(fails)} FAIL =====`);
  console.log(`consoleErrors=${String(consoleErrors.length)} pageErrors=${String(pageErrors.length)}`);
  console.log(`realRoot untouched=${String(payload.isolation.untouched)}`);
  console.log(`results -> ${OUT_JSON}`);
  process.exitCode = fails === 0 ? 0 : 1;
}
