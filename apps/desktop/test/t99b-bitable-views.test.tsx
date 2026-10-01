// @vitest-environment jsdom
/**
 * t99b-bitable-views.test.tsx —— 多维表格「画廊 / 表单」两种视图（TASK-T99-02，老板 10-01 第④项）。
 *
 * 覆盖（断在冻结契约 testid 上，与真机探针 cdp-e2e-t99-01 的 R12 同口径）：
 *  - 画廊：卡片数 = 记录数；封面「色带」显示封面字段名 + 值文本（无 file/url 字段时显示「无封面」）；
 *    卡片正文不含标题列与封面字段（不重复占位）；点卡片标题 → 打开记录详情；
 *    换封面字段 → viewSave({coverPid})；新建画廊视图 → viewSave({type:'gallery'})；
 *  - 表单：字段 = 标题列恒首位 + 其余（顺序来自引擎）；必填打星；
 *    **校验不通过就不提交**（不调 recordCreate，只出提示）；填好后提交 → recordCreate 收到草稿值
 *    + 草稿清空 + 「已提交」；字段/必填开关 → viewSave({formPids, formRequired})。
 *
 * 纪律：假桥走 vi.stubGlobal；渲染层经 useDbPage 调的是 `viewSave` / `recordCreate`（名字别写错）。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BitablePage } from '../src/renderer/src/bitable/BitablePage';
import { bitableStore } from '../src/renderer/src/bitable/state';
import { pagesStore } from '../src/renderer/src/state/pages';
import { emptyFilter, type CollectionEntity, type RecordEntity } from '@septcats/dbview';
import type { PageNode } from '@septcats/editor';

const WS = 'ws-gf-1';
const TABLE = 'pg-table-gf';

const SCHEMA = {
  title_pid: 'p_title',
  properties: {
    p_title: { id: 'p_title', name: '书名', type: 'text' },
    p_cover: { id: 'p_cover', name: '封面', type: 'url' },
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
  return { id: 'col-gf', page_id: TABLE, name: '书单', schema: SCHEMA, views } as unknown as CollectionEntity;
}

function record(id: string, title: string, extra: Record<string, unknown> = {}): RecordEntity {
  return { id, collection_id: 'col-gf', values: { p_title: title, ...extra }, sort_key: id } as unknown as RecordEntity;
}

const GALLERY_VIEW = { vid: 'v1', name: '画廊', type: 'gallery' as const, filter: emptyFilter(), sort: [], widths: {} };
const FORM_VIEW = { vid: 'v2', name: '登记', type: 'form' as const, filter: emptyFilter(), sort: [], widths: {}, formTitle: '新书登记' };

const RECORDS = [
  record('r1', '夜航船', { p_cover: 'https://example.com/cover.png', p_status: 's-done', p_score: 9 }),
  record('r2', '万历十五年', { p_status: 's-todo' }),
];

const api = {
  load: vi.fn(async () => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]), records: RECORDS })),
  recordCreate: vi.fn(async (_input: { pageId: string; values?: Record<string, unknown> }) => ({ record: record('r9', '新书') })),
  recordUpdate: vi.fn(async () => ({ record: RECORDS[0] })),
  viewSave: vi.fn(async (_input: { pageId: string; view: unknown }) => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]) })),
  propAdd: vi.fn(async () => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]) })),
  propUpdate: vi.fn(async () => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]) })),
  propRemove: vi.fn(async () => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]) })),
  propMove: vi.fn(async () => ({ collection: collection([GALLERY_VIEW, FORM_VIEW]) })),
  recordDelete: vi.fn(async () => ({ ok: true })),
  exportCsv: vi.fn(async () => ({ csv: 'a,b\n' })),
};

function installBridge(): void {
  vi.stubGlobal('septcats', {
    db: api,
    pages: { tree: async () => [] },
    workspaces: { list: async () => ({ items: [{ id: WS, name: '库' }], activeId: WS }) },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: async () => ({ pageIds: [] }) },
    settings: { get: async () => ({ theme: 'dark', locale: 'zh-CN' }), patch: async () => ({}) },
  });
}

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
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderPage(): Promise<void> {
  render(<BitablePage />);
  await waitFor(() => expect(screen.getByTestId('bitable-viewbar')).toBeDefined());
}

/** 切到表单视图（默认激活首个视图 = 画廊 ⇒ 表单用例必须显式切，否则测的还是画廊）。 */
async function openFormView(): Promise<void> {
  fireEvent.click(screen.getByTestId('bitable-view-chip-v2'));
  await screen.findByTestId('bitable-form');
}

describe('画廊视图', () => {
  it('卡片数 = 记录数；封面显示字段名与值；正文不含标题列与封面字段', async () => {
    await renderPage();
    const gallery = await screen.findByTestId('bitable-gallery');
    const cards = within(gallery).getAllByRole('article');
    expect(cards).toHaveLength(2);

    const cover1 = screen.getByTestId('bitable-gcard-cover-r1');
    expect(cover1.textContent, '封面字段名').toContain('封面');
    expect(cover1.textContent, '封面取该字段的值').toContain('example.com');

    const fields1 = screen.getByTestId('bitable-gcard-r1');
    expect(fields1.textContent, '标题列不重复出现在正文').not.toContain('书名');
    expect(within(fields1).queryByTestId('bitable-gcard-row-p_cover'), '封面字段不进正文').toBeNull();
    expect(within(fields1).getByTestId('bitable-gcard-row-p_status').textContent).toContain('读完');
  });

  it('没有 file/url 字段时：色带如实写「无封面」，不假装有图', async () => {
    // 用只含 text 的 schema（没有 file/url ⇒ 引擎判不出封面）
    const bare = { title_pid: 'p_title', properties: { p_title: { id: 'p_title', name: '书名', type: 'text' } } } as unknown as CollectionEntity['schema'];
    api.load.mockResolvedValueOnce({ collection: { ...collection([GALLERY_VIEW]), schema: bare } as unknown as CollectionEntity, records: [record('r1', '只有标题')] });
    await renderPage();
    const cover = await screen.findByTestId('bitable-gcard-cover-r1');
    expect(cover.textContent).toContain('无封面');
  });

  it('点卡片标题 → 打开记录详情（与看板同一入口语义）', async () => {
    await renderPage();
    fireEvent.click(await screen.findByTestId('bitable-open-r2'));
    expect(screen.getByTestId('bitable-detail')).toBeDefined();
    expect(screen.getByTestId('bitable-detail').textContent).toContain('万历十五年');
  });

  it('换封面字段 → viewSave 落 coverPid', async () => {
    await renderPage();
    await screen.findByTestId('bitable-gallery');
    fireEvent.change(screen.getByTestId('bitable-gallery-cover'), { target: { value: 'p_score' } });
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    expect(api.viewSave.mock.calls.at(-1)?.[0].view).toMatchObject({ vid: 'v1', coverPid: 'p_score' });
  });

  it('新建画廊视图 → viewSave 带 type=gallery', async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId('bitable-view-gallery'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    expect(api.viewSave.mock.calls.at(-1)?.[0].view).toMatchObject({ type: 'gallery' });
  });
});

describe('表单视图', () => {
  it('字段 = 标题列首位 + 其余；标题取 formTitle', async () => {
    await renderPage();
    await openFormView();
    const form = screen.getByTestId('bitable-form');
    expect(screen.getByTestId('bitable-form-title').textContent).toBe('新书登记');
    const rows = within(form).getAllByTestId(/^bitable-form-row-/u).map((el) => el.getAttribute('data-testid'));
    expect(rows[0]).toBe('bitable-form-row-p_title');
    expect(rows).toHaveLength(4);
  });

  it('必填未填 → 不提交（不调 recordCreate），只出提示', async () => {
    api.load.mockResolvedValueOnce({
      collection: collection([{ ...FORM_VIEW, formRequired: ['p_title', 'p_status'] }]),
      records: RECORDS,
    });
    await renderPage();
    await screen.findByTestId('bitable-form');
    fireEvent.click(screen.getByTestId('bitable-form-submit'));
    await waitFor(() => expect(screen.getByTestId('bitable-form-msg').textContent).toContain('请先填写必填项'));
    expect(api.recordCreate, '脏数据不进库').not.toHaveBeenCalled();
    expect(screen.getByTestId('bitable-form-row-p_title').getAttribute('data-invalid')).toBe('true');
    expect(screen.getByTestId('bitable-form-row-p_status').getAttribute('data-invalid')).toBe('true');
  });

  it('填好必填 → 提交：recordCreate 收到草稿值、草稿清空、提示「已提交」', async () => {
    api.load.mockResolvedValueOnce({
      collection: collection([{ ...FORM_VIEW, formRequired: ['p_title'] }]),
      records: RECORDS,
    });
    await renderPage();
    await openFormView();
    const ctl = within(screen.getByTestId('bitable-form-row-p_title')).getByTestId('bitable-form-ctl-p_title');
    const input = ctl.querySelector('input');
    expect(input, '标题列是文本字段：应渲染文本框').not.toBeNull();
    fireEvent.focus(input as HTMLElement);
    fireEvent.change(input as HTMLElement, { target: { value: ' 新的书 ' } });
    fireEvent.keyDown(input as HTMLElement, { key: 'Enter' });
    fireEvent.click(screen.getByTestId('bitable-form-submit'));
    await waitFor(() => expect(api.recordCreate).toHaveBeenCalledTimes(1));
    // 注意：**校验严 ≠ 改写数据** —— 纯空白会被拦下（校验口径），但一旦通过，值按用户输入原样入库
    // （与表格视图行内编辑同口径：引擎不在提交时替用户 trim）。
    expect(api.recordCreate.mock.calls[0][0].values).toMatchObject({ p_title: ' 新的书 ' });
    await waitFor(() => expect(screen.getByTestId('bitable-form-msg').textContent).toContain('已提交'));
    // 重挂后必须**重新取节点**（旧引用已是分离节点）——表单要视觉上也真的清空
    const fresh = screen.getByTestId('bitable-form-ctl-p_title').querySelector('input');
    expect(fresh?.value, '提交成功后输入框必须清空').toBe('');
  });

  it('字段/必填开关 → viewSave 落 formPids / formRequired（必填随字段一起收）', async () => {
    await renderPage();
    await openFormView();
    fireEvent.click(screen.getByTestId('bitable-form-config-toggle'));
    fireEvent.click(screen.getByTestId('bitable-form-required-p_score'));
    await waitFor(() => expect(api.viewSave).toHaveBeenCalled());
    expect(api.viewSave.mock.calls.at(-1)?.[0].view).toMatchObject({ formRequired: ['p_score'] });
    fireEvent.click(screen.getByTestId('bitable-form-field-p_score'));
    await waitFor(() => expect(api.viewSave.mock.calls.at(-1)?.[0].view).toMatchObject({ formRequired: [] }));
  });
});