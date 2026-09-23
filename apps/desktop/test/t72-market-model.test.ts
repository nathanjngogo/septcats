// @vitest-environment jsdom
/**
 * t72-market-model.test.ts —— TASK-T72-01 市场纯模型单测（workbench/market.ts）。
 *
 * 覆盖（§硬要求「新增单测 ≥12」）：
 * - 导入契约校验：合法 JSON / 坏 JSON / 缺 title / 缺 layout / layout 形状不合法；
 * - order/hidden 与 ALL_CARD_IDS 取交集（未知丢弃 + 缺失补尾）；
 * - seedPages 归一（非对象条目 → body=''）；
 * - 内置 4 份 JSON 真实语料形状校验（落库的硬保证）；
 * - applyTemplateToWorkbench 落盘（order + hidden 经 setCardOrder/setCardHidden 同源写回）；
 * - toggleWorkbenchCard 与 workbenchActions.setCardHidden 同一真相源（spy 钉死）；
 * - 备份 / 还原往返（一键备份 + 还原备份）。
 * 纪律：jsdom 原生 localStorage；每用例前清 localStorage + store 复位。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_CARD_IDS,
  DEFAULT_CARD_ORDER,
  workbenchActions,
  workbenchStore,
  type WorkbenchCardId,
} from '../src/renderer/src/workbench/state';
import {
  applyTemplateToWorkbench,
  backupCurrentLayout,
  normalizeLayout,
  parseWorkbenchTemplateText,
  readLayoutBackup,
  restoreLayoutBackup,
  toggleWorkbenchCard,
  writeLayoutBackup,
} from '../src/renderer/src/workbench/market';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(here, '..', 'resources', 'workbench-templates');

const ALL_IDS = [...ALL_CARD_IDS] as string[];

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

describe('T72-01 导入契约校验（parseWorkbenchTemplateText）', () => {
  it('合法 JSON（全 11 卡序 + 隐藏子集）→ ok:true 且布局归一', () => {
    const content = JSON.stringify({
      id: 'x',
      title: '示例',
      desc: 'd',
      layout: { v: 2, order: ALL_IDS, hidden: ['database', 'libstats'] },
      seedPages: [{ title: 'p', body: 'b' }],
    });
    const result = parseWorkbenchTemplateText(content, 'fallback');
    expect(result.ok).toBe(true);
    expect(result.template?.id).toBe('x');
    expect(result.template?.layout.order).toEqual(ALL_IDS);
    expect(result.template?.layout.hidden).toEqual(['database', 'libstats']);
    expect(result.template?.seedPages).toEqual([{ title: 'p', body: 'b' }]);
  });

  it('坏 JSON → ok:false（不抛错）', () => {
    const result = parseWorkbenchTemplateText('{not json', 'fallback');
    expect(result.ok).toBe(false);
  });

  it('缺 title → ok:false', () => {
    const content = JSON.stringify({ layout: { v: 2, order: ALL_IDS, hidden: [] } });
    expect(parseWorkbenchTemplateText(content, 'f').ok).toBe(false);
  });

  it('缺 layout → ok:false', () => {
    const content = JSON.stringify({ title: 't' });
    expect(parseWorkbenchTemplateText(content, 'f').ok).toBe(false);
  });

  it('layout 形状不合法（v≠2 / order 非数组 / hidden 非数组）→ ok:false', () => {
    expect(parseWorkbenchTemplateText(JSON.stringify({ title: 't', layout: { v: 1, order: ALL_IDS, hidden: [] } }), 'f').ok).toBe(false);
    expect(parseWorkbenchTemplateText(JSON.stringify({ title: 't', layout: { v: 2, order: 'x', hidden: [] } }), 'f').ok).toBe(false);
    expect(parseWorkbenchTemplateText(JSON.stringify({ title: 't', layout: { v: 2, order: ALL_IDS, hidden: 'x' } }), 'f').ok).toBe(false);
  });

  it('顶层非对象（数组/字符串）→ ok:false', () => {
    expect(parseWorkbenchTemplateText('[]', 'f').ok).toBe(false);
    expect(parseWorkbenchTemplateText('"x"', 'f').ok).toBe(false);
  });

  it('seedPages 中非对象条目降级为 body=\'\'（不阻断校验）', () => {
    const content = JSON.stringify({
      title: 't',
      layout: { v: 2, order: ALL_IDS, hidden: [] },
      seedPages: [{ title: 'a', body: 'b' }, 'junk', 42, { body: 'only-body' }],
    });
    const result = parseWorkbenchTemplateText(content, 'f');
    expect(result.ok).toBe(true);
    expect(result.template?.seedPages).toEqual([
      { title: 'a', body: 'b' },
      { title: '', body: '' },
      { title: '', body: '' },
      { title: '', body: 'only-body' },
    ]);
  });
});

describe('T72-01 order/hidden 与注册表取交集（normalizeLayout）', () => {
  it('未知 id 丢弃 + 缺失补尾（与 sanitizeCardsPersist 口径一致）', () => {
    const { order, hidden } = normalizeLayout({
      v: 2,
      order: ['ghost', 'todo', 'quick', 'recent'],
      hidden: ['ghost', 'todo', 'ghost'],
    });
    // 未知 ghost 丢弃；已知 id 保序（todo,quick,recent）；缺失卡按默认序补尾；hidden 只留 todo
    expect(order).toEqual(['todo', 'quick', 'recent', 'database', 'favorites', 'shortcut', 'countdown', 'heatmap', 'quote', 'bookmarks', 'libstats']);
    expect(hidden).toEqual(['todo']);
  });
});

describe('T72-01 内置 JSON 真实语料形状（落库硬保证）', () => {
  const FILES = ['work-journal.json', 'project-board.json', 'reading-tracker.json', 'weekly-review.json'];

  it('至少 4 份内置模板且每份通过契约校验', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(4);
    for (const file of FILES) {
      const content = readFileSync(join(TEMPLATE_DIR, file), 'utf8');
      const result = parseWorkbenchTemplateText(content, file.replace(/\.json$/, ''));
      expect(result.ok, file).toBe(true);
      // 每份模板必须覆盖全部 11 张注册表卡（序含全部 id）
      expect(result.template?.layout.order.length, file).toBe(ALL_IDS.length);
      for (const id of ALL_IDS) {
        expect(result.template?.layout.order, file).toContain(id);
      }
      // 隐藏集必须是注册表子集
      for (const id of result.template?.layout.hidden ?? []) {
        expect(ALL_IDS, file).toContain(id);
      }
    }
  });
});

describe('T72-01 applyTemplateToWorkbench 同源落盘', () => {
  it('写回 order 与 hidden（经 setCardOrder/setCardHidden，与自定义模式共用真相源）', () => {
    const result = parseWorkbenchTemplateText(
      JSON.stringify({ title: 't', layout: { v: 2, order: ALL_IDS, hidden: ['database', 'libstats'] } }),
      'f',
    );
    expect(result.ok).toBe(true);
    const applied = applyTemplateToWorkbench(result.template!);
    expect(applied.order).toEqual(ALL_IDS);
    expect(applied.hidden).toEqual(['database', 'libstats']);
    const state = workbenchStore.getState();
    expect(state.cardOrder).toEqual(ALL_IDS);
    expect(state.hiddenCards).toEqual(['database', 'libstats']);
  });

  it('未知 id 在应用时被丢弃（不会污染工作台配置）', () => {
    const result = parseWorkbenchTemplateText(
      JSON.stringify({ title: 't', layout: { v: 2, order: ['ghost', 'quick', 'todo'], hidden: ['ghost'] } }),
      'f',
    );
    expect(result.ok).toBe(true);
    applyTemplateToWorkbench(result.template!);
    const state = workbenchStore.getState();
    expect(state.cardOrder).not.toContain('ghost' as WorkbenchCardId);
    expect(state.hiddenCards).not.toContain('ghost' as WorkbenchCardId);
  });
});

describe('T72-01 卡片开关同源（toggleWorkbenchCard === workbenchActions.setCardHidden）', () => {
  it('toggleWorkbenchCard 落点就是 setCardHidden（spy 钉死单一真相源）', () => {
    const spy = vi.spyOn(workbenchActions, 'setCardHidden');
    toggleWorkbenchCard('recent', true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('recent', true);
    expect(workbenchStore.getState().hiddenCards).toEqual(['recent']);
    spy.mockRestore();

    // 反向：恢复显示仍经同一入口
    const spy2 = vi.spyOn(workbenchActions, 'setCardHidden');
    toggleWorkbenchCard('recent', false);
    expect(spy2).toHaveBeenCalledWith('recent', false);
    expect(workbenchStore.getState().hiddenCards).toEqual([]);
  });
});

describe('T72-01 备份 / 还原往返', () => {
  it('backupCurrentLayout → writeLayoutBackup → readLayoutBackup → restoreLayoutBackup 还原隐藏态', () => {
    workbenchActions.setCardHidden('recent', true);
    workbenchActions.setCardHidden('quote', true);
    const backup = backupCurrentLayout();
    expect(backup).not.toBeNull();
    writeLayoutBackup(backup);
    expect(readLayoutBackup()).toBe(backup);

    // 改变当前状态后再还原
    workbenchActions.setCardHidden('recent', false);
    workbenchActions.setCardHidden('libstats', true);
    expect(workbenchStore.getState().hiddenCards).toEqual(['quote', 'libstats']);

    expect(restoreLayoutBackup(backup!)).toBe(true);
    // 还原以注册表序重排隐藏集（已隐藏项保留原位、新项追加）；断言集合等价
    expect(new Set(workbenchStore.getState().hiddenCards)).toEqual(new Set(['recent', 'quote']));
    expect(workbenchStore.getState().hiddenCards).not.toContain('libstats');
  });

  it('坏备份 JSON → restoreLayoutBackup 返回 false（不炸）', () => {
    expect(restoreLayoutBackup('{bad')).toBe(false);
  });

  it('readLayoutBackup 无记录 → null', () => {
    expect(readLayoutBackup()).toBeNull();
  });
});
