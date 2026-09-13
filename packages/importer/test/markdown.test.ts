import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { importPlanSchema } from '../src/types';
import type { ImportSourceFs } from '../src/types';
import { parseMdDir, parseMdFile } from '../src/markdown';

/** 内存 Map 版 ImportSourceFs（任务书 §0.1：测试用注入实现）。 */
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

function sha256(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return createHash('sha256').update(bytes).digest('hex');
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pagesOf(plan: ReturnType<typeof parseMdDir>) {
  return plan.items.filter((item) => item.op === 'page');
}

function assetsOf(plan: ReturnType<typeof parseMdDir>) {
  return plan.items.filter((item) => item.op === 'asset');
}

describe('markdown：front-matter', () => {
  it('title + tags：title 进页面标题，tags 降级为页首 callout（quote+icon）+ warning', () => {
    const fs = memoryFs({
      'note.md': '---\ntitle: 猫咪手册\ntags: [饲养, 健康]\n---\n\n正文一段\n',
    });
    const plan = parseMdFile(fs, 'note.md');
    expect(() => importPlanSchema.parse(plan)).not.toThrow();

    const page = pagesOf(plan)[0];
    expect(page?.title).toBe('猫咪手册');
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0]).toEqual({
      type: 'quote',
      props: { icon: '🏷️' },
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '标签: 饲养, 健康' }] }],
      },
    });
    expect(page.blocks[1]?.type).toBe('paragraph');
    expect(plan.counts.degraded).toBe(1);
    expect(plan.warnings).toEqual([
      {
        path: 'note.md',
        what: 'front-matter tags',
        action: 'degraded',
        note: '标签 [饲养, 健康] 降级为页首 callout 块列标签',
      },
    ]);
  });

  it('tags 列表形态（- 逐行）同样识别', () => {
    const fs = memoryFs({ 'a.md': '---\ntags:\n  - x\n  - y\n---\nhi\n' });
    const plan = parseMdFile(fs, 'a.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    const callout = page.blocks[0];
    expect(callout?.type).toBe('quote');
    expect(JSON.stringify(callout?.content)).toContain('标签: x, y');
  });

  it('front-matter 缺项：无 title 用文件名，无 tags 无 callout 无 warning', () => {
    const fs = memoryFs({ ' readme .md': '# 手册\n\n内容\n' });
    const plan = parseMdFile(fs, ' readme .md');
    const page = pagesOf(plan)[0];
    expect(page?.title).toBe(' readme ');
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0]?.type).toBe('heading');
    expect(page.blocks[1]?.type).toBe('paragraph');
    expect(plan.warnings).toEqual([]);
    expect(plan.counts.degraded).toBe(0);
  });

  it('front-matter 未闭合 → 按普通正文处理（首行 --- 是 divider）', () => {
    const fs = memoryFs({ 'b.md': '---\nabc\n' });
    const plan = parseMdFile(fs, 'b.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks.map((block) => block.type)).toEqual(['divider', 'paragraph']);
    expect(page.title).toBe('b');
  });
});

describe('markdown：md-dir 目录递归建树', () => {
  it('嵌套目录 → parentPath 树，先序有序；rootName 进 source', () => {
    const fs = memoryFs({
      'root.md': '# 根页\n',
      'guide/intro.md': '---\ntitle: 指南\n---\n内容\n',
      'guide/deep/advanced.md': '# 进阶\n',
      'loose.md': '散页\n',
    });
    const plan = parseMdDir(fs, '我的知识库');
    expect(plan.source).toEqual({ kind: 'md-dir', rootName: '我的知识库' });

    const tree = pagesOf(plan).map((page) => ({
      path: page.path,
      title: page.title,
      parentPath: page.op === 'page' ? page.parentPath : null,
    }));
    expect(tree).toEqual([
      { path: 'loose.md', title: 'loose', parentPath: null },
      { path: 'root.md', title: 'root', parentPath: null },
      { path: 'guide/intro.md', title: '指南', parentPath: 'guide' },
      { path: 'guide/deep/advanced.md', title: 'advanced', parentPath: 'guide/deep' },
    ]);
    expect(plan.counts.pages).toBe(4);
  });
});

describe('markdown：附件双形态', () => {
  it('本地相对路径 → sha256 asset item + image 块重写 asset://', () => {
    const fs = memoryFs({
      'page.md': '![logo](assets/logo.png)\n',
      'assets/logo.png': PNG_BYTES,
    });
    const plan = parseMdFile(fs, 'page.md');
    const hash = sha256(PNG_BYTES);

    const assets = assetsOf(plan);
    expect(assets).toHaveLength(1);
    const asset = assets[0];
    expect(asset?.op === 'asset' && asset.hash).toBe(hash);
    expect(asset?.op === 'asset' && asset.ext).toBe('.png');
    expect(asset?.op === 'asset' && Array.from(asset.bytes)).toEqual(Array.from(PNG_BYTES));

    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toEqual([
      { type: 'image', props: { src: `asset://${hash}.png`, name: 'logo' }, content: null },
    ]);
    expect(plan.counts.assets).toBe(1);
  });

  it('同一附件多次引用 → asset 去重为单个 item', () => {
    const fs = memoryFs({
      'page.md': '![a](img/cat.png)\n\n![b](img/cat.png)\n',
      'img/cat.png': PNG_BYTES,
    });
    const plan = parseMdFile(fs, 'page.md');
    expect(plan.counts.assets).toBe(1);
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toHaveLength(2);
    const src0 = page.blocks[0]?.props['src'];
    const src1 = page.blocks[1]?.props['src'];
    expect(src0).toBe(src1);
    expect(src0).toBe(`asset://${sha256(PNG_BYTES)}.png`);
  });

  it('http 外链 → 保留 URL + degraded warning', () => {
    const fs = memoryFs({ 'web.md': '![pic](https://cdn.example.com/x.png)\n' });
    const plan = parseMdFile(fs, 'web.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toEqual([
      {
        type: 'image',
        props: { src: 'https://cdn.example.com/x.png', name: 'pic' },
        content: null,
      },
    ]);
    expect(plan.warnings).toEqual([
      {
        path: 'web.md',
        what: 'http 外链图片',
        action: 'degraded',
        note: '外链 https://cdn.example.com/x.png 保留 URL 原样（bookmark 化候选）',
      },
    ]);
    expect(assetsOf(plan)).toHaveLength(0);
  });

  it('附件缺失 → 不静默丢内容：src 原样保留 + warning', () => {
    const fs = memoryFs({ 'gap.md': '![ghost](missing.png)\n' });
    const plan = parseMdFile(fs, 'gap.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toEqual([
      { type: 'image', props: { src: 'missing.png', name: 'ghost' }, content: null },
    ]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]?.what).toBe('本地附件缺失');
  });

  it('围栏内的 ![]() 不当附件处理（原样进 code 块）', () => {
    const body = '```\n![fake](assets/x.png)\n```\n';
    const fs = memoryFs({ 'fenced.md': body });
    const plan = parseMdFile(fs, 'fenced.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toEqual([{ type: 'code', props: { lang: '' }, content: '![fake](assets/x.png)' }]);
    expect(assetsOf(plan)).toHaveLength(0);
  });
});

describe('markdown：GFM 表降级', () => {
  it('表格 → code 块原文 + degraded warning；围栏内不触发', () => {
    const table = [
      '| 名称 | 数量 |',
      '| --- | --- |',
      '| 猫粮 | 3 |',
      '| 逗猫棒 | 2 |',
    ].join('\n');
    const fs = memoryFs({ 'db.md': `前置段落\n\n${table}\n\n后置段落\n` });
    const plan = parseMdFile(fs, 'db.md');
    const page = pagesOf(plan)[0];
    if (page?.op !== 'page') {
      throw new Error('unreachable');
    }
    expect(page.blocks).toHaveLength(3);
    expect(page.blocks[0]?.type).toBe('paragraph');
    expect(page.blocks[1]).toEqual({
      type: 'code',
      props: { lang: '' },
      content: table,
    });
    expect(page.blocks[2]?.type).toBe('paragraph');
    expect(plan.warnings).toEqual([
      {
        path: 'db.md',
        what: 'GFM 表格',
        action: 'degraded',
        note: '表格（4 行）一期降级为 code 块原文',
      },
    ]);
    expect(plan.counts.degraded).toBe(1);
  });
});
