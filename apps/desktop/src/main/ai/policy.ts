/**
 * main/ai/policy.ts —— 端点策略纯函数（TASK-T18-01 §2.5）。
 *
 * - normalizeBaseUrl：trim → 必须 http/https → 剥尾部多余 `/` 与 `/v1`（幂等）；
 * - isLocalBaseUrl：hostname ∈ {localhost, 127.0.0.1, ::1, [::1]} 或 *.localhost
 *   （按 URL.hostname 判定，不做 DNS 解析）；
 * - assertAiUrlAllowed：非本地端点且无 cloudConsent → E_AI_CLOUD_DENIED
 *   （隐私硬不变量：拒绝时调用方尚未发出任何网络请求）。
 *
 * 纯 Node（不 import electron），可直测。
 */
import { AiError } from './types';

/** 规范化 baseUrl：` http://HOST:1234/v1/ ` → `http://host:1234`（剥 /v1 幂等）。 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new AiError('E_AI_BAD_URL', `端点地址不是合法 URL：'${trimmed}'`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('E_AI_BAD_URL', `端点必须是 http(s) URL：'${trimmed}'`);
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith('/v1')) {
    path = path.slice(0, -3);
  }
  return `${url.protocol}//${url.host}${path}`;
}

/** 本地判定：localhost / *.localhost / 127.0.0.1 / ::1 / [::1]（不做 DNS 解析）。 */
export function isLocalBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost')
  );
}

/**
 * 云端门禁：规范化后，非本地端点必须 cloudConsent === true 才放行。
 * 返回规范化 url；拒绝时抛 E_AI_CLOUD_DENIED（此时尚未发出任何网络请求）。
 */
export function assertAiUrlAllowed(baseUrl: string, cloudConsent: boolean): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!isLocalBaseUrl(normalized) && !cloudConsent) {
    throw new AiError('E_AI_CLOUD_DENIED', '非本地端点需在设置中显式开启云端调用');
  }
  return normalized;
}
