// @vitest-environment jsdom
/**
 * t66-workbench-state.test.ts —— TASK-T66-01 §2.2：工作台视图态与卡配置的纯函数/
 * 持久化单测（state.ts）。
 *
 * 覆盖：
 * - 视图 reducer：open/close/toggle 的幂等与引用稳定（无变化返回同引用）；
 * - 卡配置持久化：写→读往返；野 JSON（非对象/数组/版本不符/未知 id/重复 id/
 *   hidden 引用不存在的 id）→ sanitize 回退或修补；缺失卡补尾（前向兼容）；
 * - localStorage 不可写（setItem 抛错）时静默降级不炸；
 * - moveCardInOrder：可见卡间换位（隐藏卡原位不动）、越界返回 null；
 * - toggleCardHidden：显隐翻转幂等防御。
 * 纪律：jsdom 原生 localStorage；每用例前清空 + store 复位。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CARD_ORDER,
  WORKBENCH_CARDS_STORAGE_KEY,
  WORKBENCH_OPEN_STORAGE_KEY,
  moveCardInOrder,
  readCardsPersist,
  readWorkbenchOpenFlag,
  sanitizeCardsPersist,
  toggleCardHidden,
  workbenchActions,
  workbenchStore,
  closeHome,
  openHome,
  toggleWorkbenchView,
} from '../src/renderer/src/workbench/state';
import type { WorkbenchCardId } from '../src/renderer/src/workbench/state';

beforeEach(() => {
  window.localStorage.clear();
  workbenchStore.setState((state) => ({
    ...state,
    view: 'pages',
    cardOrder: [...DEFAULT_CARD_ORDER],
    hiddenCards: [],
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T66-01 视图 reducer', () => {
  it('openHome/closeHome 幂等：重复调用返回同引用（store 无谓重渲染防御）', () => {
    const pages = workbenchStore.getState();
    const opened = openHome(pages);
    expect(opened.view).toBe('home');
    expect(openHome(opened)).toBe(opened);
    const closed = closeHome(opened);
    expect(closed.view).toBe('pages');
    expect(closeHome(closed)).toBe(closed);
  });

  it('toggle 双向翻转', () => {
    const start = workbenchStore.getState();
    const one = toggleWorkbenchView(start);
    expect(one.view).toBe('home');
    expect(toggleWorkbenchView(one).view).toBe('pages');
  });

  it('actions.openHome 写持久化标记；closeHome 清回 0', () => {
    workbenchActions.openHome();
    expect(window.localStorage.getItem(WORKBENCH_OPEN_STORAGE_KEY)).toBe('1');
    workbenchActions.closeHome();
    expect(window.localStorage.getItem(WORKBENCH_OPEN_STORAGE_KEY)).toBe('0');
    expect(readWorkbenchOpenFlag()).toBe(false);
  });

  it('init 读到上次退出在 home → 落 pages 并回报 restoredFromHome=true（防呆），标记清零', () => {
    window.localStorage.setItem(WORKBENCH_OPEN_STORAGE_KEY, '1');
    const result = workbenchActions.init();
    expect(result.restoredFromHome).toBe(true);
    expect(workbenchStore.getState().view).toBe('pages');
    expect(readWorkbenchOpenFlag()).toBe(false);
  });
});

describe('T66-01 卡配置持久化（野 JSON→默认/修补）', () => {
  it('无记录 → readCardsPersist null；写→读往返等价', () => {
    expect(readCardsPersist()).toBeNull();
    workbenchActions.moveCard('recent', -1);
    const persist = readCardsPersist();
    expect(persist).not.toBeNull();
    expect(persist?.order).toEqual(workbenchStore.getState().cardOrder);
    expect(persist?.hidden).toEqual(workbenchStore.getState().hiddenCards);
  });

  it('野 JSON 一律 sanitize null（非对象/数组/版本不符/缺字段）；v2 现合法→不归 null', () => {
    for (const raw of ['{"v":3,"order":[],"hidden":[]}', '[]', '"x"', '{"order":[],"hidden":[]}', 'not-json']) {
      window.localStorage.setItem(WORKBENCH_CARDS_STORAGE_KEY, raw);
      expect(readCardsPersist(), raw).toBeNull();
    }
    // v2（T71）为合法版本 → 不归 null（空序会补全部默认卡）
    window.localStorage.setItem(WORKBENCH_CARDS_STORAGE_KEY, '{"v":2,"order":[],"hidden":[]}');
    const v2 = readCardsPersist();
    expect(v2).not.toBeNull();
    expect(v2?.v).toBe(2);
    expect(v2?.order).toEqual([...DEFAULT_CARD_ORDER]);
  });

  it('未知 id 丢弃 + 去重 + 缺失卡补尾（含 6 新卡默认位）+ hidden 只留存在的 id', () => {
    const sanitized = sanitizeCardsPersist({
      v: 1,
      order: ['recent', 'recent', 'ghost', 'quick', 'todo'],
      hidden: ['database', 'ghost', 'todo', 'todo'],
    });
    expect(sanitized).not.toBeNull();
    // 5 内置去 ghost/去重后，按默认序补尾（database/favorites + 6 新卡）
    expect(sanitized?.order).toEqual([
      'recent',
      'quick',
      'todo',
      'database',
      'favorites',
      'shortcut',
      'countdown',
      'heatmap',
      'quote',
      'bookmarks',
      'libstats',
    ]);
    expect(sanitized?.hidden).toEqual(['database', 'todo']);
  });

  it('localStorage 写失败（配额/隐私模式）静默降级：状态照常变，不抛错', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    workbenchActions.openHome();
    expect(workbenchStore.getState().view).toBe('home');
    workbenchActions.setCardHidden('recent', true);
    expect(workbenchStore.getState().hiddenCards).toEqual(['recent']);
    spy.mockRestore();
  });
});

describe('T66-01 卡序/显隐纯函数', () => {
  it('moveCardInOrder：只在可见卡间换位，隐藏卡槽位不动', () => {
    const order = ['quick', 'todo', 'database', 'recent', 'favorites'] as const;
    const hidden = ['todo'] as const;
    const next = moveCardInOrder([...order], [...hidden], 'recent', -1);
    // 可见序 quick,database,recent,favorites → recent 上移一位 → quick,recent,database,favorites
    // （回填进可见槽位，隐藏的 todo 原槽 index1 不动）
    expect(next).toEqual(['quick', 'todo', 'recent', 'database', 'favorites']);
  });

  it('moveCardInOrder 越界（首位上移/末位下移/隐藏卡）返回 null', () => {
    const order = [...DEFAULT_CARD_ORDER];
    expect(moveCardInOrder(order, [], 'quick', -1)).toBeNull();
    // T71：默认序含 6 新卡，末位现为 libstats
    expect(moveCardInOrder(order, [], 'libstats', 1)).toBeNull();
    expect(moveCardInOrder(order, ['recent'], 'recent', -1)).toBeNull();
  });

  it('toggleCardHidden 翻转；显示未入序的卡返回 null（野配置防御）', () => {
    const order = [...DEFAULT_CARD_ORDER];
    const hide = toggleCardHidden(order, [], 'recent');
    expect(hide?.hidden).toEqual(['recent']);
    const show = toggleCardHidden(order, ['recent'], 'recent');
    expect(show?.hidden).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    expect(toggleCardHidden(['quick'], [], 'ghost' as unknown as WorkbenchCardId)).toBeNull();
  });

  it('resetCards 回默认序/默认显', () => {
    workbenchActions.setCardHidden('recent', true);
    workbenchActions.moveCard('favorites', -1);
    workbenchActions.resetCards();
    const state = workbenchStore.getState();
    expect(state.cardOrder).toEqual([...DEFAULT_CARD_ORDER]);
    expect(state.hiddenCards).toEqual([]);
    expect(readCardsPersist()?.order).toEqual([...DEFAULT_CARD_ORDER]);
  });
});
