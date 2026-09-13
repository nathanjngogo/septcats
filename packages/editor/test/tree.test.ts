/**
 * tree.test.ts —— 页面树纯函数的正确性与性能底线（TASK-T6-01 §1/§5）。
 *
 * 覆盖：2000 页随机树（mulberry32）buildTree O(n) + flatten 幂等 / 折叠跳过 / 稳定序、
 * 级联删除不含环、restore 半链、rebalance 有序；环一律 TreeCycleError。
 * 性能断言：buildTree + flatten（2000 页，全展开）< 30ms。
 */
import { describe, expect, it } from 'vitest';
import { sortSequence } from '@septcats/core';
import type { ActorId } from '@septcats/core';
import {
  TreeCycleError,
  TREE_MAX_DEPTH,
  buildTree,
  cascadeDeleteOps,
  childrenIndex,
  collectDescendants,
  flattenVisible,
  nodeChildrenOf,
  planRestore,
  rebalanceLayer,
  restoreOps,
  type PageNode,
} from '../src/tree';

const ACTOR: ActorId = 'aaaa0001';
const NOW = 1_700_000_000_000;
const CTX = { actor: ACTOR, now: NOW } as const;

/** mulberry32：32 位确定性 PRNG（不引依赖，同任务的其它包用同一算法）。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value: number): string {
  return String(value).padStart(6, '0');
}

function makeNode(id: string, parentId: string | null, sortKey: string, version = 1): PageNode {
  return {
    id,
    title: `页面 ${id}`,
    icon: null,
    cover: null,
    workspaceId: 'ws-test',
    parentId,
    sortKey,
    version,
    alive: 1,
    deletedAt: null,
    childIds: [],
    depth: 0,
  };
}

/**
 * 随机树：`parent[i] < i` 保证无环；约 4% 为根；兄弟 sortKey 由创建序递增生成。
 */
function randomTree(count: number, seed: number): PageNode[] {
  const random = mulberry32(seed);
  const nodes: PageNode[] = [];
  const siblingCount = new Map<string, number>();
  for (let i = 0; i < count; i += 1) {
    const id = `pg-${String(i).padStart(5, '0')}`;
    let parentId: string | null = null;
    if (i > 0 && random() > 0.04) {
      parentId = `pg-${String(Math.floor(random() * i)).padStart(5, '0')}`;
    }
    const counterKey = parentId ?? '__root__';
    const ordinal = siblingCount.get(counterKey) ?? 0;
    siblingCount.set(counterKey, ordinal + 1);
    nodes.push(makeNode(id, parentId, pad(ordinal)));
  }
  return nodes;
}

function reachableCount(index: ReturnType<typeof buildTree>): number {
  let total = 0;
  const seen = new Set<string>();
  const stack = [...index.roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    total += 1;
    stack.push(...(index.childrenOf.get(node.id) ?? []));
  }
  return total;
}

describe('buildTree', () => {
  it('2000 页随机树：全部可达、maxDepth 正确、O(n) 且 < 30ms', () => {
    const pages = randomTree(2000, 20260913);
    const started = performance.now();
    const tree = buildTree(pages);
    const buildMs = performance.now() - started;

    expect(reachableCount(tree)).toBe(pages.length);
    expect(tree.maxDepth).toBeGreaterThan(0);
    expect(tree.maxDepth).toBeLessThanOrEqual(TREE_MAX_DEPTH);

    // 全展开的 flatten 也在同一预算内（任务书 §5：buildTree + flatten < 30ms）
    const expanded = new Set(pages.map((page) => page.id));
    const flattenStarted = performance.now();
    const rows = flattenVisible(tree.roots, expanded, tree.childrenOf);
    const flattenMs = performance.now() - flattenStarted;

    expect(rows.length).toBe(pages.length);
    // 宽松打印便于 PM 观察真实余量
    expect(buildMs + flattenMs, `build=${buildMs.toFixed(2)}ms flatten=${flattenMs.toFixed(2)}ms`).toBeLessThan(30);
  });

  it('兄弟序 = sortKey 升序（id 决胜），childIds 与 childrenOf 同源', () => {
    const pages = [
      makeNode('a', null, '000002'),
      makeNode('b', null, '000001'),
      makeNode('c', 'a', '000020'),
      makeNode('d', 'a', '000010'),
    ];
    const tree = buildTree(pages);
    expect(tree.roots.map((node) => node.id)).toEqual(['b', 'a']);
    expect(tree.childrenOf.get('a')?.map((node) => node.id)).toEqual(['d', 'c']);
    const byId = new Map(tree.roots.map((node) => [node.id, node]));
    expect(byId.get('a')?.childIds).toEqual(['d', 'c']);
    expect(tree.maxDepth).toBe(1);
  });

  it('不改写入参（返回派生副本），孤儿父按根处理', () => {
    const pages = [makeNode('a', null, '000001'), makeNode('b', 'ghost', '000002')];
    const tree = buildTree(pages);
    expect(pages[0]?.depth).toBe(0);
    expect(pages[1]?.childIds).toEqual([]);
    expect(tree.roots.map((node) => node.id).sort()).toEqual(['a', 'b']);
  });

  it('parent 链成环 → TreeCycleError（数据损坏信号，不静默丢数据）', () => {
    const pages = [makeNode('a', 'b', '000001'), makeNode('b', 'a', '000002')];
    expect(() => buildTree(pages)).toThrow(TreeCycleError);
  });
});

describe('flattenVisible', () => {
  it('折叠子树跳过；展开全部即全量；两次调用幂等', () => {
    const pages = randomTree(300, 7);
    const tree = buildTree(pages);

    const collapsed = flattenVisible(tree.roots, new Set(), tree.childrenOf);
    expect(collapsed.map((row) => row.node.id)).toEqual(tree.roots.map((node) => node.id));
    expect(collapsed.every((row) => row.depth === 0)).toBe(true);

    const expanded = new Set(pages.map((page) => page.id));
    const first = flattenVisible(tree.roots, expanded, tree.childrenOf);
    const second = flattenVisible(tree.roots, expanded, tree.childrenOf);
    expect(second).toEqual(first);
    expect(first.length).toBe(pages.length);
  });

  it('hasChildren 与 depth 正确；每个父的子行按 sortKey 升序出现', () => {
    const pages = randomTree(400, 99);
    const tree = buildTree(pages);
    const rows = flattenVisible(tree.roots, new Set(pages.map((page) => page.id)), tree.childrenOf);

    for (const row of rows) {
      expect(row.hasChildren).toBe(row.node.childIds.length > 0);
    }

    const seen = new Map<string, PageNode[]>();
    for (const row of rows) {
      const key = row.node.parentId ?? '__root__';
      const list = seen.get(key);
      if (list === undefined) {
        seen.set(key, [row.node]);
      } else {
        list.push(row.node);
      }
    }
    for (const list of seen.values()) {
      const keys = list.map((node) => node.sortKey);
      expect([...keys].sort()).toEqual(keys);
    }
  });

  it('缺省 childrenOf 时就地组树，结果与显式传索引一致', () => {
    const pages = randomTree(200, 5);
    const tree = buildTree(pages);
    const expanded = new Set(pages.map((page) => page.id));
    const implicit = flattenVisible(pages, expanded);
    const explicit = flattenVisible(tree.roots, expanded, tree.childrenOf);
    expect(implicit.map((row) => row.node.id)).toEqual(explicit.map((row) => row.node.id));
    expect(implicit.map((row) => row.depth)).toEqual(explicit.map((row) => row.depth));
  });
});

describe('collectDescendants / 索引', () => {
  it('返回全部后代（不含自身），顺序跟随 childrenOf', () => {
    const childrenOf = new Map<string, string[]>([
      ['a', ['b', 'c']],
      ['b', ['d']],
    ]);
    // 实现是 DFS 前序：a → b → b 的子 d → c。级联删除按视觉序（子树连续）展示与还原。
    expect(collectDescendants('a', childrenOf)).toEqual(['b', 'd', 'c']);
    expect(collectDescendants('b', childrenOf)).toEqual(['d']);
    expect(collectDescendants('d', childrenOf)).toEqual([]);
  });

  it('childrenIndex 跳过自环与孤儿父；nodeChildrenOf 可反推节点列表', () => {
    const pages = [makeNode('a', null, '000001'), makeNode('b', 'ghost', '000002'), makeNode('x', 'x', '000003')];
    const index = childrenIndex(pages);
    expect([...index.keys()]).toEqual([]);
    expect(childrenIndex([...pages, makeNode('c', 'a', '000004')]).get('a')).toEqual(['c']);

    // nodeChildrenOf 吃 childrenIndex 的 id 索引；buildTree 的 childrenOf 是节点索引（类型不同）
    const sub = [makeNode('a', null, '000001'), makeNode('c', 'a', '000004')];
    const nodes = nodeChildrenOf(sub, childrenIndex(sub));
    expect(nodes.get('a')?.map((node) => node.id)).toEqual(['c']);
    expect(buildTree(sub).maxDepth).toBe(1);
  });

  it('环 → TreeCycleError；深度超上限 → TreeCycleError', () => {
    const cyclic = new Map<string, string[]>([['a', ['b']], ['b', ['a']]]);
    expect(() => collectDescendants('a', cyclic)).toThrow(TreeCycleError);

    const deep = new Map<string, string[]>();
    for (let i = 0; i <= TREE_MAX_DEPTH + 2; i += 1) {
      deep.set(`n${String(i)}`, [`n${String(i + 1)}`]);
    }
    expect(() => collectDescendants('n0', deep)).toThrow(TreeCycleError);
  });
});

describe('cascadeDeleteOps', () => {
  it('自身 + 后代 = 一条一笔，跳过已删除，起点已删则空', () => {
    const pages = [
      makeNode('a', null, '000001'),
      makeNode('b', 'a', '000002'),
      makeNode('c', 'b', '000003'),
      makeNode('d', 'a', '000004'),
      makeNode('e', null, '000005'),
    ];
    const ops = cascadeDeleteOps(pages, 'a', CTX);
    expect(ops.map((op) => op.target.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(ops.every((op) => op.kind === 'delete')).toBe(true);
    expect(ops.every((op) => op.target.table === 'page')).toBe(true);
    expect(ops.every((op) => Object.keys(op.payload).length === 0)).toBe(true);
    expect(new Set(ops.map((op) => op.op_id)).size).toBe(ops.length);

    const halfDead = pages.map((page) => (page.id === 'b' ? { ...page, alive: 0 as const } : page));
    expect(cascadeDeleteOps(halfDead, 'a', CTX).map((op) => op.target.id)).toEqual(['a', 'c', 'd']);

    const gone = pages.map((page) => (page.id === 'a' ? { ...page, alive: 0 as const } : page));
    expect(cascadeDeleteOps(gone, 'a', CTX)).toEqual([]);
    expect(cascadeDeleteOps(pages, 'missing', CTX)).toEqual([]);
  });

  it('含环的数据 → TreeCycleError（绝不静默截断）', () => {
    const pages = [makeNode('a', 'b', '000001'), makeNode('b', 'a', '000002')];
    const index = new Map<string, string[]>([['a', ['b']], ['b', ['a']]]);
    expect(() => collectDescendants('a', index)).toThrow(TreeCycleError);
    expect(() => buildTree(pages)).toThrow(TreeCycleError);
  });

  it('2000 页：全树删除 = 2000 条 op，版本各自 +1', () => {
    const pages = randomTree(2000, 4242).map((page, index) => ({ ...page, version: index + 1 }));
    const root = pages[0];
    expect(root).toBeDefined();
    const ops = cascadeDeleteOps(pages, root!.id, CTX);
    const subtree = [root!.id, ...collectDescendants(root!.id, childrenIndex(pages))];
    expect(ops.length).toBe(subtree.length);
    for (const op of ops) {
      expect(op.lamport.c).toBeGreaterThanOrEqual(1);
      expect(op.lamport.d).toBe(ACTOR);
    }
  });
});

describe('restoreOps / planRestore（半链）', () => {
  const base = [
    makeNode('a', null, '000001', 3),
    makeNode('b', 'a', '000002', 4),
    makeNode('c', 'b', '000003', 5),
    makeNode('d', 'a', '000004', 6),
  ];
  const deleted = base.map((page) => ({ ...page, alive: 0 as const, deletedAt: NOW }));

  it('父存活 → 复活自身 + 仍为 tombstone 的后代（upsert 整对象，alive=1）', () => {
    const pages = [base[0]!, deleted[1]!, deleted[2]!, base[3]!];
    const plan = planRestore(pages, 'b', CTX);
    expect(plan.reason).toBeNull();
    expect(plan.ops.map((op) => op.target.id)).toEqual(['b', 'c']);
    const first = plan.ops[0];
    expect(first?.kind).toBe('upsert');
    expect(first?.lamport.c).toBe(5);
    expect(first?.payload).toMatchObject({
      workspace_id: 'ws-test',
      parent_id: 'a',
      sort_key: '000002',
      alive: 1,
      deleted_at: null,
    });
    // restoreOps 是 planRestore 的 Op 列表视图（op_id 为 ULID，逐次生成，故只比结构）
    const viaRestore = restoreOps(pages, 'b', CTX);
    expect(viaRestore.map((op) => op.target.id)).toEqual(plan.ops.map((op) => op.target.id));
    expect(viaRestore.map((op) => op.kind)).toEqual(plan.ops.map((op) => op.kind));
    expect(viaRestore.map((op) => op.payload)).toEqual(plan.ops.map((op) => op.payload));
  });

  it('父仍死 → 空数组 + reason=parent-gone（整链不复活）', () => {
    const plan = planRestore(deleted, 'c', CTX);
    expect(plan.ops).toEqual([]);
    expect(plan.reason).toBe('parent-gone');
    expect(restoreOps(deleted, 'c', CTX)).toEqual([]);
  });

  it('起点不存在 / 本就存活 → 空计划且无原因', () => {
    expect(planRestore(deleted, 'missing', CTX)).toEqual({ ops: [], reason: null });
    expect(planRestore(base, 'a', CTX)).toEqual({ ops: [], reason: null });
  });

  it('恢复只发 alive=0 的链，已存活的兄弟不动', () => {
    const pages = [base[0]!, deleted[1]!, base[2]!, deleted[3]!];
    const plan = planRestore(pages, 'b', CTX);
    expect(plan.ops.map((op) => op.target.id)).toEqual(['b']);
  });
});

describe('rebalanceLayer', () => {
  it('gen 有序时逐条重发 reorder，键与生成序一致', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const versions = new Map([
      ['a', 1],
      ['b', 7],
      ['c', 2],
      ['d', 0],
    ]);
    const ops = rebalanceLayer(ids, (i, n) => sortSequence(n)[i] ?? '', { ...CTX, versions });
    expect(ops.map((op) => op.target.id)).toEqual(ids);
    expect(ops.every((op) => op.kind === 'reorder')).toBe(true);
    const keys = ops.map((op) => String(op.payload['sort_key']));
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ops.map((op) => op.lamport.c)).toEqual([2, 8, 3, 1]);
  });

  it('gen 非严格递增 → throw；空 ids → 空数组', () => {
    expect(() => rebalanceLayer(['a', 'b'], () => 'same', CTX)).toThrow(/严格递增/);
    expect(() => rebalanceLayer(['a', 'b'], () => '', CTX)).toThrow(/非空排序键/);
    expect(rebalanceLayer([], (i, n) => sortSequence(n)[i] ?? '', CTX)).toEqual([]);
  });

  it('2000 页同层：一批 reorder，全部带递增键', () => {
    const ids = Array.from({ length: 2000 }, (_value, index) => `pg-${String(index)}`);
    const ops = rebalanceLayer(ids, (i, n) => sortSequence(n)[i] ?? '', CTX);
    expect(ops.length).toBe(2000);
    const keys = ops.map((op) => String(op.payload['sort_key']));
    expect(keys.every((key, index) => index === 0 || (keys[index - 1] as string) < key)).toBe(true);
  });
});
