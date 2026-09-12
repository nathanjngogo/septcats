import { describe, expect, it } from 'vitest';
import { ULID_LENGTH, isUlid, ulid, ulidTimestamp } from '../src/index';

const CROCKFORD_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// 让本文件内的时间戳单调递增，避免与 ulid 的全局单调状态相互干扰
let cursor = Date.now() + 1_000_000;
function nextTime(step = 1): number {
  cursor += step;
  return cursor;
}

describe('util/ulid', () => {
  it('长度 26 Crockford 字符集', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = ulid(nextTime());
      expect(id).toHaveLength(ULID_LENGTH);
      expect(id).toHaveLength(26);
      expect(CROCKFORD_RE.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it('单调递增（同毫秒内）', () => {
    const now = nextTime(1000);
    const ids: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      ids.push(ulid(now));
    }

    for (let i = 1; i < ids.length; i += 1) {
      const prev = ids[i - 1];
      const curr = ids[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr !== undefined && prev !== undefined && curr > prev).toBe(true);
    }

    // 同毫秒：时间戳部分完全一致
    for (const id of ids) {
      expect(ulidTimestamp(id)).toBe(now);
    }

    // 固定长度 + ASCII 单调字符集 => 字典序升序与生成顺序一致
    expect([...ids].sort()).toEqual(ids);
  });

  it('可解析回 timestamp', () => {
    for (const step of [1, 2, 1000, 999_999]) {
      const time = nextTime(step);
      const id = ulid(time);
      expect(ulidTimestamp(id)).toBe(time);
    }
  });

  it('非法输入被识别与拒绝', () => {
    expect(isUlid('')).toBe(false);
    expect(isUlid('short')).toBe(false);
    expect(isUlid('I'.repeat(26))).toBe(false); // I 不在 Crockford 集
    expect(isUlid('L'.repeat(26))).toBe(false);
    expect(isUlid('U'.repeat(26))).toBe(false);
    expect(isUlid('_'.repeat(26))).toBe(false);
    expect(isUlid(ulid(nextTime()).toLowerCase())).toBe(false); // 小写不是规范 ULID
    expect(() => ulidTimestamp('not-a-ulid')).toThrow(TypeError);
  });

  it('时间戳非法时被钳制且不破坏单调性', () => {
    const before = ulid(nextTime(10));

    // 非有限值回退到当前时间；因单调状态已在其之上，结果不得早于 before
    const nonFinite = ulid(Number.NaN);
    expect(isUlid(nonFinite)).toBe(true);
    expect(nonFinite > before).toBe(true);

    // 负数钳到 0；同样不得使单调状态回退
    const negative = ulid(-5);
    expect(isUlid(negative)).toBe(true);
    expect(negative > nonFinite).toBe(true);
  });
});
