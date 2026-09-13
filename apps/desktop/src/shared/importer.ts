/**
 * shared/importer.ts —— M12 导入器 IPC 契约类型（TASK-T11-01 §C-3）。
 *
 * main（importer.ts）/ preload（window.d.ts）/ renderer（ImportWizard）三侧共用。
 * 纯类型层：不含运行时逻辑；形状与 @septcats/importer 结构对齐但独立声明
 * （web tsconfig 无 node types，type-only import 也会把 node:crypto 拖进 renderer
 * 的编译程序——与 ImportPlanCounts 同一裁决，见报告 C）。
 */

/** 与 @septcats/importer 的 ImportWarning 结构对齐（§5：绝不静默）。 */
export interface ImportWarning {
  path: string;
  what: string;
  action: 'degraded' | 'skipped-duplicate' | 'failed';
  note: string;
}

/** import:plan 入参：三选一（zip 包 / 目录或单 md 文件 / 单 CSV）。 */
export interface ImportPlanInput {
  zipPath?: string | undefined;
  dirPath?: string | undefined;
  csvPath?: string | undefined;
}

/** 预览条目（plan 的 items 去掉 bytes 后的 IPC 形态）。 */
export type ImportPreviewItem =
  | { op: 'page'; path: string; title: string; parentPath: string | null; blockCount: number }
  | { op: 'collection'; path: string; title: string; parentPath: string | null; recordCount: number }
  | { op: 'asset'; hash: string; ext: string; size: number };

/** plan 的 counts（与 @septcats/importer 同构，此处独立声明避免 IPC 层拖 zod 运行时）。 */
export interface ImportPlanCounts {
  pages: number;
  collections: number;
  records: number;
  assets: number;
  skippedDuplicate: number;
  degraded: number;
}

/** 预览 items 截断上限（任务书 §C-0.3：items 截前 50 + total）。 */
export const PREVIEW_ITEM_LIMIT = 50;

/** plan 的预览（完整计划留在 main 内存，TTL 30 分钟）。 */
export interface ImportPlanPreview {
  planId: string;
  source: { kind: string; rootName: string };
  /** 截前 PREVIEW_ITEM_LIMIT 条（bytes/块载荷已剥除）；全量见 totalItems。 */
  items: ImportPreviewItem[];
  /** 计划条目总数（= items 全量长度）。 */
  totalItems: number;
  counts: ImportPlanCounts;
  warnings: ImportWarning[];
}

/** import:execute 入参：confirm 必须显式为 true（警告不藏，二次确认）。 */
export interface ImportExecuteInput {
  planId: string;
  confirm: true;
}

/** 执行进度（import:progress 出参；执行中轮询）。 */
export interface ImportProgress {
  planId: string;
  status: 'ready' | 'executing' | 'done' | 'failed' | 'cancelled';
  done: number;
  total: number;
  failedAt: number | null;
}

/** import:execute 出参：报告（结果页全文展示）。失败不自动回滚（upsert 幂等，重跑续）。 */
export interface ImportReport {
  planId: string;
  status: 'done' | 'failed' | 'cancelled';
  /** 已成功条目数（含此前断点已完成的部分）。 */
  done: number;
  total: number;
  /** 失败条目下标（items 序）；断点续传 = 从该条重跑。 */
  failedAt: number | null;
  error: string | null;
  /** 累计提交的 op 数 / batch 数（对账断言用）。 */
  opCount: number;
  batchCount: number;
  counts: ImportPlanCounts;
}
