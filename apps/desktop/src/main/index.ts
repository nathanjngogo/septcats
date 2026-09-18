import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol } from 'electron';
import { autoUpdater } from 'electron-updater';
import { SCHEMA_VERSION, type ActorId } from '@septcats/core';
import { readSettings, writeSettings } from '@septcats/platform';
import { startDbServer, type DbHandle } from '../db/client';
import {
  CHANNEL_DIAG_CONFIRM,
  CHANNEL_DIAG_EXPORT,
  CHANNEL_FAV_LIST,
  CHANNEL_FAV_SET,
  CHANNEL_IMPORT_CANCEL,
  CHANNEL_IMPORT_EXECUTE,
  CHANNEL_IMPORT_PICK,
  CHANNEL_IMPORT_PLAN,
  CHANNEL_IMPORT_PROGRESS,
  CHANNEL_META,
  CHANNEL_PALETTE_TOGGLE,
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
  CHANNEL_SETTINGS_GET,
  CHANNEL_SETTINGS_PATCH,
  CHANNEL_SYNC_STATE,
  CHANNEL_COLLAB_UPDATE,
  CHANNEL_WORKSPACE_CHANGED,
  CHANNEL_WORKSPACE_CREATE,
  CHANNEL_WORKSPACE_LIST,
  CHANNEL_WORKSPACE_RENAME,
  CHANNEL_WORKSPACE_SWITCH,
} from '../shared/ipc';
import type { UpdateState } from '../shared/updater';
import { CHANNEL_UPDATE_STATE } from '../shared/ipc';
import {
  parseFeedUrlFromYml,
  registerUpdaterIpc,
  type AutoUpdaterLike,
} from './updater';
import { createAssetRequestHandler, ASSET_SCHEME, ATTACHMENT_SCHEME, assetSchemePrivileges } from './assets';
import { buildDiagnosticPackage } from './diag';
import { patchAppSettings, readAppSettings } from './settings';
import {
  PagesApiError,
  createPagesService,
  toPagesError,
  type MovePageInput,
  type PagesService,
  type StatementExecutor,
} from './pages';
import {
  createDbViewService,
  registerDbViewIpc,
  type DbViewIpcRegistrar,
  type DbViewService,
} from './dbview';
import { createSearchService, registerSearchIpc, type SearchService } from './search';
import {
  createBlocksService,
  registerBlocksIpc,
  type BlocksService,
} from './blocks';
import {
  createTemplatesService,
  registerTemplatesIpc,
  type TemplatesService,
} from './templates';
import {
  createImporterService,
  toImporterError,
  type ImporterService,
} from './importer';
import { initPlatform, type PlatformContext } from './platform';
import { SyncRuntime } from './sync/runtime';
import { SyncKeyring } from './sync/keyring';
import { registerSyncIpc } from './sync/ipc';
import { withSyncHook } from './sync/bridge';
import { CollabHub, registerCollabIpc } from './collab';
import { AiService } from './ai/service';
import { registerAiIpc } from './ai/ipc';

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
let syncRuntime: SyncRuntime | null = null;
let collabHub: CollabHub | null = null;
let updaterService: { check(): Promise<UpdateState>; dispose(): void } | null = null;

// --- 启动打点（TASK-T14-01 §2：--perf-trace 门，默认关 = 零开销） --------------

const PERF_TRACE = process.argv.includes('--perf-trace');
let perfStartedAt = 0;

/**
 * 首窗 did-finish-load 时记录 whenReady→首窗加载完成的差值：
 * 写 userData/perf-startup.json + console.log `[perf] startup_ms=`（perf-pack.mjs 消费）。
 */
function captureStartupPerf(userDataDir: string): void {
  const win = mainWindow;
  if (win === null) {
    return;
  }
  win.webContents.once('did-finish-load', () => {
    const startupMs = performance.now() - perfStartedAt;
    const payload = `${JSON.stringify({
      startup_ms: Number(startupMs.toFixed(1)),
      measured_at: new Date().toISOString(),
    }, null, 2)}\n`;
    const path = join(userDataDir, 'perf-startup.json');
    try {
      mkdirSync(userDataDir, { recursive: true });
      writeFileSync(path, payload, 'utf8');
    } catch (error) {
      console.error(`[perf] 写 ${path} 失败：${describeError(error)}`);
    }
    console.log(`[perf] startup_ms=${startupMs.toFixed(1)}`);
  });
}

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

// asset://（导入附件）与 attachment://（编辑器 file_id）需在 app ready 前声明特权。
protocol.registerSchemesAsPrivileged(assetSchemePrivileges() as Parameters<typeof protocol.registerSchemesAsPrivileged>[0]);

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

/** 起库后造出的六套服务（页面树 / 行内数据库 / 搜索 / 导入器 / 块 / 模板），共用同一 DbHandle 与 actor。 */
interface DatabaseServices {
  pages: PagesService;
  db: DbViewService;
  search: SearchService;
  importer: ImporterService;
  blocks: BlocksService;
  templates: TemplatesService;
}

/**
 * 起 DbServer → 迁移 → 造 pagesApi + dbViewService + SyncRuntime。
 * 失败**不阻断开窗**：注册的 IPC 会统一回 `E_INVARIANT`/`E_DB_UNAVAILABLE: 数据库服务不可用`，
 * 渲染器据此走 ErrorPanel（比窗都开不出来可诊断）。
 * M8b：BatchExecutor 经 withSyncHook 装饰（不动 commit.ts）——commitOps 成功后把
 * 新 op 喂给 SyncRuntime 攒段发布；运行时自身 apply 远端 op 用未装饰的 raw handle。
 */
async function bootstrapDatabase(ctx: PlatformContext): Promise<DatabaseServices | null> {
  const logger = ctx.logger.forModule('db');
  try {
    const handle = await startDbServer({ dbPath: ctx.layout.db });
    dbHandle = handle;
    const migrated = await handle.migrate();
    logger.info(`DbServer 就绪 v${String(migrated.from)}→v${String(migrated.to)} pid=${String(handle.pid ?? 0)}`);
    const actor = deriveActorId(await readMetaValue(handle, 'device_id'));

    // M8b：同步运行时（layout.root/sync 为同步文件夹；启动失败只降级，不阻断开窗）
    let pagesRef: PagesService | null = null;
    const syncLogger = ctx.logger.forModule('sync');
    // 装饰执行面（T13-01 引入，T19-05 起协作枢纽共用）：页面/行内库/搜索/导入器的
    // 写路径成功后进攒段器；sync 启动失败时回落裸 handle（普通路径照常）。
    let executor: StatementExecutor = handle;
    try {
      const runtime = new SyncRuntime({
        rootDir: join(ctx.layout.root, 'sync'),
        db: handle,
        actor,
        enabled: readSettings(ctx.userDataDir).sync.enabled,
        workspaceId: async () => {
          const pages = pagesRef;
          if (pages === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区');
          }
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，远端 op 无法物化');
          }
          return workspaces.activeId;
        },
        clientVer: app.getVersion(),
        keyring: new SyncKeyring(ctx.credentials),
        encryptEnabled: () => readSettings(ctx.userDataDir).sync.encrypt,
        gcEnabled: () => readSettings(ctx.userDataDir).sync.gc,
        log: (line) => syncLogger.info(line),
      });
      syncRuntime = runtime;
      runtime.onState((status) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(CHANNEL_SYNC_STATE, status);
        }
      });
      executor = withSyncHook(handle, (ops) => {
        syncRuntime?.onLocalCommit(ops);
      });

      // T19-05 协作枢纽（须在 runtime.start() 之前接好下行监听，首轮报告不丢）：
      // 上行组 Op 走装饰后 executor（batch 里的 opLedger.insert 自动进攒段器）；
      // 下行 = hub Y.Doc 应用 + renderer 广播；快照播种接 runtime 跨代聚合口。
      const hub = new CollabHub({
        executor,
        actor,
        log: (line) => ctx.logger.forModule('collab').info(line),
        snapshotCrdtUpdates: async () => {
          const active = syncRuntime;
          return active !== null ? await active.getSnapshotCrdtUpdates() : [];
        },
      });
      collabHub = hub;
      runtime.onCrdtUpdates((entries) => {
        hub.applyRemote(entries);
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(CHANNEL_COLLAB_UPDATE, entries);
        }
      });
      await runtime.start();
    } catch (error) {
      syncRuntime = null;
      collabHub = null;
      syncLogger.error(`SyncRuntime 启动失败（同步停用）：${describeError(error)}`);
    }

    const pages = createPagesService({ executor, actor });
    pagesRef = pages;
    return {
      pages,
      db: createDbViewService({ executor, actor }),
      search: createSearchService({ executor: handle }),
      importer: createImporterService({
        executor,
        actor,
        attachmentsDir: ctx.layout.attachments,
        activeWorkspaceId: async () => {
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，无法导入');
          }
          return workspaces.activeId;
        },
      }),
      // T21-01：块服务——写路径复用同一装饰后 executor（commitOps 成功即进攒段器）
      blocks: createBlocksService({
        executor,
        activeWorkspaceId: async () => {
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，块 Op 无法物化');
          }
          return workspaces.activeId;
        },
      }),
      // T23-01：模板服务——写路径同样复用装饰后 executor（batch 成功即进攒段器）
      templates: createTemplatesService({
        executor,
        actor,
        activeWorkspaceId: async () => {
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，模板 Op 无法物化');
          }
          return workspaces.activeId;
        },
      }),
    };
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

/** Ctrl/Cmd+K（TASK-T8-01 §3「主进程全局」一路；renderer 内监听为另一路，后者优先）。 */
const PALETTE_SHORTCUT = 'CommandOrControl+K';

function broadcastPaletteToggle(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CHANNEL_PALETTE_TOGGLE, {});
  }
}

function registerPaletteShortcut(): void {
  if (globalShortcut.isRegistered(PALETTE_SHORTCUT)) {
    globalShortcut.unregister(PALETTE_SHORTCUT);
  }
  globalShortcut.register(PALETTE_SHORTCUT, broadcastPaletteToggle);
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

/** 把 `ipcMain.handle` 适配成 DbView 注册器的最小 `handle(channel, listener)` 面。 */
function dbViewRegistrar(): DbViewIpcRegistrar {
  return {
    handle: (channel, listener): void => {
      ipcMain.handle(channel, (_event: unknown, raw: unknown): Promise<unknown> => listener(raw));
    },
  };
}

/** 诊断包落盘目录（userData/diagnostics），文件名带时间戳。 */
function diagnosticFilePath(userDataDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return join(userDataDir, 'diagnostics', `diag-${stamp}.json`);
}

/** 读取数据库 `PRAGMA user_version`（迁移版本）；DbServer 不可用/失败时回 0。 */
async function readDbUserVersion(): Promise<number> {
  if (dbHandle === null) {
    return 0;
  }
  try {
    return (await dbHandle.migrate()).to;
  } catch {
    return 0;
  }
}

/** 组装诊断包构建入参（脱敏基准 = homeDir；settings 取完整内容）。 */
async function gatherDiagnosticPackage(ctx: PlatformContext): Promise<{ path: string; preview: string }> {
  const userVersion = await readDbUserVersion();
  const pkg = await buildDiagnosticPackage({
    appVersion: app.getVersion(),
    platform: process.platform,
    userVersion,
    dbFilePath: ctx.layout.db,
    logsDir: ctx.layout.logs,
    syncDir: ctx.layout.root,
    homeDir: ctx.homeDir,
    settings: readSettings(ctx.userDataDir),
  });
  return {
    path: diagnosticFilePath(ctx.userDataDir),
    preview: JSON.stringify(pkg, null, 2),
  };
}

function registerIpcHandlers(ctx: PlatformContext, services: DatabaseServices | null): void {
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

  // 设置（M9）：get 回整份（data.note = 同步目录）；patch 严格校验后落盘并回整份
  ipcMain.handle(CHANNEL_SETTINGS_GET, () => readAppSettings(ctx.userDataDir, ctx.layout.root));
  ipcMain.handle(CHANNEL_SETTINGS_PATCH, (_event: unknown, raw: unknown) =>
    patchAppSettings(ctx.userDataDir, ctx.layout.root, raw),
  );

  // 诊断（M9）：export 只生成预览（不落盘）；confirm 才写最终文件
  ipcMain.handle(CHANNEL_DIAG_EXPORT, () => gatherDiagnosticPackage(ctx));
  ipcMain.handle(CHANNEL_DIAG_CONFIRM, async () => {
    const { preview } = await gatherDiagnosticPackage(ctx);
    const path = diagnosticFilePath(ctx.userDataDir);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${preview}\n`, 'utf8');
    renameSync(tmp, path);
    return { path };
  });

  registerPagesIpc(services?.pages ?? null);
  registerDbViewIpc(services?.db ?? null, dbViewRegistrar());
  registerSearchIpc(services?.search ?? null, dbViewRegistrar());
  registerImporterIpc(services?.importer ?? null);
  // 块读写（T21-01）：blocks:list / blocks:commit；blocks:changed 只保留通道名不推送
  registerBlocksIpc(services?.blocks ?? null, dbViewRegistrar());
  // 模板（T23-01）：templates:* 六通道
  registerTemplatesIpc(services?.templates ?? null, dbViewRegistrar());

  // 同步运行时（M8b）：status / setEnabled / now 三通道 + 状态推流（sync:state 在
  // bootstrapDatabase 的 onState 里广播）。runtime 缺失时统一回 E_INVARIANT。
  registerSyncIpc({
    registrar: dbViewRegistrar(),
    getRuntime: () => syncRuntime,
    persistEnabled: (on) => {
      // writeSettings 只收整份 SeptcatsSettings：读当前 → 只改 sync.enabled → 回写
      const current = readSettings(ctx.userDataDir);
      writeSettings(ctx.userDataDir, { ...current, sync: { ...current.sync, enabled: on } });
    },
  });

  // 协作（T19-05）：collab:attach / detach / apply 三通道；下行经
  // bootstrapDatabase 的 onCrdtUpdates 监听广播（collab:update）。hub 缺失回 E_INVARIANT。
  registerCollabIpc({
    registrar: dbViewRegistrar(),
    getHub: () => collabHub,
  });

  // AI（M11 · TASK-T18-01 §2.11）：五通道；net.fetch 包装注入（fetch 面最小化）。
  // AiService 无常驻资源，无需生命周期清理；启动零外联（listModels 只在被调用时发请求）。
  const aiLogger = ctx.logger.forModule('ai');
  const aiService = new AiService({
    credentials: ctx.credentials,
    getSettings: () => readSettings(ctx.userDataDir),
    fetchFn: async (url, init) => {
      const requestOptions: Parameters<typeof net.fetch>[1] = {
        method: init.method,
        headers: init.headers,
        signal: init.signal ?? null,
      };
      if (init.body !== undefined) {
        requestOptions.body = init.body;
      }
      const response = await net.fetch(url, requestOptions);
      return { ok: response.ok, status: response.status, text: () => response.text() };
    },
    log: (line) => aiLogger.info(line),
  });
  registerAiIpc({ registrar: dbViewRegistrar(), getService: () => aiService });

  // 自动更新（M10-B · TASK-T12-01B）：electron-updater 注入，五通道 + 启动 5s 后自动检查一次
  updaterService = registerUpdaterIpc({
    registrar: dbViewRegistrar(),
    broadcast: (state: UpdateState): void => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(CHANNEL_UPDATE_STATE, state);
      }
    },
    updater: autoUpdater as AutoUpdaterLike,
    // feed 真相接线（缺陷账 #29）：打包环境从 app-update.yml 解析 feed URL 显式注入；
    // 解析失败/未打包传 null（null=占位 file:// 源，预验签按非 http 分支跳过并记日志；
    // undefined 才是"接线丢失"，会被 check() 拒绝）。
    feedUrl: resolvePackagedFeedUrl(),
    fetch: async (url: string) => {
      const response = await net.fetch(url);
      return {
        ok: response.ok,
        status: response.status,
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
      };
    },
    env: process.env,
    isPackaged: app.isPackaged,
    autoCheckDelayMs: 5000,
    log: (line: string): void => {
      logger.info(`[updater] ${line}`);
    },
  });
}

/**
 * 打包环境的 feed URL：electron-builder 把 publish 配置写进
 * `<resourcesPath>/app-update.yml`；未打包（dev）返回 null。
 * 读失败也回 null——check() 的 http 分支会因 feedUrl=null 走非 http 跳过路径，
 * 而占位 file:// feed 在 electron-updater 侧本就会报 E_UPDATE_FAILED（⑫ 实测），
 * 不存在"静默跳过验签还能装上"的窗口。
 */
function resolvePackagedFeedUrl(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  try {
    return parseFeedUrlFromYml(readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 注册 import:* 四通道（M12）。`service === null`（DB 启动失败）时统一回
 * `E_INVARIANT`；错误经 toImporterError 映射（PlanTooLargeError → E_TOO_LARGE 传导）。
 */
function registerImporterIpc(service: ImporterService | null): void {
  const requireService = (): ImporterService => {
    if (service === null) {
      throw new PagesApiError('E_INVARIANT', '数据库服务不可用（启动失败，见日志）');
    }
    return service;
  };

  const readPath = (input: InputRecord, key: string): string | undefined => {
    const value = input[key];
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.length === 0) {
      throw new PagesApiError('E_MALFORMED', `${key} 必须是非空字符串`);
    }
    return value;
  };

  const on = (channel: string, run: (input: InputRecord) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (_event: unknown, raw: unknown): Promise<unknown> => {
      try {
        return await run(asInput(raw));
      } catch (error) {
        const mapped = toImporterError(error);
        throw new Error(`${mapped.code}: ${mapped.message}`);
      }
    });
  };

  on(CHANNEL_IMPORT_PLAN, async (input) => {
    const result = await requireService().plan({
      zipPath: readPath(input, 'zipPath'),
      dirPath: readPath(input, 'dirPath'),
      csvPath: readPath(input, 'csvPath'),
    });
    return result;
  });
  on(CHANNEL_IMPORT_EXECUTE, (input) => {
    const confirm = readFlag(input, 'confirm');
    if (!confirm) {
      throw new PagesApiError('E_MALFORMED', 'confirm 必须显式为 true');
    }
    return requireService().execute({ planId: readText(input, 'planId'), confirm: true });
  });
  on(CHANNEL_IMPORT_PROGRESS, (input) => requireService().progress({ planId: readText(input, 'planId') }));
  on(CHANNEL_IMPORT_CANCEL, (input) => requireService().cancel({ planId: readText(input, 'planId') }));

  // import:pick —— 系统文件对话框（renderer sandbox 拿不到路径）。按扩展名映射三态入口：
  // .zip → zipPath；.csv → csvPath；其余（目录 / 单 md 文件）→ dirPath（loader 内 statSync 分派）。
  ipcMain.handle(CHANNEL_IMPORT_PICK, async (): Promise<unknown> => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择导入源（Notion 导出 zip / Markdown 目录 / CSV）',
      properties: ['openFile', 'openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const picked = result.filePaths[0]!;
    const lower = picked.toLowerCase();
    if (lower.endsWith('.zip')) {
      return { zipPath: picked };
    }
    if (lower.endsWith('.csv')) {
      return { csvPath: picked };
    }
    return { dirPath: picked };
  });
}

// --- 生命周期 ---------------------------------------------------------------

async function bootstrapApplication(): Promise<void> {
  // 启动打点基点 = whenReady 兑现时刻（bootstrapApplication 由 whenReady().then 直接调用）
  if (PERF_TRACE) {
    perfStartedAt = performance.now();
  }
  const ctx = await initPlatform();
  platformContext = ctx;

  const logger = ctx.logger.forModule('main');
  app.setPath('crashDumps', ctx.layout.crashDumps);

  const services = await bootstrapDatabase(ctx);
  registerIpcHandlers(ctx, services);

  // asset:// / attachment://：导入附件内容寻址解析（TASK-T11-01 §C-3，main 侧协议方案）
  const assetHandler = createAssetRequestHandler(ctx.layout.attachments);
  protocol.handle(ASSET_SCHEME, assetHandler);
  protocol.handle(ATTACHMENT_SCHEME, assetHandler);

  createWindow();
  registerPaletteShortcut();
  if (PERF_TRACE) {
    captureStartupPerf(ctx.userDataDir);
  }
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
    globalShortcut.unregister(PALETTE_SHORTCUT);
    updaterService?.dispose();
    updaterService = null;
    collabHub?.dispose();
    collabHub = null;
    syncRuntime?.stop();
    syncRuntime = null;
    void dbHandle?.dispose();
    dbHandle = null;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
