/* M8b 双实例真机同步验收 v2（PM）：
 * 正确夹具 = 两个独立数据根（各自 DB/凭据/工作区），仅 <root>/sync 经 junction
 * 指向同一物理目录——模拟"两台设备各自的网盘客户端同步同一个文件夹"。
 * 教训 v1：两实例共享同一 rootPath 会抢 septcats.db 独占锁 → 第二实例 DB 起不来，
 * sync:setEnabled 报的不是夹具错而是"数据库服务不可用"——DB 必须各一份。 */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';

const EXE = 'E:\\Hermes Agent工作空间\\_scratch\\always-ignored'; // overwritten below
const EXE_PATH = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const SHARED = 'E:\\Hermes Agent工作空间\\_scratch\\twin-shared-sync';
const WINS = [
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\twin-root-a', ud: 'E:\\Hermes Agent工作空间\\_scratch\\twin-ud-a', port: 9231 },
  { root: 'E:\\Hermes Agent工作空间\\_scratch\\twin-root-b', ud: 'E:\\Hermes Agent工作空间\\_scratch\\twin-ud-b', port: 9232 },
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
    // 关键：root/sync 做成 junction → 共享目录（mklink 对不存在目标即建链接）
    execSync(`cmd /c mklink /J "${w.root}\\sync" "${SHARED}"`, { stdio: 'ignore' });
    // 各自 settings：rootPath 指向自己 root（DB 独立、sync 经 junction 共享）。
    // 文件名 = platform SETTINGS_FILE_NAME（septcats.settings.json，写错名=rootPath 被静默忽略）
    writeFileSync(`${w.ud}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: w.root, theme: 'system' }), 'utf8');
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 170) : ''}`);
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

fresh();
start(WINS[0]);
await new Promise((r) => setTimeout(r, 5000));
start(WINS[1]);
const brA = await connect(WINS[0].port);
const brB = await connect(WINS[1].port);
check('双实例并起（独立 DB + junction 共享 sync）', !!brA && !!brB);
if (!brA || !brB) {
  brA?.close?.(); brB?.close?.();
  console.log('== M8b 双实例真机 前置即崩 ==');
  process.exit(1);
}

const pa = await bridgeReady(brA);
const pb = await bridgeReady(brB);
const enA = await pa.evaluate(async () => { try { const s = await window.septcats.sync.setEnabled({ on: true }); return s.status; } catch (e) { return 'ERR ' + String(e).slice(0, 80); } });
const enB = await pb.evaluate(async () => { try { const s = await window.septcats.sync.setEnabled({ on: true }); return s.status; } catch (e) { return 'ERR ' + String(e).slice(0, 80); } });
check('两实例 setEnabled({on:true}) 成功', !String(enA).startsWith('ERR') && !String(enB).startsWith('ERR'), `A=${String(enA)} B=${String(enB)}`);

const made = await pa.evaluate(async () => {
  const p = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p.id, title: '双子星页' });
  return p.id;
}).catch((e) => 'ERR:' + String(e).slice(0, 100));
check('A 建页改名（id=ULID，无 pg 前缀）', typeof made === 'string' && /^[0-9A-Z]{26}$/.test(made), String(made));
await pa.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });

let found = false;
for (let k = 0; k < 14 && !found; k++) {
  await new Promise((r) => setTimeout(r, 4000));
  await pb.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  const wsB = await pb.evaluate(async () => (await window.septcats.workspaces.list()).activeId);
  const tree = await pb.evaluate(async (wid) => (await window.septcats.pages.tree({ workspaceId: wid })).map((x) => x.title), wsB);
  found = tree.some((t) => t.includes('双子星页'));
}
check('B 追平：「双子星页」出现（跨实例同步 E2E）', found);
if (!found) {
  const files = existsSync(SHARED) ? readdirSync(SHARED) : [];
  const stB = await pb.evaluate(async () => await window.septcats.sync.status()).catch((e) => 'ERR ' + String(e).slice(0, 120));
  console.log('DIAG 共享目录:', JSON.stringify(files.slice(0, 8)), 'B状态:', JSON.stringify(stB).slice(0, 220));
}
const segs = existsSync(SHARED) ? readdirSync(SHARED) : [];
check('共享目录有段/manifest（junction 路径被 runtime 吃到）', segs.some((f) => f.startsWith('seg-') || f.startsWith('manifest')), segs.slice(0, 6).join(','));

await brA.close().catch(() => {});
await brB.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== M8b 双实例真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(failed === 0 ? 0 : 1);
