/* T80-01 真机探针：便携包导出（写侧 + IPC + 设置页入口）
 * 三段式：① 夹具双钉启动 → ② preview 零落盘 / confirm(dir) 落盘 / 重名不覆盖
 *        ③ 包内核：条目清单 · 排除清单 · 逐条 sha256 · 压缩档 · 原字节比对
 * 双钉纪律：--user-data-dir=<scratch ud> + UD/septcats.settings.json rootPath→scratch 独立目录。
 * ⚠ 只读夹具库；真实根仅取 mtime 前后比对，绝不触碰 C:/Users/Administrator/.septcats。
 * 断言守卫：条数 < 10 一律 FATAL（防 try/finally 吞错假绿）。 */
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const reqAgent = createRequire('C:/Users/Administrator/.workbuddy/binaries/node/workspace/package.json');
const { chromium } = reqAgent('playwright-core');
const reqRepo = createRequire('E:/Hermes Agent工作空间/Septcats/apps/desktop/package.json');
const { unzipSync } = reqRepo('fflate');

const REPO = 'E:/Hermes Agent工作空间/Septcats';
const APPDIR = join(REPO, 'apps', 'desktop');
const RUN = join(REPO, '..', '_scratch', 't80-e2e');
const UD = join(RUN, 'ud');
const ROOT = join(RUN, 'data');
const EXP = join(RUN, 'export-target');
const SHOTS = join(REPO, 'docs', 'mockups', 'screens-t80');
const PORT = 9241;
const ELECTRON = join(APPDIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const REAL_ROOT = 'C:\\Users\\Administrator\\.septcats';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { try { execSync(`taskkill /PID ${String(pid)} /T /F`, { stdio: 'ignore' }); } catch { /* gone */ } }
function rootMtime() { try { return statSync(REAL_ROOT).mtimeMs; } catch { return -1; } }
const assertions = [];
let STEP = '-';
function check(name, ok, raw) { assertions.push({ step: STEP, name, ok: Boolean(ok), detail: String(raw) }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }
function info(name, raw) { console.log(`INFO  [${STEP}] ${name}  — ${String(raw).slice(0, 220)}`); }
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// 夹具素材：附件两份（内容寻址命名）+ 一个合法命名的段 + 应被排除的四种文件
const ATT_A = randomBytes(2048);          // attachments/<hash>.bin
const ATT_B = randomBytes(1024);          // attachments/<hash>.png
const SEG = Buffer.from(`${JSON.stringify({ h: { seg_id: 'seg-00000001-01m2ftdzbjcdn2q0sqzqzp8k7s-000001', n: 1 } })}\n`, 'utf8');
const SEG_NAME = 'seg-00000001-01m2ftdzbjcdn2q0sqzqzp8k7s-000001-00af1e70.jsonl';
const ATT_A_NAME = `${sha(ATT_A)}.bin`;
const ATT_B_NAME = `${sha(ATT_B)}.png`;

function seedFixtures() {
  rmSync(RUN, { recursive: true, force: true });
  for (const d of [UD, ROOT, EXP, SHOTS]) mkdirSync(d, { recursive: true });
  // 双钉：Chromium UD 里的应用设置 rootPath 指向 scratch 独立数据根
  writeFileSync(join(UD, 'septcats.settings.json'), JSON.stringify({ schema: 1, rootPath: ROOT.replace(/\\/g, '/') }));
  // 数据根素材
  mkdirSync(join(ROOT, 'attachments'), { recursive: true });
  writeFileSync(join(ROOT, 'attachments', ATT_A_NAME), ATT_A);
  writeFileSync(join(ROOT, 'attachments', ATT_B_NAME), ATT_B);
  mkdirSync(join(ROOT, 'sync'), { recursive: true });
  writeFileSync(join(ROOT, 'sync', SEG_NAME), SEG);
  // 排除面：logs/ tmp/ crashDumps/ *.db.bak-* + 隐藏文件
  for (const [dir, file] of [['logs', 'x.log'], ['tmp', 'x.tmp'], ['crashDumps', 'x.dmp']]) {
    mkdirSync(join(ROOT, dir), { recursive: true });
    writeFileSync(join(ROOT, dir, file), 'SHOULD-NOT-BE-IN-ZIP');
  }
  writeFileSync(join(ROOT, 'septcats.db.bak-v5'), 'SHOULD-NOT-BE-IN-ZIP');
  writeFileSync(join(ROOT, 'attachments', '.hidden'), 'SHOULD-NOT-BE-IN-ZIP');
}

async function launch() {
  const child = spawn(ELECTRON, ['.', `--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { cwd: APPDIR, stdio: 'ignore' });
  let browser = null;
  for (let i = 0; i < 40; i += 1) {
    await wait(800);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); break; } catch { /* retry */ }
  }
  if (browser === null) throw new Error('CDP 连不上');
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  return { child, browser, page };
}

const listing = (dir) => (existsSyncSafe(dir) ? readdirSync(dir) : []);
function existsSyncSafe(p) { try { statSync(p); return true; } catch { return false; } }

async function main() {
  seedFixtures();
  const rootBefore = rootMtime();
  const { child, browser, page } = await launch();
  try {
    await wait(3000);

    // ---- P0 夹具：建一页（让主库有真内容），并核 app 起在 scratch 根 ----
    STEP = 'P0|夹具';
    const created = await page.evaluate(async () => {
      const api = window.septcats;
      const pg = await api.pages.create({ parentId: null, title: 'T80 便携包夹具页' });
      return { id: pg?.id ?? null, apiPortable: typeof api.portable?.preview, apiConfirm: typeof api.portable?.confirm };
    });
    check('P0-1 夹具页创建成功', typeof created.id === 'string' && created.id.length > 0, JSON.stringify(created));
    check('P0-2 portable API 就位（preview/confirm）', created.apiPortable === 'function' && created.apiConfirm === 'function', JSON.stringify(created));
    check('P0-3 主库落在 scratch 数据根', existsSyncSafe(join(ROOT, 'septcats.db')), join(ROOT, 'septcats.db'));

    // ---- P1 preview：清单正确 + 零落盘（真机路径可能被 IPC 守卫拒 → 记 FAIL 不中断）----
    STEP = 'P1|preview';
    const expBefore = listing(EXP).length;
    let preview = null;
    try {
      preview = await page.evaluate(() => window.septcats.portable.preview());
    } catch (e) {
      check('P1-0 preview 可调用（真机 IPC 路径）', false, String(e).split('\n')[0]);
    }
    if (preview !== null) {
      info('preview', JSON.stringify({ fileName: preview.fileName, counts: preview.counts, totalBytes: preview.totalBytes, warnings: preview.warnings }));
      check('P1-1 counts 正确（preview 只读不封段：db=1/附件=2/段=0/条目=3）',
        preview.counts.db === 1 && preview.counts.attachments === 2 && preview.counts.segments === 0 && preview.counts.entries === 3,
        JSON.stringify(preview.counts));
      check('P1-2 归档名含 portable + .zip', /portable/.test(preview.fileName) && preview.fileName.endsWith('.zip'), preview.fileName);
      check('P1-3 段为空时 warning 在场（PRD 非阻断提示）', preview.warnings.length === 1 && /段为空/.test(preview.warnings[0]), JSON.stringify(preview.warnings));
      check('P1-5 清单含两份附件且字节正确', preview.files.some((f) => f.relPath.endsWith(ATT_A_NAME) && f.bytes === ATT_A.length)
        && preview.files.some((f) => f.relPath.endsWith(ATT_B_NAME) && f.bytes === ATT_B.length), JSON.stringify(preview.files.map((f) => [f.kind, f.relPath, f.bytes])));
    }
    check('P1-4 preview 零落盘（目标目录文件数不变）', listing(EXP).length === expBefore, `${String(expBefore)} → ${String(listing(EXP).length)}`);

    // ---- P2 UI 入口链：设置页按钮 → 预览面板出现（真入口，非直接调 API）----
    STEP = 'P2|设置页入口';
    const ui = await page.evaluate(async () => {
      const errs = [];
      const orig = console.error;
      console.error = (...a) => { errs.push(a.map(String).join(' ').slice(0, 160)); orig(...a); };
      window.dispatchEvent(new Event('septcats:open-settings'));
      await new Promise((r) => setTimeout(r, 900));
      const btn = document.querySelector('[data-testid="settings-portable-export"]');
      if (btn) btn.click();
      await new Promise((r) => setTimeout(r, 1800));
      console.error = orig;
      const panel = document.querySelector('[data-testid="settings-portable-preview"]');
      const meta = document.querySelector('[data-testid="settings-portable-meta"]');
      const bodyText = document.body.innerText;
      return {
        found: Boolean(btn), panel: Boolean(panel), meta: (meta?.textContent ?? '').slice(0, 120),
        errs, malformed: /E_MALFORMED|E_PORTABLE|portable:export/.test(bodyText),
      };
    });
    check('P2-1 设置页存在便携包导出按钮', ui.found, JSON.stringify(ui));
    check('P2-2 点击后预览面板出现（条目+字节文案）', ui.panel && ui.meta.length > 0, JSON.stringify({ panel: ui.panel, meta: ui.meta, errs: ui.errs }));
    check('P2-3 点击后无 IPC 错误（console/界面零 E_MALFORMED）', ui.errs.length === 0 && ui.malformed === false, JSON.stringify({ errs: ui.errs, malformed: ui.malformed }));

    // ---- P3 confirm(dir) 落盘 + 重名不覆盖 ----
    STEP = 'P3|confirm';
    const conf = await page.evaluate(async (dir) => window.septcats.portable.confirm({ dir }), EXP.replace(/\\/g, '/'));
    info('confirm', JSON.stringify({ canceled: conf.canceled, path: conf.path, renamed: conf.renamed }));
    check('P3-1 confirm 未取消且返回绝对路径', conf.canceled === false && typeof conf.path === 'string' && conf.path.length > 0, JSON.stringify(conf.path));
    check('P3-2 zip 真实落盘且非空', existsSyncSafe(conf.path) && statSync(conf.path).size > 0, `${String(conf.path)} ${existsSyncSafe(conf.path) ? String(statSync(conf.path).size) : 'missing'}`);
    const conf2 = await page.evaluate(async (dir) => window.septcats.portable.confirm({ dir }), EXP.replace(/\\/g, '/'));
    check('P3-3 重名不覆盖（renamed=true 且两份并存）', conf2.canceled === false && conf2.renamed === true && conf2.path !== conf.path && listing(EXP).filter((n) => n.endsWith('.zip')).length === 2,
      JSON.stringify({ p1: conf.path, p2: conf2.path, files: listing(EXP) }));

    // ---- P4 包内核 ----
    STEP = 'P4|包内核';
    const raw = readFileSync(conf.path);
    const meta = [];
    unzipSync(new Uint8Array(raw), { filter: (f) => { meta.push({ name: f.name, compression: f.compression, size: f.size }); return false; } });
    const names = meta.map((m) => m.name);
    info('zip 条目', JSON.stringify(meta));
    check('P4-1 含 manifest-portable.json', names.includes('manifest-portable.json'), JSON.stringify(names));
    check('P4-2 含 septcats.db', names.includes('septcats.db'), JSON.stringify(names));
    check('P4-3 含段（sync/seg-*.jsonl ≥1）与两份附件（原命名）', names.some((n) => /^sync\/seg-[0-9a-f]+-.*\.jsonl$/.test(n)) && names.includes(`attachments/${ATT_A_NAME}`) && names.includes(`attachments/${ATT_B_NAME}`), JSON.stringify(names.filter((n) => n.startsWith('sync/') || n.startsWith('attachments/'))));
    check('P4-4 条目数 = 4 素材 + manifest 自身', names.length === 5, `${String(names.length)} vs 5`);
    const leaked = names.filter((n) => /(^logs\/|^tmp\/|^crashDumps\/|\.bak-|(^|\/)\.)/.test(n));
    check('P4-5 排除清单生效（logs/tmp/crashDumps/bak-/隐藏文件零泄漏）', leaked.length === 0, JSON.stringify(leaked));
    const files = unzipSync(new Uint8Array(raw));
    const gotA = Buffer.from(files[`attachments/${ATT_A_NAME}`]);
    check('P4-6 附件字节级一致（sha256 相等）', sha(gotA) === sha(ATT_A), `${sha(gotA).slice(0, 16)} vs ${sha(ATT_A).slice(0, 16)}`);
    const man = JSON.parse(Buffer.from(files['manifest-portable.json']).toString('utf8'));
    const entries = man.entries ?? [];
    const bad = entries.filter((e) => {
      const n = e.name ?? e.relPath; const bytes = files[n];
      return !bytes || sha(Buffer.from(bytes)) !== (e.sha256 ?? e.hash);
    });
    check('P4-7 manifest 逐条 sha256 可复算（自指排除）', entries.length >= 4 && bad.length === 0 && !entries.some((e) => (e.name ?? e.relPath) === 'manifest-portable.json'),
      `entries=${String(entries.length)} bad=${String(bad.length)} keys=${JSON.stringify(Object.keys(entries[0] ?? {}))}`);
    check('P4-8 压缩档分派：.png 附件 STORED(0)；.bin/db/段 DEFLATE(8)',
      meta.find((m) => m.name === `attachments/${ATT_B_NAME}`)?.compression === 0
      && meta.find((m) => m.name === `attachments/${ATT_A_NAME}`)?.compression === 8
      && meta.find((m) => m.name === 'septcats.db')?.compression === 8
      && meta.filter((m) => m.name.startsWith('sync/')).every((m) => m.compression === 8),
      JSON.stringify(meta.map((m) => [m.name, m.compression])));

    // ---- P9 存活 + 真实根 untouched ----
    STEP = 'P9|存活';
    const stillOk = await page.evaluate(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0);
    check('P9-1 应用存活（导出后未崩）', stillOk === true, String(stillOk));
  } finally {
    const pass = assertions.filter((x) => x.ok === true).length;
    const fail = assertions.filter((x) => x.ok === false).length;
    writeFileSync(join(SHOTS, 't80-results.json'), JSON.stringify({ task: 'T80-01', ranAt: new Date().toISOString(), assertions }, null, 2));
    console.log(`\n===== T80-01：${pass} PASS / ${fail} FAIL =====`);
    info('真实数据根未被触碰', `untouched=${String(rootBefore === rootMtime())}`);
    try { await page?.evaluate(() => window.close()); } catch { /* */ }
    await wait(1800);
    try { browser?.close(); } catch { /* */ }
    killTree(child?.pid);
    const guard = assertions.length >= 10;
    if (!guard) console.log(`FATAL 断言条数 ${String(assertions.length)} < 10（静默蒸发守卫）`);
    process.exitCode = fail === 0 && guard ? 0 : 1;
  }
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 3; });