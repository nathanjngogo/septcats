/**
 * find.test.ts —— 页内查找纯函数口径（IDEA-D）。
 */
import { describe, expect, it } from 'vitest';
import { collectMatches, previewMatch, type FindSource, type FindSourceNode } from '../src';

function docOf(nodes: readonly FindSourceNode[]): FindSource {
  return {
    forEach(cb: (node: FindSourceNode, offset: number, index: number) => void): void {
      for (const n of nodes) {
        cb(n, 0, 0);
      }
    },
  };
}
const p = (id: string, text: string): FindSourceNode => ({ type: { name: 'paragraph' }, attrs: { id }, textContent: text });

describe('collectMatches', () => {
  it('大小写不敏感；命中块按文档顺序返回（含首次偏移）', () => {
    const got = collectMatches(docOf([p('a', 'The React Book'), p('b', '无关'), p('c', 'react 进阶')]), 'REACT');
    expect(got.map((m) => m.id)).toEqual(['a', 'c']);
    expect(got[0]?.hitAt).toBe(4);
  });

  it('空/纯空白查询 → []（没词不假装在工作）', () => {
    expect(collectMatches(docOf([p('a', 'x')]), '')).toEqual([]);
    expect(collectMatches(docOf([p('a', 'x')]), '   ')).toEqual([]);
  });

  it('无 id 块跳过（没有跳转锚就不是可选项）；无命中返回空', () => {
    const got = collectMatches(docOf([
      { type: { name: 'paragraph' }, attrs: {}, textContent: 'needle' },
      p('z', 'needle here'),
    ]), 'needle');
    expect(got.map((m) => m.id)).toEqual(['z']);
    expect(collectMatches(docOf([p('a', 'x')]), 'needle')).toEqual([]);
  });

  it('trim 查询词两侧空白', () => {
    expect(collectMatches(docOf([p('a', 'hello world')]), '  world  ').length).toBe(1);
  });
});

describe('previewMatch', () => {
  it('短文本原样；长文本以命中点开窗 + 省略号', () => {
    expect(previewMatch({ id: 'a', blockType: 'p', text: '短', hitAt: 0 })).toBe('短');
    const long = '前'.repeat(60) + '关键词' + '后'.repeat(60);
    const prev = previewMatch({ id: 'a', blockType: 'p', text: long, hitAt: 60 }, 40);
    expect(prev).toContain('关键词');
    expect(prev.startsWith('…')).toBe(true);
    expect(prev.endsWith('…')).toBe(true);
    expect([...prev], '40 内容 + 两个省略号').toHaveLength(42);
  });

  it('命中点靠近开头：无前导省略号（没掐前文就别装）', () => {
    const prev = previewMatch({ id: 'a', blockType: 'p', text: '关键词' + '尾'.repeat(60), hitAt: 0 }, 40);
    expect(prev.startsWith('关键词')).toBe(true);
  });
});
