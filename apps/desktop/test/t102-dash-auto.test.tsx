// @vitest-environment jsdom
/**
 * t102-dash-auto.test.tsx —— 多维表格「仪表盘 / 自动化」两视图渲染层（TASK-T102，老板 10-01 第⑤项）。
 *
 * 覆盖（断在冻结契约 testid 上，与真机探针 R13 同口径）：
 *  - 仪表盘：新建视图预置磁贴（开箱有数）；number 磁贴显聚合值；distribution 色带段数=选项数；
 *    磁贴删除/加磁贴 → viewSave 带新 widgets；空磁贴 → 空态文案；
 *  - 自动化：+自动化 建视图；新建规则 → viewSave 带 rules；改条件值/删规则/禁用开关各落库一次；
 *    规则往返（load 回来的 view.rules 能渲染成卡）。
 *
 * 纪律：假桥 vi.stubGlobal；渲染层调 viewSave（不是 saveView）；不写死日期。
 */
import { within, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitablePage } from '../src/renderer/src/bitable/BitablePage';
import { bitableStore } from '../src/renderer/src/bitable/state';
import { pagesStore } from '../src/renderer/src/state/pages';
import { defaultView, type CollectionEntity, type RecordEntity } from '@septcats/dbview';
import type { PageNode } from '@septcats/editor';

const WS = 'ws-da-1';
const TABLE = 'pg-table-da';

const SCHEMA = {
  title_pid: 'p_title',
  properties: {
    p_title: { id: 'p_title', name: '书名', type: 'text' },
    p_status: {
      id: 'p_status',
      name: '状态',
      type: 'select',
      options: [{ id: 's-todo', name: '待读' }, { id: 's-done', name: '读完' }],
    },
    p_score: { id: 'p_score', name: '评分', type: 'number' },
  },
} as unknown as CollectionEntity['schema'];

function collection(views: CollectionEntity['views']): CollectionEntity {
  return { id: 'col-da', page_id: TABLE, name: '书单', schema: SCHEMA, views } as unknown as CollectionEntity;
}

function record(id: string, title: string, status: string, score: number): RecordEntity {
  return { id, collection_id: 'col-da', values: { p_title: title, p_status: status, p_score: score }, sort_key: id } as unknown as RecordEntity;
}

const RECORDS = [record('r1', '夜航船', 's-done', 9), record('r2', '万历', 's-todo', 7), record('r3', '人类简史', 's-done', 8)];

// 字面量必须逐键 as const：这些对象经 vi.fn(async () => …) 返回后失去上下文类型，
// 不钉死会被拓宽成 string 而和 dbViewSchema 的枚举对不上（tsc.node TS2322）。
const DASH_VIEW = { ...defaultView('vd', '仪表盘'), type: 'dashboard' as const, widgets: [
  { id: 'w1', type: 'number' as const, config: { pid: 'p_score', agg: 'sum' as const } },
  { id: 'w2', type: 'distribution' as const, config: { groupPid: 'p_status' } },
] };
const AUTO_VIEW = { ...defaultView('va', '自动化'), type: 'automation' as const, rules: [
  { id: 'a1', name: '读完记10分', enabled: true, on: { kind: 'update' as const, pid: 'p_status' }, if: { pid: 'p_status', eq: 's-done' }, set: { pid: 'p_score', to: 10 } },
] };

const api = {
  load: vi.fn(async () => ({ collection: collection([DASH_VIEW, AUTO_VIEW]), records: RECORDS })),
  recordCreate: vi.fn(async () => ({ record: RECORDS[0] })),
  recordUpdate: vi.fn(async () => ({ record: RECORDS[0] })),
  viewSave: vi.fn(async (_input: { pageId: string; view: unknown }) => ({ collection: collection([DASH_VIEW, AUTO_VIEW]) })),
  exportCsv: vi.fn(async () => ({ csv: 'a,b\n' })),
};

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  bitableStore.setState(() => ({ tableId: TABLE }));
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: WS,
    workspaces: [{ id: WS, name: '库' }],
    nodes: [{ id: TABLE, title: '书单', pageType: 'database', workspaceId: WS, parentId: null, sortKey: 'A', version: 1, alive: 1, deletedAt: null, childIds: [], depth: 0, icon: null, cover: null } as unknown as PageNode],
    expanded: new Set<string>(),
    selectedId: TABLE,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
  }));
  vi.stubGlobal('septcats', {
    db: api,
    pages: { tree: async () => [] },
    workspaces: { list: async () => ({ items: [{ id: WS, name: '库' }], activeId: WS }) },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: async () => ({ pageIds: [] }) },
    settings: { get: async () => ({ theme: 'dark', locale: 'zh-CN' }), patch: async () => ({}) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openView(vid: string): Promise<void> {
  render(<BitablePage />);
  await waitFor(() => expect(screen.getByTestId('bitable-viewbar')).toBeDefined());
  fireEvent.click(screen.getByTestId(`bitable-view-chip-${vid}`));
}

const savedView = (): Record<string, unknown> =>
  (api.viewSave.mock.calls.at(-1) as [{ view: Record<string, unknown> }])[0].view;

describe('仪表盘视图', () => {
  it('磁贴渲染：number 显聚合值（评分 sum=24）；distribution 色带段数=选项数', async () => {
    await openView('vd');
    const dash = await screen.findByTestId('bitable-dashboard');
    expect(within(dash).getByTestId('tile-num-w1').textContent).toBe('24');
    const ramp = within(dash).getByTestId('tile-dist-w2');
    expect(ramp.querySelectorAll('.bitable-tile-seg'), '色带段数 = 分组数').toHaveLength(2);
    expect(ramp.textContent).toContain('待读');
    expect(ramp.textContent).toContain('读完');
  });

  it('删磁贴 → viewSave 带少一块的 widgets', async () => {
    await openView('vd');
    await screen.findByTestId('bitable-dashboard');
    fireEvent.click(screen.getByTestId('tile-del-w1'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    const widgets = savedView().widgets as Array<{ id: string }>;
    expect(widgets.map((w) => w.id)).toEqual(['w2']);
  });

  it('加磁贴菜单 → 新增文本板（widgets +1，id 不撞）', async () => {
    await openView('vd');
    await screen.findByTestId('bitable-dashboard');
    fireEvent.click(screen.getByTestId('bitable-dash-add'));
    fireEvent.click(await screen.findByTestId('bitable-dash-new-text'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    const widgets = savedView().widgets as Array<{ id: string; type: string }>;
    expect(widgets).toHaveLength(3);
    expect(widgets[2]?.type).toBe('text');
    expect(new Set(widgets.map((w) => w.id)).size, 'id 必须唯一').toBe(3);
  });

  it('+仪表盘 新建视图 → 预置磁贴（开箱有数，不是空板）', async () => {
    await openView('vd');
    await screen.findByTestId('bitable-dashboard');
    fireEvent.click(screen.getByTestId('bitable-view-dashboard'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    expect(savedView()).toMatchObject({ type: 'dashboard' });
    const widgets = savedView().widgets as unknown[];
    expect(widgets.length, '预置 ≥2 块磁贴').toBeGreaterThanOrEqual(2);
  });
});

describe('自动化视图', () => {
  it('规则卡渲染：名称/启用态/三段（当·且·把）', async () => {
    await openView('va');
    const board = await screen.findByTestId('bitable-automation');
    const card = within(board).getByTestId('bitable-rule-a1');
    expect((within(card).getByTestId('bitable-rule-name-a1') as HTMLInputElement).value).toBe('读完记10分');
    expect((within(card).getByTestId('bitable-rule-enabled-a1') as HTMLInputElement).checked).toBe(true);
    expect((within(card).getByTestId('bitable-rule-kind-a1') as HTMLSelectElement).value).toBe('update');
    expect((within(card).getByTestId('bitable-rule-eq-a1') as HTMLSelectElement).value, 'select 条件值 = 选项 id').toBe('s-done');
  });

  it('改动作值（select 目标）→ viewSave 带新 rules（选项 id 往返）', async () => {
    await openView('va');
    await screen.findByTestId('bitable-automation');
    fireEvent.change(screen.getByTestId('bitable-rule-setpid-a1'), { target: { value: 'p_status' } });
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    const rules = savedView().rules as Array<{ set: { pid: string } }>;
    expect(rules[0]?.set.pid).toBe('p_status');
  });

  it('删规则 → rules 清空；禁用开关 → enabled=false 落库', async () => {
    await openView('va');
    await screen.findByTestId('bitable-automation');
    fireEvent.click(screen.getByTestId('bitable-rule-enabled-a1'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    expect((savedView().rules as Array<{ enabled: boolean }>)[0]?.enabled).toBe(false);
    fireEvent.click(screen.getByTestId('bitable-rule-del-a1'));
    await waitFor(() => expect((savedView().rules as unknown[]).length).toBe(0));
  });

  it('+自动化 新建视图可用；空规则集渲染空态文案', async () => {
    api.load.mockResolvedValueOnce({
      collection: collection([{ ...AUTO_VIEW, rules: [] }]),
      records: RECORDS,
    });
    await openView('va');
    expect(await screen.findByTestId('bitable-empty')).toBeDefined();
    expect(screen.getByTestId('bitable-view-automation')).toBeDefined();
  });
});