import { describe, expect, it } from 'vitest';
import { buildPlan, contentHashOf, finalizePlan, MAX_PLAN_ITEMS, PlanTooLargeError } from '../src/plan';
import { importPlanSchema } from '../src/types';
import type { ExistingLookup } from '../src/plan';
import type { ImportItem, ImportSourceFs } from '../src/types';

const neverImported: ExistingLookup = () => null;

function pageItem(path: string, parentPath: string | null = null, text = `内容 ${path}`): ImportItem {
  return {
    op: 'page',
    path,
    title: path,
    parentPath,
    blocks: [{ type: 'code', props: { lang: '' }, content: text }],
  };
}

function memoryFs(entries: Record<string, string | Uint8Array>): ImportSourceFs {
  const map = new Map<string, string | Uint8Array>(Object.entries(entries));
  return {
    list: () => [...map.keys()],
    read: (path: string) => {
      const value = map.get(path);
      if (value === undefined) {
        throw new Error(`missing: ${path}`);
      }
      return value;
    },
  };
}

describe('finalizePlan：去重（skipped-duplicate）', () => {
  it('(path, contentHash) 命中 → 条目剔除 + warning + counts.skippedDuplicate 回填', () => {
    const items = [pageItem('a'), pageItem('b')];
    const hashA = contentHashOf(items[0] as ImportItem);
    const lookup: ExistingLookup = (path, hash) => (path === 'a' && hash === hashA ? 'page-123' : null);
    const plan = finalizePlan({ kind: 'md-dir', rootName: '库' }, items, [], lookup);
    expect(() => importPlanSchema.parse(plan)).not.toThrow();

    const paths = plan.items.filter((item) => item.op !== 'asset').map((item) => (item.op === 'page' ? item.path : item.path));
    expect(paths).toEqual(['b']);
    expect(plan.counts.skippedDuplicate).toBe(1);
    expect(plan.warnings).toHaveLength(1);
    const warning = plan.warnings[0];
    expect(warning).toMatchObject({
      path: 'a',
      what: '已导入的页面',
      action: 'skipped-duplicate',
    });
    expect(warning?.note).toContain('page-123');
  });

  it('asset 不做计划期去重（内容寻址天然幂等），原样保留', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const asset: ImportItem = {
      op: 'asset',
      hash: contentHashOf(pageItem('x')), // 任意 64hex
      ext: '.png',
      bytes,
    };
    void asset;
    const hash = contentHashOf(pageItem('x'));
    const items: ImportItem[] = [{ op: 'asset', hash, ext: '.png', bytes }];
    const lookup: ExistingLookup = () => 'page-1';
    const plan = finalizePlan({ kind: 'md-file', rootName: 'x' }, items, [], lookup);
    expect(plan.items).toHaveLength(1);
    expect(plan.counts.skippedDuplicate).toBe(0);
  });

  it('collection 命中去重 → what 为「已导入的数据表」', () => {
    const items: ImportItem[] = [
      {
        op: 'collection',
        path: 'db',
        title: 'db',
        parentPath: null,
        schema: { properties: { p1: { name: 'Name', type: 'text' } }, title_pid: 'p1' },
        records: [],
      },
    ];
    const lookup: ExistingLookup = (path) => (path === 'db' ? 'page-9' : null);
    const plan = finalizePlan({ kind: 'notion-zip', rootName: 'N' }, items, [], lookup);
    expect(plan.items).toHaveLength(0);
    expect(plan.warnings[0]?.what).toBe('已导入的数据表');
  });
});

describe('finalizePlan：孤儿挂根 + 重名 hash 后缀', () => {
  it('父不存在 → 挂根 + warning；md-dir 目录前缀父 → 不算孤儿', () => {
    const items = [pageItem('ghost-child', 'ghost'), pageItem('guide/intro.md', 'guide')];
    const plan = finalizePlan({ kind: 'md-dir', rootName: '库' }, items, [], neverImported);
    const pages = plan.items.filter((item) => item.op === 'page');
    expect(pages).toHaveLength(2);
    const orphan = pages.find((item) => item.op === 'page' && item.path === 'ghost-child');
    const guide = pages.find((item) => item.op === 'page' && item.path === 'guide/intro.md');
    expect(orphan?.op === 'page' && orphan.parentPath).toBeNull();
    expect(guide?.op === 'page' && guide.parentPath).toBe('guide'); // 前缀规则放行
    const orphanWarning = plan.warnings.find((w) => w.what === '孤儿条目');
    expect(orphanWarning?.action).toBe('degraded');
    expect(orphanWarning?.note).toContain('ghost');
    expect(plan.warnings.filter((w) => w.what === '孤儿条目')).toHaveLength(1);
  });

  it('重名 path → 后者追加内容 hash 前 6 位 + warning', () => {
    const first = pageItem('same', null, 'first');
    const second = pageItem('same', null, 'second');
    const plan = finalizePlan({ kind: 'notion-zip', rootName: 'N' }, [first, second], [], neverImported);
    const pages = plan.items.filter((item) => item.op === 'page');
    expect(pages).toHaveLength(2);
    const suffix = contentHashOf(second).slice(0, 6);
    expect(pages.map((item) => (item.op === 'page' ? item.path : ''))).toEqual([`same`, `same-${suffix}`]);
    const warning = plan.warnings.find((w) => w.what === '路径冲突');
    expect(warning?.action).toBe('degraded');
    expect(warning?.note).toContain(suffix);
  });
});

describe('finalizePlan：上限熔断', () => {
  it('>5000 items → PlanTooLargeError（code=E_TOO_LARGE）', () => {
    const items: ImportItem[] = [];
    for (let i = 0; i <= MAX_PLAN_ITEMS; i += 1) {
      items.push(pageItem(`p${i}`));
    }
    expect(items.length).toBe(MAX_PLAN_ITEMS + 1);
    expect(() => finalizePlan({ kind: 'md-dir', rootName: '库' }, items, [], neverImported)).toThrowError(
      PlanTooLargeError,
    );
    try {
      finalizePlan({ kind: 'md-dir', rootName: '库' }, items, [], neverImported);
    } catch (error) {
      expect((error as PlanTooLargeError).code).toBe('E_TOO_LARGE');
      expect((error as PlanTooLargeError).itemCount).toBe(MAX_PLAN_ITEMS + 1);
    }
  });

  it('恰 5000 → 不熔断', () => {
    const items: ImportItem[] = [];
    for (let i = 0; i < MAX_PLAN_ITEMS; i += 1) {
      items.push(pageItem(`p${i}`));
    }
    const plan = finalizePlan({ kind: 'md-dir', rootName: '库' }, items, [], neverImported);
    expect(plan.counts.pages).toBe(MAX_PLAN_ITEMS);
  });
});

describe('finalizePlan：counts 汇总', () => {
  it('pages/collections/records/assets/skippedDuplicate/degraded 全量对账', () => {
    const items: ImportItem[] = [
      pageItem('a'),
      { op: 'asset', hash: contentHashOf(pageItem('hash')), ext: '.bin', bytes: new Uint8Array([9]) },
      {
        op: 'collection',
        path: 'db',
        title: 'db',
        parentPath: 'a',
        schema: { properties: { p1: { name: 'Name', type: 'text' } }, title_pid: 'p1' },
        records: [{ p1: 'x' }, { p1: 'y' }],
      },
    ];
    const warnings = [
      { path: 'a', what: 'x', action: 'degraded' as const, note: 'n' },
    ];
    const lookup: ExistingLookup = (path) => (path === 'db' ? 'page-5' : null);
    const plan = finalizePlan({ kind: 'notion-zip', rootName: 'N' }, items, warnings, lookup);
    expect(plan.counts).toEqual({
      pages: 1,
      collections: 0, // db 已被去重剔除
      records: 0,
      assets: 1,
      skippedDuplicate: 1,
      degraded: 1, // 传入的 1 条 degraded；skipped-duplicate warning 不计 degraded
    });
    expect(plan.warnings.filter((w) => w.action === 'skipped-duplicate')).toHaveLength(1);
  });
});

describe('buildPlan：三源统一入口', () => {
  it('md-file 源：正文+附件走通，去重链路生效', () => {
    const fs = memoryFs({
      'note.md': '---\ntags: [a]\n---\n![pic](cat.png)\n',
      'cat.png': new Uint8Array([1, 2, 3]),
    });
    const plan = buildPlan({ kind: 'md-file', path: 'note.md' }, fs, neverImported);
    expect(plan.source.kind).toBe('md-file');
    expect(plan.counts.pages).toBe(1);
    expect(plan.counts.assets).toBe(1);
    expect(plan.counts.degraded).toBe(1); // front-matter tags 降级
  });

  it('md-dir 源 + 命中去重：孤儿语义随剔除生效', () => {
    const fs = memoryFs({
      'guide/intro.md': '# 指南\n',
      'guide/deep/advanced.md': '# 进阶\n',
    });
    const introHash = contentHashOf({
      op: 'page',
      path: 'guide/intro.md',
      title: 'intro',
      parentPath: 'guide',
      blocks: [],
    });
    void introHash;
    // 命中 guide/intro.md：hash 用真实 plan 首跑结果对齐太绕，这里用始终命中的 lookup
    const always: ExistingLookup = (path) => (path === 'guide/intro.md' ? 'page-1' : null);
    const plan = buildPlan({ kind: 'md-dir', rootName: '知识库' }, fs, always);
    expect(plan.counts.pages).toBe(1); // advanced 保留
    expect(plan.counts.skippedDuplicate).toBe(1);
    const advanced = plan.items.find((item) => item.op === 'page' && item.path === 'guide/deep/advanced.md');
    // intro 被剔除，但 'guide/deep' 仍是源内真实目录（advanced.md 所在）→ 不算孤儿
    expect(advanced?.op === 'page' && advanced.parentPath).toBe('guide/deep');
    expect(plan.warnings.filter((w) => w.what === '孤儿条目')).toHaveLength(0);
  });

  it('notion-zip 源经统一入口（内存 fs）', () => {
    const fs = memoryFs({
      '页 00000000000000000000000000000001/页 00000000000000000000000000000001.md': '# 页\n',
    });
    const plan = buildPlan({ kind: 'notion-zip', rootName: '导出' }, fs, neverImported);
    expect(plan.source).toEqual({ kind: 'notion-zip', rootName: '导出' });
    expect(plan.counts.pages).toBe(1);
  });

  it('csv 源经统一入口', () => {
    const fs = memoryFs({ '表.csv': 'Name,数量\n甲,1\n' });
    const plan = buildPlan({ kind: 'csv', path: '表.csv' }, fs, neverImported);
    expect(plan.counts.pages).toBe(1);
    expect(plan.counts.collections).toBe(1);
    expect(plan.counts.records).toBe(1);
  });

  it('md-file / csv 缺 path → 报错', () => {
    expect(() => buildPlan({ kind: 'md-file' }, memoryFs({}), neverImported)).toThrowError(/path/);
    expect(() => buildPlan({ kind: 'csv' }, memoryFs({}), neverImported)).toThrowError(/path/);
  });
});
