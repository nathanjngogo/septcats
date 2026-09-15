/**
 * shared/sync.ts —— 同步状态的线上契约（TASK-T13-01 §1/§3）。
 *
 * 纯协议层：只描述形状，不 import electron / node / @septcats/*。
 * main（SyncRuntime 产出）、preload、renderer（07 同步状态面板）三侧共用。
 */

/** 同步状态机五态（07 屏顶栏状态钮逐态对应）。 */
export type SyncRuntimeState = 'idle' | 'syncing' | 'ok' | 'degraded' | 'error';

/** 一条最近错误（稳定 code 供 UI 分支；message 已是中文人话）。 */
export interface SyncErrorEntry {
  code: string;
  message: string;
  at: number;
}

/** manifest 设备表的渲染器投影。 */
export interface SyncDeviceEntry {
  actorId: string;
  lastLamport: number;
  lastSeenAt: number;
  clientVer: string;
}

/** sync:status / sync:state 的统一载荷。 */
export interface SyncStatusSnapshot {
  state: SyncRuntimeState;
  /** 同步是否启用（关闭时 state=idle）。 */
  enabled: boolean;
  /** 上一轮成功完成（含应用/去重/无变化）的时间戳；从未成功为 null。 */
  lastSyncAt: number | null;
  /** 设备列表（actorId + Lamport 水位）。 */
  devices: SyncDeviceEntry[];
  /** 攒段器中尚未发布的 op 数。 */
  pendingOps: number;
  /** 等待重试发布的段数（发布失败暂存，下一轮重试）。 */
  pendingSegs: number;
  /** 累计观测到的 LWW 冲突数（conflict 报告素材）。 */
  conflicts: number;
  /** 最近错误（时间升序，最多 10 条）。 */
  errors: SyncErrorEntry[];
}
