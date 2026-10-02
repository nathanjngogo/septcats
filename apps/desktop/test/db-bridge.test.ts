// @vitest-environment jsdom
/**
 * db-bridge.test.ts —— renderer 数据库桥的 jsdom 用例（TASK-T7b-01 §6）。
 *
 * 覆盖：
 * - `useDbPage` 四态转换（loading → ready/empty/error + retry）；
 * - `DbPage` 渲染冒烟（ready 态渲染 DbView，标题/记录可见）。
 *
 * 纪律：不 import electron；`window.septcats.db` 用 vi.stubGlobal 假桥替换，
 * 本用例只验证 renderer 侧状态机与组装，不碰真实 IPC。
 */
import { createElement } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionEntity, RecordEntity } from '@septcats/dbview';
import { DbPage } from '../src/renderer/src/db/DbPage';
import { useDbPage } from '../src/renderer/src/db/useDbPage';
import type { SeptcatsDbApi } from '../src/types/window';

function makeCollection(): CollectionEntity {
  return {
    id: 'col-1',
    page_id: 'pg-1',
    workspace_id: 'ws-1',
    name: '研究库',
    schema: {
      properties: { p_title: { id: 'p_title', name: '名称', type: 'text' } },
      title_pid: 'p_title',
    },
    views: [{ vid: 'v1', name: '表格', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} }],
    alive: 1,
    version: 1,
  };
}

function makeRecord(id: string, title: string): RecordEntity {
  return {
    id,
    collection_id: 'col-1',
    workspace_id: 'ws-1',
    values: { p_title: title },
    sort_key: id,
    alive: 1,
    version: 1,
    backlinks: {},
  };
}

type MockDb = { [K in keyof SeptcatsDbApi]: ReturnType<typeof vi.fn> };

function installMockDb(): MockDb {
  const mock: MockDb = {
    create: vi.fn(),
    load: vi.fn(),
    rename: vi.fn(),
    recordCreate: vi.fn(),
    recordUpdate: vi.fn(),
    recordDelete: vi.fn(),
    propAdd: vi.fn(),
    propUpdate: vi.fn(),
    propRemove: vi.fn(),
    propMove: vi.fn(),
    viewSave: vi.fn(),
    viewReorder: vi.fn(),
    viewRemove: vi.fn(),
    relationSearch: vi.fn(),
    exportCsv: vi.fn(),
  };
  vi.stubGlobal('septcats', { db: mock });
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useDbPage 四态', () => {
  let db: MockDb;

  beforeEach(() => {
    db = installMockDb();
  });

  it('loading → ready（有记录）', async () => {
    db.load.mockResolvedValue({ collection: makeCollection(), records: [makeRecord('r1', '第一条')] });
    const { result } = renderHook(() => useDbPage('pg-1'));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.collection?.name).toBe('研究库');
    expect(result.current.records).toHaveLength(1);
  });

  it('loading → empty（零记录）', async () => {
    db.load.mockResolvedValue({ collection: makeCollection(), records: [] });
    const { result } = renderHook(() => useDbPage('pg-1'));

    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('empty'));
    expect(result.current.collection).not.toBeNull();
    expect(result.current.records).toHaveLength(0);
  });

  it('loading → error，reload 后恢复', async () => {
    db.load.mockRejectedValueOnce(new Error('E_NOT_FOUND: 数据库不存在'));
    const { result } = renderHook(() => useDbPage('pg-1'));

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toContain('E_NOT_FOUND');

    db.load.mockResolvedValue({ collection: makeCollection(), records: [makeRecord('r1', '第一条')] });
    result.current.reload();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.collection?.name).toBe('研究库');
  });

  it('IDEA-E R4：reorderViews 软刷新——status 不回 loading、collection.views 换新序、不重发 load', async () => {
    const base = makeCollection();
    db.load.mockResolvedValue({
      collection: { ...base, views: [...base.views, { vid: 'v2', name: '看板', type: 'kanban' as const, filter: { op: 'and' as const, clauses: [] }, sort: [], widths: {} }] },
      records: [makeRecord('r1', '第一条')],
    });
    const { result } = renderHook(() => useDbPage('pg-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const loadCalls = db.load.mock.calls.length;

    // main 回包 = 改序后的 collection（v2 换到最前）。
    const moved = makeCollection();
    moved.views = [{ vid: 'v2', name: '看板', type: 'kanban' as const, filter: { op: 'and' as const, clauses: [] }, sort: [], widths: {} }, { vid: 'v1', name: '表格', type: 'table', filter: { op: 'and', clauses: [] }, sort: [], widths: {} }];
    db.viewReorder.mockResolvedValue({ collection: moved });
    await act(async () => {
      await result.current.reorderViews('v2', 'v1');
    });

    // 效果断言：序已换、状态没被打回 loading（旧缺陷=reload() 致 Skeleton 重挂关菜单）、records 保留、未二次 load。
    expect(result.current.collection?.views.map((v) => v.vid)).toEqual(['v2', 'v1']);
    expect(result.current.status).toBe('ready');
    expect(result.current.records).toHaveLength(1);
    expect(db.load.mock.calls.length).toBe(loadCalls);
  });
});

describe('DbPage 渲染冒烟', () => {
  let db: MockDb;

  beforeEach(() => {
    db = installMockDb();
  });

  it('ready 态渲染 DbView：标题与记录可见', async () => {
    db.load.mockResolvedValue({ collection: makeCollection(), records: [makeRecord('r1', '第一条')] });
    render(createElement(DbPage, { pageId: 'pg-1' }));

    await screen.findByText('研究库');
    await screen.findByText('第一条');
  });

  it('error 态渲染 ErrorPanel（带重试）', async () => {
    db.load.mockRejectedValue(new Error('E_DB_UNAVAILABLE: 数据库服务未就绪'));
    render(createElement(DbPage, { pageId: 'pg-1' }));

    await screen.findByText(/数据库服务未就绪/);
  });

  it('empty 态渲染 EmptyState（带新建记录 CTA）', async () => {
    db.load.mockResolvedValue({ collection: makeCollection(), records: [] });
    render(createElement(DbPage, { pageId: 'pg-1' }));

    await screen.findByText('还没有记录');
    await screen.findByText('新建记录');
  });
});
