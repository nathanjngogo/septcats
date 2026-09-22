// @vitest-environment jsdom
/**
 * layout-preview-t57.test.ts —— TASK-T57-01 布局预览纯逻辑（layoutState.ts 新增面）。
 *
 * 覆盖：
 * - `previewSidebarPercent` / `previewContentPercent`：区间端点与中点、越界先夹紧
 *   （与参数夹紧同口径）；
 * - `layoutPreviewOf`：侧栏可见性、AI 落位（hidden → 'none'）、标签条/密度透传；
 * - `layoutPreviewForPreset`：三预设的预览几何快照（弹框卡画的就是套用后的样子）；
 * - `layoutActions.resetLayout`：恢复默认 = notion 参数 + **保留当前主题**，
 *   且即时写根节点变量 + localStorage（编辑器页「恢复默认」的纯逻辑面）。
 *
 * 纪律：localStorage 用 jsdom 原生实现；根变量断言走 documentElement 内联样式。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAYOUT_PRESETS,
  LAYOUT_STORAGE_KEY,
  applyLayoutToRoot,
  clampAiWidth,
  defaultLayoutWithTheme,
  layoutActions,
  layoutPreviewForPreset,
  layoutPreviewOf,
  layoutStore,
  makeDefaultLayout,
  previewContentPercent,
  previewSidebarPercent,
} from '../src/renderer/src/layout/layoutState';

function persistedLayout(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as Record<string, unknown>;
}

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  document.documentElement.style.removeProperty('--sc-layout-sidebar');
  document.documentElement.style.removeProperty('--sc-layout-measure');
  delete document.documentElement.dataset.scDensity;
});

describe('T57-01 预览几何纯函数', () => {
  /**
   * T61-01 §2.3：预览列宽的归一区间由「200–320」改「200–视口 30% 上限」，
   * 故此处显式传视口（1024 → 上限 307）钉死可复现值；区间端点（14%–30%）不变。
   */
  const VW = 1024;

  it('侧栏宽度 → 预览列宽（%）：200→14 / 240→20 / 307→30，越界按参数口径夹紧', () => {
    expect(previewSidebarPercent(200, VW)).toBe(14);
    expect(previewSidebarPercent(307, VW)).toBe(30);
    expect(previewSidebarPercent(240, VW)).toBe(20);
    // 越界先夹紧（与 clampSidebarWidth 同口径）→ 不越出 14–30
    expect(previewSidebarPercent(100, VW)).toBe(14);
    expect(previewSidebarPercent(999, VW)).toBe(30);
  });

  it('measure → 预览正文列宽（%）：560→46 / 650→54.2 / 900→76.9 / 1000→86，越界夹紧', () => {
    expect(previewContentPercent(560)).toBe(46);
    expect(previewContentPercent(1000)).toBe(86);
    expect(previewContentPercent(650)).toBe(54.2);
    expect(previewContentPercent(900)).toBe(76.9);
    expect(previewContentPercent(10)).toBe(46);
    expect(previewContentPercent(99999)).toBe(86);
  });

  it('layoutPreviewOf：侧栏可见性 / AI 落位（hidden→none）/ 标签条与密度透传', () => {
    const base = makeDefaultLayout();
    expect(layoutPreviewOf(base, VW)).toEqual({
      sidebarVisible: true,
      sidebarPercent: 20,
      contentPercent: 54.2,
      aiPlacement: 'right',
      aiExpanded: false,
      tabsVisible: true,
      density: 'comfortable',
    });

    // 收起侧栏 + AI 置底 + 隐藏标签条 + 紧凑
    const custom = {
      ...base,
      sidebar: { position: 'collapsed' as const, width: 307 },
      ai: { position: 'bottom' as const, expanded: true, width: 320 },
      tabsVisible: false,
      density: 'compact' as const,
    };
    expect(layoutPreviewOf(custom, VW)).toEqual({
      sidebarVisible: false,
      sidebarPercent: 30,
      contentPercent: 54.2,
      aiPlacement: 'bottom',
      aiExpanded: true,
      tabsVisible: false,
      density: 'compact',
    });

    // AI 位置 = 隐藏 → 图上不画（'none'）
    expect(
      layoutPreviewOf({ ...base, ai: { position: 'hidden', expanded: true, width: 320 } }, VW).aiPlacement,
    ).toBe('none');
  });

  it('layoutPreviewForPreset：三预设快照（notion 有侧栏 / focus 无侧栏且正文更宽 / workbench AI 右侧）', () => {
    expect(layoutPreviewForPreset('notion')).toEqual({
      sidebarVisible: true,
      sidebarPercent: previewSidebarPercent(LAYOUT_PRESETS.notion.sidebar.width),
      contentPercent: previewContentPercent(LAYOUT_PRESETS.notion.content.measure),
      aiPlacement: 'right',
      aiExpanded: false,
      tabsVisible: true,
      density: 'comfortable',
    });
    const focus = layoutPreviewForPreset('focus');
    expect(focus.sidebarVisible).toBe(false);
    expect(focus.contentPercent).toBe(76.9);
    expect(focus.aiExpanded).toBe(false);
    const workbench = layoutPreviewForPreset('workbench');
    expect(workbench.sidebarVisible).toBe(true);
    expect(workbench.aiPlacement).toBe('right');
    // workbench = 唯一 AI 展开档：图上 AI 列可辨（notion/focus 收起）
    expect(workbench.aiExpanded).toBe(true);
    expect(layoutPreviewForPreset('notion').aiExpanded).toBe(false);
  });
});

describe('T57-01 恢复默认（resetLayout）', () => {
  it('defaultLayoutWithTheme 保留传入主题、其余回 notion 预设', () => {
    const layout = defaultLayoutWithTheme('dark');
    expect(layout).toEqual({ ...LAYOUT_PRESETS.notion, theme: 'dark' });
  });

  it('resetLayout：custom 参数回 notion 默认，主题保留，根变量与存储即时回写', () => {
    // 先造一份远离默认的 custom 布局（含深色主题）
    layoutStore.setState((state) => ({
      ...state,
      layout: {
        ...makeDefaultLayout(),
        preset: 'custom',
        theme: 'dark',
        sidebar: { position: 'collapsed', width: 320 },
        content: { measure: 1000 },
        density: 'compact',
      },
    }));
    applyLayoutToRoot(layoutStore.getState().layout);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('1000px');

    layoutActions.resetLayout();

    const after = layoutStore.getState().layout;
    // T61-01 §2：恢复默认同样过「视口 30%」闸（preset 常量 ai.width=320 → jsdom 1024 的 307）
    const expected = {
      ...LAYOUT_PRESETS.notion,
      theme: 'dark' as const,
      ai: { ...LAYOUT_PRESETS.notion.ai, width: clampAiWidth(LAYOUT_PRESETS.notion.ai.width) },
    };
    expect(after).toEqual(expected);
    expect(after.preset).toBe('notion');
    expect(after.sidebar).toEqual({ position: 'left', width: 240 });
    expect(after.content).toEqual({ measure: 650 });
    expect(document.documentElement.style.getPropertyValue('--sc-layout-sidebar')).toBe('240px');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-measure')).toBe('650px');
    expect(document.documentElement.dataset.scDensity).toBe('comfortable');
    expect(persistedLayout()).toEqual(expected);
  });
});
