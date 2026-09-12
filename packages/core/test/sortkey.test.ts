import { describe, expect, it } from 'vitest';
import {
  InvalidSortRange,
  SORTKEY_INITIAL,
  SORTKEY_MAX,
  SORTKEY_MAX_LENGTH,
  SORTKEY_MIN,
  sortBetween,
  sortSequence,
} from '../src/index';
import { mulberry32 } from './helpers';

describe('sortkey', () => {
  it('between(null,null)=INITIAL', () => {
    expect(sortBetween(null, null)).toBe(SORTKEY_INITIAL);
    expect(SORTKEY_INITIAL).toBe('A00000000');
    expect(SORTKEY_MIN).toBe('0');
    expect(SORTKEY_MAX).toBe('z');
    expect(SORTKEY_MIN < SORTKEY_INITIAL).toBe(true);
    expect(SORTKEY_INITIAL < SORTKEY_MAX).toBe(true);
  });

  it('1000 次随机 between 保持有序且长度<=16', () => {
    const rng = mulberry32(0x5eed1);
    // 骨架序列留出充分间隔，再在随机相邻对之间插入 1000 次（模拟拖拽排序）
    const list: string[] = sortSequence(256);

    let rebalances = 0;
    for (let i = 0; i < 1000; i += 1) {
      const index = 1 + Math.floor(rng() * (list.length - 1));
      const lower = list[index - 1];
      const upper = list[index];
      if (lower === undefined || upper === undefined) {
        throw new Error('测试构造错误：索引越界');
      }

      let key: string;
      try {
        key = sortBetween(lower, upper);
      } catch (error) {
        // LexoRank 固有特性：相邻键密集到极限时区间无解（如 '0' 与 '00'）。
        // 应用层的既定策略是整体重平衡（重建等间隔序列），这里如实模拟。
        if (!(error instanceof InvalidSortRange)) {
          throw error;
        }
        rebalances += 1;
        const rebuilt = sortSequence(list.length);
        list.length = 0;
        list.push(...rebuilt);
        continue;
      }
      expect(key.length).toBeLessThanOrEqual(SORTKEY_MAX_LENGTH);
      expect(key > lower).toBe(true);
      expect(key < upper).toBe(true);
      list.splice(index, 0, key);
    }
    // 1000 次插入内重平衡应极少发生（验证键空间足够宽松）
    expect(rebalances).toBeLessThanOrEqual(2);

    // 整体仍严格递增
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const curr = list[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(prev !== undefined && curr !== undefined && prev < curr).toBe(true);
    }
  });

  it('等值相邻触发加长', () => {
    const between = sortBetween('A', 'B');
    expect(between.length).toBeGreaterThan(1);
    expect('A' < between).toBe(true);
    expect(between < 'B').toBe(true);

    // 相邻两位数字无法在本位取中，必须向低位加长
    const tight = sortBetween('A00000000', 'A00000001');
    expect(tight.length).toBeGreaterThan('A00000000'.length);
    expect(tight > 'A00000000').toBe(true);
    expect(tight < 'A00000001').toBe(true);

    // 前缀关系：b 以 a 为前缀时仍能插入（'A' < 'A0' < 'A00000001'）
    const prefix = sortBetween('A', 'A00000001');
    expect(prefix > 'A').toBe(true);
    expect(prefix < 'A00000001').toBe(true);

    // 相邻键之间无解：'A' 与 'A0' 之间不存在任何字符串
    expect(() => sortBetween('A', 'A0')).toThrow(InvalidSortRange);
  });

  it('非法区间 throw', () => {
    expect(() => sortBetween('B', 'A')).toThrow(InvalidSortRange);
    expect(() => sortBetween('A', 'A')).toThrow(InvalidSortRange);
    expect(() => sortBetween('A00', 'A0')).toThrow(InvalidSortRange);
    // 非 base62 字符
    expect(() => sortBetween('a b', null)).toThrow(InvalidSortRange);
    expect(() => sortBetween(null, 'A-1')).toThrow(InvalidSortRange);
    // 空字符串不是合法键
    expect(() => sortBetween('', null)).toThrow(InvalidSortRange);
    // '0' 之下无解
    expect(() => sortBetween(null, '0')).toThrow(InvalidSortRange);
  });

  it('sortSequence 连续递增且长度受限', () => {
    expect(sortSequence(0)).toEqual([]);
    expect(sortSequence(1)).toEqual([SORTKEY_INITIAL]);

    const seq = sortSequence(500);
    expect(seq).toHaveLength(500);
    for (let i = 1; i < seq.length; i += 1) {
      const prev = seq[i - 1];
      const curr = seq[i];
      expect(prev !== undefined && curr !== undefined && prev < curr).toBe(true);
    }
    for (const key of seq) {
      expect(key.length).toBeLessThanOrEqual(SORTKEY_MAX_LENGTH);
    }
  });

  it('首尾开区间也能生成', () => {
    const beforeMax = sortBetween(null, SORTKEY_MAX);
    expect(beforeMax < SORTKEY_MAX).toBe(true);

    const afterMin = sortBetween(SORTKEY_MIN, null);
    expect(afterMin > SORTKEY_MIN).toBe(true);

    const huge = sortBetween(SORTKEY_INITIAL, null);
    expect(huge > SORTKEY_INITIAL).toBe(true);
  });
});
