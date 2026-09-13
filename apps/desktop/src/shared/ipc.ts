/**
 * shared/ipc.ts —— IPC 通道名的单一来源（main / preload / renderer 三侧共用）。
 *
 * T5 只做「占位 + 防漂移」：blocks 通道常量在这里定名，**main 侧暂不实现**
 * （T6 接 db IPC）；renderer 的 PageView 走本地内存 memorySession，不调这些通道。
 * 通道命名规则：`<域>:<动作>`，动作与 Op 语义对齐（commit 一次编辑轮次 = 一批 Op）。
 */

export const CHANNEL_PING = 'app:ping';
export const CHANNEL_META = 'app:meta';

/** 一次编辑轮次：op_ledger.insert × N + 物化 upsert/patch × M，DbServer 同事务（计划书 §8.1）。 */
export const CHANNEL_BLOCKS_COMMIT = 'blocks:commit';
/** 读一页的块（含 tombstone 过滤由查询层决定）。 */
export const CHANNEL_BLOCKS_LIST = 'blocks:list';
/** 订阅远端/其它窗口的块变更推送。 */
export const CHANNEL_BLOCKS_CHANGED = 'blocks:changed';

export const BLOCKS_CHANNELS = {
  commit: CHANNEL_BLOCKS_COMMIT,
  list: CHANNEL_BLOCKS_LIST,
  changed: CHANNEL_BLOCKS_CHANGED,
} as const;

export type BlocksChannel = (typeof BLOCKS_CHANNELS)[keyof typeof BLOCKS_CHANNELS];
