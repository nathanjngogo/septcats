/**
 * ai-chat-config.test.ts —— AI 对话运行时配置（TASK-T46-01 §1.1/§1.4）。
 *
 * 覆盖：
 * 1) 数值口径：夹紧区间（超时 5–600 秒、max_tokens 1–131072）、非法值当未设置、
 *    默认（未设置）→ effectiveChatTimeoutMs 回注入值 120_000（**默认行为不变**）；
 * 2) 文件口径：坏 JSON / 版本不符 / 缺字段 → 未设置；越界值读入即夹紧；序列化可回读；
 * 3) store：注入 IO + 目录的读写往返（真的落盘 + 夹紧后写回）、目录不可用 → 只更新内存、
 *    未写文件；`defaultChatConfigStore()`（非 Electron 环境）→ 未设置配置；
 * 4) ai:setChatConfig 的入参守卫：类型不符 → E_MALFORMED（不猜字符串数字）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiService } from '../src/main/ai/service';
import { registerAiIpc, type AiIpcRegistrar } from '../src/main/ai/ipc';
import {
  AI_CHAT_CONFIG_FILE_NAME,
  AI_CHAT_CONFIG_VERSION,
  AI_CHAT_TIMEOUT_ADVISED_MAX_SEC,
  AI_CHAT_TIMEOUT_ADVISED_MIN_SEC,
  DEFAULT_AI_CHAT_RUNTIME_CONFIG,
  clampMaxOutputTokens,
  clampRequestTimeoutSec,
  describeTimeoutSeconds,
  effectiveChatTimeoutMs,
  parseAiChatConfigFile,
  serializeAiChatConfig,
} from '../src/main/ai/chatConfig';
import { AiChatConfigStore, defaultChatConfigStore } from '../src/main/ai/chatConfigStore';
import { CHANNEL_AI_SET_CHAT_CONFIG } from '../src/shared/ipc';

// ---------------------------------------------------------------------------
// 1) 数值口径
// ---------------------------------------------------------------------------

describe('ai/chatConfig 夹紧与生效值', () => {
  it('超时：区间内原样、越界夹紧、小数取整、非法当未设置', () => {
    expect(clampRequestTimeoutSec(120)).toBe(120);
    expect(clampRequestTimeoutSec(5)).toBe(5);
    expect(clampRequestTimeoutSec(600)).toBe(600);
    expect(clampRequestTimeoutSec(4)).toBe(5);
    expect(clampRequestTimeoutSec(0)).toBe(5);
    expect(clampRequestTimeoutSec(-30)).toBe(5);
    expect(clampRequestTimeoutSec(9_999)).toBe(600);
    expect(clampRequestTimeoutSec(120.4)).toBe(120);
    expect(clampRequestTimeoutSec(599.6)).toBe(600);
    expect(clampRequestTimeoutSec(null)).toBeNull();
    expect(clampRequestTimeoutSec(undefined)).toBeNull();
    expect(clampRequestTimeoutSec(Number.NaN)).toBeNull();
    expect(clampRequestTimeoutSec(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampRequestTimeoutSec('30')).toBeNull();
    expect(clampRequestTimeoutSec(true)).toBeNull();
  });

  it('max_tokens：区间内原样、越界夹紧、小数向下取整、非法当未设置', () => {
    expect(clampMaxOutputTokens(800)).toBe(800);
    expect(clampMaxOutputTokens(1)).toBe(1);
    expect(clampMaxOutputTokens(131_072)).toBe(131_072);
    expect(clampMaxOutputTokens(0)).toBe(1);
    expect(clampMaxOutputTokens(-5)).toBe(1);
    expect(clampMaxOutputTokens(999_999)).toBe(131_072);
    expect(clampMaxOutputTokens(12.9)).toBe(12);
    expect(clampMaxOutputTokens(null)).toBeNull();
    expect(clampMaxOutputTokens(Number.NaN)).toBeNull();
    expect(clampMaxOutputTokens('800')).toBeNull();
  });

  it('生效超时：未设置 → 注入值（生产 120_000）；设置 → 秒 × 1000', () => {
    expect(effectiveChatTimeoutMs({ ...DEFAULT_AI_CHAT_RUNTIME_CONFIG }, 120_000)).toBe(120_000);
    expect(effectiveChatTimeoutMs({ requestTimeoutSec: 5, maxOutputTokens: null }, 120_000)).toBe(
      5_000,
    );
    expect(effectiveChatTimeoutMs({ requestTimeoutSec: 300, maxOutputTokens: null }, 120_000)).toBe(
      300_000,
    );
    expect(effectiveChatTimeoutMs({ requestTimeoutSec: null, maxOutputTokens: 400 }, 400)).toBe(400);
  });

  it('UI 建议区间常量与硬夹紧区间一致（建议下限 30、硬下限 5）', () => {
    expect(AI_CHAT_TIMEOUT_ADVISED_MIN_SEC).toBe(30);
    expect(AI_CHAT_TIMEOUT_ADVISED_MAX_SEC).toBe(600);
    expect(clampRequestTimeoutSec(AI_CHAT_TIMEOUT_ADVISED_MAX_SEC)).toBe(600);
  });

  it('超时文案秒数：整数秒给整数、亚秒给两位小数', () => {
    expect(describeTimeoutSeconds(5_000)).toBe('5');
    expect(describeTimeoutSeconds(300_000)).toBe('300');
    expect(describeTimeoutSeconds(120_000)).toBe('120');
    expect(describeTimeoutSeconds(60)).toBe('0.06');
    expect(describeTimeoutSeconds(1_500)).toBe('1.50');
  });
});

// ---------------------------------------------------------------------------
// 2) 文件口径
// ---------------------------------------------------------------------------

describe('ai/chatConfig 文件解析与序列化', () => {
  it('合法文件 → 读出（越界值读入即夹紧）', () => {
    const text = JSON.stringify({ v: 1, requestTimeoutSec: 300, maxOutputTokens: 2_048 });
    expect(parseAiChatConfigFile(text)).toEqual({ requestTimeoutSec: 300, maxOutputTokens: 2_048 });
    const outOfRange = JSON.stringify({ v: 1, requestTimeoutSec: 99_999, maxOutputTokens: -3 });
    expect(parseAiChatConfigFile(outOfRange)).toEqual({
      requestTimeoutSec: 600,
      maxOutputTokens: 1,
    });
  });

  it('无文件/空文本/坏 JSON/版本不符/形状不对 → 未设置（永不抛）', () => {
    expect(parseAiChatConfigFile(null)).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    expect(parseAiChatConfigFile('   ')).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    expect(parseAiChatConfigFile('{ 不是 json')).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    expect(parseAiChatConfigFile(JSON.stringify({ v: 2, requestTimeoutSec: 5 }))).toEqual(
      DEFAULT_AI_CHAT_RUNTIME_CONFIG,
    );
    expect(parseAiChatConfigFile('[]')).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    expect(parseAiChatConfigFile(JSON.stringify({ v: 1 }))).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
  });

  it('序列化 → 回读一致（缺省字段写 null，形状稳定）', () => {
    const config = { requestTimeoutSec: 30, maxOutputTokens: null };
    const text = serializeAiChatConfig(config);
    expect(JSON.parse(text)).toEqual({
      v: AI_CHAT_CONFIG_VERSION,
      requestTimeoutSec: 30,
      maxOutputTokens: null,
    });
    expect(parseAiChatConfigFile(text)).toEqual(config);
  });
});

// ---------------------------------------------------------------------------
// 3) store（注入 IO + 目录）
// ---------------------------------------------------------------------------

function makeTempDir(label: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `${label}-`));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('ai/chatConfigStore 读写往返', () => {
  it('文件缺失 → 未设置；patch 落盘（夹紧后）+ 回读一致', async () => {
    const tmp = makeTempDir('t46-config');
    try {
      const store = new AiChatConfigStore({ resolveDir: async () => tmp.dir });
      expect(await store.read()).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
      // 首次读之后 memo：再 patch 也以 memo 为基线
      const next = await store.patch({ requestTimeoutSec: 300, maxOutputTokens: 4_096 });
      expect(next).toEqual({ requestTimeoutSec: 300, maxOutputTokens: 4_096 });
      const onDisk = JSON.parse(readFileSync(join(tmp.dir, AI_CHAT_CONFIG_FILE_NAME), 'utf8')) as
        Record<string, unknown>;
      expect(onDisk).toEqual({ v: 1, requestTimeoutSec: 300, maxOutputTokens: 4_096 });

      // 越界 → 夹紧后再落盘
      const clamped = await store.patch({ requestTimeoutSec: 9_999, maxOutputTokens: 0 });
      expect(clamped).toEqual({ requestTimeoutSec: 600, maxOutputTokens: 1 });
      const reread = new AiChatConfigStore({ resolveDir: async () => tmp.dir });
      expect(await reread.read()).toEqual({ requestTimeoutSec: 600, maxOutputTokens: 1 });
    } finally {
      tmp.cleanup();
    }
  });

  it('显式 null = 清回未设置（落盘也写 null）；缺省字段不动', async () => {
    const tmp = makeTempDir('t46-config-null');
    try {
      const store = new AiChatConfigStore({ resolveDir: async () => tmp.dir });
      await store.patch({ requestTimeoutSec: 45, maxOutputTokens: 256 });
      const cleared = await store.patch({ requestTimeoutSec: null });
      expect(cleared).toEqual({ requestTimeoutSec: null, maxOutputTokens: 256 });
      const final = await store.patch({ maxOutputTokens: null });
      expect(final).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    } finally {
      tmp.cleanup();
    }
  });

  it('目录不可用 → 只更新内存值、不写文件（默认行为仍可回退）', async () => {
    let writes = 0;
    const store = new AiChatConfigStore({
      resolveDir: async () => null,
      io: {
        readText: () => null,
        writeText: () => {
          writes += 1;
        },
      },
    });
    expect(await store.read()).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    await store.patch({ requestTimeoutSec: 5 });
    expect(writes).toBe(0);
    expect(await store.read()).toEqual({ requestTimeoutSec: 5, maxOutputTokens: null });
  });

  it('坏文件（坏 JSON）→ 未设置（不抛）', async () => {
    const tmp = makeTempDir('t46-config-broken');
    try {
      writeFileSync(join(tmp.dir, AI_CHAT_CONFIG_FILE_NAME), '{ 断掉的 json', 'utf8');
      const store = new AiChatConfigStore({ resolveDir: async () => tmp.dir });
      expect(await store.read()).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
    } finally {
      tmp.cleanup();
    }
  });

  it('默认 store（纯 Node：无 Electron userData）→ 未设置配置', async () => {
    const store = defaultChatConfigStore();
    expect(await store.read()).toEqual(DEFAULT_AI_CHAT_RUNTIME_CONFIG);
  });
});

// ---------------------------------------------------------------------------
// 4) ai:setChatConfig 入参守卫
// ---------------------------------------------------------------------------

describe('ai:setChatConfig 通道守卫', () => {
  interface Captured {
    channel: string;
    listener: (raw: unknown) => Promise<unknown>;
  }

  function makeRegistrar(): { registrar: AiIpcRegistrar; captured: Captured[] } {
    const captured: Captured[] = [];
    return {
      captured,
      registrar: {
        handle: (channel, listener) => {
          captured.push({ channel, listener });
        },
      },
    };
  }

  it('类型不符（字符串/布尔/NaN）→ E_MALFORMED；null 与数字放行', async () => {
    const { registrar, captured } = makeRegistrar();
    const calls: unknown[] = [];
    const fakeService = {
      setChatConfig: async (input: unknown) => {
        calls.push(input);
        return { chatTimeoutSec: 5, maxOutputTokens: null };
      },
      state: async () => ({}),
      listModels: async () => ({}),
      chat: async () => ({}),
      setKey: async () => ({ ok: true as const }),
      clearKey: async () => ({ ok: true as const }),
    };
    registerAiIpc({
      registrar,
      getService: () => fakeService as unknown as AiService,
    });
    const handler = captured.find((c) => c.channel === CHANNEL_AI_SET_CHAT_CONFIG);
    expect(handler).toBeDefined();
    const listener = handler?.listener;
    if (listener === undefined) {
      throw new Error('ai:setChatConfig 未注册');
    }

    // PagesApiError 的 message 只有详情，错误码在 `code` 字段（既有 AI 通道同款口径）
    const malformed = await listener({ requestTimeoutSec: '300' }).then(
      () => null,
      (error: unknown) => error as { code?: string; message?: string },
    );
    expect(malformed?.code).toBe('E_MALFORMED');
    expect(malformed?.message).toBe('requestTimeoutSec 必须是有限数字或 null');
    await expect(listener({ maxOutputTokens: true })).rejects.toThrow(/必须是有限数字或 null/);
    await expect(listener({ requestTimeoutSec: Number.NaN })).rejects.toThrow(
      /必须是有限数字或 null/,
    );
    expect(calls).toHaveLength(0);

    await listener({ requestTimeoutSec: 300, maxOutputTokens: null });
    expect(calls).toEqual([{ requestTimeoutSec: 300, maxOutputTokens: null }]);

    // 全字段缺省 = 空 patch（不改任何值）
    await listener({});
    expect(calls[1]).toEqual({});
  });
});
