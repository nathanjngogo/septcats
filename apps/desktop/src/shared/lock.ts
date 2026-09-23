/**
 * shared/lock.ts —— 页面密码锁 IPC 载荷形状（main / preload / renderer 三侧共用）。
 *
 * 通道名见 shared/ipc.ts 的 LOCK_CHANNELS。错误码稳定（main/lock.ts 的 LockApiError.code），
 * 经 main/index.ts 的失败映射后以 `code: message` 形态回到渲染器（不泄露异常栈）。
 */

export type LockErrorCode = 'E_LOCK_NOT_SET' | 'E_LOCK_BADPASS' | 'E_LOCK_LOCKED' | 'E_LOCK_RECOVERY_USED';

export interface LockStatus {
  /** 页面是否设有口令（页面属性）——搜索徽标/侧栏锁 glyph 用此位。 */
  readonly locked: boolean;
  /**
   * 会话内是否已解锁（verify/recover 后主进程 session 持有本页 DK）。
   * UI 门控必须用 `locked && unlockedInSession !== true`，否则解锁后重探会立刻弹回锁屏卡。
   */
  readonly unlockedInSession?: boolean;
  readonly failures: number;
  readonly lockedUntil: number | null;
}

export interface LockGetStatusInput {
  readonly pageId: string;
}

export interface LockSetPassInput {
  readonly pageId: string;
  readonly pass: string;
}

export interface LockSetPassResult {
  readonly recoveryCode: string;
}

export interface LockVerifyInput {
  readonly pageId: string;
  readonly pass: string;
}

export interface LockRecoverInput {
  readonly pageId: string;
  readonly code: string;
  readonly newPass: string;
}

export interface LockRecoverResult {
  readonly ok: true;
  readonly recoveryCode: string;
}

export interface LockChangePassInput {
  readonly pageId: string;
  readonly oldPass: string;
  readonly newPass: string;
}

export interface LockRemoveInput {
  readonly pageId: string;
  readonly pass: string;
}

export interface LockOkResult {
  readonly ok: true;
}
