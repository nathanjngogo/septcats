// @vitest-environment jsdom
/**
 * tour-state.test.ts —— 首次启动导览·状态层单测（0.6.10 创意清单② step A）。
 *
 * 覆盖：init 纯读零写入（启动不写用户数据红线）/ 未看过自动开卷 / 已看过静默 /
 * next 逐步推进 + 末步等价 finish / back 首步原地 / finish 落戳一次 + 幂等 /
 * 重启还原（戳在 → init 后仍闭卷）/ openTour 重放不清戳 / 闭卷时 next·back no-op /
 * 野值兜底（只有 '1' 算已看过）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  isTourDone,
  readTourDone,
  TOUR_STORAGE_KEY,
  TOUR_STEPS,
  TOUR_TOTAL,
  tourActions,
  tourStore,
} from '../src/renderer/src/tour/tourState';

beforeEach(() => {
  window.localStorage.clear();
  tourStore.setState(() => ({ open: false, stepIndex: 0 }));
});

describe('tourState · init（纯读，零写入）', () => {
  it('未看过（无戳）→ 开卷第 0 步，且 init 不写 localStorage', () => {
    tourActions.init();
    const state = tourStore.getState();
    expect(state.open).toBe(true);
    expect(state.stepIndex).toBe(0);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull(); // 启动路径零写入
  });

  it('已看过（戳=1）→ 静默闭卷，同样零写入', () => {
    window.localStorage.setItem(TOUR_STORAGE_KEY, '1');
    tourActions.init();
    expect(tourStore.getState().open).toBe(false);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });

  it('野值兜底：只有字面 1 算已看过，0/空串/垃圾都当未看过', () => {
    expect(isTourDone('1')).toBe(true);
    expect(isTourDone('0')).toBe(false);
    expect(isTourDone('')).toBe(false);
    expect(isTourDone(null)).toBe(false);
    expect(isTourDone(undefined)).toBe(false);
    for (const junk of ['0', '', 'yes', 'true']) {
      window.localStorage.setItem(TOUR_STORAGE_KEY, junk);
      expect(readTourDone()).toBe(false);
      tourActions.init();
      expect(tourStore.getState().open).toBe(true);
      tourStore.setState(() => ({ open: false, stepIndex: 0 }));
    }
  });

  it('StrictMode 双挂载幂等：连调两次 init 结果一致', () => {
    tourActions.init();
    tourActions.init();
    expect(tourStore.getState()).toEqual({ open: true, stepIndex: 0 });
  });
});

describe('tourState · 步进', () => {
  beforeEach(() => {
    tourActions.init();
  });

  it('next 逐步推进至末步（步数钉 = TOUR_STEPS 长度）', () => {
    expect(TOUR_TOTAL).toBe(TOUR_STEPS.length);
    for (let i = 1; i < TOUR_TOTAL - 1; i += 1) {
      tourActions.next();
      expect(tourStore.getState().stepIndex).toBe(i);
      expect(tourStore.getState().open).toBe(true);
    }
    tourActions.next();
    expect(tourStore.getState().stepIndex).toBe(TOUR_TOTAL - 1);
    expect(tourStore.getState().open).toBe(true);
  });

  it('末步 next = finish：闭卷 + 落戳一次', () => {
    for (let i = 0; i < TOUR_TOTAL; i += 1) {
      tourActions.next();
    }
    expect(tourStore.getState().open).toBe(false);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });

  it('back 首步原地不动且不误关；中间步正确回卷', () => {
    tourActions.back();
    expect(tourStore.getState()).toEqual({ open: true, stepIndex: 0 });
    tourActions.next();
    tourActions.back();
    expect(tourStore.getState().stepIndex).toBe(0);
    tourActions.next();
    tourActions.next();
    tourActions.back();
    expect(tourStore.getState()).toEqual({ open: true, stepIndex: 1 });
  });

  it('闭卷后 next/back 均为 no-op（不复活、不下标越界）', () => {
    tourActions.finish();
    tourActions.next();
    tourActions.back();
    expect(tourStore.getState().open).toBe(false);
    expect(tourStore.getState().stepIndex).toBe(0);
  });
});

describe('tourState · finish / 重启还原 / 重放', () => {
  it('finish 幂等：重复调不 throw、戳保持 1、闭卷', () => {
    tourActions.init();
    tourActions.finish();
    tourActions.finish();
    expect(tourStore.getState().open).toBe(false);
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
  });

  it('重启还原：finish 后不清 storage 再 init → 仍闭卷（戳生效路径）', () => {
    tourActions.init();
    tourActions.next();
    tourActions.finish();
    // 模拟进程重启：store 复位（模块在 Electron 重启中本就会重加载），storage 保留
    tourStore.setState(() => ({ open: false, stepIndex: 0 }));
    tourActions.init();
    expect(tourStore.getState()).toEqual({ open: false, stepIndex: 0 });
  });

  it('openTour 重放：开卷回第 0 步，且**不清**已完成的戳（下次启动仍静默）', () => {
    tourActions.finish();
    tourActions.openTour();
    expect(tourStore.getState()).toEqual({ open: true, stepIndex: 0 });
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe('1');
    tourActions.init(); // 重放中途再 init 也不改变「已看过」事实 → 闭卷
    expect(tourStore.getState().open).toBe(false);
  });
});
