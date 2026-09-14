/** 真包冒烟 2（一次性）：warning 明细 + 附件断链根因定位 */
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
        v = /\.(md|csv|txt)$/i.test(p) ? buf.toString('utf8') : new Uint8Array(buf);
        map.set(p, v);
      }
      return v;
    },
  };
}

describe('真包冒烟 2', () => {
  it('warning 明细画像', () => {
    const fs = diskFs(ROOT);
    const plan = buildPlan({ kind: 'notion-zip', rootName: 'Nathan的工作空间' }, fs, () => null);

    const show = (action: string, what: string, n: number) => {
      const list = plan.warnings.filter((w) => w.action === action && w.what === what);
      console.log(`\n===== ${action}:${what}（共 ${list.length}，样 ${Math.min(n, list.length)}）=====`);
      for (const w of list.slice(0, n)) {
        console.log(`  path: ${w.path}`);
        console.log(`  note: ${w.note}`);
      }
    };
    show('degraded', '本地附件缺失', 8);
    show('degraded', 'GFM 表格', 4);
    show('degraded', 'CSV 数据库', 6);
    show('degraded', '路径冲突', 6);
    show('degraded', 'relation 候选', 6);

    // 图片引用形态：从 md 里抽 ![...](...) 的原样
    const mds = fs.list().filter((p) => p.endsWith('.md'));
    const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    const forms = new Map<string, number>();
    for (const m of mds.slice(0, 120)) {
      const t = fs.read(m);
      if (typeof t !== 'string') continue;
      for (const mm of t.matchAll(imgRe)) {
        const url = mm[1];
        const k = /^https?:/.test(url) ? '(http 外链)'
          : /%20|\s/.test(url) ? '(含空格/百分号编码)'
          : /^\.{0,2}\//.test(url) ? '(相对 ./ 或 /)'
          : '(裸相对路径)';
        forms.set(k, (forms.get(k) ?? 0) + 1);
        if (k !== '(http 外链)' && (forms.get('__shown') ?? 0) < 6) {
          forms.set('__shown', (forms.get('__shown') ?? 0) + 1);
          console.log(`  图片样例[${m.slice(-24)}]: ${url.slice(0, 100)}`);
        }
      }
    }
    console.log('图片 URL 形态分布 =', JSON.stringify([...forms.entries()]));
    expect(1).toBe(1);
  }, 300_000);
});
