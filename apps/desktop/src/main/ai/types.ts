/**
 * main/ai/types.ts —— AI 错误类型与内部类型（TASK-T18-01 §2.4）。
 *
 * AiError 消息格式恒为 `CODE：中文详情`（照 SyncKeyError 风格），
 * IPC 层直接透传（消息自带码），渲染器按前缀解析。
 */
import type { AiErrorCode } from '../../shared/ai';

/** AI 操作的稳定错误（码见 shared/ai.ts 的 AI_ERROR_CODES）。 */
export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, detail: string) {
    super(`${code}：${detail}`);
    this.name = 'AiError';
    Object.setPrototypeOf(this, AiError.prototype);
    this.code = code;
  }
}

/** 凭据 account 命名（TASK-T18-01 §0.4：service=septcats，account=ai-<providerId>）。 */
export const AI_CREDENTIAL_SERVICE = 'septcats';

export function aiCredentialAccount(providerId: string): string {
  return `ai-${providerId}`;
}
