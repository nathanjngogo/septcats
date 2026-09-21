// @vitest-environment jsdom
/**
 * templates-ui.test.tsx —— 模板 UI 面（TASK-T23-02）。
 *
 * 覆盖：
 * - 模板 slice 动作与 IPC 断言（load/saveFromPage/createFromTemplate/rename/delete，
 *   含成功刷新与失败 Toast）；
 * - 命令面板「模板」独立分组：渲染、按模板标题检索、与页面命中分组的隔离（>`/auto）、
 *   点击 → createPage({templateId,parentId:null}) + 关面板；
 * - 「另存为模板」条件命令（有选中页才出现）+ 命名弹窗（默认名 = 页标题、IPC、关闭）；
 * - 侧栏「新建页面 ▾」：右侧箭头展开模板子菜单（懒加载）、点击建页并关菜单、空态；
 * - 设置页「模板」区块：行渲染、重命名/删除回调、空态。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥；断言落在 store 状态与假桥调用。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageNode } from '@septcats/editor';
import type { TemplateMeta } from '../src/main/templates';
import { CommandPalette } from '../src/renderer/src/palette/CommandPalette';
import {
  SAVE_AS_TEMPLATE_DEF,
  bindPaletteCommands,
  configurePaletteCommands,
} from '../src/renderer/src/palette/commands';
import { PALETTE_INITIAL_STATE, paletteActions, paletteStore } from '../src/renderer/src/state/palette';
import { pagesStore, type PagesState } from '../src/renderer/src/state/pages';
import { templatesActions, templatesStore } from '../src/renderer/src/state/templates';
import { SidebarTree } from '../src/renderer/src/pages/SidebarTree';
import { SettingsPage } from '../src/renderer/src/pages/SettingsPage';
import { TemplateSaveDialog } from '../src/renderer/src/templates/TemplateSaveDialog';
import type { AppSettings } from '../src/shared/settings';
import type { SeptcatsApi } from '../src/types/window';

const WS_ID = 'ws-tpl-test';

const TEMPLATES: TemplateMeta[] = [
  { id: 'tpl-1', kind: 'page', title: '研究模板', icon: '📚', updated_at: 2 },
  { id: 'tpl-2', kind: 'database', title: '台账模板', icon: null, updated_at: 1 },
];

function pageNode(overrides: Partial<PageNode> & Pick<PageNode, 'id'>): PageNode {
  return {
    title: overrides.id,
    icon: null,
    cover: null,
    workspaceId: WS_ID,
    parentId: null,
    sortKey: 'A00000000',
    version: 1,
    alive: 1,
    deletedAt: null,
    childIds: [],
    depth: 0,
    ...overrides,
  };
}

function defaultSettings(): AppSettings {
  return {
    theme: 'system',
    locale: 'zh-CN',
    privacy: { telemetry: false, linkPreviewOnType: true },
    editor: { defaultEditMode: 'rich', spellcheck: true },
    trayClose: 'ask',
    data: { note: '~/.septcats' },
    sync: { enabled: true, encrypt: false, gc: false },
    ai: { enabled: false, cloudConsent: false, activeProviderId: null, providers: [] },
  };
}

interface Bridge {
  templatesList: ReturnType<typeof vi.fn>;
  templatesSave: ReturnType<typeof vi.fn>;
  templatesRename: ReturnType<typeof vi.fn>;
  templatesRemove: ReturnType<typeof vi.fn>;
  templatesCreatePage: ReturnType<typeof vi.fn>;
  pagesTree: ReturnType<typeof vi.fn>;
  pagesCreate: ReturnType<typeof vi.fn>;
  recentTouch: ReturnType<typeof vi.fn>;
  searchQuery: ReturnType<typeof vi.fn>;
}

let nodesDb: PageNode[];
let templatesDb: TemplateMeta[];
let bridge: Bridge;

function installBridge(): Bridge {
  const impl: Bridge = {
    templatesList: vi.fn(async () => ({ templates: templatesDb.map((tpl) => ({ ...tpl })) })),
    templatesSave: vi.fn(async () => ({ id: 'tpl-new' })),
    templatesRename: vi.fn(async () => ({})),
    templatesRemove: vi.fn(async () => ({})),
    templatesCreatePage: vi.fn(async () => ({ pageId: 'pg-from-tpl' })),
    pagesTree: vi.fn(async () => nodesDb.map((node) => ({ ...node, childIds: [...node.childIds] }))),
    pagesCreate: vi.fn(async () => ({ id: 'pg-new', sortKey: 'A00000009' })),
    recentTouch: vi.fn(async () => ({ pageIds: [] })),
    searchQuery: vi.fn(async () => ({ hits: [], tookMs: 1 })),
  };
  bridge = impl;
  const settings = defaultSettings();
  vi.stubGlobal('septcats', {
    ping: vi.fn(),
    appMeta: vi.fn(async () => ({ name: 'Septcats', version: '0.0.0', schemaVersion: 1, layoutRoot: '.septcats' })),
    workspaces: { list: async () => ({ items: [{ id: WS_ID, name: '个人工作区' }], activeId: WS_ID }) },
    pages: { tree: impl.pagesTree, create: impl.pagesCreate },
    favorites: { list: async () => ({ pageIds: [] }) },
    recent: { list: async () => ({ pageIds: [] }), touch: impl.recentTouch },
    search: {
      query: impl.searchQuery,
      onTogglePalette: vi.fn(() => () => {}),
    },
    templates: {
      list: impl.templatesList,
      get: vi.fn(),
      saveFromPage: impl.templatesSave,
      rename: impl.templatesRename,
      remove: impl.templatesRemove,
      createPage: impl.templatesCreatePage,
    },
    settings: { get: vi.fn(async () => settings), patch: vi.fn(async (p: Partial<AppSettings>) => ({ ...settings, ...p })) },
    diag: { export: vi.fn(), confirm: vi.fn() },
    update: { check: vi.fn(), download: vi.fn(), install: vi.fn(), rollbackHint: vi.fn(), onState: vi.fn(() => () => {}) },
    sync: { status: vi.fn(), setEnabled: vi.fn(), now: vi.fn(), onState: vi.fn(() => () => {}) },
    ai: {
      state: vi.fn(async () => ({ enabled: false, cloudConsent: false, activeProviderId: null, providers: [] })),
      listModels: vi.fn(),
      chat: vi.fn(),
      setKey: vi.fn(),
      clearKey: vi.fn(),
    },
    collab: { attach: vi.fn(), detach: vi.fn(), apply: vi.fn(), onUpdate: vi.fn(() => () => {}) },
    blocks: {},
  } as unknown as SeptcatsApi);
  return impl;
}

function seedPagesStore(extra?: Partial<PagesState>): void {
  pagesStore.setState((state) => ({
    ...state,
    status: 'ready',
    error: null,
    view: 'pages',
    workspaceId: WS_ID,
    workspaces: [{ id: WS_ID, name: '个人工作区' }],
    nodes: nodesDb,
    expanded: new Set<string>(),
    selectedId: 'pg-1',
    editingId: null,
    favoriteIds: [],
    recentIds: [],
    toasts: [],
    ...extra,
  }));
}

function seedTemplatesStore(list: TemplateMeta[] = TEMPLATES): void {
  templatesStore.setState((state) => ({ ...state, status: 'ready', error: null, templates: list, saveDialogOpen: false }));
}

function resetStores(): void {
  nodesDb = [pageNode({ id: 'pg-1', title: '实验笔记' })];
  templatesDb = TEMPLATES.map((tpl) => ({ ...tpl }));
  paletteStore.setState(() => ({
    ...PALETTE_INITIAL_STATE,
    commands: bindPaletteCommands({
      createPage: () => undefined,
      switchToNextWorkspace: () => undefined,
      openTrash: () => undefined,
      openSettings: () => undefined,
      notify: () => undefined,
      setThemeMode: () => undefined,
    }),
  }));
  seedTemplatesStore();
  seedPagesStore();
}

beforeEach(() => {
  installBridge();
  resetStores();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('模板 slice（TASK-T23-02 §E：IPC 集中 + 刷新）', () => {
  it('loadTemplates：调 templates:list({}) 并写入 store（status ready）', async () => {
    await templatesActions.loadTemplates();
    expect(bridge.templatesList).toHaveBeenCalledWith({});
    expect(templatesStore.getState().status).toBe('ready');
    expect(templatesStore.getState().templates.map((tpl) => tpl.id)).toEqual(['tpl-1', 'tpl-2']);
  });

  it('loadTemplates 失败：status error、不抛错、错误留在 slice', async () => {
    bridge.templatesList.mockRejectedValueOnce(new Error('E_INVARIANT: boom'));
    await expect(templatesActions.loadTemplates()).resolves.toBeUndefined();
    expect(templatesStore.getState().status).toBe('error');
    expect(templatesStore.getState().error).toContain('E_INVARIANT');
  });

  it('saveFromPage：只传 title（icon 继承源页 §0.A）→ 刷新列表 + success Toast', async () => {
    await templatesActions.loadTemplates();
    expect(bridge.templatesList).toHaveBeenCalledTimes(1);
    const ok = await templatesActions.saveFromPage('pg-1', '我的模板');
    expect(ok).toBe(true);
    expect(bridge.templatesSave).toHaveBeenCalledWith({ pageId: 'pg-1', title: '我的模板' });
    // 写操作后列表统一刷新（第二次 list）
    expect(bridge.templatesList).toHaveBeenCalledTimes(2);
    expect(pagesStore.getState().toasts.some((toast) => toast.tone === 'success')).toBe(true);
  });

  it('saveFromPage 失败：danger Toast + 返回 false', async () => {
    bridge.templatesSave.mockRejectedValueOnce(new Error('E_MALFORMED: bad'));
    const ok = await templatesActions.saveFromPage('pg-1', 'x');
    expect(ok).toBe(false);
    expect(pagesStore.getState().toasts.some((toast) => toast.tone === 'danger')).toBe(true);
  });

  it('createFromTemplate：createPage({templateId, parentId:null}) → 对账树 → 选中新页', async () => {
    const pageId = await templatesActions.createFromTemplate('tpl-2');
    expect(pageId).toBe('pg-from-tpl');
    expect(bridge.templatesCreatePage).toHaveBeenCalledWith({ templateId: 'tpl-2', parentId: null });
    expect(bridge.pagesTree).toHaveBeenCalled(); // refresh 对账
    expect(pagesStore.getState().selectedId).toBe('pg-from-tpl');
    expect(pagesStore.getState().view).toBe('pages');
  });

  it('createFromTemplate 失败：返回 null + danger Toast', async () => {
    bridge.templatesCreatePage.mockRejectedValueOnce(new Error('E_TEMPLATE_NOT_FOUND: gone'));
    expect(await templatesActions.createFromTemplate('tpl-404')).toBeNull();
    expect(pagesStore.getState().toasts.some((toast) => toast.tone === 'danger')).toBe(true);
  });

  it('renameTemplate / deleteTemplate：IPC 参数正确，写后统一刷新列表', async () => {
    await templatesActions.loadTemplates();
    const renamed = await templatesActions.renameTemplate('tpl-1', '新名字');
    expect(renamed).toBe(true);
    expect(bridge.templatesRename).toHaveBeenCalledWith({ id: 'tpl-1', title: '新名字' });

    const deleted = await templatesActions.deleteTemplate('tpl-1');
    expect(deleted).toBe(true);
    expect(bridge.templatesRemove).toHaveBeenCalledWith({ id: 'tpl-1' });
    // 每次写各触发一次对账刷新（load + rename + delete = 3）
    expect(bridge.templatesList).toHaveBeenCalledTimes(3);
  });

  it('beginSaveFromPage：无选中页不开弹窗（不得抛错），有选中页才开', () => {
    seedPagesStore({ selectedId: null });
    templatesActions.beginSaveFromPage();
    expect(templatesStore.getState().saveDialogOpen).toBe(false);

    seedPagesStore({ selectedId: 'pg-1' });
    templatesActions.beginSaveFromPage();
    expect(templatesStore.getState().saveDialogOpen).toBe(true);
    templatesActions.cancelSaveFromPage();
    expect(templatesStore.getState().saveDialogOpen).toBe(false);
  });
});

describe('「另存为模板」条件命令（§B）', () => {
  const deps = {
    createPage: () => undefined,
    switchToNextWorkspace: () => undefined,
    openTrash: () => undefined,
    openSettings: () => undefined,
    notify: () => undefined,
    setThemeMode: () => undefined,
  };

  it('有选中页 → 命令出现且 run 调 saveAsTemplate 依赖；无选中页 → 命令不出现', () => {
    const runSpy = vi.fn();
    const withCommand = configurePaletteCommands({ ...deps, saveAsTemplate: runSpy }, true);
    expect(withCommand.some((command) => command.id === 'page.saveAsTemplate')).toBe(true);
    withCommand.find((command) => command.id === 'page.saveAsTemplate')?.run();
    expect(runSpy).toHaveBeenCalledTimes(1);

    const withoutCommand = configurePaletteCommands({ ...deps, saveAsTemplate: runSpy }, false);
    expect(withoutCommand.some((command) => command.id === 'page.saveAsTemplate')).toBe(false);
    // 其余命令不受影响（静态 14 条）
    expect(withoutCommand).toHaveLength(14);
  });

  it('SAVE_AS_TEMPLATE_DEF：label/检索别名可命中', () => {
    expect(SAVE_AS_TEMPLATE_DEF.label).toBe('另存为模板');
    expect(SAVE_AS_TEMPLATE_DEF.aliases).toContain('scmb');
  });

  it('TemplateSaveDialog：默认名 = 当前页标题；确认 → saveFromPage + 关弹窗', async () => {
    seedPagesStore({ selectedId: 'pg-1' });
    templatesStore.setState((state) => ({ ...state, saveDialogOpen: true }));
    render(<TemplateSaveDialog />);

    const input = screen.getByTestId('template-save-name') as HTMLInputElement;
    expect(input.value).toBe('实验笔记');

    fireEvent.change(input, { target: { value: '我的研究模板' } });
    await waitFor(() => expect(screen.getByTestId('template-save-confirm')).toBeDefined());
    fireEvent.click(screen.getByTestId('template-save-confirm'));

    await waitFor(() => expect(bridge.templatesSave).toHaveBeenCalledWith({ pageId: 'pg-1', title: '我的研究模板' }));
    await waitFor(() => expect(templatesStore.getState().saveDialogOpen).toBe(false));
  });

  it('TemplateSaveDialog：空名禁用保存按钮', () => {
    seedPagesStore({ selectedId: 'pg-1' });
    templatesStore.setState((state) => ({ ...state, saveDialogOpen: true }));
    render(<TemplateSaveDialog />);
    const input = screen.getByTestId('template-save-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    expect((screen.getByTestId('template-save-confirm') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('命令面板「模板」分组（§C.2：独立分组，不混进页面命中）', () => {
  it('打开面板拉模板列表；模板行 = 「从模板新建：<名称>」 + 独立分组头', async () => {
    render(<CommandPalette />);
    paletteActions.open();
    await waitFor(() => expect(bridge.templatesList).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('从模板新建：研究模板')).toBeDefined());
    expect(screen.getByText('从模板新建：台账模板')).toBeDefined(); // 空图标回退后名称照常
    expect(screen.getByText('模板', { selector: '.palette-group' })).toBeDefined();
  });

  it('点击模板行 → createPage({templateId,parentId:null}) + 关面板', async () => {
    render(<CommandPalette />);
    paletteActions.open();
    const row = await screen.findByText('从模板新建：研究模板');
    const option = row.closest('[role="option"]');
    expect(option).not.toBeNull();
    fireEvent.mouseEnter(option!);
    fireEvent.click(option!);
    await waitFor(() => expect(bridge.templatesCreatePage).toHaveBeenCalledWith({ templateId: 'tpl-1', parentId: null }));
    expect(paletteStore.getState().open).toBe(false);
    expect(paletteStore.getState().searchOpen).toBe(false);
  });

  it('检索按模板标题：命中只落在「模板」分组，页面分组不出现', async () => {
    render(<CommandPalette />);
    paletteActions.open();
    await screen.findByText('从模板新建：研究模板');
    paletteActions.setQuery('台账');
    await waitFor(() => expect(screen.getByText('从模板新建：台账模板')).toBeDefined());
    expect(screen.queryByText('从模板新建：研究模板')).toBeNull();
    expect(screen.queryByText('页面与跳转')).toBeNull();
    expect(screen.queryByText('命令')).toBeNull();
    expect(screen.getByText('模板', { selector: '.palette-group' })).toBeDefined();
  });

  it("'>' 仅命令模式：模板行不出现；auto 无匹配标题时模板被过滤", async () => {
    render(<CommandPalette />);
    paletteActions.open();
    await screen.findByText('从模板新建：研究模板');
    paletteActions.setQuery('>');
    await waitFor(() => expect(screen.queryByText('从模板新建：研究模板')).toBeNull());
    paletteActions.setQuery('zzz不存在');
    await waitFor(() => expect(screen.queryByText('从模板新建：研究模板')).toBeNull());
    expect(screen.queryByText('模板', { selector: '.palette-group' })).toBeNull();
  });
});

describe('侧栏「新建页面 ▾」（§C.1）', () => {
  it('主体点击仍 = 新建空白页（既有行为不破坏）', async () => {
    render(<SidebarTree />);
    fireEvent.click(screen.getByTestId('side-new-page'));
    await waitFor(() => expect(bridge.pagesCreate).toHaveBeenCalledWith({ parentId: null }));
  });

  it('右侧箭头展开模板子菜单（懒加载列表），行 = 图标 + 模板名', async () => {
    render(<SidebarTree />);
    expect(screen.queryByTestId('side-tpl-item-0')).toBeNull();
    fireEvent.click(screen.getByTestId('side-new-page-arrow'));
    await waitFor(() => expect(bridge.templatesList).toHaveBeenCalled());
    const item = await screen.findByTestId('side-tpl-item-0');
    expect(item.textContent).toContain('研究模板');
    // 数据 icon（emoji）以文本展示；空 icon 按 kind 回落 ui 图标
    expect(item.textContent).toContain('📚');
    expect(screen.getByTestId('side-tpl-item-1').textContent).toContain('台账模板');
  });

  it('点击模板项 → createPage({templateId,parentId:null}) → 选中新页 → 菜单关闭', async () => {
    render(<SidebarTree />);
    fireEvent.click(screen.getByTestId('side-new-page-arrow'));
    const item = await screen.findByTestId('side-tpl-item-1');
    fireEvent.click(item);
    await waitFor(() => expect(bridge.templatesCreatePage).toHaveBeenCalledWith({ templateId: 'tpl-2', parentId: null }));
    await waitFor(() => expect(pagesStore.getState().selectedId).toBe('pg-from-tpl'));
    expect(screen.queryByTestId('side-tpl-item-0')).toBeNull();
  });

  it('模板为空：空态行「暂无模板」（与既有空态同 token）', async () => {
    seedTemplatesStore([]);
    render(<SidebarTree />);
    fireEvent.click(screen.getByTestId('side-new-page-arrow'));
    await waitFor(() => expect(screen.getByTestId('side-tpl-empty').textContent).toBe('暂无模板'));
  });
});

describe('设置页「模板」区块（§D）', () => {
  it('渲染模板行（图标 + 名称），空态「暂无模板」', async () => {
    render(<SettingsPage />);
    const row = await screen.findByTestId('settings-tpl-row-0');
    expect(row.textContent).toContain('研究模板');
    expect(row.textContent).toContain('📚');
    expect(screen.getByTestId('settings-tpl-row-1').textContent).toContain('台账模板');
  });

  it('空列表回落空态行', async () => {
    seedTemplatesStore([]);
    render(<SettingsPage />);
    await waitFor(() => expect(screen.getByTestId('settings-tpl-empty').textContent).toBe('暂无模板'));
  });

  it('「⋯」→ 重命名：Dialog 预填名称，确认 → rename({id,title}) + 刷新', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByTestId('settings-tpl-menu-0'));
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
    const input = await screen.findByTestId('template-rename-name') as HTMLInputElement;
    expect(input.value).toBe('研究模板');
    fireEvent.change(input, { target: { value: '改名后的模板' } });
    fireEvent.click(screen.getByTestId('template-rename-confirm'));
    await waitFor(() => expect(bridge.templatesRename).toHaveBeenCalledWith({ id: 'tpl-1', title: '改名后的模板' }));
  });

  it('「⋯」→ 删除：二次确认 Dialog，确认 → remove({id})', async () => {
    render(<SettingsPage />);
    fireEvent.click(await screen.findByTestId('settings-tpl-menu-1'));
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));
    expect(await screen.findByText(/将删除模板「台账模板」/)).toBeDefined();
    fireEvent.click(screen.getByTestId('template-delete-confirm'));
    await waitFor(() => expect(bridge.templatesRemove).toHaveBeenCalledWith({ id: 'tpl-2' }));
  });
});
