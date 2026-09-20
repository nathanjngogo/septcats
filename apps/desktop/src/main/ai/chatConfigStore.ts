/**
 * main/ai/chatConfigStore.ts —— AI 对话运行时配置的文件存储（TASK-T46-01 §1.1/§1.4）。
 *
 * 旁路于 settings：超时 / max_tokens 不写 settings.json，落
 * `<userData>/ai-chat-config.json`（只含两个数值，无密钥、无正文、无 prompt——
 * 隐私面与 settings 同级，密钥仍只进 CredentialStore）。
 *
 * - 目录经异步解析（测试注入；生产 = Electron `app.getPath('userData')`）；
 *   非 Electron 环境（vitest / 纯 Node）解析为 null → 只读不写、回「未设置」。
 * - 读：文件缺失 / 坏 JSON / 版本不符 / 形状不对 → 未设置（**永不抛**）。
 * - 写：夹紧后整体落盘；写失败只更新内存（不影响本轮对话，不阻断 UI）。
 * - 本文件**不静态** import electron（动态 import + try/catch），故可在 vitest 直测。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_CHAT_CONFIG_FILE_NAME,
  clampMaxOutputTokens,
  clampRequestTimeoutSec,
  parseAiChatConfigFile,
  serializeAiChatConfig,
  type AiChatRuntimeConfig,
} from './chatConfig';

/** 文件 IO 最小面（测试注入；生产 = node:fs 同步读写）。 */
export interface AiChatConfigIo {
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
}

const NODE_IO: AiChatConfigIo = {
  readText: (path) => {
    try {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  },
  writeText: (path, text) => {
    writeFileSync(path, text, 'utf8');
  },
};

export interface AiChatConfigStoreOptions {
  /** 解析配置目录；不可用（非 Electron / 无权限）→ null（此时只更新内存）。 */
  resolveDir: () => Promise<string | null>;
  /** 文件 IO（缺省 = node:fs）。 */
  io?: AiChatConfigIo;
}

/** patch 入参：字段缺省 = 不改；显式 null = 清回未设置。 */
export interface AiChatConfigPatch {
  requestTimeoutSec?: number | null;
  maxOutputTokens?: number | null;
}

/**
 * 生产默认目录解析：Electron `userData`。
 * 动态 import + try/catch：vitest（纯 Node）里 electron 只是可执行文件路径，
 * 取不到 `app` → null；任何异常同样回 null（绝不因拿不到目录而让对话失败）。
 */
async function resolveElectronUserDataDir(): Promise<string | null> {
  try {
    const mod = (await import('electron')) as {
      app?: { getPath?: (name: string) => string };
      default?: { app?: { getPath?: (name: string) => string } };
    };
    const app = mod.app ?? mod.default?.app;
    const dir = app?.getPath?.('userData');
    return typeof dir === 'string' && dir.length > 0 ? dir : null;
  } catch {
    return null;
  }
}

export class AiChatConfigStore {
  private readonly resolveDir: () => Promise<string | null>;
  private readonly io: AiChatConfigIo;
  /** 已解析值（含目录不可用时的内存态）；null = 尚未读。 */
  private memo: AiChatRuntimeConfig | null = null;

  constructor(options: AiChatConfigStoreOptions) {
    this.resolveDir = options.resolveDir;
    this.io = options.io ?? NODE_IO;
  }

  /** 读生效配置（文件缺失/坏/版本不符 → 未设置）。结果 memo：目录不可用时仍可回读。 */
  async read(): Promise<AiChatRuntimeConfig> {
    if (this.memo !== null) {
      return { ...this.memo };
    }
    const config = parseAiChatConfigFile(await this.readFileText());
    this.memo = config;
    return { ...config };
  }

  /** 合并写入（夹紧后落盘）；返回写后完整配置。目录不可用/写失败 → 仅内存生效。 */
  async patch(patch: AiChatConfigPatch): Promise<AiChatRuntimeConfig> {
    const base = await this.read();
    const next: AiChatRuntimeConfig = {
      requestTimeoutSec:
        patch.requestTimeoutSec === undefined
          ? base.requestTimeoutSec
          : clampRequestTimeoutSec(patch.requestTimeoutSec),
      maxOutputTokens:
        patch.maxOutputTokens === undefined
          ? base.maxOutputTokens
          : clampMaxOutputTokens(patch.maxOutputTokens),
    };
    this.memo = next;
    const dir = await this.resolveDir();
    if (dir !== null) {
      try {
        this.io.writeText(join(dir, AI_CHAT_CONFIG_FILE_NAME), serializeAiChatConfig(next));
      } catch {
        /* 写失败（只读盘/配额）：内存值已生效，不抛 */
      }
    }
    return { ...next };
  }

  private async readFileText(): Promise<string | null> {
    const dir = await this.resolveDir();
    if (dir === null) {
      return null;
    }
    try {
      return this.io.readText(join(dir, AI_CHAT_CONFIG_FILE_NAME));
    } catch {
      return null;
    }
  }
}

/** 生产默认 store：懒解析 Electron userData（非 Electron → 未设置，只读不写）。 */
export function defaultChatConfigStore(): AiChatConfigStore {
  return new AiChatConfigStore({ resolveDir: resolveElectronUserDataDir });
}
