/**
 * main/ai/chatConfig.ts —— AI 对话运行时配置的数值口径与文件格式（TASK-T46-01 §1.1/§1.4）。
 *
 * 纯函数、纯 Node（无 IO、不 import electron）：夹紧区间、生效超时、文件名/版本、
 * 解析与序列化。落盘 IO 在 `chatConfigStore.ts`；对外的设置通道在 `service.ts`/`ipc.ts`。
 *
 * 红线：本文件不接触密钥、不发网络；越界值一律夹紧，非法值一律当「未设置」——
 * 「未设置」= **逐字保持** T46 之前的既有行为（chat 超时 120_000ms、请求不带 max_tokens）。
 * 硬边界与 renderer 输入框共用 `shared/ai.ts` 的常量（单一来源）。
 */
import {
  AI_CHAT_TIMEOUT_MAX_SEC,
  AI_CHAT_TIMEOUT_MIN_SEC,
  AI_MAX_OUTPUT_TOKENS_MAX,
  AI_MAX_OUTPUT_TOKENS_MIN,
} from '../../shared/ai';

// UI 建议区间：与硬边界同源再导出（既有消费点在 shared/ai.ts；此处仅为单测就近引用）。
export {
  AI_CHAT_TIMEOUT_ADVISED_MAX_SEC,
  AI_CHAT_TIMEOUT_ADVISED_MIN_SEC,
} from '../../shared/ai';

/** 落盘文件名（`<userData>/ai-chat-config.json`）。 */
export const AI_CHAT_CONFIG_FILE_NAME = 'ai-chat-config.json';
/** 文件格式版本；不匹配（含缺版本）→ 当「未设置」。 */
export const AI_CHAT_CONFIG_VERSION = 1;

/** 运行时配置真相：字段为 null = 未设置（回落到既有默认行为）。 */
export interface AiChatRuntimeConfig {
  requestTimeoutSec: number | null;
  maxOutputTokens: number | null;
}

/** 未设置（= 出厂/清除后的值）；调用方不得就地改写该常量。 */
export const DEFAULT_AI_CHAT_RUNTIME_CONFIG: AiChatRuntimeConfig = {
  requestTimeoutSec: null,
  maxOutputTokens: null,
};

/**
 * 超时秒 → 夹紧到 [5, 600]（小数四舍五入）。
 * 非数字类型 / NaN / ±Infinity → null（未设置），**不猜**字符串数字。
 */
export function clampRequestTimeoutSec(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded < AI_CHAT_TIMEOUT_MIN_SEC) {
    return AI_CHAT_TIMEOUT_MIN_SEC;
  }
  if (rounded > AI_CHAT_TIMEOUT_MAX_SEC) {
    return AI_CHAT_TIMEOUT_MAX_SEC;
  }
  return rounded;
}

/**
 * max_tokens → 夹紧到 [1, 131072]（小数向下取整）。
 * 非数字类型 / NaN / ±Infinity → null（未设置）。
 */
export function clampMaxOutputTokens(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const floored = Math.floor(value);
  if (floored < AI_MAX_OUTPUT_TOKENS_MIN) {
    return AI_MAX_OUTPUT_TOKENS_MIN;
  }
  if (floored > AI_MAX_OUTPUT_TOKENS_MAX) {
    return AI_MAX_OUTPUT_TOKENS_MAX;
  }
  return floored;
}

/**
 * 生效的 chat 超时（ms）：未设置 → 注入兜底值（生产 = `DEFAULT_CHAT_TIMEOUT_MS` = 120_000，
 * 与 T46 之前逐字一致）；已设置 → 秒 × 1000。
 */
export function effectiveChatTimeoutMs(config: AiChatRuntimeConfig, fallbackMs: number): number {
  return config.requestTimeoutSec === null ? fallbackMs : config.requestTimeoutSec * 1_000;
}

/** 超时秒数的可读文案：整秒给整数（"5"/"120"），亚秒给两位小数（600ms → "0.60"）。 */
export function describeTimeoutSeconds(ms: number): string {
  if (ms % 1_000 === 0) {
    return String(ms / 1_000);
  }
  return (ms / 1_000).toFixed(2);
}

/**
 * 解析文件文本 → 运行时配置。null/空白/坏 JSON/非对象/版本不符一律回默认（永不抛）；
 * 合法形状下越界值**读入即夹紧**（磁盘被手改也不越界）。
 */
export function parseAiChatConfigFile(text: string | null): AiChatRuntimeConfig {
  if (text === null || text.trim().length === 0) {
    return { ...DEFAULT_AI_CHAT_RUNTIME_CONFIG };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { ...DEFAULT_AI_CHAT_RUNTIME_CONFIG };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_AI_CHAT_RUNTIME_CONFIG };
  }
  const record = raw as Record<string, unknown>;
  if (record['v'] !== AI_CHAT_CONFIG_VERSION) {
    return { ...DEFAULT_AI_CHAT_RUNTIME_CONFIG };
  }
  return {
    requestTimeoutSec: clampRequestTimeoutSec(record['requestTimeoutSec']),
    maxOutputTokens: clampMaxOutputTokens(record['maxOutputTokens']),
  };
}

/** 序列化：形状稳定（缺省字段写 null + 版本号），供 parseAiChatConfigFile 原样回读。 */
export function serializeAiChatConfig(config: AiChatRuntimeConfig): string {
  return JSON.stringify({
    v: AI_CHAT_CONFIG_VERSION,
    requestTimeoutSec: config.requestTimeoutSec,
    maxOutputTokens: config.maxOutputTokens,
  });
}
