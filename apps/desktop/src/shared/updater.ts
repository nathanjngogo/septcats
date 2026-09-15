/**
 * shared/updater.ts —— 自动更新 IPC 契约（M10-B · TASK-T12-01B §0.4/§1）。
 *
 * 纯协议层：通道名 + UpdateState 形状 + zod schema（main 产出 / renderer 消费 /
 * 测试断言三侧共用，单一来源）。不 import electron / node。
 *
 * 状态机（任务书 §0.4）：
 *   idle → checking → available(downloading → downloaded) / not-available / error
 * update:state 为主→渲染推送通道，payload 恒为 UpdateState。
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// 通道（五通道）—— 定义在 shared/ipc.ts（全仓通道名单一来源，零依赖）。
// 本文件只放 zod schema（带运行时）：main 与测试从这里取；
// **preload 严禁 import 本文件**（会把 zod 打进 sandboxed preload → 加载崩），
// 通道名一律 import 自 shared/ipc.ts。真机踩实：module not found: zod。
// ---------------------------------------------------------------------------

export {
  CHANNEL_UPDATE_CHECK,
  CHANNEL_UPDATE_STATE,
  CHANNEL_UPDATE_DOWNLOAD,
  CHANNEL_UPDATE_INSTALL,
  CHANNEL_UPDATE_ROLLBACK_HINT,
  UPDATE_CHANNELS,
  type UpdateChannel,
} from './ipc';

// ---------------------------------------------------------------------------
// UpdateState（状态机对外形状；zod schema 为单一来源，类型由 infer 派生）
// ---------------------------------------------------------------------------

export const updateStatusSchema = z.enum([
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'not-available',
  'error',
]);

export const updateStateSchema = z.object({
  status: updateStatusSchema,
  /** available/downloading/downloaded 时的目标版本号。 */
  version: z.string().min(1).optional(),
  /** downloading 时的下载进度（0-100，含小数）。 */
  progress: z.number().min(0).max(100).optional(),
  /** error 时的机器可读错误码（E_FEED_SIGNATURE / E_FEED_SOURCE_DENIED / E_UPDATE_FAILED / E_UPDATE_UNAVAILABLE / E_MALFORMED）。 */
  errorCode: z.string().min(1).optional(),
  /** error 时的人类可读补充（可展示）。 */
  message: z.string().min(1).optional(),
});

export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type UpdateState = z.infer<typeof updateStateSchema>;

/** update:install 的入参（confirm 必须显式 true，main 侧再兜底校验）。 */
export interface UpdateInstallInput {
  confirm: true;
}

/** update:rollbackHint 的返回：当前状态 + 提示文案（renderer 透出，main 已同时记日志）。 */
export interface UpdateRollbackHint {
  state: UpdateState;
  hint: string;
}
