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

/** 卡片 id（默认序即此声明序；新增卡只追加，配置读写对未知 id 做丢弃防御）。 */
export const WORKBENCH_CARD_IDS = ['quick', 'todo', 'database', 'recent', 'favorites'] as const;
export type WorkbenchCardId = (typeof WORKBENCH_CARD_IDS)[number];

export const DEFAULT_CARD_ORDER: readonly WorkbenchCardId[] = [...WORKBENCH_CARD_IDS];
export const DEFAULT_HIDDEN_CARD_IDS: readonly WorkbenchCardId[] = [];

export const WORKBENCH_OPEN_STORAGE_KEY = 'septca…nOpen';
export const WORKBENCH_CARDS_STORAGE_KEY = 'septca…ards';
export const WORKBENCH_CARDS_PERSIST_VERSION = 1;

/** 数据库卡列表上限（§1.3「列表上限 12 行 + 查看全部」）。 */
export const DB_CARD_LIMIT = 12;
/** 最近卡条数上限（§1.3 前 8）。 */
export const RECENT_CARD_LIMIT = 8;

export interface WorkbenchCardsPersist {
  v: 1;
  order: WorkbenchCardId[];
  hidden: WorkbenchCardId[];
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
    (WORKBENCH_CARD_IDS as readonly string[]).includes(value)
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
 * 纯函数：从任意野 JSON 规整出卡配置（§2.2「野 JSON→默认」）：
 * - 非对象/版本不符 → null（调用方走默认）；
 * - order：过滤未知 id + 去重，缺失的已知 id 按默认序**补到尾部**（前向兼容新卡）；
 * - hidden：过滤未知 id + 去重 + 只留 order 里存在的。
 */
export function sanitizeCardsPersist(parsed: unknown): WorkbenchCardsPersist | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as { v?: unknown; order?: unknown; hidden?: unknown };
  if (record.v !== WORKBENCH_CARDS_PERSIST_VERSION) {
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
  return { v: 1, order, hidden };
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

function writeCardsPersist(cardOrder: readonly WorkbenchCardId[], hiddenCards: readonly WorkbenchCardId[]): void {
  const persist: WorkbenchCardsPersist = { v: 1, order: [...cardOrder], hidden: [...hiddenCards] };
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

  resetCards(): void {
    const { cardOrder, hiddenCards } = resetCards();
    workbenchStore.setState((state) => ({ ...state, cardOrder, hiddenCards }));
    writeCardsPersist(cardOrder, hiddenCards);
  },
};
