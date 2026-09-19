/**
 * chatState.ts —— AI 对话侧栏的消息状态与持久化（TASK-T38-01 §0.1/§0.4）。
 *
 * - 历史按 workspace 隔离持久化：localStorage 键 `septcats.aichat.history.<ws>`，
 *   与 `septcats.tabs.<ws>` 同范式（版本化 + safeGet/safeSet + 损坏静默降级）；
 *   上限 200 条，超出丢最旧；**不进账本**（本机 UI 状态，非笔记内容）。
 * - 面板开合状态全局持久化：`septcats.aichat.panel`（收起 → 重启 → 仍收起，§1.5）。
 * - 隐私：这里只存消息文本与引用元数据；密钥只进 CredentialStore（main 侧），
 *   绝不经过本模块；日志不打印消息正文（renderer 侧根本不打消息日志）。
 * - 纯函数 + 极简 store（state/store.ts 同款 Zustand 同形实现），可独立单测。
 */
import { ulid } from '@septcats/core';
import type { AiMessage } from '../../../shared/ai';
import { createStore, useStore } from '../state/store';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 引用出处（「页名 › 块锚点」）：n = 上下文块清单编号，blockId 可点击跳转。 */
export interface ChatRef {
  n: number;
  pageId: string;
  pageTitle: string;
  blockId: string;
}

/** 单条对话消息（历史持久化形状；role 只收 user/assistant，system 每轮现装配）。 */
export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** assistant 消息的引用出处（send 时由 resolveCitations 产出）。 */
  refs?: ChatRef[];
  /** 被用户停止的轮次标记（仅展示口径；停止轮不落 assistant 回复）。 */
  stopped?: boolean;
}

export interface ChatHistoryPersist {
  v: 1;
  messages: ChatMsg[];
}

// ---------------------------------------------------------------------------
// 纯函数与 localStorage 读写（全部守卫：不可用 → null / 静默）
// ---------------------------------------------------------------------------

export const CHAT_HISTORY_PREFIX = 'septcats.aichat.history.';
export const CHAT_HISTORY_VERSION = 1;
/** §0.4：历史上限（建议 200，超出丢最旧）。 */
export const CHAT_HISTORY_LIMIT = 200;
export const PANEL_OPEN_KEY = 'septcats.aichat.panel';

export function chatHistoryKey(workspaceId: string): string {
  return CHAT_HISTORY_PREFIX + workspaceId;
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

function safeRemoveItem(key: string): void {
  try {
    const storage = (globalThis as { localStorage?: Storage }).localStorage;
    storage?.removeItem(key);
  } catch {
    // 不可用即静默
  }
}

function isChatRefArray(value: unknown): value is ChatRef[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as ChatRef).n === 'number' &&
        typeof (item as ChatRef).pageId === 'string' &&
        typeof (item as ChatRef).pageTitle === 'string' &&
        typeof (item as ChatRef).blockId === 'string',
    )
  );
}

function isChatMsg(value: unknown): value is ChatMsg {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Partial<ChatMsg>;
  return (
    (msg.role === 'user' || msg.role === 'assistant') &&
    typeof msg.content === 'string' &&
    typeof msg.ts === 'number' &&
    (msg.refs === undefined || isChatRefArray(msg.refs))
  );
}

/** 读取某工作区的对话历史；无记录/损坏/版本不符 → null。逐条校验，坏条目剔除。 */
export function readChatHistory(workspaceId: string): ChatMsg[] | null {
  const raw = safeGetItem(chatHistoryKey(workspaceId));
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === CHAT_HISTORY_VERSION &&
      Array.isArray((parsed as { messages?: unknown }).messages)
    ) {
      const messages = (parsed as { messages: unknown[] }).messages.filter(isChatMsg);
      return messages;
    }
    return null;
  } catch {
    return null;
  }
}

/** 写某工作区的历史快照（workspaceId=null 不写——无工作区无归属键）。 */
export function writeChatHistory(workspaceId: string | null, messages: readonly ChatMsg[]): void {
  if (workspaceId === null) {
    return;
  }
  const payload: ChatHistoryPersist = { v: CHAT_HISTORY_VERSION, messages: [...messages] };
  safeSetItem(chatHistoryKey(workspaceId), JSON.stringify(payload));
}

export function clearChatHistoryStorage(workspaceId: string | null): void {
  if (workspaceId !== null) {
    safeRemoveItem(chatHistoryKey(workspaceId));
  }
}

/** 面板开合的**手动记录**（无记录 → null，供布局「默认展开」接管）。 */
export function readStoredPanelOpen(): boolean | null {
  const raw = safeGetItem(PANEL_OPEN_KEY);
  if (raw === '1') {
    return true;
  }
  if (raw === '0') {
    return false;
  }
  return null;
}

/** 面板开合状态（全局，非按 ws）：损坏/缺失 → false（收起）。 */
export function readPanelOpen(): boolean {
  return readStoredPanelOpen() ?? false;
}

export function writePanelOpen(open: boolean): void {
  safeSetItem(PANEL_OPEN_KEY, open ? '1' : '0');
}

/** 追加消息并按上限丢最旧（纯函数；原数组不变）。 */
export function appendMessages(
  messages: readonly ChatMsg[],
  additions: readonly ChatMsg[],
  limit: number = CHAT_HISTORY_LIMIT,
): ChatMsg[] {
  const next = [...messages, ...additions];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** ChatMsg[] → 请求侧 AiMessage[]（只留 role/content，保序）。 */
export function toApiMessages(messages: readonly ChatMsg[]): AiMessage[] {
  return messages.map((msg) => ({ role: msg.role, content: msg.content }));
}

export function makeChatMsg(role: ChatMsg['role'], content: string, ts: number, refs?: ChatRef[]): ChatMsg {
  const msg: ChatMsg = { id: ulid(), role, content, ts };
  if (refs !== undefined && refs.length > 0) {
    msg.refs = refs;
  }
  return msg;
}

// ---------------------------------------------------------------------------
// store 与 actions
// ---------------------------------------------------------------------------

export interface AiChatState {
  /** 面板开合（持久化全局）。 */
  open: boolean;
  /** 当前历史归属的 workspace（null = 未就绪，不读写历史）。 */
  workspaceId: string | null;
  messages: ChatMsg[];
}

export const aiChatStore = createStore<AiChatState>({
  open: false,
  workspaceId: null,
  messages: [],
});

/** 选择器订阅（选择器请返回引用稳定的切片）。 */
export function useAiChat<T>(selector: (state: AiChatState) => T): T {
  return useStore(aiChatStore, selector);
}

export const aiChatActions = {
  /**
   * App 挂载时调一次：恢复面板开合。有手动记录（含显式收起 '0'）以记录为准；
   * 无记录时以 `defaultExpanded`（T39-01 布局「AI 面板默认展开」）为准，缺省 false。
   */
  initPanel(defaultExpanded: boolean = false): void {
    const open = readStoredPanelOpen() ?? defaultExpanded;
    aiChatStore.setState((state) => (state.open === open ? state : { ...state, open }));
  },
  setOpen(open: boolean): void {
    writePanelOpen(open);
    aiChatStore.setState((state) => (state.open === open ? state : { ...state, open }));
  },
  togglePanel(): void {
    aiChatActions.setOpen(!aiChatStore.getState().open);
  },
  /**
   * T39-01-1：布局整份套用（预设切换/导入）时按 `ai.expanded` + `ai.position` 即时接管
   * 面板开合（TASK-T39-01 §1.1「预设切换即时生效」）：expanded 且 position≠hidden →
   * 展开，否则收起（hidden 恒收起，与启动接管语义一致）。
   * 与 setOpen 的差别：**不写** `septcats.aichat.panel` 手动记录——该记录只由用户显式
   * 开合产生，T38 启动口径「有手动记录以记录为准」不被预设切换改写。
   */
  applyLayoutVisibility(expanded: boolean, positionHidden: boolean): void {
    const open = expanded && !positionHidden;
    aiChatStore.setState((state) => (state.open === open ? state : { ...state, open }));
  },
  /** workspace 切换/就绪时调：装载该 ws 的历史（无记录 → 空历史）。 */
  setWorkspace(workspaceId: string | null): void {
    aiChatStore.setState((state) => {
      if (state.workspaceId === workspaceId) {
        return state;
      }
      const messages = workspaceId === null ? [] : (readChatHistory(workspaceId) ?? []);
      return { ...state, workspaceId, messages };
    });
  },
  /** 追加消息（持久化到当前 ws；无 ws 仅会话内生效）。 */
  appendMessages(additions: readonly ChatMsg[]): void {
    aiChatStore.setState((state) => {
      const messages = appendMessages(state.messages, additions);
      writeChatHistory(state.workspaceId, messages);
      return { ...state, messages };
    });
  },
  /** 清空当前 ws 历史（清空按钮；存储同步清）。 */
  clearMessages(): void {
    aiChatStore.setState((state) => {
      clearChatHistoryStorage(state.workspaceId);
      if (state.messages.length === 0) {
        return state;
      }
      return { ...state, messages: [] };
    });
  },
};
