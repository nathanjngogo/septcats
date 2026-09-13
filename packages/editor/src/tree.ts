/**
 * tree.ts —— 页面树的纯派生逻辑（TASK-T6-01 §1）。
 *
 * 边界：本文件只做 **pages ↔ 树 / 重平衡 / 回收站级联**，不 import react、不碰 fs/db/IPC，
 * 因此可在纯 Node 下用 2000 页随机树做性能与正确性断言（`test/tree.test.ts`）。
 *
 * 与 schema-v1 的关系：
 * - page 实体字段照 §4（workspace_id/title/icon/cover/parent_id/sort_key/alive/version）；
 *   `deletedAt` 是 v2 物化层新增的**设备本地**列（回收站保留期），不进 Op payload。
 * - 删除 = 子树 tombstone（§5.2：一次事务 N 条 delete）；恢复 = upsert 整对象（alive=1）。
 * - 重平衡 = 对同层全部兄弟重发 reorder（§5.1 的失败降级路径）。
 *
 * 环的处理口径：parent 链成环是**数据损坏信号**，一律 throw `TreeCycleError`，
 * 绝不静默丢弃（渲染层捕获后走 ErrorPanel，见 renderer/src/state/pages.ts）。
 */
import { ulid } from '@septcats/core';
import type { ActorId, Op } from '@septcats/core';

/** Op 的 page 目标表名（复述 core 的 TargetTable 语义）。 */
export const PAGE_TARGET_TABLE = 'page';

/**
 * 树深上限。parent 链深于该值即判定为环/损坏（2000 页正常树的深度是个位数）。
 */
export const TREE_MAX_DEPTH = 50;

/** 检测到 parent/children 链成环（或深度超过 TREE_MAX_DEPTH）时抛出。 */
export class TreeCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TreeCycleError';
    Object.setPrototypeOf(this, TreeCycleError.prototype);
  }
}

/**
 * 树节点。任务书 §1 的字段（id/title/icon/childIds/parentId/depth/alive）全在，
 * 另补 `sortKey`（稳定序必需）、`workspaceId`/`cover`/`version`/`deletedAt`
 * （级联删除与恢复要造 Op 与整对象 payload，否则无法写回物化层）。
 * `childIds` 与 `depth` 由 `buildTree` 派生填充。
 */
export interface PageNode {
  id: string;
  title: string;
  icon: string | null;
  cover: string | null;
  workspaceId: string;
  parentId: string | null;
  sortKey: string;
  version: number;
  alive: 1 | 0;
  deletedAt: number | null;
  /** 派生：直接子节点 id（sortKey 升序、id 决胜）。 */
  childIds: string[];
  /** 派生：根为 0 的层级。 */
  depth: number;
}

/** 造 Op 的上下文（LWW 需要 actor，排序键重发需要 now）。 */
export interface TreeContext {
  actor: ActorId;
  now: number;
}

/** `buildTree` 的结果索引。 */
export interface TreeIndex {
  roots: PageNode[];
  childrenOf: Map<string, PageNode[]>;
  /** 最深层级（根 = 0；空树 = 0）。 */
  maxDepth: number;
}

/** `flattenVisible` 的行。 */
export interface FlatRow {
  node: PageNode;
  depth: number;
  hasChildren: boolean;
}

/** 兄弟序：sortKey 升序，等键按 id 稳定决胜（与物化层 `ORDER BY sort_key, id` 一致）。 */
export function comparePageOrder(a: PageNode, b: PageNode): number {
  if (a.sortKey !== b.sortKey) {
    return a.sortKey < b.sortKey ? -1 : 1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

function byNodeId(pages: readonly PageNode[]): Map<string, PageNode> {
  const map = new Map<string, PageNode>();
  for (const page of pages) {
    // PK 约束下不会有重复 id；万一有，后到者覆盖（保持确定性，不抛）
    map.set(page.id, page);
  }
  return map;
}

/**
 * 按 parentId 建「父 id → 子 id 列表」索引，子列表按 sortKey 升序（id 决胜）。
 * 自环（parentId === id）与「父不在集合内」的孤儿都不进索引（会被当作根）。
 */
export function childrenIndex(pages: readonly PageNode[]): Map<string, string[]> {
  const known = new Set<string>();
  for (const page of pages) {
    known.add(page.id);
  }
  const sorted = [...pages].sort(comparePageOrder);
  const index = new Map<string, string[]>();
  for (const page of sorted) {
    const parentId = page.parentId;
    if (parentId === null || parentId === page.id || !known.has(parentId)) {
      continue;
    }
    const list = index.get(parentId);
    if (list === undefined) {
      index.set(parentId, [page.id]);
    } else {
      list.push(page.id);
    }
  }
  return index;
}

/**
 * 由「父 id → 子 id」索引反推「父 id → 子节点」索引（供 flatten/rebalance 用）。
 */
export function nodeChildrenOf(
  pages: readonly PageNode[],
  index: ReadonlyMap<string, readonly string[]>,
): Map<string, PageNode[]> {
  const byId = byNodeId(pages);
  const out = new Map<string, PageNode[]>();
  for (const [parentId, childIds] of index) {
    const list: PageNode[] = [];
    for (const childId of childIds) {
      const child = byId.get(childId);
      if (child !== undefined) {
        list.push(child);
      }
    }
    out.set(parentId, list);
  }
  return out;
}

/**
 * 组树。O(n)：一次建索引 + 一次算深度。
 * - 根 = parentId 为 null，或父不在集合内（孤儿，宁可显示为根也不丢数据）；
 * - 未从任何根可达的节点 = parent 链成环 → throw TreeCycleError（数据损坏信号）。
 */
export function buildTree(pages: readonly PageNode[]): TreeIndex {
  const nodes = new Map<string, PageNode>();
  for (const page of pages) {
    nodes.set(page.id, { ...page, childIds: [], depth: 0 });
  }

  const childrenOf = new Map<string, PageNode[]>();
  const roots: PageNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    if (parent === undefined || parent.id === node.id) {
      roots.push(node);
      continue;
    }
    const list = childrenOf.get(parent.id);
    if (list === undefined) {
      childrenOf.set(parent.id, [node]);
    } else {
      list.push(node);
    }
  }

  for (const list of childrenOf.values()) {
    list.sort(comparePageOrder);
  }
  roots.sort(comparePageOrder);
  for (const node of nodes.values()) {
    node.childIds = (childrenOf.get(node.id) ?? []).map((child) => child.id);
  }

  // 深度：从根逐层下推（不用递归，避免深链爆栈）
  let maxDepth = 0;
  const visited = new Set<string>();
  let frontier = roots;
  let depth = 0;
  while (frontier.length > 0) {
    if (depth > TREE_MAX_DEPTH) {
      throw new TreeCycleError(`buildTree：树深超过 ${TREE_MAX_DEPTH}，疑似 parent 链成环`);
    }
    const next: PageNode[] = [];
    for (const node of frontier) {
      if (visited.has(node.id)) {
        continue;
      }
      visited.add(node.id);
      node.depth = depth;
      for (const child of childrenOf.get(node.id) ?? []) {
        if (!visited.has(child.id)) {
          next.push(child);
        }
      }
    }
    if (next.length > 0) {
      depth += 1;
      maxDepth = depth;
    }
    frontier = next;
  }

  if (visited.size !== nodes.size) {
    const dangling = [...nodes.keys()].filter((id) => !visited.has(id));
    throw new TreeCycleError(
      `buildTree：${String(dangling.length)} 个页面不在任何根的子树上（parent 链成环）：${dangling.slice(0, 3).join(', ')}`,
    );
  }

  return { roots, childrenOf, maxDepth };
}

/**
 * 可见行（折叠子树跳过）。
 *
 * `childrenOf` 缺省时退化为「就地组树」：把 `roots` 当作**任意节点集合**（不必是真根），
 * 由 parentId 自行推导子树——这样调用方既能 `flattenVisible(tree.roots, expanded, tree.childrenOf)`，
 * 也能 `flattenVisible(allNodes, expanded)`。
 * 稳定序 = sortKey 升序（id 决胜）；visited 集防重复/防环。
 */
export function flattenVisible(
  roots: readonly PageNode[],
  expanded: ReadonlySet<string>,
  childrenOf?: ReadonlyMap<string, readonly PageNode[]>,
): FlatRow[] {
  let rootList: readonly PageNode[] = roots;
  let children: ReadonlyMap<string, readonly PageNode[]> | undefined = childrenOf;

  if (children === undefined) {
    const index = buildTree(roots);
    rootList = index.roots;
    children = index.childrenOf;
  }

  const out: FlatRow[] = [];
  const visited = new Set<string>();
  const stack: Array<{ node: PageNode; depth: number }> = [];
  for (let i = rootList.length - 1; i >= 0; i -= 1) {
    const node = rootList[i];
    if (node !== undefined) {
      stack.push({ node, depth: 0 });
    }
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) {
      continue;
    }
    const { node, depth } = entry;
    if (visited.has(node.id)) {
      continue;
    }
    visited.add(node.id);
    const kids = children.get(node.id) ?? [];
    out.push({ node, depth, hasChildren: kids.length > 0 });
    if (!expanded.has(node.id)) {
      continue;
    }
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const kid = kids[i];
      if (kid !== undefined) {
        stack.push({ node: kid, depth: depth + 1 });
      }
    }
  }
  return out;
}

/**
 * 收集 id 的全部后代（不含自身），**DFS 前序**（父先于子、子树整体连续），
 * 即侧栏视觉序 —— 与 doc 注释承诺一致，级联删除/恢复与"删除预览"都可直接展示该顺序。
 * 防环：visited 集（重复访问即环）+ 深度上限 `TREE_MAX_DEPTH` → throw TreeCycleError。
 * 输出顺序跟随 `childrenOf` 数组顺序（调用方传 sortKey 升序即视觉序）。
 */
export function collectDescendants(
  id: string,
  childrenOf: ReadonlyMap<string, readonly string[]>,
): string[] {
  const out: string[] = [];
  const visited = new Set<string>([id]);
  const stack: Array<{ id: string; depth: number }> = [{ id, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      continue;
    }
    // 出栈即前序访问点（根自身不计入后代）
    if (current.id !== id) {
      out.push(current.id);
    }
    const kids = childrenOf.get(current.id) ?? [];
    const childDepth = current.depth + 1;
    // 逆序入栈：栈 LIFO，出栈顺序 = kids 原顺序（视觉序）
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const childId = kids[i];
      if (childId === undefined) {
        continue;
      }
      if (visited.has(childId)) {
        throw new TreeCycleError(
          `collectDescendants：检测到环（${childId} 被重复访问，起点 ${id}）`,
        );
      }
      if (childDepth > TREE_MAX_DEPTH) {
        throw new TreeCycleError(
          `collectDescendants：深度超过 ${TREE_MAX_DEPTH}（疑似父链成环，起点 ${id}）`,
        );
      }
      visited.add(childId);
      stack.push({ id: childId, depth: childDepth });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Op 构造
// ---------------------------------------------------------------------------

function makePageOp(
  node: PageNode,
  kind: Op['kind'],
  payload: Record<string, unknown>,
  ctx: TreeContext,
): Op {
  return {
    op_id: ulid(ctx.now),
    lamport: { c: Math.max(1, node.version + 1), d: ctx.actor },
    at: ctx.now,
    actor: ctx.actor,
    target: { table: PAGE_TARGET_TABLE, id: node.id },
    kind,
    payload,
  };
}

/** 整对象 payload（upsert 用；version 由 lamport 承载，不进 payload —— 见 schema-v1 §2）。 */
function pagePayload(node: PageNode, alive: 0 | 1, ctx: TreeContext): Record<string, unknown> {
  return {
    workspace_id: node.workspaceId,
    title: node.title,
    icon: node.icon,
    cover: node.cover,
    parent_id: node.parentId,
    sort_key: node.sortKey,
    alive,
    deleted_at: alive === 1 ? null : node.deletedAt,
    updated_at: ctx.now,
  };
}

function deleteOp(node: PageNode, ctx: TreeContext): Op {
  return makePageOp(node, 'delete', {}, ctx);
}

function restoreOp(node: PageNode, ctx: TreeContext): Op {
  return makePageOp(node, 'upsert', pagePayload(node, 1, ctx), ctx);
}

function reorderOp(id: string, sortKey: string, version: number, ctx: TreeContext): Op {
  return {
    op_id: ulid(ctx.now),
    lamport: { c: Math.max(1, version + 1), d: ctx.actor },
    at: ctx.now,
    actor: ctx.actor,
    target: { table: PAGE_TARGET_TABLE, id },
    kind: 'reorder',
    payload: { sort_key: sortKey },
  };
}

// ---------------------------------------------------------------------------
// 级联删除 / 恢复 / 重平衡
// ---------------------------------------------------------------------------

/**
 * 级联删除：自身 + 后代（按视觉序 DFS）→ 一批 delete op（同事务由 commitOps 保证）。
 * 已 alive=0 的节点不再发 delete（幂等，避免重复事件）。
 * 起点不存在或已删除 → 空数组。
 */
export function cascadeDeleteOps(
  pages: readonly PageNode[],
  id: string,
  ctx: TreeContext,
): Op[] {
  const byId = byNodeId(pages);
  const root = byId.get(id);
  if (root === undefined || root.alive === 0) {
    return [];
  }
  const index = childrenIndex(pages);
  const targets = [id, ...collectDescendants(id, index)];
  const ops: Op[] = [];
  for (const targetId of targets) {
    const node = byId.get(targetId);
    if (node === undefined || node.alive === 0) {
      continue;
    }
    ops.push(deleteOp(node, ctx));
  }
  return ops;
}

/** `planRestore` 的放弃原因。'parent-gone'=父仍死，复活会挂到死父下，故整链不复活。 */
export type RestoreReason = 'parent-gone';

export interface RestorePlan {
  ops: Op[];
  reason: RestoreReason | null;
}

/**
 * 恢复计划：只复活 alive=0 的链（自身 + 其下仍为 tombstone 的后代）。
 * 父仍死 → `{ ops: [], reason: 'parent-gone' }`；起点不存在/本就存活 → 空计划、无原因。
 */
export function planRestore(
  pages: readonly PageNode[],
  id: string,
  ctx: TreeContext,
): RestorePlan {
  const byId = byNodeId(pages);
  const root = byId.get(id);
  if (root === undefined || root.alive === 1) {
    return { ops: [], reason: null };
  }
  if (root.parentId !== null) {
    const parent = byId.get(root.parentId);
    if (parent !== undefined && parent.alive === 0) {
      return { ops: [], reason: 'parent-gone' };
    }
  }

  const index = childrenIndex(pages);
  const targets = [id, ...collectDescendants(id, index)];
  const ops: Op[] = [];
  for (const targetId of targets) {
    const node = byId.get(targetId);
    if (node === undefined || node.alive === 1) {
      continue;
    }
    ops.push(restoreOp(node, ctx));
  }
  return { ops, reason: null };
}

/** 同 `planRestore`，只取 Op 列表（任务书 §1 的签名）。 */
export function restoreOps(pages: readonly PageNode[], id: string, ctx: TreeContext): Op[] {
  return planRestore(pages, id, ctx).ops;
}

/** 重平衡上下文：`versions` 给每条 reorder 提供正确的 Lamport 基（缺省按 0 起算）。 */
export interface LayerContext extends TreeContext {
  versions?: ReadonlyMap<string, number>;
}

/**
 * 整层重平衡：对 `ids` 里的**每一个** alive 兄弟重发 reorder，键由 `gen(i, n)` 生成。
 * - `gen` 必须产出严格递增的非空排序键（如 `sortSequence`），否则 throw（fail loud）；
 * - 全量重发（而非只发变化的）是刻意的：调用方在密集无空位时已失去「谁变了」的可靠判据，
 *   整层重发才与 §5.1「密集无解时整层重平衡 → 一批 reorder」一致。
 */
export function rebalanceLayer(
  ids: readonly string[],
  gen: (i: number, n: number) => string,
  ctx: LayerContext,
): Op[] {
  const total = ids.length;
  if (total === 0) {
    return [];
  }

  const keys: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const key = gen(i, total);
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error(`rebalanceLayer：gen(${String(i)}, ${String(total)}) 未产出非空排序键`);
    }
    const previous = keys[i - 1];
    if (previous !== undefined && previous >= key) {
      throw new Error(
        `rebalanceLayer：gen 必须生成严格递增的排序键（第 ${String(i)} 项 '${key}' <= '${previous}'）`,
      );
    }
    keys.push(key);
  }

  const ops: Op[] = [];
  for (let i = 0; i < total; i += 1) {
    const id = ids[i];
    const key = keys[i];
    if (id === undefined || key === undefined) {
      continue;
    }
    ops.push(reorderOp(id, key, ctx.versions?.get(id) ?? 0, ctx));
  }
  return ops;
}
