/** 取证（一次性）：对真包连跑两次 plan，第二次用第一次的 (path,hash) 当 existingLookup，
 *  找出漏网条目并按特征分类。 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan, contentHashOf } from '../src/plan';
import type { ImportItem, ImportSourceFs } from '../src/types';

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

function key(it: ImportItem): string {
  return it.op === 'asset' ? `asset:${it.hash}` : `${it.op}\0${it.path}\0${contentHashOf(it)}`;
}

describe('真包重复 plan 去重取证', () => {
  it('第二遍 plan 的漏网条目画像', () => {
    const fs = diskFs(ROOT);
    const src = { kind: 'notion-zip', rootName: 'Nathan的工作空间' } as const;
    const plan1 = buildPlan(src, fs, () => null);
    const seen = new Set<string>(plan1.items.map(key));
    const plan2 = buildPlan(src, fs, (p, h) => (seen.has(`${p}\0${h}`) ? 'dup' : null));

    const leaked = plan2.items.filter(
      (it) => it.op !== 'asset' && !seen.has(key(it)),
    );
    console.log(`plan1 items=${plan1.items.length} plan2 items=${plan2.items.length} 漏网=${leaked.length}`);
    for (const it of leaked.slice(0, 12)) {
      console.log('  LEAK', it.op, it.path.slice(0, 60), 'hash', contentHashOf(it).slice(0, 8));
    }
    // 对每个漏网项，找 plan1 里 path 相同的条目对比 hash
    for (const it of leaked.slice(0, 6)) {
      if (it.op === 'asset') continue;
      const same = plan1.items.filter(
        (x) => x.op === it.op && (x as { path?: string }).path === it.path,
      );
      console.log(
        `  对比 ${it.path.slice(0, 40)}: plan1 中同 path 条目 ${same.length} 个`,
        same.map((x) => contentHashOf(x).slice(0, 8)).join(','),
        '| plan2 hash=', contentHashOf(it).slice(0, 8),
      );
    }
    const byOp: Record<string, number> = {};
    for (const it of leaked) byOp[it.op] = (byOp[it.op] ?? 0) + 1;
    console.log('漏网分布 =', JSON.stringify(byOp));
    expect(leaked.length).toBe(0); // 修好后此断言必须成立
  }, 300_000);
});
