// @vitest-environment jsdom
/**
 * t61-01-resize-handle.test.tsx —— TASK-T61-01 §2.2 拖拽把手的交互面。
 *
 * 覆盖（对应任务书 §2.5 测试清单）：
 * - 拖拽改宽 + 落盘：pointerdown→pointermove→pointerup 后 store / 根变量 / localStorage 三处同值
 *   （走既有 patchLayout，preset 自动转 custom）；
 * - 拖拽中「实时随动」：pointermove 后（等一帧）宽度已变，无需等 pointerup；
 * - 键盘：←/→ 步进 16px（两侧方向相反）、Home 回默认（T57 滑杆同款 aria 口径）；
 * - 双击把手 = 该侧回默认宽；
 * - 30% 上限钳制：视口 1000 → 上限 300（两侧各一条）；
 * - rAF 节流：同一帧内多次 pointermove 只落一次写（最终值 = 最后一帧值）；
 * - 无意义态不挂：AI position=bottom/hidden、侧栏 collapsed。
 *
 * 纪律：viewport 用 Object.defineProperty 钉死（jsdom 默认 1024），断言才可复现；
 * 断言落在 layoutStore / documentElement 内联变量 / localStorage（不测像素几何——真机探针管）。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResizeHandle } from '../src/renderer/src/layout/ResizeHandle';
import {
  AI_WIDTH_DEFAULT,
  LAYOUT_PRESETS,
  LAYOUT_STORAGE_KEY,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
  type LayoutState,
} from '../src/renderer/src/layout/layoutState';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const persisted = (): LayoutState =>
  JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as LayoutState;
const rootVar = (name: string): string => document.documentElement.style.getPropertyValue(name);

/** 视口钉死（影响 maxPanelWidth 的 30% 上限；resize 事件不需要——断言都用显式拖拽步长）。 */
function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

function seed(overrides: { sidebarWidth?: number; aiWidth?: number; aiPosition?: LayoutState['ai']['position']; sidebarPosition?: LayoutState['sidebar']['position'] } = {}): void {
  const base = makeDefaultLayout();
  layoutStore.setState((state) => ({
    ...state,
    layout: {
      ...base,
      sidebar: { position: overrides.sidebarPosition ?? 'left', width: overrides.sidebarWidth ?? 240 },
      ai: {
        position: overrides.aiPosition ?? 'right',
        expanded: true,
        width: overrides.aiWidth ?? AI_WIDTH_DEFAULT,
      },
    },
  }));
  layoutActions.setTabsVisible(base.tabsVisible); // 让 commit 跑一次（变量注入与改前一致）
}

/**
 * 指针事件派发：jsdom **未实现 PointerEvent**（构造器退化为 Event，`clientX/button/pointerId`
 * 全被丢弃）→ 用 MouseEvent 造同类型名的原生事件（React 按事件名挂监听，能收到合成事件），
 * 再补上 pointerId。这样 pointerdown/move/up 的完整链路可在 jsdom 下走通。
 */
function firePointer(
  el: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; button?: number },
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  fireEvent(el, event);
}

/** 完整拖拽：down → move → up（pointerup 必 flush 最后一帧，不需要等 rAF）。 */
function drag(el: HTMLElement, fromX: number, toX: number, pointerId = 1): void {
  firePointer(el, 'pointerdown', { pointerId, clientX: fromX });
  firePointer(el, 'pointermove', { pointerId, clientX: toX });
  firePointer(el, 'pointerup', { pointerId, clientX: toX });
}

beforeEach(() => {
  setViewport(1024);
  window.localStorage.clear();
  layoutActions.init();
  document.documentElement.style.removeProperty('--sc-layout-sidebar');
  document.documentElement.style.removeProperty('--sc-layout-ai-width');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 拖拽改宽 + 落盘
// ---------------------------------------------------------------------------

describe('T61-01 §2.2 拖拽改宽（pointer capture 链路）', () => {
  it('拖左缘（侧栏）：宽随 Δx，松手后 store / 根变量 / 持久化三处同值且 preset=custom', () => {
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');

    drag(handle, 300, 356);

    expect(layoutStore.getState().layout.sidebar.width).toBe(296);
    expect(rootVar('--sc-layout-sidebar')).toBe('296px');
    expect(persisted().sidebar.width).toBe(296);
    expect(layoutStore.getState().layout.preset).toBe('custom');
    expect(handle.getAttribute('data-width')).toBe('296');
    expect(handle.getAttribute('aria-valuenow')).toBe('296');
  });

  it('拖右缘（AI 面板左缘）：向左拖 = 加宽（方向与侧栏相反）', async () => {
    setViewport(1400);
    seed({ aiWidth: 320 });
    render(<ResizeHandle side="ai" />);
    const handle = screen.getByTestId('resize-ai');

    drag(handle, 900, 858);

    expect(layoutStore.getState().layout.ai.width).toBe(362);
    expect(rootVar('--sc-layout-ai-width')).toBe('362px');
    expect(persisted().ai.width).toBe(362);
    // 方向核对：向右拖 = 变窄
    drag(handle, 858, 900);
    expect(layoutStore.getState().layout.ai.width).toBe(320);
  });

  it('拖拽中实时随动：pointermove 后（等一帧）宽度即变，不等 pointerup', async () => {
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');

    firePointer(handle, 'pointerdown', { pointerId: 7, clientX: 400 });
    firePointer(handle, 'pointermove', { pointerId: 7, clientX: 440 });
    await act(async () => {
      await wait(40);
    });
    expect(layoutStore.getState().layout.sidebar.width).toBe(280);

    firePointer(handle, 'pointerup', { pointerId: 7, clientX: 440 });
    expect(persisted().sidebar.width).toBe(280);
  });

  it('rAF 节流：同一帧三次 pointermove 只落一次写（最终值 = 最后一值）', async () => {
    setViewport(1400);
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');
    let notifications = 0;
    const off = layoutStore.subscribe(() => {
      notifications += 1;
    });

    firePointer(handle, 'pointerdown', { pointerId: 3, clientX: 200 });
    firePointer(handle, 'pointermove', { pointerId: 3, clientX: 250 });
    firePointer(handle, 'pointermove', { pointerId: 3, clientX: 300 });
    firePointer(handle, 'pointermove', { pointerId: 3, clientX: 330 });
    await act(async () => {
      await wait(40);
    });
    off();

    expect(layoutStore.getState().layout.sidebar.width).toBe(370);
    expect(notifications).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 上限钳制（视口 1000 → 300）
// ---------------------------------------------------------------------------

describe('T61-01 §2.2 上限 = min(480, 视口 30%) 钳制', () => {
  it('视口 1000：侧栏拖到极限 → 300（30% 实测口径）', () => {
    setViewport(1000);
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');

    drag(handle, 200, 900);

    expect(layoutStore.getState().layout.sidebar.width).toBe(300);
    expect(persisted().sidebar.width).toBe(300);
  });

  it('视口 1000：AI 面板拖到极限 → 300；视口 1600 → 480（绝对封顶）', () => {
    setViewport(1000);
    seed({ aiWidth: 240 });
    const first = render(<ResizeHandle side="ai" />);
    drag(screen.getByTestId('resize-ai'), 900, 200);
    expect(layoutStore.getState().layout.ai.width).toBe(300);
    first.unmount();

    setViewport(1600);
    seed({ aiWidth: 240 });
    render(<ResizeHandle side="ai" />);
    drag(screen.getByTestId('resize-ai'), 900, -900);
    expect(layoutStore.getState().layout.ai.width).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// 双击 / 键盘
// ---------------------------------------------------------------------------

describe('T61-01 §2.2 双击回默认 + 键盘步进', () => {
  it('双击侧栏把手 → notion 默认 240；双击 AI 把手 → 320', () => {
    setViewport(1400);
    seed({ sidebarWidth: 300, aiWidth: 260 });
    const side = render(<ResizeHandle side="sidebar" />);
    fireEvent.doubleClick(screen.getByTestId('resize-sidebar'));
    expect(layoutStore.getState().layout.sidebar.width).toBe(LAYOUT_PRESETS.notion.sidebar.width);
    expect(layoutStore.getState().layout.sidebar.width).toBe(240);
    side.unmount();

    render(<ResizeHandle side="ai" />);
    fireEvent.doubleClick(screen.getByTestId('resize-ai'));
    expect(layoutStore.getState().layout.ai.width).toBe(AI_WIDTH_DEFAULT);
    expect(persisted().ai.width).toBe(AI_WIDTH_DEFAULT);
  });

  it('侧栏把手：→ +16px、← −16px、Home 回默认', () => {
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(layoutStore.getState().layout.sidebar.width).toBe(256);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(layoutStore.getState().layout.sidebar.width).toBe(224);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(layoutStore.getState().layout.sidebar.width).toBe(240);
  });

  it('AI 把手：← 加宽 16px、→ 变窄 16px（方向与侧栏相反）；键位步进同样受 30% 钳制', () => {
    setViewport(1000);
    seed({ aiWidth: 280 });
    render(<ResizeHandle side="ai" />);
    const handle = screen.getByTestId('resize-ai');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(layoutStore.getState().layout.ai.width).toBe(296);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(layoutStore.getState().layout.ai.width).toBe(300); // 视口 1000 上限 300
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(layoutStore.getState().layout.ai.width).toBe(284);
  });

  it('aria 口径：role=separator + aria-orientation + valuenow/min/max + 可聚焦', () => {
    setViewport(1000);
    seed({ sidebarWidth: 240 });
    render(<ResizeHandle side="sidebar" />);
    const handle = screen.getByTestId('resize-sidebar');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-label')).toBe('调整侧栏宽度');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('300');
    expect(handle.getAttribute('tabindex')).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// 无意义态不挂把手
// ---------------------------------------------------------------------------

describe('T61-01 §2.2 把手挂载条件', () => {
  it('AI position=bottom / hidden → 右把手不挂（宽度对纵向布局无意义）', () => {
    seed({ aiPosition: 'bottom' });
    const bottom = render(<ResizeHandle side="ai" />);
    expect(screen.queryByTestId('resize-ai')).toBeNull();
    bottom.unmount();

    seed({ aiPosition: 'hidden' });
    render(<ResizeHandle side="ai" />);
    expect(screen.queryByTestId('resize-ai')).toBeNull();
  });

  it('侧栏 collapsed → 左把手不挂；展开态恢复渲染', () => {
    seed({ sidebarPosition: 'collapsed' });
    const view = render(<ResizeHandle side="sidebar" />);
    expect(screen.queryByTestId('resize-sidebar')).toBeNull();

    act(() => {
      layoutActions.setSidebarPosition('left');
    });
    expect(screen.getByTestId('resize-sidebar')).not.toBeNull();
    view.unmount();
  });
});
