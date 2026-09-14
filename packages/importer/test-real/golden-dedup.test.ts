/** 取证（一次性，PM 工具）：真包连跑两遍 plan，第二遍用第一遍的记账当 existingLookup。
 *  正确键格式 = (path, contentHash) 两参（与 desktop import_source 表一致）。
 *  E2 修复（395ba12：重命名先于去重）后此断言必须成立；修复前真包 CDP 实测漏 41 条。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan, contentHashOf } from '../src/plan';
import type { ImportSourceFs } from '../src/types';

const ROOT = 'E:/Hermes Agent工作空间/_scratch/real-notion';

function diskFs(root: string): ImportSourceFs {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const abs = join(dir, e);
      if (statSync(abs).isDirectory()) walk(abs);
      else files.push(relative(root, abs).split(sep).join('/'));
    }
  };
  walk(root);
  const map = new Map<string, string | Uint8Array>();
  return {
    list: () => files,
    read: (p) => {
      let v = map.get(p);
      if (v === undefined) {
        const buf = readFileSync(join(root, p));
        v = /\.(md|csv|txt)$/i.test(p) ? buf.toString('utf8') : new Uint8Array(buf);
        map.set(p, v);
      }
      return v;
    },
  };
}

describe('真包二次 plan 去重完整性（E2 回归）', () => {
  it('第一遍全量记账 → 第二遍漏网必须为 0', () => {
    const fs = diskFs(ROOT);
    const src = { kind: 'notion-zip', rootName: 'Nathan的工作空间' } as const;
    const plan1 = buildPlan(src, fs, () => null);
    // 记账键 = (path, contentHash)，与 desktop SQL 的 (source_path, content_hash) 逐字对齐
    const ledger = new Set<string>(
      plan1.items
        .filter((it) => it.op !== 'asset')
        .map((it) => `${(it as { path: string }).path}\u0000${contentHashOf(it)}`),
    );
    const plan2 = buildPlan(src, fs, (path, hash) => (ledger.has(`${path}\u0000${hash}`) ? 'x' : null));
    const leaked = plan2.items.filter(
      (it) => it.op !== 'asset' && !ledger.has(`${(it as { path: string }).path}\u0000${contentHashOf(it)}`),
    );
    console.log(
      `plan1 记账=${ledger.size} | plan2 pages=${plan2.counts.pages} skipped=${plan2.counts.skippedDuplicate} 漏网=${leaked.length}`,
    );
    for (const it of leaked.slice(0, 8)) {
      console.log('  LEAK', it.op, (it as { path: string }).path.slice(0, 70));
    }
    expect(leaked.length).toBe(0);
    expect(plan2.counts.pages).toBe(0);
    expect(plan2.counts.collections).toBe(0);
  }, 300_000);
});
