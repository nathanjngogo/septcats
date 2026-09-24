import { describe, expect, it } from 'vitest';
import type { Block, BlockDoc } from '../src/model';
import { extendBulkSelection, groupDropOrder, intervalIds } from '../src/selection';
import { planBlockDrop, planBlockGroupDrop } from '../src/react/dnd';

/**
 * T78-01 纯函数面：跨块多选的区间计算 / 扩选状态机 / 组落位序（selection.ts）
 * 与组落位计划（react/dnd.ts）。视图只接线，语义全在这里钉死。
 */

function blk(id: string, sortKey: string, extra: Partial<Block> = {}): Block {
  return {
    id,
    page_id: 'pg-t78',
    type: 'paragraph',
    props: {},
    content: null,
    parent_id: null,
    sort_key: sortKey,
    alive: 1,
    version: 1,
    last_edited: 0,
    ...extra,
  };
}

function doc(blocks: Block[]): BlockDoc {
  return { pageId: 'pg-t78', blocks };
}

const CTX = { actor: 'editor0001', now: 1_700_000_000_000 };
const ORDER = ['b1', 'b2', 'b3', 'b4', 'b5'];

describe('intervalIds（区间=文档序切片，含两端）', () => {
  it('正向：锚 b1 → 焦点 b3 = [b1,b2,b3]', () => {
    expect(intervalIds(ORDER, 'b1', 'b3')).toEqual(['b1', 'b2', 'b3']);
  });

  it('反向：锚 b4 → 焦点 b2 = [b2,b3,b4]（与点击先后无关，恒按文档序）', () => {
    expect(intervalIds(ORDER, 'b4', 'b2')).toEqual(['b2', 'b3', 'b4']);
  });

  it('单块：锚=焦点 = 单元素区间', () => {
    expect(intervalIds(ORDER, 'b3', 'b3')).toEqual(['b3']);
  });

  it('锚/焦点任一不在文档序（文档已变）→ []（保守回退无选区）', () => {
    expect(intervalIds(ORDER, 'b1', 'zz')).toEqual([]);
    expect(intervalIds(ORDER, 'zz', 'b3')).toEqual([]);
  });
});

describe('extendBulkSelection（Shift+click 状态机：重算区间，禁集合并）', () => {
  it('无选区 → 锚 = 当前焦点块，焦点 = 被点块', () => {
    expect(extendBulkSelection(null, 'b1', 'b3')).toEqual({ anchorId: 'b1', focusId: 'b3' });
  });

  it('无焦点块兜底 → 锚 = 被点块本身（点哪算哪）', () => {
    expect(extendBulkSelection(null, null, 'b3')).toEqual({ anchorId: 'b3', focusId: 'b3' });
  });

  it('二次扩选：锚块**不变**（区间重算而非并集）', () => {
    const first = extendBulkSelection(null, 'b1', 'b3');
    const second = extendBulkSelection(first, 'b2', 'b5');
    expect(second).toEqual({ anchorId: 'b1', focusId: 'b5' });
    // 重算后的区间 = b1..b5（中途 b3 不残留「并集」痕迹）
    expect(intervalIds(ORDER, second.anchorId, second.focusId)).toEqual(ORDER);
  });

  it('锚块随选区收缩：焦点回到锚块左侧 → 区间仍在锚块与焦点之间', () => {
    const first = extendBulkSelection(null, 'b4', 'b5');
    const second = extendBulkSelection(first, 'b1', 'b2');
    expect(intervalIds(ORDER, second.anchorId, second.focusId)).toEqual(['b2', 'b3', 'b4']);
  });
});

describe('groupDropOrder（组整体落位序，保组内相对序）', () => {
  it('组 [b1,b2] 移到 b4 之前 → [b3,b1,b2,b4,b5]', () => {
    expect(groupDropOrder(ORDER, ['b1', 'b2'], 'b4')).toEqual(['b3', 'b1', 'b2', 'b4', 'b5']);
  });

  it('beforeId=null → 整组搬到末尾（保相对序）', () => {
    expect(groupDropOrder(ORDER, ['b2', 'b4'], null)).toEqual(['b1', 'b3', 'b5', 'b2', 'b4']);
  });

  it('落点在被移动集合内（拖到自己身上）→ null（无操作）', () => {
    expect(groupDropOrder(ORDER, ['b1', 'b2'], 'b2')).toBeNull();
  });

  it('位置没变 → null；有空 id → null；空组 → null', () => {
    expect(groupDropOrder(ORDER, ['b2', 'b3'], 'b4')).toBeNull(); // 原地（b2,b3 已在 b4 前）
    expect(groupDropOrder(ORDER, ['b2', 'zz'], 'b4')).toBeNull();
    expect(groupDropOrder(ORDER, [], 'b4')).toBeNull();
    expect(groupDropOrder(ORDER, ['b1'], 'zz')).toBeNull();
  });

  it('反向移动（组搬到较前位置）同样保相对序', () => {
    expect(groupDropOrder(ORDER, ['b4', 'b5'], 'b2')).toEqual(['b1', 'b4', 'b5', 'b2', 'b3']);
  });
});

describe('planBlockGroupDrop（组拖拽落位计划）', () => {
  const four = doc([
    blk('b1', 'A00000000'),
    blk('b2', 'A00000001'),
    blk('b3', 'A00000002'),
    blk('b4', 'A00000003'),
  ]);

  it('组 [b1,b2] 移到 b4 之前：组内一次分配 2 个键，严格介于前后邻之间且递增', () => {
    const plan = planBlockGroupDrop(four, CTX, ['b1', 'b2'], 'b4');
    expect(plan.kind).toBe('reorder');
    expect(plan.assignments.map((entry) => entry.id)).toEqual(['b1', 'b2']);
    const [k1, k2] = plan.assignments.map((entry) => entry.sort_key) as [string, string];
    // 前邻 = b3(A00000002)、后邻 = b4(A00000003)
    expect(k1 > 'A00000002').toBe(true);
    expect(k2 < 'A00000003').toBe(true);
    expect(k1 < k2).toBe(true);
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops.every((op) => op.kind === 'reorder')).toBe(true);
  });

  it('组 [b3,b4] 移到最前：整组保序，两条 assignment 递增且 < 原 b1 键', () => {
    const plan = planBlockGroupDrop(four, CTX, ['b3', 'b4'], 'b1');
    expect(plan.kind).toBe('reorder');
    expect(plan.assignments.map((entry) => entry.id)).toEqual(['b3', 'b4']);
    const [k1, k2] = plan.assignments.map((entry) => entry.sort_key) as [string, string];
    expect(k1 < 'A00000000').toBe(true);
    expect(k1 < k2).toBe(true);
  });

  it('拖到自己身上 / 位置没变 / 有非法 id → noop（零 op 零 assignment）', () => {
    expect(planBlockGroupDrop(four, CTX, ['b1', 'b2'], 'b2').kind).toBe('noop');
    expect(planBlockGroupDrop(four, CTX, ['b1', 'b2'], 'b3').kind).toBe('noop');
    expect(planBlockGroupDrop(four, CTX, ['b1', 'zz'], 'b4').kind).toBe('noop');
    expect(planBlockGroupDrop(four, CTX, [], 'b4').kind).toBe('noop');
  });

  it('邻居间无空位 → 整层重平衡（rebalance），键按新视觉序等间隔重建', () => {
    // 'X' 与 'X0' 在字符串序下无空隙（sortBetween 必抛 InvalidSortRange）
    const tight = doc([blk('t', 'A'), blk('x', 'X'), blk('y', 'X0')]);
    const plan = planBlockGroupDrop(tight, CTX, ['t'], 'y');
    expect(plan.kind).toBe('rebalance');
    expect(plan.assignments.map((entry) => entry.id)).toEqual(['x', 't', 'y']);
    const keys = plan.assignments.map((entry) => entry.sort_key);
    expect(keys[0]! < keys[1]!).toBe(true);
    expect(keys[1]! < keys[2]!).toBe(true);
    expect(plan.ops).toHaveLength(3);
  });

  it('单块委托：planBlockDrop ≡ planBlockGroupDrop([id])（kind/assignments 逐位一致）', () => {
    for (const beforeId of ['b1', 'b2', 'b3', 'b4', null] as const) {
      const single = planBlockDrop(four, CTX, 'b4', beforeId);
      const group = planBlockGroupDrop(four, CTX, ['b4'], beforeId);
      expect(group.kind).toBe(single.kind);
      expect(group.assignments).toEqual(single.assignments);
    }
  });

  it('单块拖拽键完全未变 → noop（历史口径保持）', () => {
    expect(planBlockDrop(four, CTX, 'b2', 'b3').kind).toBe('noop');
  });

  it('只认存活块：tombstone 不参与落位', () => {
    const withTomb = doc([
      blk('b1', 'A00000000'),
      blk('b2', 'A00000001'),
      blk('b3', 'A00000002', { alive: 0 }),
      blk('b4', 'A00000003'),
    ]);
    const plan = planBlockGroupDrop(withTomb, CTX, ['b1'], 'b4');
    expect(plan.kind).toBe('reorder');
    expect(plan.assignments.map((entry) => entry.id)).toEqual(['b1']);
  });
});
