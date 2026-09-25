/**
 * shared/portable.ts —— 便携包导出（R28 · TASK-T80-01）**纯类型契约**（main /
 * preload / renderer 三侧共用单一来源）。实现住 `main/portable.ts`（那里只 import
 * 本文件的类型，不反向依赖）——renderer 侧 `types/window.d.ts` 若直接 import main
 * 实现会把 `node:fs` 拉进 web tsconfig，故契约定在 shared（与 shared/pageExport.ts
 * / shared/importer.ts 同款）。
 *
 * 交互形状照 R27 的 `pageExport`：**preview 只回清单不落盘 → confirm（dir 显式）
 * 落盘 → 取消 = 零落盘**。
 */

/** 包内条目种类（与 `packages/sync/src/portableZip.ts` 的 PortableEntryKind 同字面量）。 */
export type PortableEntryKind = 'manifest' | 'db' | 'segment' | 'attachment';

export interface PortableExportInput {
  /** confirm 的目标目录；缺省 = 走系统目录选择（取消 = 零落盘）。 */
  readonly dir?: string;
}

export interface PortableExportFilePreview {
  /** 包内相对路径（POSIX '/'），如 `sync/seg-00000001-dev1-000001-ab12cd34.jsonl`。 */
  readonly relPath: string;
  readonly kind: PortableEntryKind;
  readonly bytes: number;
}

export interface PortableExportPreview {
  /** 归档文件名（`septcats-portable-<库 slug>-<时间戳>.zip`；重名加序号）。 */
  readonly fileName: string;
  readonly files: readonly PortableExportFilePreview[];
  readonly counts: {
    /** 段文件数（导入侧重放的入口条数）。 */
    readonly segments: number;
    readonly attachments: number;
    readonly db: number;
    readonly entries: number;
  };
  readonly totalBytes: number;
  /** 非阻断提示（如同步未启用 → 段清单为空）。 */
  readonly warnings: readonly string[];
}

export interface PortableExportConfirmResult extends PortableExportPreview {
  readonly canceled: false;
  /** 实际写入的 zip 绝对路径。 */
  readonly path: string;
  /** 落盘目录（= confirm 传入/选定的 dir）。 */
  readonly dir: string;
  /** 落盘后被去重/加序号改名时为 true（fileName 已是最终名）。 */
  readonly renamed: boolean;
}

export interface PortableExportCanceled {
  readonly canceled: true;
}

export type PortableExportConfirmResponse = PortableExportConfirmResult | PortableExportCanceled;

// ---------------------------------------------------------------------------
// 便携包导入（R28 · TASK-T80-02）
//
// 形状照导出侧：**plan 只读（清点/验签/预检，零落盘）→ execute（confirm:true
// 才落库，三段式换库）→ 取消 = 零落盘**。选包三条路（与导出「dir 显式」同形）：
// `zipPath` 显式 > `dir` 显式（目录内取最新 `septcats-portable-*.zip`）>
// 注入的系统文件对话框（取消回 `{canceled:true}`）。
// ---------------------------------------------------------------------------

export interface PortableImportInput {
  /** 显式包路径（最高优先；命令行 `--import-portable` 与 UI 二次调用走它）。 */
  readonly zipPath?: string;
  /**
   * 显式目录契约（与导出侧 `dir` 同形）：在该目录内取**最新**一个
   * `septcats-portable-*.zip`（名字含时间戳，字典序即时间序，确定性可测）。
   */
  readonly dir?: string;
}

/** 包内清单摘要（只回显给用户核对的字段，不含完整 checksums 表）。 */
export interface PortableImportManifestSummary {
  readonly library: string;
  readonly appVersion: string;
  readonly createdAt: number;
  readonly segments: number;
  readonly attachments: number;
  readonly warnings: readonly string[];
}

/** 结构化预检阻断项（plan 已拦下，execute 复检同一判据）。 */
export interface PortableImportBlock {
  readonly code: string;
  readonly message: string;
}

export interface PortableImportPlan {
  /** 实际待导入的包绝对路径（dir 契约解析后的结果）。 */
  readonly zipPath: string;
  readonly manifest: PortableImportManifestSummary;
  readonly counts: {
    readonly segments: number;
    readonly attachments: number;
    readonly db: number;
    readonly entries: number;
  };
  /** 将占用字节（包内条目声明总字节，即重放后库的数据量级提示）。 */
  readonly bytes: number;
  /** 包内 schema 版本 vs 当前库 schema 版本（包 ≤ 当前才可导入）。 */
  readonly schema: {
    readonly package: number;
    readonly current: number;
    readonly compatible: boolean;
  };
  /** 目标库现状：账本 op 数与「包未覆盖」的本机 op 数（覆盖度判据，见报告 §0-③）。 */
  readonly target: {
    readonly ledgerOps: number;
    readonly uncovered: number;
    readonly willReplace: boolean;
  };
  /** 非阻断提示（如包内段清单为空）。 */
  readonly warnings: readonly string[];
  /** 预检阻断（非空即 execute 会被拒，UI 据此禁用「确认导入」）。 */
  readonly blocked: PortableImportBlock | null;
}

export interface PortableImportResult {
  readonly ok: true;
  readonly zipPath: string;
  /** 本次导入前备份的三件套首文件（`<db>.bak-portable-<stamp>`），撤销入口消费它。 */
  readonly backupPath: string;
  /** 实际写入的备份文件（主库 + 存在的 sidecar）。 */
  readonly backupFiles: readonly string[];
  readonly replay: {
    readonly segments: number;
    readonly ops: number;
    readonly entities: number;
    /** 恒 'replace'（显式传入，禁依赖 T82-01 的缺省 merge）。 */
    readonly mode: 'replace';
    readonly keptOps: number;
  };
}

export interface PortableImportCanceled {
  readonly canceled: true;
}

export type PortableImportPlanResponse = PortableImportPlan | PortableImportCanceled;
export type PortableImportExecuteResponse = PortableImportResult | PortableImportCanceled;

export interface PortableImportRevertInput {
  /** 要还原回去的备份（三件套首文件路径）。 */
  readonly backupPath: string;
  readonly confirm: true;
}

export interface PortableImportRevertResult {
  readonly ok: true;
  readonly backupPath: string;
  readonly restoredFiles: readonly string[];
}
