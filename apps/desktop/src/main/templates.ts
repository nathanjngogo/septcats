/**
 * templates.ts —— 主进程「模板」服务（TASK-T23-01 §0.B，数据面；UI 归 T23-02）。
 *
 * 职责：把 renderer 的 `templates:*` 六通道翻译成既有 DB 面：
 * - 读：`template.get` / `template.list`（statements.ts v7 语句）；
 * - 写：先造 Op（kind='template' 整对象 / kind='delete'），ledger（真相层）+
 *   `template.*` 物化语句**同 batch（单事务）**落 DbServer——执行面经 withSyncHook
 *   装饰（index.ts 注入），commit 成功即进攒段器；
 * - `saveFromPage`：读 `block.listByPage` + `collection.getByPage` → payload（kind 自动判）；
 * - `createPage`：深拷贝为新页——新 page id + 每个 block id 全新 + kind='database' 时
 *   新 collection id（schema/views 复制，**records 不复制**：模板=结构非数据副本）。
 *
 * 与 pages/blocks 同一纪律：
 * - **本文件不 import electron**（IPC 注册走 DI 的 `registerTemplatesIpc`），vitest 纯
 *   Node 环境直连 better-sqlite3 可端到端（test/templates.test.ts）；
 * - 一切读写走语句白名单，本文件不出现裸 SQL；op 入账用 commit.ts 的 `ledgerStatement`
 *   （encodeOp 校验，键序稳定单行 JSON）；
 * - **零外联**：模板不触发任何网络。
 */
import { sortBetween, ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';
import type { Block } from '@septcats/editor';
import {
  CHANNEL_TEMPLATES_CREATE_PAGE,
  CHANNEL_TEMPLATES_DELETE,
  CHANNEL_TEMPLATES_GET,
  CHANNEL_TEMPLATES_LIST,
  CHANNEL_TEMPLATES_RENAME,
  CHANNEL_TEMPLATES_SAVE_FROM_PAGE,
  CHANNEL_TEMPLATES_SAVE_WORKBENCH,
} from '../shared/ipc';
import type { DbBatchStatement } from '../db/rpc';
import { CommitError, ledgerStatement } from './commit';
import { PagesApiError, type StatementExecutor } from './pages';

// ---------------------------------------------------------------------------
// 公共形状（payload 为 JSON 安全的普通对象：零 React、零 IO）
// ---------------------------------------------------------------------------

export type TemplateKind = 'page' | 'database' | 'workbench';

/** 工作台模板布局（T72 §范围3/④；与 workbench/state.ts 的 WorkbenchCardsPersist 同口径）。 */
export interface WorkbenchTemplateLayout {
  v: 2;
  order: string[];
  hidden: string[];
}

/** 工作台模板种子页（纯文本正文；建页后经 blocks.commit 写入）。 */
export interface WorkbenchTemplateSeedPage {
  title: string;
  body: string;
}

/** 工作台模板 payload（kind='workbench' 时存于 template.payload）。 */
export interface WorkbenchTemplatePayload {
  title: string;
  layout: WorkbenchTemplateLayout;
  seedPages: WorkbenchTemplateSeedPage[];
}

/** 模板列表项（不含 payload；templates:list 出参）。 */
export interface TemplateMeta {
  id: string;
  kind: TemplateKind;
  title: string;
  icon: string | null;
  updated_at: number;
}

/** 页面模板 payload：块树（id 保留但仅作结构参照，createPage 时全部换新）。 */
export interface PageTemplatePayload {
  title: string;
  icon: string | null;
  blocks: Block[];
}

/** 数据库模板 payload：collection 结构（schema/views），**不含 record 行**。 */
export interface DatabaseTemplatePayload {
  title: string;
  icon: string | null;
  collection: {
    name: string;
    schema: Record<string, unknown>;
    views: unknown[];
  };
  blocks?: Block[];
}

export type TemplatePayload = PageTemplatePayload | DatabaseTemplatePayload;

/** templates:get 出参：meta + payload（预览/编辑用）。 */
export type TemplateFull = TemplateMeta & { payload: TemplatePayload };

// ---------------------------------------------------------------------------
// 错误（与 PagesApiError 同形：{ code, message }）
// ---------------------------------------------------------------------------

export type TemplatesErrorCode =
  | 'E_MALFORMED'
  | 'E_NO_WORKSPACE'
  | 'E_NOT_FOUND'
  | 'E_PARENT_GONE'
  | 'E_TEMPLATE_NOT_FOUND'
  | 'E_INVARIANT';

export class TemplatesApiError extends Error {
  readonly code: TemplatesErrorCode;

  constructor(code: TemplatesErrorCode, message: string) {
    super(message);
    this.name = 'TemplatesApiError';
    this.code = code;
    Object.setPrototypeOf(this, TemplatesApiError.prototype);
  }
}

/** 由底层异常映射成 IPC 错误（不吞错：全部收敛为带稳定 code 的 TemplatesApiError）。 */
export function toTemplatesError(error: unknown): TemplatesApiError {
  if (error instanceof TemplatesApiError) {
    return error;
  }
  if (error instanceof CommitError) {
    return new TemplatesApiError('E_MALFORMED', error.message);
  }
  if (error instanceof PagesApiError) {
    // 注入的 activeWorkspaceId（index.ts）抛 E_NO_WORKSPACE：保留原码透传
    return new TemplatesApiError(
      error.code === 'E_NO_WORKSPACE' ? 'E_NO_WORKSPACE' : 'E_INVARIANT',
      error.message,
    );
  }
  return new TemplatesApiError('E_INVARIANT', error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// 行 → 实体
// ---------------------------------------------------------------------------

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function rowNumber(row: unknown, key: string, fallback: number): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const EMPTY_PARAGRAPH_DOC: NonNullable<Block['content']> = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/**
 * block 行 → 编辑器 Block（与 main/blocks.ts 的 blockRowToBlock 同语义）。
 * 本文件本地复制该转换：blocks.ts 不在 T23-01 可改清单且未导出该函数。
 */
function blockRowToBlock(row: unknown): Block {
  const id = rowString(row, 'id');
  const pageId = rowString(row, 'page_id');
  const type = rowString(row, 'type');
  const sortKey = rowString(row, 'sort_key');
  if (id === null || pageId === null || type === null || sortKey === null) {
    throw new TemplatesApiError('E_INVARIANT', 'block 行缺少 id/page_id/type/sort_key');
  }
  const propsJson = rowString(row, 'props_json');
  let props: Record<string, unknown> = {};
  if (propsJson !== null && propsJson.length > 0) {
    try {
      const parsed = JSON.parse(propsJson) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      props = {};
    }
  }
  let content: Block['content'];
  const contentJson = rowString(row, 'content_json');
  if (type === 'divider' || type === 'image') {
    content = null;
  } else if (contentJson === null) {
    content = type === 'code' ? '' : EMPTY_PARAGRAPH_DOC;
  } else if (type === 'code') {
    content = contentJson;
  } else {
    try {
      const parsed = JSON.parse(contentJson) as unknown;
      content =
        parsed !== null && typeof parsed === 'object' && (parsed as { type?: unknown })['type'] === 'doc'
          ? (parsed as Block['content'])
          : EMPTY_PARAGRAPH_DOC;
    } catch {
      content = EMPTY_PARAGRAPH_DOC;
    }
  }
  return {
    id,
    page_id: pageId,
    type,
    props,
    content,
    parent_id: rowString(row, 'parent_id'),
    sort_key: sortKey,
    alive: rowNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowNumber(row, 'version', 1),
    last_edited: rowNumber(row, 'updated_at', 0),
  };
}

interface TemplateRow {
  id: string;
  kind: string;
  title: string;
  icon: string | null;
  payload: string;
  alive: number;
  version: number;
  created_at: number | null;
  updated_at: number | null;
  deleted_at: number | null;
}

function toTemplateRow(row: unknown): TemplateRow {
  const id = rowString(row, 'id');
  const kind = rowString(row, 'kind');
  if (id === null || kind === null) {
    throw new TemplatesApiError('E_INVARIANT', 'template 行缺少 id/kind');
  }
  return {
    id,
    kind,
    title: rowString(row, 'title') ?? '',
    icon: rowString(row, 'icon'),
    payload: rowString(row, 'payload') ?? '{}',
    alive: rowNumber(row, 'alive', 1) === 0 ? 0 : 1,
    version: rowNumber(row, 'version', 1),
    created_at: rowNumber(row, 'created_at', 0) || null,
    updated_at: rowNumber(row, 'updated_at', 0) || null,
    deleted_at: rowNumber(row, 'deleted_at', 0) || null,
  };
}

function parsePayload(kind: string, payloadJson: string): TemplatePayload {
  let raw: unknown;
  try {
    raw = JSON.parse(payloadJson);
  } catch {
    throw new TemplatesApiError('E_INVARIANT', `模板 payload 不是合法 JSON：${kind}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TemplatesApiError('E_INVARIANT', `模板 payload 不是对象：${kind}`);
  }
  return raw as TemplatePayload;
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface TemplatesService {
  /** 模板列表（不含 payload；updated_at 倒序；kind 缺省 = 全部）。 */
  list(input: { kind?: TemplateKind }): Promise<{ templates: TemplateMeta[] }>;
  /** 单个模板（meta + payload）。不存在或已删 → E_TEMPLATE_NOT_FOUND。 */
  get(input: { id: string }): Promise<{ template: TemplateFull }>;
  /** 把一页另存为模板（kind 自动判：有 collection → 'database'，否则 'page'）。 */
  saveFromPage(input: { pageId: string; title: string; icon?: string }): Promise<{ id: string }>;
  /** 重命名模板（icon 缺省 = 保持不变）。 */
  rename(input: { id: string; title: string; icon?: string }): Promise<Record<string, never>>;
  /** 软删模板（alive=0 + deleted_at）。 */
  delete(input: { id: string }): Promise<Record<string, never>>;
  /** 从模板新建页（深拷贝：新 page/block/collection id；records 不复制）。 */
  createPage(input: { templateId: string; parentId: string | null }): Promise<{ pageId: string }>;
  /** 另存工作台模板（kind='workbench'；layout+seedPages 原样存 payload）。 */
  saveWorkbench(input: {
    title: string;
    layout: WorkbenchTemplateLayout;
    seedPages: WorkbenchTemplateSeedPage[];
  }): Promise<{ id: string }>;
}

export interface TemplatesServiceOptions {
  readonly executor: StatementExecutor;
  readonly actor: ActorId;
  readonly now?: () => number;
  /** 活动工作区解析（Q4 单库分片：物化语句的 workspace_id 取它）。缺工作区时抛 E_NO_WORKSPACE。 */
  readonly activeWorkspaceId: () => Promise<string>;
}

export function createTemplatesService(options: TemplatesServiceOptions): TemplatesService {
  const { executor, actor } = options;
  const now = options.now ?? ((): number => Date.now());

  function templateOp(id: string, payload: Record<string, unknown>, c: number): Op {
    return {
      op_id: ulid(now()),
      lamport: { c, d: actor },
      at: now(),
      actor,
      target: { table: 'template', id },
      kind: 'template',
      payload,
    };
  }

  function templateUpsertStatement(row: {
    id: string;
    kind: string;
    title: string;
    icon: string | null;
    payload: string;
    alive: number;
    version: number;
    createdAt: number | null;
    updatedAt: number;
  }): DbBatchStatement {
    return {
      sqlId: 'template.upsert',
      params: {
        id: row.id,
        kind: row.kind,
        title: row.title,
        icon: row.icon,
        payload: row.payload,
        alive: row.alive,
        version: row.version,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: null,
      },
    };
  }

  async function requireAliveTemplate(id: string): Promise<TemplateRow> {
    const data = await executor.get('template.get', { id });
    if (data.row === null) {
      throw new TemplatesApiError('E_TEMPLATE_NOT_FOUND', `模板不存在：${id}`);
    }
    const row = toTemplateRow(data.row);
    if (row.alive === 0) {
      throw new TemplatesApiError('E_TEMPLATE_NOT_FOUND', `模板已删除：${id}`);
    }
    return row;
  }

  /** 该父层存活兄弟的最大 sort_key（口径同 dbview.create）。 */
  async function maxSiblingSortKey(workspaceId: string, parentId: string | null): Promise<string | null> {
    const pages = await executor.all('page.listAll', { workspace_id: workspaceId });
    let maxKey: string | null = null;
    for (const row of pages.rows) {
      if (rowString(row, 'parent_id') !== parentId || rowNumber(row, 'alive', 1) !== 1) {
        continue;
      }
      const key = rowString(row, 'sort_key');
      if (key !== null && (maxKey === null || key > maxKey)) {
        maxKey = key;
      }
    }
    return maxKey;
  }

  return {
    async list(input) {
      const kind = input.kind;
      if (kind !== undefined && kind !== 'page' && kind !== 'database' && kind !== 'workbench') {
        throw new TemplatesApiError('E_MALFORMED', 'kind 只能是 page 或 database 或 workbench');
      }
      const data = await executor.all('template.list', { kind: kind ?? null });
      return {
        templates: data.rows.map((row) => {
          const parsed = toTemplateRow(row);
          return {
            id: parsed.id,
            kind: parsed.kind as TemplateKind,
            title: parsed.title,
            icon: parsed.icon,
            updated_at: parsed.updated_at ?? 0,
          };
        }),
      };
    },

    async get(input) {
      if (input.id.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'id 必须是非空字符串');
      }
      const row = await requireAliveTemplate(input.id);
      const payload = parsePayload(row.kind, row.payload);
      return {
        template: {
          id: row.id,
          kind: row.kind as TemplateKind,
          title: row.title,
          icon: row.icon,
          updated_at: row.updated_at ?? 0,
          payload,
        },
      };
    },

    async saveFromPage(input) {
      if (input.pageId.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      if (typeof input.title !== 'string' || input.title.trim().length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'title 必须是非空字符串');
      }
      if (input.icon !== undefined && typeof input.icon !== 'string') {
        throw new TemplatesApiError('E_MALFORMED', 'icon 必须是字符串');
      }
      // 活动工作区存在性守卫（模板表本身无 workspace 列；语义与 blocks 写路径一致：
      // 无工作区 → E_NO_WORKSPACE，不允许在无上下文时落模板）
      await options.activeWorkspaceId();

      const page = await executor.get('page.get', { id: input.pageId });
      if (page.row === null || rowNumber(page.row, 'alive', 1) === 0) {
        throw new TemplatesApiError('E_NOT_FOUND', `页面不存在或已删除：${input.pageId}`);
      }
      const pageIcon = rowString(page.row, 'icon');

      // kind 自动判：有 collection（数据库页）→ 'database'，否则 'page'
      const collection = await executor.get('collection.getByPage', { page_id: input.pageId });
      const isDatabase = collection.row !== null;

      const blocksData = await executor.all('block.listByPage', { page_id: input.pageId });
      const blocks = blocksData.rows.map((row) => blockRowToBlock(row)).filter((block) => block.alive === 1);

      const title = input.title.trim();
      const icon = input.icon ?? pageIcon ?? null;
      let payloadJson: string;
      if (isDatabase) {
        const row = collection.row as Record<string, unknown>;
        let schema: Record<string, unknown> = {};
        let views: unknown[] = [];
        try {
          const parsedSchema = JSON.parse(rowString(row, 'schema_json') ?? '{}') as unknown;
          if (typeof parsedSchema === 'object' && parsedSchema !== null && !Array.isArray(parsedSchema)) {
            schema = parsedSchema as Record<string, unknown>;
          }
        } catch {
          schema = {};
        }
        try {
          const parsedViews = JSON.parse(rowString(row, 'views_json') ?? '[]') as unknown;
          if (Array.isArray(parsedViews)) {
            views = parsedViews;
          }
        } catch {
          views = [];
        }
        const payload: DatabaseTemplatePayload = {
          title,
          icon,
          collection: { name: rowString(row, 'name') ?? '', schema, views },
        };
        if (blocks.length > 0) {
          payload.blocks = blocks;
        }
        payloadJson = JSON.stringify(payload);
      } else {
        const payload: PageTemplatePayload = { title, icon, blocks };
        payloadJson = JSON.stringify(payload);
      }

      const at = now();
      const id = ulid(at);
      // op payload = 模板对象全量（kind='template' 走 LWW 整对象，replay 按整对象生效）
      const op = templateOp(
        id,
        { kind: isDatabase ? 'database' : 'page', title, icon, payload: JSON.parse(payloadJson), alive: 1, updated_at: at },
        1,
      );
      await executor.batch([
        ledgerStatement(op, null),
        templateUpsertStatement({
          id,
          kind: isDatabase ? 'database' : 'page',
          title,
          icon,
          payload: payloadJson,
          alive: 1,
          version: 1,
          createdAt: at,
          updatedAt: at,
        }),
      ]);
      return { id };
    },

    async rename(input) {
      if (input.id.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'id 必须是非空字符串');
      }
      if (typeof input.title !== 'string' || input.title.trim().length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'title 必须是非空字符串');
      }
      if (input.icon !== undefined && typeof input.icon !== 'string') {
        throw new TemplatesApiError('E_MALFORMED', 'icon 必须是字符串');
      }
      const row = await requireAliveTemplate(input.id);
      const payload = parsePayload(row.kind, row.payload);
      const title = input.title.trim();
      const icon = input.icon ?? row.icon;
      // 整对象语义：行与 payload 里的 title/icon 保持同步，op payload 带全量
      payload.title = title;
      payload.icon = icon;
      const at = now();
      const version = row.version + 1;
      const op = templateOp(
        row.id,
        { kind: row.kind, title, icon, payload: JSON.parse(JSON.stringify(payload)), alive: 1, updated_at: at },
        version,
      );
      await executor.batch([
        ledgerStatement(op, null),
        templateUpsertStatement({
          id: row.id,
          kind: row.kind,
          title,
          icon,
          payload: JSON.stringify(payload),
          alive: 1,
          version,
          createdAt: row.created_at,
          updatedAt: at,
        }),
      ]);
      return {};
    },

    async delete(input) {
      if (input.id.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'id 必须是非空字符串');
      }
      const row = await requireAliveTemplate(input.id);
      const at = now();
      const op: Op = {
        op_id: ulid(at),
        lamport: { c: row.version + 1, d: actor },
        at,
        actor,
        target: { table: 'template', id: row.id },
        kind: 'delete',
        payload: {},
      };
      await executor.batch([
        ledgerStatement(op, null),
        {
          sqlId: 'template.softDelete',
          params: { id: row.id, deleted_at: at, version: row.version + 1, updated_at: at },
        },
      ]);
      return {};
    },

    async saveWorkbench(input) {
      if (typeof input.title !== 'string' || input.title.trim().length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'title 必须是非空字符串');
      }
      if (input.layout === undefined || input.layout === null || typeof input.layout !== 'object') {
        throw new TemplatesApiError('E_MALFORMED', 'layout 必须是对象');
      }
      if (!Array.isArray(input.seedPages)) {
        throw new TemplatesApiError('E_MALFORMED', 'seedPages 必须是数组');
      }
      // 布局口径与 workbench/state.ts 一致（v=2 + order/hidden 子集校验由 renderer 侧把关，
      // 这里只做最小结构守卫，避免落野 JSON 进 template 表）。
      const layout = input.layout as WorkbenchTemplateLayout;
      if (layout.v !== 2 || !Array.isArray(layout.order) || !Array.isArray(layout.hidden)) {
        throw new TemplatesApiError('E_MALFORMED', 'layout 形状不合法');
      }
      const seedPages = (input.seedPages as WorkbenchTemplateSeedPage[]).map((page) => ({
        title: typeof page?.title === 'string' ? page.title : '',
        body: typeof page?.body === 'string' ? page.body : '',
      }));
      const title = input.title.trim();
      const payload: WorkbenchTemplatePayload = {
        title,
        layout: { v: 2, order: layout.order.slice(), hidden: layout.hidden.slice() },
        seedPages,
      };
      const at = now();
      const id = ulid(at);
      const op = templateOp(
        id,
        { kind: 'workbench', title, layout: payload.layout, seedPages, alive: 1, updated_at: at },
        1,
      );
      await executor.batch([
        ledgerStatement(op, null),
        templateUpsertStatement({
          id,
          kind: 'workbench',
          title,
          icon: null,
          payload: JSON.stringify(payload),
          alive: 1,
          version: 1,
          createdAt: at,
          updatedAt: at,
        }),
      ]);
      return { id };
    },

    async createPage(input) {
      if (input.templateId.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'templateId 必须是非空字符串');
      }
      if (input.parentId !== null && input.parentId.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'parentId 必须是字符串或 null');
      }
      const row = await requireAliveTemplate(input.templateId);
      const payload = parsePayload(row.kind, row.payload);
      const workspaceId = await options.activeWorkspaceId();
      const at = now();

      if (input.parentId !== null) {
        const parent = await executor.get('page.get', { id: input.parentId });
        if (parent.row === null || rowNumber(parent.row, 'alive', 1) === 0) {
          throw new TemplatesApiError('E_PARENT_GONE', `父页面不存在或已删除：${input.parentId}`);
        }
      }
      let sortKey: string;
      try {
        sortKey = sortBetween(await maxSiblingSortKey(workspaceId, input.parentId), null);
      } catch (error) {
        throw new TemplatesApiError(
          'E_INVARIANT',
          `无法生成排序键：${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const pageId = ulid(at);
      const stmts: DbBatchStatement[] = [];

      // ① 新页（标题/图标取模板）
      const pageOp: Op = {
        op_id: ulid(at),
        lamport: { c: 1, d: actor },
        at,
        actor,
        target: { table: 'page', id: pageId },
        kind: 'upsert',
        payload: {
          title: payload.title,
          icon: payload.icon,
          cover: null,
          parent_id: input.parentId,
          sort_key: sortKey,
          alive: 1,
          deleted_at: null,
          updated_at: at,
        },
      };
      stmts.push(ledgerStatement(pageOp, null));
      stmts.push({
        sqlId: 'page.upsert',
        params: {
          id: pageId,
          workspace_id: workspaceId,
          title: payload.title,
          icon: payload.icon,
          cover: null,
          parent_id: input.parentId,
          sort_key: sortKey,
          alive: 1,
          version: 1,
          deleted_at: null,
          updated_at: at,
        },
      });

      // ② 块深拷贝：两遍——先分配全新 id，再按新 id 重挂 parent_id
      const sourceBlocks: Block[] = Array.isArray(payload.blocks) ? payload.blocks : [];
      const idMap = new Map<string, string>();
      for (const block of sourceBlocks) {
        idMap.set(block.id, ulid(at));
      }
      let blockUpsertCount = 0;
      for (const block of sourceBlocks) {
        const newId = idMap.get(block.id)!;
        const newParentId = typeof block.parent_id === 'string' ? (idMap.get(block.parent_id) ?? null) : null;
        const op: Op = {
          op_id: ulid(at),
          lamport: { c: 1, d: actor },
          at,
          actor,
          target: { table: 'block', id: newId },
          kind: 'upsert',
          payload: {
            page_id: pageId,
            type: block.type,
            props: block.props ?? {},
            content: block.content ?? null,
            parent_id: newParentId,
            sort_key: block.sort_key,
            alive: 1,
            last_edited: at,
          },
        };
        stmts.push(ledgerStatement(op, null));
        stmts.push({
          sqlId: 'block.upsert',
          params: {
            id: newId,
            page_id: pageId,
            workspace_id: workspaceId,
            type: block.type,
            props_json: JSON.stringify(block.props ?? {}),
            content_json:
              block.content === null || block.content === undefined
                ? null
                : typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content),
            sort_key: block.sort_key,
            alive: 1,
            version: 1,
            lamport_c: 1,
            lamport_d: actor,
            updated_at: at,
          },
        });
        blockUpsertCount += 1;
      }

      // ③ 数据库模板：新 collection id（schema/views 复制，records 不复制）
      if (row.kind === 'database') {
        const dbPayload = payload as DatabaseTemplatePayload;
        const collectionId = ulid(at);
        const collectionOp: Op = {
          op_id: ulid(at),
          lamport: { c: 1, d: actor },
          at,
          actor,
          target: { table: 'collection', id: collectionId },
          kind: 'upsert',
          payload: {
            page_id: pageId,
            name: dbPayload.collection.name,
            schema: dbPayload.collection.schema,
            views: dbPayload.collection.views,
            alive: 1,
            updated_at: at,
          },
        };
        stmts.push(ledgerStatement(collectionOp, null));
        stmts.push({
          sqlId: 'collection.upsert',
          params: {
            id: collectionId,
            page_id: pageId,
            workspace_id: workspaceId,
            name: dbPayload.collection.name,
            schema_json: JSON.stringify(dbPayload.collection.schema),
            views_json: JSON.stringify(dbPayload.collection.views),
            alive: 1,
            version: 1,
            lamport_c: 1,
            lamport_d: actor,
            updated_at: at,
          },
        });
      }

      // ④ FTS 维护（照 commitOps 对 block upsert 的尾部追加口径；批量时 defer 头尾开关）
      const deferFts = blockUpsertCount >= 2;
      if (deferFts) {
        stmts.unshift({ sqlId: 'fts.deferOn', params: {} });
      }
      stmts.push({ sqlId: 'fts.clearPage', params: { page_id: pageId } });
      stmts.push({ sqlId: 'fts.syncBlock', params: { page_id: pageId } });
      if (deferFts) {
        stmts.push({ sqlId: 'fts.deferOff', params: {} });
      }

      await executor.batch(stmts);
      return { pageId };
    },
  };
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

/** 最小 IPC 注册面（`main/index.ts` 用 dbViewRegistrar 适配）。 */
export interface TemplatesIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 templates:* 六通道。`service === null`（DbServer 未就绪）时统一回
 * `E_INVARIANT`（与 pages/dbview 的降级一致）。参数在边界再校验一次（不信任 renderer）。
 */
export function registerTemplatesIpc(service: TemplatesService | null, registrar: TemplatesIpcRegistrar): void {
  const requireService = (): TemplatesService => {
    if (service === null) {
      throw new TemplatesApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toTemplatesError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  const asObject = (raw: unknown): Record<string, unknown> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new TemplatesApiError('E_MALFORMED', 'IPC 参数必须是对象');
    }
    return raw as Record<string, unknown>;
  };

  const readText = (input: Record<string, unknown>, key: string): string => {
    const value = input[key];
    if (value === undefined || value === null) {
      throw new TemplatesApiError('E_MALFORMED', `${key} 必填`);
    }
    if (typeof value !== 'string') {
      throw new TemplatesApiError('E_MALFORMED', `${key} 必须是字符串`);
    }
    return value;
  };

  const readOptionalText = (input: Record<string, unknown>, key: string): string | undefined => {
    const value = input[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new TemplatesApiError('E_MALFORMED', `${key} 必须是字符串`);
    }
    return value;
  };

  registrar.handle(CHANNEL_TEMPLATES_LIST, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const kind = readOptionalText(input, 'kind');
      if (kind !== undefined && kind !== 'page' && kind !== 'database' && kind !== 'workbench') {
        throw new TemplatesApiError('E_MALFORMED', 'kind 只能是 page 或 database 或 workbench');
      }
      return await requireService().list(
        kind === undefined ? {} : { kind: kind as TemplateKind },
      );
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_GET, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const id = readText(input, 'id');
      if (id.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'id 必须是非空字符串');
      }
      return await requireService().get({ id });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_SAVE_FROM_PAGE, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const pageId = readText(input, 'pageId');
      const title = readText(input, 'title');
      const icon = readOptionalText(input, 'icon');
      if (pageId.length === 0) {
        throw new TemplatesApiError('E_MALFORMED', 'pageId 必须是非空字符串');
      }
      return await requireService().saveFromPage(
        icon === undefined ? { pageId, title } : { pageId, title, icon },
      );
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_RENAME, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const id = readText(input, 'id');
      const title = readText(input, 'title');
      const icon = readOptionalText(input, 'icon');
      return await requireService().rename(
        icon === undefined ? { id, title } : { id, title, icon },
      );
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_DELETE, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const id = readText(input, 'id');
      return await requireService().delete({ id });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_CREATE_PAGE, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const templateId = readText(input, 'templateId');
      const parentId = readOptionalText(input, 'parentId');
      return await requireService().createPage({
        templateId,
        parentId: parentId === undefined || parentId === null ? null : parentId,
      });
    } catch (error) {
      return fail(error);
    }
  });

  registrar.handle(CHANNEL_TEMPLATES_SAVE_WORKBENCH, async (raw: unknown): Promise<unknown> => {
    try {
      const input = asObject(raw);
      const title = readText(input, 'title');
      const layout = input.layout;
      const seedPages = input.seedPages;
      return await requireService().saveWorkbench({
        title,
        layout: layout as WorkbenchTemplateLayout,
        seedPages: seedPages as WorkbenchTemplateSeedPage[],
      });
    } catch (error) {
      return fail(error);
    }
  });
}
