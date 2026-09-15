/**
 * updater.test.ts —— 更新器核心（M10-B · TASK-T12-01B §2）。
 *
 * 纯 Node（不 import electron）：
 *  - yml 验签：签→验通过；篡改一字节→E_FEED_SIGNATURE；无 sig 文件→拒；错误密钥→拒
 *    （密钥对用 feed-sign.mjs keygen 在 tmp 现生成，测试不依赖真实私钥）；
 *  - feed URL 门：无 SEPTCATS_DEV_FEED 时 localhost feed 被拒；
 *  - 状态机：事件流注入 → idle→checking→available→downloading→downloaded 序列，
 *    且每一步 IPC payload 用 shared/updater.ts 的 zod schema parse 断言；
 *  - registerUpdaterIpc：fake updater + fake fetch 走完 check→download→install 与验签失败路径。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertFeedUrlAllowed,
  createUpdaterStateMachine,
  isLocalFeedUrl,
  registerUpdaterIpc,
  toUpdaterError,
  verifyFeedDirectory,
  verifyFeedSignature,
  type AutoUpdaterLike,
  type UpdateEvent,
} from '../src/main/updater';
import { updateStateSchema, type UpdateState } from '../src/shared/updater';
import { generateFeedKeyPair, signFeedBytes } from '../scripts/feed-sign.mjs';

const created: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE_YML = 'version: 0.1.1\npath: Septcats Setup 0.1.1.exe\nsha512: AAAA\nreleaseDate: 2026-09-14T00:00:00Z\n';

// ---------------------------------------------------------------------------
// §2-1 yml 验签
// ---------------------------------------------------------------------------

describe('feed 验签（Ed25519，feed-sign.mjs keygen 临时密钥）', () => {
  it('签→验通过（keygen 落 tmp，私钥只在本测临时目录）', () => {
    const dir = tempDir('septcats-updater-keygen-');
    const { privatePem, publicPem } = generateFeedKeyPair(dir);
    const yml = Buffer.from(SAMPLE_YML, 'utf8');
    const sig = signFeedBytes(yml, privatePem);
    expect(() => verifyFeedSignature(yml, sig, publicPem)).not.toThrow();
  });

  it('篡改 yml 一字节 → E_FEED_SIGNATURE', () => {
    const { privatePem, publicPem } = generateFeedKeyPair();
    const yml = Buffer.from(SAMPLE_YML, 'utf8');
    const sig = signFeedBytes(yml, privatePem);
    const tampered = Buffer.from(SAMPLE_YML.replace('0.1.1', '0.1.2'), 'utf8');
    expect(() => verifyFeedSignature(tampered, sig, publicPem)).toThrow(/E_FEED_SIGNATURE/);
  });

  it('无 sig 文件 → 拒（verifyFeedDirectory 抛 E_FEED_SIGNATURE）', () => {
    const dir = tempDir('septcats-updater-nosig-');
    const { privatePem, publicPem } = generateFeedKeyPair();
    writeFileSync(join(dir, 'latest.yml'), SAMPLE_YML, 'utf8');
    const sig = signFeedBytes(Buffer.from(SAMPLE_YML, 'utf8'), privatePem);
    // 先证明目录内确无 latest.yml.sig，再断言拒绝
    expect(() => verifyFeedDirectory(dir, publicPem)).toThrow(/E_FEED_SIGNATURE/);
    // 补上 sig 后同目录通过（对照组：拒的原因确是缺 sig）
    writeFileSync(join(dir, 'latest.yml.sig'), sig, 'utf8');
    expect(() => verifyFeedDirectory(dir, publicPem)).not.toThrow();
  });

  it('错误密钥（他人公钥/被换公钥）→ 拒', () => {
    const a = generateFeedKeyPair();
    const b = generateFeedKeyPair();
    const yml = Buffer.from(SAMPLE_YML, 'utf8');
    const sigByA = signFeedBytes(yml, a.privatePem);
    expect(() => verifyFeedSignature(yml, sigByA, b.publicPem)).toThrow(/E_FEED_SIGNATURE/);
  });

  it('sig 非法 base64 → 拒', () => {
    const { publicPem } = generateFeedKeyPair();
    const yml = Buffer.from(SAMPLE_YML, 'utf8');
    expect(() => verifyFeedSignature(yml, '!!!not-base64!!!', publicPem)).toThrow(/E_FEED_SIGNATURE/);
  });
});

// ---------------------------------------------------------------------------
// §2-2 feed URL 门
// ---------------------------------------------------------------------------

describe('dev-feed 门（生产拒本地源）', () => {
  it('无 SEPTCATS_DEV_FEED 时 localhost/127.0.0.1/[::1] feed 全被拒', () => {
    for (const url of [
      'http://localhost:8765/feed',
      'http://127.0.0.1:8765/feed',
      'https://localhost/feed',
      'http://[::1]:9000/feed',
      'http://127.50.1.2/feed',
    ]) {
      expect(() => assertFeedUrlAllowed(url, false)).toThrow(/E_FEED_SOURCE_DENIED/);
    }
  });

  it('SEPTCATS_DEV_FEED=1 时本地源放行；远程源恒放行', () => {
    expect(() => assertFeedUrlAllowed('http://127.0.0.1:8765/feed', true)).not.toThrow();
    expect(() => assertFeedUrlAllowed('https://feed.septcats.cc/stable/', false)).not.toThrow();
  });

  it('isLocalFeedUrl 形态判定（非 http 源不算本地源，交调用方另行处理）', () => {
    expect(isLocalFeedUrl('http://localhost/')).toBe(true);
    expect(isLocalFeedUrl('file:///septcats-feed/stable')).toBe(false);
    expect(isLocalFeedUrl('not a url')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §2-3 状态机事件流 + IPC payload zod 断言
// ---------------------------------------------------------------------------

describe('状态机（事件流注入，payload 对齐 shared/updater.ts 契约）', () => {
  it('idle→checking→available→downloading→downloaded 序列，每步 zod parse 通过', () => {
    const machine = createUpdaterStateMachine();
    const seen: UpdateState[] = [];
    machine.subscribe((state) => seen.push(state));

    const events: UpdateEvent[] = [
      { type: 'checking' },
      { type: 'available', version: '0.1.1' },
      { type: 'download-progress', percent: 42.5 },
      { type: 'downloaded', version: '0.1.1' },
    ];
    for (const event of events) {
      const state = machine.dispatch(event);
      // IPC payload 形状断言：update:state 每次推送都必须过 zod schema
      expect(() => updateStateSchema.parse(state)).not.toThrow();
    }

    expect(seen.map((state) => state.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ]);
    expect(seen[1]).toMatchObject({ status: 'available', version: '0.1.1' });
    expect(seen[2]).toMatchObject({ status: 'downloading', progress: 42.5 });
    expect(seen[3]).toMatchObject({ status: 'downloaded', version: '0.1.1' });
  });

  it('not-available 与 error（含 E_FEED_SIGNATURE 透出）分支', () => {
    const machine = createUpdaterStateMachine();
    machine.dispatch({ type: 'checking' });
    expect(machine.dispatch({ type: 'not-available' }).status).toBe('not-available');
    machine.dispatch({ type: 'checking' });
    const errored = machine.dispatch({
      type: 'error',
      code: 'E_FEED_SIGNATURE',
      message: 'latest.yml 签名校验失败',
    });
    expect(updateStateSchema.parse(errored)).toMatchObject({
      status: 'error',
      errorCode: 'E_FEED_SIGNATURE',
    });
  });

  it('越序事件忽略（error 恒可达；idle 态收 download-progress 不动）', () => {
    const machine = createUpdaterStateMachine();
    expect(machine.dispatch({ type: 'download-progress', percent: 50 }).status).toBe('idle');
    expect(machine.dispatch({ type: 'downloaded' }).status).toBe('idle');
    expect(machine.dispatch({ type: 'error', code: 'E_UPDATE_FAILED' }).status).toBe('error');
    // reset 回 idle
    expect(machine.dispatch({ type: 'reset' }).status).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// registerUpdaterIpc（fake updater + fake fetch，五通道走通）
// ---------------------------------------------------------------------------

/** fake electron-updater：记录调用，可编程吐事件。 */
function makeFakeUpdater(): AutoUpdaterLike & { emit(event: string, ...args: unknown[]): void; calls: string[] } {
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
  const calls: string[] = [];
  return {
    calls,
    on(event: string, listener: (...args: never[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return undefined;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        (listener as (...args: unknown[]) => void)(...args);
      }
    },
    setFeedURL(options: { provider?: string; url: string }) {
      calls.push(`setFeedURL:${options.provider ?? 'NONE'}:${options.url}`);
    },
    checkForUpdates() {
      calls.push('checkForUpdates');
      return Promise.resolve(null);
    },
    downloadUpdate() {
      calls.push('downloadUpdate');
      return Promise.resolve(null);
    },
    quitAndInstall() {
      calls.push('quitAndInstall');
    },
    autoDownload: true,
    currentFeedURL: 'http://127.0.0.1:8765/feed/',
  };
}

interface Harness {
  states: UpdateState[];
  handlers: Map<string, (raw: unknown) => Promise<unknown>>;
  updater: ReturnType<typeof makeFakeUpdater>;
  service: ReturnType<typeof registerUpdaterIpc>;
}

function makeHarness(options: {
  feedYml?: Buffer | undefined;
  feedSig?: string | null | undefined;
  feedPublicKeyPem?: string | undefined;
  fetchFail?: boolean;
  devFeed?: boolean;
  isPackaged?: boolean;
  autoCheckDelayMs?: number | null;
}): Harness {
  const updater = makeFakeUpdater();
  const states: UpdateState[] = [];
  const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
  const feedYml = options.feedYml ?? Buffer.from(SAMPLE_YML, 'utf8');
  const feedSig = options.feedSig ?? null;
  const service = registerUpdaterIpc({
    registrar: {
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      },
    },
    broadcast: (state) => {
      states.push(state);
    },
    updater,
    fetch: async (url) => {
      if (options.fetchFail === true || !url.endsWith('.yml') && !url.endsWith('.sig')) {
        return { ok: false, status: 404, bytes: async () => new Uint8Array(0) };
      }
      if (url.endsWith('.sig')) {
        if (feedSig === null) {
          return { ok: false, status: 404, bytes: async () => new Uint8Array(0) };
        }
        return { ok: true, status: 200, bytes: async () => Buffer.from(feedSig, 'utf8') };
      }
      return { ok: true, status: 200, bytes: async () => feedYml };
    },
    // 默认开 dev-feed 门（harness 的 currentFeedURL 指向本地）；门控测试显式传 devFeed:false
    env: options.devFeed === false ? {} : { SEPTCATS_DEV_FEED: '1' },
    feedPublicKeyPem: options.feedPublicKeyPem,
    isPackaged: options.isPackaged ?? true,
    autoCheckDelayMs: options.autoCheckDelayMs ?? null,
    log: () => {},
  });
  return { states, handlers, updater, service };
}

describe('registerUpdaterIpc（五通道 + 预验签 + 事件流）', () => {
  it('happy path：验签过 → checkForUpdates → available → download → downloaded payload 全过 zod', async () => {
    const { privatePem, publicPem } = generateFeedKeyPair();
    const h = makeHarness({
      feedSig: signFeedBytes(Buffer.from(SAMPLE_YML, 'utf8'), privatePem),
      feedPublicKeyPem: publicPem,
    });

    const state = (await h.handlers.get('update:check')!({})) as UpdateState;
    expect(h.updater.calls).toContain('checkForUpdates');
    expect(() => updateStateSchema.parse(state)).not.toThrow();
    expect(state.status).toBe('checking'); // check 入口即置 checking；fake updater 不吐结果事件，状态保持

    // 模拟 electron-updater 事件流
    h.updater.emit('checking-for-update');
    h.updater.emit('update-available', { version: '0.1.1' });
    h.updater.emit('download-progress', { percent: 88 });
    h.updater.emit('update-downloaded', { version: '0.1.1' });
    expect(h.states.map((s) => s.status)).toEqual([
      'checking',
      'available',
      'downloading',
      'downloaded',
    ]);
    for (const s of h.states) {
      expect(() => updateStateSchema.parse(s)).not.toThrow(); // update:state 推送形状
    }

    // download 通道在 downloaded 态幂等返回
    const afterDownload = (await h.handlers.get('update:download')!({})) as UpdateState;
    expect(afterDownload.status).toBe('downloaded');

    // install 无 confirm → E_MALFORMED；confirm:true → quitAndInstall
    await expect(h.handlers.get('update:install')!({})).rejects.toThrow(/E_MALFORMED/);
    await expect(h.handlers.get('update:install')!({ confirm: false })).rejects.toThrow(/E_MALFORMED/);
    await h.handlers.get('update:install')!({ confirm: true });
    expect(h.updater.calls).toContain('quitAndInstall');

    // rollbackHint 透出 state + hint
    const hint = (await h.handlers.get('update:rollbackHint')!({})) as { state: UpdateState; hint: string };
    expect(() => updateStateSchema.parse(hint.state)).not.toThrow();
    expect(hint.hint.length).toBeGreaterThan(0);
  });

  it('验签失败（篡改 feed）→ E_FEED_SIGNATURE error 态，且不触达 checkForUpdates', async () => {
    const { privatePem, publicPem } = generateFeedKeyPair();
    const tampered = Buffer.from(SAMPLE_YML.replace('0.1.1', '0.1.2'), 'utf8');
    const h = makeHarness({
      feedYml: tampered,
      feedSig: signFeedBytes(Buffer.from(SAMPLE_YML, 'utf8'), privatePem),
      feedPublicKeyPem: publicPem,
    });

    const state = (await h.handlers.get('update:check')!({})) as UpdateState;
    expect(updateStateSchema.parse(state)).toMatchObject({ status: 'error', errorCode: 'E_FEED_SIGNATURE' });
    expect(h.updater.calls).not.toContain('checkForUpdates');
  });

  it('无 sig 文件（fetch 404）→ E_FEED_SIGNATURE 拒', async () => {
    const h = makeHarness({ feedSig: null });
    const state = (await h.handlers.get('update:check')!({})) as UpdateState;
    expect(updateStateSchema.parse(state)).toMatchObject({ status: 'error', errorCode: 'E_FEED_SIGNATURE' });
    expect(h.updater.calls).not.toContain('checkForUpdates');
  });

  it('dev feed 注入：SEPTCATS_DEV_FEED=1 + SEPTCATS_DEV_FEED_URL → register 时 setFeedURL', () => {
    const updater = makeFakeUpdater();
    registerUpdaterIpc({
      registrar: { handle: () => {} },
      broadcast: () => {},
      updater,
      fetch: async () => ({ ok: true, status: 200, bytes: async () => new Uint8Array(0) }),
      env: { SEPTCATS_DEV_FEED: '1', SEPTCATS_DEV_FEED_URL: 'http://127.0.0.1:8765/feed' },
      isPackaged: true,
      autoCheckDelayMs: null,
      log: () => {},
    });
    // provider 必传（真机踩实：缺 provider → electron-updater "Unsupported provider: undefined" 启动崩）
    expect(updater.calls).toContain('setFeedURL:generic:http://127.0.0.1:8765/feed');
  });

  it('dev feed 注入：无 SEPTCATS_DEV_FEED 时本地 URL 被拒——不注入、不 crash（fail-closed）', () => {
    const updater = makeFakeUpdater();
    const logs: string[] = [];
    expect(() =>
      registerUpdaterIpc({
        registrar: { handle: () => {} },
        broadcast: () => {},
        updater,
        fetch: async () => ({ ok: true, status: 200, bytes: async () => new Uint8Array(0) }),
        env: { SEPTCATS_DEV_FEED_URL: 'http://127.0.0.1:8765/feed' },
        isPackaged: true,
        autoCheckDelayMs: null,
        log: (line) => logs.push(line),
      }),
    ).not.toThrow();
    expect(updater.calls).not.toContain('setFeedURL:http://127.0.0.1:8765/feed');
    expect(logs.join('\n')).toContain('E_FEED_SOURCE_DENIED');
  });

  it('dev-feed 门：SEPTCATS_DEV_FEED 未开时本地源在 check 内被拒（E_FEED_SOURCE_DENIED）', async () => {
    // harness 默认 currentFeedURL 指向本地；devFeed:false → 预验签前的门先拒
    const h = makeHarness({ devFeed: false, feedSig: 'unused' });
    // setFeedURL 注入发生在 register 时：devFeed:false + env 无 URL → 不注入（无本地 URL 输入），
    // 但 currentFeedURL 仍是本地源 → check 的 http 门拒
    const state = (await h.handlers.get('update:check')!({})) as UpdateState;
    expect(updateStateSchema.parse(state)).toMatchObject({ status: 'error', errorCode: 'E_FEED_SOURCE_DENIED' });
    expect(h.updater.calls).not.toContain('checkForUpdates');
  });

  it('未打包且未注入 dev feed → E_UPDATE_UNAVAILABLE，不触达 updater', async () => {
    const updater = makeFakeUpdater();
    Object.defineProperty(updater, 'currentFeedURL', { value: 'https://feed.septcats.cc/stable/' });
    const handlers = new Map<string, (raw: unknown) => Promise<unknown>>();
    registerUpdaterIpc({
      registrar: { handle: (channel, listener) => handlers.set(channel, listener) },
      broadcast: () => {},
      updater,
      fetch: async () => ({ ok: true, status: 200, bytes: async () => new Uint8Array(0) }),
      env: {},
      isPackaged: false,
      autoCheckDelayMs: null,
      log: () => {},
    });
    const state = (await handlers.get('update:check')!({})) as UpdateState;
    expect(updateStateSchema.parse(state)).toMatchObject({ status: 'error', errorCode: 'E_UPDATE_UNAVAILABLE' });
    expect(updater.calls).not.toContain('checkForUpdates');
  });
});

describe('toUpdaterError', () => {
  it('非 UpdaterError 归一为 E_UPDATE_FAILED', () => {
    expect(toUpdaterError(new Error('boom')).code).toBe('E_UPDATE_FAILED');
    expect(toUpdaterError(new Error('boom')).message).toBe('E_UPDATE_FAILED: boom');
  });
});
