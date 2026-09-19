/* TASK-T29-01 真机验收（P0-2 段名碰撞静默丢 op 修复）：
 * 双实例（独立数据根）+ junction 共享 sync 目录。A/B 两端编辑 → 追平后：
 *   ① 两端页面树一致（跨实例同步 E2E）；
 *   ② 两端 sync.status() = ok 且 errors 空；
 *   ③ 盘上段内 op 数 == 两端账本 op_ledger 行数（核心不变量：已 flush 的 op 永不丢失）。
 * 范式承自 cdp-e2e-sync-twin.mjs（v2 正确夹具）；op 计数 = 停机后 better-sqlite3 只读
 * + 共享目录 .jsonl 段逐文件「行数-1（段头）」求和。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url).href);
const Database = require('better-sqlite3');

const EXE_PATH = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const SHARED = 'E:\\Hermes Agent工作空间\\_scratch\\t29-shared-sync';
const WINS = [
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\t29-root-a', ud: 'E:\\Hermes Agent工作空间\\_scratch\\t29-ud-a', port: 9261 },
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\t29-root-b', ud: 'E:\\Hermes Agent工作空间\\_scratch\\t29-ud-b', port: 9262 },
];

function killAll() {
  try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* 无进程时非零退出，忽略 */ }
}

function fresh() {
  killAll();
  for (const w of WINS) {
    rmSync(w.root, { recursive: true, force: true });
    rmSync(w.ud, { recursive: true, force: true });
  }
  rmSync(SHARED, { recursive: true, force: true });
  mkdirSync(SHARED, { recursive: true });
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 240) : ''}`);
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
    if (await page.evaluate(() => typeof window.septcats?.sync?.setEnabled === 'function').catch(() => false)) return page;
    await new Promise((r) => setTimeout(r, 800));
  }
  return page;
}
const treeTitles = async (page) => page.evaluate(async () => {
  const wid = (await window.septcats.workspaces.list()).activeId;
  return (await window.septcats.pages.tree({ workspaceId: wid })).map((x) => x.title);
});

fresh();
start(WINS[0]);
await new Promise((r) => setTimeout(r, 5000));
start(WINS[1]);
const brA = await connect(WINS[0].port);
const brB = await connect(WINS[1].port);
check('双实例并起（独立 DB + junction 共享 sync）', !!brA && !!brB);
if (!brA || !brB) {
  brA?.close?.(); brB?.close?.();
  console.log('== T29-01 真机 前置即崩 ==');
  process.exit(1);
}
const pa = await bridgeReady(brA);
const pb = await bridgeReady(brB);
const enA = await pa.evaluate(async () => { try { const s = await window.septcats.sync.setEnabled({ on: true }); return s.status; } catch (e) { return 'ERR ' + String(e).slice(0, 80); } });
const enB = await pb.evaluate(async () => { try { const s = await window.septcats.sync.setEnabled({ on: true }); return s.status; } catch (e) { return 'ERR ' + String(e).slice(0, 80); } });
check('两实例 setEnabled({on:true}) 成功', !String(enA).startsWith('ERR') && !String(enB).startsWith('ERR'), `A=${String(enA)} B=${String(enB)}`);

// A 端：建页 + 编辑器输入（产生 upsert/crdt op，含 EditSession 按块 version 定 c 的写路径）
await pa.evaluate(async () => {
  const p = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p.id, title: 'T29 碰撞回归页' });
  return p.id;
});
await pa.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await pa.keyboard.type('T29 真机：A 端输入触发同步。', { delay: 12 });
await pa.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });

// B 端追平
let foundB = false;
for (let k = 0; k < 14 && !foundB; k++) {
  await new Promise((r) => setTimeout(r, 4000));
  await pb.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  foundB = (await treeTitles(pb)).some((t) => t.includes('T29 碰撞回归页'));
}
check('B 追平：「T29 碰撞回归页」出现', foundB);

// B 端再建页 + 输入 → A 追平（双端互推）
await pb.evaluate(async () => {
  const p = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p.id, title: 'T29 B 端页' });
  return p.id;
});
await pb.locator('.pv-body').first().click({ timeout: 8000 }).catch(() => {});
await pb.keyboard.type('T29 真机：B 端输入。', { delay: 12 });
await pb.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
let foundA = false;
for (let k = 0; k < 14 && !foundA; k++) {
  await new Promise((r) => setTimeout(r, 4000));
  await pa.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  foundA = (await treeTitles(pa)).some((t) => t.includes('T29 B 端页'));
}
check('A 追平：「T29 B 端页」出现（双端互推）', foundA);

// 多轮 sync.now 收口（冲掉空闲 flush 尾巴）
for (let k = 0; k < 3; k++) {
  await pa.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  await pb.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  await new Promise((r) => setTimeout(r, 2500));
}

const trees = await Promise.all([treeTitles(pa), treeTitles(pb)]);
const treeA = trees[0].filter((t) => t.includes('T29')).sort();
const treeB = trees[1].filter((t) => t.includes('T29')).sort();
check('两端 T29 页面树一致', JSON.stringify(treeA) === JSON.stringify(treeB) && treeA.length === 2, `A=${JSON.stringify(treeA)} B=${JSON.stringify(treeB)}`);

const stA = await pa.evaluate(async () => await window.septcats.sync.status());
const stB = await pb.evaluate(async () => await window.septcats.sync.status());
check('A 状态 ok、errors 空', stA.state === 'ok' && (stA.errors ?? []).length === 0, JSON.stringify(stA).slice(0, 200));
check('B 状态 ok、errors 空', stB.state === 'ok' && (stB.errors ?? []).length === 0, JSON.stringify(stB).slice(0, 200));

// 停机 → 盘上 op 数 vs 两端账本 op 数
await brA.close().catch(() => {});
await brB.close().catch(() => {});
killAll();
await new Promise((r) => setTimeout(r, 1500));

let diskOps = 0;
let segFiles = 0;
for (const f of readdirSync(SHARED)) {
  if (!f.endsWith('.jsonl')) continue;
  segFiles += 1;
  const lines = readFileSync(`${SHARED}\\${f}`, 'utf8').split('\n').filter((l) => l.trim() !== '');
  diskOps += Math.max(0, lines.length - 1); // 首行 = 段头 {"h":...}
}
async function ledgerCount(dbPath) {
  // PM 修正：脚本跑在 node 上，而原生模块在打包时切到 electron ABI → better-sqlite3 无法在本进程加载。
  // 改用 python 只读读库（无 ABI 依赖），顺带输出 op_id 集合供集合级包含判定。
  const { execSync } = await import('node:child_process');
  const out = execSync(
    `python -c "import sqlite3,json,sys;c=sqlite3.connect(r'file:${dbPath}?mode=ro',uri=True);print(json.dumps([r[0] for r in c.execute('select op_id from op_ledger')]))"`,
    { encoding: 'utf8' },
  ).trim();
  const ids = JSON.parse(out || '[]');
  return ids;
}
let ledA = [];
let ledB = [];
try { ledA = await ledgerCount(`${WINS[0].root}\\septcats.db`); } catch (e) { console.log('DIAG A db:', String(e).slice(0, 120)); }
try { ledB = await ledgerCount(`${WINS[1].root}\\septcats.db`); } catch (e) { console.log('DIAG B db:', String(e).slice(0, 120)); }
// 盘上 op_id 集合（集合级包含判定：共享目录下盘上=两端段的并集，等式口径错误）
const diskIds = new Set();
for (const f of readdirSync(SHARED)) {
  if (!f.endsWith('.jsonl')) continue;
  const ls = readFileSync(`${SHARED}\\${f}`, 'utf8').split('\n').filter((l) => l.trim() !== '');
  for (const l of ls.slice(1)) { try { diskIds.add(JSON.parse(l).op_id); } catch { /* 段头/异常行 */ } }
}
console.log(`计数：盘上段文件 ${String(segFiles)} 个 / 盘上 op ${String(diskIds.size)} / A 账本 ${String(ledA.length)} / B 账本 ${String(ledB.length)}`);
check('A 账本 op ⊆ 盘上 op（不丢 op）', ledA.length > 0 && ledA.every((id) => diskIds.has(id)), `led=${ledA.length} disk=${diskIds.size} missing=${ledA.filter((id) => !diskIds.has(id)).length}`);
check('B 账本 op ⊆ 盘上 op（不丢 op）', ledB.length > 0 && ledB.every((id) => diskIds.has(id)), `led=${ledB.length} disk=${diskIds.size} missing=${ledB.filter((id) => !diskIds.has(id)).length}`);
check('盘上有段文件且含内容摘要新命名', segFiles > 0 && readdirSync(SHARED).some((f) => /^seg-[0-9a-f]{8}-[a-z0-9]{8,32}-[0-9a-f]{6}-[0-9a-f]{8}\.jsonl$/.test(f)));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T29-01 双实例真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);
