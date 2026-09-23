/**
 * state.ts —— 工作台（home）slice：视图开关 + 卡片配置的纯 reducer 与持久化
 * （TASK-T66-01 §1.1/§1.4）。
 *
 * - 单一 store（store.ts 的零依赖 Zustand 同形实现，与 state/pages.ts 同口径）；
 *   App 视图态 `view === 'home'` 由本 slice 持有，**不动 pagesStore/tabs 语义**。
 * - 持久化（§1.1/§1.4）：
 *   - `septcats.workbenchOpen`：'1'/'0'——启动时若在=先落 pages 视图并 toast 提示（防呆：
 *     home 不是死路），语义由 App 侧接线（本模块只管读写字符串）。
 *   - `septcats.workbench.cards`：`{ v: 1, order: CardId[], hidden: CardId[] }`——
 *     卡序 + 隐藏集；野 JSON/版本不符/未知 id/重复 id 一律回退默认（§2.2 单测钉）。
 * - localStorage 不可用（Node 测试环境/隐私模式）时静默降级为仅会话内生效。
 * - 纯函数 + 守卫读写分离，可独立单测（reducer 行为测试不需要 DOM）。
 */
import { createStore, useStore } from '../state/store';

export type WorkbenchView = 'pages' | 'home';

/**
 * 卡片 id 全集（T71-01：注册表驱动；5 内置 + 6 新原子卡）。
 * 默认序 = 此声明序（内置在前、新卡在尾，语义 = v1→v2 迁移「新卡追加默认位」）。
 * 配置读写对未知 id 做丢弃防御；注册表定义见 `workbench/cards.tsx`。
 */
export const BUILTIN_CARD_IDS = ['quick', 'todo', 'database', 'recent', 'favorites'] as const;
export const NEW_CARD_IDS = ['shortcut', 'countdown', 'heatmap', 'quote', 'bookmarks', 'libstats'] as const;
export const ALL_CARD_IDS = [...BUILTIN_CARD_IDS, ...NEW_CARD_IDS] as const;
/** 历史别名（T66 口径：原「5 硬编码卡」；现扩为注册表全集，保留导出避免误伤外部引用）。 */
export const WORKBENCH_CARD_IDS = ALL_CARD_IDS;
export type WorkbenchCardId = (typeof ALL_CARD_IDS)[number];

export const DEFAULT_CARD_ORDER: readonly WorkbenchCardId[] = [...ALL_CARD_IDS];
export const DEFAULT_HIDDEN_CARD_IDS: readonly WorkbenchCardId[] = [];

export const WORKBENCH_OPEN_STORAGE_KEY = 'septcats.workbenchOpen';
export const WORKBENCH_CARDS_STORAGE_KEY = 'septcats.workbench.cards';
/** v1（T66）= {v:1,order,hidden}；v2（T71）= {v:2,order,hidden,sizes?}（sizes 可选）。 */
export const WORKBENCH_CARDS_PERSIST_VERSION = 2;
export const WORKBENCH_CARDS_LEGACY_V1 = 1;

/** 数据库卡列表上限（§1.3「列表上限 12 行 + 查看全部」）。 */
export const DB_CARD_LIMIT = 12;
/** 最近卡条数上限（§1.3 前 8）。 */
export const RECENT_CARD_LIMIT = 8;

export type CardSize = 'sm' | 'md' | 'lg';

export interface WorkbenchCardsPersist {
  v: 2;
  order: WorkbenchCardId[];
  hidden: WorkbenchCardId[];
  /** 可选：每卡尺寸档（T71 v2 扩展；缺省 = 注册表 defaultSize）。 */
  sizes?: Partial<Record<WorkbenchCardId, CardSize>>;
}

export interface WorkbenchState {
  view: WorkbenchView;
  /** 卡序（可见+隐藏都在序里，渲染层按 hidden 过滤）。 */
  cardOrder: WorkbenchCardId[];
  hiddenCards: WorkbenchCardId[];
}

const initialState: WorkbenchState = {
  view: 'pages',
  cardOrder: [...DEFAULT_CARD_ORDER],
  hiddenCards: [...DEFAULT_HIDDEN_CARD_IDS],
};

export const workbenchStore = createStore<WorkbenchState>(initialState);

/** 选择器订阅（选择器请返回引用稳定的切片；数组切片在 setState 时整体替换，引用稳定）。 */
export function useWorkbench<T>(selector: (state: WorkbenchState) => T): T {
  return useStore(workbenchStore, selector);
}

// ---------------------------------------------------------------------------
// 纯 reducer（可独立单测；store actions 只是薄封装）
// ---------------------------------------------------------------------------

export function openHome(state: WorkbenchState): WorkbenchState {
  return state.view === 'home' ? state : { ...state, view: 'home' };
}

export function closeHome(state: WorkbenchState): WorkbenchState {
  return state.view === 'pages' ? state : { ...state, view: 'pages' };
}

/** 纯函数：toggle 当前视图。 */
export function toggleWorkbenchView(state: WorkbenchState): WorkbenchState {
  return state.view === 'home' ? closeHome(state) : openHome(state);
}

function isCardId(value: unknown): value is WorkbenchCardId {
  return (
    typeof value === 'string' &&
    (ALL_CARD_IDS as readonly string[]).includes(value)
  );
}

/**
 * 纯函数：⋯ 菜单「上移/下移」——只在**可见卡**之间换位（隐藏卡保持其在序中的
 * 相对位置不动，语义 = 用户看到的是紧凑列表）。越界（第一/最后）返回同引用。
 */
export function moveCardInOrder(
  order: readonly WorkbenchCardId[],
  hidden: readonly WorkbenchCardId[],
  id: WorkbenchCardId,
  delta: -1 | 1,
): WorkbenchCardId[] | null {
  const next = [...order];
  const visible = next.filter((item) => !hidden.includes(item));
  const pos = visible.indexOf(id);
  if (pos === -1) {
    return null;
  }
  const target = pos + delta;
  if (target < 0 || target >= visible.length) {
    return null;
  }
  const swapped = [...visible];
  const tmp = swapped[pos] as WorkbenchCardId;
  swapped[pos] = swapped[target] as WorkbenchCardId;
  swapped[target] = tmp;
  // 把新可见序回填到原 order 的「可见槽位」上（隐藏项原位不动）
  let cursor = 0;
  for (let index = 0; index < next.length; index += 1) {
    if (!hidden.includes(next[index] as WorkbenchCardId)) {
      next[index] = swapped[cursor] as WorkbenchCardId;
      cursor += 1;
    }
  }
  return next;
}

/** 纯函数：显示/隐藏翻转（野配置防御：不在序里的卡 → null，调用方不改状态）。 */
export function toggleCardHidden(
  order: readonly WorkbenchCardId[],
  hidden: readonly WorkbenchCardId[],
  id: WorkbenchCardId,
): { order: WorkbenchCardId[]; hidden: WorkbenchCardId[] } | null {
  if (!order.includes(id)) {
    return null;
  }
  if (!hidden.includes(id)) {
    return { order: [...order], hidden: [...hidden, id] };
  }
  return { order: [...order], hidden: hidden.filter((item) => item !== id) };
}

/** 纯函数：恢复默认卡配置。 */
export function resetCards(): { cardOrder: WorkbenchCardId[]; hiddenCards: WorkbenchCardId[] } {
  return { cardOrder: [...DEFAULT_CARD_ORDER], hiddenCards: [...DEFAULT_HIDDEN_CARD_IDS] };
}

/**
 * 纯函数：自定义模式拖拽重排（T71-01 §3）——把 `from` 移到 `to` 在 **全序** 中的位置
 * （隐藏卡一并参与位置计算，保持相对序不变）。同引用（from/to 相同/其一不在序）返回 null。
 */
export function moveCardTo(
  order: readonly WorkbenchCardId[],
  from: WorkbenchCardId,
  to: WorkbenchCardId,
): WorkbenchCardId[] | null {
  if (from === to || !order.includes(from) || !order.includes(to)) {
    return null;
  }
  const next = order.filter((item) => item !== from);
  const targetIndex = next.indexOf(to);
  if (targetIndex === -1) {
    return null;
  }
  next.splice(targetIndex, 0, from);
  return next;
}

/**
 * 纯函数：从任意野 JSON 规整出卡配置（§2.2「野 JSON→默认」）：
 * - 非对象/数组/版本不符（≠1 且 ≠2）→ null（调用方走默认）；
 * - 接受 v1（T66）与 v2（T71）；v1 读到即按 v2 语义规整（order 保序 + 新卡补尾）；
 * - order：过滤未知 id + 去重，缺失的已知 id 按默认序**补到尾部**（v1→v2 迁移：
 *   原 5 卡序保持、6 新卡追加默认位置）；
 * - hidden：过滤未知 id + 去重 + 只留 order 里存在的；
 * - sizes：v2 携带的可选尺寸档，过滤未知 id 后原样保留（缺省 = 注册表 defaultSize）。
 * 返回一律为 v:2（写入即落 v2，单向前向兼容）。
 */
export function sanitizeCardsPersist(parsed: unknown): WorkbenchCardsPersist | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as {
    v?: unknown;
    order?: unknown;
    hidden?: unknown;
    sizes?: unknown;
  };
  if (record.v !== WORKBENCH_CARDS_LEGACY_V1 && record.v !== WORKBENCH_CARDS_PERSIST_VERSION) {
    return null;
  }
  if (!Array.isArray(record.order) || !Array.isArray(record.hidden)) {
    return null;
  }
  const seenOrder = new Set<WorkbenchCardId>();
  const order: WorkbenchCardId[] = [];
  for (const item of record.order) {
    if (isCardId(item) && !seenOrder.has(item)) {
      seenOrder.add(item);
      order.push(item);
    }
  }
  // 缺失的已知 id 按默认序补尾（v1→v2 迁移：新卡追加默认位置）
  for (const id of DEFAULT_CARD_ORDER) {
    if (!seenOrder.has(id)) {
      order.push(id);
      seenOrder.add(id);
    }
  }
  const seenHidden = new Set<WorkbenchCardId>();
  const hidden: WorkbenchCardId[] = [];
  for (const item of record.hidden) {
    if (isCardId(item) && seenOrder.has(item) && !seenHidden.has(item)) {
      seenHidden.add(item);
      hidden.push(item);
    }
  }
  // sizes：v2 可选；只保留合法 id + 合法档位
  let sizes: WorkbenchCardsPersist['sizes'] | undefined;
  if (typeof record.sizes === 'object' && record.sizes !== null && !Array.isArray(record.sizes)) {
    const rawSizes = record.sizes as Record<string, unknown>;
    const next: Record<string, CardSize> = {};
    for (const id of ALL_CARD_IDS) {
      const value = rawSizes[id];
      if (value === 'sm' || value === 'md' || value === 'lg') {
        next[id] = value;
      }
    }
    if (Object.keys(next).length > 0) {
      sizes = next;
    }
  }
  return { v: WORKBENCH_CARDS_PERSIST_VERSION, order, hidden, ...(sizes === undefined ? {} : { sizes }) };
}

// ---------------------------------------------------------------------------
// localStorage 读写（全部守卫：不可用 → null / 静默；与 state/tabs.ts 同范式）
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

/** 读持久化卡配置；无记录/损坏/野 JSON/版本不符 → null。 */
export function readCardsPersist(): WorkbenchCardsPersist | null {
  const raw = safeGetItem(WORKBENCH_CARDS_STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  try {
    return sanitizeCardsPersist(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCardsPersist(
  cardOrder: readonly WorkbenchCardId[],
  hiddenCards: readonly WorkbenchCardId[],
  sizes?: WorkbenchCardsPersist['sizes'],
): void {
  const persist: WorkbenchCardsPersist = {
    v: WORKBENCH_CARDS_PERSIST_VERSION,
    order: [...cardOrder],
    hidden: [...hiddenCards],
    ...(sizes === undefined ? {} : { sizes }),
  };
  safeSetItem(WORKBENCH_CARDS_STORAGE_KEY, JSON.stringify(persist));
}

/** 读持久化的 home 开合标记（'1' = 上次退出时在 home）。 */
export function readWorkbenchOpenFlag(): boolean {
  return safeGetItem(WORKBENCH_OPEN_STORAGE_KEY) === '1';
}

function writeWorkbenchOpenFlag(open: boolean): void {
  safeSetItem(WORKBENCH_OPEN_STORAGE_KEY, open ? '1' : '0');
}

// ---------------------------------------------------------------------------
// actions（store 封装 + 写盘副作用）
// ---------------------------------------------------------------------------

export const workbenchActions = {
  /** 挂载对账（App 只调一次）：读卡配置；若上次退出在 home → 落 pages 并回报 true
   *（App 据此 toast「工作台已恢复为编辑视图」——防呆口径 §1.1，home 不是死路）。 */
  init(): { restoredFromHome: boolean } {
    const persist = readCardsPersist();
    if (persist !== null) {
      workbenchStore.setState((state) => ({
        ...state,
        cardOrder: persist.order,
        hiddenCards: persist.hidden,
      }));
    }
    const wasOpen = readWorkbenchOpenFlag();
    writeWorkbenchOpenFlag(false);
    return { restoredFromHome: wasOpen };
  },

  openHome(): void {
    workbenchStore.setState((state) => openHome(state));
    writeWorkbenchOpenFlag(workbenchStore.getState().view === 'home');
  },

  closeHome(): void {
    workbenchStore.setState((state) => closeHome(state));
    writeWorkbenchOpenFlag(false);
  },

  /** Alt+H / 顶栏房子钮：开合双向。 */
  toggle(): void {
    workbenchStore.setState((state) => toggleWorkbenchView(state));
    writeWorkbenchOpenFlag(workbenchStore.getState().view === 'home');
  },

  setCardHidden(id: WorkbenchCardId, hidden: boolean): void {
    workbenchStore.setState((state) => {
      const isHidden = state.hiddenCards.includes(id);
      if (isHidden === hidden || (!hidden && !state.cardOrder.includes(id))) {
        return state;
      }
      const next = toggleCardHidden(state.cardOrder, state.hiddenCards, id);
      if (next === null) {
        return state;
      }
      writeCardsPersist(next.order, next.hidden);
      return { ...state, cardOrder: next.order, hiddenCards: next.hidden };
    });
  },

  moveCard(id: WorkbenchCardId, delta: -1 | 1): void {
    workbenchStore.setState((state) => {
      const next = moveCardInOrder(state.cardOrder, state.hiddenCards, id, delta);
      if (next === null) {
        return state;
      }
      writeCardsPersist(next, state.hiddenCards);
      return { ...state, cardOrder: next };
    });
  },

  /** 自定义模式拖拽重排（T71-01 §3）：把 from 拖到 to 位置，即时写 v2。 */
  reorderCard(from: WorkbenchCardId, to: WorkbenchCardId): void {
    workbenchStore.setState((state) => {
      const next = moveCardTo(state.cardOrder, from, to);
      if (next === null) {
        return state;
      }
      writeCardsPersist(next, state.hiddenCards);
      return { ...state, cardOrder: next };
    });
  },

  /** 直接整序写入（自定义模式落盘用；非法序防御：未知 id 丢弃 + 去重 + 补尾）。 */
  setCardOrder(order: readonly WorkbenchCardId[]): void {
    workbenchStore.setState((state) => {
      const sanitized = sanitizeCardsPersist({ v: WORKBENCH_CARDS_PERSIST_VERSION, order: [...order], hidden: state.hiddenCards });
      if (sanitized === null) {
        return state;
      }
      writeCardsPersist(sanitized.order, state.hiddenCards);
      return { ...state, cardOrder: sanitized.order };
    });
  },

  resetCards(): void {
    const { cardOrder, hiddenCards } = resetCards();
    workbenchStore.setState((state) => ({ ...state, cardOrder, hiddenCards }));
    writeCardsPersist(cardOrder, hiddenCards);
  },
};
