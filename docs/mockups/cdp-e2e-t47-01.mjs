/* cdp-e2e-t47-01.mjs —— T47-01 三项严复测（口径更严，专治「测量缺口」）
 *
 * 范围：
 *   E2 设置里点 English → 优雅退出（window.close，禁强杀）→ 重启 → **不打开设置页**
 *      的前提下用四处文案（设置入口 / 侧栏 / 命令面板 / 页面 ⋯ 菜单）断言语言；
 *   E3 system 标记下重启的落点必须 == navigator.language（贴原文 + UI 实际 + pref，不许 unknown）；
 *   F5/F6 {Enter, Space} × {勾选格, 数字格} × {true→false, false→true} 8 格键盘矩阵（**DB 读回**）。
 *
 * 纪律：
 * - 只跑已打包的 apps/desktop/out/**（不重打包、不改产品源码、不碰 git）。
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t47-01/ 下，
 *   绝不读写 C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检。
 * - 优雅退出只用 window.close()；只有「未能优雅退出」时才记录强杀（并如实上报）。
 *
 * 运行：node docs/mockups/cdp-e2e-t47-01.mjs
 * 产物：docs/mockups/screens-t38/t47-01-results.json（原始数值）
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(SCRIPT_DIR, '..', '..');
const MAIN_REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = existsSync(join(REPO, 'apps', 'desktop', 'out', 'main'))
  ? join(REPO, 'apps', 'desktop')
  : join(MAIN_REPO, 'apps', 'desktop');
const NODE_MODULES_ROOT = existsSync(join(REPO, 'node_modules', 'playwright-core'))
  ? REPO
  : MAIN_REPO;
const requireFrom = createRequire(join(NODE_MODULES_ROOT, 'package.json'));
const { chromium } = requireFrom('playwright-core');
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t47-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9461;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t38');
const OUT_JSON = join(SHOTS, 't47-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let TAG = 'boot';
let STEP = 'boot';
/** 增量落盘：任何时刻被打断也留有证据（探针首轮被外部打断，零产物）。 */
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'T47-01 严复测（E2 / E3 / F5-F6 键盘矩阵）',
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
  console.log(`##PROGRESS## ${String(results.filter((r) => r.ok !== null).length)} checks`);
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

/** extraArgs：追加到 electron 命令行（如 --lang=en-US）。 */
async function launch(tag, extraArgs = []) {
  const stale = listeningPids(PORT);
  for (const pid of stale) killTree(pid);
  if (stale.length > 0) await wait(1500);
  const child = spawn(
    ELECTRON,
    ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`, ...extraArgs],
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
// 语言四处文案读取器（**不打开设置页**）
// ---------------------------------------------------------------------------

const EN_SIDE_TOKENS = ['Personal Workspace', 'New Page', 'Favorites', 'Recent', 'Trash'];
const ZH_SIDE_TOKENS = ['个人工作区', '新建页面', '收藏', '最近', '回收站'];
const EN_PALETTE = 'Command Palette';
const ZH_PALETTE = '命令面板';
const EN_MENU_TOKENS = ['Fixed width', 'Full width', 'Convert to Wiki', 'Delete'];
const ZH_MENU_TOKENS = ['固定宽度', '全宽', '转为 Wiki', '删除'];

const SIDE_TEXT = () =>
  (document.querySelector('.app-side')?.innerText ?? '').replace(/\s+/g, ' ').trim();
const ENTRY_LABELS = () =>
  [...document.querySelectorAll('button[aria-label]')]
    .map((el) => el.getAttribute('aria-label'))
    .filter((label) => label === 'Settings' || label === '设置');
const PALETTE_STATE = () => {
  const panel = document.querySelector('[data-testid="palette-panel"]');
  if (panel === null) return null;
  return {
    aria: panel.getAttribute('aria-label'),
    text: (panel.innerText ?? '').replace(/\s+/g, ' ').slice(0, 220),
  };
};
const MENU_LABELS = () => {
  const menus = [...document.querySelectorAll('.sc-menu')];
  const menu = menus[menus.length - 1];
  if (menu === undefined) return null;
  return [...menu.querySelectorAll('[role="menuitem"] .sc-menu__label')].map((el) => el.textContent);
};

/** 命中判定：四处各自判 en / zh / other，再折叠出整体落点（绝不产生 unknown 兜底而不报原因）。 */
function decodeLang(sample) {
  const side = String(sample.sideText ?? '');
  const sideEn = EN_SIDE_TOKENS.filter((token) => side.includes(token));
  const sideZh = ZH_SIDE_TOKENS.filter((token) => side.includes(token));
  const palette = String(sample.palette?.aria ?? '');
  const menu = Array.isArray(sample.menuLabels) ? sample.menuLabels.map((x) => String(x)) : [];
  const menuEn = menu.filter((label) => EN_MENU_TOKENS.some((token) => label.includes(token)));
  const menuZh = menu.filter((label) => ZH_MENU_TOKENS.some((token) => label.includes(token)));
  const entryEn = sample.entryLabels.includes('Settings');
  const entryZh = sample.entryLabels.includes('设置');

  const pick = (zhHit, enHit) =>
    zhHit && !enHit ? 'zh-CN' : enHit && !zhHit ? 'en-US' : zhHit && enHit ? 'both' : 'none';

  const places = {
    entry: { hit: pick(entryZh, entryEn), en: entryEn, zh: entryZh, raw: sample.entryLabels },
    sidebar: {
      hit: pick(sideZh.length > 0, sideEn.length > 0),
      en: sideEn,
      zh: sideZh,
      raw: side.slice(0, 120),
    },
    palette: {
      hit: palette === ZH_PALETTE ? 'zh-CN' : palette === EN_PALETTE ? 'en-US' : 'none',
      en: palette === EN_PALETTE,
      zh: palette === ZH_PALETTE,
      raw: palette,
    },
    pageMenu: {
      hit: pick(menuZh.length > 0, menuEn.length > 0),
      en: menuEn,
      zh: menuZh,
      raw: menu,
    },
  };
  const hits = Object.values(places).map((p) => p.hit);
  const actual = hits.every((h) => h === 'en-US')
    ? 'en-US'
    : hits.every((h) => h === 'zh-CN')
      ? 'zh-CN'
      : `unknown(${JSON.stringify(hits)})`;
  return { places, actual };
}

/** 四处文案采样（④ 页面 ⋯ 菜单需要至少一个侧栏行）。openPalette/openMenu 可关掉以隔离。 */
async function sampleLanguage(page, opts = {}) {
  const { withPalette = true, withMenu = true } = opts;
  const entryLabels = await page.evaluate(ENTRY_LABELS);
  const sideText = await page.evaluate(SIDE_TEXT);
  let palette = null;
  if (withPalette) {
    await page.keyboard.press('Control+k').catch(() => {});
    await wait(1000);
    palette = await page.evaluate(PALETTE_STATE);
    await page.keyboard.press('Escape').catch(() => {});
    await wait(500);
  }
  let menuLabels = null;
  if (withMenu) {
    const moreId = await page.evaluate(() => {
      const el = document.querySelector('[data-testid^="side-more-"]');
      return el === null ? null : el.getAttribute('data-testid');
    });
    if (moreId !== null) {
      await page.locator(`[data-testid="${moreId}"]`).first().hover().catch(() => {});
      await wait(400);
      await page.locator(`[data-testid="${moreId}"]`).first().click({ force: true }).catch(() => {});
      await wait(900);
      menuLabels = await page.evaluate(MENU_LABELS);
      await page.keyboard.press('Escape').catch(() => {});
      await wait(400);
    }
  }
  const navLang = await page.evaluate(() => navigator.language);
  const langs = await page.evaluate(() => navigator.languages);
  const pref = await page.evaluate(() => {
    try {
      return localStorage.getItem('septcats.localePref');
    } catch {
      return 'n/a';
    }
  });
  return { navLang, langs, pref, entryLabels, sideText, palette, menuLabels };
}

// ---------------------------------------------------------------------------
// DB 桥读回 / 夹具
// ---------------------------------------------------------------------------

async function dbSnapshot(page, pageId) {
  return page.evaluate(async (pid) => {
    const r = await window.septcats.db.load({ pageId: pid });
    return {
      title_pid: r.collection.schema.title_pid,
      order: Object.keys(r.collection.schema.properties),
      properties: Object.entries(r.collection.schema.properties).map(([id, p]) => ({
        id,
        name: p.name,
        type: p.type,
      })),
      records: r.records.map((rec) => ({ id: rec.id, values: rec.values })),
    };
  }, pageId);
}

const GRID_STATE = (kind) => {
  const dbc = document.querySelector(`.sc-dbc[data-type="${kind}"]`);
  const active = document.activeElement;
  return {
    kind,
    checkboxOn: document.querySelectorAll('.sc-dbc-check--on').length,
    dataEditing: dbc === null ? null : dbc.getAttribute('data-editing'),
    hasInput: document.querySelector(`.sc-dbc[data-type="${kind}"] input`) !== null,
    active: {
      tag: active?.tagName ?? null,
      cls: active?.getAttribute?.('class') ?? null,
      dataType:
        active === null || active === undefined
          ? null
          : (active.querySelector?.('.sc-dbc')?.getAttribute('data-type') ?? null),
    },
    rowCount: document.querySelectorAll('.sc-dbrow').length,
  };
};
const gridState = (page, kind) => page.evaluate(GRID_STATE, kind);

const CELL_LAYOUT = () => {
  const row = document.querySelector('.sc-dbrow');
  if (row === null) return null;
  return [...row.querySelectorAll('[role="gridcell"]')].map((cell, index) => {
    const dbc = cell.querySelector('.sc-dbc');
    const type =
      dbc !== null
        ? dbc.getAttribute('data-type')
        : cell.querySelector('.sc-dbcell__title') !== null
          ? 'title'
          : 'check';
    return { index, type };
  });
};

/**
 * 真实用户聚焦路径（无写入语义）：先聚焦标题格（单击标题格不写库）→ 方向键移到目标格。
 * 勾选格**不能**靠单击聚焦——单击本身就是切换语义。
 */
async function focusCellByArrows(page, kind) {
  const layout = await page.evaluate(CELL_LAYOUT);
  if (layout === null) return { ok: false, reason: 'no-row' };
  const titleIdx = layout.find((cell) => cell.type === 'title')?.index ?? null;
  const targetIdx = layout.find((cell) => cell.type === kind)?.index ?? null;
  if (titleIdx === null || targetIdx === null) {
    return { ok: false, reason: 'no-cell', layout };
  }
  await page.evaluate((index) => {
    const row = document.querySelector('.sc-dbrow');
    const cells = [...row.querySelectorAll('[role="gridcell"]')];
    cells[index]?.focus?.();
  }, titleIdx);
  await wait(300);
  const dir = targetIdx > titleIdx ? 'ArrowRight' : 'ArrowLeft';
  for (let step = 0; step < Math.abs(targetIdx - titleIdx); step += 1) {
    await page.keyboard.press(dir);
    await wait(180);
  }
  await wait(300);
  const state = await gridState(page, kind);
  return { ok: state.active.dataType === kind, layout, arrow: `${dir}x${String(Math.abs(targetIdx - titleIdx))}`, active: state.active };
}

async function valueOf(page, pageId, pid) {
  const snap = await dbSnapshot(page, pageId);
  const raw = snap.records[0]?.values?.[pid];
  return raw === undefined ? '(缺键)' : JSON.stringify(raw);
}

async function rawValue(page, pageId, pid) {
  const snap = await dbSnapshot(page, pageId);
  const raw = snap.records[0]?.values?.[pid];
  return raw === undefined ? undefined : raw;
}

/** 语言三选：**必须按 name=settings-locale 定位**——主题组同名单选（System）会抢首命中。 */
async function pickLanguage(page, value) {
  const input = page
    .locator(`input.sc-radio__input[name="settings-locale"][value="${value}"]`)
    .first();
  if ((await input.count()) === 0) return { clicked: false, reason: 'no-radio' };
  await input.check({ force: true }).catch(() => {});
  await wait(1600);
  const pref = await page.evaluate(() => {
    try {
      return localStorage.getItem('septcats.localePref');
    } catch {
      return 'n/a';
    }
  });
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll('input.sc-radio__input[name="settings-locale"]')]
      .filter((el) => el.checked)
      .map((el) => el.getAttribute('value')),
  );
  return { clicked: true, pref, checked };
}

/** 主题三选（name=settings-theme，与语言组区分）。 */
async function pickTheme(page, value) {
  const input = page.locator(`input.sc-radio__input[name="settings-theme"][value="${value}"]`).first();
  if ((await input.count()) === 0) return false;
  await input.check({ force: true }).catch(() => {});
  await wait(1200);
  return true;
}

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

/** 侧栏行点击（找不到行时如实返回 false，不静默吞）。 */
async function clickRow(page, id, settleMs = 1600) {
  const loc = page.locator(`[data-testid="side-node-${id}"]`).first();
  if ((await loc.count()) === 0) return { clicked: false, row: `side-node-${id}` };
  await loc.click({ force: true }).catch(() => {});
  await wait(settleMs);
  return { clicked: true, row: `side-node-${id}` };
}

/** 用桥写「按前值」后让 UI 重新挂载（切走再切回），保证表格看到的是落库后的值。 */
async function primeValue(page, pageId, pid, value, otherPageId) {
  await page.evaluate(
    async (args) => {
      const snap = await window.septcats.db.load({ pageId: args.pageId });
      await window.septcats.db.recordUpdate({
        pageId: args.pageId,
        recordId: snap.records[0].id,
        patch: { [args.pid]: args.value },
      });
    },
    { pageId, pid, value },
  );
  await wait(700);
  let away = { clicked: false };
  if (otherPageId !== null) away = await clickRow(page, otherPageId, 1200);
  const back = await clickRow(page, pageId, 1400);
  const ready = await waitFor(
    async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null),
    12000,
  );
  await wait(600);
  return { away, back, ready: ready === true };
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

const phases = {};
const quitInfo = [];
const matrix = [];
let boot = null;

try {
  // =========================================================================
  // BOOT 1：夹具建库 → F5/F6 键盘矩阵 → E1 点 English → 优雅退出
  // =========================================================================
  TAG = 'boot1';
  boot = await launch('boot1');
  const page = boot.page;
  const settingsFile0 = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale, rootPath: raw.rootPath };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('夹具 settings（启动时）', JSON.stringify(settingsFile0));

  // 夹具内容：一个普通页（供 ⋯ 菜单探测）+ 一个多维数据页（供键盘矩阵）
  STEP = 'fixture';
  const fixture = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const wsId = ws.activeId;
    const plain = await window.septcats.pages.create({ parentId: null });
    await window.septcats.pages.rename({ id: plain.id, title: 'T47复核普通页' });
    const db = await window.septcats.db.create({ workspaceId: wsId, title: 'T47复核数据页' });
    await window.septcats.db.propAdd({ pageId: db.pageId, type: 'checkbox' });
    await window.septcats.db.propAdd({ pageId: db.pageId, type: 'number' });
    const loaded = await window.septcats.db.load({ pageId: db.pageId });
    const props = Object.entries(loaded.collection.schema.properties).map(([id, p]) => ({
      id,
      type: p.type,
    }));
    const checkboxPid = props.find((p) => p.type === 'checkbox')?.id ?? null;
    const numberPid = props.find((p) => p.type === 'number')?.id ?? null;
    const titlePid = loaded.collection.schema.title_pid;
    const rec = await window.septcats.db.recordCreate({
      pageId: db.pageId,
      values: { [titlePid]: '记录1', [checkboxPid]: true, [numberPid]: 5 },
    });
    return { wsId, plainPageId: plain.id, dbPageId: db.pageId, titlePid, checkboxPid, numberPid, recordId: rec.record.id };
  });
  info('夹具对象（原始）', JSON.stringify(fixture));
  const { dbPageId, plainPageId, checkboxPid, numberPid } = fixture;

  // 桥建的对象不会自动进侧栏（UI 树是挂载时拉的）→ reload 一次让树重新拉取
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
  const rowsSeen = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="side-node-"]')].map((el) => el.getAttribute('data-testid')),
  );
  const dbRow = await clickRow(page, dbPageId, 1600);
  const gridReady = await waitFor(
    async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null),
    20000,
  );
  const fixtureDom = await page.evaluate(() => ({
    dbpage: document.querySelector('.dbpage') !== null,
    rows: document.querySelectorAll('.sc-dbrow').length,
    cellTypes: [...document.querySelectorAll('.sc-dbc')].map((el) => el.getAttribute('data-type')),
    headers: [...document.querySelectorAll('.sc-dbhead__cell')].map((el) => el.getAttribute('title')),
  }));
  info('夹具侧栏行（原始）', JSON.stringify(rowsSeen));
  info('夹具 DB 页载入状态（原始）', JSON.stringify({ dbRow, gridReady: gridReady === true, fixtureDom }));
  check(
    '夹具自检：多维数据页真机渲染出勾选列与数字列（矩阵前提成立）',
    gridReady === true &&
      fixtureDom.dbpage === true &&
      fixtureDom.cellTypes.includes('checkbox') &&
      fixtureDom.cellTypes.includes('number'),
    `dbRow=${JSON.stringify(dbRow)} gridReady=${String(gridReady)} dom=${JSON.stringify(fixtureDom)}`,
  );

  // -------------------------------------------------------------------------
  // F5/F6：{Enter, Space} × {勾选格, 数字格} × {true→false, false→true} 8 格矩阵
  // -------------------------------------------------------------------------
  TAG = 'F5-F6';
  const cells = [
    { kind: 'checkbox', key: 'Enter', before: true, expect: null, expectEdit: false },
    { kind: 'checkbox', key: 'Enter', before: false, expect: true, expectEdit: false },
    { kind: 'checkbox', key: 'Space', before: true, expect: null, expectEdit: false },
    { kind: 'checkbox', key: 'Space', before: false, expect: true, expectEdit: false },
    { kind: 'number', key: 'Enter', before: 5, expect: 5, expectEdit: true },
    { kind: 'number', key: 'Enter', before: null, expect: null, expectEdit: true },
    { kind: 'number', key: 'Space', before: 5, expect: 5, expectEdit: false },
    { kind: 'number', key: 'Space', before: null, expect: null, expectEdit: false },
  ];
  for (const cellDef of cells) {
    const pid = cellDef.kind === 'checkbox' ? checkboxPid : numberPid;
    STEP = `matrix|${cellDef.kind}|${cellDef.key}|${String(cellDef.before)}`;
    const prime = await primeValue(page, dbPageId, pid, cellDef.before, plainPageId);
    if (prime.ready !== true || prime.back.clicked !== true) {
      info('矩阵格前提未就绪（原始）', JSON.stringify(prime));
    }
    const beforeSnap = await dbSnapshot(page, dbPageId);
    const beforeDom = await gridState(page, cellDef.kind);
    const focus = await focusCellByArrows(page, cellDef.kind);
    const beforeValue = beforeSnap.records[0].values[pid];
    await page.keyboard.press(cellDef.key === 'Space' ? 'Space' : 'Enter').catch(() => {});
    await wait(1800);
    const afterSnap = await dbSnapshot(page, dbPageId);
    const afterDom = await gridState(page, cellDef.kind);
    const afterValue = afterSnap.records[0].values[pid];
    const norm = (v) => (v === undefined ? null : v);
    const valueOk = JSON.stringify(norm(afterValue)) === JSON.stringify(cellDef.expect);
    const editOk = afterDom.dataEditing === (cellDef.expectEdit ? 'true' : 'false');
    const focusOk = focus.ok === true;
    matrix.push({
      label: `${cellDef.kind} · ${cellDef.key} · ${String(cellDef.before)}→${String(cellDef.expect)}`,
      kind: cellDef.kind,
      key: cellDef.key,
      before: cellDef.before,
      expect: cellDef.expect,
      prime,
      focus,
      beforeValue: beforeValue === undefined ? '(缺键)' : beforeValue,
      afterValue: afterValue === undefined ? '(缺键)' : afterValue,
      beforeDom,
      afterDom,
      valueOk,
      editOk,
      focusOk,
    });
    info(
      `矩阵格 ${cellDef.kind}·${cellDef.key}·前=${String(cellDef.before)}`,
      `focus=${JSON.stringify(focus)} 按前=${JSON.stringify(beforeValue ?? null)} 按后=${JSON.stringify(afterValue ?? null)} dataEditing=${String(afterDom.dataEditing)} checkboxOn=${String(afterDom.checkboxOn)} rowCount=${String(afterDom.rowCount)} 期望=${JSON.stringify(cellDef.expect)} valueOk=${String(valueOk)} editOk=${String(editOk)}`,
    );
    await page.keyboard.press('Escape').catch(() => {});
    await wait(500);
  }

  const cbCells = matrix.filter((m) => m.kind === 'checkbox');
  const numCells = matrix.filter((m) => m.kind === 'number');
  check(
    'F5 勾选格键盘双向切换且落库（Enter/Space × true→false、false→true 四格全绿）',
    cbCells.every((m) => m.valueOk === true && m.editOk === true && m.focusOk === true),
    JSON.stringify(cbCells.map((m) => ({ label: m.label, before: m.beforeValue, after: m.afterValue, dataEditing: m.afterDom.dataEditing, focusOk: m.focusOk, ok: m.valueOk && m.editOk && m.focusOk }))),
  );
  check(
    'F6 数字格键盘不误切换（Enter/Space 均不得改动值）',
    numCells.every((m) => m.valueOk === true),
    JSON.stringify(numCells.map((m) => ({ label: m.label, before: m.beforeValue, after: m.afterValue, valueOk: m.valueOk }))),
  );
  const numEnterCells = numCells.filter((m) => m.key === 'Enter');
  info(
    'F6-附注 数字格 Enter 未进入编辑态（既有行为，登记为范围内缺陷候选）',
    JSON.stringify(numEnterCells.map((m) => ({ label: m.label, dataEditing: m.afterDom.dataEditing, hasInput: m.afterDom.hasInput, value: m.afterValue }))),
  );
  const numSpaceCells = numCells.filter((m) => m.key === 'Space');
  info(
    'F6-附注 数字格 Space 无动作（值恒不变）',
    JSON.stringify(numSpaceCells.map((m) => ({ label: m.label, dataEditing: m.afterDom.dataEditing, value: m.afterValue }))),
  );

  // 真实用户路径：单击勾选格聚焦后直接按 Enter（不得依赖探针手工 focus()）
  STEP = 'F5|单击后按键';
  await primeValue(page, dbPageId, checkboxPid, true, plainPageId);
  const clickBefore = await rawValue(page, dbPageId, checkboxPid);
  await page.locator('.sc-dbc[data-type="checkbox"]').first().click({ force: true }).catch(() => {});
  await wait(1800);
  const afterClickDom = await gridState(page, 'checkbox');
  const clickWritten = await rawValue(page, dbPageId, checkboxPid);
  await page.keyboard.press('Enter').catch(() => {});
  await wait(1800);
  const afterKeyValue = await rawValue(page, dbPageId, checkboxPid);
  phases.clickPath = { clickBefore, clickWritten, afterKeyValue, afterClickDom };
  check(
    'F5-真实路径 单击勾选格后按 Enter 仍能切换（焦点不因 reload 丢失）',
    clickWritten === null && afterKeyValue === true,
    `单击前=${JSON.stringify(clickBefore)} 单击后=${JSON.stringify(clickWritten)} 再按 Enter 后=${JSON.stringify(afterKeyValue)} 单击后 activeElement=${JSON.stringify(afterClickDom.active)}`,
  );

  // 双主题截图：勾选格聚焦态（修复点所在），浅/深各一张
  STEP = 'shots|双主题';
  const shotPath = (name) => `${SHOTS}\\t47-01-${name}.png`;
  const shots = [];
  for (const theme of ['light', 'dark']) {
    await openSettingsPage(page);
    const ok = await pickTheme(page, theme);
    await clickRow(page, dbPageId, 1500);
    await waitFor(async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null), 15000);
    await focusCellByArrows(page, 'checkbox');
    await wait(700);
    await page.screenshot({ path: shotPath(`${theme}-dbgrid-checkbox-focus`) }).catch(() => {});
    shots.push({ theme, ok });
  }
  info('双主题截图（原始）', JSON.stringify(shots));

  // -------------------------------------------------------------------------
  // E1/E2 前置：设置里点 English（不退出，先验即时生效）
  // -------------------------------------------------------------------------
  TAG = 'E2';
  STEP = 'boot1|点 English';
  const beforeLang = await sampleLanguage(page);
  phases.boot1LangBefore = beforeLang;
  info('点 English 前四处文案（原始）', JSON.stringify({ decode: decodeLang(beforeLang), entryLabels: beforeLang.entryLabels, palette: beforeLang.palette?.aria ?? null, menu: beforeLang.menuLabels, side: beforeLang.sideText.slice(0, 90), pref: beforeLang.pref }));
  const openSettingsOk = await openSettingsPage(page);
  const clickedEn = await pickLanguage(page, 'en-US');
  const settingsTitleAfterEn = await page.evaluate(() => document.querySelector('.settings-title')?.textContent ?? null);
  info('点 English 后设置页标题（原始）', JSON.stringify({ openSettingsOk, clickedEn, settingsTitleAfterEn }));
  check(
    'E1 设置里点 English 立刻生效（设置页标题转 Settings + 标记写 en-US）',
    clickedEn.clicked === true && clickedEn.pref === 'en-US' && settingsTitleAfterEn === 'Settings',
    `openSettings=${String(openSettingsOk)} click=${JSON.stringify(clickedEn)} title=${JSON.stringify(settingsTitleAfterEn)}`,
  );
  const settingsFileAfterEn = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('点 English 后夹具 settings.locale（原始）', JSON.stringify(settingsFileAfterEn));
  phases.boot1AfterEn = { settingsTitleAfterEn, settingsFileAfterEn };

  // 优雅退出（禁止强杀）
  boot.quit = await quit(page, boot.pid, boot.browser);
  quitInfo.push({ boot: 1, ...boot.quit });
  check('E2-退出 第一次重启前为优雅退出（window.close 生效，未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));

  // =========================================================================
  // BOOT 2：E2 四处文案（不打开设置页）→ 切 system → 优雅退出
  // =========================================================================
  TAG = 'E2';
  STEP = 'boot2|重启后四处文案';
  boot = await launch('boot2');
  const page2 = boot.page;
  const boot2 = await sampleLanguage(page2);
  const boot2Decode = decodeLang(boot2);
  phases.boot2 = boot2;
  const settingsFileBoot2 = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  info('E2 重启后（未开设置页）四处文案（原始）', JSON.stringify(boot2));
  info('E2 重启后四处判定（原始）', JSON.stringify(boot2Decode));
  info('E2 重启时夹具 settings.locale（原始）', JSON.stringify(settingsFileBoot2));
  check(
    'E2 显式 English 重启后四处文案全英文（设置入口/侧栏/命令面板/页面⋯菜单）',
    boot2Decode.actual === 'en-US' && boot2.pref === 'en-US',
    `四判定=${JSON.stringify(boot2Decode.places)} actual=${boot2Decode.actual} pref=${String(boot2.pref)} entry=${JSON.stringify(boot2.entryLabels)} palette=${JSON.stringify(boot2.palette?.aria ?? null)} menu=${JSON.stringify(boot2.menuLabels)} side=${boot2.sideText.slice(0, 100)}`,
  );
  // 补充（不参与判定）：打开设置页读**设置页标题**原文
  STEP = 'boot2|设置页标题（补充）';
  const boot2SettingsTitle = await (async () => {
    const btn = page2.getByRole('button', { name: /Settings|设置/ }).last();
    if ((await btn.count()) > 0) await btn.click({ force: true }).catch(() => {});
    await waitFor(async () => page2.evaluate(() => document.querySelector('[data-testid="settings-page"]') !== null), 10000);
    await wait(700);
    return page2.evaluate(() => document.querySelector('.settings-title')?.textContent ?? null);
  })();
  info('E2 重启后设置页标题（补充，原文）', JSON.stringify(boot2SettingsTitle));

  // 切「跟随系统」
  STEP = 'boot2|切 system';
  const clickedSystem = await pickLanguage(page2, 'system');
  const afterSystem = await page2.evaluate(() => ({
    pref: localStorage.getItem('septcats.localePref'),
    navLang: navigator.language,
  }));
  const settingsFileAfterSystem = (() => {
    try {
      const raw = JSON.parse(readFileSync(`${UD}\\septcats.settings.json`, 'utf8'));
      return { locale: raw.locale };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  })();
  phases.boot2System = { clickedSystem, afterSystem, settingsFileAfterSystem };
  info('切「跟随系统」后（原始）', JSON.stringify({ clickedSystem, afterSystem, settingsFileAfterSystem }));
  check(
    'E3-前置 切「跟随系统」写 system 标记（+ settings.locale 落最近解析值）',
    clickedSystem.clicked === true && afterSystem.pref === 'system',
    `click=${JSON.stringify(clickedSystem)} pref=${String(afterSystem.pref)} navLang=${String(afterSystem.navLang)} settings=${JSON.stringify(settingsFileAfterSystem)}`,
  );
  boot.quit = await quit(page2, boot.pid, boot.browser);
  quitInfo.push({ boot: 2, ...boot.quit });
  check('E3-退出 第二次重启前为优雅退出（window.close 生效，未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));

  // =========================================================================
  // BOOT 3：system 标记下的启动落点 == navigator.language
  // =========================================================================
  TAG = 'E3';
  STEP = 'boot3|系统语言落点';
  boot = await launch('boot3');
  const page3 = boot.page;
  const boot3 = await sampleLanguage(page3);
  const boot3Decode = decodeLang(boot3);
  const expected = String(boot3.navLang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  phases.boot3 = { sample: boot3, decode: boot3Decode, expected };
  info('E3 重启后（system 标记，未开设置页）四处文案（原始）', JSON.stringify(boot3));
  info('E3 三方关系（原始）', JSON.stringify({ navLang: boot3.navLang, langs: boot3.langs, pref: boot3.pref, uiActual: boot3Decode.actual, expected }));
  check(
    'E3 system 标记下重启落点 == navigator.language（三方一致，非 unknown）',
    boot3Decode.actual === expected && boot3.pref === 'system' && boot3Decode.actual !== 'unknown',
    `navLang=${String(boot3.navLang)} languages=${JSON.stringify(boot3.langs)} expected=${expected} uiActual=${boot3Decode.actual} pref=${String(boot3.pref)} 四判定=${JSON.stringify(boot3Decode.places)}`,
  );
  boot.quit = await quit(page3, boot.pid, boot.browser);
  quitInfo.push({ boot: 3, ...boot.quit });

  // =========================================================================
  // BOOT 4（对照）：system 标记 + --lang=en-US → 落点必须跟着 navigator.language 翻面
  // =========================================================================
  TAG = 'E3-对照';
  STEP = 'boot4|--lang 对照';
  boot = await launch('boot4', ['--lang=en-US']);
  const page4 = boot.page;
  const boot4 = await sampleLanguage(page4);
  const boot4Decode = decodeLang(boot4);
  const expected4 = String(boot4.navLang).toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
  phases.boot4 = { sample: boot4, decode: boot4Decode, expected: expected4 };
  info('E3 对照 --lang=en-US 后（原始）', JSON.stringify({ navLang: boot4.navLang, langs: boot4.langs, pref: boot4.pref, uiActual: boot4Decode.actual, expected: expected4 }));
  check(
    'E3-对照 --lang=en-US 下 system 落点仍 == navigator.language（跟随而非固定）',
    boot4Decode.actual === expected4 && boot4Decode.actual !== 'unknown',
    `navLang=${String(boot4.navLang)} expected=${expected4} uiActual=${boot4Decode.actual} 四判定=${JSON.stringify(boot4Decode.places)}`,
  );
  boot.quit = await quit(page4, boot.pid, boot.browser);
  quitInfo.push({ boot: 4, ...boot.quit });
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
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
    task: 'T47-01 严复测（E2 英文重启四处文案 / E3 navigator.language 落点 / F5-F6 键盘矩阵）',
    ranAt: new Date().toISOString(),
    appdir: APPDIR,
    appBundleMtime: bundleMtime,
    fixture: { userDataDir: UD, rootPath: ROOT, settingsFile: `${UD}\\septcats.settings.json` },
    isolation: {
      realRoot: REAL_ROOT,
      realRootMtimeBefore,
      realRootMtimeAfter,
      untouched: realRootMtimeBefore === realRootMtimeAfter,
    },
    pass: passes,
    fail: fails,
    matrix,
    quiet: quitInfo,
    phases,
    assertions: results,
    consoleErrors,
    pageErrors,
  };
  writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n========== 汇总：${String(passes)} PASS / ${String(fails)} FAIL ==========`);
  console.log(`console 错误 ${String(consoleErrors.length)} / pageerror ${String(pageErrors.length)}`);
}
