/*
 * paletteState.ts —— 主题画廊·配色派系状态（TASK-T65-01 §1.1/§1.3）。
 *
 * 两层模型：明暗基底（light/dark/system，既有主题机制，不动）× 配色派系
 * （palette：mono/oled/contrast/paper/slate/moss，本模块）。palette 真相源 =
 * localStorage `septcats.palette`（**旁路**存储，不扩 LayoutState 类型——与 T64/
 * 布局编辑器搅面隔离，任务书 §1.3）；读写走 layoutState 同款 safe 范式
 * （不可用/野值 → 回退 mono，绝不 throw）。
 *
 * 生效路径：setPalette → store + localStorage + documentElement[data-palette]
 * （属性挂点与 [data-theme] 同元素——ThemeProvider 只管 data-theme，palette 由
 * 本模块自管属性，加载的 packages/ui/src/themes.css 按 [data-theme][data-palette]
 * 组合选择器覆写中性 token）。启动（App 挂载 effect）读存储并挂属性。
 *
 * oled 约束（§1.1）：仅 dark 基底生效。light 基底**不剔除**已存值（任务书给了
 * 「置灰不可选或按 mono 渲染」二选一，画廊 UI 走「置灰 + 按 mono 渲染」，见下）。
 */
import { useEffect } from 'react';
import { createStore, useStore } from '../state/store';
import { APPEARANCE_STAMP_KEY } from './lookState';

/** 派系 id（mono = tokens.css 现状默认，无覆写块）。 */
export const PALETTE_IDS = ['mono', 'oled', 'contrast', 'paper', 'slate', 'moss', 'instrument'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

/** 新装/未设置时的默认配色（instrument = 老板 10-01 选定方向 B 的中性平面族）。 */
export const DEFAULT_PALETTE: PaletteId = 'instrument';

/** localStorage 键（旁路，与 septcats.theme / septcats.layout 并列）。 */
export const PALETTE_STORAGE_KEY = 'septcats.palette';

/** 派系合法性兜底（§2 单测 a：野值 → mono）。 */
export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value);
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

/** 旧默认配色（迁移判据；口径同 lookState.readLook）。 */
export const LEGACY_DEFAULT_PALETTE: PaletteId = 'mono';

/** 读存储；首次运行本版本时：旧默认/未设置 → 升级为新默认，显式选过的别的档保留；都盖章。 */
export function readPalette(): PaletteId {
  const raw = safeGetItem(PALETTE_STORAGE_KEY);
  if (safeGetItem(APPEARANCE_STAMP_KEY) !== '1') {
    safeSetItem(APPEARANCE_STAMP_KEY, '1');
    const adopt = !isPaletteId(raw) || raw === LEGACY_DEFAULT_PALETTE;
    if (adopt) {
      safeSetItem(PALETTE_STORAGE_KEY, DEFAULT_PALETTE);
      return DEFAULT_PALETTE;
    }
    return raw as PaletteId;
  }
  return isPaletteId(raw) ? raw : DEFAULT_PALETTE;
}

/** 把 palette 挂到根元素（'mono' 也显式挂——画廊选中态与 CSS 属性一致，便于探针）。 */
export function applyPaletteToRoot(palette: PaletteId): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.palette = palette;
}

export interface PaletteStoreState {
  palette: PaletteId;
}

export const paletteStore = createStore<PaletteStoreState>({ palette: DEFAULT_PALETTE });

export function usePaletteState<T>(selector: (state: PaletteStoreState) => T): T {
  return useStore(paletteStore, selector);
}

export const paletteActions = {
  /** App 挂载时调一次：读存储（野值回退 mono）+ 挂根属性（§1.3 启动读取）。 */
  init(): void {
    const palette = readPalette();
    paletteStore.setState(() => ({ palette }));
    applyPaletteToRoot(palette);
  },
  /** 切派系：store + 持久化 + 根属性，一步到位（画廊实时预览 = 即时应用）。 */
  setPalette(id: PaletteId): void {
    if (!isPaletteId(id)) {
      return; // 双保险：类型口已限 PaletteId，运行时野值静默拒
    }
    paletteStore.setState(() => ({ palette: id }));
    safeSetItem(PALETTE_STORAGE_KEY, id);
    applyPaletteToRoot(id);
  },
};

/**
 * 订阅 palette（组件内响应式切片）。selector 返回原始值，引用稳定约束满足。
 */
export function usePaletteId(): PaletteId {
  return usePaletteState((state) => state.palette);
}

/**
 * 明暗基底联动（§1.1：oled 仅 dark 生效）。resolved = ThemeProvider 的当前实际
 * 基底；palette 在 light 基底下的**渲染口径**：oled → 'mono'（themes.css 无
 * light/oled 块，属性挂着也按 mono 渲染——本函数给 UI 层同一口径的判定）。
 */
export function effectivePalette(palette: PaletteId, resolvedTheme: 'light' | 'dark'): PaletteId {
  return palette === 'oled' && resolvedTheme === 'light' ? 'mono' : palette;
}

/** oled 在当前基底是否禁用（画廊卡置灰用）。 */
export function isPaletteDisabled(palette: PaletteId, resolvedTheme: 'light' | 'dark'): boolean {
  return palette === 'oled' && resolvedTheme !== 'dark';
}



/** 主题基底变化时的联动效果（light 下 oled 属性保留但渲染按 mono；无需清属性）。 */
export function usePaletteThemeSync(resolvedTheme: 'light' | 'dark'): void {
  const palette = usePaletteId();
  useEffect(() => {
    // 属性保持 = 持久化值（重启后基底变 dark 即恢复观感，无数据丢失）；
    // 这里只在基底变化时**重新落一次属性**，防御 ThemeProvider 重挂载窗口擦挂。
    applyPaletteToRoot(palette);
  }, [resolvedTheme, palette]);
}
