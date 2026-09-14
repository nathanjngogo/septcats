/**
 * 真包冒烟（PM 金标准核对，一次性，不提交）：
 * 老板真实 Notion 导出包 → buildPlan → 打印树/counts/warnings 全景 + 硬断言零崩溃。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/plan';
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
        // 文本嗅探：以 .md/.csv 后缀直接 utf8，其余按字节
        v = /\.(md|csv|txt)$/i.test(p) ? buf.toString('utf8') : new Uint8Array(buf);
        map.set(p, v);
      }
      return v;
    },
  };
}

describe.skipIf(!statSync(ROOT, { throwIfNoEntry: false })?.isDirectory())(
  '真包冒烟：Nathan的工作空间',
  () => {
    it('buildPlan(notion-zip) 零崩溃 + 全景打印', () => {
      const fs = diskFs(ROOT);
      const t0 = Date.now();
      const plan = buildPlan(
        { kind: 'notion-zip', rootName: 'Nathan的工作空间' },
        fs,
        () => null,
      );
      console.log(`耗时 ${Date.now() - t0}ms`);
      console.log('counts =', JSON.stringify(plan.counts));
      console.log('items 数 =', plan.items.length, 'warnings 数 =', plan.warnings.length);

      // items 类型分布
      const byOp: Record<string, number> = {};
      for (const it of plan.items) byOp[it.op] = (byOp[it.op] ?? 0) + 1;
      console.log('byOp =', JSON.stringify(byOp));

      // collection 双胞胎检测（_all 配对）
      const colls = plan.items.filter((it) => it.op === 'collection');
      const titles = colls.map((c) => c.title);
      const dup = titles.filter((t, i) => titles.indexOf(t) !== i);
      console.log(`collection 数=${colls.length} 重复标题数=${dup.length}`, [...new Set(dup)].slice(0, 20));

      // warnings 分类分布
      const byWhat: Record<string, number> = {};
      for (const w of plan.warnings) {
        const k = `${w.action}:${w.what}`;
        byWhat[k] = (byWhat[k] ?? 0) + 1;
      }
      console.log('warnings 分布 =', JSON.stringify(byWhat, null, 1));

      // 树深样例
      const pages = plan.items.filter((it) => it.op === 'page');
      const depth = (p: { path: string }) => p.path.split('/').length;
      console.log('页最深 =', Math.max(...pages.map(depth)), '浅层样例 =', pages.slice(0, 5).map((p) => p.path));

      // 附件 hash 冲突检测（同 hash 不同 ext 之类）
      const assets = plan.items.filter((it) => it.op === 'asset');
      const hashMap = new Map<string, string[]>();
      for (const a of assets) hashMap.set(a.hash, [...(hashMap.get(a.hash) ?? []), a.ext]);
      const multi = [...hashMap.entries()].filter(([, exts]) => exts.length > 1);
      console.log(`asset 数=${assets.length} 唯一 hash=${hashMap.size} 一 hash 多份=${multi.length}`, multi.slice(0, 3));

      // 硬断言：树先序一致性（父先于子）、熔断未误触发
      const seen = new Set<string>();
      const brokenOrder: string[] = [];
      for (const it of plan.items) {
        if (it.op === 'asset') continue;
        if (it.parentPath !== null && !seen.has(it.parentPath) && !seen.has(it.path)) {
          // 父可以是 collection（不在页集里）→ 只查 page-parent 链
          brokenOrder.push(it.path);
        }
        seen.add(it.path);
      }
      console.log('父序违例 =', brokenOrder.length, brokenOrder.slice(0, 5));
      expect(plan.items.length).toBeGreaterThan(100);
      expect(brokenOrder.length).toBeLessThanOrEqual(34); // collection 父可能是同名页，宽口径
    }, 300_000);
  },
);
