/**
 * headings.test.ts —— 大纲提取纯函数（IDEA-C）口径钉死。
 */
import { describe, expect, it } from 'vitest';
import { collectHeadings, type HeadingSource, type HeadingSourceNode } from '../src';

interface Fake {
  type: { name: string };
  attrs: Record<string, unknown>;
  textContent: string;
}

function docOf(nodes: readonly Fake[]): HeadingSource {
  return {
    forEach(cb: (node: HeadingSourceNode, offset: number, index: number) => void): void {
      for (const n of nodes) {
        cb(n, 0, 0);
      }
    },
  };
}

const heading = (id: string, level: number, text: string): Fake => ({
  type: { name: 'heading' },
  attrs: { id, level },
  textContent: text,
});
const para = (id: string, text: string): Fake => ({ type: { name: 'paragraph' }, attrs: { id }, textContent: text });

describe('collectHeadings', () => {
  it('只收 heading，顺序=文档顺序', () => {
    const got = collectHeadings(docOf([para('p1', '正文'), heading('h1', 1, '总览'), heading('h2', 2, '细节')]));
    expect(got).toEqual([
      { id: 'h1', level: 1, text: '总览' },
      { id: 'h2', level: 2, text: '细节' },
    ]);
  });

  it('空标题跳过；trim 后入库', () => {
    const got = collectHeadings(docOf([heading('a', 1, '   '), heading('b', 2, '  标题  ')]));
    expect(got).toEqual([{ id: 'b', level: 2, text: '标题' }]);
  });

  it('缺 id / 非字符串 id 跳过（没有跳转锚就不要列）', () => {
    expect(collectHeadings(docOf([
      { type: { name: 'heading' }, attrs: { level: 1 }, textContent: '无id' } as never,
      heading('ok', 1, '有id'),
    ]))).toEqual([{ id: 'ok', level: 1, text: '有id' }]);
  });

  it('level 夹到 1..3（脏属性不炸 UI）', () => {
    const got = collectHeadings(docOf([heading('a', 0, '零'), heading('b', 9, '九'), heading('c', 2.4, '二点四')]));
    expect(got.map((h) => h.level)).toEqual([1, 3, 2]);
  });

  it('空文档 → 空数组', () => {
    expect(collectHeadings(docOf([]))).toEqual([]);
  });
});
