/**
 * layoutState.ts —— R3 布局设计器的状态与持久化（TASK-T39-01 §0.2–§0.4）。
 *
 * - 一份布局 JSON 存 renderer localStorage 键 `septcats.layout`（全局，不按 workspace；
 *   与 `septcats.tabs.<ws>` / `septcats.aichat.*` 同范式：版本化 + safe 读写 + 损坏回退默认）。
 * - 实现口径（§0.3）：所有结构参数以 **CSS 变量注入根节点**（documentElement 内联样式
 *   setProperty），既有布局消费这些变量；本模块**不做**任何元素量测或内联宽高。
 *   密度走根节点 data 属性 + CSS 内 token 档位派生（App.css），不写死数值。
 * - 主题字段复用既有主题机制（@septcats/ui setGlobalThemeMode / localStorage `septcats.theme`），
 *   不新造第二真相源；预设切换**不改**主题（任务书三预设定义不含主题）。
 * - 导出/导入 = 剪贴板双向（§0.4 MVP，不新增文件对话框 IPC）；导入非法 JSON 给可读错误
 *   且**不改动当前布局**。
 * - 纯函数 + 极简 store（state/store.ts 同款 Zustand 同形实现），可独立单测。
 */
import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY, setGlobalThemeMode } from '@septcats/ui';
import { aiChatActions } from '../ai/chatState';
import { createStore, useStore } from '../state/store';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type LayoutPresetId = 'notion' | 'focus' | 'workbench';
export type SidebarPosition = 'left' | 'collapsed';
export type AiPanelPosition = 'right' | 'bottom' | 'hidden';
export type LayoutDensity = 'compact' | 'comfortable';
export type LayoutTheme = 'light' | 'dark' | 'system';

export interface LayoutState {
  v: 1;
  /** 当前生效预设；参数被手动微调后落 `custom`（导入接受 custom）。 */
  preset: LayoutPresetId | 'custom';
  sidebar: { position: SidebarPosition; width: number };
  content: { measure: number };
  /** T61-01 §2：`width` = AI 面板宽度（右侧栏布局；position='bottom' 时不参与渲染）。 */
  ai: { position: AiPanelPosition; expanded: boolean; width: number };
  tabsVisible: boolean;
  /** 布局快照里的主题（导出时同步当前实际主题；导入时应用）。 */
  theme: LayoutTheme;
  density: LayoutDensity;
}

// ---------------------------------------------------------------------------
// 常量与夹紧
// ---------------------------------------------------------------------------

export const LAYOUT_STORAGE_KEY = 'septcats.layout';
export const LAYOUT_VERSION = 1;

/**
 * §0.2 侧栏宽度夹紧下限（T61-01 起上限改为视口动态，见 `maxPanelWidth`）。
 * T61-01 §2：两侧栏共用「视口 30%」口径，上限 = min(480, floor(视口宽 × 0.30))。
 */
export const SIDEBAR_WIDTH_MIN = 200;

/** T61-01 §2：面板宽度绝对上限（480 = 侧栏原 320 与真机实证的可读上限折中；两侧共用）。 */
export const PANEL_WIDTH_CAP = 480;
/** T61-01 §2：面板宽度占**总窗口宽**的比例上限（老板口径 30%）。 */
export const PANEL_WIDTH_RATIO = 0.3;
/** T61-01 §2：AI 面板宽度下限与默认值（T38-01 起 CSS 定宽 320 → 迁为布局字段）。 */
export const AI_WIDTH_MIN = 240;
export const AI_WIDTH_DEFAULT = 320;
/** T61-01 §2：把手键盘步进（←/→ 一次 16px）。 */
export const PANEL_RESIZE_STEP = 16;
/**
 * 视口不可用（无 window / 非浏览器环境）时的兜底宽：取 jsdom 与常见窗口的保守值，
 * 保证 `maxPanelWidth` 恒有确定值（纯函数在 Node 侧也可断言）。
 */
export const FALLBACK_VIEWPORT_WIDTH = 1024;

/** §0.2 内容 measure 夹紧区间。 */
export const MEASURE_MIN = 560;
export const MEASURE_MAX = 1000;

/** T57-01：预览缩略图的绘制区间（%），只影响图形观感，不参与布局参数。 */
const PREVIEW_SIDEBAR_MIN_PERCENT = 14;
const PREVIEW_SIDEBAR_SPAN_PERCENT = 16;
const PREVIEW_CONTENT_MIN_PERCENT = 46;
const PREVIEW_CONTENT_SPAN_PERCENT = 40;

const SIDEBAR_POSITIONS: readonly SidebarPosition[] = ['left', 'collapsed'];
const AI_POSITIONS: readonly AiPanelPosition[] = ['right', 'bottom', 'hidden'];
const DENSITIES: readonly LayoutDensity[] = ['compact', 'comfortable'];
const THEMES: readonly LayoutTheme[] = ['light', 'dark', 'system'];
const PRESET_IDS: readonly LayoutPresetId[] = ['notion', 'focus', 'workbench'];

/** 当前视口宽（无 window / 非法值 → FALLBACK_VIEWPORT_WIDTH；纯函数侧的确定性来源）。 */
export function currentViewportWidth(): number {
  const width = (globalThis as { innerWidth?: unknown }).innerWidth;
  return typeof width === 'number' && Number.isFinite(width) && width > 0
    ? width
    : FALLBACK_VIEWPORT_WIDTH;
}

/**
 * T61-01 §2：面板宽度上限（纯函数，可单测）——`min(480, floor(视口宽 × 0.30))`。
 * 口径 = **总窗口宽**的 30%（老板 09-22 晚 ⑧）；两侧栏（侧栏 / AI 面板）共用同一上限。
 */
export function maxPanelWidth(viewportW: number = currentViewportWidth()): number {
  const vw = Number.isFinite(viewportW) && viewportW > 0 ? viewportW : FALLBACK_VIEWPORT_WIDTH;
  return Math.min(PANEL_WIDTH_CAP, Math.floor(vw * PANEL_WIDTH_RATIO));
}

/**
 * 侧栏宽度夹紧：下限 200 恒定；上限 = 视口 30% 动态值。
 * 极窄视口（30% < 下限）时**下限优先**（区间不为空，避免出现无解夹紧）。
 */
export function clampSidebarWidth(width: number, viewportW?: number): number {
  const upper = Math.max(SIDEBAR_WIDTH_MIN, maxPanelWidth(viewportW));
  return Math.min(upper, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

/** AI 面板宽度夹紧：下限 240；上限同侧栏（视口 30%，极窄时下限优先）。 */
export function clampAiWidth(width: number, viewportW?: number): number {
  const upper = Math.max(AI_WIDTH_MIN, maxPanelWidth(viewportW));
  return Math.min(upper, Math.max(AI_WIDTH_MIN, Math.round(width)));
}

export function clampMeasure(measure: number): number {
  return Math.min(MEASURE_MAX, Math.max(MEASURE_MIN, Math.round(measure)));
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 预设（任务书 §0.1 三选；theme 不在预设定义内 —— 切预设不改主题）
// ---------------------------------------------------------------------------

export const LAYOUT_PRESETS: Record<LayoutPresetId, Omit<LayoutState, 'theme'>> = {
  notion: {
    v: 1,
    preset: 'notion',
    sidebar: { position: 'left', width: 240 },
    content: { measure: 650 },
    ai: { position: 'right', expanded: false, width: AI_WIDTH_DEFAULT },
    tabsVisible: true,
    density: 'comfortable',
  },
  focus: {
    v: 1,
    preset: 'focus',
    sidebar: { position: 'collapsed', width: 240 },
    content: { measure: 900 },
    ai: { position: 'right', expanded: false, width: AI_WIDTH_DEFAULT },
    tabsVisible: true,
    density: 'comfortable',
  },
  workbench: {
    v: 1,
    preset: 'workbench',
    sidebar: { position: 'left', width: 240 },
    content: { measure: 650 },
    ai: { position: 'right', expanded: true, width: AI_WIDTH_DEFAULT },
    tabsVisible: true,
    density: 'comfortable',
  },
};

/** 预设循环顺序（命令面板「切换布局预设」；custom → notion 重新入环）。 */
export function nextLayoutPreset(current: LayoutState['preset']): LayoutPresetId {
  const index = PRESET_IDS.indexOf(current as LayoutPresetId);
  return PRESET_IDS[(index + 1) % PRESET_IDS.length] ?? 'notion';
}

export function makeDefaultLayout(): LayoutState {
  return { ...LAYOUT_PRESETS.notion, theme: 'system' };
}

/** 恢复默认（notion 参数 + **保留当前主题**）——「恢复默认」与预设切换同属整份套用路径。 */
export function defaultLayoutWithTheme(theme: LayoutTheme): LayoutState {
  return { ...LAYOUT_PRESETS.notion, theme };
}

// ---------------------------------------------------------------------------
// 预览几何（T57-01 §1.2/§1.3）
//
// 弹框预设卡与编辑器大图共用同一份「CSS 抽象微缩窗口」参数：由 LayoutState 派生的
// 纯数（侧栏是否在 / 侧栏占比 / 正文占比 / AI 落位 / 标签条 / 密度），视图只消费。
// 百分比口径：把两个已有夹紧区间线性归一到肉眼可辨的绘图区间（不改布局参数本身）。
// ---------------------------------------------------------------------------

/** 预览里 AI 面板的落位（'none' = 位置为 hidden，图上不画）。 */
export type AiPreviewPlacement = 'right' | 'bottom' | 'none';

export interface LayoutPreview {
  /** 侧栏可见（position='left'）；收起态 false → 图上不画侧栏列。 */
  sidebarVisible: boolean;
  /** 侧栏列占预览窗宽比例（%）：宽度区间 200–视口 30% 上限 → 14%–30%。 */
  sidebarPercent: number;
  /** 正文列占内容区比例（%）：measure 区间 560–1000 → 46%–86%。 */
  contentPercent: number;
  aiPlacement: AiPreviewPlacement;
  /** AI 面板默认展开（false → 图上画窄轨，与「收起」一致；hidden 时 aiPlacement='none' 不画）。 */
  aiExpanded: boolean;
  tabsVisible: boolean;
  density: LayoutDensity;
}

/**
 * 侧栏宽度 → 预览列宽百分比（14%–30%；越界先按参数口径夹紧）。
 * T61-01 §2：值域上限由 320 改「视口 30%」→ 本函数同步用新值域（同一次归一，预览不破）。
 * 极窄视口导致区间退化（上限 ≤ 下限）时取上限端点 30%（不做除零）。
 */
export function previewSidebarPercent(width: number, viewportW?: number): number {
  const upper = Math.max(SIDEBAR_WIDTH_MIN, maxPanelWidth(viewportW));
  const span = upper - SIDEBAR_WIDTH_MIN;
  const ratio = span <= 0 ? 1 : (clampSidebarWidth(width, viewportW) - SIDEBAR_WIDTH_MIN) / span;
  return Math.round((PREVIEW_SIDEBAR_MIN_PERCENT + ratio * PREVIEW_SIDEBAR_SPAN_PERCENT) * 10) / 10;
}

/** 内容 measure → 预览正文列百分比（46%–86%；越界先按参数口径夹紧）。 */
export function previewContentPercent(measure: number): number {
  const ratio = (clampMeasure(measure) - MEASURE_MIN) / (MEASURE_MAX - MEASURE_MIN);
  return Math.round((PREVIEW_CONTENT_MIN_PERCENT + ratio * PREVIEW_CONTENT_SPAN_PERCENT) * 10) / 10;
}

/** 布局（或其参数子集）→ 预览几何。 */
export function layoutPreviewOf(
  layout: Pick<LayoutState, 'sidebar' | 'content' | 'ai' | 'tabsVisible' | 'density'>,
  viewportW?: number,
): LayoutPreview {
  return {
    sidebarVisible: layout.sidebar.position === 'left',
    sidebarPercent: previewSidebarPercent(layout.sidebar.width, viewportW),
    contentPercent: previewContentPercent(layout.content.measure),
    aiPlacement: layout.ai.position === 'hidden' ? 'none' : layout.ai.position,
    aiExpanded: layout.ai.expanded,
    tabsVisible: layout.tabsVisible,
    density: layout.density,
  };
}

/** 预设 id → 预览几何（卡上画的就是该预设套用后的样子）。 */
export function layoutPreviewForPreset(id: LayoutPresetId): LayoutPreview {
  return layoutPreviewOf(LAYOUT_PRESETS[id]);
}

// ---------------------------------------------------------------------------
// 校验与导入解析（非法 JSON → 可读错误且不改当前布局）
// ---------------------------------------------------------------------------

export type LayoutImportFailure = 'json' | 'shape';

/**
 * 布局 JSON → LayoutState。结构不符（缺字段/枚举外/类型错）返回 null；
 * 数值越界按区间夹紧（与参数微调同口径）。
 */
export function validateLayout(input: unknown): LayoutState | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const raw = input as Record<string, unknown>;
  if (raw.v !== LAYOUT_VERSION) {
    return null;
  }
  const preset = isOneOf(raw.preset, PRESET_IDS) ? raw.preset : raw.preset === 'custom' ? 'custom' : null;
  const sidebar = raw.sidebar;
  const content = raw.content;
  const ai = raw.ai;
  if (
    preset === null ||
    typeof sidebar !== 'object' ||
    sidebar === null ||
    typeof content !== 'object' ||
    content === null ||
    typeof ai !== 'object' ||
    ai === null
  ) {
    return null;
  }
  const sidebarRaw = sidebar as Record<string, unknown>;
  const contentRaw = content as Record<string, unknown>;
  const aiRaw = ai as Record<string, unknown>;
  if (
    !isOneOf(sidebarRaw.position, SIDEBAR_POSITIONS) ||
    typeof sidebarRaw.width !== 'number' ||
    !Number.isFinite(sidebarRaw.width) ||
    typeof contentRaw.measure !== 'number' ||
    !Number.isFinite(contentRaw.measure) ||
    !isOneOf(aiRaw.position, AI_POSITIONS) ||
    typeof aiRaw.expanded !== 'boolean' ||
    typeof raw.tabsVisible !== 'boolean' ||
    !isOneOf(raw.theme, THEMES) ||
    !isOneOf(raw.density, DENSITIES)
  ) {
    return null;
  }
  return {
    v: LAYOUT_VERSION,
    preset,
    sidebar: {
      position: sidebarRaw.position,
      width: clampSidebarWidth(sidebarRaw.width),
    },
    content: { measure: clampMeasure(contentRaw.measure) },
    ai: {
      position: aiRaw.position,
      expanded: aiRaw.expanded,
      /**
       * T61-01 §2：`ai.width` 是**纯增字段**（不升版本号）。
       * 旧 v1 持久化（T38/T39/T57 时代）没有这个键 → 取值兜底 AI_WIDTH_DEFAULT，
       * **不判脏、不返回 null**（否则老用户的布局会被判为损坏、整份回退默认）。
       */
      width:
        typeof aiRaw.width === 'number' && Number.isFinite(aiRaw.width)
          ? clampAiWidth(aiRaw.width)
          : AI_WIDTH_DEFAULT,
    },
    tabsVisible: raw.tabsVisible,
    theme: raw.theme,
    density: raw.density,
  };
}

/** 导入文本解析：JSON.parse 失败 → 'json'；结构不符 → 'shape'。 */
export function parseLayoutImport(text: string): { ok: true; layout: LayoutState } | { ok: false; reason: LayoutImportFailure } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'json' };
  }
  const layout = validateLayout(parsed);
  if (layout === null) {
    return { ok: false, reason: 'shape' };
  }
  return { ok: true, layout };
}

// ---------------------------------------------------------------------------
// localStorage 读写（safe：不可用/损坏 → 默认）
// ---------------------------------------------------------------------------

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

/** 读布局；缺失/损坏/版本不符 → 默认（notion）。 */
export function readLayout(): LayoutState {
  const raw = safeGetItem(LAYOUT_STORAGE_KEY);
  if (raw === null) {
    return makeDefaultLayout();
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateLayout(parsed) ?? makeDefaultLayout();
  } catch {
    return makeDefaultLayout();
  }
}

export function writeLayout(layout: LayoutState): void {
  safeSetItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

// ---------------------------------------------------------------------------
// CSS 变量注入（实现口径 §0.3：只注入根节点变量/密度属性，零量测零内联宽高）
// ---------------------------------------------------------------------------

/** 消费方（变量表）：--sc-layout-sidebar = AppShell.css .sc-shell__body 列宽；
 *  --sc-layout-ai-width = AiChatPanel.css .ai-chat 宽（T61-01 §2 右侧拖拽宽度；
 *    position='bottom' 时该变量不被消费，面板走 flex 全宽 + 定高）；
 *  --sc-layout-measure = PageView.css 编辑区 max-width（回退 --sc-space-editor-measure）；
 *  data-sc-density = App.css :root 密度档位（行高/间距走 token 派生变量）。 */
export function applyLayoutToRoot(layout: LayoutState): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--sc-layout-sidebar', `${layout.sidebar.width}px`);
  root.style.setProperty('--sc-layout-ai-width', `${layout.ai.width}px`);
  root.style.setProperty('--sc-layout-measure', `${layout.content.measure}px`);
  root.dataset.scDensity = layout.density;
}

/** 当前实际主题（localStorage `septcats.theme`；无存储 = 'system'，与 ThemeProvider 口径一致）。 */
export function currentThemeMode(): LayoutTheme {
  const raw = safeGetItem(THEME_STORAGE_KEY);
  return isOneOf(raw, THEMES) ? raw : 'system';
}

// ---------------------------------------------------------------------------
// store 与 actions
// ---------------------------------------------------------------------------

export interface LayoutStoreState {
  layout: LayoutState;
}

export const layoutStore = createStore<LayoutStoreState>({ layout: makeDefaultLayout() });

export function useLayout<T>(selector: (state: LayoutStoreState) => T): T {
  return useStore(layoutStore, selector);
}

/**
 * T61-01 §2：视口宽订阅（拖拽上限 / 编辑器页滑杆值域随窗口变化）。
 * 初始值 = `currentViewportWidth()`（首帧即有确定值，无 0 宽窗口）；resize 时重取。
 * 消费方只把它当「上限计算的一个输入」，不做布局量测。
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => currentViewportWidth());
  useEffect(() => {
    const onResize = (): void => {
      setWidth(currentViewportWidth());
    };
    globalThis.addEventListener?.('resize', onResize);
    return () => {
      globalThis.removeEventListener?.('resize', onResize);
    };
  }, []);
  return width;
}

/**
 * T61-01 §2：两侧宽度的**唯一夹紧闸**——任何落盘/注入路径（含预设整份套用、恢复默认）
 * 都过这里，保证「≤ 视口 30%」口径恒成立（预设常量与导入的越界值在此收口）。
 * 无变化时返回原对象（引用相等 → 不触发订阅者）。
 */
function normalizeLayout(layout: LayoutState): LayoutState {
  const sidebarWidth = clampSidebarWidth(layout.sidebar.width);
  const aiWidth = clampAiWidth(layout.ai.width);
  if (sidebarWidth === layout.sidebar.width && aiWidth === layout.ai.width) {
    return layout;
  }
  return {
    ...layout,
    sidebar: { ...layout.sidebar, width: sidebarWidth },
    ai: { ...layout.ai, width: aiWidth },
  };
}

function commit(layout: LayoutState): void {
  const next = normalizeLayout(layout);
  writeLayout(next);
  applyLayoutToRoot(next);
  layoutStore.setState((state) => (state.layout === next ? state : { ...state, layout: next }));
}

function patchLayout(patch: (layout: LayoutState) => LayoutState): void {
  commit(patch(layoutStore.getState().layout));
}

/**
 * T39-01-1：布局整份套用（预设切换/导入）后，AI 面板可见性**即时生效**
 * （TASK-T39-01 §1.1）——与侧栏/measure 的 CSS 变量注入同批；不写面板手动记录
 * （见 aiChatActions.applyLayoutVisibility），T38 启动口径不变。
 */
function syncAiPanelVisibility(layout: LayoutState): void {
  aiChatActions.applyLayoutVisibility(layout.ai.expanded, layout.ai.position === 'hidden');
}

export const layoutActions = {
  /** App 挂载时调一次：读存储（损坏回退默认）+ 注入根节点变量。 */
  init(): void {
    commit(readLayout());
  },
  /** 切预设：整份套用预设参数（即时生效 + 持久化）；主题保持当前值。 */
  applyPreset(id: LayoutPresetId): void {
    const theme = layoutStore.getState().layout.theme;
    const layout = { ...LAYOUT_PRESETS[id], theme };
    commit(layout);
    syncAiPanelVisibility(layout);
  },
  /** T57-01：恢复默认（notion 参数 + 保留当前主题）——编辑器页顶部「恢复默认」。 */
  resetLayout(): void {
    const layout = defaultLayoutWithTheme(layoutStore.getState().layout.theme);
    commit(layout);
    syncAiPanelVisibility(layout);
  },
  setSidebarPosition(position: SidebarPosition): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', sidebar: { ...layout.sidebar, position } }));
  },
  setSidebarWidth(width: number): void {
    patchLayout((layout) => ({
      ...layout,
      preset: 'custom',
      sidebar: { ...layout.sidebar, width: clampSidebarWidth(width) },
    }));
  },
  setMeasure(measure: number): void {
    patchLayout((layout) => ({
      ...layout,
      preset: 'custom',
      content: { measure: clampMeasure(measure) },
    }));
  },
  setAiPosition(position: AiPanelPosition): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', ai: { ...layout.ai, position } }));
  },
  setAiExpanded(expanded: boolean): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', ai: { ...layout.ai, expanded } }));
  },
  /**
   * T61-01 §2：AI 面板宽度（右侧栏布局）。与 `setSidebarWidth` 同一真源
   * （patchLayout → 注入根变量 + 持久化），拖拽把手与编辑器页滑杆共用这一处入口。
   */
  setAiWidth(width: number): void {
    patchLayout((layout) => ({
      ...layout,
      preset: 'custom',
      ai: { ...layout.ai, width: clampAiWidth(width) },
    }));
  },
  setTabsVisible(visible: boolean): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', tabsVisible: visible }));
  },
  setDensity(density: LayoutDensity): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', density }));
  },
  /**
   * T61-01 §2：按**当前视口**重新夹紧两侧宽度（窗口变窄时兑现「≤ 30%」）。
   * 无变化时零副作用（不写盘、不通知订阅者）；App 挂 resize 监听调用。
   */
  reclampToViewport(): void {
    const layout = layoutStore.getState().layout;
    const next = normalizeLayout(layout);
    if (next !== layout) {
      commit(next);
    }
  },
  /** 布局快照内的主题字段（主题应用本身走 setGlobalThemeMode，调用方负责）。 */
  setTheme(theme: LayoutTheme): void {
    patchLayout((layout) => ({ ...layout, theme }));
  },
  /** 导出 JSON（theme 字段同步当前实际主题，保证往返逐字段等价）。 */
  exportJson(): string {
    const layout = { ...layoutStore.getState().layout, theme: currentThemeMode() };
    return JSON.stringify(layout);
  },
  /**
   * 从文本导入：非法 JSON/结构不符 → 可读错误（reason），当前布局不动；
   * 合法 → 应用（含主题经 setGlobalThemeMode，Provider 管道写 localStorage）+ 持久化。
   */
  importFromText(text: string): { ok: true } | { ok: false; reason: LayoutImportFailure } {
    const result = parseLayoutImport(text);
    if (!result.ok) {
      return result;
    }
    const layout = result.layout;
    // 主题经既有机制应用（setGlobalThemeMode → ThemeProvider 管道写 localStorage；
    // Provider 未挂载时 theme.tsx 有缓冲兜底），不直写其真相源键
    setGlobalThemeMode(layout.theme);
    commit(layout);
    // T39-01-1：导入与预设同属「整份套用」路径，AI 面板可见性同批即时生效
    syncAiPanelVisibility(layout);
    return { ok: true };
  },
};
