/**
 * shell.ts —— 主进程「打开外部链接」服务（TASK-T73-01，源自 T71-01 D-1 挂账）。
 *
 * 职责：把 renderer 的 `shell:openExternal` 收敛为**唯一出口**——经 `new URL` 解析 +
 * 协议白名单（仅 `http:`/`https:`）后才交给 electron `shell.openExternal`（DI 注入，
 * 本文件不 import electron，vitest 纯 Node 可测）。
 *
 * 安全护栏（必须）：
 * - 仅放行 `http:`/`https:`；`file:`/`javascript:`/其余协议一律拒绝（E_PROTOCOL）；
 * - 空串 / 全空白 → E_EMPTY；非字符串 / 无法解析的畸形串 → E_MALFORMED / E_PROTOCOL；
 * - 结构化返回（不抛异常）：`{ok:true}` | `{ok:false, error:{code,message}}`。
 *
 * 隐私红线：审计只记 `host`（+ 协议），**URL 原文绝不进审计正文**（path/query 可能含
 * 敏感信息）。与既有敏感面口径一致——审计落点由 index.ts 注入 logger，本文件只组
 * 脱敏后的记录。
 *
 * 零外联不变：本服务只在用户点击书签时被调用，启动/空闲不产生任何请求。
 */
import { SHELL_CHANNELS, type ShellOpenResult, type ShellErrorCode } from '../shared/ipc';

// ---------------------------------------------------------------------------
// 协议白名单（纯函数）
// ---------------------------------------------------------------------------

/** 唯一放行的协议集合（其余一律 E_PROTOCOL）。 */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export type ResolveExternalResult =
  | { ok: true; url: URL }
  | { ok: false; code: ShellErrorCode; message: string; protocol: string };

/**
 * 纯函数：校验并解析外部 URL。
 * - 空 / 全空白 → E_EMPTY；
 * - `new URL` 抛错（畸形）→ E_PROTOCOL；
 * - 协议不在白名单 → E_PROTOCOL。
 * 失败时 `protocol` 为「能解析出的协议（否则空串）」——仅用于审计，不含 URL 原文。
 */
export function resolveExternalUrl(raw: unknown): ResolveExternalResult {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'E_MALFORMED', message: 'url 必须是字符串', protocol: '' };
  }
  if (raw.trim().length === 0) {
    return { ok: false, code: 'E_EMPTY', message: 'URL 不能为空', protocol: '' };
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, code: 'E_PROTOCOL', message: 'URL 无法解析（畸形）', protocol: '' };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      code: 'E_PROTOCOL',
      message: `协议不允许：${parsed.protocol}`,
      protocol: parsed.protocol,
    };
  }
  return { ok: true, url: parsed };
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/** 审计记录（脱敏：只有 host + 协议，绝不含 URL 原文）。 */
export type ExternalOpenAudit = { host: string; protocol: string };

export interface ShellServiceOptions {
  /** electron `shell.openExternal(url)` 的注入面（默认实现住 index.ts）。 */
  openExternal: (url: string) => Promise<void>;
  /** 审计落点（注入 logger；本文件只组脱敏记录，URL 原文不入参）。 */
  log?: (message: string, ctx: ExternalOpenAudit) => void;
}

export interface ShellService {
  /** 校验 + 打开；失败结构化返回（不抛异常）。 */
  open(input: { url: unknown }): Promise<ShellOpenResult>;
}

export function createShellService(options: ShellServiceOptions): ShellService {
  return {
    async open(input: { url: unknown }): Promise<ShellOpenResult> {
      const resolved = resolveExternalUrl(input.url);
      if (!resolved.ok) {
        return { ok: false, error: { code: resolved.code, message: resolved.message } };
      }
      // 审计：只记 host + 协议（URL 原文——含 path/query——绝不入正文）。
      options.log?.('打开外部链接', { host: resolved.url.host, protocol: resolved.url.protocol });
      try {
        await options.openExternal(resolved.url.href);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'E_OPEN_FAILED',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// IPC 注册（DI：不 import electron，index.ts 用 ipcMain 适配）
// ---------------------------------------------------------------------------

/** 最小 IPC 注册面（`main/index.ts` 用 dbViewRegistrar 适配）。 */
export interface ShellIpcRegistrar {
  handle(channel: string, listener: (input: unknown) => Promise<unknown>): void;
}

/**
 * 注册 `shell:openExternal`。参数在边界再校验一次（不信任 renderer）：非对象 /
 * 缺 url → E_MALFORMED；其余交给 service 走协议白名单。
 */
export function registerShellIpc(service: ShellService, registrar: ShellIpcRegistrar): void {
  registrar.handle(SHELL_CHANNELS.openExternal, async (raw: unknown): Promise<unknown> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        ok: false,
        error: { code: 'E_MALFORMED', message: 'IPC 参数必须是对象' },
      } satisfies ShellOpenResult;
    }
    const url = (raw as Record<string, unknown>)['url'];
    if (typeof url !== 'string') {
      return {
        ok: false,
        error: { code: 'E_MALFORMED', message: 'url 必须是字符串' },
      } satisfies ShellOpenResult;
    }
    return service.open({ url });
  });
}
