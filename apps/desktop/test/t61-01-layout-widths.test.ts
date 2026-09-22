// @vitest-environment jsdom
/**
 * t61-01-layout-widths.test.ts —— TASK-T61-01 §2 拖拽宽度的纯逻辑面。
 *
 * 覆盖（对应任务书 §2.5 测试清单）：
 * - `maxPanelWidth(viewportW)`：min(480, floor(vw × 0.30))，视口 1000→300、1600→480（封顶）、
 *   894→268、非法输入 → 兜底视口；
 * - `clampSidebarWidth` / `clampAiWidth`：下限恒定、上限随视口、取整、**极窄视口下限优先**；
 * - `validateLayout` 对**旧 v1 持久化**（T38/T39/T57 时代无 `ai.width`）→ 默认值兜底、
 *   **不判脏**（不返回 null、不整份回退）；非法 width（字符串/NaN）同样兜底；
 *   有合法 width → 按视口夹紧；
 * - 三预设新增 `ai.width = 320`（其余定义值一字未动）；不升版本号（v 恒 1）；
 * - `applyLayoutToRoot` 注入 `--sc-layout-ai-width`；`setAiWidth` 同真源（存储+变量+preset→custom）；
 * - 预览百分比函数改用新值域（14%–30% 区间端点仍对齐 min / 视口上限）。
 *
 * 纪律：所有纯函数都显式传视口宽（不依赖 jsdom 的 1024 缺省值），断言才可复现。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_WIDTH_DEFAULT,
  AI_WIDTH_MIN,
  FALLBACK_VIEWPORT_WIDTH,
  LAYOUT_PRESETS,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  PANEL_RESIZE_STEP,
  PANEL_WIDTH_CAP,
  SIDEBAR_WIDTH_MIN,
  clampAiWidth,
  clampSidebarWidth,
  currentViewportWidth,
  layoutActions,
  layoutPreviewOf,
  layoutStore,
  makeDefaultLayout,
  maxPanelWidth,
  previewSidebarPercent,
  readLayout,
  validateLayout,
  type LayoutState,
} from '../src/renderer/src/layout/layoutState';

const persisted = (): Record<string, unknown> =>
  JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '') as Record<string, unknown>;

beforeEach(() => {
  window.localStorage.clear();
  layoutStore.setState((state) => ({ ...state, layout: makeDefaultLayout() }));
  document.documentElement.style.removeProperty('--sc-layout-sidebar');
  document.documentElement.style.removeProperty('--sc-layout-ai-width');
  document.documentElement.style.removeProperty('--sc-layout-measure');
  delete document.documentElement.dataset.scDensity;
});

describe('T61-01 §2.1 maxPanelWidth（min(480, floor(视口 30%))）', () => {
  it('视口 1000 → 300；1184 → 355；894 → 268；1024 → 307', () => {
    expect(maxPanelWidth(1000)).toBe(300);
    expect(maxPanelWidth(1184)).toBe(355);
    expect(maxPanelWidth(894)).toBe(268);
    expect(maxPanelWidth(1024)).toBe(307);
  });

  it('绝对上限 480：视口 1600 → 480、1920 → 480（30% 超 480 时封顶）', () => {
    expect(PANEL_WIDTH_CAP).toBe(480);
    expect(maxPanelWidth(1600)).toBe(480);
    expect(maxPanelWidth(1920)).toBe(480);
    expect(maxPanelWidth(4800)).toBe(480);
  });

  it('非法/缺失视口 → 兜底视口（纯函数侧恒有确定值，不返回 NaN）', () => {
    expect(maxPanelWidth(0)).toBe(maxPanelWidth(FALLBACK_VIEWPORT_WIDTH));
    expect(maxPanelWidth(-100)).toBe(maxPanelWidth(FALLBACK_VIEWPORT_WIDTH));
    expect(maxPanelWidth(Number.NaN)).toBe(maxPanelWidth(FALLBACK_VIEWPORT_WIDTH));
  });

  it('缺省调用取当前视口（jsdom 1024）；currentViewportWidth 有确定值', () => {
    expect(currentViewportWidth()).toBe(1024);
    expect(maxPanelWidth()).toBe(307);
  });
});

describe('T61-01 §2.1 两侧宽度夹紧（下限恒定 / 上限随视口 / 下限优先）', () => {
  it('侧栏：视口 1000 → 上限 300（999 夹到 300）；区间内不变、取整', () => {
    expect(SIDEBAR_WIDTH_MIN).toBe(200);
    expect(clampSidebarWidth(100, 1000)).toBe(200);
    expect(clampSidebarWidth(999, 1000)).toBe(300);
    expect(clampSidebarWidth(264, 1000)).toBe(264);
    expect(clampSidebarWidth(240.6, 1000)).toBe(241);
  });

  it('侧栏：视口 1600 → 上限 480（旧 320 上限已解除，老板口径「上限=视口 30%」）', () => {
    expect(clampSidebarWidth(320, 1600)).toBe(320);
    expect(clampSidebarWidth(400, 1600)).toBe(400);
    expect(clampSidebarWidth(999, 1600)).toBe(PANEL_WIDTH_CAP);
  });

  it('AI：视口 1000 → 上限 300、下限 240；默认 320 在窄视口被夹到 300', () => {
    expect(AI_WIDTH_MIN).toBe(240);
    expect(AI_WIDTH_DEFAULT).toBe(320);
    expect(clampAiWidth(100, 1000)).toBe(240);
    expect(clampAiWidth(320, 1000)).toBe(300);
    expect(clampAiWidth(260, 1000)).toBe(260);
    expect(clampAiWidth(999, 1600)).toBe(PANEL_WIDTH_CAP);
  });

  it('极窄视口（30% < 下限）→ 下限优先，区间不为空（不出现无解夹紧）', () => {
    // 视口 500 → 30% = 150 < 200
    expect(maxPanelWidth(500)).toBe(150);
    expect(clampSidebarWidth(120, 500)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampAiWidth(120, 500)).toBe(AI_WIDTH_MIN);
  });
});

describe('T61-01 §2.4 旧 v1 持久化兼容（ai.width 兜底，不判脏）', () => {
  /** T39/T57 时代的布局 JSON：ai 只有 position/expanded（无 width）。 */
  const legacyLayout = (): Record<string, unknown> => {
    return {
      v: 1,
      preset: 'custom',
      sidebar: { position: 'left', width: 288 },
      content: { measure: 720 },
      ai: { position: 'right', expanded: true },
      tabsVisible: false,
      theme: 'dark',
      density: 'compact',
    };
  };

  it('缺 ai.width → 不返回 null，且 width 兜底默认 320（其余字段逐项保留）', () => {
    const parsed = validateLayout(legacyLayout());
    expect(parsed).not.toBeNull();
    expect(parsed?.ai).toEqual({ position: 'right', expanded: true, width: AI_WIDTH_DEFAULT });
    expect(parsed?.sidebar).toEqual({ position: 'left', width: 288 });
    expect(parsed?.content).toEqual({ measure: 720 });
    expect(parsed?.theme).toBe('dark');
    expect(parsed?.density).toBe('compact');
    expect(parsed?.tabsVisible).toBe(false);
  });

  it('ai.width 非法（字符串 / NaN / null）→ 同样兜底 320，不判脏', () => {
    for (const bad of ['320', Number.NaN, null, {}]) {
      const raw = legacyLayout();
      raw.ai = { position: 'right', expanded: false, width: bad };
      const parsed = validateLayout(raw);
      expect(parsed, `width=${String(bad)} 不应判脏`).not.toBeNull();
      expect(parsed?.ai.width).toBe(AI_WIDTH_DEFAULT);
    }
  });

  it('ai.width 合法 → 按当前视口 30% 夹紧（jsdom 1024 → 307，非绝对值 480）', () => {
    const raw = legacyLayout();
    raw.ai = { position: 'right', expanded: false, width: 2000 };
    expect(validateLayout(raw)?.ai.width).toBe(clampAiWidth(2000));
    expect(validateLayout(raw)?.ai.width).toBe(maxPanelWidth(1024));
  });

  it('readLayout：老持久化读出后 **不整份回退默认**（自定义字段存活 + width 兜底）', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(legacyLayout()));
    const layout = readLayout();
    expect(layout.sidebar.width).toBe(288);
    expect(layout.content.measure).toBe(720);
    expect(layout.theme).toBe('dark');
    expect(layout.ai.width).toBe(AI_WIDTH_DEFAULT);
  });

  it('版本号不升：LAYOUT_VERSION 恒 1（纯增字段）', () => {
    expect(LAYOUT_VERSION).toBe(1);
    expect(makeDefaultLayout().v).toBe(1);
    expect(validateLayout(legacyLayout())?.v).toBe(1);
  });
});

describe('T61-01 §2.1 预设与真源（变量注入 / setAiWidth）', () => {
  it('三预设 ai.width = 320（位置/展开/侧栏宽等既有定义值一字未动）', () => {
    expect(LAYOUT_PRESETS.notion.ai).toEqual({ position: 'right', expanded: false, width: AI_WIDTH_DEFAULT });
    expect(LAYOUT_PRESETS.focus.ai).toEqual({ position: 'right', expanded: false, width: AI_WIDTH_DEFAULT });
    expect(LAYOUT_PRESETS.workbench.ai).toEqual({ position: 'right', expanded: true, width: AI_WIDTH_DEFAULT });
    expect(LAYOUT_PRESETS.notion.sidebar).toEqual({ position: 'left', width: 240 });
    expect(LAYOUT_PRESETS.notion.content).toEqual({ measure: 650 });
  });

  it('applyLayoutToRoot 注入 --sc-layout-ai-width；setAiWidth 同真源（store+localStorage+preset→custom）', () => {
    layoutActions.init();
    // commit 的唯一夹紧闸：jsdom 视口 1024 → 默认 320 被夹到 307 后才落盘/注入
    expect(layoutStore.getState().layout.ai.width).toBe(307);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-ai-width')).toBe('307px');
    layoutActions.setAiWidth(280);
    expect(layoutStore.getState().layout.ai.width).toBe(280);
    expect(layoutStore.getState().layout.preset).toBe('custom');
    expect(document.documentElement.style.getPropertyValue('--sc-layout-ai-width')).toBe('280px');
    expect((persisted().ai as { width: number }).width).toBe(280);
  });

  it('唯一夹紧闸：预设整份套用也过闸（宽视口保留 320，窄视口被夹到 30%）', () => {
    // jsdom 1024：预设 320 → 307
    layoutActions.init();
    layoutActions.applyPreset('workbench');
    expect(layoutStore.getState().layout.ai.width).toBe(307);
    expect(layoutStore.getState().layout.preset).toBe('workbench');
  });

  it('reclampToViewport：窗口变窄后宽度被夹进新上限；无变化时零副作用', () => {
    layoutActions.init();
    layoutActions.setAiWidth(300);
    layoutActions.setSidebarWidth(300);
    const before = layoutStore.getState().layout;

    // 已在上限内 → 不写盘、不换引用
    layoutActions.reclampToViewport();
    expect(layoutStore.getState().layout).toBe(before);
    expect((persisted().ai as { width: number }).width).toBe(300);

    // 视口变窄（1024 → 800，上限 240）→ 两侧被夹到下限
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });
    try {
      layoutActions.reclampToViewport();
      expect(maxPanelWidth(800)).toBe(240);
      expect(layoutStore.getState().layout.ai.width).toBe(clampAiWidth(300, 800));
      expect(layoutStore.getState().layout.sidebar.width).toBe(clampSidebarWidth(300, 800));
      expect((persisted().ai as { width: number }).width).toBe(layoutStore.getState().layout.ai.width);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
    }
  });

  it('setAiWidth 越界 → 存的是夹紧值（视口 1024 上限 307）；参数微调不改 position/expanded', () => {
    layoutActions.init();
    layoutActions.setAiWidth(9999);
    expect(layoutStore.getState().layout.ai.width).toBe(307);
    expect(document.documentElement.style.getPropertyValue('--sc-layout-ai-width')).toBe('307px');
    expect(layoutStore.getState().layout.ai.position).toBe('right');
    expect(layoutStore.getState().layout.ai.expanded).toBe(false);
  });

  it('PANEL_RESIZE_STEP = 16（把手键盘步进口径）', () => {
    expect(PANEL_RESIZE_STEP).toBe(16);
  });
});

describe('T61-01 §2.3 预览百分比用新值域（14%–30%）', () => {
  it('视口 1000：200→14 / 300→30 / 240→20.4；越界先夹紧', () => {
    expect(previewSidebarPercent(SIDEBAR_WIDTH_MIN, 1000)).toBe(14);
    expect(previewSidebarPercent(300, 1000)).toBe(30);
    expect(previewSidebarPercent(240, 1000)).toBe(20.4);
    expect(previewSidebarPercent(100, 1000)).toBe(14);
    expect(previewSidebarPercent(9999, 1000)).toBe(30);
  });

  it('视口 1600（上限 480）：320→20.9，480→30 —— 同一宽度在不同视口下占比不同', () => {
    expect(previewSidebarPercent(320, 1600)).toBe(20.9);
    expect(previewSidebarPercent(480, 1600)).toBe(30);
  });

  it('layoutPreviewOf 透传视口；退化区间（上限 ≤ 下限）取 30% 不除零', () => {
    const layout = makeDefaultLayout();
    expect(layoutPreviewOf(layout, 1000).sidebarPercent).toBe(previewSidebarPercent(240, 1000));
    expect(layoutPreviewOf(layout, 1000).contentPercent).toBe(54.2);
    expect(previewSidebarPercent(200, 500)).toBe(30);
  });

  it('旧布局（无 ai.width）经 validateLayout 后取 ai 结构完整（预览/渲染不读 undefined）', () => {
    const raw = { ...makeDefaultLayout(), ai: { position: 'bottom', expanded: true } } as unknown as LayoutState;
    const parsed = validateLayout(JSON.parse(JSON.stringify(raw)) as unknown);
    expect(parsed?.ai.width).toBe(AI_WIDTH_DEFAULT);
    expect(layoutPreviewOf(parsed ?? layoutStore.getState().layout, 1000).aiPlacement).toBe('bottom');
  });
});
