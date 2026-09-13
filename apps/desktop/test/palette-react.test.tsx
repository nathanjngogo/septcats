// @vitest-environment jsdom
/**
 * palette-react.test.tsx —— 命令面板/搜索页 UI 用例（TASK-T8-01 §4）。
 *
 * 覆盖：键盘导航全序列（↑↓ 循环 / Enter 执行 / Esc 关）、aria 属性齐、
 * `>`/`@` 模式切换、点击遮罩关、搜索页渲染与 snippet 高亮。
 * 纪律：不 import electron；window.septcats 用 vi.stubGlobal 假桥替换。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchHit } from '../src/shared/search';
import { CommandPalette } from '../src/renderer/src/palette/CommandPalette';
import { SearchPage } from '../src/renderer/src/pages/SearchPage';
import { bindPaletteCommands } from '../src/renderer/src/palette/commands';
import { PALETTE_INITIAL_STATE, paletteActions, paletteStore } from '../src/renderer/src/state/palette';
import { pagesActions, pagesStore } from '../src/renderer/src/state/pages';
import type { SeptcatsApi } from '../src/types/window';

const HITS: SearchHit[] = [
  {
    kind: 'page',
    id: 'pg-1',
    pageId: 'pg-1',
    title: '暗物质探测实验笔记',
    path: ['研究'],
    snippet: '复核 LZ [核反冲] 效率曲线的统计误差来源',
    score: -1.2,
    via: 'fts',
    updatedAt: 1,
  },
  {
    kind: 'collection',
    id: 'cl-1',
    pageId: 'pg-2',
    title: '实验数据台账',
    path: ['研究'],
    snippet: '导出字段：live-time / [核反冲] 候选事例数',
    score: 1,
    via: 'like',
    updatedAt: 2,
  },
];

function installBridge(): { query: ReturnType<typeof vi.fn>; toggles: Array<() => void> } {
  const toggles: Array<() => void> = [];
  const bridge = {
    ping: vi.fn(),
    appMeta: vi.fn(),
    search: {
      query: vi.fn(async () => ({ hits: HITS, tookMs: 3 })),
      onTogglePalette: vi.fn((listener: () => void) => {
        toggles.push(listener);
        return () => undefined;
      }),
    },
  };
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
  return { query: bridge.search.query, toggles };
}

function makeCommands() {
  return bindPaletteCommands({
    createPage: () => undefined,
    switchToNextWorkspace: () => undefined,
    openTrash: () => undefined,
    openSettings: () => undefined,
    notify: () => undefined,
    setThemeMode: () => undefined,
  });
}

function resetStores(): void {
  paletteStore.setState(() => ({ ...PALETTE_INITIAL_STATE, commands: makeCommands() }));
  pagesStore.setState((state) => ({ ...state, workspaceId: 'ws-1', workspaces: [{ id: 'ws-1', name: '个人工作区' }] }));
}

beforeEach(() => {
  resetStores();
  installBridge();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('CommandPalette（无障碍 + 键盘序列）', () => {
  it('关闭态不渲染；打开后 aria 属性齐全且焦点自动全选', async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();

    paletteActions.open();
    const dialog = await screen.findByRole('dialog', { name: '命令面板' });
    expect(dialog).toBeDefined();

    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBe('septcats-palette-list');
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-opt-0');

    const listbox = screen.getByRole('listbox');
    expect(listbox.id).toBe('septcats-palette-list');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('键盘全序列：↓ 循环到末尾回绕、↑ 反向、aria-activedescendant 跟随、Enter 执行、Esc 关', async () => {
    const runSpy = vi.fn();
    paletteStore.setState((state) => ({
      ...state,
      commands: bindPaletteCommands({
        createPage: runSpy,
        switchToNextWorkspace: () => undefined,
        openTrash: () => undefined,
        openSettings: () => undefined,
        notify: () => undefined,
        setThemeMode: () => undefined,
      }),
    }));

    render(<CommandPalette />);
    paletteActions.open();
    const input = (await screen.findByRole('combobox')) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);

    const user = userEvent.setup();
    const options = () => screen.getAllByRole('option');
    const count = options().length; // 10 条命令

    // ↓ 走到末尾再回绕（循环）
    for (let i = 0; i < count; i += 1) {
      await user.keyboard('{ArrowDown}');
    }
    expect(input.getAttribute('aria-activedescendant')).toBe('palette-opt-0');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');

    // ↑ 反向到末位
    await user.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(`palette-opt-${String(count - 1)}`);

    // Enter 执行当前行（末位 = app.import → notify 假调用；改用首行验证 run 传递）
    paletteActions.setActive(0);
    await user.keyboard('{Enter}');
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(paletteStore.getState().open).toBe(false);
  });

  it('Esc 关闭、点击遮罩关闭（点击面板内部不关）', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    paletteActions.open();
    await screen.findByTestId('palette-overlay');
    await user.keyboard('{Escape}');
    expect(paletteStore.getState().open).toBe(false);

    paletteActions.open();
    const overlay = await screen.findByTestId('palette-overlay');
    // 遮罩自身
    fireEvent.mouseDown(overlay, { target: overlay });
    expect(paletteStore.getState().open).toBe(false);

    paletteActions.open();
    await screen.findByTestId('palette-overlay');
    fireEvent.mouseDown(screen.getByTestId('palette-panel'), { target: screen.getByTestId('palette-panel') });
    expect(paletteStore.getState().open).toBe(true);
  });

  it('hover 同步 activeIndex', async () => {
    render(<CommandPalette />);
    paletteActions.open();
    const options = await screen.findAllByRole('option');
    fireEvent.mouseEnter(options[2]!);
    expect(paletteStore.getState().activeIndex).toBe(2);
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it("'>' 仅命令：无页面组；'@' 仅页面：无命令行", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    paletteActions.open();
    const input = await screen.findByRole('combobox');

    await user.type(input, '@');
    // debounce 后命中到达
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1));
    const pageRow = screen.getByRole('option', { name: /暗物质探测实验笔记/ });
    expect(pageRow).toBeDefined();
    expect(screen.queryByRole('option', { name: /实验数据台账/ })).toBeNull();

    paletteActions.setQuery('>');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(10));
    expect(screen.queryByRole('option', { name: /暗物质探测实验笔记/ })).toBeNull();
  });

  it('debounce 150ms 后调用 search:query（auto 模式）', async () => {
    const { query } = installBridge();
    render(<CommandPalette />);
    paletteActions.open();
    paletteActions.setQuery('核反冲');
    await waitFor(() => expect(query).toHaveBeenCalled(), { timeout: 2000 });
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(2));
  });
});

describe('SearchPage（mockup 05 对齐）', () => {
  it('查询 chip + 类型 chip + 计数与耗时；分组渲染；snippet 高亮；hash 同步', async () => {
    paletteStore.setState((state) => ({
      ...state,
      searchOpen: true,
      query: '核反冲',
      hits: HITS,
      tookMs: 38,
    }));
    render(<SearchPage />);

    expect(screen.getByTestId('search-qchip').textContent).toContain('核反冲');
    // 挂载会触发一次重查（tookMs 被刷新），计数稳定后断言
    await waitFor(() => expect(screen.getByText(/2 条结果 · \d+ ms/)).toBeDefined());
    expect(screen.getByText('页面 · 1')).toBeDefined();
    expect(screen.getByText('数据库 · 1')).toBeDefined();
    expect(screen.getByText('范围：个人工作区')).toBeDefined();

    // snippet 高亮：[核反冲] → <mark>
    const marks = document.querySelectorAll('mark');
    expect(marks.length).toBe(2);
    expect(marks[0]?.textContent).toBe('核反冲');

    await waitFor(() => expect(window.location.hash).toBe('#search=%E6%A0%B8%E5%8F%8D%E5%86%B2'));

    // 类型 chip 循环过滤
    fireEvent.click(screen.getByText('类型：全部'));
    expect(screen.getByText('类型：页面')).toBeDefined();
    expect(screen.queryByText('数据库 · 1')).toBeNull();

    // 查询 chip 可移除
    fireEvent.click(screen.getByTestId('search-qchip'));
    expect(paletteStore.getState().query).toBe('');
  });

  it('点击结果行：selectPage + 关闭搜索页', () => {
    const selectSpy = vi.spyOn(pagesActions, 'selectPage').mockImplementation(() => undefined);
    paletteStore.setState((state) => ({
      ...state,
      searchOpen: true,
      query: '核反冲',
      hits: HITS,
      tookMs: 3,
    }));
    render(<SearchPage />);
    fireEvent.click(screen.getByRole('button', { name: /暗物质探测实验笔记/ }));
    expect(selectSpy).toHaveBeenCalledWith('pg-1');
    expect(paletteStore.getState().searchOpen).toBe(false);
    selectSpy.mockRestore();
  });
});
