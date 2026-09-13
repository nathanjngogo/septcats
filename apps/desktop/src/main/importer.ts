/**
 * importer.ts —— 主进程「导入器」服务（TASK-T11-01 §4，M12）。
 *
 * 职责：把 renderer 的 import:* 请求翻译成「解析器 → 计划器 → 执行器」链路：
 * - `import:plan`：fflate 解 zip 到内存 Map / 目录直读 → 选对解析器 →
 *   `@septcats/importer` 的 buildPlan（含熔断/去重/孤儿/重名）→ plan 暂存内存
 *   Map（planId + TTL 30 分钟），preview 不含 bytes；
 * - `import:execute`：逐条目执行——page 一个 batch（page.upsert op + N 个
 *   block.upsert op + import_source 行），collection 一个 batch（collection.upsert op
 *   + N 个 record.upsert op + import_source 行），全部走 `commitOps` 同源
 *   （ledger + 物化同事务）；asset 直接落盘 `layout.attachments/<hash><ext>`
 *   （sha256 内容寻址，存在即跳过 = 天然幂等）；
 * - `import:progress` / `import:cancel`：进度轮询与取消（batch 边界生效）；
 * - 失败续传：report.failedAt 记失败条目下标，重跑从断点继续；0 脏数据靠幂等
 *   （page/collection upsert + import_source OR IGNORE）而非回滚（§4）。
 *
 * 纪律（与 pages/dbview/search 同一口径）：
 * - **本文件不 import electron**（IPC 注册在 main/index.ts），vitest 纯 Node 环境
 *   直连 better-sqlite3 可端到端（test/importer-exec.test.ts）；
 * - 一切写路径先造 Op 再 commitOps，本文件不出现裸 SQL / 物化直写；
 * - relation 列降级发生在 plan 阶段（notion.ts 一期降级为 text + warning），
 *   执行器不碰 relation 双写。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { sortBetween, sortSequence, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import { defaultView } from '@septcats/dbview';
import {
  PlanTooLargeError,
  buildPlan,
  contentHashOf,
} from '@septcats/importer';
import type {
  ExistingLookup,
  ImportItem,
  ImportPlan,
  ImportSourceFs,
  PlanSource,
} from '@septcats/importer';
import { PREVIEW_ITEM_LIMIT } from '../shared/importer';
import type { ImportPlanCounts, ImportPlanInput, ImportPlanPreview, ImportPreviewItem, ImportProgress, ImportReport } from '../shared/importer';
import { commitOps } from './commit';
import type { StatementExecutor } from './pages';

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形：{ code, message }）
// ---------------------------------------------------------------------------

export type ImporterErrorCode =
  | 'E_MALFORMED'
  | 'E_NOT_FOUND'
  | 'E_INVARIANT'
  | 'E_TOO_LARGE';

export class ImporterApiError extends Error {
  readonly code: ImporterErrorCode;

  constructor(code: ImporterErrorCode, message: string) {
    super(message);
    this.name = 'ImporterApiError';
    this.code = code;
    Object.setPrototypeOf(this, ImporterApiError.prototype);
  }
}

/** 由底层异常映射成 IPC 错误（PlanTooLargeError 保留 E_TOO_LARGE 传导）。 */
export function toImporterError(error: unknown): ImporterApiError {
  if (error instanceof ImporterApiError) {
    return error;
  }
  if (error instanceof PlanTooLargeError) {
    return new ImporterApiError('E_TOO_LARGE', error.message);
  }
  return new ImporterApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 源装载（zip / 目录 / 单文件 → ImportSourceFs）
// ---------------------------------------------------------------------------

/** 装载结果：源类型 + 已解压文件集（相对路径 POSIX '/' 分隔）。 */
export interface LoadedSource {
  kind: ImportPlan['source']['kind'];
  files: Map<string, string | Uint8Array>;
  /** md-file / csv 源的源内文件路径（buildPlan 的 source.path）。 */
  path?: string | undefined;
}

/** 源装载器（默认实现读真实 fs + fflate；测试注入内存实现）。 */
export type SourceLoader = (input: ImportPlanInput) => LoadedSource;

function posixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

function walkFiles(root: string, dir: string, out: Map<string, Uint8Array>): void {
  for (const entry of readdirSync(dir.length > 0 ? dir : root, { withFileTypes: true })) {
    const full = join(dir.length > 0 ? dir : root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, full, out);
    } else if (entry.isFile()) {
      out.set(posixRelative(root, full), new Uint8Array(readFileSync(full)));
    }
  }
}

/** zip 条目名安全收口：拒绝绝对路径 / 上跳（防 zip slip，Deflate64 目录项也不入 Map）。 */
function safeZipEntry(name: string): boolean {
  return !name.endsWith('/') && !name.startsWith('/') && !name.includes('..') && name.length > 0;
}

/** 默认源装载：zipPath → fflate 解压；dirPath → 目录递归或单 md 文件；csvPath → 单表。 */
export const defaultSourceLoader: SourceLoader = (input) => {
  if (typeof input.zipPath === 'string' && input.zipPath.length > 0) {
    const zipped = unzipSync(new Uint8Array(readFileSync(input.zipPath)));
    const files = new Map<string, Uint8Array>();
    for (const [name, bytes] of Object.entries(zipped)) {
      if (safeZipEntry(name)) {
        files.set(name, bytes);
      }
    }
    return { kind: 'notion-zip', files };
  }
  if (typeof input.csvPath === 'string' && input.csvPath.length > 0) {
    const name = basename(input.csvPath);
    return { kind: 'csv', files: new Map([[name, new Uint8Array(readFileSync(input.csvPath))]]), path: name };
  }
  if (typeof input.dirPath === 'string' && input.dirPath.length > 0) {
    const stat = statSync(input.dirPath);
    if (stat.isDirectory()) {
      const files = new Map<string, Uint8Array>();
      walkFiles(input.dirPath, '', files);
      return { kind: 'md-dir', files };
    }
    if (/\.md$/i.test(input.dirPath)) {
      const name = basename(input.dirPath);
      return { kind: 'md-file', files: new Map([[name, new Uint8Array(readFileSync(input.dirPath))]]), path: name };
    }
    throw new ImporterApiError('E_MALFORMED', `dirPath 只支持目录或 .md 文件：${input.dirPath}`);
  }
  throw new ImporterApiError('E_MALFORMED', 'import:plan 需要 zipPath / dirPath / csvPath 三选一');
};

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/** 计划 TTL（任务书 §C-3：30 分钟）。 */
export const PLAN_TTL_MS = 30 * 60 * 1000;

interface PlanEntry {
  plan: ImportPlan;
  createdAt: number;
  status: 'ready' | 'executing' | 'done' | 'failed' | 'cancelled';
  done: number;
  failedAt: number | null;
  error: string | null;
  opCount: number;
  batchCount: number;
  cancelRequested: boolean;
  /** 本次计划已落库的 path → pageId（含此前断点成功部分；重跑幂等跳过依据）。 */
  pageIds: Map<string, string>;
  /** 计划期去重命中的 path → 已存在 pageId（父页是重复跳过条目时的父解析依据）。 */
  existingPages: Map<string, string>;
}

export interface ImporterService {
  plan(input: ImportPlanInput): Promise<ImportPlanPreview>;
  execute(input: { planId: string; confirm: true }): Promise<ImportReport>;
  progress(input: { planId: string }): Promise<ImportProgress | null>;
  cancel(input: { planId: string }): Promise<{ ok: true }>;
}

export interface ImporterServiceOptions {
  readonly executor: StatementExecutor;
  readonly actor: ActorId;
  /** 附件落盘目录（platform.layout.attachments）。 */
  readonly attachmentsDir: string;
  /** 活动工作区解析（index.ts 经 pages.listWorkspaces 注入；测试注入固定值）。 */
  readonly activeWorkspaceId: () => Promise<string>;
  readonly now?: () => number;
  /** 源装载（缺省 defaultSourceLoader；测试注入内存实现）。 */
  readonly loadSource?: SourceLoader;
  readonly ttlMs?: number;
}

function previewItemOf(item: ImportItem): ImportPreviewItem {
  if (item.op === 'page') {
    return { op: 'page', path: item.path, title: item.title, parentPath: item.parentPath, blockCount: item.blocks.length };
  }
  if (item.op === 'collection') {
    return { op: 'collection', path: item.path, title: item.title, parentPath: item.parentPath, recordCount: item.records.length };
  }
  return { op: 'asset', hash: item.hash, ext: item.ext, size: item.bytes.byteLength };
}

function countsOf(plan: ImportPlan): ImportPlanCounts {
  return { ...plan.counts };
}

export function createImporterService(options: ImporterServiceOptions): ImporterService {
  const { executor, actor, attachmentsDir } = options;
  const now = options.now ?? ((): number => Date.now());
  const loadSource = options.loadSource ?? defaultSourceLoader;
  const ttlMs = options.ttlMs ?? PLAN_TTL_MS;

  const entries = new Map<string, PlanEntry>();

  function requireEntry(planId: string): PlanEntry {
    if (typeof planId !== 'string' || planId.length === 0) {
      throw new ImporterApiError('E_MALFORMED', 'planId 必须是非空字符串');
    }
    // 惰性淘汰过期计划（TTL 30 分钟）
    for (const [id, entry] of entries) {
      if (now() - entry.createdAt > ttlMs) {
        entries.delete(id);
      }
    }
    const entry = entries.get(planId);
    if (entry === undefined) {
      throw new ImporterApiError('E_NOT_FOUND', `导入计划不存在或已过期：${planId}`);
    }
    return entry;
  }

  function reportOf(entry: PlanEntry, planId: string, status: ImportReport['status']): ImportReport {
    return {
      planId,
      status,
      done: entry.done,
      total: entry.plan.items.length,
      failedAt: entry.failedAt,
      error: entry.error,
      opCount: entry.opCount,
      batchCount: entry.batchCount,
      counts: countsOf(entry.plan),
    };
  }

  function fsOf(files: Map<string, string | Uint8Array>): ImportSourceFs {
    return {
      list: () => [...files.keys()],
      read: (path: string) => {
        const value = files.get(path);
        if (value === undefined) {
          throw new ImporterApiError('E_INVARIANT', `源内文件缺失：${path}`);
        }
        return value;
      },
    };
  }

  /** 层尾排序键游标：execute 开始时从库里拉一次每层 max(sort_key)，此后本地推进。 */
  function layerKeyIndex(rows: unknown[]): Map<string, string | null> {
    const index = new Map<string, string | null>();
    for (const row of rows) {
      const parentId = (row as Record<string, unknown> | null)?.['parent_id'];
      const sortKey = (row as Record<string, unknown> | null)?.['sort_key'];
      if (typeof sortKey !== 'string' || sortKey.length === 0) {
        continue;
      }
      const key = typeof parentId === 'string' ? parentId : '';
      const current = index.get(key);
      if (current === undefined || current === null || sortKey > current) {
        index.set(key, sortKey);
      }
    }
    return index;
  }

  function nextSortKey(layerKeys: Map<string, string | null>, parentId: string | null): string {
    const key = parentId ?? '';
    const prev = layerKeys.get(key) ?? null;
    let next: string;
    try {
      next = sortBetween(prev, null);
    } catch (error) {
      throw new ImporterApiError(
        'E_INVARIANT',
        `无法在父层生成排序键（${parentId ?? '根'}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    layerKeys.set(key, next);
    return next;
  }

  /** 父页解析：本计划已建页 path 精确命中 → 计划期去重命中 → 深度前缀页 → 根。 */
  function resolveParent(entry: PlanEntry, parentPath: string | null): string | null {
    if (parentPath === null) {
      return null;
    }
    const exact = entry.pageIds.get(parentPath) ?? entry.existingPages.get(parentPath);
    if (exact !== undefined) {
      return exact;
    }
    // md-dir 语义：parentPath 是目录路径（'a/b'），可能没有同名页——挂到路径前缀最深的已建页下
    let best: { path: string; id: string } | null = null;
    for (const [path, id] of entry.pageIds) {
      if (parentPath.startsWith(`${path}/`) && (best === null || path.length > best.path.length)) {
        best = { path, id };
      }
    }
    return best?.id ?? null;
  }

  /** image 块：asset:// src 衍生 file_id（编辑器 ImageNode 的渲染锚），其余原样透传。 */
  const ASSET_SRC = /^asset:\/\/([0-9a-f]{64})(\.[A-Za-z0-9]+)?$/;

  function materializeProps(type: string, props: Record<string, unknown>): Record<string, unknown> {
    if (type !== 'image') {
      return props;
    }
    const src = props['src'];
    const match = typeof src === 'string' ? ASSET_SRC.exec(src) : null;
    if (match === null) {
      return props;
    }
    return {
      ...props,
      file_id: match[1] ?? '',
      caption: typeof props['name'] === 'string' ? (props['name'] as string) : '',
    };
  }

  function blockOp(block: { type: string; props: Record<string, unknown>; content: unknown }, pageId: string, sortKey: string, at: number): Op {
    return {
      op_id: ulid(at),
      lamport: { c: 1, d: actor },
      at,
      actor,
      target: { table: 'block', id: ulid(at) },
      kind: 'upsert',
      payload: {
        page_id: pageId,
        type: block.type,
        props: materializeProps(block.type, block.props),
        content: block.content,
        sort_key: sortKey,
        alive: 1,
        updated_at: at,
      },
    };
  }

  function pageOps(item: Extract<ImportItem, { op: 'page' }>, pageId: string, parentId: string | null, sortKey: string, at: number): Op[] {
    const pageOp: Op = {
      op_id: ulid(at),
      lamport: { c: 1, d: actor },
      at,
      actor,
      target: { table: 'page', id: pageId },
      kind: 'upsert',
      payload: {
        title: item.title,
        icon: null,
        cover: null,
        parent_id: parentId,
        sort_key: sortKey,
        alive: 1,
        deleted_at: null,
        updated_at: at,
      },
    };
    const keys = sortSequence(item.blocks.length);
    const blockOps = item.blocks.map((block, index) => blockOp(block, pageId, keys[index] ?? 'A00000000', at));
    return [pageOp, ...blockOps];
  }

  function collectionOps(item: Extract<ImportItem, { op: 'collection' }>, collectionId: string, pageId: string, at: number): Op[] {
    // 属性补 id（dbview propertySchema 要求；解析器产物按 pid 键入，缺 id 字段）
    const properties: Record<string, unknown> = {};
    for (const [pid, property] of Object.entries(item.schema.properties)) {
      properties[pid] = { id: pid, ...property };
    }
    const schema = { properties, title_pid: item.schema.title_pid };
    const views = [defaultView(ulid(at), '表格')];
    const collectionOp: Op = {
      op_id: ulid(at),
      lamport: { c: 1, d: actor },
      at,
      actor,
      target: { table: 'collection', id: collectionId },
      kind: 'upsert',
      payload: { page_id: pageId, name: item.title, schema, views, alive: 1, updated_at: at },
    };
    const keys = sortSequence(item.records.length);
    const recordOps: Op[] = item.records.map((values, index) => ({
      op_id: ulid(at),
      lamport: { c: 1, d: actor },
      at,
      actor,
      target: { table: 'record', id: `rec-${ulid(at)}` },
      kind: 'upsert',
      payload: {
        collection_id: collectionId,
        values,
        sort_key: keys[index] ?? 'A00000000',
        alive: 1,
        updated_at: at,
      },
    }));
    return [collectionOp, ...recordOps];
  }

  /** asset 落盘：sha256 内容寻址，存在即跳过（幂等）；bytes 与 hash 不符即失败。 */
  function writeAsset(item: Extract<ImportItem, { op: 'asset' }>): void {
    const digest = createHash('sha256').update(item.bytes).digest('hex');
    if (digest !== item.hash) {
      throw new ImporterApiError('E_INVARIANT', `附件内容与 hash 不符：${item.hash}`);
    }
    mkdirSync(attachmentsDir, { recursive: true });
    const target = join(attachmentsDir, `${item.hash}${item.ext}`);
    if (existsSync(target)) {
      return;
    }
    writeFileSync(target, item.bytes);
  }

  async function executeItem(entry: PlanEntry, item: ImportItem, workspaceId: string, layerKeys: Map<string, string | null>, at: number): Promise<number> {
    if (item.op === 'asset') {
      writeAsset(item);
      return 0;
    }

    const contentHash = contentHashOf(item);
    const importSourceStatement = {
      sqlId: 'importSource.insert',
      params: {
        source_path: item.path,
        content_hash: contentHash,
        page_id: '',
        created_at: at,
      },
    };

    if (item.op === 'page') {
      if (entry.pageIds.has(item.path)) {
        return 0; // 断点重跑：该页此前已成功，幂等跳过
      }
      const pageId = ulid(at);
      const parentId = resolveParent(entry, item.parentPath);
      const sortKey = nextSortKey(layerKeys, parentId);
      const ops = pageOps(item, pageId, parentId, sortKey, at);
      await commitOps(executor, ops, {
        workspaceId,
        extraStatements: [{ ...importSourceStatement, params: { ...importSourceStatement.params, page_id: pageId } }],
      });
      entry.pageIds.set(item.path, pageId);
      return ops.length;
    }

    // collection：宿主页必须已存在（本计划先序保证；重复跳过的页走 existingPages）
    const pageId = resolveParent(entry, item.parentPath);
    if (pageId === null) {
      throw new ImporterApiError('E_INVARIANT', `collection “${item.title}” 的宿主页不存在：${item.parentPath ?? '(根)'}`);
    }
    if (entry.pageIds.has(item.path)) {
      return 0;
    }
    const collectionId = `col-${ulid(at)}`;
    const ops = collectionOps(item, collectionId, pageId, at);
    await commitOps(executor, ops, {
      workspaceId,
      extraStatements: [{ ...importSourceStatement, params: { ...importSourceStatement.params, page_id: pageId } }],
    });
    entry.pageIds.set(item.path, collectionId);
    return ops.length;
  }

  return {
    async plan(input) {
      if (typeof input !== 'object' || input === null) {
        throw new ImporterApiError('E_MALFORMED', 'IPC 参数必须是对象');
      }
      const provided = ['zipPath', 'dirPath', 'csvPath'].filter((key) => {
        const value = (input as Record<string, unknown>)[key];
        return typeof value === 'string' && value.length > 0;
      });
      if (provided.length !== 1) {
        throw new ImporterApiError('E_MALFORMED', 'zipPath / dirPath / csvPath 必须恰好提供一个');
      }

      const source = loadSource(input);
      // 计划期去重：import_source 全量预载成同步 ExistingLookup（buildPlan 的注入面是同步的）
      const ledger = await executor.all('importSource.list');
      const table = new Map<string, string>();
      for (const row of ledger.rows) {
        const record = row as Record<string, unknown> | null;
        const path = record?.['source_path'];
        const hash = record?.['content_hash'];
        const pageId = record?.['page_id'];
        if (typeof path === 'string' && typeof hash === 'string' && typeof pageId === 'string') {
          table.set(`${path}\u0000${hash}`, pageId);
        }
      }
      const lookup: ExistingLookup = (path, hash) => table.get(`${path}\u0000${hash}`) ?? null;

      const fs = fsOf(source.files);
      const planSource: PlanSource = source.path === undefined ? { kind: source.kind } : { kind: source.kind, path: source.path };
      const plan = buildPlan(planSource, fs, lookup);

      const at = now();
      const planId = ulid(at);
      const entry: PlanEntry = {
        plan,
        createdAt: at,
        status: 'ready',
        done: 0,
        failedAt: null,
        error: null,
        opCount: 0,
        batchCount: 0,
        cancelRequested: false,
        pageIds: new Map(),
        existingPages: new Map(),
      };
      // 记录计划期命中的已导入条目（父页被跳过时父解析的兜底依据）
      for (const item of plan.items) {
        if (item.op === 'asset') {
          continue;
        }
        const existing = lookup(item.path, contentHashOf(item));
        if (existing !== null) {
          entry.existingPages.set(item.path, existing);
        }
      }
      entries.set(planId, entry);

      return {
        planId,
        source: { kind: plan.source.kind, rootName: plan.source.rootName },
        items: plan.items.slice(0, PREVIEW_ITEM_LIMIT).map(previewItemOf),
        totalItems: plan.items.length,
        counts: countsOf(plan),
        warnings: plan.warnings,
      };
    },

    async execute(input) {
      if (input?.confirm !== true) {
        throw new ImporterApiError('E_MALFORMED', 'confirm 必须显式为 true');
      }
      const entry = requireEntry(input.planId);
      if (entry.status === 'executing') {
        throw new ImporterApiError('E_INVARIANT', '该计划正在执行中');
      }
      const workspaceId = await options.activeWorkspaceId();
      const pageRows = await executor.all('page.listAll', { workspace_id: workspaceId });
      const layerKeys = layerKeyIndex(pageRows.rows);

      entry.status = 'executing';
      entry.error = null;
      entry.cancelRequested = false;

      // 断点续传：从上次失败条目继续（此前条目已成功，donePaths/pageIds 兜底幂等）
      const startIndex = entry.failedAt ?? 0;
      entry.failedAt = null;

      let index = startIndex;
      for (; index < entry.plan.items.length; index += 1) {
        const item = entry.plan.items[index];
        if (item === undefined) {
          continue;
        }
        if (entry.cancelRequested) {
          entry.status = 'cancelled';
          entry.failedAt = index;
          return reportOf(entry, input.planId, 'cancelled');
        }
        try {
          const at = now();
          const opCount = await executeItem(entry, item, workspaceId, layerKeys, at);
          entry.done += 1;
          entry.opCount += opCount;
          if (item.op !== 'asset') {
            entry.batchCount += 1;
          }
        } catch (cause) {
          entry.status = 'failed';
          entry.failedAt = index;
          entry.error = cause instanceof Error ? cause.message : String(cause);
          return reportOf(entry, input.planId, 'failed');
        }
      }

      entry.status = 'done';
      return reportOf(entry, input.planId, 'done');
    },

    async progress(input) {
      if (typeof input?.planId !== 'string' || input.planId.length === 0) {
        throw new ImporterApiError('E_MALFORMED', 'planId 必须是非空字符串');
      }
      // 进度查询不淘汰过期计划（执行中也可能跨 TTL；只读放行）
      const entry = entries.get(input.planId);
      if (entry === undefined) {
        return null;
      }
      return {
        planId: input.planId,
        status: entry.status,
        done: entry.done,
        total: entry.plan.items.length,
        failedAt: entry.failedAt,
      };
    },

    async cancel(input) {
      if (typeof input?.planId !== 'string' || input.planId.length === 0) {
        throw new ImporterApiError('E_MALFORMED', 'planId 必须是非空字符串');
      }
      const entry = entries.get(input.planId);
      if (entry !== undefined) {
        entry.cancelRequested = true;
      }
      return { ok: true };
    },
  };
}
