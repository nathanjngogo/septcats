// @vitest-environment jsdom
/**
 * tour-overlay.test.tsx —— 首次启动导览·浮层组件单测（0.6.10 创意清单② step E）。
 *
 * 覆盖（全部落在「用户可见效果」而非调用计数）：
 * - 首启：init 无戳 → 浮层出第 1 步 + 进度 1/5 + **启动路径零落戳**；
 * - 静默：有戳 → init 后组件返回 null（零 DOM）；
 * - 末步：主钮文案换「开始使用」，点击 → 落戳 '1' + 闭卷（DOM 消失，无第 6 页）；
 * - 首步「上一步」disabled；第 2 步 back 可用 → 回卷到第 1 步（原地不动不许负数下标）；
 * - Esc = 跳过（落戳 + 闭卷）；
 * - 遮罩 mousedown = 跳过；面板内 mousedown **不**关（事件目标判定）；
 * - 焦点：开时聚焦主钮，关时归还给开卷前的元素；
 * - Tab 焦点圈闭：末位 → 首位；Shift+Tab 首位 → 末位；
 * - i18n：五步 title/body 双语键集完整（缺键时 t() 回落键名，故断言不等于键名）+
 *   en-US 下进度行按 `tour.progress` 插值。
 * 纪律：本文件只测渲染层组件，零 window.septcats 桥依赖（TourOverlay 不碰 IPC）。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TourOverlay } from '../src/renderer/src/tour/TourOverlay';
import {
  TOUR_STORAGE_KEY,
  TOUR_STEPS,
  TOUR_TOTAL,
  tourActions,
  tourStore,
} from '../src/renderer/src/tour/tourState';
import { getLocale, setLocale, t } from '../src/renderer/src/i18n';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  tourStore.setState(() => ({ open: false, stepIndex: 0 }));
  setLocale('zh-CN');
});

afterEach(() => {
  cleanup();
  setLocale('zh-CN');
});

/** 渲染浮层本体（App 末尾常驻挂载的等价形态）。 */
function renderTour(): void {
  render(<TourOverlay />);
}

/** 开卷（模拟首启：无戳 → init 自动开）。 */
function openByInit(): void {
  act(() => {
    tourActions.init();
  });
}

function overlay(): HTMLElement {
  return screen.getByTestId('tour-overlay');
}

function primary(): HTMLButtonElement {
  return screen.getByTestId('tour-primary') as HTMLButtonElement;
}

function back(): HTMLButtonElement {
  return screen.getByTestId('tour-back') as HTMLButtonElement;
}

describe('TourOverlay · 生效路径', () => {
  it('首启（无戳）→ 浮层出第 1 步文案 + 进度 1/5，且启动路径零落戳', () => {
    openByInit();
    renderTour();
    expect(screen.getByTestId('tour')).toBeTruthy();
    expect(screen.getByTestId('tour-title').textContent).toBe(t('tour.welcome.title'));
    expect(screen.getByTestId('tour-body').textContent).toBe(t('tour.welcome.body'));
    expect(screen.getByTestId('tour-progress').textContent).toContain(`1 / ${TOUR_TOTAL}`);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('已看过（戳=1）→ init 静默闭卷，组件零 DOM', () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    openByInit();
    renderTour();
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
  });

  it('末步主钮换「开始使用」；点击 → 落戳一次 + 闭卷（DOM 消失，无空白第 6 页）', () => {
    openByInit();
    renderTour();
    act(() => {
      for (let i = 0; i < TOUR_TOTAL - 1; i += 1) {
        tourActions.next();
      }
    });
    expect(tourStore.getState().stepIndex).toBe(TOUR_TOTAL - 1);
    expect(primary().textContent).toBe(t('tour.finish'));
    fireEvent.click(primary());
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
    expect(tourStore.getState().open).toBe(false);
  });
});

describe('TourOverlay · 上一步/跳过', () => {
  it('第 1 步「上一步」disabled；第 2 步可点 → 回卷到第 1 步（不误关）', () => {
    openByInit();
    renderTour();
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getByTestId('tour-primary'));
    expect(tourStore.getState().stepIndex).toBe(1);
    expect(screen.getByTestId('tour-title').textContent).toBe(t('tour.nav.title'));
    expect(back().disabled).toBe(false);
    fireEvent.click(back());
    expect(tourStore.getState().stepIndex).toBe(0);
    expect(screen.getByTestId('tour-title').textContent).toBe(t('tour.welcome.title'));
    expect(overlay()).toBeTruthy();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull();
  });

  it('Esc = 跳过：与完成同口径落戳 + 闭卷', () => {
    openByInit();
    renderTour();
    fireEvent.keyDown(screen.getByTestId('tour'), { key: 'Escape' });
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });

  it('「跳过导览」钮落戳；面板内 mousedown 不关、遮罩 mousedown 才关', () => {
    openByInit();
    renderTour();
    // 面板内点击（mousedown 冒泡到遮罩，但 target≠currentTarget）→ 不关
    fireEvent.mouseDown(screen.getByTestId('tour'));
    expect(overlay()).toBeTruthy();
    // 直接打在遮罩上 → 跳过（落戳 + 闭卷）
    fireEvent.mouseDown(overlay());
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });

  it('重放（openTour）有戳也不落新戳：跳过前戳仍是原值', () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    act(() => {
      tourActions.openTour();
    });
    renderTour();
    expect(screen.getByTestId('tour-title').textContent).toBe(t('tour.welcome.title'));
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(screen.queryByTestId('tour-overlay')).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });
});

describe('TourOverlay · 焦点', () => {
  it('开时聚焦主钮；关时归还给开卷前的元素', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'trigger');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    openByInit();
    renderTour();
    expect(document.activeElement).toBe(primary());
    fireEvent.click(screen.getByTestId('tour-skip'));
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('Tab 焦点圈闭：末位 → 首位；Shift+Tab 首位 → 末位', () => {
    openByInit();
    renderTour();
    // 第 1 步：back disabled ⇒ 可聚焦序列 = [跳过, 主钮]
    const skip = screen.getByTestId('tour-skip') as HTMLButtonElement;
    const panel = screen.getByTestId('tour');
    primary().focus();
    expect(document.activeElement).toBe(primary());
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(document.activeElement).toBe(skip);
    fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(primary());
  });
});

describe('TourOverlay · i18n 文案', () => {
  it('五步 title/body 双语键集完整（缺键时 t() 回落键名，故断言不等于键名）', () => {
    const locale = getLocale();
    for (const id of TOUR_STEPS) {
      expect(t(`tour.${id}.title`).length).toBeGreaterThan(0);
      expect(t(`tour.${id}.title`)).not.toBe(`tour.${id}.title`);
      expect(t(`tour.${id}.body`).length).toBeGreaterThan(0);
      expect(t(`tour.${id}.body`)).not.toBe(`tour.${id}.body`);
    }
    expect(TOUR_STEPS).toHaveLength(TOUR_TOTAL);
    expect(locale).toBe('zh-CN');
  });

  it('en-US 下标题与进度行按英文键插值', () => {
    setLocale('en-US');
    openByInit();
    renderTour();
    expect(screen.getByTestId('tour-title').textContent).toBe('Welcome to Septcats');
    expect(screen.getByTestId('tour-progress').textContent).toBe(`Step 1 of ${TOUR_TOTAL}`);
    expect(primary().textContent).toBe('Next');
  });
});
