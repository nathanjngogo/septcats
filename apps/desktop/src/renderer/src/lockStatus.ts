/**
 * lockStatus.ts —— 锁状态视图类型（T67-01-B2-01 范围2）。
 *
 * 与 `window.septcats.lock.getStatus` 返回形态一致；renderer 内（PageView / PageLockScreen
 * 传递）复用，避免重复内联结构。
 */
export interface LockStatusView {
  readonly locked: boolean;
  readonly failures: number;
  readonly lockedUntil: number | null;
}
