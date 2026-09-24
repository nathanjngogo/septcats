/**
 * pageExport.ts —— 主进程「页面导出 Markdown + 附件」服务（TASK-T79-01 §B）。
 *
 * 数据流（**对库与媒体全只读**）：`page.listAll`（活页）→ `block.listByPage` 逐页读块
 * → 编辑器形态块适配为 importer canonical（image：`file_id`+磁盘 ext → `asset://<hash><ext>`）
 * → `@septcats/importer` 的 `blocksToMarkdown` 渲染 md → 附件**拷贝**进包内 `files/`。
 * 本文件不造 Op、不 commit、不建表；媒体只 `readFileSync` 源、写包内（拷贝非移动）。
 *
 * 交互对齐 `diag:export`（报告 §0-②）：**先预览（列文件名/孤儿，不落盘）→ 用户确认
 * （选目标目录）→ 写盘**；目录选择取消 = **零落盘**。形态选「落目录」而非 zip
 * （报告 §0-② 选型：零新增依赖 + 与 reveal 天然契合）。
 *
 * 纪律：不 import electron（系统对话框/打开目录经 DI 注入），vitest 纯 Node 直测。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { blocksToMarkdown } from '@septcats/importer';
import type { BlockSpec } from '@septcats/editor';
import { CHANNEL_PAGE_EXPORT_CONFIRM, CHANNEL_PAGE_EXPORT_PREVIEW, CHANNEL_PAGE_EXPORT_REVEAL } from '../shared/ipc';
import type {
  PageExportConfirmResponse,
  PageExportFilePreview,
  PageExportInput,
  PageExportPreview,
  PageExportScope,
} from '../shared/pageExport';
import { blockContentOf } from './blocks';
import { PagesApiError, type StatementExecutor } from './pages';

// 契约类型单一来源在 shared/pageExport.ts（renderer 侧直接 import 该文件，不引本实现）
export type {
  PageExportCanceled,
  PageExportConfirmResponse,
  PageExportConfirmResult,
  PageExportFilePreview,
  PageExportInput,
  PageExportPagePreview,
  PageExportPreview,
  PageExportScope,
} from '../shared/pageExport';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形）
// ---------------------------------------------------------------------------

export type PageExportErrorCode = 'E_MALFORMED' | 'E_NOT_FOUND' | 'E_INVARIANT';

export class PageExportApiError extends Error {
  readonly code: PageExportErrorCode;

  constructor(code: PageExportErrorCode, message: string) {
    super(message);
    this.name = 'PageExportApiError';
    this.code = code;
    Object.setPrototypeOf(this, PageExportApiError.prototype);
  }
}

export function toPageExportError(error: unknown): PageExportApiError {
  if (error instanceof PageExportApiError) {
    return error;
  }
  if (error instanceof PagesApiError) {
    const code: PageExportErrorCode = error.code === 'E_NOT_FOUND' ? 'E_NOT_FOUND' : 'E_INVARIANT';
    return new PageExportApiError(code, error.message);
  }
  return new PageExportApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 纯函数（scope 树展开 / 文件名净化；单测直测）
// ---------------------------------------------------------------------------

/** 语义最小页视图（从 `page.listAll` 行派生）。 */
export interface PageLite {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly pageType: string;
}

const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 标题 → 跨平台安全文件名（空/纯非法字符 → fallback；去首尾点空格）。 */
export function sanitizeFileName(title: string, fallback: string): string {
  const cleaned = title.replace(ILLEGAL_FILE_CHARS, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  const trimmed = cleaned.slice(0, 120);
  return trimmed.length > 0 ? trimmed : fallback;
}

function childrenOf(nodes: readonly PageLite[], parentId: string | null): PageLite[] {
  return nodes.filter((node) => node.parentId === parentId);
}

/**
 * scope='subtree'：根页 + 全部活后代（先序，兄弟按输入序——输入取自
 * `page.listAll`（ORDER BY sort_key, id）的稳定序）。
 */
export function collectSubtree(rootId: string, nodes: readonly PageLite[]): PageLite[] {
  const root = nodes.find((node) => node.id === rootId);
  if (root === undefined) {
    return [];
  }
  const out: PageLite[] = [];
  const walk = (node: PageLite): void => {
    out.push(node);
    for (const child of childrenOf(nodes, node.id)) {
      walk(child);
    }
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------------------
// 行 → BlockSpec（编辑器形态 → importer canonical）
// ---------------------------------------------------------------------------

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw.length === 0) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  const parsed = parseJson(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * 块行 → BlockSpec（image 的 asset 适配由调用方按磁盘解析后完成）。
 *
 * TASK-T79-02 缺陷 A：content 分流**不再自带副本**，直接复用 `main/blocks.ts` 的
 * `blockContentOf`（与 `blocks:list` 读路径同一实现），本文件只保留 image 资源适配
 * 等导出自身逻辑。
 */
export function blockSpecOfRow(row: unknown): BlockSpec {
  const type = rowString(row, 'type') ?? 'paragraph';
  return {
    type,
    props: parseJsonRecord(rowString(row, 'props_json')),
    content: blockContentOf(type, rowString(row, 'content_json')),
  };
}

// ---------------------------------------------------------------------------
// IO 注入面
// ---------------------------------------------------------------------------

export interface PageExportIo {
  /** 附件目录下的文件名清单（内容寻址 `<hash>[.<ext>]`）。 */
  listAttachments(dir: string): string[];
  readFile(path: string): Uint8Array;
  writeFile(path: string, bytes: Uint8Array): void;
  mkdir(path: string): void;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
}

export const nodePageExportIo: PageExportIo = {
  listAttachments: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  readFile: (path) => new Uint8Array(readFileSync(path)),
  writeFile: (path, bytes) => {
    writeFileSync(path, bytes);
  },
  mkdir: (path) => {
    mkdirSync(path, { recursive: true });
  },
  exists: (path) => existsSync(path),
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface PageExportServiceOptions {
  readonly executor: StatementExecutor;
  readonly attachmentsDir: string;
  /** 活动工作区解析（index.ts 经 pages.listWorkspaces 注入；测试注入固定值）。 */
  readonly activeWorkspaceId: () => Promise<string>;
  /** confirm 缺 dir 时的目录选择（main 注入系统对话框；取消回 null）。 */
  readonly pickDirectory: () => Promise<string | null>;
  /** 「打开所在目录」（main 注入 shell.openPath；缺省无操作）。 */
  readonly openPath?: (dir: string) => Promise<void>;
  readonly io?: PageExportIo;
}

export interface PageExportService {
  preview(input: PageExportInput): Promise<PageExportPreview>;
  confirm(input: PageExportInput): Promise<PageExportConfirmResponse>;
  reveal(input: { dir: string }): Promise<{ ok: true }>;
}

/** 内部导出计划（含 md 正文与附件字节；preview 只投影元信息）。 */
interface ExportPlan {
  rootName: string;
  pages: Array<{ pageId: string; title: string; relPath: string; markdown: string; blockCount: number; orphans: string[] }>;
  assets: Array<{ relPath: string; bytes: Uint8Array }>;
}

function posix(path: string): string {
  return path.split(sep).join('/');
}

function pageLiteOf(row: unknown): PageLite | null {
  const id = rowString(row, 'id');
  if (id === null) {
    return null;
  }
  const deletedAt = (row as Record<string, unknown> | null)?.['deleted_at'];
  if (typeof deletedAt === 'number' && deletedAt > 0) {
    return null;
  }
  return {
    id,
    parentId: rowString(row, 'parent_id'),
    title: rowString(row, 'title') ?? '',
    pageType: rowString(row, 'page_type') ?? 'page',
  };
}

export function createPageExportService(options: PageExportServiceOptions): PageExportService {
  const { executor, attachmentsDir, activeWorkspaceId } = options;
  const io = options.io ?? nodePageExportIo;
  const pickDirectory = options.pickDirectory;
  const openPath = options.openPath ?? (async (): Promise<void> => {});

  /** 附件名解析：精确 `<hash>` → 前缀 `<hash>.<ext>`（口径同 main/assets.ts findHashFile）。 */
  function resolveDiskName(names: readonly string[], fileId: string): string | null {
    if (fileId.length === 0) {
      return null;
    }
    if (names.includes(fileId)) {
      return fileId;
    }
    return names.find((name) => name.startsWith(`${fileId}.`)) ?? null;
  }

  async function buildPlan(input: PageExportInput): Promise<ExportPlan> {
    const allPages = (await executor.all('page.listAll', { workspace_id: await activeWorkspaceId() })).rows
      .map((row) => pageLiteOf(row))
      .filter((node): node is PageLite => node !== null);
    const root = allPages.find((node) => node.id === input.pageId);
    if (root === undefined) {
      throw new PageExportApiError('E_NOT_FOUND', `页面不存在或不在活动工作区：${input.pageId}`);
    }
    const scopeNodes = input.scope === 'subtree' ? collectSubtree(root.id, allPages) : [root];
    const rootName = sanitizeFileName(root.title, 'untitled');

    const names = io.listAttachments(attachmentsDir);
    const diskNameCache = new Map<string, string | null>();
    const diskNameOf = (fileId: string): string | null => {
      const cached = diskNameCache.get(fileId);
      if (cached !== undefined) {
        return cached;
      }
      const resolved = resolveDiskName(names, fileId);
      diskNameCache.set(fileId, resolved);
      return resolved;
    };

    const pages: ExportPlan['pages'] = [];
    const assets: ExportPlan['assets'] = [];
    const copied = new Set<string>();

    /**
     * 包内相对路径（目录层级）：scope 根 = `<title>.md`；非根页 = `<父目录>/<title>/<title>.md`
     * （每页自拥同名目录，父链即目录链）——单页导出恒 `<title>.md`（PRD §1B）。
     */
    const relPathMemo = new Map<string, string>();
    const relPathOf = (node: PageLite): string => {
      const cached = relPathMemo.get(node.id);
      if (cached !== undefined) {
        return cached;
      }
      const ownDir = sanitizeFileName(node.title, 'untitled');
      let path = `${ownDir}.md`;
      if (node.id !== root.id && node.parentId !== null) {
        const parent = allPages.find((candidate) => candidate.id === node.parentId);
        if (parent !== undefined) {
          // 归一 dirname（node:path 对无目录路径回 '.'，此处统一成 ''）
          const rawParentDir = posix(dirname(relPathOf(parent)));
          const parentDir = rawParentDir === '.' ? '' : rawParentDir;
          path = parentDir === '' ? `${ownDir}/${ownDir}.md` : `${parentDir}/${ownDir}/${ownDir}.md`;
        }
      }
      relPathMemo.set(node.id, path);
      return path;
    };

    for (const node of scopeNodes) {
      const fileName = relPathOf(node);
      // 归一 dirname（无目录路径在 node:path 下回 '.'）：'' （根）或 '子页/孙页'
      const rawPageDir = posix(dirname(fileName));
      const pageDir = rawPageDir === '.' ? '' : rawPageDir;
      // 附件恒挂包根 `files/`；md 内链接按本页目录深度取相对前缀
      const depth = pageDir === '' ? 0 : pageDir.split('/').length;
      const relPrefix = `${'../'.repeat(depth)}files`;

      const orphans: string[] = [];
      const specs = ((await executor.all('block.listByPage', { page_id: node.id })).rows).map((row) => blockSpecOfRow(row));

      // image 适配：file_id(+磁盘 ext) → canonical src；孤儿映射为 null（占位注释）
      const hrefOf = new Map<string, string | null>();
      for (const spec of specs) {
        if (spec.type !== 'image') {
          continue;
        }
        const fileId = typeof spec.props['file_id'] === 'string' ? spec.props['file_id'] : '';
        const diskName = diskNameOf(fileId);
        if (diskName === null) {
          orphans.push(fileId);
          spec.props['src'] = `asset://${fileId}`;
          hrefOf.set(`asset://${fileId}`, null);
          continue;
        }
        const src = `asset://${diskName}`;
        const href = `${relPrefix}/${diskName}`;
        spec.props['src'] = src;
        spec.props['name'] = typeof spec.props['caption'] === 'string' ? spec.props['caption'] : '';
        hrefOf.set(src, href);
        if (!copied.has(diskName)) {
          copied.add(diskName);
          assets.push({
            relPath: `files/${diskName}`,
            bytes: io.readFile(join(attachmentsDir, diskName)),
          });
        }
      }

      const markdown = blocksToMarkdown(specs, { resolveAsset: (src) => hrefOf.get(src) ?? null });
      pages.push({
        pageId: node.id,
        title: node.title,
        relPath: fileName,
        markdown,
        blockCount: specs.length,
        orphans,
      });
    }

    return { rootName, pages, assets };
  }

  function previewOf(plan: ExportPlan): PageExportPreview {
    const files: PageExportFilePreview[] = [
      ...plan.pages.map((page) => ({ relPath: page.relPath, kind: 'markdown' as const, bytes: 0 })),
      ...plan.assets.map((asset) => ({ relPath: asset.relPath, kind: 'asset' as const, bytes: asset.bytes.byteLength })),
    ];
    const orphanCount = plan.pages.reduce((sum, page) => sum + page.orphans.length, 0);
    return {
      rootName: plan.rootName,
      pages: plan.pages.map((page) => ({
        pageId: page.pageId,
        title: page.title,
        relPath: page.relPath,
        blockCount: page.blockCount,
        orphans: page.orphans,
      })),
      files,
      counts: {
        pages: plan.pages.length,
        markdown: plan.pages.length,
        assets: plan.assets.length,
        orphans: orphanCount,
      },
      totalBytes: plan.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
    };
  }

  return {
    async preview(input) {
      assertInput(input);
      const plan = await buildPlan(input);
      return previewOf(plan);
    },

    async confirm(input) {
      assertInput(input);
      const plan = await buildPlan(input);
      const chosen = typeof input.dir === 'string' && input.dir.length > 0 ? input.dir : await pickDirectory();
      if (chosen === null) {
        return { canceled: true }; // 取消 = 零落盘
      }
      const pkgDir = join(chosen, plan.rootName);
      io.mkdir(pkgDir);
      for (const page of plan.pages) {
        const target = join(pkgDir, ...page.relPath.split('/'));
        io.mkdir(dirname(target));
        io.writeFile(target, new TextEncoder().encode(page.markdown));
      }
      for (const asset of plan.assets) {
        const target = join(pkgDir, ...asset.relPath.split('/'));
        io.mkdir(dirname(target));
        io.writeFile(target, asset.bytes);
      }
      return { ...previewOf(plan), canceled: false, dir: pkgDir };
    },

    async reveal(input) {
      const dir = input?.dir;
      if (typeof dir !== 'string' || dir.length === 0 || !io.isDirectory(dir)) {
        throw new PageExportApiError('E_MALFORMED', 'reveal 目标目录不存在');
      }
      await openPath(dir);
      return { ok: true };
    },
  };
}

function assertInput(input: PageExportInput): void {
  if (input === null || typeof input !== 'object') {
    throw new PageExportApiError('E_MALFORMED', 'IPC 参数必须是对象');
  }
  if (typeof input.pageId !== 'string' || input.pageId.length === 0) {
    throw new PageExportApiError('E_MALFORMED', 'pageId 必须是非空字符串');
  }
  if (input.scope !== 'single' && input.scope !== 'subtree') {
    throw new PageExportApiError('E_MALFORMED', "scope 必须是 'single' | 'subtree'");
  }
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

export interface PageExportIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 page:export:preview / confirm / reveal 三通道。`service === null`（DbServer
 * 未就绪）时统一回 `E_INVARIANT`。参数在边界再校验（不信任 renderer）。
 */
export function registerPageExportIpc(service: PageExportService | null, registrar: PageExportIpcRegistrar): void {
  const requireService = (): PageExportService => {
    if (service === null) {
      throw new PageExportApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };
  const on = (channel: string, run: (input: Record<string, unknown>) => Promise<unknown>): void => {
    registrar.handle(channel, async (raw: unknown): Promise<unknown> => {
      try {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          throw new PageExportApiError('E_MALFORMED', 'IPC 参数必须是对象');
        }
        return await run(raw as Record<string, unknown>);
      } catch (error) {
        const mapped = toPageExportError(error);
        throw new Error(`${mapped.code}: ${mapped.message}`);
      }
    });
  };

  on(CHANNEL_PAGE_EXPORT_PREVIEW, (input) =>
    requireService().preview({
      pageId: String(input['pageId'] ?? ''),
      scope: input['scope'] as PageExportScope,
    }),
  );
  on(CHANNEL_PAGE_EXPORT_CONFIRM, (input) =>
    requireService().confirm({
      pageId: String(input['pageId'] ?? ''),
      scope: input['scope'] as PageExportScope,
      ...(typeof input['dir'] === 'string' ? { dir: input['dir'] } : {}),
    }),
  );
  on(CHANNEL_PAGE_EXPORT_REVEAL, (input) => requireService().reveal({ dir: String(input['dir'] ?? '') }));
}
