/**
 * shared/assetGc.ts —— 附件孤儿回收（T83-02）的**纯类型契约**。
 *
 * main / preload / renderer 三侧共用单一来源（与 shared/dbgc.ts 同款）：实现住
 * `main/assetGc.ts`（只 import 本文件类型，不反向依赖），renderer 侧 `types/window.d.ts`
 * 若直接 import main 实现会把 `node:*` 拖进 web tsconfig。
 *
 * 交互形状沿用 T81-01：**preview 只回条数/预估字节（零写）→ run 才真删**，取消 = 零写。
 * 判定纯逻辑在 `@septcats/sync` 的 planAssetGc（先算清单，绝不先删）。
 */

/**
 * 不放行原因（与 `@septcats/sync` 的 AssetGcHoldReason 逐字面量同构；此处独立声明
 * 是为了 renderer 侧不 import packages/sync）。
 */
export type AssetGcHoldReason =
  /** 文件名哈希仍被库里某行引用（含墓碑页引用、扩展名变体命中）。 */
  | 'referenced'
  /** 库里有密文块（锁页）→ 明文扫描失明 → 一律扣留。 */
  | 'blind'
  /** 文件名不是内容寻址形态（无法判归属）→ 保守扣留。 */
  | 'unknown'
  /** mtime 在保护期内 → 本次扣留。 */
  | 'recent';

/** 按原因计数的扣留统计（四个键恒在，缺省 0）。 */
export type AssetGcHeldCounts = Record<AssetGcHoldReason, number>;

/** dry-run 预览：只读，零写。 */
export interface AssetGcPreview {
  /** 附件目录里的文件总数。 */
  readonly candidates: number;
  /** 放行（可物理删除）的文件数。 */
  readonly deletable: number;
  /** 扣留的文件数。 */
  readonly held: number;
  readonly heldByReason: AssetGcHeldCounts;
  /** 预计释放字节（放行文件的 size 之和）。 */
  readonly estimatedBytes: number;
  /** 扫到的**不同**引用哈希数（对账口径提示，非文件数）。 */
  readonly referencedHashes: number;
  /**
   * 引用面是否完整可枚举。false = 库里有锁页密文块 → 未命中引用的文件一律扣留
   * （UI 据此提示「本次不回收」的原因）。
   */
  readonly referencesComplete: boolean;
  /** 本次判定采用的保护期天数（UI 说明用）。 */
  readonly retentionDays: number;
}

/** 确认执行的结果（真删计划内文件；逐文件 rename→remove）。 */
export interface AssetGcRunResult {
  /** 实际删除的文件数。 */
  readonly deletedFiles: number;
  /** 释放字节（实际删除文件的 size 之和）。 */
  readonly bytesFreed: number;
  /** 删除失败（rename/remove 报错且已回滚）的文件数——仍在盘上，未计入 deletedFiles。 */
  readonly failed: number;
  /** 本次未放行的文件数（执行后重算）。 */
  readonly held: number;
  readonly heldByReason: AssetGcHeldCounts;
}
