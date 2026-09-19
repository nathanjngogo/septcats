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
import { THEME_STORAGE_KEY, setGlobalThemeMode } from '@septcats/ui';
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
  ai: { position: AiPanelPosition; expanded: boolean };
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

/** §0.2 侧栏宽度夹紧区间。 */
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 320;
/** §0.2 内容 measure 夹紧区间。 */
export const MEASURE_MIN = 560;
export const MEASURE_MAX = 1000;

const SIDEBAR_POSITIONS: readonly SidebarPosition[] = ['left', 'collapsed'];
const AI_POSITIONS: readonly AiPanelPosition[] = ['right', 'bottom', 'hidden'];
const DENSITIES: readonly LayoutDensity[] = ['compact', 'comfortable'];
const THEMES: readonly LayoutTheme[] = ['light', 'dark', 'system'];
const PRESET_IDS: readonly LayoutPresetId[] = ['notion', 'focus', 'workbench'];

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
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
    ai: { position: 'right', expanded: false },
    tabsVisible: true,
    density: 'comfortable',
  },
  focus: {
    v: 1,
    preset: 'focus',
    sidebar: { position: 'collapsed', width: 240 },
    content: { measure: 900 },
    ai: { position: 'right', expanded: false },
    tabsVisible: true,
    density: 'comfortable',
  },
  workbench: {
    v: 1,
    preset: 'workbench',
    sidebar: { position: 'left', width: 240 },
    content: { measure: 650 },
    ai: { position: 'right', expanded: true },
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
    ai: { position: aiRaw.position, expanded: aiRaw.expanded },
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
 *  --sc-layout-measure = PageView.css 编辑区 max-width（回退 --sc-space-editor-measure）；
 *  data-sc-density = App.css :root 密度档位（行高/间距走 token 派生变量）。 */
export function applyLayoutToRoot(layout: LayoutState): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--sc-layout-sidebar', `${layout.sidebar.width}px`);
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

function commit(layout: LayoutState): void {
  writeLayout(layout);
  applyLayoutToRoot(layout);
  layoutStore.setState((state) => (state.layout === layout ? state : { ...state, layout }));
}

function patchLayout(patch: (layout: LayoutState) => LayoutState): void {
  commit(patch(layoutStore.getState().layout));
}

export const layoutActions = {
  /** App 挂载时调一次：读存储（损坏回退默认）+ 注入根节点变量。 */
  init(): void {
    commit(readLayout());
  },
  /** 切预设：整份套用预设参数（即时生效 + 持久化）；主题保持当前值。 */
  applyPreset(id: LayoutPresetId): void {
    const theme = layoutStore.getState().layout.theme;
    commit({ ...LAYOUT_PRESETS[id], theme });
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
  setTabsVisible(visible: boolean): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', tabsVisible: visible }));
  },
  setDensity(density: LayoutDensity): void {
    patchLayout((layout) => ({ ...layout, preset: 'custom', density }));
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
    return { ok: true };
  },
};
