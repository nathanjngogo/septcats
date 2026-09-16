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
}

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
