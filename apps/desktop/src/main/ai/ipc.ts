/**
 * main/ai/ipc.ts —— ai:* 五通道注册（M11 · TASK-T18-01 §2.9）。
 *
 * - ai:state      → AiStateSnapshot（渲染器视图，不泄露密钥）；
 * - ai:listModels → {providerId, refresh?} → AiListModelsResult（TTL 缓存）；
 * - ai:chat       → {providerId, messages, maxTokens?, temperature?} → AiChatResult；
 * - ai:setKey     → {providerId, key} → {ok:true}（密钥只进 CredentialStore）；
 * - ai:clearKey   → {providerId} → {ok:true}；
 * - ai:setChatConfig → {requestTimeoutSec?, maxOutputTokens?} → AiChatConfigSnapshot
 *   （TASK-T46-01：超时/max_tokens 落 AI 旁路配置；读取面在 ai:state 的
 *   chatTimeoutSec / maxOutputTokens 两个字段）。
 *
 * 纯 Node（不 import electron）：与 sync/dbview 同款注册器注入范式，
 * service 缺失时统一回 E_INVARIANT。入参守卫非法 → PagesApiError('E_MALFORMED')；
 * AiError 直接透传（消息自带码），CredentialUnavailableError 原样冒泡。
 */

import { PagesApiError } from '../pages';
import type { AiMessage } from '../../shared/ai';
import {
  CHANNEL_AI_CHAT,
  CHANNEL_AI_CLEAR_KEY,
  CHANNEL_AI_LIST_MODELS,
  CHANNEL_AI_SET_CHAT_CONFIG,
  CHANNEL_AI_SET_KEY,
  CHANNEL_AI_STATE,
} from '../../shared/ipc';
import type { AiService } from './service';

/** ipcMain.handle 的最小注册面（dbViewRegistrar 同款）。 */
export interface AiIpcRegistrar {
  handle(channel: string, listener: (raw: unknown) => Promise<unknown>): void;
}

export interface AiIpcOptions {
  /** 注册器（main/index.ts 的 dbViewRegistrar()）。 */
  registrar: AiIpcRegistrar;
  /** service 访问口（恒有实现；保留 null 面与 sync 对齐）。 */
  getService: () => AiService | null;
}

/** messages 上限：1..64 条；全部 content 总长 ≤ 200_000 字符。 */
const MAX_MESSAGES = 64;
const MAX_TOTAL_CONTENT_LENGTH = 200_000;

const MESSAGE_ROLES = ['system', 'user', 'assistant'] as const;

function isMessageRole(value: string): value is AiMessage['role'] {
  return (MESSAGE_ROLES as readonly string[]).includes(value);
}

function readProviderId(raw: unknown): string {
  const id = (raw as { providerId?: unknown } | null)?.providerId;
  if (typeof id !== 'string' || id.length === 0) {
    throw new PagesApiError('E_MALFORMED', 'providerId 必须是非空字符串');
  }
  return id;
}

function readKey(raw: unknown): string {
  const key = (raw as { key?: unknown } | null)?.key;
  if (typeof key !== 'string' || key.length === 0) {
    throw new PagesApiError('E_MALFORMED', 'key 必须是非空字符串');
  }
  return key;
}

function readMessages(raw: unknown): AiMessage[] {
  const messages = (raw as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new PagesApiError('E_MALFORMED', `messages 必须是 1..${String(MAX_MESSAGES)} 条的数组`);
  }
  let totalLength = 0;
  const parsed: AiMessage[] = messages.map((item) => {
    const role = (item as { role?: unknown } | null)?.role;
    const content = (item as { content?: unknown } | null)?.content;
    if (typeof role !== 'string' || !isMessageRole(role)) {
      throw new PagesApiError('E_MALFORMED', 'message.role 必须是 system/user/assistant');
    }
    if (typeof content !== 'string') {
      throw new PagesApiError('E_MALFORMED', 'message.content 必须是字符串');
    }
    totalLength += content.length;
    return { role, content };
  });
  if (totalLength > MAX_TOTAL_CONTENT_LENGTH) {
    throw new PagesApiError(
      'E_MALFORMED',
      `messages 总长不得超过 ${String(MAX_TOTAL_CONTENT_LENGTH)} 字符`,
    );
  }
  return parsed;
}

function readOptionalNumber(raw: unknown, key: string): number | undefined {
  const value = (raw as Record<string, unknown> | null)?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是有限数字`);
  }
  return value;
}

function readOptionalRefresh(raw: unknown): boolean | undefined {
  const refresh = (raw as { refresh?: unknown } | null)?.refresh;
  if (refresh === undefined) {
    return undefined;
  }
  if (typeof refresh !== 'boolean') {
    throw new PagesApiError('E_MALFORMED', 'refresh 必须是布尔值');
  }
  return refresh;
}

/**
 * AI 对话运行时配置字段守卫（TASK-T46-01）：缺省 = 不改；`null` = 清回未设置；
 * 有限数 = 设值（越界由 store 夹紧）。其他类型 → E_MALFORMED（含字符串数字：不猜）。
 */
function readOptionalConfigNumber(raw: unknown, key: string): number | null | undefined {
  const value = (raw as Record<string, unknown> | null)?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是有限数字或 null`);
  }
  return value;
}

export function registerAiIpc(options: AiIpcOptions): void {
  const requireService = (): AiService => {
    const service = options.getService();
    if (service === null) {
      throw new PagesApiError('E_INVARIANT', 'AI 服务不可用');
    }
    return service;
  };

  options.registrar.handle(CHANNEL_AI_STATE, async () => requireService().state());

  options.registrar.handle(CHANNEL_AI_LIST_MODELS, async (raw: unknown) => {
    const refresh = readOptionalRefresh(raw);
    const input: { providerId: string; refresh?: boolean } = {
      providerId: readProviderId(raw),
    };
    if (refresh !== undefined) {
      input.refresh = refresh;
    }
    return requireService().listModels(input);
  });

  options.registrar.handle(CHANNEL_AI_CHAT, async (raw: unknown) => {
    const maxTokens = readOptionalNumber(raw, 'maxTokens');
    const temperature = readOptionalNumber(raw, 'temperature');
    const input: {
      providerId: string;
      messages: AiMessage[];
      maxTokens?: number;
      temperature?: number;
    } = { providerId: readProviderId(raw), messages: readMessages(raw) };
    if (maxTokens !== undefined) {
      input.maxTokens = maxTokens;
    }
    if (temperature !== undefined) {
      input.temperature = temperature;
    }
    return requireService().chat(input);
  });

  options.registrar.handle(CHANNEL_AI_SET_KEY, async (raw: unknown) => {
    const input = { providerId: readProviderId(raw), key: readKey(raw) };
    return requireService().setKey(input);
  });

  options.registrar.handle(CHANNEL_AI_CLEAR_KEY, async (raw: unknown) => {
    return requireService().clearKey({ providerId: readProviderId(raw) });
  });

  options.registrar.handle(CHANNEL_AI_SET_CHAT_CONFIG, async (raw: unknown) => {
    const requestTimeoutSec = readOptionalConfigNumber(raw, 'requestTimeoutSec');
    const maxOutputTokens = readOptionalConfigNumber(raw, 'maxOutputTokens');
    const input: {
      requestTimeoutSec?: number | null;
      maxOutputTokens?: number | null;
    } = {};
    if (requestTimeoutSec !== undefined) {
      input.requestTimeoutSec = requestTimeoutSec;
    }
    if (maxOutputTokens !== undefined) {
      input.maxOutputTokens = maxOutputTokens;
    }
    return requireService().setChatConfig(input);
  });
}
