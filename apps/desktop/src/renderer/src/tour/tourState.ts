/*
 * tourState.ts —— 首次启动导览·状态层（0.6.10 创意清单第②项，老板 10-01 授权自主做到底）。
 *
 * 存储口径：旁路 localStorage `septcats.tour.done`（同 lookState/paletteState 范式，
 * 不扩 LayoutState / settings 类型；**启动路径零写入**——init 纯读，只有用户
 * 显式完成/跳过导览才落一次 '1'，守住「升级后启动不许自动写用户数据」红线）。
 *
 * 生效路径：App 挂载 → tourActions.init() → 未见戳 → store.open=true（step 0）；
 * 导览浮层组件（下一批）消费 useTourState 渲染步骤文案；文案一律走 i18n
 * `tour.*` 键（本文件零 CJK 字面量，守 i18n 门禁⑤）。
 *
 * 重放：openTour() 供设置页「重新观看导览」接线——重放**不清**已完成的戳，
 * 下次启动不再自动弹（用户选择优先）。
 */
import { createStore, useStore, type Store } from '../state/store';

/** 导览步骤 id（顺序即展示顺序；文案键 = `tour.<id>.title` / `tour.<id>.body`）。 */
export const TOUR_STEPS = ['welcome', 'nav', 'palette', 'sync', 'ai'] as const;
export type TourStepId = (typeof TOUR_STEPS)[number];
export const TOUR_TOTAL = TOUR_STEPS.length;

/** localStorage 键：值恒为 '1'（完成/跳过同口径：用户已经看过或明确不看了）。 */
export const TOUR_STORAGE_KEY = 'septcats.tour.done';

/** 野值兜底：只有字面 '1' 算已看过；缺失/空串/'0'/任意值 → 未看过（照 lookState 口径）。 */
export function isTourDone(value: unknown): boolean {
  return value === '1';
}

function safeGetItem(key: string): string | null {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    if (storage === undefined) {
      return null;
    }
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    storage?.setItem(key, value);
  } catch {
    // 写失败（配额/隐私模式）：仅本会话生效，不阻断 UI
  }
}

export function readTourDone(): boolean {
  return isTourDone(safeGetItem(TOUR_STORAGE_KEY));
}

export interface TourStoreState {
  open: boolean;
  /** 当前步骤下标（闭卷不回卷——探针与重放靠它对账）。 */
  stepIndex: number;
}

export const tourStore: Store<TourStoreState> = createStore<TourStoreState>({
  open: false,
  stepIndex: 0,
});

export const tourActions = {
  /**
   * App 挂载时调一次：纯读（零写入）。
   * 已看过 → 保持关闭；未看过 → 从第 0 步打开。StrictMode 双挂载幂等。
   */
  init(): void {
    if (readTourDone()) {
      tourStore.setState(() => ({ open: false, stepIndex: 0 }));
      return;
    }
    tourStore.setState(() => ({ open: true, stepIndex: 0 }));
  },

  /** 下一步：最后一步时等价 finish（不再有「第 6 步空白页」）。闭卷时不响应。 */
  next(): void {
    const { open, stepIndex } = tourStore.getState();
    if (!open) {
      return;
    }
    if (stepIndex >= TOUR_TOTAL - 1) {
      tourActions.finish();
      return;
    }
    tourStore.setState((s) => ({ ...s, stepIndex: s.stepIndex + 1 }));
  },

  /** 上一步：第 0 步原地不动（不许负数下标，也不许误关成「跳过」）。闭卷时不响应。 */
  back(): void {
    const { open, stepIndex } = tourStore.getState();
    if (!open) {
      return;
    }
    if (stepIndex <= 0) {
      return;
    }
    tourStore.setState((s) => ({ ...s, stepIndex: s.stepIndex - 1 }));
  },

  /** 完成/跳过（同口径）：落 '1' 一次 + 闭卷；幂等，重复调不 throw。 */
  finish(): void {
    safeSetItem(TOUR_STORAGE_KEY, '1');
    tourStore.setState((s) => ({ ...s, open: false }));
  },

  /**
   * 手动重放（设置页「重新观看导览」接线位）：
   * 不改写/不清除已完成的戳——重放只影响本次会话的展示，下次启动仍静默。
   */
  openTour(): void {
    tourStore.setState(() => ({ open: true, stepIndex: 0 }));
  },
};

export function useTourState<T>(selector: (state: TourStoreState) => T): T {
  return useStore(tourStore, selector);
}

/** 展开切片（引用稳定的原始值，组件侧安全）。 */
export function useTour(): { open: boolean; stepIndex: number; stepId: TourStepId | null } {
  const open = useTourState((s) => s.open);
  const stepIndex = useTourState((s) => s.stepIndex);
  return {
    open,
    stepIndex,
    stepId: open ? TOUR_STEPS[stepIndex] ?? null : null,
  };
}

/** react-hooks 口径的订阅入口（非组件环境/探针可用）。 */
export function subscribeTour(listener: () => void): () => void {
  return tourStore.subscribe(listener);
}
