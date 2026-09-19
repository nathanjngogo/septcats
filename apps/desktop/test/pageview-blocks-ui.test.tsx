// @vitest-environment jsdom
/**
 * pageview-blocks-ui.test.tsx —— TASK-T32-01 UI 用例（块编辑器「看得见」）。
 *
 * 覆盖（PageView 装配层，修复前 hover 时手柄 DOM 完全不存在 / 斜杠菜单落视口外）：
 * - hover 任意块（不先选中）→ .sc-blockcontrol__handle 出现，归属块随 hover 切换；
 *   鼠标离开 .pv-body → 手柄收起（无选中兜底）；
 * - 点手柄上的 ＋ → 在该块后插入新空块（DOM 块数 +1）；
 * - 输入 / → 斜杠菜单渲染；↑ + Enter 应用「标题 1」→ 块 DOM 标签真的变 h1、菜单关闭；
 * - 手柄拖拽第 2 块到第 1 块之前 → DOM 顺序变化 + reorder Op 落库（blocks:commit）。
 * 纪律：window.septcats 用 vi.stubGlobal 假桥（trash-ui.test.tsx 同款）；
 * 视口数值验收（getBoundingClientRect 在视口内）属真机量化项，由 PM 复跑。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '@septcats/editor';
import { PageView } from '../src/renderer/src/pages/PageView';
import type { SeptcatsApi } from '../src/types/window';

function makeBlock(id: string, sortKey: string, text: string): Block {
  return {
    id,
    page_id: 'pg-1',
    type: 'paragraph',
    props: {},
    content:
      text.length > 0
        ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
        : null,
    parent_id: null,
    sort_key: sortKey,
    alive: 1,
    version: 1,
    last_edited: 0,
  };
}

function makeBridge(blocks: Block[]) {
  return {
    blocks: {
      commit: vi.fn().mockResolvedValue(0),
      list: vi.fn().mockResolvedValue(blocks),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    recent: {
      touch: vi.fn().mockResolvedValue({ pageIds: [] }),
      list: vi.fn().mockResolvedValue({ pageIds: [] }),
    },
    workspaces: {
      list: vi.fn().mockResolvedValue({ items: [{ id: 'ws-1', name: '个人工作区' }], activeId: 'ws-1' }),
      onChanged: vi.fn().mockReturnValue(() => {}),
    },
    collab: {
      attach: vi.fn().mockResolvedValue({ entries: [], ledgerHasCrdt: false }),
      apply: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn().mockReturnValue(() => {}),
    },
  };
}

type Bridge = ReturnType<typeof makeBridge>;

let bridge: Bridge;

beforeEach(() => {
  bridge = makeBridge([makeBlock('blk-1', 'A00000000', '第一段'), makeBlock('blk-2', 'A00000001', '第二段')]);
  vi.stubGlobal('septcats', bridge as unknown as SeptcatsApi);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function mountPageView(): Promise<HTMLElement> {
  render(<PageView page={{ id: 'pg-1', title: '测试页' }} />);
  const host = await screen.findByTestId('septcats-editor');
  await waitFor(() => {
    // blocks:list 已投影成两个带 data-id 的块
    expect(host.querySelectorAll('[data-id]').length).toBe(2);
  });
  return host;
}

describe('PageView 块手柄（T32-01 §1.1）', () => {
  it('hover 块即出现手柄（不要求先选中），归属块随 hover 切换；离开编辑区收起', async () => {
    const host = await mountPageView();

    // 修复前：未点击选中时手柄整棵不存在。现在 hover 第一块即出现。
    fireEvent.mouseOver(host.querySelector('[data-id="blk-1"]')!);
    const handle = await screen.findByRole('button', { name: '块操作' });
    expect((handle as HTMLButtonElement).disabled).toBe(false);
    expect(handle.closest('.sc-blockcontrol')?.getAttribute('data-block-id')).toBe('blk-1');

    // hover 第二块 → 归属切换
    fireEvent.mouseOver(host.querySelector('[data-id="blk-2"]')!);
    await waitFor(() => {
      expect(handle.closest('.sc-blockcontrol')?.getAttribute('data-block-id')).toBe('blk-2');
    });

    // 鼠标离开编辑区 → hover 归属清零，手柄回退兜底到光标所在块（键盘可达性：
    // 纯键盘用户也要能 Tab 到手柄；初始光标在第一块）
    fireEvent.mouseLeave(document.querySelector('.pv-body')!);
    await waitFor(() => {
      expect(handle.closest('.sc-blockcontrol')?.getAttribute('data-block-id')).toBe('blk-1');
    });
  });

  it('点手柄上的 ＋ → 该块后插入新空块（DOM 块数 +1）', async () => {
    const host = await mountPageView();
    fireEvent.mouseOver(host.querySelector('[data-id="blk-2"]')!);
    fireEvent.click(await screen.findByRole('button', { name: '新增块' }));
    await waitFor(() => {
      expect(host.querySelectorAll('[data-id]').length).toBe(3);
    });
    // 新块在 blk-2 之后（末尾）
    const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
    expect(ids[1]).toBe('blk-2');
    expect(ids.length).toBe(3);
  });
});

describe('PageView 斜杠菜单（T32-01 §1.2）', () => {
  it('输入 / 弹菜单；↓ + Enter 应用「标题 1」→ 块标签变 h1、菜单关闭', async () => {
    const host = await mountPageView();
    const body = document.querySelector('.pv-body')!;

    fireEvent.keyDown(body, { key: '/' });
    const menu = await screen.findByTestId('septcats-slashmenu');
    expect(menu.querySelectorAll('[role="option"]').length).toBe(11);

    // ↓ 一次 → 第 2 项「标题 1」；Enter 应用
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => {
      expect(host.querySelector('h1[data-id="blk-1"]')).not.toBeNull();
    });
    expect(screen.queryByTestId('septcats-slashmenu')).toBeNull();
  });

  it('Enter 落在 contenteditable（真机路径）只应用块型：不分块、无残留、scrollTop=0（T35-01/T36-01 §1.3）', async () => {
    const host = await mountPageView();
    const body = document.querySelector('.pv-body')!;
    const scroller = document.querySelector('.pv-root') as HTMLElement;

    fireEvent.keyDown(body, { key: '/' });
    await screen.findByTestId('septcats-slashmenu');
    fireEvent.keyDown(window, { key: 'ArrowDown' });

    // 焦点在编辑器时 Enter 先经 PM 的 view.dom 冒泡、后到 window 菜单处理器。
    // 修复前（bubble 监听）PM 先 splitBlock、菜单再应用 → 双处理：多出空块 + 残留。
    // 修复后 SlashMenu 在 capture 阶段 preventDefault，PM 的 eventBelongsToView
    // 看到 defaultPrevented 直接跳过 → 键盘只属于菜单。
    const editable = host.querySelector('.ProseMirror')!;
    fireEvent.keyDown(editable, { key: 'Enter', keyCode: 13 });

    await waitFor(() => {
      expect(host.querySelector('h1[data-id="blk-1"]')).not.toBeNull();
    });
    expect(screen.queryByTestId('septcats-slashmenu')).toBeNull();
    // 仍只有 2 个块（修复前 splitBlock 会多出一个空段落）
    expect(host.querySelectorAll('[data-id]').length).toBe(2);
    // 无残留文本：h1 内容 = 原文「第一段」
    expect(host.querySelector('h1[data-id="blk-1"]')?.textContent).toBe('第一段');
    // 换型不牵动滚动（jsdom 无布局，scrollTop 恒 0；数值断言在真机探针 §2.1②）
    expect(scroller.scrollTop).toBe(0);
  });
});

describe('PageView 手柄拖拽（T32-01 §2.④）', () => {
  it('把第 2 块拖到第 1 块之前：DOM 顺序变化 + reorder Op 落库', async () => {
    const host = await mountPageView();

    // hover 第二块 → 手柄归属 blk-2 → 从手柄发起拖拽
    fireEvent.mouseOver(host.querySelector('[data-id="blk-2"]')!);
    const handleEl = await screen.findByRole('button', { name: '块操作' });
    fireEvent.dragStart(handleEl.closest('.pv-handle')!);

    const blk1 = host.querySelector('[data-id="blk-1"]')!;
    fireEvent.dragOver(blk1);
    fireEvent.drop(blk1);

    // ① DOM 顺序：blk-2 到 blk-1 之前
    await waitFor(() => {
      const ids = [...host.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
      expect(ids[0]).toBe('blk-2');
      expect(ids[1]).toBe('blk-1');
    });

    // ② 落库：blocks:commit 收到含 reorder 的 Op 批（EditSession debounce 300ms）
    await waitFor(
      () => {
        expect(bridge.blocks.commit).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    const payload = bridge.blocks.commit.mock.calls[0]?.[0] as { ops: Array<{ kind: string }> };
    expect(payload.ops.some((op) => op.kind === 'reorder')).toBe(true);
  });
});
