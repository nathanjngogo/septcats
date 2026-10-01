/**
 * stats.test.ts —— 写作洞察纯函数（创意项 IDEA-B）的口径钉死。
 *
 * 数字口径全部来自实现注释：CJK 逐字 + 拉丁词 = words；分钟 = ceil(words/300) 且 ≥1；
 * 空文本 = null。这里不测组件——组件的 update→重算由 PageView 真机探针（idea-b）兜底。
 */
import { describe, expect, it } from 'vitest';
import { writingStats } from '../src';

describe('writingStats', () => {
  it('纯中文：逐字计数（标点也算 CJK 族）', () => {
    const s = writingStats('夜航船，一部奇书。');
    expect(s?.words).toBe(9);
    expect(s?.minutes).toBe(1);
  });

  it('纯英文：按词计数（空白/标点切分）', () => {
    expect(writingStats('the quick brown fox')?.words).toBe(4);
    expect(writingStats('a,b;c')?.words).toBe(3);
    expect(writingStats('2026 is here')?.words).toBe(3, '数字串算一词');
  });

  it('混合文本：CJK 逐字 + 拉丁词合并计数', () => {
    const s = writingStats('用 React 写笔记');
    expect(s?.words).toBe(5, '用/写/笔/记=4 字 + React=1 词');
  });

  it('阅读分钟：300 字/分钟向上取整、最少 1', () => {
    expect(writingStats('字'.repeat(300))?.minutes).toBe(1);
    expect(writingStats('字'.repeat(301))?.minutes).toBe(2);
    expect(writingStats('字'.repeat(950))?.minutes).toBe(4);
  });

  it('空/纯空白 → null（没有内容就没有洞察）', () => {
    expect(writingStats('')).toBeNull();
    expect(writingStats('   \n  ')).toBeNull();
  });

  it('chars = 码点数（emoji 算 1 字符；含空白）', () => {
    const s = writingStats('a😀 b');
    expect(s?.chars, '码点计数：emoji 算 1 字符').toBe(4);
    expect(s?.words, 'emoji 是分隔符 ⇒ a、b 两个词，emoji 本身不占词').toBe(2);
  });

  it('peek = 首个非空白片段 ≤12 字符', () => {
    expect(writingStats('  夜航船是一部奇书真的很长很长的标题')?.peek).toBe('夜航船是一部奇书真的很长');
    expect(writingStats('abc def')?.peek).toBe('abc def');
  });

  it('块边界换行切断拉丁词（两段首词不粘连）', () => {
    expect(writingStats('hello\nworld')?.words).toBe(2);
  });
});
