/**
 * IDEA-E 视图排序 —— 渲染层接线（值守接管 step2）。
 *
 * 覆盖口径：
 * - 引擎 reorderById 纯函数（from 右拖占目标后、左拖占目标前；from===to/未知 id/空 id
 *   原样拷贝；不改入参、返回新数组）；
 * - PropBar 视图菜单动作钮（宿主接 onMoveView 才渲染；首/末项对应方向 disabled；
 *   点击「前移到 X」= onMoveView(自身 vid, 上一个 vid)）；
 * - DbView 透传（可选 prop：未接线的旧宿主零动作钮 = 零回归）。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  collectionEntitySchema,
  collectionSchemaSchema,
  defaultView,
  propertySchema,
  type CollectionEntity,
} from '../src/types';
import { reorderById } from '../src/view';
import { DbView } from '../src/react/DbView';
import { PropBar } from '../src/react/PropBar';

const P_TITLE = propertySchema.parse({ id: 'p_title', name: '书名', type: 'text' });
const SCHEMA = collectionSchemaSchema.parse({ properties: { [P_TITLE.id]: P_TITLE }, title_pid: P_TITLE.id });

function view(vid: string, name: string) {
  return defaultView(vid, name);
}

describe('引擎 reorderById（IDEA-E step1 口径钉）', () => {
  const idOf = (x: { vid: string }): string => x.vid;

  it('右拖：from 移到 to 之后（占目标后）', () => {
    const items = [view('a', 'A'), view('b', 'B'), view('c', 'C')];
    const next = reorderById(items, idOf, 'a', 'c');
    expect(next.map(idOf)).toEqual(['b', 'c', 'a']);
  });

  it('左拖：from 移到 to 之前（占目标前）', () => {
    const items = [view('a', 'A'), view('b', 'B'), view('c', 'C')];
    const next = reorderById(items, idOf, 'c', 'a');
    expect(next.map(idOf)).toEqual(['c', 'a', 'b']);
  });

  it('from===to / 未知 id / 空 id = 原样拷贝（且不是同一引用）', () => {
    const items = [view('a', 'A'), view('b', 'B')];
    for (const [from, to] of [
      ['a', 'a'],
      ['x', 'a'],
      ['a', 'x'],
      ['', 'a'],
      ['a', ''],
    ] as const) {
      const copy = reorderById(items, idOf, from, to);
      expect(copy.map(idOf)).toEqual(['a', 'b']);
      expect(copy).not.toBe(items);
    }
  });

  it('不改入参数组', () => {
    const items = [view('a', 'A'), view('b', 'B'), view('c', 'C')];
    reorderById(items, idOf, 'a', 'c');
    expect(items.map(idOf)).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// PropBar：视图菜单「↑/↓ 移动」动作钮
// ---------------------------------------------------------------------------

const propBase = {
  schema: SCHEMA,
  views: [view('v1', '表格'), view('v2', '看板'), view('v3', '日历')],
  activeVid: 'v2',
  onSwitchView: () => {},
  filter: defaultView('v1').filter,
  onChangeFilter: () => {},
  sort: [],
  onChangeSort: () => {},
  onAddProperty: () => {},
  onCreateRecord: () => {},
  onExportCsv: () => {},
};

function openViewMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: /看板/ }));
}

describe('PropBar 视图菜单动作钮', () => {
  it('宿主未接 onMoveView：菜单无动作钮（旧宿主零回归）', () => {
    render(<PropBar {...propBase} />);
    openViewMenu();
    expect(screen.queryByRole('menu', { name: '视图' })).not.toBeNull();
    expect(screen.queryAllByRole('button', { name: /前移|后移/ })).toHaveLength(0);
  });

  it('接线后每项两个动作钮；首项「前移」与末项「后移」disabled（不造假入口）', () => {
    render(<PropBar {...propBase} onMoveView={() => {}} />);
    openViewMenu();
    const ups = screen.getAllByRole('button', { name: /前移/ });
    const downs = screen.getAllByRole('button', { name: /后移/ });
    expect(ups).toHaveLength(3);
    expect(downs).toHaveLength(3);
    expect(ups[0]?.hasAttribute('disabled')).toBe(true);
    expect(downs[2]?.hasAttribute('disabled')).toBe(true);
    expect(ups[1]?.hasAttribute('disabled')).toBe(false);
  });

  it('点「后移到 X」= onMoveView(自身, 下一个)；菜单不关、不误触发视图切换', () => {
    const onMoveView = vi.fn();
    const onSwitchView = vi.fn();
    render(<PropBar {...propBase} onSwitchView={onSwitchView} onMoveView={onMoveView} />);
    openViewMenu();
    // v1（表格）的后移钮：后移到「看板」
    const downOfV1 = screen.getAllByRole('button', { name: /后移/ })[0];
    expect(downOfV1).toBeDefined();
    fireEvent.click(downOfV1 as HTMLElement);
    expect(onMoveView).toHaveBeenCalledWith('v1', 'v2');
    expect(onSwitchView).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu', { name: '视图' })).not.toBeNull();
  });

  it('中间项「前移到 表格」= onMoveView(v2, v1)', () => {
    const onMoveView = vi.fn();
    render(<PropBar {...propBase} onMoveView={onMoveView} />);
    openViewMenu();
    const upOfV2 = screen.getAllByRole('button', { name: /前移/ })[1];
    expect(upOfV2).toBeDefined();
    fireEvent.click(upOfV2 as HTMLElement);
    expect(onMoveView).toHaveBeenCalledWith('v2', 'v1');
  });

  it('disabled 动作钮点击零回调', () => {
    const onMoveView = vi.fn();
    render(<PropBar {...propBase} onMoveView={onMoveView} />);
    openViewMenu();
    const upFirst = screen.getAllByRole('button', { name: /前移/ })[0];
    expect(upFirst).toBeDefined();
    fireEvent.click(upFirst as HTMLElement);
    expect(onMoveView).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DbView：可选透传
// ---------------------------------------------------------------------------

const COLLECTION: CollectionEntity = collectionEntitySchema.parse({
  id: 'col-books',
  page_id: 'pg-books',
  workspace_id: 'ws-test',
  name: '阅读清单',
  schema: SCHEMA,
  views: [view('v1', '表格'), view('v2', '看板')],
  alive: 1,
  version: 1,
});

const dbBase = {
  records: [],
  status: 'ready' as const,
  onCreateRecord: () => {},
  onDeleteRecords: () => {},
  onChangeValue: () => {},
  onRenameRecord: () => {},
  onAddProperty: () => {},
  onRemoveProperty: () => {},
  onRenameProperty: () => {},
  onSaveView: () => {},
  onExportCsv: () => {},
};

describe('DbView onMoveView 透传', () => {
  it('未传：视图菜单零动作钮', () => {
    render(<DbView collection={COLLECTION} {...dbBase} />);
    fireEvent.click(screen.getByRole('button', { name: /表格/ }));
    expect(screen.queryAllByRole('button', { name: /前移|后移/ })).toHaveLength(0);
  });

  it('传入：打开视图菜单后出现动作钮并透传点击', () => {
    const onMoveView = vi.fn();
    render(<DbView collection={COLLECTION} {...dbBase} onMoveView={onMoveView} />);
    fireEvent.click(screen.getByRole('button', { name: /表格/ }));
    const down = screen.getAllByRole('button', { name: /后移/ })[0];
    expect(down).toBeDefined();
    fireEvent.click(down as HTMLElement);
    expect(onMoveView).toHaveBeenCalledWith('v1', 'v2');
  });
});
