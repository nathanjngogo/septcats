import { describe, expect, it } from 'vitest';
import { LamportClock, compareLamport, maxLamport } from '../src/index';
import { DEV_A, DEV_B } from './helpers';

describe('clock/LamportClock', () => {
  it('tick 单调递增', () => {
    const clock = new LamportClock(DEV_A, 0);
    expect(clock.value).toBe(0);

    const first = clock.tick();
    const second = clock.tick();
    const third = clock.tick();

    expect(first).toEqual({ c: 1, d: DEV_A });
    expect(second).toEqual({ c: 2, d: DEV_A });
    expect(third).toEqual({ c: 3, d: DEV_A });
    expect(compareLamport(first, second)).toBeLessThan(0);
    expect(compareLamport(second, third)).toBeLessThan(0);
    expect(clock.value).toBe(3);

    // 可指定初始计数
    expect(new LamportClock(DEV_A, 41).tick()).toEqual({ c: 42, d: DEV_A });
    // 非法初值退化为 0
    expect(new LamportClock(DEV_A, Number.NaN).value).toBe(0);
    expect(new LamportClock(DEV_A, -5).value).toBe(0);
  });

  it('witness 拉齐且不越过', () => {
    const clock = new LamportClock(DEV_A, 5);

    clock.witness({ c: 3, d: DEV_B });
    expect(clock.value).toBe(5); // 收到更低的值：不后退

    clock.witness({ c: 9, d: DEV_B });
    expect(clock.value).toBe(9); // 拉齐到 9

    // witness 本身不产生新值；下一次本地 tick 才 +1
    clock.witness({ c: 9, d: DEV_B });
    expect(clock.value).toBe(9);
    expect(clock.tick()).toEqual({ c: 10, d: DEV_A });

    // peek 不推进计数
    expect(clock.peek()).toEqual({ c: 10, d: DEV_A });
    expect(clock.value).toBe(10);
  });

  it('compareLamport 同 c 比 d', () => {
    expect(compareLamport({ c: 1, d: DEV_A }, { c: 2, d: DEV_A })).toBe(-1);
    expect(compareLamport({ c: 2, d: DEV_A }, { c: 1, d: DEV_B })).toBe(1);
    expect(compareLamport({ c: 3, d: DEV_A }, { c: 3, d: DEV_A })).toBe(0);
    expect(compareLamport({ c: 3, d: DEV_A }, { c: 3, d: DEV_B })).toBe(-1);
    expect(compareLamport({ c: 3, d: DEV_B }, { c: 3, d: DEV_A })).toBe(1);

    expect(maxLamport([])).toBeNull();
    expect(maxLamport([{ c: 1, d: DEV_B }, { c: 5, d: DEV_A }, { c: 5, d: DEV_B }])).toEqual({
      c: 5,
      d: DEV_B,
    });
  });
});
