/**
 * shared/dbgc.ts —— DB 面墓碑物理清除（T81-01）的**纯类型契约**。
 *
 * main / preload / renderer 三侧共用单一来源（与 shared/portable.ts 同款）：
 * 实现住 `main/dbgc.ts`（只 import 本文件类型，不反向依赖），
 * renderer 侧 `types/window.d.ts` 若直接 import main 实现会把 `node:*` 拖进 web tsconfig。
 *
 * 交互形状沿用 R27/R28 纪律：**preview 只回条数/预估字节（零写）→ run 才真删**，
 * 取消 = 零写。判定纯逻辑在 `@septcats/sync` 的 planDbGc（先算清单，绝不先删）。
 */

/**
 * 不放行原因（与 `@septcats/sync` 的 DbGcHoldReason 逐字面量同构；此处独立声明
 * 是为了 renderer 侧不 import packages/sync）。
 * 注：favorite/recent 等本地派生态**不是**原因——它们对墓碑不可见且无取消入口，
 * 作扣留理由会让「彻底删除」永不完成，故一律随页级联清除。
 */
export type DbGcHoldReason =
  | 'unreachable'
  | 'retention'
  | 'locked'
  | 'has-children';

/** 按原因计数的扣留统计（四个键恒在，缺省 0）。 */
export type DbGcHeldCounts = Record<DbGcHoldReason, number>;

/** dry-run 预览：只读，零写。 */
export interface DbGcPreview {
  /** 扫到的墓碑行总数（page.alive=0）。 */
  readonly candidates: number;
  /** 放行（可物理删除）的页面数。 */
  readonly deletable: number;
  /** 扣留的页面数。 */
  readonly held: number;
  readonly heldByReason: DbGcHeldCounts;
  /** 预计删除的块行数（按被放行页聚合）。 */
  readonly estimatedBlocks: number;
  /** 预计释放字节（块正文/props 文本长度之和，粗略量级提示）。 */
  readonly estimatedBytes: number;
  /** 本次判定采用的回收站保留天数（UI 说明用）。 */
  readonly retentionDays: number;
}

/** 确认执行的结果（真删；同事务分批）。 */
export interface DbGcRunResult {
  /** 实际删除的页面行数（dbgc.deletePage 的 changes 之和）。 */
  readonly deletedPages: number;
  /** 实际删除的块行数（dbgc.deleteBlocks 的 changes 之和）。 */
  readonly deletedBlocks: number;
  /** 释放字节（按计划内页面的块文本长度估算）。 */
  readonly bytesFreed: number;
  /** 实际事务批次数（每批 ≤ 上限页面数）。 */
  readonly batches: number;
  /** 本次未放行的页面数（执行后重算）。 */
  readonly held: number;
  readonly heldByReason: DbGcHeldCounts;
}
