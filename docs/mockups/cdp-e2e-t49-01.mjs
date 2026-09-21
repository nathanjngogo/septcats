/* cdp-e2e-t49-01.mjs —— TASK-T49-01 真机矩阵（数字格 Enter 进编辑 + 勾选格回归）
 *
 * 范围（在 T47-01 的 8 格矩阵思路上收口）：
 *   G1 数字格 Enter（按前 5 / null）→ **dataEditing=true** + 编辑输入框挂载 + DB 值不变
 *      （进编辑=进编辑，不是写入；T47 原观测为 dataEditing=false = 范围内缺陷）；
 *   G2 数字格 Space（按前 5 / null）→ dataEditing=false、值不变（**维持现状**，不得进编辑）；
 *   G3 数字格 Enter 进编辑 → 改值 → 再按 Enter → 走既有提交语义落库（**DB 读回**）+ 退出编辑；
 *   G4 勾选格回归红线：Enter/Space × {true→null, null→true} 四格 → 落库 + dataEditing=false（T47 四格必须仍全绿）；
 *   G5 深色截图一张（T47 尾巴：当时深色截图未成功）——数字格编辑态。
 *
 * 纪律：
 * - 只跑 freshly-built apps/desktop/out/**（`pnpm -C apps/desktop build` = electron-vite build，非重打包）；
 * - 数据隔离：--user-data-dir + rootPath 全在 _scratch/t49-01/ 下，
 *   绝不读写 C:\Users\Administrator\.septcats\（PM 真实数据根），并做 mtime 前后自检；
 * - 优雅退出只用 window.close()；只有「未能优雅退出」时才记录强杀（并如实上报）。
 *
 * 运行：node docs/mockups/cdp-e2e-t49-01.mjs
 * 产物：docs/mockups/screens-t49/t49-01-results.json + t49-01-{light,dark}-number-enter-edit.png
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
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
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\t49-01';
const UD = `${RUN}\\ud`;
const ROOT = `${RUN}\\data`;
const PORT = 9463;
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t49');
const OUT_JSON = join(SHOTS, 't49-01-results.json');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let TAG = 'boot';
let STEP = 'boot';
/** 增量落盘：任何时刻被打断也留有证据。 */
const dump = () => {
  try {
    writeFileSync(
      OUT_JSON,
      JSON.stringify(
        {
          task: 'TASK-T49-01 真机矩阵（数字格 Enter 进编辑 / 勾选格回归）',
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
// DB 桥读回 / 夹具 / 焦点
// ---------------------------------------------------------------------------

async function dbSnapshot(page, pageId) {
  return page.evaluate(async (pid) => {
    const r = await window.septcats.db.load({ pageId: pid });
    return {
      title_pid: r.collection.schema.title_pid,
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
  const input = document.querySelector(`.sc-dbc[data-type="${kind}"] input`);
  const active = document.activeElement;
  return {
    kind,
    dataEditing: dbc === null ? null : dbc.getAttribute('data-editing'),
    hasInput: input !== null,
    inputValue: input === null ? null : input.value,
    checkboxOn: document.querySelectorAll('.sc-dbc-check--on').length,
    theme: document.documentElement.getAttribute('data-theme'),
    rowCount: document.querySelectorAll('.sc-dbrow').length,
    active: {
      tag: active?.tagName ?? null,
      cls: active?.getAttribute?.('class') ?? null,
      dataType: active?.querySelector?.('.sc-dbc')?.getAttribute('data-type') ?? null,
    },
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
  return {
    ok: state.active.dataType === kind,
    arrow: `${dir}x${String(Math.abs(targetIdx - titleIdx))}`,
    active: state.active,
  };
}

async function rawValue(page, pageId, pid) {
  const snap = await dbSnapshot(page, pageId);
  const raw = snap.records[0]?.values?.[pid];
  return raw === undefined ? undefined : raw;
}

/**
 * 侧栏行点击（找不到行时如实返回 false，不静默吞）。
 * 先走 Playwright 真实坐标点击；若坐标点击未能离开设置页（命中被遮挡/侧栏位置异常），
 * 兜底走页内 `el.click()`（React 根监听仍会触发同一 onClick），并如实记录走的哪条路
 * 与命中判定原始值（`how` / `hit`）。
 */
async function clickRow(page, id, settleMs = 1600) {
  const testId = `side-node-${id}`;
  const loc = page.locator(`[data-testid="${testId}"]`).first();
  if ((await loc.count()) === 0) return { clicked: false, row: testId };
  const hit = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const inView = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight;
    const top = inView ? document.elementFromPoint(cx, cy) : null;
    return {
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      viewport: `${String(window.innerWidth)}x${String(window.innerHeight)}`,
      topTag: top === null ? null : top.tagName,
      topCls: top === null ? null : top.getAttribute('class'),
      topIsSelfOrInside: top === null ? false : el === top || el.contains(top),
    };
  }, testId);
  await loc.click({ force: true }).catch(() => {});
  await wait(settleMs);
  let after = await page.evaluate(() => ({
    settingsPage: document.querySelector('[data-testid="settings-page"]') !== null,
    dbpage: document.querySelector('.dbpage') !== null,
  }));
  let how = 'playwright';
  if (after.settingsPage) {
    // 兜底：坐标点击未能离开设置页（记录原始命中判定后）→ 页内 DOM click
    await page
      .evaluate((tid) => {
        document.querySelector(`[data-testid="${tid}"]`)?.click();
      }, testId)
      .catch(() => {});
    await wait(settleMs);
    after = await page.evaluate(() => ({
      settingsPage: document.querySelector('[data-testid="settings-page"]') !== null,
      dbpage: document.querySelector('.dbpage') !== null,
    }));
    how = 'playwright+js';
  }
  return { clicked: true, row: testId, how, hit, after };
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
  const away = otherPageId === null ? { clicked: false } : await clickRow(page, otherPageId, 1200);
  const back = await clickRow(page, pageId, 1400);
  const ready = await waitFor(
    async () => page.evaluate(() => document.querySelector('.sc-dbrow') !== null),
    12000,
  );
  await wait(600);
  return { away, back, ready: ready === true };
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

/** 主题三选（name=settings-theme，与语言组区分）。 */
async function pickTheme(page, value) {
  const input = page.locator(`input.sc-radio__input[name="settings-theme"][value="${value}"]`).first();
  if ((await input.count()) === 0) return false;
  await input.check({ force: true }).catch(() => {});
  await wait(1200);
  return true;
}

/**
 * 关掉设置页（顶栏设置钮是 toggle：`setView(settings ↔ editor)`）。
 * 注意：**侧栏行点击不会离开设置页**——App 的视图是组件本地 state，侧栏行只切
 * pagesStore.view（实测在设置页点侧栏行后 `settings-page` 仍在）。故只有 toggle 钮可回。
 */
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
  TAG = 'G1-G4';
  STEP = 'boot';
  boot = await launch('boot');
  const page = boot.page;

  // 夹具内容：一个普通页（供焦点回切）+ 一个多维数据页（供键盘矩阵）
  STEP = 'fixture';
  const fixture = await page.evaluate(async () => {
    const ws = await window.septcats.workspaces.list();
    const wsId = ws.activeId;
    const plain = await window.septcats.pages.create({ parentId: null });
    await window.septcats.pages.rename({ id: plain.id, title: 'T49复核普通页' });
    const db = await window.septcats.db.create({ workspaceId: wsId, title: 'T49复核数据页' });
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
    return {
      wsId,
      plainPageId: plain.id,
      dbPageId: db.pageId,
      titlePid,
      checkboxPid,
      numberPid,
      recordId: rec.record.id,
    };
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
  // G1/G2：数字格 {Enter, Space} × {5, null}
  // -------------------------------------------------------------------------
  TAG = 'G1-G2';
  const numCells = [
    { kind: 'number', key: 'Enter', before: 5, expectValue: 5, expectEdit: true },
    { kind: 'number', key: 'Enter', before: null, expectValue: null, expectEdit: true },
    { kind: 'number', key: 'Space', before: 5, expectValue: 5, expectEdit: false },
    { kind: 'number', key: 'Space', before: null, expectValue: null, expectEdit: false },
  ];
  for (const cellDef of numCells) {
    STEP = `G1G2|number|${cellDef.key}|${String(cellDef.before)}`;
    const prime = await primeValue(page, dbPageId, numberPid, cellDef.before, plainPageId);
    if (prime.ready !== true || prime.back.clicked !== true) {
      info('矩阵格前提未就绪（原始）', JSON.stringify(prime));
    }
    const beforeValue = await rawValue(page, dbPageId, numberPid);
    const beforeDom = await gridState(page, 'number');
    const focus = await focusCellByArrows(page, 'number');
    await page.keyboard.press(cellDef.key === 'Space' ? 'Space' : 'Enter').catch(() => {});
    await wait(1800);
    const afterDom = await gridState(page, 'number');
    const afterValue = await rawValue(page, dbPageId, numberPid);
    const norm = (v) => (v === undefined ? null : v);
    const valueOk = JSON.stringify(norm(afterValue)) === JSON.stringify(cellDef.expectValue);
    const editOk = afterDom.dataEditing === (cellDef.expectEdit ? 'true' : 'false');
    matrix.push({
      label: `number · ${cellDef.key} · ${String(cellDef.before)}→${String(cellDef.expectValue)}`,
      kind: 'number',
      key: cellDef.key,
      before: cellDef.before,
      expectValue: cellDef.expectValue,
      expectEdit: cellDef.expectEdit,
      prime,
      focus,
      beforeValue: beforeValue === undefined ? '(缺键)' : beforeValue,
      afterValue: afterValue === undefined ? '(缺键)' : afterValue,
      beforeDom,
      afterDom,
      valueOk,
      editOk,
      focusOk: focus.ok === true,
    });
    info(
      `数字格 ${cellDef.key}·前=${String(cellDef.before)}`,
      `focus=${JSON.stringify(focus)} 按前=${JSON.stringify(norm(beforeValue))} 按后=${JSON.stringify(norm(afterValue))} dataEditing按前=${String(beforeDom.dataEditing)} dataEditing按后=${String(afterDom.dataEditing)} hasInput=${String(afterDom.hasInput)} inputValue=${JSON.stringify(afterDom.inputValue)} 期望编辑=${String(cellDef.expectEdit)} valueOk=${String(valueOk)} editOk=${String(editOk)}`,
    );
    await page.keyboard.press('Escape').catch(() => {});
    await wait(500);
  }
  const numEnter = matrix.filter((m) => m.key === 'Enter');
  const numSpace = matrix.filter((m) => m.key === 'Space');
  check(
    'G1 数字格 Enter 进入编辑态（按后 dataEditing=true + 编辑输入框挂载 + DB 值不变）',
    numEnter.every((m) => m.editOk === true && m.valueOk === true && m.afterDom.hasInput === true && m.focusOk === true),
    JSON.stringify(
      numEnter.map((m) => ({
        label: m.label,
        dataEditing: `${String(m.beforeDom.dataEditing)}→${String(m.afterDom.dataEditing)}`,
        hasInput: m.afterDom.hasInput,
        inputValue: m.afterDom.inputValue,
        before: m.beforeValue,
        after: m.afterValue,
        focusOk: m.focusOk,
        ok: m.editOk && m.valueOk,
      })),
    ),
  );
  check(
    'G2 数字格 Space 维持现状（不进编辑、不改值）',
    numSpace.every((m) => m.editOk === true && m.valueOk === true && m.afterDom.hasInput === false),
    JSON.stringify(
      numSpace.map((m) => ({
        label: m.label,
        dataEditing: `${String(m.beforeDom.dataEditing)}→${String(m.afterDom.dataEditing)}`,
        hasInput: m.afterDom.hasInput,
        before: m.beforeValue,
        after: m.afterValue,
        ok: m.editOk && m.valueOk,
      })),
    ),
  );

  // -------------------------------------------------------------------------
  // G3：数字格 Enter 进编辑 → 改值 → 再按 Enter = 既有提交语义（DB 读回）
  // -------------------------------------------------------------------------
  TAG = 'G3';
  STEP = 'G3|number|Enter|5→7';
  const g3prime = await primeValue(page, dbPageId, numberPid, 5, plainPageId);
  const g3Before = await rawValue(page, dbPageId, numberPid);
  const g3Focus = await focusCellByArrows(page, 'number');
  const g3BeforeDom = await gridState(page, 'number');
  await page.keyboard.press('Enter').catch(() => {});
  await wait(1400);
  const g3EditDom = await gridState(page, 'number');
  await page.keyboard.press('Control+a').catch(() => {});
  await wait(200);
  await page.keyboard.type('7').catch(() => {});
  await wait(400);
  const g3TypedDom = await gridState(page, 'number');
  await page.keyboard.press('Enter').catch(() => {});
  await wait(2000);
  const g3AfterDom = await gridState(page, 'number');
  const g3After = await rawValue(page, dbPageId, numberPid);
  phases.g3 = { g3prime, g3Focus, g3BeforeDom, g3EditDom, g3TypedDom, g3AfterDom, g3Before, g3After };
  info(
    'G3 数字格 Enter→编辑→改值→Enter（原始）',
    JSON.stringify({
      prime: g3prime,
      focus: g3Focus,
      before: g3Before,
      dataEditing按前: g3BeforeDom.dataEditing,
      进编辑后dataEditing: g3EditDom.dataEditing,
      进编辑后input: g3EditDom.inputValue,
      键入后input: g3TypedDom.inputValue,
      提交后dataEditing: g3AfterDom.dataEditing,
      提交后DB: g3After,
    }),
  );
  check(
    'G3 数字格「Enter 进编辑 → 改值 → 再 Enter」走既有提交语义并落库（DB 读回 7）',
    g3BeforeDom.dataEditing === 'false' &&
      g3EditDom.dataEditing === 'true' &&
      g3AfterDom.dataEditing === 'false' &&
      g3After === 7,
    `按前=${JSON.stringify(g3Before)} 按前dataEditing=${String(g3BeforeDom.dataEditing)} 进编辑后dataEditing=${String(g3EditDom.dataEditing)} input=${JSON.stringify(g3EditDom.inputValue)}→${JSON.stringify(g3TypedDom.inputValue)} 提交后dataEditing=${String(g3AfterDom.dataEditing)} 提交后DB=${JSON.stringify(g3After)}`,
  );

  // -------------------------------------------------------------------------
  // G4：勾选格回归红线（T47 四格）{Enter, Space} × {true→null, null→true}
  // -------------------------------------------------------------------------
  TAG = 'G4';
  const cbCells = [
    { kind: 'checkbox', key: 'Enter', before: true, expect: null },
    { kind: 'checkbox', key: 'Enter', before: false, expect: true },
    { kind: 'checkbox', key: 'Space', before: true, expect: null },
    { kind: 'checkbox', key: 'Space', before: false, expect: true },
  ];
  const cbMatrix = [];
  for (const cellDef of cbCells) {
    STEP = `G4|checkbox|${cellDef.key}|${String(cellDef.before)}`;
    const prime = await primeValue(page, dbPageId, checkboxPid, cellDef.before, plainPageId);
    if (prime.ready !== true || prime.back.clicked !== true) {
      info('矩阵格前提未就绪（原始）', JSON.stringify(prime));
    }
    const beforeValue = await rawValue(page, dbPageId, checkboxPid);
    const beforeDom = await gridState(page, 'checkbox');
    const focus = await focusCellByArrows(page, 'checkbox');
    await page.keyboard.press(cellDef.key === 'Space' ? 'Space' : 'Enter').catch(() => {});
    await wait(1800);
    const afterDom = await gridState(page, 'checkbox');
    const afterValue = await rawValue(page, dbPageId, checkboxPid);
    const norm = (v) => (v === undefined ? null : v);
    const valueOk = JSON.stringify(norm(afterValue)) === JSON.stringify(cellDef.expect);
    const editOk = afterDom.dataEditing === 'false';
    const entry = {
      label: `checkbox · ${cellDef.key} · ${String(cellDef.before)}→${String(cellDef.expect)}`,
      kind: 'checkbox',
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
      focusOk: focus.ok === true,
    };
    cbMatrix.push(entry);
    matrix.push({ ...entry, expectEdit: false, expectValue: cellDef.expect });
    info(
      `勾选格 ${cellDef.key}·前=${String(cellDef.before)}`,
      `focus=${JSON.stringify(focus)} 按前=${JSON.stringify(norm(beforeValue))} 按后=${JSON.stringify(norm(afterValue))} dataEditing=${String(afterDom.dataEditing)} checkboxOn=${String(afterDom.checkboxOn)} 期望=${JSON.stringify(cellDef.expect)} valueOk=${String(valueOk)} editOk=${String(editOk)}`,
    );
    await page.keyboard.press('Escape').catch(() => {});
    await wait(500);
  }
  check(
    'G4 勾选格回归红线：Enter/Space × 双向切换落库 + dataEditing 恒 false（T47 四格全绿）',
    cbMatrix.every((m) => m.valueOk === true && m.editOk === true && m.focusOk === true),
    JSON.stringify(
      cbMatrix.map((m) => ({
        label: m.label,
        before: m.beforeValue,
        after: m.afterValue,
        dataEditing: m.afterDom.dataEditing,
        focusOk: m.focusOk,
        ok: m.valueOk && m.editOk && m.focusOk,
      })),
    ),
  );

  // 真实路径复核：单击勾选格 → 再按 Enter 仍能切换（T47 焦点记忆回归）
  TAG = 'G4';
  STEP = 'G4|单击后按键';
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
    'G4-真实路径 单击勾选格后按 Enter 仍能切换（焦点不因 reload 丢失，T47 焦点记忆未回归）',
    clickWritten === null && afterKeyValue === true,
    `单击前=${JSON.stringify(clickBefore)} 单击后=${JSON.stringify(clickWritten)} 再按 Enter 后=${JSON.stringify(afterKeyValue)} 单击后 activeElement=${JSON.stringify(afterClickDom.active)}`,
  );

  // -------------------------------------------------------------------------
  // G5：截图（深色一张为交付必填；浅色一张为对照）
  // -------------------------------------------------------------------------
  TAG = 'G5';
  STEP = 'G5|截图';
  const shotPath = (name) => join(SHOTS, `t49-01-${name}.png`);
  const shots = [];
  for (const theme of ['light', 'dark']) {
    // 主题切换走真实 UI 路径（设置页 radio）；radio 未就绪/未生效则重试，
    // 并以 documentElement[data-theme] 实测值判定（不信 pickTheme 的返回值）。
    let themed = false;
    let themeAttr = null;
    let settingsOpened = false;
    for (let attempt = 0; attempt < 3 && !themed; attempt += 1) {
      settingsOpened = await openSettingsPage(page);
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
    }

    // 回编辑器视图：设置钮 toggle（侧栏行点击**不能**离开设置页，见 closeSettingsPage 注释）
    const settingsClosed = await closeSettingsPage(page);
    // 回 DB 页：clickRow 后表格会先走骨架（loading）再出行，必须等**真有行**再聚焦；
    // 主题切换可能触发整树重挂 → 行会二次清空，故带重试。
    let rowsReady = false;
    let navProbe = [];
    for (let attempt = 0; attempt < 3 && !rowsReady; attempt += 1) {
      const clicked = await clickRow(page, dbPageId, 1500);
      const probe = await page.evaluate(() => ({
        appSide: document.querySelector('.app-side') !== null,
        sideNodes: document.querySelectorAll('[data-testid^="side-node-"]').length,
        dbpage: document.querySelector('.dbpage') !== null,
        settingsPage: document.querySelector('[data-testid="settings-page"]') !== null,
        tabbar: document.querySelectorAll('[role="tab"]').length,
        rows: document.querySelectorAll('.sc-dbrow').length,
        skeleton: document.querySelector('.sc-dbgrid__skeleton') !== null,
      }));
      navProbe.push({ attempt, clicked, probe });
      rowsReady =
        (await waitFor(
          async () => page.evaluate(() => document.querySelectorAll('.sc-dbrow').length > 0),
          15000,
        )) === true;
      if (!rowsReady) await wait(1000);
    }
    await wait(700);
    // 数字格聚焦 + Enter 进编辑（截图展示的正是本单修复点）
    const focus = await focusCellByArrows(page, 'number');
    await page.keyboard.press('Enter').catch(() => {});
    await wait(1200);
    const dom = await gridState(page, 'number');
    const file = shotPath(`${theme}-number-enter-edit`);
    await page.screenshot({ path: file }).catch(() => {});
    const size = (() => {
      try {
        return statSync(file).size;
      } catch {
        return -1;
      }
    })();
    shots.push({ theme, themed, themeAttr, settingsOpened, settingsClosed, rowsReady, navProbe, focus, dom, file, size });
    await page.keyboard.press('Escape').catch(() => {});
    await wait(400);
  }
  phases.shots = shots;
  info('截图（原始）', JSON.stringify(shots));
  const dark = shots.find((s) => s.theme === 'dark');
  check(
    'G5 深色截图已产出（data-theme=dark + 数字格编辑态 + 文件非空）',
    dark !== undefined &&
      dark.themed === true &&
      dark.dom.theme === 'dark' &&
      dark.dom.dataEditing === 'true' &&
      dark.size > 0,
    JSON.stringify(dark),
  );

  boot.quit = await quit(page, boot.pid, boot.browser);
  quitInfo.push({ boot: 1, ...boot.quit });
  check('退出干净：window.close() 优雅退出（未强杀）', boot.quit.gracefulExited === true, JSON.stringify(boot.quit));
} catch (error) {
  info('探针中断（原始异常）', String(error?.stack ?? error));
} finally {
  // 收尾：杀掉本轮可能残留的 electron（含监听调试端口的）
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
    task: 'TASK-T49-01 真机矩阵（数字格 Enter 进编辑 / 勾选格回归）',
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
