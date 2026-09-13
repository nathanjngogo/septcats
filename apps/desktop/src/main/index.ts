import { basename, join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { SCHEMA_VERSION, type ActorId } from '@septcats/core';
import { startDbServer, type DbHandle } from '../db/client';
import {
  CHANNEL_FAV_LIST,
  CHANNEL_FAV_SET,
  CHANNEL_META,
  CHANNEL_PAGE_CREATE,
  CHANNEL_PAGE_DELETE,
  CHANNEL_PAGE_MOVE,
  CHANNEL_PAGE_PURGE,
  CHANNEL_PAGE_RENAME,
  CHANNEL_PAGE_RESTORE,
  CHANNEL_PAGE_TREE,
  CHANNEL_PING,
  CHANNEL_RECENT_LIST,
  CHANNEL_RECENT_TOUCH,
  CHANNEL_WORKSPACE_CHANGED,
  CHANNEL_WORKSPACE_CREATE,
  CHANNEL_WORKSPACE_LIST,
  CHANNEL_WORKSPACE_RENAME,
  CHANNEL_WORKSPACE_SWITCH,
} from '../shared/ipc';
import {
  PagesApiError,
  createPagesService,
  toPagesError,
  type MovePageInput,
  type PagesService,
} from './pages';
import { initPlatform, type PlatformContext } from './platform';

/**
 * 主进程入口。
 *
 * 职责边界：
 * - 单实例锁；二次启动聚焦已有窗口
 * - 先 await initPlatform()（数据根/日志/凭据），再起 DbServer → 跑迁移 → 建窗
 * - whenReady -> createWindow（sandbox / contextIsolation / 无 nodeIntegration）
 * - IPC：app:ping、app:meta、page/fav/recent/workspace 四域（T6，全部走 DbServer RPC 白名单）
 *
 * 纪律：主进程**永不** import better-sqlite3；页面写路径一律在 pagesApi 里先造 Op 再落库。
 */

// --- 窗口 -------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let platformContext: PlatformContext | null = null;
let dbHandle: DbHandle | null = null;

/** device_id 缺失/异常时的兜底 actor（[a-z0-9]{8,32}；正常路径取 meta.device_id 的小写形式）。 */
const FALLBACK_ACTOR: ActorId = 'desktop0001';

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#FBFBFA',
    title: 'Septcats',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
    platformContext?.logger.forModule('main').info('window ready-to-show');
  });

  window.on('closed', () => {
    mainWindow = null;
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devServerUrl !== undefined && devServerUrl.length > 0) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow = window;
}

// --- 数据库与页面服务 -------------------------------------------------------

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ULID 形态的 device_id → ActorId（[a-z0-9]{8,32}）。ULID 字母表含大写，
 * 故统一小写并剔除非法字符；长度不足则回落兜底值。
 */
function deriveActorId(deviceId: string | null): ActorId {
  if (deviceId === null) {
    return FALLBACK_ACTOR;
  }
  const normalized = deviceId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
  return normalized.length >= 8 ? (normalized as ActorId) : FALLBACK_ACTOR;
}

async function readMetaValue(handle: DbHandle, key: string): Promise<string | null> {
  const data = await handle.get('meta.get', { key });
  const value = (data.row as { value?: unknown } | null)?.value;
  return typeof value === 'string' ? value : null;
}

/**
 * 起 DbServer → 迁移 → 造 pagesApi。失败**不阻断开窗**：注册的 IPC 会统一回
 * `E_INVARIANT: 数据库服务不可用`，渲染器据此走 ErrorPanel（比窗都开不出来可诊断）。
 */
async function bootstrapDatabase(ctx: PlatformContext): Promise<PagesService | null> {
  const logger = ctx.logger.forModule('db');
  try {
    const handle = await startDbServer({ dbPath: ctx.layout.db });
    dbHandle = handle;
    const migrated = await handle.migrate();
    logger.info(`DbServer 就绪 v${String(migrated.from)}→v${String(migrated.to)} pid=${String(handle.pid ?? 0)}`);
    return createPagesService({
      executor: handle,
      actor: deriveActorId(await readMetaValue(handle, 'device_id')),
    });
  } catch (error) {
    logger.error(`DbServer 启动失败：${describeError(error)}`);
    return null;
  }
}

// --- IPC -------------------------------------------------------------------

type InputRecord = Record<string, unknown>;

function asInput(raw: unknown): InputRecord {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PagesApiError('E_MALFORMED', 'IPC 参数必须是对象');
  }
  return raw as InputRecord;
}

function readText(input: InputRecord, key: string, allowEmpty = false): string {
  const value = input[key];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是${allowEmpty ? '' : '非空'}字符串`);
  }
  return value;
}

function readNullableText(input: InputRecord, key: string): string | null {
  const value = input[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是字符串或 null`);
  }
  return value;
}

function readOptionalText(input: InputRecord, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是非空字符串`);
  }
  return value;
}

function readFlag(input: InputRecord, key: string): boolean {
  const value = input[key];
  if (typeof value !== 'boolean') {
    throw new PagesApiError('E_MALFORMED', `${key} 必须是布尔值`);
  }
  return value;
}

function readMoveInput(input: InputRecord): MovePageInput {
  const move: MovePageInput = {
    id: readText(input, 'id'),
    newParentId: readNullableText(input, 'newParentId'),
  };
  const newSortKey = readOptionalText(input, 'newSortKey');
  if (newSortKey !== undefined) {
    move.newSortKey = newSortKey;
  }
  const placeAfterId = readOptionalText(input, 'placeAfterId');
  if (placeAfterId !== undefined) {
    move.placeAfterId = placeAfterId;
  }
  return move;
}

function broadcastWorkspaceChanged(activeId: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CHANNEL_WORKSPACE_CHANGED, { activeId });
  }
}

/**
 * 注册 page/fav/recent/workspace 四域 IPC。`service === null` 时（DB 启动失败）
 * 各通道统一回 `E_INVARIANT`，让渲染器有明确错误可展示。
 */
function registerPagesIpc(service: PagesService | null): void {
  const requireService = (): PagesService => {
    if (service === null) {
      throw new PagesApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const fail = (error: unknown): never => {
    const mapped = toPagesError(error);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  };

  const on = (channel: string, run: (input: InputRecord) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (_event: unknown, raw: unknown): Promise<unknown> => {
      try {
        return await run(asInput(raw));
      } catch (error) {
        return fail(error);
      }
    });
  };

  const onIdle = (channel: string, run: () => Promise<unknown>): void => {
    ipcMain.handle(channel, async (): Promise<unknown> => {
      try {
        return await run();
      } catch (error) {
        return fail(error);
      }
    });
  };

  on(CHANNEL_PAGE_TREE, (input) =>
    requireService().listTree({ workspaceId: readText(input, 'workspaceId') }),
  );
  on(CHANNEL_PAGE_CREATE, (input) =>
    requireService().createPage({ parentId: readNullableText(input, 'parentId') }),
  );
  on(CHANNEL_PAGE_RENAME, (input) =>
    requireService().renamePage({ id: readText(input, 'id'), title: readText(input, 'title', true) }),
  );
  on(CHANNEL_PAGE_MOVE, (input) => requireService().movePage(readMoveInput(input)));
  on(CHANNEL_PAGE_DELETE, (input) => requireService().deletePage({ id: readText(input, 'id') }));
  on(CHANNEL_PAGE_RESTORE, (input) => requireService().restorePage({ id: readText(input, 'id') }));
  on(CHANNEL_PAGE_PURGE, (input) => requireService().purgePage({ id: readText(input, 'id') }));

  on(CHANNEL_FAV_SET, (input) =>
    requireService().setFavorite({ pageId: readText(input, 'pageId'), on: readFlag(input, 'on') }),
  );
  onIdle(CHANNEL_FAV_LIST, () => requireService().listFavorites());
  on(CHANNEL_RECENT_TOUCH, (input) => requireService().touchRecent({ pageId: readText(input, 'pageId') }));
  onIdle(CHANNEL_RECENT_LIST, () => requireService().listRecent());

  onIdle(CHANNEL_WORKSPACE_LIST, () => requireService().listWorkspaces());
  on(CHANNEL_WORKSPACE_CREATE, (input) =>
    requireService().createWorkspace({ name: readText(input, 'name', true) }),
  );
  on(CHANNEL_WORKSPACE_RENAME, (input) =>
    requireService().renameWorkspace({ id: readText(input, 'id'), name: readText(input, 'name', true) }),
  );
  on(CHANNEL_WORKSPACE_SWITCH, async (input) => {
    const result = await requireService().switchWorkspace({ id: readText(input, 'id') });
    // Q4：DbHandle 不变，只广播活动工作区变更 → 各窗口重载树
    broadcastWorkspaceChanged(result.activeId);
    return result;
  });
}

function registerIpcHandlers(ctx: PlatformContext, service: PagesService | null): void {
  const logger = ctx.logger.forModule('main');

  ipcMain.handle(CHANNEL_PING, () => {
    const stamp = new Date().toISOString();
    logger.info(`ipc ${CHANNEL_PING} -> ${stamp}`);
    return stamp;
  });

  ipcMain.handle(CHANNEL_META, () => ({
    name: app.getName(),
    version: app.getVersion(),
    schemaVersion: SCHEMA_VERSION,
    // 隐私默认：只暴露数据根目录名，不泄露完整家目录路径
    layoutRoot: basename(ctx.layout.root),
  }));

  registerPagesIpc(service);
}

// --- 生命周期 ---------------------------------------------------------------

async function bootstrapApplication(): Promise<void> {
  const ctx = await initPlatform();
  platformContext = ctx;

  const logger = ctx.logger.forModule('main');
  app.setPath('crashDumps', ctx.layout.crashDumps);

  const service = await bootstrapDatabase(ctx);
  registerIpcHandlers(ctx, service);
  createWindow();
  logger.info(`app ready, schemaVersion=${SCHEMA_VERSION}`);

  // macOS：点 Dock 图标且无窗口时重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  // 此时尚未 initPlatform（它在 ready 之后），只能用 console 兜底
  console.warn('[septcats] 另一实例已持有单实例锁，本次启动退出');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  app.whenReady().then(bootstrapApplication).catch((error: unknown) => {
    const reason = error instanceof Error ? error.stack ?? error.message : String(error);
    const logger = platformContext?.logger.forModule('main') ?? null;
    if (logger !== null) {
      logger.error(`启动失败：${reason}`);
    } else {
      console.error(`[septcats] 启动失败：${reason}`);
    }
    app.quit();
  });

  app.on('will-quit', () => {
    void dbHandle?.dispose();
    dbHandle = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
