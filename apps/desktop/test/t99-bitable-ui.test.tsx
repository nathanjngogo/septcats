// @vitest-environment jsdom
/**
 * t99-bitable-ui.test.tsx —— 多维表格一级页渲染层单测（TASK-T99-01，飞书多维表格对标）。
 *
 * 覆盖（全部断在冻结契约 testid 上，与真机探针 cdp-e2e-t99-01 同口径）：
 *  - 二级栏：库内 database 页 → 列表项 + 记录数；点条目切当前表；「新建表」走 db.create；
 *  - 空态：主进程不可用 / 无表 / 无记录，一律渲染空态、不崩；
 *  - 视图条：chips 列出 collection.views；点 chip 切视图；新建表格/看板视图经 saveView 落库；
 *  - 看板视图：列 = 选项顺序 + 未分组桶置末；卡片标题取标题列；**拖动卡片到另一列 → recordUpdate
 *    写入正确的值**（select 落选项 id、落未分组桶落 null）；分组字段切换经 saveView 落 groupPid；
 *  - 表格视图：交给既有 DbPage（bitable-grid 容器在位，视图条仍可用）。
 */
import { within, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import { BitablePage } from '../src/renderer/src/bitable/BitablePage';
import { BitableSidePanel } from '../src/renderer/src/bitable/BitableSidePanel';
import { bitableStore } from '../src/renderer/src/bitable/state';
import { pagesStore } from '../src/renderer/src/state/pages';
import { emptyFilter, type CollectionEntity, type RecordEntity } from '@septcats/dbview';

const WS = 'ws-bit-1';
const TABLE_A = 'pg-table-a';
const TABLE_B = 'pg-table-b';

function pageNode(id: string, title: string, pageType: 'database' | 'page' = 'database'): PageNode {
  return {
    id,
    title,
    icon: null,
    cover: null,
    workspaceId: WS,
    parentId: null,
    sortKey: `A${id}`,
    version: 1,
    alive: 1,
    deletedAt: null,
    childIds: [],
    depth: 0,
    pageType,
  } as unknown as PageNode;
}

function collection(views: CollectionEntity['views']): CollectionEntity {
  return {
    id: 'col-1',
    page_id: TABLE_A,
    name: '项目表',
    schema: {
      title_pid: 'p_title',
      properties: {
        p_title: { id: 'p_title', name: '标题', type: 'text' },
        p_status: {
          id: 'p_status',
          name: '状态',
          type: 'select',
          options: [
            { id: 's-todo', name: '待办' },
            { id: 's-doing', name: '进行中' },
          ],
        },
      },
    },
    views,
  } as unknown as CollectionEntity;
}

function record(id: string, title: string, status: string | null): RecordEntity {
  return {
    id,
    collection_id: 'col-1',
    values: { p_title: title, ...(status === null ? {} : { p_status: status }) },
    sort_key: id,
  } as unknown as RecordEntity;
}

const TABLE_VIEW = { vid: 'v1', name: '表格', type: 'table' as const, filter: emptyFilter(), sort: [], widths: {} };
const KANBAN_VIEW = { vid: 'v2', name: '看板', type: 'kanban' as const, filter: emptyFilter(), sort: [], widths: {}, groupPid: 'p_status' };

const defaultLoad = async () => ({
  collection: collection([TABLE_VIEW, KANBAN_VIEW]),
  records: [record('r1', '写方案', 's-doing'), record('r2', '读文档', null)],
});
const defaultViewRemove = async () => ({ collection: collection([TABLE_VIEW]) });

const api = {
  load: vi.fn(defaultLoad),
  create: vi.fn(async () => ({ pageId: TABLE_B, collectionId: 'col-2' })),
  recordCreate: vi.fn(async () => ({ record: record('r9', '新', null) })),
  recordUpdate: vi.fn(async () => ({ record: record('r1', '写方案', 's-todo') })),
  // 注意：渲染层经 useDbPage 调用的方法名是 viewSave（不是 saveView）
  // 形参显式声明，否则 vi.fn 的 mock.calls 是空元组、取参会报 TS2493。
  viewSave: vi.fn(async (_input: { pageId: string; view: unknown }) => ({ collection: collection([TABLE_VIEW, KANBAN_VIEW]) })),
  viewRemove: vi.fn(defaultViewRemove),
  exportCsv: vi.fn(async () => ({ csv: 'a,b\n1,2\n' })),
};

function installBridge(): void {
  // 单例 mock 的实现可能被别的用例 mockResolvedValue 永久覆盖（mockClear 只清调用记录
  // 不清实现）→ 每次装桥显式装回默认实现，保证用例间互不污染。
  api.load.mockImplementation(defaultLoad);
  api.viewRemove.mockImplementation(defaultViewRemove);
  vi.stubGlobal('septcats', {
    db: api,
    pages: { tree: async () => [] },
    workspaces: { list: async () => ({ items: [{ id: WS, name: '库' }], activeId: WS }) },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: async () => ({ pageIds: [] }) },
    blocks: { list: async () => ({ locked: false, blocks: [] }), commit: async () => ({}) },
    settings: { get: async () => ({ theme: 'system', locale: 'zh-CN' }), patch: async () => ({}) },
  });
}

function resetPages(): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS,
    workspaces: [{ id: WS, name: '库' }],
    nodes: [pageNode(TABLE_A, '项目表'), pageNode(TABLE_B, '客户表'), pageNode('pg-plain', '普通页', 'page')],
    expanded: new Set<string>(),
    selectedId: TABLE_A,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  bitableStore.setState(() => ({ tableId: null }));
  resetPages();
  installBridge();
  for (const fn of Object.values(api)) {
    (fn as { mockClear?: () => void }).mockClear?.();
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T99-01 二级栏：库内多维表列表', () => {
  it('只列 database 页（含记录数），点条目切当前表；「新建表」走 db.create', async () => {
    const { container } = render(<BitableSidePanel />);
    const root = container.querySelector('[data-testid="bitable-side"]');
    expect(root).not.toBeNull();

    await waitFor(() => expect(container.querySelector(`[data-testid="bitable-side-item-${TABLE_A}"]`)).not.toBeNull());
    expect(container.querySelector(`[data-testid="bitable-side-item-${TABLE_B}"]`)).not.toBeNull();
    expect(container.querySelector('[data-testid="bitable-side-item-pg-plain"]'), '普通页不是表，不得入列').toBeNull();
    // 记录数惰性拉取（load 各表一次）
    await waitFor(() => expect(api.load).toHaveBeenCalled());

    fireEvent.click(container.querySelector(`[data-testid="bitable-side-item-${TABLE_B}"]`)!);
    expect(bitableStore.getState().tableId).toBe(TABLE_B);
    expect(window.localStorage.getItem('septcats.bitable.table')).toBe(TABLE_B);

    fireEvent.click(container.querySelector('[data-testid="bitable-side-new"]')!);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ workspaceId: WS, title: expect.stringContaining('多维表格') }));
    await waitFor(() => expect(bitableStore.getState().tableId).toBe(TABLE_B));
  });

  it('库内无表 → 空态在位', () => {
    pagesStore.setState((state) => ({ ...state, nodes: [] }));
    const { container } = render(<BitableSidePanel />);
    expect(container.querySelector('[data-testid="bitable-side-empty"]')).not.toBeNull();
  });
});

describe('T99-01 主区：视图条 / 看板 / 表格', () => {
  it('未选表 → 空态；主进程不可用也不崩', () => {
    const { container } = render(<BitablePage />);
    expect(container.querySelector('[data-testid="bitable-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bitable-empty"]')).not.toBeNull();
  });

  it('选中表 → 表名 + 视图 chips；点看板 chip 后渲染列（选项顺序 + 未分组桶置末）与卡片标题', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-table-name"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="bitable-table-name"]')?.textContent).toBe('项目表');
    expect(container.querySelector('[data-testid="bitable-view-chip-v1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bitable-view-chip-v2"]')).not.toBeNull();

    fireEvent.click(container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-kanban"]')).not.toBeNull());
    const cols = [...container.querySelectorAll('[data-testid^="bitable-kanban-col-"]')].map((el) => (el.getAttribute('data-testid') ?? '').replace('bitable-kanban-col-', ''));
    expect(cols).toEqual(['s-todo', 's-doing', '__none__']);
    expect(container.querySelector('[data-testid="bitable-card-r1"]')?.textContent).toContain('写方案');
    expect(container.querySelector('[data-testid="bitable-card-r2"]')?.textContent).toContain('读文档');
  });

  it('拖动卡片到另一列 → recordUpdate 写入该选项 id；拖到未分组桶 → 写 null', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-view-chip-v2"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-card-r1"]')).not.toBeNull());

    const card = container.querySelector('[data-testid="bitable-card-r1"]')!;
    const todoCol = container.querySelector('[data-testid="bitable-kanban-col-s-todo"]')!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(todoCol);
    fireEvent.drop(todoCol);
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_status: 's-todo' },
    }));

    api.recordUpdate.mockClear();
    const noneCol = container.querySelector('[data-testid="bitable-kanban-col-__none__"]')!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(noneCol);
    fireEvent.drop(noneCol);
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_status: null },
    }));
  });

  it('看板卡片「移到」下拉 = 拖动的键盘等价路径（改 select → 同一个 recordUpdate）', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-view-chip-v2"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-card-r1"]')).not.toBeNull());

    const move = container.querySelector('[data-testid="bitable-move-r1"]')!;
    expect(move.tagName).toBe('SELECT');
    // 未分组桶在 options 里存在且带「未选择」标签（与拖动落到 __none__ 同一语义）
    expect([...move.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toContain('__none__');

    fireEvent.change(move, { target: { value: 's-doing' } });
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_status: 's-doing' },
    }));

    api.recordUpdate.mockClear();
    fireEvent.change(move, { target: { value: '__none__' } });
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_status: null },
    }));
  });

  it('切换分组字段 → saveView 带上新 groupPid（且不丢原视图其它配置）', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-view-chip-v2"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-groupby"]')).not.toBeNull());
    fireEvent.change(container.querySelector('[data-testid="bitable-groupby"]')!, { target: { value: 'p_status' } });
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    const saved = api.viewSave.mock.calls.at(-1)?.[0] as unknown as { pageId: string; view: { vid: string; type: string; groupPid?: string } };
    expect(saved.pageId).toBe(TABLE_A);
    expect(saved.view.vid).toBe('v2');
    expect(saved.view.type).toBe('kanban');
    expect(saved.view.groupPid).toBe('p_status');
  });

  it('新建看板视图 → saveView 落库并自动带首个 select 作 groupPid', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-view-kanban"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="bitable-view-kanban"]')!);
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    const saved = api.viewSave.mock.calls.at(-1)?.[0] as unknown as { view: { type: string; groupPid?: string } };
    expect(saved.view.type).toBe('kanban');
    expect(saved.view.groupPid).toBe('p_status');
  });

  it('表格视图：复用 DbPage（grid 容器在位），导出 CSV 走既有通道', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-grid"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="bitable-grid"]')?.hasAttribute('hidden')).toBe(false);
    const exportBtn = container.querySelector('[data-testid="bitable-export"]');
    expect(exportBtn).not.toBeNull();
    fireEvent.click(exportBtn!);
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith({ pageId: TABLE_A }));
    // T103：视图删除已接真实通道 —— 本夹具 2 个视图 ⇒ 按钮可用（非旧版 disabled 假按钮）。
    expect(container.querySelector('[data-testid="bitable-view-remove"]')?.hasAttribute('disabled')).toBe(false);
    expect(api.viewRemove).not.toHaveBeenCalled();
  });
});
describe('T103-01 删除视图（假按钮补成真实入口 + 二次确认 + 护栏）', () => {
  it('多视图：按钮可用；首次点击只「上膛」并明示视图名，不删', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-viewbar"]')).not.toBeNull());
    const btn = container.querySelector('[data-testid="bitable-view-remove"]') as HTMLButtonElement;
    expect(btn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(btn);
    expect(api.viewRemove).not.toHaveBeenCalled();
    // 上膛文案 = 「确认删除」+ 当前视图名（明示删的是哪一个，与待办批量清同口径）
    await waitFor(() => expect(btn.textContent).toContain('确认删除'));
    expect(btn.textContent).toContain('表格');
    // 引导行同步出现（aria-live=status 播报）
    const hint = container.querySelector('[data-testid="bitable-view-msg"]');
    expect(hint?.textContent).toContain('再次点击');
  });

  it('二次点击才真删：viewRemove 带当前 vid；换视图解除上膛；删完按护栏禁用', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-viewbar"]')).not.toBeNull());
    const btn = container.querySelector('[data-testid="bitable-view-remove"]') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain('确认删除'));
    // 中途点另一个视图 chip → 上膛态作废（不能上膛着表格却删看板）
    fireEvent.click(container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(btn.textContent).not.toContain('确认删除'));
    // 换视图后重新上膛：第一次只武装、不删
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain('确认删除'));
    expect(api.viewRemove).not.toHaveBeenCalled();
    // 第二次确认：删的必须是**当前**视图（看板 v2，不是最初上膛的表格 v1）
    fireEvent.click(btn);
    await waitFor(() => expect(api.viewRemove).toHaveBeenCalledWith({ pageId: TABLE_A, vid: 'v2' }));
    // 删除成功（mock 回包只剩表格视图）：上膛解除 + 按护栏禁用 + 引导行消失
    await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(true));
    expect(btn.textContent).not.toContain('确认删除');
    expect(container.querySelector('[data-testid="bitable-view-msg"]')).toBeNull();
  });

  it('失焦解除上膛（onBlur）：第三次场景不累积', async () => {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-viewbar"]')).not.toBeNull());
    const btn = container.querySelector('[data-testid="bitable-view-remove"]') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain('确认删除'));
    fireEvent.blur(btn);
    expect(btn.textContent).not.toContain('确认删除');
    expect(api.viewRemove).not.toHaveBeenCalled();
  });

  it('只剩最后一个视图：按钮禁用 + title 给原因（护栏与 main E_INVARIANT 同源）', async () => {
    // 夹具切单视图集
    api.load.mockResolvedValue({ collection: collection([TABLE_VIEW]), records: [] } as never);
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-viewbar"]')).not.toBeNull());
    const btn = container.querySelector('[data-testid="bitable-view-remove"]') as HTMLButtonElement;
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('title')).toContain('至少保留一个视图');
  });

  it('IPC 拒绝（如并发下最后一个）：原样播报 message，不静默吞', async () => {
    api.viewRemove.mockRejectedValueOnce(new Error('一张表至少要保留一个视图') as never);
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const { container } = render(<BitablePage />);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-viewbar"]')).not.toBeNull());
    const btn = container.querySelector('[data-testid="bitable-view-remove"]') as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain('确认删除'));
    fireEvent.click(btn);
    await waitFor(() => expect(api.viewRemove).toHaveBeenCalled());
    const msg = container.querySelector('[data-testid="bitable-view-msg"]');
    await waitFor(() => expect(msg?.textContent).toContain('至少要保留一个视图'));
  });
});

// ---------------------------------------------------------------------------
// 记录详情（老板 10-01 第①项：看板卡片点开记录，对标飞书）
// ---------------------------------------------------------------------------

describe('T99-01b 记录详情（卡片点开）', () => {
  /** 进看板视图并等到卡片标题按钮就位。 */
  async function openKanban(): Promise<{ container: HTMLElement }> {
    bitableStore.setState(() => ({ tableId: TABLE_A }));
    const view = render(<BitablePage />);
    await waitFor(() => expect(view.container.querySelector('[data-testid="bitable-view-chip-v2"]')).not.toBeNull());
    fireEvent.click(view.container.querySelector('[data-testid="bitable-view-chip-v2"]')!);
    await waitFor(() => expect(view.container.querySelector('[data-testid="bitable-open-r1"]')).not.toBeNull());
    return { container: view.container };
  }

  it('点卡片标题 → 打开记录详情（逐字段一行 + 弹层标题取标题列原文）', async () => {
    const { container } = await openKanban();
    fireEvent.click(container.querySelector('[data-testid="bitable-open-r1"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-detail"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="bitable-detail-row-p_title"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="bitable-detail-row-p_status"]')).not.toBeNull();
    expect(within(container.querySelector('[data-testid="bitable-detail-row-p_title"]') as HTMLElement).getByText('标题')).toBeDefined();
    // 弹层标题 = 「写方案」（r1 的标题列）
    expect(container.textContent).toContain('写方案');
  });

  it('详情里改字段 → 走 recordUpdate（与拖动/行内编辑同一条写值通道）', async () => {
    const { container } = await openKanban();
    fireEvent.click(container.querySelector('[data-testid="bitable-open-r1"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-detail-ctl-p_title"]')).not.toBeNull());
    api.recordUpdate.mockClear();
    fireEvent.click(container.querySelector('[data-testid="bitable-detail-ctl-p_title"]')!);
    const input = await waitFor(() => {
      const el = container.querySelector('[data-testid="bitable-detail-row-p_title"] input');
      expect(el, '点字段后未进入编辑态（应出现输入框）').not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { value: '写方案 v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_title: '写方案 v2' },
    }));
  });

  it('卡内交互不串扰：「移到」下拉照常改值，且不会打开详情', async () => {
    const { container } = await openKanban();
    api.recordUpdate.mockClear();
    fireEvent.change(container.querySelector('[data-testid="bitable-move-r1"]')!, { target: { value: 's-todo' } });
    await waitFor(() => expect(api.recordUpdate).toHaveBeenCalledWith({
      pageId: TABLE_A, recordId: 'r1', patch: { p_status: 's-todo' },
    }));
    expect(container.querySelector('[data-testid="bitable-detail"]'), '操作下拉不得打开详情').toBeNull();
  });

  it('关闭钮 → 弹层消失（编辑态一并复位）', async () => {
    const { container } = await openKanban();
    fireEvent.click(container.querySelector('[data-testid="bitable-open-r1"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-detail"]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-testid="bitable-detail-close"]')!);
    await waitFor(() => expect(container.querySelector('[data-testid="bitable-detail"]')).toBeNull());
  });
});
