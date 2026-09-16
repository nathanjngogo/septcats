/**
 * ai-policy.test.ts —— 端点策略纯函数（TASK-T18-01 §3）。
 *
 * 覆盖：normalizeBaseUrl（trim/剥尾 /v1/ 幂等/缺 scheme 拒绝/https 保留）、
 * isLocalBaseUrl（localhost/127.0.0.1/[::1]/*.localhost true；局域网/公网 false）、
 * assertAiUrlAllowed（本地放行；非本地无 consent → E_AI_CLOUD_DENIED；有 consent 放行）。
 */
import { describe, expect, it } from 'vitest';
import { assertAiUrlAllowed, isLocalBaseUrl, normalizeBaseUrl } from '../src/main/ai/policy';

describe('ai/policy normalizeBaseUrl', () => {
  it('trim + 小写化 + 剥尾部斜杠与 /v1（幂等）', () => {
    expect(normalizeBaseUrl(' http://HOST:1234/v1/ ')).toBe('http://host:1234');
    expect(normalizeBaseUrl('http://host:1234/v1')).toBe('http://host:1234');
    expect(normalizeBaseUrl('http://host:1234')).toBe('http://host:1234');
    expect(normalizeBaseUrl('http://host:1234//')).toBe('http://host:1234');
    expect(normalizeBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com');
  });

  it('非 /v1 前缀路径保留', () => {
    expect(normalizeBaseUrl('http://host:1234/api/')).toBe('http://host:1234/api');
    expect(normalizeBaseUrl('https://proxy.corp.cn/openai/v1')).toBe('https://proxy.corp.cn/openai');
  });

  it('缺 scheme / 非 http(s) → E_AI_BAD_URL', () => {
    expect(() => normalizeBaseUrl('host:1234')).toThrow(/E_AI_BAD_URL/);
    expect(() => normalizeBaseUrl('ftp://host:1234')).toThrow(/E_AI_BAD_URL/);
    expect(() => normalizeBaseUrl('')).toThrow(/E_AI_BAD_URL/);
  });
});

describe('ai/policy isLocalBaseUrl', () => {
  it('本地端点 true', () => {
    expect(isLocalBaseUrl('http://localhost:1234')).toBe(true);
    expect(isLocalBaseUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLocalBaseUrl('http://[::1]:1234')).toBe(true);
    expect(isLocalBaseUrl('http://sub.localhost:1234')).toBe(true);
  });

  it('非本地端点 false', () => {
    expect(isLocalBaseUrl('http://192.168.1.5:1234')).toBe(false);
    expect(isLocalBaseUrl('https://api.example.com')).toBe(false);
    expect(isLocalBaseUrl('http://10.0.0.2')).toBe(false);
    expect(isLocalBaseUrl('not-a-url')).toBe(false);
  });
});

describe('ai/policy assertAiUrlAllowed', () => {
  it('本地端点无条件放行，返回规范化 url', () => {
    expect(assertAiUrlAllowed('http://127.0.0.1:1234/v1/', false)).toBe('http://127.0.0.1:1234');
    expect(assertAiUrlAllowed('http://localhost:11434', false)).toBe('http://localhost:11434');
  });

  it('非本地 + 无 consent → E_AI_CLOUD_DENIED（此时尚未发出任何网络请求）', () => {
    expect(() => assertAiUrlAllowed('https://api.example.com/v1', false)).toThrow(
      /E_AI_CLOUD_DENIED/,
    );
    expect(() => assertAiUrlAllowed('http://192.168.1.5:1234', false)).toThrow(/E_AI_CLOUD_DENIED/);
  });

  it('非本地 + consent 放行', () => {
    expect(assertAiUrlAllowed('https://api.example.com/v1', true)).toBe('https://api.example.com');
  });
});
