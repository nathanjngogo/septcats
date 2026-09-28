// @vitest-environment jsdom
/**
 * title-bar-band.test.tsx —— T89-01 自绘标题带（老板圈图 image_83fc8f.png：
 * 「这上面为什么没有跟着主题走？」，OS 原生标题栏只认明暗一轴 → Win 撤原生带、
 * renderer 顶上 + 实测 token 推 OS 按钮区）。
 *
 * 钉的是「主题→OS 桥」契约（观感联动由 cdp-e2e-t89-01.mjs 真机钉）：
 *  T1 Win UA 下带在位（品牌/名/拖拽区/overlay 预留区四段齐全）；
 *  T2 挂载即把实测 canvas/ink 推 main（theme.pushChrome），OS 按钮区吃到配色；
 *  T3 data-theme / data-palette / data-look 任一属性变化 → 重推（MutationObserver）；
 *  T4 非 Win UA（mac）→ 整条不渲染（原生标题栏保留）；
 *  T5 getState/onState 驱动 data-maximized 标记（探针可断言图标态）。
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TitleBarBand } from '../src/renderer/src/menu/TitleBarBand';

const bridge = {
  getState: vi.fn(async () => ({ maximized: false })),
  onState: vi.fn(() => () => {}),
};
const themeBridge = { pushChrome: vi.fn(async () => true), onOsglass: vi.fn(() => () => {}) };

function mountBand(): void {
  Object.defineProperty(window, 'septcats', {
    configurable: true,
    value: { window: bridge, theme: themeBridge } as unknown as Window['septcats'],
  });
  render(<TitleBarBand />);
}

function setWinUa(): void {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setWinUa();
  const root = document.documentElement;
  root.removeAttribute('data-theme');
  root.removeAttribute('data-palette');
  root.removeAttribute('data-look');
});

afterEach(() => {
  cleanup();
});

describe('T89-01 TitleBarBand', () => {
  it('T1 Win UA：带在位，四段齐全（品牌/名/拖拽区/overlay 预留区）', () => {
    mountBand();
    const band = screen.getByTestId('title-bar-band');
    expect(band.querySelector('.titleb_brand')).not.toBeNull();
    expect((band.querySelector('.titleb_name')?.textContent ?? '').includes('Septcats')).toBe(true);
    expect(band.querySelector('.titleb_drag')).not.toBeNull();
    expect(band.querySelector('.titleb_overlayzone')).not.toBeNull();
  });

  it('T2 挂载即推实测主题色给 main（theme.pushChrome 至少一次）', async () => {
    mountBand();
    await waitFor(() => {
      expect(themeBridge.pushChrome).toHaveBeenCalled();
    });
    const call = themeBridge.pushChrome.mock.calls.at(-1);
    expect(call).toBeDefined();
    const arg = (call as unknown as [{ canvas: string; ink: string; look: string }])[0];
    // 入参契约：三字段都是字符串（jsdom 无 computed token = 空串；真机非空由探针钉）
    expect(typeof arg.canvas).toBe('string');
    expect(typeof arg.ink).toBe('string');
    expect(typeof arg.look).toBe('string');
  });

  it('T3 三轴属性变化 → 重推 OS（MutationObserver 统一捕获）', async () => {
    mountBand();
    await waitFor(() => expect(themeBridge.pushChrome).toHaveBeenCalledTimes(1));
    const root = document.documentElement;
    for (const [attr, val] of [
      ['data-theme', 'dark'],
      ['data-palette', 'paper'],
      ['data-look', 'glass'],
    ] as const) {
      act(() => {
        root.setAttribute(attr, val);
      });
      // rAF 一帧后推；jsdom 的 rAF 微任务化，用 waitFor 兜等待
      const expected = themeBridge.pushChrome.mock.calls.length + 1;
      await waitFor(() => expect(themeBridge.pushChrome.mock.calls.length).toBeGreaterThanOrEqual(expected));
    }
    expect(themeBridge.pushChrome.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('T4 非 Win UA（mac）：整条不渲染', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      configurable: true,
    });
    mountBand();
    expect(screen.queryByTestId('title-bar-band')).toBeNull();
    // 且不该有副作用：不订阅、不推 OS
    expect(bridge.getState).not.toHaveBeenCalled();
    expect(themeBridge.pushChrome).not.toHaveBeenCalled();
  });

  it('T5 getState 初值 + onState 广播 → data-maximized 标记', async () => {
    bridge.getState.mockResolvedValueOnce({ maximized: true });
    let push: ((s: { maximized: boolean }) => void) | null = null;
    (bridge.onState as unknown as { mockImplementationOnce: (fn: unknown) => void })
      .mockImplementationOnce((cb: (s: { maximized: boolean }) => void) => {
        push = cb;
        return () => {};
      });
    mountBand();
    await waitFor(() => {
      expect(screen.getByTestId('title-bar-band').getAttribute('data-maximized')).toBe('true');
    });
    act(() => {
      push?.({ maximized: false });
    });
    expect(screen.getByTestId('title-bar-band').getAttribute('data-maximized')).toBe('false');
  });

  it('T6（T90-01）main 材质判定广播 → data-osglass 开关（CSS 透明链唯一门）', async () => {
    let glassCb: ((v: boolean) => void) | null = null;
    (themeBridge.onOsglass as unknown as { mockImplementationOnce: (fn: unknown) => void })
      .mockImplementationOnce((cb: (v: boolean) => void) => {
        glassCb = cb;
        return () => {};
      });
    mountBand();
    // 未收到材质判定 → 属性缺席（实心保命态，F 组合黑窗教训）
    expect(document.documentElement.dataset.osglass).toBeUndefined();
    act(() => {
      glassCb?.(true);
    });
    expect(document.documentElement.dataset.osglass).toBe('1');
    act(() => {
      glassCb?.(false);
    });
    expect(document.documentElement.dataset.osglass).toBeUndefined();
  });
});
