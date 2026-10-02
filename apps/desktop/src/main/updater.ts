/**
 * main/updater.ts —— 自动更新器服务（M10-B · TASK-T12-01B §0）。
 *
 * 分层（与 dbview/search 等模块同纪律：本文件不 import electron，纯 Node 可测；
 * electron-updater 实例由 main/index.ts 注入）：
 *
 * 1. 纯核心：
 *    - UpdaterError（E_FEED_SIGNATURE / E_FEED_SOURCE_DENIED / E_UPDATE_UNAVAILABLE / E_UPDATE_FAILED / E_MALFORMED）；
 *    - verifyFeedSignature(ymlBytes, sig, pub?) —— Ed25519（Node stdlib，零新依赖），
 *      失败/缺 sig/错钥一律抛 E_FEED_SIGNATURE（任务书 §2：先验 sig，再交 electron-updater）；
 *    - assertFeedUrlAllowed(url, devFeed) —— dev-feed 门：localhost/127.0.0.1/[::1]
 *      仅当 SEPTCATS_DEV_FEED=1 允许（生产拒本地源，隐私默认的一部分）；
 *    - createUpdaterStateMachine() —— 事件驱动的状态机，非法跃迁忽略（error 恒可达）。
 * 2. registerUpdaterIpc(deps)：把上述核心与注入的 electron-updater 接成五通道
 *    （update:check / update:state / update:download / update:install / update:rollbackHint）。
 *
 * feed 校验流程（§0.3）：check 时先经本文件 fetch latest.yml + latest.yml.sig 原文字节
 * 验 Ed25519 签名，通过后才调 updater.checkForUpdates()（其后 sha512/blockmap 由
 * electron-updater 自己兜底）。file:// 占位 feed（T12-A 遗留）跳过预验签，见 DEVIATIONS。
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHANNEL_UPDATE_CHECK,
  CHANNEL_UPDATE_DOWNLOAD,
  CHANNEL_UPDATE_INSTALL,
  CHANNEL_UPDATE_ROLLBACK_HINT,
  updateStateSchema,
  type UpdateInstallInput,
  type UpdateState,
  type UpdateStatus,
} from '../shared/updater';

/** 更新器域错误（Error.message 以 `${code}: ${message}` 形式透传 renderer，对齐仓内惯例）。 */
export class UpdaterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'UpdaterError';
  }
}

// ---------------------------------------------------------------------------
// feed 自签验签（§0.3）
// ---------------------------------------------------------------------------

/**
 * feed 验签公钥（Ed25519 SPKI PEM）——与发布私钥 <feed-keys>/septcats-feed.key 配对。
 *
 * 轮换流程（密钥泄露/到期时）：
 *  1. 离线机 `node scripts/feed-sign.mjs keygen --out <新目录>` 生成新密钥对；
 *  2. 用**旧私钥**签发一份「公钥轮换声明」（新公钥 PEM + 生效版本号）随 feed 发布；
 *  3. 本常量替换为新公钥，随一次常规更新发出去（用户先经旧钥验证本次更新）；
 *  4. 确认覆盖面后再弃用旧钥。过渡期可临时并列新旧两把公钥（改为数组逐一验证）。
 */
export const FEED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAoywO20ixVcfcKHOIbGuAS+WiGY2Kxn6ttG4L7ihH/9s=
-----END PUBLIC KEY-----`;

/**
 * 对 latest.yml 原文字节验 Ed25519 签名。
 * 任何失败（签名不匹配、sig 非 base64、公钥非法）都抛 E_FEED_SIGNATURE。
 */
export function verifyFeedSignature(
  ymlBytes: Buffer | Uint8Array,
  sigBase64: string,
  publicKeyPem: string = FEED_PUBLIC_KEY_PEM,
): void {
  let sig: Buffer;
  try {
    sig = Buffer.from(sigBase64.trim(), 'base64');
  } catch {
    throw new UpdaterError('E_FEED_SIGNATURE', 'latest.yml.sig 不是合法 base64');
  }
  let ok: boolean;
  try {
    ok = cryptoVerify(null, ymlBytes, createPublicKey(publicKeyPem), sig);
  } catch {
    throw new UpdaterError('E_FEED_SIGNATURE', '验签公钥非法');
  }
  if (!ok) {
    throw new UpdaterError('E_FEED_SIGNATURE', 'latest.yml 签名校验失败（内容被篡改或密钥不符）');
  }
}

/**
 * 从 feed 目录验签（fs 版，供 file:// 占位场景与测试使用）：
 * 缺 latest.yml.sig 或验签失败一律抛 E_FEED_SIGNATURE（无 sig 拒）。
 */
export function verifyFeedDirectory(feedDir: string, publicKeyPem: string = FEED_PUBLIC_KEY_PEM): void {
  const ymlPath = join(feedDir, 'latest.yml');
  const sigPath = join(feedDir, 'latest.yml.sig');
  if (!existsSync(ymlPath)) {
    throw new UpdaterError('E_FEED_SIGNATURE', `feed 目录缺少 latest.yml：${feedDir}`);
  }
  if (!existsSync(sigPath)) {
    throw new UpdaterError('E_FEED_SIGNATURE', `feed 目录缺少 latest.yml.sig（拒绝无签名 feed）`);
  }
  verifyFeedSignature(readFileSync(ymlPath), readFileSync(sigPath, 'utf8'), publicKeyPem);
}

// ---------------------------------------------------------------------------
// dev-feed 门（§0.2：生产拒本地源）
// ---------------------------------------------------------------------------

/** 判定 feed URL 是否指向本机（localhost / 127.0.0.0/8 常见形态 / [::1]）。 */
export function isLocalFeedUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    // WHATWG URL 对 IPv6 主机名保留方括号（'[::1]'），剥掉再比
    const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    return host === 'localhost' || host === '::1' || host.startsWith('127.');
  } catch {
    return false;
  }
}

/**
 * feed 来源门：本地源仅当 dev-feed 开关（SEPTCATS_DEV_FEED=1）在场时允许；
 * 违规抛 E_FEED_SOURCE_DENIED。非 http(s) 源（如 T12-A 的 file:// 占位）不在 HTTP
 * 门控语义内，交由调用方决定是否跳过预验签。
 */
export function assertFeedUrlAllowed(raw: string, devFeedEnabled: boolean): void {
  if (isLocalFeedUrl(raw) && !devFeedEnabled) {
    throw new UpdaterError('E_FEED_SOURCE_DENIED', '本地 feed 源被拒绝（生产禁止；开发注入需 SEPTCATS_DEV_FEED=1）');
  }
}

// ---------------------------------------------------------------------------
// 状态机（§0.4：idle → checking → available(downloading→downloaded) / not-available / error）
// ---------------------------------------------------------------------------

export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'download-progress'; percent: number }
  | { type: 'downloaded'; version?: string | undefined }
  | { type: 'error'; code: string; message?: string | undefined }
  | { type: 'manual'; downloadUrl: string }
  | { type: 'reset' };

export interface UpdaterStateMachine {
  get(): UpdateState;
  /** 事件入队；返回跃迁后的状态（非法跃迁原状态原样返回）。 */
  dispatch(event: UpdateEvent): UpdateState;
  subscribe(listener: (state: UpdateState) => void): () => void;
}

export function createUpdaterStateMachine(initial: UpdateState = { status: 'idle' }): UpdaterStateMachine {
  let state: UpdateState = initial;
  const listeners = new Set<(state: UpdateState) => void>();

  const apply = (next: UpdateState): UpdateState => {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  };

  return {
    get: () => state,
    dispatch(event: UpdateEvent): UpdateState {
      switch (event.type) {
        case 'checking':
          // 去重：check 入口与 electron-updater 的 checking-for-update 事件会先后双发
          if (state.status === 'checking') {
            return state;
          }
          return apply({ status: 'checking' });
        case 'available':
          return apply({ status: 'available', version: event.version });
        case 'not-available':
          return apply({ status: 'not-available' });
        case 'download-progress': {
          // 下载进度只在 available/downloading 中有效（越序事件忽略）
          if (state.status !== 'available' && state.status !== 'downloading') {
            return state;
          }
          const percent = Math.max(0, Math.min(100, event.percent));
          return apply({
            status: 'downloading',
            version: state.version,
            progress: percent,
          });
        }
        case 'downloaded': {
          // downloaded 只能从 available/downloading 到达（越序忽略）
          if (state.status !== 'available' && state.status !== 'downloading') {
            return state;
          }
          return apply({ status: 'downloaded', version: event.version ?? state.version });
        }
        case 'error':
          return apply({
            status: 'error',
            errorCode: event.code,
            message: event.message,
          });
        case 'manual':
          // 手动更新（mac 未签名）：终态，不参与 available/downloading 跃迁
          return apply({ status: 'manual', downloadUrl: event.downloadUrl });
        case 'reset':
          return apply({ status: 'idle' });
      }
    },
    subscribe(listener: (state: UpdateState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 状态值集合（zod schema 派生，防漂移）。 */
export const UPDATE_STATUSES: readonly UpdateStatus[] = updateStateSchema.shape.status.options;

// ---------------------------------------------------------------------------
// IPC 服务（electron-updater 由注入点传入）
// ---------------------------------------------------------------------------

/** electron-updater AppUpdater 的最小结构面（真实实例来自 main/index.ts）。
 *  setFeedURL 必须带 provider（electron-updater providerFactory 按它分发；
 *  真机踩实：只传 {url} → "Unsupported provider: undefined" 启动即崩）。 */
export interface AutoUpdaterLike {
  on(event: string, listener: (...args: never[]) => void): unknown;
  setFeedURL(options: { provider: 'generic'; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
  autoDownload: boolean;
}

/**
 * 从 app-update.yml 文本解析 feed URL（electron-builder 产物，形如
 * `provider: generic\nurl: file:///...`）。无 url 行 → null。
 * 真机教训（缺陷账 #29）：electron-updater 6.8.9 的**真实实例没有** currentFeedURL
 * 属性（只有已废弃的 getFeedURL()），读它恒 undefined → 预验签被整体跳过、
 * feed 自签防线在生产被击穿。feed URL 必须由我们自己的接线显式提供。
 */
export function parseFeedUrlFromYml(text: string): string | null {
  const m = /^url:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m.exec(text);
  return m?.[1] !== undefined && m[1].length > 0 ? m[1] : null;
}

/**
 * 更新元数据文件名按平台分化（electron-updater 契约：mac 读 `latest-mac.yml`，
 * win 读 `latest.yml`；linux=latest-linux.yml 暂无产品线）。混用会让 mac 客户端
 * 永远查不到更新（拉的是 win 的 yml，files 里的 .exe mac 装不了）。签名文件同后缀
 * 规则（`<yml>.sig`），我方 feed 自签链不受影响。
 */
export function feedYmlName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
}

/**
 * macOS 未签名构建的手动更新入口（老板决定：不购买 Apple Developer ID）。
 * 仅作为 `manual` 态的透出链接交给渲染层 `shell.openExternal`（协议白名单只放 http/https）。
 */
export const MANUAL_UPDATE_URL =
  'https://github.com/nathanjngogo/septcats-releases/releases/latest';

/** fetch 响应最小面（真实 net.fetch 的 Response 由 main/index.ts 适配）。 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  bytes(): Promise<Uint8Array>;
}

export type FeedFetcher = (url: string) => Promise<FetchResponseLike>;

export interface UpdaterIpcDeps {
  /** `ipcMain.handle` 适配面（main/index.ts 的 dbViewRegistrar() 同款）。 */
  registrar: { handle(channel: string, listener: (raw: unknown) => Promise<unknown>): void };
  /** 主→渲染推送（遍历 BrowserWindow webContents.send）。 */
  broadcast: (state: UpdateState) => void;
  /** electron-updater 实例（AppUpdater）；null = 环境不可用。 */
  updater: AutoUpdaterLike | null;
  /** Electron net.fetch 或等价物（预验签拉取 latest.yml 用）。 */
  fetch: FeedFetcher;
  /** 预验签公钥（默认硬编码正式公钥；测试注入临时公钥）。 */
  feedPublicKeyPem?: string | undefined;
  /**
   * 生产 feed URL（从 app-update.yml 解析；无/占位 file:// 传 null）。
   * **undefined = 接线缺失**：打包环境的 check 会直接拒（E_UPDATE_UNAVAILABLE），
   * 防止未来有人把这段接线弄丢后静默跳过验签（缺陷账 #29 的制度化）。
   */
  feedUrl?: string | null | undefined;
  env: Record<string, string | undefined>;
  isPackaged: boolean;
  /** 平台（测试注入用；默认 process.platform）。darwin=未签名构建 → 手动更新。 */
  platform?: NodeJS.Platform | undefined;
  /** 启动自动检查延迟毫秒；null = 不自动检查（测试默认关）。 */
  autoCheckDelayMs?: number | null;
  log?: (line: string) => void;
}

/** 把 UpdaterError 映射成 `${code}: ${message}`（非 UpdaterError 统一 E_UPDATE_FAILED）。 */
export function toUpdaterError(error: unknown): UpdaterError {
  if (error instanceof UpdaterError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new UpdaterError('E_UPDATE_FAILED', message);
}

/**
 * 注册更新五通道并启动事件流。返回 { check, dispose }：
 * - check：启动后 5s 自动一次的入口（index.ts 用）；与 update:check 通道同一实现；
 * - dispose：清掉自动检查定时器（will-quit 场景，防窗口销毁后广播）。
 */
export function registerUpdaterIpc(deps: UpdaterIpcDeps): { check(): Promise<UpdateState>; dispose(): void } {
  const log = deps.log ?? (() => {});
  const machine = createUpdaterStateMachine();
  const unsubscribe = machine.subscribe((state) => {
    deps.broadcast(state);
  });

  const devFeedEnabled = deps.env['SEPTCATS_DEV_FEED'] === '1';
  const devFeedUrl = deps.env['SEPTCATS_DEV_FEED_URL'];
  /** 平台（测试可注入）；mac 未签名 → 手动更新，不走 electron-updater。 */
  const platform = deps.platform ?? process.platform;
  const manualUpdate = platform === 'darwin';

  // dev feed 注入（§0.2 运行期覆盖）：env 指定 URL 且过门才 setFeedURL；
  // 过门失败只记日志不注入（fail-closed，但不阻断应用启动）
  let devFeedInjected = false;
  if (deps.updater !== null && devFeedUrl !== undefined && devFeedUrl.length > 0) {
    try {
      assertFeedUrlAllowed(devFeedUrl, devFeedEnabled);
      deps.updater.setFeedURL({ provider: 'generic', url: devFeedUrl });
      devFeedInjected = true;
      log(`dev feed 注入：${devFeedUrl}`);
    } catch (error) {
      const mapped = toUpdaterError(error);
      log(`dev feed 注入被拒（${mapped.code}），沿用 app-update.yml 的 feed`);
    }
  }

  const currentState = (): UpdateState => machine.get();

  /**
   * 检查流程：先自拉 latest.yml 验签（http(s) 源），通过才交 electron-updater。
   * electron-updater 的事件（checking/available/progress/downloaded/error）驱动状态机。
   */
  const check = async (): Promise<UpdateState> => {
    // macOS 未签名构建（老板决定：不购买 Apple Developer ID）：Squirrel.Mac 会校验
    // 运行中应用与更新包的代码签名，未签名/未公证的更新**必然装不上**。故 mac 端
    // 不发任何网络请求、也不进 electron-updater，只给「手动更新」态 + Releases 链接
    // ——既不谎报「已是最新」，也不给一个点了会失败的更新按钮（顺带守住零外联纪律）。
    if (manualUpdate) {
      log('macOS 未签名构建：跳过自动更新检查，转手动下载');
      machine.dispatch({ type: 'manual', downloadUrl: MANUAL_UPDATE_URL });
      return currentState();
    }
    if (deps.updater === null) {
      machine.dispatch({ type: 'error', code: 'E_UPDATE_UNAVAILABLE', message: '更新器不可用' });
      return currentState();
    }
    if (!deps.isPackaged && devFeedUrl === undefined) {
      machine.dispatch({
        type: 'error',
        code: 'E_UPDATE_UNAVAILABLE',
        message: '未打包环境（开发态请用 SEPTCATS_DEV_FEED_URL 注入本地 feed）',
      });
      return currentState();
    }

    // 接线守卫：打包 + 真实 updater + 既无 dev 注入又没接 feedUrl = 直接拒
    // （不信任任何"读实例属性"的取法；见 #29）
    if (deps.isPackaged && !devFeedInjected && deps.feedUrl === undefined) {
      machine.dispatch({
        type: 'error',
        code: 'E_UPDATE_UNAVAILABLE',
        message: 'feed URL 未接线（app-update.yml 解析缺失），拒绝跳过验签直接检查',
      });
      return currentState();
    }

    machine.dispatch({ type: 'checking' });

    const feedUrl = devFeedInjected ? (devFeedUrl ?? null) : (deps.feedUrl ?? null);
    if (feedUrl !== null && feedUrl.startsWith('http')) {
      try {
        // dev-feed 门对 http(s) 源统一生效（含注入与 app-update.yml 配置的源）
        assertFeedUrlAllowed(feedUrl, devFeedEnabled);
        // 平台分化：mac 拉 latest-mac.yml(.sig)、win 拉 latest.yml(.sig)
        const ymlName = feedYmlName(platform);
        const [ymlRes, sigRes] = await Promise.all([
          deps.fetch(new URL(ymlName, feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`).toString()),
          deps.fetch(new URL(`${ymlName}.sig`, feedUrl.endsWith('/') ? feedUrl : `${feedUrl}/`).toString()),
        ]);
        if (!ymlRes.ok || !sigRes.ok) {
          throw new UpdaterError(
            'E_FEED_SIGNATURE',
            `拉取 feed 失败（yml=${String(ymlRes.status)} sig=${String(sigRes.status)}）`,
          );
        }
        const ymlBytes = Buffer.from(await ymlRes.bytes());
        const sigText = Buffer.from(await sigRes.bytes()).toString('utf8');
        verifyFeedSignature(ymlBytes, sigText, deps.feedPublicKeyPem);
        log('latest.yml 验签通过，交 electron-updater 走 sha512/blockmap');
      } catch (error) {
        const mapped = toUpdaterError(error);
        machine.dispatch({ type: 'error', code: mapped.code, message: mapped.message });
        return currentState();
      }
    } else if (feedUrl !== null) {
      // file:// 占位 feed（T12-A 遗留）：无 HTTP 面，跳过预验签，记录日志
      log(`feed 为非 http 源（${feedUrl}），跳过预验签（占位 feed，真源待老板拍板）`);
    }

    try {
      await deps.updater.checkForUpdates();
    } catch (error) {
      const mapped = toUpdaterError(error);
      machine.dispatch({ type: 'error', code: mapped.code, message: mapped.message });
    }
    return currentState();
  };

  // --- electron-updater 事件 → 状态机（updater 为 null 时跳过） ---
  if (deps.updater !== null) {
    const on = (event: string, run: (...args: never[]) => void): void => {
      deps.updater?.on(event, run as (...args: never[]) => void);
    };
    on('checking-for-update', () => {
      machine.dispatch({ type: 'checking' });
    });
    on('update-available', (info: unknown) => {
      const version =
        typeof info === 'object' && info !== null && 'version' in info
          ? String((info as { version: unknown }).version)
          : '';
      machine.dispatch({ type: 'available', version });
    });
    on('update-not-available', () => {
      machine.dispatch({ type: 'not-available' });
    });
    on('download-progress', (progress: unknown) => {
      const percent =
        typeof progress === 'object' && progress !== null && 'percent' in progress
          ? Number((progress as { percent: unknown }).percent)
          : 0;
      machine.dispatch({ type: 'download-progress', percent: Number.isFinite(percent) ? percent : 0 });
    });
    on('update-downloaded', (info: unknown) => {
      const version =
        typeof info === 'object' && info !== null && 'version' in info
          ? String((info as { version: unknown }).version)
          : undefined;
      machine.dispatch({ type: 'downloaded', version });
    });
    on('error', (error: unknown) => {
      const mapped = toUpdaterError(error);
      machine.dispatch({ type: 'error', code: mapped.code, message: mapped.message });
    });
  }

  // --- IPC 通道 ---
  deps.registrar.handle(CHANNEL_UPDATE_CHECK, async () => check());

  deps.registrar.handle(CHANNEL_UPDATE_DOWNLOAD, async () => {
    // mac 未签名：不下载（装了也过不了 Squirrel.Mac 的签名校验）——fail-loud 明示手动路径
    if (manualUpdate) {
      throw new UpdaterError(
        'E_UPDATE_UNAVAILABLE',
        'macOS 未签名构建不支持自动更新，请手动下载新版 DMG',
      );
    }
    if (deps.updater === null) {
      throw new UpdaterError('E_UPDATE_UNAVAILABLE', '更新器不可用');
    }
    const state = currentState();
    if (state.status === 'downloaded') {
      return state; // 幂等
    }
    if (state.status !== 'available' && state.status !== 'downloading') {
      throw new UpdaterError('E_UPDATE_FAILED', `当前状态（${state.status}）不可下载`);
    }
    try {
      await deps.updater.downloadUpdate();
    } catch (error) {
      const mapped = toUpdaterError(error);
      machine.dispatch({ type: 'error', code: mapped.code, message: mapped.message });
    }
    return currentState();
  });

  deps.registrar.handle(CHANNEL_UPDATE_INSTALL, async (raw: unknown) => {
    // 前置 confirm:true（任务书 §0.4）
    if (typeof raw !== 'object' || raw === null || (raw as UpdateInstallInput).confirm !== true) {
      throw new UpdaterError('E_MALFORMED', 'confirm 必须显式为 true');
    }
    if (deps.updater === null) {
      throw new UpdaterError('E_UPDATE_UNAVAILABLE', '更新器不可用');
    }
    if (manualUpdate) {
      throw new UpdaterError(
        'E_UPDATE_UNAVAILABLE',
        'macOS 未签名构建不支持自动更新，请手动下载新版 DMG',
      );
    }
    if (currentState().status !== 'downloaded') {
      throw new UpdaterError('E_UPDATE_FAILED', '更新未就绪（须先完成下载）');
    }
    deps.updater.quitAndInstall();
    return { ok: true };
  });

  deps.registrar.handle(CHANNEL_UPDATE_ROLLBACK_HINT, async () => {
    // 安装失败 electron-updater 自身回 pending（旧版仍在安装目录），本端只做日志与状态透出
    const state = currentState();
    const hint =
      state.status === 'error'
        ? `更新失败（${state.errorCode ?? 'E_UPDATE_FAILED'}）：应用未被改动，可重试检查或稍后再试`
        : '如安装后仍回旧版本，安装包留在 pending 目录，可重新检查更新重试';
    log(`rollbackHint: ${hint}`);
    return { state, hint };
  });

  // 启动 5s 后自动检查一次（autoCheckDelayMs 未给时默认 5000；显式 null 关闭）
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  const delay = deps.autoCheckDelayMs === undefined ? 5000 : deps.autoCheckDelayMs;
  if (delay !== null) {
    autoTimer = setTimeout(() => {
      void check();
    }, delay);
  }

  return {
    check,
    dispose: () => {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      unsubscribe();
    },
  };
}
