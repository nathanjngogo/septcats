/**
 * layout-state.test.ts —— T39-01 布局设计器纯逻辑（TASK-T39-01 §1 自动化面）。
 *
 * 覆盖：三预设定义值（任务书 §0.1 数值）、夹紧（宽度 100→200 / 999→320，measure
 * 100→560 / 9999→1000）、导入解析（合法往返 / 非法 JSON / 结构不符）、localStorage
 * 读写与损坏回退、根节点 CSS 变量注入（jsdom documentElement）、预设循环顺序。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  LAYOUT_STORAGE_KEY,
  MEASURE_MAX,
  MEASURE_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  applyLayoutToRoot,
  clampMeasure,
  clampSidebarWidth,
  layoutActions,
  layoutStore,
  makeDefaultLayout,
  nextLayoutPreset,
  parseLayoutImport,
  readLayout,
  validateLayout,
  writeLayout,
  type LayoutState,
} from '../src/renderer/src/layout/layoutState';

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  document.documentElement.style.removeProperty('--sc-layout-sidebar');
  document.documentElement.style.removeProperty('--sc-layout-measure');
  delete document.documentElement.dataset.scDensity;
});

describe('T39-01 §0.1 三预设定义值', () => {
  it('notion（默认）：侧栏左 240 / measure 650 / AI 右收起 / 标签条显 / 舒适', () => {
    const preset = LAYOUT_PRESETS.notion;
    expect(preset.sidebar).toEqual({ position: 'left', width: 240 });
    expect(preset.content).toEqual({ measure: 650 });
    expect(preset.ai).toEqual({ position: 'right', expanded: false });
    expect(preset.tabsVisible).toBe(true);
    expect(preset.density).toBe('comfortable');
  });

  it('focus：侧栏收起 / measure 900 / AI 收起', () => {
    const preset = LAYOUT_PRESETS.focus;
    expect(preset.sidebar).toEqual({ position: 'collapsed', width: 240 });
    expect(preset.content).toEqual({ measure: 900 });
    expect(preset.ai).toEqual({ position: 'right', expanded: false });
    expect(preset.tabsVisible).toBe(true);
  });

  it('workbench：侧栏左 240 / measure 650 / AI 右侧展开', () => {
    const preset = LAYOUT_PRESETS.workbench;
    expect(preset.sidebar).toEqual({ position: 'left', width: 240 });
    expect(preset.content).toEqual({ measure: 650 });
    expect(preset.ai).toEqual({ position: 'right', expanded: true });
    expect(preset.tabsVisible).toBe(true);
  });
});

describe('T39-01 §1.2 参数夹紧', () => {
  it('侧栏宽度：100→200、999→320、区间内不变、取整', () => {
    expect(SIDEBAR_WIDTH_MIN).toBe(200);
    expect(SIDEBAR_WIDTH_MAX).toBe(320);
    expect(clampSidebarWidth(100)).toBe(200);
    expect(clampSidebarWidth(999)).toBe(320);
    expect(clampSidebarWidth(264)).toBe(264);
    expect(clampSidebarWidth(240.6)).toBe(241);
  });

  it('measure：100→560、9999→1000、区间内不变', () => {
    expect(MEASURE_MIN).toBe(560);
    expect(MEASURE_MAX).toBe(1000);
    expect(clampMeasure(100)).toBe(560);
    expect(clampMeasure(9999)).toBe(1000);
    expect(clampMeasure(720)).toBe(720);
  });

  it('actions 写入越界值 → 存储与根节点变量均为夹紧值', () => {
    layoutActions.init();
    layoutActions.setSidebarWidth(100);
    expect(layoutStore.getState().layout.sidebar.width).toBe(200);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('200px');
    layoutActions.setSidebarWidth(999);
    expect(layoutStore.getState().layout.sidebar.width).toBe(320);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('320px');
    layoutActions.setMeasure(100);
    expect(layoutStore.getState().layout.content.measure).toBe(560);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('560px');
  });
});

describe('T39-01 §1.1 预设切换（状态 + 持久化 + 变量注入）', () => {
  it('applyPreset 即时生效：notion→focus→workbench 数值随动且写 localStorage', () => {
    layoutActions.init();
    expect(layoutStore.getState().layout.preset).toBe('notion');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('240px');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('650px');
    expect(document.documentElement.dataset.scDensity).toBe('comfortable');

    layoutActions.applyPreset('focus');
    const focus = layoutStore.getState().layout;
    expect(focus.preset).toBe('focus');
    expect(focus.sidebar.position).toBe('collapsed');
    expect(focus.content.measure).toBe(900);
    expect(focus.ai.expanded).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('900px');

    layoutActions.applyPreset('workbench');
    const workbench = layoutStore.getState().layout;
    expect(workbench.preset).toBe('workbench');
    expect(workbench.sidebar.position).toBe('left');
    expect(workbench.ai).toEqual({ position: 'right', expanded: true });
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('240px');

    // 持久化：三份快照均落盘，最后一份 = workbench
    const persisted = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as LayoutState;
    expect(persisted.preset).toBe('workbench');
    expect(persisted.ai.expanded).toBe(true);
  });

  it('切预设不改主题（任务书预设定义不含主题）；重开（readLayout）保持在最后预设', () => {
    layoutActions.init();
    layoutActions.setTheme('dark');
    layoutActions.applyPreset('focus');
    expect(layoutStore.getState().layout.theme).toBe('dark');
    expect(JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '')).toMatchObject({ preset: 'focus', theme: 'dark' });
    expect(readLayout().preset).toBe('focus');
  });

  it('参数微调 → preset 落 custom；循环顺序 notion→focus→workbench→notion（custom→notion）', () => {
    expect(nextLayoutPreset('notion')).toBe('focus');
    expect(nextLayoutPreset('focus')).toBe('workbench');
    expect(nextLayoutPreset('workbench')).toBe('notion');
    expect(nextLayoutPreset('custom')).toBe('notion');
    layoutActions.init();
    layoutActions.setTabsVisible(false);
    expect(layoutStore.getState().layout.preset).toBe('custom');
  });
});

describe('T39-01 §1.3/§1.4 导出导入（往返等价 / 非法不改布局）', () => {
  it('导出 → 改布局 → 导入原 JSON → 逐字段深比较等价', () => {
    layoutActions.init();
    layoutActions.setSidebarWidth(280);
    layoutActions.setMeasure(880);
    layoutActions.setAiPosition('bottom');
    layoutActions.setAiExpanded(true);
    layoutActions.setTabsVisible(false);
    layoutActions.setDensity('compact');
    layoutActions.setTheme('dark');

    const exported = layoutActions.exportJson();
    // 中途改成另一份布局（模拟用户改过）
    layoutActions.applyPreset('focus');
    const beforeImport = layoutStore.getState().layout;
    expect(beforeImport.content.measure).toBe(900);

    const result = layoutActions.importFromText(exported);
    expect(result.ok).toBe(true);
    expect(layoutStore.getState().layout).toEqual(JSON.parse(exported) as LayoutState);
  });

  it('非法 JSON `{bad json` → reason=json；布局不变', () => {
    layoutActions.init();
    layoutActions.applyPreset('workbench');
    const snapshot = layoutStore.getState().layout;
    const result = layoutActions.importFromText('{bad json');
    expect(result).toEqual({ ok: false, reason: 'json' });
    expect(layoutStore.getState().layout).toEqual(snapshot);
    expect(window.localStorage.getItem(LAYOUT_STORAGE_KEY)).toBe(JSON.stringify(snapshot));
  });

  it('结构不符（{} / 缺字段 / 枚举外 / 版本不符）→ reason=shape；布局不变', () => {
    layoutActions.init();
    const snapshot = layoutStore.getState().layout;
    for (const text of ['{}', '{"v":1}', '{"v":2,"preset":"notion"}', JSON.stringify({ ...snapshot, ai: { ...snapshot.ai, position: 'left' } })]) {
      expect(parseLayoutImport(text)).toEqual({ ok: false, reason: 'shape' });
    }
    expect(layoutStore.getState().layout).toEqual(snapshot);
  });

  it('导入越界数值 → 夹紧后应用', () => {
    const raw = JSON.stringify({ ...makeDefaultLayout(), sidebar: { position: 'left', width: 9999 }, content: { measure: 1 } });
    const parsed = parseLayoutImport(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.layout.sidebar.width).toBe(320);
      expect(parsed.layout.content.measure).toBe(560);
    }
  });

  it('导入应用主题：theme 字段经既有机制（写 septcats.theme 真相源由 Provider 管道）', () => {
    // Provider 未挂载时 setGlobalThemeMode 走缓冲（theme.tsx 兜底），此处只断言布局字段
    layoutActions.init();
    const raw = JSON.stringify({ ...makeDefaultLayout(), theme: 'light' });
    const result = layoutActions.importFromText(raw);
    expect(result.ok).toBe(true);
    expect(layoutStore.getState().layout.theme).toBe('light');
  });
});

describe('T39-01 §0.4 存储与损坏回退', () => {
  it('损坏 JSON → readLayout 回退默认（notion）', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, '{corrupted');
    expect(readLayout()).toEqual(makeDefaultLayout());
  });

  it('写读往返一致；applyLayoutToRoot 注入变量与密度属性', () => {
    const layout: LayoutState = { ...LAYOUT_PRESETS.focus, theme: 'system' };
    writeLayout(layout);
    expect(readLayout()).toEqual(layout);
    applyLayoutToRoot(layout);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('240px');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('900px');
    expect(document.documentElement.dataset.scDensity).toBe('comfortable');
  });

  it('validateLayout 对合法布局恒等（导出 JSON round-trip 不失真）', () => {
    layoutActions.init();
    layoutActions.setSidebarPosition('collapsed');
    layoutActions.setAiPosition('hidden');
    const layout = layoutStore.getState().layout;
    expect(validateLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
});
