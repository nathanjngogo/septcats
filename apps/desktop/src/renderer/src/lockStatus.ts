/**
 * lockStatus.ts —— 锁状态视图类型（T67-01-B2-01 范围2）。
 *
 * 与 `window.septcats.lock.getStatus` 返回形态一致；renderer 内（PageView / PageLockScreen
 * 传递）复用，避免重复内联结构。
 */
export interface LockStatusView {
  /** 页面是否设有口令（页面属性）——搜索结果徽标/侧栏锁 glyph 用此位。 */
  readonly locked: boolean;
  /** 会话内已解锁；UI 门控用 `locked && unlockedInSession !== true`（缺省视为未解锁）。 */
  readonly unlockedInSession?: boolean;
  readonly failures: number;
  readonly lockedUntil: number | null;
}
