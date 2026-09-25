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
