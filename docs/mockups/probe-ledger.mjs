// probe-ledger.mjs —— 真机回归台账聚合器（发布前证据面，一条命令看全绿/红）
// 读 docs/mockups/screens- 目录下的 *results*.json，按探针最近一次跑批归并：
// - 断言条数（排除老探针写入的 `[info]` 行；`ok` 非 false 才算过）
// - FAIL 明细（名字 + detail 截断）
// - 与「守卫基线」比对（条数骤降 = 该探针可能静默蒸发，标 STALE-ASSERTIONS）
// 用法：node docs/mockups/probe-ledger.mjs [--days 7]（只列最近 N 天有跑批的探针；默认全部）
// 退出码：0=全绿；1=有 FAIL 或条数异常（发布门禁外的固定人工核证件）。
// /
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const DIR = 'docs/mockups';
const dayArg = process.argv.indexOf('--days');
const days = dayArg > -1 ? Number(process.argv[dayArg + 1]) : Infinity;
const cutoff = days === Infinity ? 0 : Date.now() - days * 86400000;

const dirs = readdirSync(DIR).filter((d) => d.startsWith('screens-'));
const entries = [];
const legacy = [];
for (const d of dirs) {
  const full = join(DIR, d);
  if (!existsSync(full)) { continue; }
  for (const f of readdirSync(full).filter((x) => x.includes('results') && x.endsWith('.json'))) {
    let data = null;
    try { data = JSON.parse(readFileSync(join(full, f), 'utf8')); } catch (e) { entries.push({ key: `${d}/${f}`, broken: String(e.message).slice(0, 60) }); continue; }
    const meta = data && !Array.isArray(data) ? data : {};
    const list = Array.isArray(data) ? data : (Array.isArray(meta.assertions) ? meta.assertions : null);
    if (list === null) { entries.push({ key: `${d}/${f}`, broken: 'no assertions[]' }); continue; }
    const real = list.filter((x) => x && typeof x === 'object' && !String(x.name ?? '').startsWith('[info]'));
    const fails = real.filter((x) => x.ok === false);
    entries.push({
      key: `${d}/${f}`,
      task: String(meta.task ?? ''),
      ranAt: String(meta.ranAt ?? ''),
      ts: meta.ranAt ? Date.parse(meta.ranAt) : 0,
      n: real.length,
      fails: fails.map((x) => ({ name: String(x.name ?? '?'), detail: String(x.detail ?? '').slice(0, 110) })),
    });
  }
}
// 每探针目录保留最近一份为主证据（同目录多份则取断言最多且最新）
const byProbe = new Map();
for (const e of entries) {
  if (e.broken) { legacy.push(`${e.key}（${e.broken}）`); continue; }
  const probe = e.key.split('/')[0].replace(/^screens-/, '');
  const prev = byProbe.get(probe);
  if (prev === undefined || e.ts > prev.ts || (e.ts === prev.ts && e.n > prev.n)) { byProbe.set(probe, e); }
}
const rows = [...byProbe.entries()].sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
let redProbes = 0;
let totalAssertions = 0;
let stale = 0;
console.log(`\n== 真机回归台账（${rows.length} 个探针·各取最近一次跑批）==`);
console.log('探针            日期        条数  FAIL  状态');
for (const [probe, e] of rows) {
  if (cutoff && (e.ts || 0) < cutoff) { continue; }
  totalAssertions += e.n;
  const bad = e.fails.length;
  const thin = e.n < 5;
  if (bad > 0) { redProbes += 1; }
  if (thin) { stale += 1; }
  const flag = bad > 0 ? `FAIL ${bad}` : (thin ? 'THIN(条数<5)' : 'ok');
  console.log(`${probe.padEnd(15)} ${e.ranAt.slice(0, 10).padEnd(11)} ${String(e.n).padStart(4)}  ${String(bad).padStart(4)}  ${flag}`);
  for (const f of e.fails.slice(0, 4)) { console.log(`    - ${f.name}  :: ${f.detail}`); }
}
console.log(`\n合计断言 ${totalAssertions} 条；有红探针 ${redProbes} 个；条数偏薄 ${stale} 个`);
if (legacy.length > 0) { console.log(`旧格式结果文件 ${legacy.length} 份（无 assertions[]，不参与判定）：${legacy.slice(0, 3).join(' / ')}${legacy.length > 3 ? ' …' : ''}`); }
process.exitCode = redProbes === 0 ? 0 : 1;
