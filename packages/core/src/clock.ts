import type { ActorId, Lamport } from './op';

/**
 * Lamport 逻辑时钟。
 *
 * 规则（任务书 §3）：
 * - `tick()`：本地事件，c+1，返回新值；
 * - `witness(other)`：收到远端事件，own = max(own, other.c)，不发新值；
 * - 排序：先比 c（小者在前），同 c 比 d（字符串字典序）。
 */
export class LamportClock {
  private counter: number;
  private readonly deviceId: ActorId;

  constructor(deviceId: ActorId, initialC = 0) {
    this.deviceId = deviceId;
    this.counter = Number.isFinite(initialC) ? Math.max(0, Math.trunc(initialC)) : 0;
  }

  /** 本地事件：自增并返回当前 Lamport 值。 */
  tick(): Lamport {
    this.counter += 1;
    return { c: this.counter, d: this.deviceId };
  }

  /** 观测到远端事件：把本地计数拉到不低于对方，但不产生新值。 */
  witness(other: Lamport): void {
    if (other.c > this.counter) {
      this.counter = other.c;
    }
  }

  /** 当前计数值（不含设备维度）。 */
  get value(): number {
    return this.counter;
  }

  /** 当前设备标识。 */
  get device(): ActorId {
    return this.deviceId;
  }

  /** 生成一个“不推进本地计数”的 Lamport（用于只读快照场景）。 */
  peek(): Lamport {
    return { c: this.counter, d: this.deviceId };
  }
}

/** Lamport 升序比较：c 小者在前，同 c 时按 d 的字典序。返回 -1 / 0 / 1。 */
export function compareLamport(a: Lamport, b: Lamport): number {
  if (a.c !== b.c) {
    return a.c < b.c ? -1 : 1;
  }
  if (a.d === b.d) {
    return 0;
  }
  return a.d < b.d ? -1 : 1;
}

/** 在 Lamport 数组里取最大值（空数组返回 null）。 */
export function maxLamport(values: readonly Lamport[]): Lamport | null {
  let best: Lamport | null = null;
  for (const value of values) {
    if (best === null || compareLamport(value, best) > 0) {
      best = value;
    }
  }
  return best;
}
