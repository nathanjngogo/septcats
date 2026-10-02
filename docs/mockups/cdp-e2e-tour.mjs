/**
 * cdp-e2e-tour.mjs —— 首次启动导览（IDEA 清单第②项）真机验收。
 *
 * 证明链路（单测钉在 tour-state/tour-overlay/settings-react，这里测**装配后**整应用 + 跨重启持久化）：
 *   ① 无戳首启 → TourOverlay 自动弹出（第 1/5 步），且启动路径零落戳；
 *   ② 逐步「下一步」→ 进度计数器与标题随步切换、首步「上一步」disabled、末步主钮=「开始使用」；
 *   ③ 末步完成 → 浮层关闭 + localStorage septcats.tour.done='1'；
 *   ④ 重启 → 静默（不再自动弹）、戳仍在；
 *   ⑤ 设置页「重新观看导览」→ 浮层开回第 1 步、**不清**已完成的戳；
 *   ⑥ 重放中 Esc=跳过 → 落戳口径不变 → 再重启仍静默（跳过=永久闭卷）。
 *
 * 静态对账（跑批前已核，见值守日志）：
 *   testid 真源=TourOverlay.tsx（tour-overlay/tour/tour-progress/tour-title/tour-body/tour-skip/tour-back/tour-primary）、
 *   SettingsPage.tsx:1224（settings-tour-replay）；locale=zh-CN ⇒ tour.finish=「开始使用」、tour.progress=「第 {n} / {total} 步」。
 *
 * 红线：真实档案 %USERPROFILE%\.septcats 只读（mtime 双钉）；全部数据在 _scratch 副本；禁 publish。
 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireFrom = createRequire(join(REPO_ROOT, 'node_modules', 'playwright-core', 'package.json'));
const { chromium } = requireFrom('playwright-core');

const APPDIR = join(REPO_ROOT, 'apps', 'desktop');
const APP_BIN = process.env.SEPTCATS_APP_BIN ?? join(APPDIR, 'dist', 'win-unpacked', 'Septcats.exe');
const REAL_ROOT = join(process.env.USERPROFILE ?? 'C:/Users/Administrator', '.septcats');
const PORT = Number(process.env.SEPTCATS_CDP_PORT ?? 9461);
const RUN = 'E:\\Hermes Agent工作空间\\_scratch\\tour';
const UD = join(RUN, 'userdata');
const ROOT = join(RUN, 'root');
const SHOTS = join(RUN, 'shots');
const SETTINGS = join(UD, 'septcats.settings.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killStaleApp() { for (const n of ['Septcats.exe', 'electron.exe']) { try { execSync(`taskkill /F /IM ${n}`, { stdio: 'ignore' }); } catch { /* */ } } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }

/** mode='fresh'：整目录清空（全新档案=无戳）；mode='keep'：仅杀旧进程后原样重启（验跨重启持久化）。 */
async function boot(mode) {
  killStaleApp();
  await wait(1200);
  if (mode === 'fresh') {
    try { rmSync(RUN, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* 占用：复用 */ }
    mkdirSync(UD, { recursive: true }); mkdirSync(ROOT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
    writeFileSync(SETTINGS, JSON.stringify({
      schema: 1, rootPath: ROOT, theme: 'dark', locale: 'zh-CN',
      privacy: { telemetry: false, linkPreviewOnType: true },
      editor: { defaultEditMode: 'rich', spellcheck: true },
      data: { note: '' }, sync: { enabled: false, encrypt: false, gc: false },
    }, null, 2), 'utf8');
  }
  const child = spawn(APP_BIN, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`],
    { cwd: dirname(APP_BIN), stdio: 'ignore' });
  let browser = null;
  const dl = Date.now() + 60000;
  while (Date.now() < dl) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { await wait(800); } }
  if (browser === null) throw new Error('CDP 未就绪');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('file:')) ?? await ctx.waitForEvent('page');
  await page.waitForSelector('.sc-shell__body', { timeout: 30000 });
  await wait(2600);
  // 导览浮层开着时**不点** ws-create（遮罩会挡 actionability 超时）；导览断言不依赖工作区。
  // 静默启动（有戳）时若仍在工作区创建页，则点一次建区——阶段二/三的 Ctrl+K 需要常规壳层。
  if (await page.locator('[data-testid="tour-overlay"]').count() === 0
      && await page.locator('[data-testid="ws-create"]').count() > 0) {
    await page.locator('[data-testid="ws-create"]').first().click(); await wait(2600);
  }
  return { child, browser, page };
}

let CHILD = null;
let BROWSER = null;
const results = [];
function check(name, ok, raw) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${String(raw).slice(0, 200)}`);
}

const TOUR = () => {
  const txt = (sel) => {
    const el = document.querySelector(sel);
    return el === null ? null : (el.textContent ?? '').trim();
  };
  const back = document.querySelector('[data-testid="tour-back"]');
  return {
    overlay: document.querySelector('[data-testid="tour-overlay"]') !== null,
    progress: txt('[data-testid="tour-progress"]'),
    title: txt('[data-testid="tour-title"]'),
    body: txt('[data-testid="tour-body"]'),
    primary: txt('[data-testid="tour-primary"]'),
    backDisabled: back === null ? null : back.disabled === true,
    stamp: (() => { try { return localStorage.getItem('septcats.tour.done'); } catch { return 'ERR'; } })(),
  };
};

async function killSession() {
  try { await BROWSER.close(); } catch { /* */ }
  try { if (CHILD !== null) { execSync(`taskkill /PID ${String(CHILD.pid)} /T /F`, { stdio: 'ignore' }); } } catch { /* */ }
  killStaleApp();
}

async function main() {
  const before = rootMtime();
  const shot = async (page, n) => { try { await page.screenshot({ path: join(SHOTS, `${n}.png`) }); } catch { /* */ } };

  // ── 阶段一：全新档案首启 ──────────────────────────────────────────
  {
    const s = await boot('fresh'); CHILD = s.child; BROWSER = s.browser;
    const page = s.page;
    try {
      const t0 = await page.evaluate(TOUR);
      check('① 无戳首导览自动弹出', t0.overlay === true, `overlay=${String(t0.overlay)} progress=${String(t0.progress)}`);
      check('①-2 首启启动路径零落戳', t0.stamp === null, `stamp=${String(t0.stamp)}`);
      check('①-3 第 1 步=进度 1/5 + 标题非空', t0.progress === '第 1 / 5 步' && (t0.title ?? '') !== '', `${String(t0.progress)}｜${String(t0.title)}`);
      await shot(page, '01-open-step1');

      const titles = [t0.title];
      // 逐步「下一步」：第 2..5 步
      for (let i = 1; i <= 3; i += 1) {
        await page.click('[data-testid="tour-primary"]');
        await wait(450);
      }
      const t4 = await page.evaluate(TOUR);
      titles.push(t4.title);
      check('② 连点下一步到第 4 步（进度随步、标题随步）', t4.progress === '第 4 / 5 步' && t4.title !== t0.title, `${String(t4.progress)}｜${String(t4.title)}`);

      await page.click('[data-testid="tour-primary"]');
      await wait(450);
      const t5 = await page.evaluate(TOUR);
      check('②-2 末步=5/5 且主钮换「开始使用」（无第 6 页）', t5.progress === '第 5 / 5 步' && t5.primary === '开始使用', `${String(t5.progress)}｜primary=${String(t5.primary)}`);
      await shot(page, '02-last-step');

      // 回卷不误关：末步点「上一步」→ 4/5 且仍开、仍无戳（只有 finish/skip 落戳）
      await page.click('[data-testid="tour-back"]');
      await wait(400);
      const t4b = await page.evaluate(TOUR);
      check('②-3 末步「上一步」回卷到 4/5 且不落戳', t4b.progress === '第 4 / 5 步' && t4b.overlay === true && t4b.stamp === null, `${String(t4b.progress)} stamp=${String(t4b.stamp)}`);

      // 回到末步：首步 back disabled 另测（重开靠不了——本会话内 openTour 才有；用 DOM 回卷后前进）
      await page.click('[data-testid="tour-primary"]');
      await wait(400);
      await page.click('[data-testid="tour-primary"]');   // finish
      await wait(600);
      const done = await page.evaluate(TOUR);
      check('③ 末步「开始使用」→ 关闭 + 落戳 1', done.overlay === false && done.stamp === '1', `overlay=${String(done.overlay)} stamp=${String(done.stamp)}`);
      await shot(page, '03-after-finish');

      // ── 阶段二：原档案重启（跨重启持久化） ──
      await killSession(); CHILD = null; BROWSER = null;
      {
        const s2 = await boot('keep'); CHILD = s2.child; BROWSER = s2.browser;
        const p2 = s2.page;
        const r2 = await p2.evaluate(TOUR);
        check('④ 重启后导览静默（不再自动弹）', r2.overlay === false, `overlay=${String(r2.overlay)}`);
        check('④-2 戳跨重启仍在', r2.stamp === '1', `stamp=${String(r2.stamp)}`);
        await shot(p2, '04-relaunch-silent');

        // 设置页重放入口：Ctrl+K → 「设置」→ 回车 → 点 settings-tour-replay
        await p2.keyboard.press('Control+k');
        await wait(900);
        await p2.keyboard.type('设置');
        await wait(800);
        await p2.keyboard.press('Enter');
        await wait(1200);
        const hasReplay = await p2.locator('[data-testid="settings-tour-replay"]').count();
        check('⑤ 设置页「重新观看导览」入口在位', hasReplay > 0, `count=${String(hasReplay)}`);
        if (hasReplay > 0) {
          await p2.click('[data-testid="settings-tour-replay"]');
          await wait(600);
          const rp = await p2.evaluate(TOUR);
          check('⑤-2 点开重放→回第 1 步', rp.overlay === true && rp.progress === '第 1 / 5 步', `${String(rp.progress)}`);
          check('⑤-3 重放不清已完成的戳', rp.stamp === '1', `stamp=${String(rp.stamp)}`);
          check('⑤-4 首步「上一步」disabled', rp.backDisabled === true, `backDisabled=${String(rp.backDisabled)}`);
          await shot(p2, '05-replay-step1');

          // Esc = 跳过 → 关闭、仍静默口径
          await p2.keyboard.press('Escape');
          await wait(500);
          const sk = await p2.evaluate(TOUR);
          check('⑥ 重放中 Esc=跳过关闭且戳不动', sk.overlay === false && sk.stamp === '1', `overlay=${String(sk.overlay)} stamp=${String(sk.stamp)}`);
        } else {
          check('⑤-2 点开重放→回第 1 步', false, '重放入不可达（跳过后续）');
          check('⑤-3 重放不清已完成的戳', false, '同上');
          check('⑤-4 首步「上一步」disabled', false, '同上');
          check('⑥ 重放中 Esc=跳过关闭且戳不动', false, '同上');
        }
        await killSession(); CHILD = null; BROWSER = null;

        // ── 阶段三：跳过后再重启 ──
        const s3 = await boot('keep'); CHILD = s3.child; BROWSER = s3.browser;
        const r3 = await s3.page.evaluate(TOUR);
        check('⑥-2 跳过后再重启仍静默（闭卷永久）', r3.overlay === false && r3.stamp === '1', `overlay=${String(r3.overlay)} stamp=${String(r3.stamp)}`);
        await shot(s3.page, '06-after-skip-silent');
      }
    } finally {
      await killSession();
    }
  }

  const after = rootMtime();
  check('真实档案零触碰', before === after, `${String(before)} vs ${String(after)}`);

  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n===== 首次启动导览真机验收：${String(results.length - fails)} PASS / ${String(fails)} FAIL =====`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((err) => { console.log(`FATAL ${String(err && err.stack ? err.stack : err)}`); killStaleApp(); process.exitCode = 2; });
