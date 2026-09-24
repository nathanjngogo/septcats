/* probe-discipline.mjs —— 探针数据隔离纪律检查器（09-24 真实库污染事故的防复发件）
 *
 * 规则（见 docs/事故记录-真实库探针污染-09-24.md）：
 * - 会**写数据**的探针必须钉应用数据根夹具 `UD/septcats.settings.json`（rootPath → scratch）。
 * - 只钉 `--user-data-dir` 不算隔离：它只隔 Chromium 态，SQLite 仍写 `~/.septcats`。
 * - 确属**只读**的探针须在文件内打 `@probe-readonly` 标记；确需操作真实库的**维护脚本**
 *   须打 `@probe-realroot` 标记（当前唯一合法用户 = 白名单清理 + 清理后复核）。
 *
 * 用法：`node docs/mockups/probe-discipline.mjs`（非零退出 = 有 UNPINNED）。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'docs/mockups';
/** 写数据动作指纹（命中即要求数据根夹具）。 */
const WRITE_PATTERNS = [
  'pages.create',
  'pages.remove',
  'pages.purge',
  'pages.rename',
  'pages.move',
  'blocks.commit',
  'pageExport.confirm',
  'db.create',
  'db.update',
  'favorites.set',
  'newPageNamed',
  'slash-item-table',
];
const PIN = 'septcats.settings.json';

function classify(name, src) {
  const pinned = src.includes(PIN);
  if (pinned) { return { ok: true, why: '已钉数据根夹具' }; }
  if (/@probe-readonly\b/.test(src)) { return { ok: true, why: '只读探针（已声明 @probe-readonly）' }; }
  if (/@probe-realroot\b/.test(src)) {
    return src.includes('pages.remove') || src.includes('pages.purge') || name.startsWith('maint-')
      ? { ok: true, why: '维护脚本走真实根（已声明 @probe-realroot）' }
      : { ok: false, why: '声明了 @probe-realroot 但文件名不在维护脚本位（应命名 maint-*）' };
  }
  const writes = WRITE_PATTERNS.filter((p) => src.includes(p));
  if (writes.length === 0) { return { ok: false, why: '未声明只读：请核对确无写操作后打 @probe-readonly' }; }
  return { ok: false, why: `写数据探针缺夹具（指纹：${writes.slice(0, 3).join(', ')}）` };
}

const files = readdirSync(DIR).filter((f) => /^(cdp-e2e|dbg|maint)-.*\.mjs$/.test(f)).sort();
const bad = [];
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8');
  const r = classify(f, src);
  if (!r.ok) { bad.push([f, r.why]); }
}
console.log(`扫描 ${files.length} 个探针/维护脚本，违规 ${bad.length} 个`);
for (const [f, why] of bad) { console.log(`UNPINNED ${f} —— ${why}`); }
process.exitCode = bad.length === 0 ? 0 : 1;
