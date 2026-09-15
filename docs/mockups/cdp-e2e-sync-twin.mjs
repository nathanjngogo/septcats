/* M8b 双实例真机同步验收驱动（PM）：
 * 两个 unpacked 实例（不同 --user-data-dir）共享同一 sync 根 → A 建页 → B 追平。
 * 前置：dist-reverify/win-unpacked 已重打（含 T13 runtime）；settings.json 数据根用
 * SEPTCATS_ROOT env（platform bootstrapPaths 支持时）否则用默认 ~/.septcats/sync——
 * 本脚本直接预写各自 userData 的 settings.json rootPath 指向同一夹具目录。 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist-reverify/win-unpacked/Septcats.exe';
const SYNC = 'E:/Hermes Agent工作空间/_scratch/twin-sync';
const UD_A = 'E:/Hermes Agent工作空间/_scratch/twin-ud-a';
const UD_B = 'E:/Hermes Agent工作空间/_scratch/twin-ud-b';
const nonce = Date.now().toString(36);
for (const d of [SYNC, UD_A, UD_B]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }

function preWriteSettings(ud, deviceId) {
  // platform readSettings 契约：{schema:1, rootPath, ...app}；rootPath=共享同步根
  writeFileSync(`${ud}/settings.json`, JSON.stringify({ schema: 1, rootPath: SYNC.replace(/\//g, '\\'), theme: 'system' }), 'utf8');
}
preWriteSettings(UD_A, 'a'); preWriteSettings(UD_B, 'b');

const results = [];
function check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 160) : ''}`); }

function start(port, ud) {
  const p = spawn(EXE, [`--user-data-dir=${ud.replace(/\//g, '\\')}`, `--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore' });
  p.unref();
  return p;
}
async function connect(port, tries = 30) {
  for (let k = 0; k < tries; k++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch {}
  }
  return null;
}
const bridgeReady = async (br) => {
  const page = br.contexts()[0].pages()[0];
  for (let k = 0; k < 20; k++) {
    if (await page.evaluate(() => typeof window.septcats?.sync?.status === 'function').catch(() => false)) return page;
    await new Promise((r) => setTimeout(r, 800));
  }
  return page;
};

// 单实例锁：app 按 userData 判实例——两实例不同 UD，理论可共存；若锁名全局则第二实例退化为聚焦
const a = start(9231, UD_A);
await new Promise((r) => setTimeout(r, 4000));
const b = start(9232, UD_B);
const brA = await connect(9231);
const brB = await connect(9232);
check('双实例并起（两个 CDP 都连上）', !!brA && !!brB);
if (!brA || !brB) { (await brA)?.close?.(); (await brB)?.close?.(); process.exit(1); }

const pa = await bridgeReady(brA);
const pb = await bridgeReady(brB);
// 开同步（B 也开）
await pa.evaluate(async () => { await window.septcats.sync.setEnabled({ enabled: true }); });
await pb.evaluate(async () => { await window.septcats.sync.setEnabled({ enabled: true }); });
await pa.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });

const wsA = await pa.evaluate(async () => (await window.septcats.workspaces.list()).activeId);
const made = await pa.evaluate(async () => {
  const p = await window.septcats.pages.create({ parentId: null });
  await window.septcats.pages.rename({ id: p.id, title: '双子星页' });
  return p.id;
}).catch(async (e) => 'ERR:' + String(e).slice(0, 100));
check('A 建页改名', typeof made === 'string' && made.startsWith('pg'), String(made));
await pa.evaluate(async () => { await window.septcats.sync.now(); });

let found = false;
for (let k = 0; k < 24 && !found; k++) {
  await new Promise((r) => setTimeout(r, 3000));
  await pb.evaluate(async () => { await window.septcats.sync.now().catch(() => {}); });
  const wsB = await pb.evaluate(async () => (await window.septcats.workspaces.list()).activeId);
  const tree = await pb.evaluate(async (wid) => (await window.septcats.pages.tree({ workspaceId: wid })).map((x) => x.title), wsB ?? wsA);
  found = tree.some((t) => t.includes('双子星页'));
}
check('B 追平：页「双子星页」出现（跨实例同步 E2E）', found);

const stA = await pa.evaluate(async () => await window.septcats.sync.status());
const stB = await pb.evaluate(async () => await window.septcats.sync.status());
check('两侧 sync status 非 degraded', stA.state !== 'degraded' && stB.state !== 'degraded', JSON.stringify({ a: stA.state, b: stB.state }));

console.log('\n同步文件对账：', existsSync(SYNC + '/manifest.json') ? 'manifest 在' : 'manifest 缺');
await brA.close().catch(() => {});
await brB.close().catch(() => {});
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== M8b 双实例真机 ${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} ==`);
process.exit(failed === 0 ? 0 : 1);
