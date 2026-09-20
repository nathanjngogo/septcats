/**
 * shared/ai.ts —— ai:* 的线上契约（M11 · TASK-T18-01 §2.3）。
 *
 * 仅类型：preload 不带 zod 运行时（照 shared/updater 红线）。
 * main（AiService 产出）、preload、renderer（T18-02 设置页 / T18-03 编辑器动作）三侧共用。
 */

export type AiProviderKind = 'lmstudio' | 'ollama' | 'openai-compatible';

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  baseUrl: string;
  model: string | null;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** ai:state → 渲染器视图（不泄露密钥；hasKey 为派生布尔）。 */
export interface AiStateSnapshot {
  enabled: boolean;
  cloudConsent: boolean;
  activeProviderId: string | null;
  /** 生效的 chat 超时（秒）——未设置配置时 = 默认 120（TASK-T46-01 §1.1）。 */
  chatTimeoutSec: number;
  /** 最大输出 tokens（null = 未设置 → 请求体不带 max_tokens，TASK-T46-01 §1.4）。 */
  maxOutputTokens: number | null;
  providers: Array<{
    id: string;
    kind: AiProviderKind;
    name: string;
    baseUrl: string;
    isLocal: boolean;
    hasKey: boolean;
    model: string | null;
  }>;
}

export interface AiListModelsResult {
  models: string[];
  cached: boolean;
  fetchedAt: number;
}

export interface AiChatResult {
  text: string;
  model: string;
  /**
   * 推理正文（TASK-T46-01 §1.2 新增可选字段）：端点给 `reasoning_content` 时透出；
   * content 为空但本字段存在 = 纯推理响应（呈现层显示「仅推理内容」+ 可折叠区）。
   */
  reasoningContent?: string;
  /** 结束原因（新增可选字段）：'length' = 达到输出上限（呈现层提示可加大 max_tokens）。 */
  finishReason?: string;
}

/** AI 对话运行时配置（TASK-T46-01 §1.1/§1.4；ai:setChatConfig 入参/回参）。 */
export interface AiChatConfigSnapshot {
  /** 生效的 chat 超时（秒）。 */
  chatTimeoutSec: number;
  /** 最大输出 tokens（null = 未设置）。 */
  maxOutputTokens: number | null;
}

/** ai:setChatConfig 入参：字段缺省 = 不改；显式 null = 清回未设置。 */
export interface AiChatConfigPatch {
  requestTimeoutSec?: number | null;
  maxOutputTokens?: number | null;
}

/** AI 请求参数的硬边界（TASK-T46-01）：main 侧夹紧与 renderer 侧输入框共用**单一来源**。 */
export const AI_CHAT_TIMEOUT_MIN_SEC = 5;
export const AI_CHAT_TIMEOUT_MAX_SEC = 600;
export const AI_CHAT_TIMEOUT_DEFAULT_SEC = 120;
/** UI 建议区间（仅文案；硬边界见上）。 */
export const AI_CHAT_TIMEOUT_ADVISED_MIN_SEC = 30;
export const AI_CHAT_TIMEOUT_ADVISED_MAX_SEC = 600;
export const AI_MAX_OUTPUT_TOKENS_MIN = 1;
export const AI_MAX_OUTPUT_TOKENS_MAX = 131_072;

/** 稳定错误码（消息格式 CODE：中文详情）。 */
export const AI_ERROR_CODES = [
  'E_AI_DISABLED',
  'E_AI_NO_PROVIDER',
  'E_AI_NO_MODEL',
  'E_AI_CLOUD_DENIED',
  'E_AI_BAD_URL',
  'E_AI_UNREACHABLE',
  'E_AI_TIMEOUT',
  'E_AI_HTTP',
  'E_AI_BAD_RESPONSE',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
