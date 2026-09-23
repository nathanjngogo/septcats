// @vitest-environment jsdom
/**
 * workspace-lib-t70.test.tsx —— T70-01 库层级 UI 单测。
 *
 * 覆盖：①侧栏头库切换器（Menu 项 = 库列表 ✓ + 新建/重命名动作）；②新建库弹框（名字 + 类型三选卡，
 * 空名禁用）；③类型种子（工作台库→home / 知识库库→5 结构页且仅留 MOC / 空白库→无）；④重命名库原地输入态。
 * 后端走 stub 桥（globalThis.septcats），零 electron、真实数据根 untouched。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { pagesActions, pagesStore } from '../src/renderer/src/state/pages';
import { workbenchStore } from '../src/renderer/src/workbench/state';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { t } from '../src/renderer/src/i18n';
import type { SeptcatsApi } from '../src/types/window';

type StubNode = { id: string; title: string; parentId: string | null; alive: number; sortKey: string };

let createdNodes: Map<string, StubNode>;
let wsCreateSeq: number;
let pgCreateSeq: number;
let activeWs: string;
let switchCalls: string[];

function installBridge(): void {
  createdNodes = new Map();
  wsCreateSeq = 0;
  pgCreateSeq = 0;
  activeWs = 'ws-1';
  switchCalls = [];

  const api = {
    workspaces: {
      list: async () => ({
        items: [
          { id: 'ws-1', name: '个人工作区' },
          { id: 'ws-2', name: '第二库' },
        ],
        activeId: activeWs,
      }),
      create: async (_input: { name: string }) => {
        wsCreateSeq += 1;
        return { id: `new-ws-${String(wsCreateSeq)}` };
      },
      rename: async (input: { id: string; name: string }) => ({ id: input.id }),
      switch: async (input: { id: string }) => {
        activeWs = input.id;
        switchCalls.push(input.id);
        return { activeId: input.id };
      },
      onChanged: vi.fn(() => () => {}),
    },
    pages: {
      tree: async () => [...createdNodes.values()],
      create: async (input: { parentId: string | null }) => {
        pgCreateSeq += 1;
        const id = `pg-${String(pgCreateSeq)}`;
        createdNodes.set(id, { id, title: '未命名', parentId: input.parentId, alive: 1, sortKey: String(pgCreateSeq) });
        return { id };
      },
      rename: async (input: { id: string; title: string }) => {
        const node = createdNodes.get(input.id);
        if (node !== undefined) {
          createdNodes.set(input.id, { ...node, title: input.title });
        }
        return { id: input.id };
      },
      remove: vi.fn(),
      move: vi.fn(),
      convert: vi.fn(),
    },
    favorites: { list: async () => ({ pageIds: [] }), set: vi.fn() },
    recent: { list: async () => ({ pageIds: [] }), touch: vi.fn(async () => ({ pageIds: [] })) },
    blocks: { list: vi.fn(async () => ({ locked: false, blocks: [] })), commit: vi.fn() },
    db: { create: vi.fn(), load: vi.fn() },
    settings: { get: vi.fn(async () => ({})), patch: vi.fn(async () => ({})) },
    sync: { status: vi.fn(async () => null), onState: vi.fn(() => () => {}), now: vi.fn(async () => null), setEnabled: vi.fn() },
    collab: {
      attach: vi.fn(async () => ({ entries: [], ledgerHasCrdt: false })),
      detach: vi.fn(async () => ({})),
      apply: vi.fn(async () => ({})),
      onUpdate: vi.fn(() => () => {}),
    },
    ai: { state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })) },
    templates: { list: vi.fn(async () => ({ templates: [] })) },
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    update: { onState: vi.fn(() => () => {}) },
    menu: { onAction: vi.fn(() => () => {}) },
    close: { onFlushRequest: vi.fn(() => () => {}), flushAck: vi.fn(), onAsk: vi.fn(() => () => {}), decide: vi.fn() },
  } as unknown as SeptcatsApi;
  vi.stubGlobal('septcats', api);
}

function resetStores(): void {
  pagesStore.setState((prev) => ({
    ...prev,
    status: 'ready',
    error: null,
    view: 'pages',
    scope: 'all',
    workspaceId: 'ws-1',
    workspaces: [
      { id: 'ws-1', name: '个人工作区' },
      { id: 'ws-2', name: '第二库' },
    ],
    nodes: [],
    expanded: new Set<string>(),
    selectedId: null,
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    deleteConfirmId: null,
    lockedIds: new Set<string>(),
    lockDialog: null,
    lockRev: 0,
    tabs: [],
  }));
  workbenchStore.setState((state) => ({ ...state, view: 'pages' }));
}

beforeEach(() => {
  window.localStorage.clear();
  installBridge();
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('T70-01 ① 侧栏头库切换器', () => {
  it('头行可点（role=button / data-testid=side-ws-head）且弹出库列表 + ✓ + 动作项', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    const { container } = render(<SidebarTree />);
    const head = container.querySelector('[data-testid="side-ws-head"]');
    expect(head).not.toBeNull();
    expect(head?.getAttribute('role')).toBe('button');

    await act(async () => {
      fireEvent.click(head as HTMLElement);
    });

    // 当前库（ws-1）带 ✓ 前缀
    expect(screen.getByText('✓ 个人工作区')).not.toBeNull();
    // 其余库
    expect(screen.getByText('第二库')).not.toBeNull();
    // 动作项
    expect(screen.getByText(t('workspace.newWorkspace'))).not.toBeNull();
    expect(screen.getByText(t('workspace.renameCurrent'))).not.toBeNull();
  });

  it('选库 → switchWorkspace 落库', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    const { container } = render(<SidebarTree />);
    const head = container.querySelector('[data-testid="side-ws-head"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(head);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('第二库'));
    });
    expect(switchCalls).toContain('ws-2');
    expect(pagesStore.getState().workspaceId).toBe('ws-2');
  });

  it('「新建库…」→ 打开新建库弹框（名字 + 类型三选卡）', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    const { container } = render(<SidebarTree />);
    const head = container.querySelector('[data-testid="side-ws-head"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(head);
    });
    await act(async () => {
      fireEvent.click(screen.getByText(t('workspace.newWorkspace')));
    });
    expect(screen.getByTestId('new-ws-name')).not.toBeNull();
    expect(screen.getByTestId('new-ws-type-workbench')).not.toBeNull();
    expect(screen.getByTestId('new-ws-type-knowledge')).not.toBeNull();
    expect(screen.getByTestId('new-ws-type-blank')).not.toBeNull();
  });

  it('「重命名当前库…」→ 头行进入原地输入态', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    const { container } = render(<SidebarTree />);
    const head = container.querySelector('[data-testid="side-ws-head"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(head);
    });
    await act(async () => {
      fireEvent.click(screen.getByText(t('workspace.renameCurrent')));
    });
    const input = screen.getByTestId('side-ws-rename-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('个人工作区');
  });
});

describe('T70-01 ② 新建库弹框', () => {
  it('名字为空 → 创建按钮禁用；输入后启用', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    const { container } = render(<SidebarTree />);
    const head = container.querySelector('[data-testid="side-ws-head"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(head);
    });
    await act(async () => {
      fireEvent.click(screen.getByText(t('workspace.newWorkspace')));
    });
    const confirm = screen.getByTestId('new-ws-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      fireEvent.change(screen.getByTestId('new-ws-name'), { target: { value: '我的库' } });
    });
    expect((screen.getByTestId('new-ws-confirm') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('T70-01 ③ 类型种子', () => {
  it('工作台库 → 切库后开 home 工作台', async () => {
    const id = await pagesActions.createWorkspaceWithType('工作台库A', 'workbench');
    expect(id).toBe('new-ws-1');
    expect(switchCalls).toContain('new-ws-1');
    expect(workbenchStore.getState().view).toBe('home');
  });

  it('知识库库 → 新库下种 5 结构页，仅留 MOC 目录打开，无卡死重命名态', async () => {
    await pagesActions.createWorkspaceWithType('知识库A', 'knowledge');
    const state = pagesStore.getState();
    // 5 个结构页落库（标题来自 i18n）
    const titles = state.nodes.map((node) => node.title).sort();
    expect(titles).toEqual(
      [t('knowledgeBase.archive'), t('knowledgeBase.inbox'), t('knowledgeBase.journal'), t('knowledgeBase.moc'), t('knowledgeBase.resources')].sort(),
    );
    // 仅留 MOC 目录一个标签
    expect(state.tabs).toHaveLength(1);
    const mocId = state.nodes.find((node) => node.title === t('knowledgeBase.moc'))?.id;
    expect(state.tabs[0]).toBe(mocId);
    // 无卡死行内重命名态
    expect(state.editingId).toBeNull();
    // 落在新库（切库后 activeId）
    expect(state.workspaceId).toBe('new-ws-1');
  });

  it('空白库 → 无种子页', async () => {
    await pagesActions.createWorkspaceWithType('空白库A', 'blank');
    const state = pagesStore.getState();
    expect(state.nodes).toHaveLength(0);
    expect(state.tabs).toHaveLength(0);
    expect(state.workspaceId).toBe('new-ws-1');
  });
});

describe('T70-01 ④ 重命名当前库', () => {
  it('renameWorkspace 乐观更新库名（头行即变由组件订阅驱动）', async () => {
    await act(async () => {
      await pagesActions.load();
    });
    await act(async () => {
      await pagesActions.renameWorkspace('ws-1', '改名后的库');
    });
    const ws = pagesStore.getState().workspaces.find((item) => item.id === 'ws-1');
    expect(ws?.name).toBe('改名后的库');
  });
});
