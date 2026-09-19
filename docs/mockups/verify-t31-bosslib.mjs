/* PM 独立验收 T31-01（P0-3）：用老板库**副本**验证「重发循环停止 + 未发布 op 全部标记 + 水位推进」
 * 只读源夹具 repro-boss-lib，工作副本另建；不触碰 C:\Users\Administrator\.septcats\ */
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readdirSync, copyFileSync, cpSync } from 'node:fs';

const EXE = 'E:/Hermes Agent工作空间/Septcats/apps/desktop/dist/win-unpacked/Septcats.exe';
const SRC = 'E:\\Hermes Agent工作空间\\_scratch\\repro-boss-lib';
const WORK = 'E:\\Hermes Agent工作空间\\_scratch\\rc6-libwork';
const UD = 'E:\\Hermes Agent工作空间\\_scratch\\rc6-ud';
const PORT = 9395;
const killAll = () => { try { execSync('powershell -NoProfile -Command "Get-Process Septcats -EA SilentlyContinue | Stop-Process -Force"', { stdio: 'ignore' }); } catch { /* none */ } };
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).slice(0, 220) : ''}`); };
const py = (code) => JSON.parse(execSync(`python -c "${code.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim());
const nullCount = () => py("import sqlite3,json;c=sqlite3.connect(r'file:E:\\\\Hermes Agent工作空间\\\\_scratch\\\\rc6-libwork\\\\septcats.db?mode=ro',uri=True);print(json.dumps({'null':c.execute('select count(*) from op_ledger where seg_id is null').fetchone()[0],'total':c.execute('select count(*) from op_ledger').fetchone()[0],'maxc':c.execute('select max(lamport_c) from op_ledger').fetchone()[0]}))");
const segs = () => readdirSync(`${WORK}\\sync`).filter((f) => f.endsWith('.jsonl'));

killAll();
for (const d of [WORK, UD]) rmSync(d, { recursive: true, force: true });
for (const d of [WORK, UD]) mkdirSync(d, { recursive: true });
copyFileSync(`${SRC}\\septcats.db`, `${WORK}\\septcats.db`);
try { copyFileSync(`${SRC}\\septcats.db-wal`, `${WORK}\\septcats.db-wal`); } catch { /* 无 wal */ }
cpSync(`${SRC}\\sync`, `${WORK}\\sync`, { recursive: true });
writeFileSync(`${UD}\\septcats.settings.json`, JSON.stringify({ schema: 1, rootPath: WORK }), 'utf8');
console.log('BASELINE(副本初始):', JSON.stringify(nullCount()), 'segs=', segs().length);

const p = spawn(EXE, [`--user-data-dir=${UD}`, `--remote-debugging-port=${String(PORT)}`], { detached: true, stdio: 'ignore' });
p.unref();
let br = null;
for (let k = 0; k < 25 && br === null; k++) { await new Promise((r) => setTimeout(r, 1000)); try { br = await chromium.connectOverCDP(`http://127.0.0.1:${String(PORT)}`); } catch { /* retry */ } }
const page = br.contexts()[0].pages()[0];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let k = 0; k < 25; k++) { if (await page.evaluate(() => typeof window.septcats?.sync?.status === 'function').catch(() => false)) break; await wait(800); }
await page.evaluate(async () => { try { await window.septcats.sync.setEnabled({ on: true }); } catch { /* ok */ } });
await wait(2000);
const st = async () => page.evaluate(async () => { try { return await window.septcats.sync.status(); } catch (e) { return { err: String(e).slice(0, 120) }; } });
for (let round = 1; round <= 3; round++) {
  await wait(6000);
  const s = await st();
  const n = nullCount();
  const seg = segs();
  console.log(`ROUND${String(round)}: state=${String(s?.state)} errors=${String((s?.errors ?? []).length)} pending=${String(s?.pendingOps)} | seg_id NULL=${String(n.null)}/${String(n.total)} maxc=${String(n.maxc)} | segs=${String(seg.length)}`);
  check(`R${String(round)} 同步状态 ok 且无错误`, s?.state === 'ok' && (s?.errors ?? []).length === 0, JSON.stringify(s).slice(0, 160));
}
const nEnd = nullCount();
const segEnd = segs();
check('★ 未发布 op 全部标记（seg_id NULL = 0）', nEnd.null === 0, `NULL=${String(nEnd.null)}/${String(nEnd.total)}`);
check('★ 段数稳定（无重复发布同区间）', new Set(segEnd.map((f) => f.replace(/-[0-9a-f]{8}\.jsonl$/, ''))).size === segEnd.length, `segs=${String(segEnd.length)} 去重后=${String(new Set(segEnd.map((f) => f.replace(/-[0-9a-f]{8}\.jsonl$/, ''))).size)}`);
const pill = await page.evaluate(() => document.querySelector('.sc-sync-status__pill')?.textContent?.trim() ?? '(无)');
check('★ 状态栏显示已同步（非错误）', /已同步|Synced/.test(pill), `pill="${pill}"`);
await br.close().catch(() => {});
killAll();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n== T31-01 PM 独立验收（老板库副本）${failed === 0 ? 'ALL-PASS' : failed + ' FAILED'} (${results.length} 项) ==`);
process.exit(0);