/* T19-05 协作双实例真机冒烟（PM）：
 * 夹具 = M8b twin（两独立数据根 + junction 共享 sync），但**错峰启动**：
 * A 先开并编辑同步完成后 B 才启动——绕开 DEVIATION-5「双空同开重复种子」窗口，
 * 同时观察 B attach 时是否仍自种子（若 B 文本重复 = 缺陷 T19-05-1 实证，开修复单）。
 * demo 页两端同一 pageId（'pg00000000000000000000demo'）——协作直接验在它上面。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const EXE_PATH = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const SHARED = 'E:\\Hermes Agent工作空间\\_scratch\\collab-shared-sync';
const WINS = [
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\collab-root-a', ud: 'E:\\Hermes Agent工作空间\\_scratch\\collab-ud-a', port: 9341 },
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\collab-root-b', ud: 'E:\\Hermes Agent工作空间\\_scratch\\collab-ud-b', port: 9342 },
];
const SHOTS = 'E:/Hermes Agent工作空间/Septcats/docs/mockups/screens-collab';

function killAll() {
  try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* 无进程 */ }
}

function fresh() {
  killAll();
  for (const w of WINS) {
    rmSync(w.root, { recursive: true, force: true });
    rmSync(w.ud, { recursive: true, force: true });
  }
  rmSync(SHARED, { recursive: true, force: true });
  mkdirSync(SHARED, { recursive: true });
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  for (const w of WINS) {
    mkdirSync(w.root, { recursive: true });
    mkdirSync(w.ud, { recursive: true });
    execSync(`cmd /c mklink /J "${w.root}\\sync" "${SHARED}"`, { stdio: 'ignore' });
    writeFileSync(`${w.ud}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: w.root, theme: 'system' }), 'utf8');
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 200) : ''}`);
}
function start(w) {
  const p = spawn(EXE_PATH, [`--user-data-dir=${w.ud}`, `--remote-debugging-port=${String(w.port)}`], { detached: true, stdio: 'ignore' });
  p.unref();
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
    if (await page.evaluate(() => typeof window.septcats?.collab?.attach === 'function').catch(() => false)) return page;
    await new Promise((r) => setTimeout(r, 800));
  }
  return page;
}
async function waitFor(fn, timeoutMs, stepMs = 400) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return last;
}
const docText = (page) => page.evaluate(() => document.querySelector('.pv-body .ProseMirror')?.innerText ?? '');
async function typeIntoFirstParagraph(page, text) {
  // 真实鼠标点进第一段末尾 + keyboard.type（规则 3：不用合成事件）
  const p = page.locator('.pv-body .ProseMirror p').first();
  await p.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text, { delay: 15 });
  await new Promise((r) => setTimeout(r, 800)); // EditSession 300ms + YjsEditor 100ms 防抖落定
}
const syncNow = (page) => page.evaluate(async () => { await window.septcats.sync.setEnabled({ on: true }); await window.septcats.sync.now().catch(() => {}); return true; });

fresh();

// ── 阶段 1：A 先开，编辑并同步 ─────────────────────────────────────────
start(WINS[0]);
const brA = await connect(WINS[0].port);
if (!brA) { console.log('== 前置即崩（A CDP 不可达）=='); process.exit(1); }
const pa = await bridgeReady(brA);
check('A 实例启动（CDP 可达 + collab 桥就绪）', await pa.evaluate(() => typeof window.septcats?.collab?.attach === 'function').catch(() => false));
const errsA = [];
pa.on('pageerror', (e) => errsA.push(String(e)));

await syncNow(pa);
const seedOk = await waitFor(async () => (await docText(pa)).length > 0, 15000);
check('A 编辑器就绪（demo 页文本非空）', !!seedOk, String(seedOk).slice(0, 60));

await typeIntoFirstParagraph(pa, '甲段AAA');
await syncNow(pa);
const segsA = await waitFor(() => existsSync(SHARED) && readdirSync(SHARED).some((f) => f.startsWith('seg-') || f.startsWith('manifest')), 20000, 1000);
check('A 上行：crdt_update 已发布到共享 sync 目录', !!segsA, segsA ? readdirSync(SHARED).slice(0, 5).join(',') : 'no-files');

// ── 阶段 2：B 后开，播种还原 + 观察重复种子（DEVIATION-5 / T19-05-1）──
start(WINS[1]);
const brB = await connect(WINS[1].port);
check('B 实例启动', !!brB);
if (!brB) { console.log('== B 前置崩 =='); brA.close(); process.exit(1); }
const pb = await bridgeReady(brB);
const errsB = [];
pb.on('pageerror', (e) => errsB.push(String(e)));
await syncNow(pb);
const gotA = await waitFor(async () => (await docText(pb)).includes('甲段AAA'), 60000, 2000);
check('B 追平：A 的「甲段AAA」出现在 B 正文（下行路由+Y→PM 投影）', !!gotA, String(await docText(pb)).slice(0, 80));
const dupCount = await pb.evaluate(() => (document.querySelector('.pv-body .ProseMirror')?.innerText ?? '').split('甲段AAA').length - 1);
check('无重复种子（「甲段AAA」恰出现 1 次；>1 = T19-05-1 实证）', dupCount === 1, `count=${dupCount}`);
await pb.screenshot({ path: SHOTS + '/b-after-A-sync.png' });

// ── 阶段 3：双向（B → A） ──────────────────────────────────────────────
await typeIntoFirstParagraph(pb, '乙段BBB');
await syncNow(pb);
const gotB = await waitFor(async () => { await syncNow(pa); return (await docText(pa)).includes('乙段BBB'); }, 60000, 2000);
check('A 追平：B 的「乙段BBB」出现在 A 正文（双向同步）', !!gotB, String(await docText(pa)).slice(0, 80));

// ── 阶段 4：并发输入收敛（同段各打各的，互不同步地打完后一起追平） ────
const pA = pa.locator('.pv-body .ProseMirror p').first();
await pA.click(); await pa.keyboard.press('End'); await pa.keyboard.type('并发CCC', { delay: 15 }); // A 打字，B 不同步
const pB = pb.locator('.pv-body .ProseMirror p').first();
await pB.click(); await pb.keyboard.press('End'); await pb.keyboard.type('并发DDD', { delay: 15 }); // B 同时打字
await new Promise((r) => setTimeout(r, 800));
await syncNow(pa); await syncNow(pb);
const converge = await waitFor(async () => {
  await syncNow(pb); await syncNow(pa);
  const [ta, tb] = [await docText(pa), await docText(pb)];
  return ta === tb && ta.includes('并发CCC') && ta.includes('并发DDD') ? ta : false;
}, 90000, 3000);
check('并发收敛：两端正文逐字符一致且含双方片段（CCC+DDD，无丢字）', !!converge, String(converge).slice(0, 100));
await pa.screenshot({ path: SHOTS + '/a-converged.png' });
await pb.screenshot({ path: SHOTS + '/b-converged.png' });

// ── 阶段 5：A 关页重开（reload）→ 播种还原 ────────────────────────────
await pa.reload();
await bridgeReady(brA);
const restored = await waitFor(async () => { const t = await docText(pa); return t.includes('并发CCC') && t.includes('并发DDD'); }, 30000, 1000);
check('A 重开：本地 Y.Doc 重建，两端并发文本都在（账本播种）', !!restored, String(await docText(pa)).slice(0, 80));

check('全程无 pageerror', errsA.length === 0 && errsB.length === 0, `A=${errsA.length} B=${errsB.length}`);

await brA.close().catch(() => {});
await brB.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T19-05 协作双实例真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);