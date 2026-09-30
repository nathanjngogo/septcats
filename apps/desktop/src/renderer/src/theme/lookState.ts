/*
 * lookState.ts —— 主题画廊·质感派系状态（TASK-T85-01，老板 09-26 令：Linear 风 + 毛玻璃风入主题市场）。
 *
 * 三层模型：明暗基底（theme）× 配色派系（palette，paletteState）× 质感派系（look，本模块）。
 * look 真相源 = localStorage `septcats.look`（**旁路**存储，同 paletteState §1.3 口径，
 * 不扩 LayoutState / settings 类型）；读写走同款 safe 范式（不可用/野值 → 回退 pixel，绝不 throw）。
 *
 * 生效路径：setLook → store + localStorage + documentElement[data-look]，
 * packages/ui/src/looks.css 按 [data-look] 覆写质感 token（边框宽度/圆角/投影）。
 * pixel = 现状默认（tokens.css 口径）；三 look 与明暗/配色全正交，无禁用组合。
 */
import { useEffect } from 'react';
import { createStore, useStore } from '../state/store';

/** 质感派系 id（老板 10-01：**只保留**极简 / 夜航仪表 / 毛玻璃三档；像素档已下线）。 */
export const LOOK_IDS = ['instrument', 'linear', 'glass'] as const;
export type LookId = (typeof LOOK_IDS)[number];

/** 新装/未设置时的默认档（B 落地即默认，老板装完直接看到重设计）。 */
export const DEFAULT_LOOK: LookId = 'instrument';

/** localStorage 键（旁路，与 septcats.theme / septcats.palette / septcats.layout 并列）。 */
export const LOOK_STORAGE_KEY = 'septcats.look';

/** 合法性兜底（野值 → pixel）。 */
export function isLookId(value: unknown): value is LookId {
  return typeof value === 'string' && (LOOK_IDS as readonly string[]).includes(value);
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

/**
 * 外观档一次性迁移戳（look 与 palette 共用；见 readLook 头注）。
 * ⚠ 语义必须是「**首次运行本版本**才做一次」，**不是**「值等于老默认就改」——
 *   后者会把用户显式选的 pixel 也改回 instrument（真机探针实测：显式设 pixel 后
 *   data-look 仍是 instrument、pixel↔linear 像素差 0.15% ⇒ 假档、观感门全废）。
 */
export const APPEARANCE_STAMP_KEY = 'septcats.appearance.v2';

/** 旧默认档（迁移判据；已下线，只作为「该升级成新默认」的判据保留）。 */
export const LEGACY_DEFAULT_LOOK = 'pixel';

/**
 * 读存储。首次运行本版本（无戳）时：
 *   · 没存过 / 存的是**旧默认**（pixel）→ 升级为新默认（老板要看到方向 B）；
 *   · 存的是用户显式选过的别的档（linear/glass…）→ **保留**（不吃掉用户选择）；
 *   两种情况都盖章，之后一律以存储为准（野值 → 默认）。
 */
export function readLook(): LookId {
  const raw = safeGetItem(LOOK_STORAGE_KEY);
  // 与已下线档比较：先加宽成 string（pixel 已不在 LookId 联合里，直接比会触发 TS2367）
  const rawStr: string | null = raw;
  if (safeGetItem(APPEARANCE_STAMP_KEY) !== '1') {
    safeSetItem(APPEARANCE_STAMP_KEY, '1');
    const adopt = !isLookId(raw) || rawStr === LEGACY_DEFAULT_LOOK;
    if (adopt) {
      safeSetItem(LOOK_STORAGE_KEY, DEFAULT_LOOK);
      return DEFAULT_LOOK;
    }
    return raw as LookId;
  }
  return isLookId(raw) ? raw : DEFAULT_LOOK;
}

/** 把 look 挂到根元素（'pixel' 也显式挂——画廊选中态与 CSS 属性一致，便于探针）。 */
export function applyLookToRoot(look: LookId): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  // 只有「真的换了一档」才播材质成形（首屏 init 不播，避免启动时闪一下）
  const changed = root.dataset.look !== undefined && root.dataset.look !== look;
  root.dataset.look = look;
  if (changed) {
    markLookSettling(root);
  }
}

let settlingTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * T95-02「材质成形」标记（Apple §12）：换档后 450ms 内玻璃档的模糊/饱和从 0 长到目标。
 * 标记由 looks.css 的 [data-look-settling='1'] 段消费；到点自动摘除（连续换档重置计时）。
 */
export function markLookSettling(root: HTMLElement): void {
  root.dataset.lookSettling = '1';
  if (typeof setTimeout !== 'function') {
    return;
  }
  if (settlingTimer !== undefined) {
    clearTimeout(settlingTimer);
  }
  settlingTimer = setTimeout(() => {
    delete root.dataset.lookSettling;
    settlingTimer = undefined;
  }, 450);
}

export interface LookStoreState {
  look: LookId;
}

export const lookStore = createStore<LookStoreState>({ look: DEFAULT_LOOK });

export function useLookState<T>(selector: (state: LookStoreState) => T): T {
  return useStore(lookStore, selector);
}

export const lookActions = {
  /** App 挂载时调一次：读存储（野值回退 pixel）+ 挂根属性。 */
  init(): void {
    const look = readLook();
    lookStore.setState(() => ({ look }));
    applyLookToRoot(look);
  },
  /** 切质感：store + 持久化 + 根属性，一步到位（画廊实时预览 = 即时应用）。 */
  setLook(id: LookId): void {
    if (!isLookId(id)) {
      return; // 双保险：运行时野值静默拒
    }
    lookStore.setState(() => ({ look: id }));
    safeSetItem(LOOK_STORAGE_KEY, id);
    applyLookToRoot(id);
  },
};

/** 订阅 look（组件内响应式切片）。 */
export function useLookId(): LookId {
  return useLookState((state) => state.look);
}

/** 明暗基底变化时重新落一次属性（防御 ThemeProvider 重挂载窗口擦挂；同 palette 口径）。 */
export function useLookThemeSync(resolvedTheme: 'light' | 'dark'): void {
  const look = useLookId();
  useEffect(() => {
    applyLookToRoot(look);
  }, [resolvedTheme, look]);
}
