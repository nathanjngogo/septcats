/**
 * t73-open-external.test.ts —— TASK-T73-01 §1/§3：openExternal 通道安全护栏（纯 Node）。
 *
 * 覆盖：
 * - 协议白名单（resolveExternalUrl 纯函数）：https/http 放行；file://、javascript:、
 *   空串、全空白、畸形串、缺 host 一律拒绝；拒绝码 E_PROTOCOL / E_EMPTY 逐格钉死；
 * - createShellService：放行才调注入的 openExternal；拒绝时不触达系统面；
 *   openExternal 抛错 → 结构化 E_OPEN_FAILED（不冒泡）；
 * - 隐私红线（审计）：日志只记 host + protocol，URL 原文（path/query/fragment）
 *   绝不进审计正文——断言日志序列化不含 URL 原文片段；
 * - registerShellIpc：非对象 / url 非字符串 → E_MALFORMED；合法 url 透传 service。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createShellService,
  registerShellIpc,
  resolveExternalUrl,
} from '../src/main/shell';
import { SHELL_CHANNELS, type ShellErrorCode } from '../src/shared/ipc';

function rejectCode(raw: unknown, code: ShellErrorCode): void {
  const result = resolveExternalUrl(raw);
  expect(result.ok, `应拒绝：${String(raw)}`).toBe(false);
  if (!result.ok) {
    expect(result.code, `拒绝码不符：${String(raw)}`).toBe(code);
  }
}

describe('T73-01 协议白名单（resolveExternalUrl）', () => {
  it('https / http 放行并回 URL 解析结果', () => {
    const https = resolveExternalUrl('https://example.com/a?b=1');
    expect(https.ok).toBe(true);
    if (https.ok) {
      expect(https.url.protocol).toBe('https:');
      expect(https.url.host).toBe('example.com');
    }
    expect(resolveExternalUrl('http://example.com').ok).toBe(true);
  });

  it('file:// 拒绝（E_PROTOCOL）', () => {
    rejectCode('file:///etc/passwd', 'E_PROTOCOL');
  });

  it('javascript: 拒绝（E_PROTOCOL）', () => {
    rejectCode('javascript:alert(1)', 'E_PROTOCOL');
  });

  it('其它协议一律拒绝（E_PROTOCOL）', () => {
    rejectCode('ftp://example.com/f', 'E_PROTOCOL');
    rejectCode('data:text/html,<hi>', 'E_PROTOCOL');
    rejectCode('septcats://open', 'E_PROTOCOL');
  });

  it('空串 / 全空白 → E_EMPTY', () => {
    rejectCode('', 'E_EMPTY');
    rejectCode('   ', 'E_EMPTY');
    rejectCode('\t\n', 'E_EMPTY');
  });

  it('畸形串 → E_PROTOCOL', () => {
    rejectCode('not a url', 'E_PROTOCOL');
    rejectCode('http://', 'E_PROTOCOL');
    rejectCode('://missing-scheme', 'E_PROTOCOL');
  });

  it('WHATWG 归一化：https:///x → host=x（仍放行，href 归一为 https://x/）', () => {
    const result = resolveExternalUrl('https:///x');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url.host).toBe('x');
      expect(result.url.href).toBe('https://x/');
    }
  });

  it('非字符串 → E_MALFORMED（不崩）', () => {
    rejectCode(undefined, 'E_MALFORMED');
    rejectCode(42, 'E_MALFORMED');
    rejectCode(null, 'E_MALFORMED');
  });
});

describe('T73-01 createShellService', () => {
  it('https 放行 → 调用注入 openExternal（原始 href）', async () => {
    const openExternal = vi.fn(async () => {});
    const service = createShellService({ openExternal });
    const result = await service.open({ url: 'https://example.com/path?q=1#h' });
    expect(result).toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/path?q=1#h');
  });

  it('协议被拒 → 不触达 openExternal', async () => {
    const openExternal = vi.fn(async () => {});
    const service = createShellService({ openExternal });
    const result = await service.open({ url: 'javascript:alert(1)' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('E_PROTOCOL');
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('openExternal 抛错 → 结构化 E_OPEN_FAILED（不冒泡）', async () => {
    const service = createShellService({
      openExternal: async () => {
        throw new Error('os failure');
      },
    });
    const result = await service.open({ url: 'https://example.com' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('E_OPEN_FAILED');
      expect(result.error.message).toContain('os failure');
    }
  });

  it('审计只记 host + protocol：URL 原文（path/query/fragment）绝不进审计正文', async () => {
    const logs: Array<{ message: string; ctx: Record<string, unknown> }> = [];
    const service = createShellService({
      openExternal: async () => {},
      log: (message, ctx) => {
        logs.push({ message, ctx });
      },
    });
    const url = 'https://example.com/secret/path?token=abcd1234#frag';
    const result = await service.open({ url });
    expect(result.ok).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.ctx).toEqual({ host: 'example.com', protocol: 'https:' });
    const dump = JSON.stringify(logs);
    expect(dump).toContain('example.com');
    expect(dump).not.toContain('secret');
    expect(dump).not.toContain('token');
    expect(dump).not.toContain('abcd1234');
    expect(dump).not.toContain('frag');
    expect(dump).not.toContain(url);
  });
});

describe('T73-01 registerShellIpc', () => {
  function capture(openExternal: (url: string) => Promise<void>): {
    handler: (input: unknown) => Promise<unknown>;
    service: ReturnType<typeof createShellService>;
  } {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
    const service = createShellService({ openExternal });
    registerShellIpc(service, {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    });
    const handler = handlers.get(SHELL_CHANNELS.openExternal);
    expect(handler, 'shell:openExternal 未注册').toBeDefined();
    return { handler: handler as (input: unknown) => Promise<unknown>, service };
  }

  it('非对象参数 → E_MALFORMED', async () => {
    const { handler } = capture(async () => {});
    const result = (await handler('nope')) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_MALFORMED');
    const nullResult = (await handler(null)) as { ok: boolean; error?: { code: string } };
    expect(nullResult.ok).toBe(false);
    expect(nullResult.error?.code).toBe('E_MALFORMED');
  });

  it('url 非字符串 → E_MALFORMED', async () => {
    const { handler } = capture(async () => {});
    const result = (await handler({ url: 123 })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_MALFORMED');
  });

  it('合法 url 透传 service → 调 openExternal', async () => {
    const openExternal = vi.fn(async () => {});
    const { handler } = capture(openExternal);
    const result = (await handler({ url: 'https://example.com' })) as { ok: boolean };
    expect(result.ok).toBe(true);
    // href 经 WHATWG 归一化（补尾斜杠）
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');
  });

  it('协议越界经通道回结构化 E_PROTOCOL', async () => {
    const openExternal = vi.fn(async () => {});
    const { handler } = capture(openExternal);
    const result = (await handler({ url: 'file:///etc/hosts' })) as {
      ok: boolean;
      error?: { code: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('E_PROTOCOL');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
