/**
 * shared/pageExport.ts —— 页面导出（R27 · TASK-T79-01）**纯类型契约**（main / preload /
 * renderer 三侧共用单一来源）。实现住 `main/pageExport.ts`（那里只 import 本文件的类型，
 * 不反向依赖）——renderer 侧 `types/window.d.ts` 若直接 import main 实现会把 `node:fs`
 * 拉进 web tsconfig，故契约定在 shared（与 shared/importer.ts / shared/settings.ts 同款）。
 */

/** 导出范围：本页 / 含子页（子树）。 */
export type PageExportScope = 'single' | 'subtree';

export interface PageExportInput {
  readonly pageId: string;
  readonly scope: PageExportScope;
  /** confirm 的目标父目录；缺省 = 走系统目录选择（取消 = 零落盘）。 */
  readonly dir?: string;
}

export interface PageExportPagePreview {
  readonly pageId: string;
  readonly title: string;
  /** 包内相对路径（POSIX '/'），如 `根页/子页.md`。 */
  readonly relPath: string;
  readonly blockCount: number;
  /** 孤儿附件（file_id 无对应磁盘文件）→ md 已留占位注释。 */
  readonly orphans: readonly string[];
}

export interface PageExportFilePreview {
  readonly relPath: string;
  readonly kind: 'markdown' | 'asset';
  readonly bytes: number;
}

export interface PageExportPreview {
  /** 包目录名 = 根页标题（已净化文件名）。 */
  readonly rootName: string;
  readonly pages: readonly PageExportPagePreview[];
  readonly files: readonly PageExportFilePreview[];
  readonly counts: {
    readonly pages: number;
    readonly markdown: number;
    readonly assets: number;
    readonly orphans: number;
  };
  readonly totalBytes: number;
}

export interface PageExportConfirmResult extends PageExportPreview {
  readonly canceled: false;
  /** 实际写入的包目录绝对路径（`<dir>/<rootName>`）。 */
  readonly dir: string;
}

export interface PageExportCanceled {
  readonly canceled: true;
}

export type PageExportConfirmResponse = PageExportConfirmResult | PageExportCanceled;
