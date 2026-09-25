import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, protocol, shell } from 'electron';
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
  CHANNEL_MENU_ACTION,
  CHANNEL_META,
  CHANNEL_PALETTE_TOGGLE,
  CHANNEL_PAGE_CREATE,
  CHANNEL_PAGE_CREATE_FOLDER,
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
import type { MenuActionId } from '../shared/ipc';
import { CLOSE_CHANNELS } from '../shared/ipc';
import { applyApplicationMenu } from './menu';
import { menuText, toMenuLocale, type MenuLocale } from './menuTemplate';
import { createCloseGuard, parseCloseDecision, type CloseGuard } from './closeGuard';
import { buildTrayMenuTemplate } from './trayTemplate';
import {
  createTray,
  destroyTray,
  getTray,
  getTrayMenu,
  refreshTrayMenu,
  resolveTrayIconPath,
  trayIconBaseDirs,
} from './tray';
import { iconCandidatePaths, pickFirstExisting, TRAY_ICON_NAMES, WINDOW_ICON_NAMES } from './iconAssets';
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
  defaultWorkspaceNameForLocale,
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
import { createLockService, type LockService } from './lock';
import { registerLockIpc } from './lockIpc';
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
  createWorkbenchTemplatesService,
  registerWorkbenchTemplatesIpc,
} from './workbenchTemplates';
import {
  createLinksService,
  rebuildLinksIndex,
  registerLinksIpc,
  type LinksService,
} from './links';
import {
  createPageExportService,
  registerPageExportIpc,
  type PageExportService,
} from './pageExport';
import {
  createPortableExportService,
  registerPortableExportIpc,
  type PortableExportService,
} from './portable';
import {
  createPortableImportService,
  registerPortableImportIpc,
  type PortableImportService,
} from './portableImport';
import { createShellService, registerShellIpc } from './shell';
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
/** 关窗拦截器（T54-01）：bootstrapApplication 里装配，createWindow 的 close 事件消费。 */
let closeGuard: CloseGuard | null = null;
/**
 * 真退出意图（T54-01 §1①）：托盘菜单「退出」/「重新启动更新」/ OS 关停置 true。
 * false 期的 close = **用户关窗** → 冲刷 + 按 settings.trayClose 路由（可能弹询问框）。
 */
let quittingFlag = false;

// --- 启动打点（TASK-T14-01 §2：--perf-trace 门，默认关 = 零开销） --------------

const PERF_TRACE = process.argv.includes('--perf-trace');
let perfStartedAt = 0;

/**
 * 首启迁移工作流（R28 · T80-02 / PRD §2）：`--import-portable <zip>`
 * （或 `--import-portable <dir>` —— 缺 zipPath 时按 dir 契约取目录内最新包）。
 * 下一个 argv 必须以路径形态给出（不以 `--` 开头），否则视为缺参、忽略。
 */
const IMPORT_PORTABLE_FLAG = '--import-portable';

function readImportPortableArg(argv: readonly string[]): string | null {
  const index = argv.indexOf(IMPORT_PORTABLE_FLAG);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
    return null;
  }
  return value;
}

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

/**
 * 窗口图标路径（T55-02 §1③）：查找序列与 tray.ts 同构（`iconAssets.ts` 纯函数展开，
 * 打包 resourcesPath → appPath → out/main 上溯两位）。找不到 → null = 交回可执行文件
 * 默认图标（不因缺图阻断建窗，口径同托盘）。
 */
function resolveWindowIconPath(): string | null {
  return pickFirstExisting(iconCandidatePaths(WINDOW_ICON_NAMES, trayIconBaseDirs(), join), existsSync);
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath();
  platformContext?.logger.forModule('main').info(`窗口图标解析：${iconPath ?? '(未找到，用可执行文件默认图标)'}`);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    // T53-01 灰阶谱内的 chrome 面（#FBFBFA 是暖白漏网项，与 DESIGN.md canvas #F5F5F5 对齐）
    backgroundColor: '#F5F5F5',
    title: 'Septcats',
    ...(iconPath === null ? {} : { icon: iconPath }),
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

  /**
   * 关窗拦截（T54-01 §1①）：用户关窗 → preventDefault → 冲刷未提交编辑 → 按
   * settings.trayClose 路由（ask 才弹自绘询问框）；真退出 → 同样先冲刷再放行
   * （`exiting` 态返回 false，不再拦）。closeGuard 未装配（初始化异常）时保持旧行为。
   */
  window.on('close', (event) => {
    const guard = closeGuard;
    if (guard === null) {
      return;
    }
    if (!guard.requestClose()) {
      return;
    }
    event.preventDefault();
  });

  window.on('closed', () => {
    closeGuard?.onWindowDestroyed('主窗口 closed');
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

// --- 关窗 / 托盘动作出口（T54-01 §1①③） --------------------------------------

/** 显示主窗口（无窗口则建窗）：托盘左键 toggle 与右键「显示主窗口」共用。 */
function showMainWindow(): void {
  const window = mainWindow;
  if (window === null) {
    createWindow();
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

/** 最小化到托盘：只隐藏，不销毁（进程与库连接保持存活，无窗口不假死）。 */
function hideMainWindowToTray(): void {
  const window = mainWindow;
  if (window === null) {
    return;
  }
  window.hide();
  platformContext?.logger.forModule('main').info('主窗口已最小化到托盘（进程保持存活）');
}

/** 托盘菜单「退出」：置 quittingFlag 后 app.quit（冲刷由 closeGuard 的真退出路径保证，不再弹框）。 */
function quitFromTray(): void {
  quittingFlag = true;
  platformContext?.logger.forModule('main').info('托盘菜单退出：quittingFlag=true → app.quit');
  app.quit();
}

const TRAY_MENU_ACTIONS = { show: showMainWindow, quit: quitFromTray };

/** 关窗拦截器装配（bootstrapApplication 调一次；依赖注入使状态机可单测）。 */
function installCloseGuard(ctx: PlatformContext): CloseGuard {
  const guard = createCloseGuard({
    isQuitting: () => quittingFlag,
    setQuitting: (value) => {
      quittingFlag = value;
    },
    readTrayClose: () => readSettings(ctx.userDataDir).trayClose,
    sendFlush: (requestId) => {
      const window = mainWindow;
      if (window === null || window.webContents.isDestroyed()) {
        throw new Error('无可用窗口，editor:flush 无法投递');
      }
      window.webContents.send(CLOSE_CHANNELS.flush, { requestId });
    },
    sendAsk: () => {
      const window = mainWindow;
      if (window === null || window.webContents.isDestroyed()) {
        throw new Error('无可用窗口，close:ask 无法投递');
      }
      window.webContents.send(CLOSE_CHANNELS.ask, {});
    },
    hideToTray: hideMainWindowToTray,
    quitApp: () => {
      app.quit();
    },
    persistTrayClose: (mode) => {
      // writeSettings 只收 patch：trayClose 单键写入，rootPath 与其它段按 merge 保住
      writeSettings(ctx.userDataDir, { trayClose: mode });
    },
    newRequestId: () => `flush-${String(Date.now())}-${String(process.pid)}`,
    log: {
      info: (message) => {
        ctx.logger.forModule('main').info(message);
      },
      warn: (message) => {
        ctx.logger.forModule('main').warn(message);
      },
    },
  });
  return guard;
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

/** 起库后造出的七套服务（页面树 / 行内数据库 / 搜索 / 导入器 / 块 / 模板 / 双链），共用同一 DbHandle 与 actor。 */
interface DatabaseServices {
  pages: PagesService;
  db: DbViewService;
  search: SearchService;
  importer: ImporterService;
  blocks: BlocksService;
  templates: TemplatesService;
  links: LinksService;
  lock: LockService;
  /** R27（T79-01）：页面导出 Markdown（只读消费；写盘只落用户选定目录）。 */
  pageExport: PageExportService;
  /** R28（T80-01）：便携包导出（zip；只读消费 + 原子写包本身）。 */
  portable: PortableExportService;
  /** R28（T80-02）：便携包导入（三段式换库：备份 → 重放 replace → 失败回滚）。 */
  portableImport: PortableImportService;
}

/** 本地账本 op_id 行里解不出的行 → 记为「未覆盖」（安全侧：宁可拒导，不可抹数据）。 */
const UNREADABLE_OP_ID_PREFIX = 'unparsable-op-row-';

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

    // T27-01 §0.A：首次建库的默认工作区名按「创建时 locale」种子
    // （zh* → 个人工作区，其余 → Personal Workspace；口径同 renderer i18n workspace.defaultName）
    const pages = createPagesService({
      executor,
      actor,
      defaultWorkspaceName: defaultWorkspaceNameForLocale(app.getLocale()),
    });
    pagesRef = pages;
    // T44-01：启动全量重建双链派生索引（派生态修复 + 旧库补齐；失败只记录，
    // 下次启动重试）——这也是「增量维护 == 全量重建」判据的兜底路径。
    void rebuildLinksIndex(handle)
      .then((links) => {
        logger.info(`双链派生索引重建完成：${String(links)} 行`);
      })
      .catch((error: unknown) => {
        logger.error(`双链派生索引重建失败（下次启动重试）：${describeError(error)}`);
      });
    // T67-01-B1-01：页面密码锁核心服务（DK 仅存会话 Map，落库只存盐/校验/包络密文）。
    // 与 blocks 共享同一会话实例——blocks:list 读路径接线（B2 范围0）依赖它判定解锁态。
    const lock = createLockService({ executor: handle });
    return {
      pages,
      db: createDbViewService({ executor, actor }),
      search: createSearchService({ executor: handle, lock }),
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
      lock,
      // T21-01：块服务——写路径复用同一装饰后 executor（commitOps 成功即进攒段器）；
      // T28-01：actor 是设备身份唯一真源，blocks:commit 写入前按它权威改写 op；
      // T67-01-B2-01 范围0：注入同一个 lock 服务，blocks:list 锁页返回 locked:true。
      blocks: createBlocksService({
        executor,
        actor,
        activeWorkspaceId: async () => {
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，块 Op 无法物化');
          }
          return workspaces.activeId;
        },
        lock,
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
      // T44-01：双链服务——派生索引维护/回链查询；用裸 handle（派生态不进攒段器，
      // 与 search 同款：derived 写不触发同步发布）
      links: createLinksService({ executor: handle }),
      // R27（T79-01）：页面导出——**全只读消费**（读库 + 读附件目录），写盘只落用户选定
      // 导出目录；目录选择走系统对话框（取消 = 零落盘），reveal 走 shell.openPath。
      pageExport: createPageExportService({
        executor,
        attachmentsDir: ctx.layout.attachments,
        activeWorkspaceId: async () => {
          const workspaces = await pages.listWorkspaces();
          if (workspaces.activeId === null) {
            throw new PagesApiError('E_NO_WORKSPACE', '无活动工作区，页面导出无法解析');
          }
          return workspaces.activeId;
        },
        pickDirectory: async () => {
          const options = {
            title: '选择导出目录',
            properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
          };
          const window = mainWindow;
          const result =
            window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          if (result.canceled || result.filePaths.length === 0) {
            return null;
          }
          return result.filePaths[0] ?? null;
        },
        openPath: async (dir) => {
          await shell.openPath(dir);
        },
      }),
      // R28（T80-01）：便携包导出——产物 = 单个 zip（主库 + 段 + 附件 + 清单）。
      // 顺序固定：加密闸 → wal_checkpoint(TRUNCATE) → 封段 → 打包 → tmp→rename；
      // 目录选择默认落在 `<数据根>/export`（PRD §1 产物位置），取消 = 零落盘。
      portable: createPortableExportService({
        dbPath: ctx.layout.db,
        syncDir: join(ctx.layout.root, 'sync'),
        attachmentsDir: ctx.layout.attachments,
        libraryName: async () => {
          const workspaces = await pages.listWorkspaces();
          const active = workspaces.items.find((item) => item.id === workspaces.activeId);
          return active?.name ?? basename(ctx.layout.root);
        },
        appVersion: app.getVersion(),
        schemaVersion: async () => (await handle.migrate()).to,
        checkpoint: async () => {
          await handle.checkpoint();
        },
        sealSegments: async () => {
          const runtime = syncRuntime;
          if (runtime === null) {
            return 0; // 同步未启用/启动失败：无攒段器即无未封段 op（段清单可能为空，manifest 留痕）
          }
          await runtime.flushAndPublish();
          return runtime.getStatus().pendingOps;
        },
        encrypted: () => readSettings(ctx.userDataDir).sync.encrypt,
        pickDirectory: async () => {
          const defaultPath = join(ctx.layout.root, 'export');
          const options = {
            title: '选择便携包保存目录',
            defaultPath,
            properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
          };
          const window = mainWindow;
          const result =
            window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          if (result.canceled || result.filePaths.length === 0) {
            return null;
          }
          return result.filePaths[0] ?? null;
        },
      }),
      // R28（T80-02）：便携包导入——plan 只读预检 → execute 三段式换库
      // （checkpoint → 备份 bak-portable-<ts> → rebuild replace → 失败逐字节还原）。
      // 停机边界：db 进程不重启（重放走既有 RPC），同步运行时走既有 stop()/start()。
      portableImport: createPortableImportService({
        dbPath: ctx.layout.db,
        db: {
          checkpoint: async () => {
            await handle.checkpoint();
          },
          // T80-04（H-09）：文件级还原前释放主库句柄（进程不杀、句柄身份不变），
          // 还原后按原路径重建连接。照 migrations.tryFileLevelRestore 的进程内形态。
          closeConnection: async () => {
            await handle.closeConnection();
          },
          reopenConnection: async () => {
            await handle.reopenConnection();
          },
          listLedgerOpIds: async () => {
            const data = await handle.all('opLedger.listAll', {});
            const ids: string[] = [];
            data.rows.forEach((row, index) => {
              const json = (row as { op_json?: unknown }).op_json;
              if (typeof json !== 'string') {
                ids.push(`${UNREADABLE_OP_ID_PREFIX}${String(index)}`);
                return;
              }
              try {
                const opId = (JSON.parse(json) as { op_id?: unknown }).op_id;
                ids.push(typeof opId === 'string' ? opId : `${UNREADABLE_OP_ID_PREFIX}${String(index)}`);
              } catch {
                ids.push(`${UNREADABLE_OP_ID_PREFIX}${String(index)}`);
              }
            });
            return ids;
          },
          rebuildFromSegments: async (segmentsJson, mode) => handle.rebuildFromSegments(segmentsJson, mode),
        },
        schemaVersion: async () => (await handle.migrate()).to,
        pickArchive: async () => {
          const defaultPath = join(ctx.layout.root, 'export');
          const options = {
            title: '选择便携包',
            defaultPath,
            filters: [{ name: '便携包', extensions: ['zip'] }],
            properties: ['openFile'] as Array<'openFile'>,
          };
          const window = mainWindow;
          const result =
            window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options);
          if (result.canceled || result.filePaths.length === 0) {
            return null;
          }
          return result.filePaths[0] ?? null;
        },
        pauseSync: async () => {
          syncRuntime?.stop();
        },
        // T80-04（H-08）：execute 覆盖度预检前强制封段（既有 flushAndPublish；
        // 不新造 flush 通道、不新增跨模块 getter）。runtime 为 null = 无攒段器。
        flushSegments: async () => {
          await syncRuntime?.flushAndPublish();
        },
        // T80-04（H-08）：覆盖度预检并集面——plan 不 flush（保持只读零副作用），
        // 改把「账本 ∪ 缓冲」当本机集合，故 plan 在未 flush 窗口也能正确 blocked。
        pendingOpIds: () => syncRuntime?.pendingOpIds() ?? [],
        resumeSync: async () => {
          const runtime = syncRuntime;
          if (runtime === null) {
            return;
          }
          try {
            await runtime.start();
          } catch (error) {
            syncLogger.error(`导入后同步重启失败（同步停用）：${describeError(error)}`);
          }
        },
        log: (line) => {
          logger.info(line);
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

// --- 原生应用菜单（TASK-T51-01 §1②） ----------------------------------------

/** 当前菜单语言（settings.locale 的解析结果；启动与每次 settings:patch 后更新）。 */
let menuLocale: MenuLocale = 'zh-CN';

/** 「关于」弹窗（跨平台；role:'about' 仅在 macOS 有效，故走 dialog）。 */
function showAboutDialog(locale: MenuLocale): void {
  const options = {
    type: 'info' as const,
    title: menuText(locale, 'helpAbout'),
    message: app.getName(),
    detail: `v${app.getVersion()} · schema v${String(SCHEMA_VERSION)}`,
    buttons: ['OK'],
  };
  if (mainWindow === null) {
    void dialog.showMessageBox(options);
    return;
  }
  void dialog.showMessageBox(mainWindow, options);
}

/**
 * 菜单动作出口：'about' 由 main 就地弹窗；其余广播给所有窗口，由 renderer 派发到
 * 既有 actions（Close Tab → closeActiveTab，绝不用 role:'close' 关窗口）。
 */
function handleMenuAction(action: MenuActionId): void {
  if (action === 'about') {
    showAboutDialog(menuLocale);
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CHANNEL_MENU_ACTION, { action });
  }
}

/** 按 locale 重建并安装应用菜单（启动即用当前 locale；语言切换后即时重建）。 */
function installApplicationMenu(locale: string): void {
  menuLocale = toMenuLocale(locale);
  applyApplicationMenu(menuLocale, handleMenuAction);
  // T54-01：托盘右键菜单 label 同源 i18n → 随语言切换即时重建
  refreshTrayMenu(menuLocale, TRAY_MENU_ACTIONS);
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
  on(CHANNEL_PAGE_CREATE_FOLDER, (input) =>
    requireService().createFolder({
      parentId: readNullableText(input, 'parentId'),
      title: readText(input, 'title', true),
    }),
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
  ipcMain.handle(CHANNEL_SETTINGS_PATCH, (_event: unknown, raw: unknown) => {
    const settings = patchAppSettings(ctx.userDataDir, ctx.layout.root, raw);
    // T51-01：语言（或任何设置）落盘后按新 locale 即时重建原生菜单
    installApplicationMenu(settings.locale);
    return settings;
  });

  // 关窗协作（T54-01 §1①②）：renderer 冲刷回执 + 询问框决议。
  ipcMain.handle(CLOSE_CHANNELS.flushAck, (_event: unknown, raw: unknown) => {
    const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const requestId = typeof record['requestId'] === 'string' ? record['requestId'] : '';
    const tasks = typeof record['tasks'] === 'number' ? record['tasks'] : 0;
    const failures = typeof record['failures'] === 'number' ? record['failures'] : 0;
    const matched = closeGuard?.ackFlush(requestId) ?? false;
    logger.info(
      `editor:flushAck requestId=${requestId} tasks=${String(tasks)} failures=${String(failures)} matched=${String(matched)}`,
    );
    return { ok: true };
  });
  ipcMain.handle(CLOSE_CHANNELS.decide, (_event: unknown, raw: unknown) => {
    const decision = parseCloseDecision(raw);
    closeGuard?.resolveAsk(decision);
    return { action: decision.action };
  });

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
  registerLockIpc(services?.lock ?? null, dbViewRegistrar());
  registerImporterIpc(services?.importer ?? null);
  // 块读写（T21-01）：blocks:list / blocks:commit；blocks:changed 只保留通道名不推送
  registerBlocksIpc(services?.blocks ?? null, dbViewRegistrar());
  // 模板（T23-01）：templates:* 七通道（含 saveWorkbench）
  registerTemplatesIpc(services?.templates ?? null, dbViewRegistrar());
  // 工作台内置模板（T72-01 §范围3）：workbenchTemplates:list 只读
  registerWorkbenchTemplatesIpc(createWorkbenchTemplatesService(), dbViewRegistrar());
  // 双链（T44-01）：links:backlinks / links:rebuild
  registerLinksIpc(services?.links ?? null, dbViewRegistrar());
  // 页面导出（R27 · T79-01）：page:export:preview / confirm / reveal 三通道
  registerPageExportIpc(services?.pageExport ?? null, dbViewRegistrar());
  // 便携包导出（R28 · T80-01）：portable:export:preview / confirm 两通道
  registerPortableExportIpc(services?.portable ?? null, dbViewRegistrar());
  // 便携包导入（R28 · T80-02）：portable:import:plan / execute / revert 三通道
  registerPortableImportIpc(services?.portableImport ?? null, dbViewRegistrar());
  // 外部链接（T73-01）：shell:openExternal 唯一出口——协议白名单（仅 http/https）+
  // 审计只记 host（URL 原文不进审计正文）。入口恒可用（不依赖 DbServer）。
  const shellLogger = ctx.logger.forModule('shell');
  registerShellIpc(
    createShellService({
      openExternal: (url) => shell.openExternal(url),
      log: (message, audit) => {
        shellLogger.info(message, audit);
      },
    }),
    dbViewRegistrar(),
  );

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

/** `--import-portable` 的目标：`.zip` 结尾按包路径，其余按 dir 契约（目录内取最新包）。 */
function importPortableInputOf(target: string): { readonly zipPath?: string; readonly dir?: string } {
  return target.toLowerCase().endsWith('.zip') ? { zipPath: target } : { dir: target };
}

/**
 * 首启导入（PRD §2 迁移工作流）：**开窗之前**跑完，保证首屏看到的就是导入后的库。
 * 失败只留日志（不阻断启动）：包坏 / 预检被拒 / 重放失败（已自动回滚）都在这里收口。
 */
async function runStartupPortableImport(
  ctx: PlatformContext,
  services: DatabaseServices | null,
  target: string,
): Promise<void> {
  const logger = ctx.logger.forModule('main');
  const service = services?.portableImport ?? null;
  if (service === null) {
    logger.error(`--import-portable 跳过：数据库服务不可用（启动失败，见日志）`);
    return;
  }
  try {
    const planned = await service.plan(importPortableInputOf(target));
    if ('canceled' in planned) {
      logger.info('--import-portable 已取消（零落盘）');
      return;
    }
    if (planned.blocked !== null) {
      logger.error(`--import-portable 被预检拒绝：${planned.blocked.code} ${planned.blocked.message}`);
      return;
    }
    const executed = await service.execute({ zipPath: planned.zipPath, confirm: true });
    if ('canceled' in executed) {
      logger.info('--import-portable 已取消（零落盘）');
      return;
    }
    logger.info(
      `--import-portable 完成：包=${executed.zipPath} 段=${String(executed.replay.segments)} op=${String(
        executed.replay.ops,
      )} 实体=${String(executed.replay.entities)} 备份=${executed.backupPath}`,
    );
  } catch (error) {
    logger.error(`--import-portable 失败（数据面未改动或已回滚）：${describeError(error)}`);
  }
}

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

  // R28（T80-02）：`--import-portable <zip|dir>` 首启迁移工作流（开窗前跑完）
  const importPortableTarget = readImportPortableArg(process.argv);
  if (importPortableTarget !== null) {
    await runStartupPortableImport(ctx, services, importPortableTarget);
  }

  // T54-01：关窗拦截器（须在 createWindow 之前装配——首窗的 close 事件立即用得上）
  closeGuard = installCloseGuard(ctx);

  // asset:// / attachment://：导入附件内容寻址解析（TASK-T11-01 §C-3，main 侧协议方案）
  const assetHandler = createAssetRequestHandler(ctx.layout.attachments);
  protocol.handle(ASSET_SCHEME, assetHandler);
  protocol.handle(ATTACHMENT_SCHEME, assetHandler);

  createWindow();
  // T54-01：托盘（左键 toggle、右键「显示主窗口 / 退出」）；无窗口时进程不假死
  createTray({
    locale: toMenuLocale(readSettings(ctx.userDataDir).locale),
    getWindow: () => mainWindow,
    actions: TRAY_MENU_ACTIONS,
    log: (message) => {
      logger.info(`[tray] ${message}`);
    },
  });
  // T51-01：启动即用当前 locale 装配原生应用菜单（替换 Electron 默认英文菜单）
  installApplicationMenu(readSettings(ctx.userDataDir).locale);
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

  /**
   * 真退出统一入口（T54-01 §1③）：app.quit / 托盘退出 / OS 关停（如更新安装）一律
   * 置 quittingFlag —— 此后主窗 close 走「冲刷后放行」，**不再弹询问框**。
   */
  app.on('before-quit', () => {
    quittingFlag = true;
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
    destroyTray();
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

// --- T54-01 真机取证口 -------------------------------------------------------
/**
 * 托盘实例没有 Electron 全局访问器（不像 `Menu.getApplicationMenu()`），真机探针
 * 只能经 main 进程 inspector `require` 本 bundle（模块缓存命中 → 同一实例）取句柄。
 * 这里只暴露**只读/同源动作**五项：
 *  - `getTray()`：托盘实例（存在性/左键监听器断言）；
 *  - `showMainWindow()`：托盘菜单「显示主窗口」的同一处理器（隐藏后恢复走这条路）；
 *  - `quitFromTray()`：托盘菜单「退出」的同一处理器（OS 级真点不可用时回落取证）；
 *  - `trayMenuTemplate(locale)`：托盘右键菜单模板（探针读原始 label/type JSON）；
 *  - `popTrayMenuOverWindow(x, y)`：把**托盘在建的同一个 Menu 实例**在窗口内弹成原生
 *    菜单（本机会话里 `Tray.popUpContextMenu()` 不渲染可见菜单，见 T54-01 报告 D-2）。
 * 产品代码路径不读它，无行为副作用；正式发布面（打包/安装）留 PM。
 */
export const t54Probe = {
  getTray,
  showMainWindow,
  quitFromTray,
  trayMenuTemplate: (locale: string): unknown =>
    buildTrayMenuTemplate(toMenuLocale(locale), TRAY_MENU_ACTIONS).map((item) => ({
      type: item.type ?? 'normal',
      label: item.label ?? null,
    })),
  popTrayMenuOverWindow: (x: number, y: number): boolean => {
    const menu = getTrayMenu();
    const window = mainWindow;
    if (menu === null || window === null) {
      return false;
    }
    menu.popup({ window, x, y });
    return true;
  },
};

// --- T55-02 真机取证口 -------------------------------------------------------
/**
 * 图标「解析到哪个文件」的只读取证口（TASK-T55-02 §1⑥）：探针据此断言托盘/窗口
 * 图标真的命中新像素资产，而不是回落空图或旧 `.ico`。等价于在 main 进程里调一次
 * 真机解析，无副作用、不被产品代码路径调用。
 */
export const t55Probe = {
  trayIconPath: resolveTrayIconPath,
  windowIconPath: resolveWindowIconPath,
  /** 两份候选序列原文（探针据此断言「icon-tray.png 恒排在 icon.ico 之前」）。 */
  iconCandidates: (): { tray: string[]; window: string[] } => ({
    tray: iconCandidatePaths(TRAY_ICON_NAMES, trayIconBaseDirs(), join),
    window: iconCandidatePaths(WINDOW_ICON_NAMES, trayIconBaseDirs(), join),
  }),
};
