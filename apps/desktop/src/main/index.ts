import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeTheme, net, protocol, screen, shell } from 'electron';
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
  CHANNEL_MENU_CLICK,
  CHANNEL_MENU_ROLE,
  CHANNEL_META,
  CHANNEL_DESKTOP_WALLPAPER,
  CHANNEL_WALLPAPER_GEOMETRY,
  CHANNEL_THEME_CHROME,
  CHANNEL_WINDOW_GET_STATE,
  CHANNEL_WINDOW_MINIMIZE,
  CHANNEL_WINDOW_MAXIMIZE_TOGGLE,
  CHANNEL_WINDOW_CLOSE,
  WINDOW_CHANNELS,
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
import { MENU_ACTIONS, type MenuActionId } from '../shared/ipc';
import type { ThemeMode } from '../shared/settings';
import { ASSETGC_CHANNELS, CLOSE_CHANNELS, DBGC_CHANNELS } from '../shared/ipc';
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
import { CHROME_BACKGROUND, resolveChromeOverlay, resolveChromeTheme, type ChromeTheme } from './windowChromeTheme';
import { decodeRegOutput, parseRegScalar, parseWallpaperRegValue, probeWallpaperImageSize, wallpaperToDataUrl } from './desktopWallpaper';
import { computeWallpaperGeometry, normalizeWallpaperStyle, type WallpaperFillMode } from './wallpaperGeometry';
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
import { createCalendarService, type CalendarService, registerCalendarIpc } from './calendar';
import { createTodoService, type TodoService, registerTodoIpc } from './todo';
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
// T81-01：DB 面墓碑物理清除（planDbGc 在 @septcats/sync，执行面在本模块）
import { createDbGcService, type DbGcService } from './dbgc';
import { createAssetGcService, type AssetGcService } from './assetGc';
import { createShellService, registerShellIpc } from './shell';
import { attachNavigationGuard } from './navigationGuard';
import {
  createImporterService,
  toImporterError,
  type ImporterService,
} from './importer';
import { initPlatform, type PlatformContext } from './platform';
import { SyncRuntime } from './sync/runtime';
import { AttachmentSyncService } from './sync/attachments';
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

/** T84-01：app:restart 去重标记（folder 变更后重启链只排一次）。 */
let restartPending = false;

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
    // T87-01：窗口预绘底色跟随应用主题（light #F5F5F5 / dark #141414 = canvas token，
    // 与 DESIGN.md 对齐；旧版写死浅色 → 深色档启动白闪一帧 + OS 标题栏不随主题）。
    backgroundColor: CHROME_BACKGROUND[currentChromeTheme],
    title: 'Septcats',
    // T89-01（老板圈图「这上面为什么没有跟着主题走？」）：Windows 撤 OS 原生标题栏
    // （OS 条只认明暗一轴，配色/质感不理会）→ 自绘标题带吃全套 token。
    // C 轮（老板 09-29：「右上角颜色像补丁」+拍板「全自绘窗口按钮」）：titleBarOverlay
    // 整撤——OS 平面色块永远追不上渐变玻璃带（真机实测按钮区 #5D345E vs 带体 #2E2246
    // 差 60+）；min/max/close 改 renderer 自绘（TitleBarBand 按钮组，close 走
    // win.close()=closeGuard 同链路）。烟测 glass-hidden-nooverlay-smoke.cjs 实证
    // hidden 不配 overlay 时 OS 按钮彻底消失、原生边框/圆角/贴边吸附保留。
    // macOS 保留原生惯例不动。
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden' as const } : {}),
    ...(iconPath === null ? {} : { icon: iconPath }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  /*
   * T96-01 外链与导航兜底（0.6.9 静态包审 A8 发现）：renderer 里 `window.open` /
   * `<a target="_blank">` / 未被应用拦下的 `<a href>`，在 Electron 默认行为下会新开一个
   * 真窗口，或把主窗直接导航到远端页面 —— 两条路都绕过 shell:openExternal 的协议白名单
   * 唯一出口（T73-01）。此处按 navigationGuard 的规则收口：站内放行；站外 http(s) 转交
   * 系统浏览器后拦下；其他协议拦下且不外发。审计只记 host/protocol、不落 URL 原文。
   */
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'] ?? '';
  const isAppPage = (url: string): boolean =>
    url.startsWith('file://') || (devServerUrl.length > 0 && url.startsWith(devServerUrl));
  // 内部协议（asset:/attachment:）是应用自己的图床/附件视图：**导航**放行，
  // 但不开新窗（实测：放行 window.open 会留下空白窗）。
  const isInternalUrl = (url: string): boolean =>
    isAppPage(url) || url.startsWith(`${ASSET_SCHEME}:`) || url.startsWith(`${ATTACHMENT_SCHEME}:`);
  const guardLogger = platformContext?.logger.forModule('main');
  attachNavigationGuard(
    window.webContents as unknown as Parameters<typeof attachNavigationGuard>[0],
    {
      isInternal: isInternalUrl,
      isWindowOpenAllowed: isAppPage,
      routeExternal: (url) => {
        void shell.openExternal(url);
      },
      audit: (event, reason, host, protocol) => {
        guardLogger?.info(`导航守卫：${event} ${reason}`, { host, protocol });
      },
    },
  );

  window.once('ready-to-show', () => {
    window.show();
    platformContext?.logger.forModule('main').info('window ready-to-show');
    // C 轮：首帧即发一次壁纸几何——实时透明不能等用户拖动窗口才有映射
    // （启动即对：壁纸层一开始就锚在屏幕正确位置）。
    sendWallpaperGeometry(window);
    // T87-01 自证：新窗就绪即报 Chromium 明暗（= OS 标题栏采用态；main→renderer 单向读，
    // 不受 CDP attach 对 matchMedia 的干扰——口径详见 applyChromeTheme 注释与 t87 探针头注）。
    void window.webContents
      .executeJavaScript("JSON.stringify({mm:matchMedia('(prefers-color-scheme: dark)').matches})")
      .then((r) => {
        platformContext?.logger
          .forModule('main')
          .info(`chromeTheme windowState(${currentChromeTheme}): ${String(r)}`);
      })
      .catch(() => undefined);
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

  // T89-01：最大化/还原态广播（自绘标题带的叠窗图标联动 + 探针断言信号）。
  const pushWindowState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(WINDOW_CHANNELS.state, { maximized: window.isMaximized() });
    }
  };
  window.on('maximize', pushWindowState);
  window.on('unmaximize', pushWindowState);

  // C 轮「实时透明」（老板拍板「移动即实时」）：窗口在桌面上动，玻璃里透的壁纸就得跟着
  // 视差动——move/resize/最大化切换都广播壁纸几何（40ms 节流，拖动 ~25fps 足够顺）。
  let geomTimer: NodeJS.Timeout | null = null;
  let geomTrailing = false;
  const pushGeometry = (): void => {
    if (window.isDestroyed()) {
      return;
    }
    if (geomTimer !== null) {
      geomTrailing = true;
      return;
    }
    sendWallpaperGeometry(window);
    geomTimer = setTimeout(() => {
      geomTimer = null;
      if (geomTrailing) {
        geomTrailing = false;
        pushGeometry();
      }
    }, 40);
  };
  // 逐字面量挂（union key 不匹配 Electron on() 的字面量重载 = TS no overload）
  window.on('move', pushGeometry);
  window.on('resize', pushGeometry);
  window.on('maximize', pushGeometry);
  window.on('unmaximize', pushGeometry);

  if (devServerUrl.length > 0) {
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
  /** T97-01 日历：设备本地派生态（同 lock 口径，走 handle 不经 Op 装饰器）。 */
  calendar: CalendarService;
  /** T98-01 待办：同口径本地派生态。 */
  todo: TodoService;
  /** R27（T79-01）：页面导出 Markdown（只读消费；写盘只落用户选定目录）。 */
  pageExport: PageExportService;
  /** R28（T80-01）：便携包导出（zip；只读消费 + 原子写包本身）。 */
  portable: PortableExportService;
  /** R28（T80-02）：便携包导入（三段式换库：备份 → 重放 replace → 失败回滚）。 */
  portableImport: PortableImportService;
  /** T81-01：DB 面墓碑物理清除（planDbGc 判据 + 分批 DELETE；op_ledger 不动）。 */
  dbgc: DbGcService;
  assetgc: AssetGcService;
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
/** T84-01：同步文件夹解析口（settings.sync.folder 为空 = 默认 `<数据根>/sync`）。 */
function syncFolderFor(ctx: PlatformContext): string {
  const folder = readSettings(ctx.userDataDir).sync.folder.trim();
  return folder.length > 0 ? folder : join(ctx.layout.root, 'sync');
}

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
      // T84-02（PRD-T84 方案 A，老板 09-26「同意」）：附件双向队列引擎。引用枚举
      // 复用 assetGc 六路（红线）；加密面 DEK 经 runtime.currentDek 晚绑（构造序）。
      // 一期只增不删（files/ 永不删，GC 随 G6）。节拍=sync 轮（无独立定时器）。
      let attachRuntimeRef: SyncRuntime | null = null;
      const attachments = new AttachmentSyncService({
        attachmentsDir: ctx.layout.attachments,
        syncRoot: syncFolderFor(ctx),
        executor: handle,
        encryptEnabled: () => readSettings(ctx.userDataDir).sync.encrypt,
        dek: () => attachRuntimeRef?.currentDek() ?? null,
        log: (line) => syncLogger.info(line),
      });
      const runtime = new SyncRuntime({
        rootDir: syncFolderFor(ctx),
        db: handle,
        attachments,
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
      // 真机探针钩子（同 PERF_TRACE 口径）：env 注入毫秒把周期压缩到分钟级内收口
      const probeMergeMs = Number(process.env['SEPTCATS_SYNC_MERGE_MS'] ?? '');
      if (Number.isFinite(probeMergeMs) && probeMergeMs > 0) {
        runtime.setMergeIntervalForProbe(probeMergeMs);
      }
      syncRuntime = runtime;
      attachRuntimeRef = runtime;
      runtime.onState((status) => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(CHANNEL_SYNC_STATE, status);
        }
        // T84-01：托盘状态行随跃迁即时刷新（低频事件；数据源经 currentSyncStatus 拉最新）
        refreshTrayMenu(menuLocale, TRAY_MENU_ACTIONS);
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
    // T97-01 日历 / T98-01 待办：设备本地派生态（同 lock 口径，走 handle 不走 Op 装饰器）。
    // 老板 09-30 令：「在知识库功能下方增加日历功能，增加待办功能」。
    const calendar = createCalendarService({ executor: handle });
    const todo = createTodoService({ executor: handle });
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
      calendar,
      todo,
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
      // T81-01：DB 面墓碑物理清除——维护面写（白名单 DELETE 语句，不是 Op 路径），
      // 故用裸 handle（同 links/lock：派生态不进攒段器，绝不伪造 op）；op_ledger 不动。
      dbgc: createDbGcService({ executor: handle }),
      // T83-02：附件目录孤儿回收——引用枚举走裸 handle 只读 SELECT（六路语句），
      // 真删只动 attachments/ 的 fs（不进攒段器、不造 op）；启动后台不跑，仅入口按钮。
      assetgc: createAssetGcService({
        executor: handle,
        attachmentsDir: ctx.layout.attachments,
        onPlan: (names, bytes) => {
          logger.info(
            `附件 GC 清单（${String(names.length)} 个 / ${String(bytes)}B）：` +
              names.slice(0, 50).join(',') + (names.length > 50 ? ',…' : ''),
          );
        },
      }),
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
        syncDir: syncFolderFor(ctx),
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
        // T80-06（H-10）：段目录快照/还原面（与 SyncRuntime 的 rootDir、导出侧 syncDir 同源）。
        syncDir: syncFolderFor(ctx),
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
  // T87-02：自绘菜单带的「退出」（Win 撤原生菜单后由 renderer 发起）→ 托盘退出同路径
  if (action === 'quit') {
    quitFromTray();
    return;
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CHANNEL_MENU_ACTION, { action });
  }
}

// --- 窗口原生主题（TASK-T87-01） ---------------------------------------------

/** 当前窗口 chrome 明暗态（启动即从 settings.theme 解析；settings:patch 后重解）。 */
let currentChromeTheme: ChromeTheme = 'light';

/**
 * T90-01B：桌面壁纸衬底读取（老板红线「跟着背景变色」的落地通道）。
 * DWM acrylic 路线已整段撤除（本机实测材质恒死灰，见 desktopWallpaper.ts 头注）。
 * 注册表两查询 = HKCU 实际路径优先、登录前策略键兜底；任何异常返回 null，
 * renderer 拿到 null 保持实心——通透宁缺毋滥。壁纸内容不落日志（隐私红线）。
 */
function regQueryValue(key: string, name: string): string | null {
  try {
    // 09-29 C 轮终修（真机两连坑）：reg.exe 直调与 `powershell -Command reg query` 都
    // 会在 argv/引号层吃掉键路径反斜杠（HKCU\Control Panel\Desktop →
    // HKCUControl PanelDesktop = Invalid key name，现场复现）。正解=PowerShell 原生注册表
    // 驱动 Get-ItemProperty（drive 语法、单引号内无转义地狱）；输出伪造回
    // `name REG_SZ value` 行——下游 parseWallpaperRegValue/parseRegScalar 零改动；
    // 中文值经 decodeRegOutput 三段解 utf8→gbk→latin1（B-1 语义保持）。
    const psPath = key.replace(/^([A-Za-z_]+)\\/, '$1:\\');
    // 09-29 C 轮追加实证：本机壁纸值名实际是 WallPaper（大写 P）且无 WallpaperPath 键；
    // Get-ItemProperty -Name 在 .NET 属性层大小写敏感会漏——GetValue() 走 Win32 语义
    // 大小写不敏感，两坑同治。
    const script =
      "$ErrorActionPreference='SilentlyContinue';" +
      `$v=(Get-Item -LiteralPath '${psPath}').GetValue('${name}');` +
      `if ($null -ne $v) { '${name}    REG_SZ    ' + $v } else { exit 1 }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'buffer',
      timeout: 4000,
      windowsHide: true,
    });
    return decodeRegOutput(out);
  } catch {
    return null;
  }
}

function resolveWallpaperPath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  return (
    parseWallpaperRegValue(regQueryValue('HKCU\\Control Panel\\Desktop', 'WallpaperPath')) ??
    parseWallpaperRegValue(regQueryValue('HKCU\\Control Panel\\Desktop', 'Wallpaper'))
  );
}

function readDesktopWallpaperDataUrl(): string | null {
  const path = resolveWallpaperPath();
  if (path === null || !existsSync(path)) {
    return null;
  }
  try {
    const size = statSync(path).size;
    return wallpaperToDataUrl(path, (p) => readFileSync(p), size);
  } catch {
    return null;
  }
}

/**
 * C 轮「实时透明」：把壁纸屏幕映射 − 窗口位置广播给 renderer（纯函数在
 * wallpaperGeometry.ts；这里只做取数与容错）。图像尺寸/WallpaperStyle 首读缓存
 * （壁纸文件不随窗口移动变）；任何一步失败 → 发 null，renderer 保持视口 fixed
 * 回退（= 移动即实时的降级态，绝不闪崩）。
 */
let wallpaperGeomCache: { path: string; size: { width: number; height: number } | null; fill: WallpaperFillMode } | null = null;

function wallpaperGeomInputs(wallpaperPath: string): { size: { width: number; height: number } | null; fill: WallpaperFillMode } {
  if (wallpaperGeomCache !== null && wallpaperGeomCache.path === wallpaperPath) {
    return { size: wallpaperGeomCache.size, fill: wallpaperGeomCache.fill };
  }
  let size: { width: number; height: number } | null = null;
  try {
    // 只读头 64KB：够 PNG IHDR / JPEG SOF / BMP 头，省大文件全量 IO
    const fd = openSync(wallpaperPath, 'r');
    try {
      const head = Buffer.alloc(Math.min(65536, statSync(wallpaperPath).size));
      readSync(fd, head, 0, head.length, 0);
      size = probeWallpaperImageSize(head);
    } finally {
      closeSync(fd);
    }
  } catch { /* 读不了=尺寸 null，走 fixed 回退 */ }
  const fill = normalizeWallpaperStyle(parseRegScalar(regQueryValue('HKCU\\Control Panel\\Desktop', 'WallpaperStyle')));
  wallpaperGeomCache = { path: wallpaperPath, size, fill };
  return { size, fill };
}

function sendWallpaperGeometry(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  try {
    const path = resolveWallpaperPath();
    if (path === null || !existsSync(path)) {
      win.webContents.send(CHANNEL_WALLPAPER_GEOMETRY, null);
      return;
    }
    const b = win.getBounds();
    const disp = screen.getDisplayMatching(b).bounds;
    const { size, fill } = wallpaperGeomInputs(path);
    const geo = computeWallpaperGeometry({
      win: b,
      display: { x: disp.x, y: disp.y, width: disp.width, height: disp.height },
      image: size,
      fill,
    });
    win.webContents.send(CHANNEL_WALLPAPER_GEOMETRY, geo);
  } catch {
    try {
      win.webContents.send(CHANNEL_WALLPAPER_GEOMETRY, null);
    } catch { /* 窗口已销毁 */ }
  }
}

/**
 * 把应用主题应用到窗口原生区域：nativeTheme.themeSource 驱动 OS 标题栏与原生菜单
 * 深浅色，重建菜单使 label/底色即时刷新，并同步已存在窗口的 backgroundColor。
 * `system` 交回 OS 决定（Electron 自动同步 shouldUseDarkColors）。
 */
function applyChromeTheme(mode: ThemeMode): void {
  nativeTheme.themeSource = mode;
  const next = resolveChromeTheme(mode, nativeTheme.shouldUseDarkColors);
  currentChromeTheme = next;
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      // C 轮：OS titleBarOverlay 已整撤（自绘按钮接管）——明暗切换只刷窗口预绘底色；
      // renderer 的配色实测（theme:chrome 通道）随后一帧推真值覆盖，两通道不竞态。
      win.setBackgroundColor(CHROME_BACKGROUND[next]);
    } catch {
      /* 窗口正在销毁：跳过，不阻断设置落盘回执 */
    }
  }
  platformContext?.logger
    .forModule('main')
    .info(`chromeTheme applied: mode=${String(mode)} → ${next} (bg=${CHROME_BACKGROUND[next]})`);
  // 自证探针（真机验收取证用，docs/mockups/cdp-e2e-t87-01.mjs 消费）：apply 后 400ms
  // 从 main 侧读各窗 Chromium 的 prefers-color-scheme —— 这是 OS 条将采用的明暗。
  // 注意：renderer 侧 matchMedia 在 CDP attach 后会翻回系统真值（探针设计实证），
  // 所以取证必须走 webContents.executeJavaScript（main→renderer 单向，不受 CDP 影响）。
  for (const win of BrowserWindow.getAllWindows()) {
    setTimeout(() => {
      if (win.isDestroyed()) {
        return;
      }
      void win.webContents
        .executeJavaScript("JSON.stringify({mm:matchMedia('(prefers-color-scheme: dark)').matches})")
        .then((r) => {
          platformContext?.logger
            .forModule('main')
            .info(`chromeTheme probe(${String(mode)}→${next}): ${String(r)}`);
        })
        .catch(() => undefined);
    }, 400);
  }
}

/** 按 locale 重建并安装应用菜单（启动即用当前 locale；语言切换后即时重建）。 */
function installApplicationMenu(locale: string): void {
  menuLocale = toMenuLocale(locale);
  // T87-02（老板 09-28「整个软件随主题变」）：Windows/Linux 撤原生菜单栏 ——
  // 原生菜单由 OS 绘制、不吃应用 CSS（palette/look 完全无效），renderer 自绘菜单带
  // （MenuBarBand）取代；macOS 保留原生菜单（OS 惯例 + nativeTheme 已联动深浅）。
  if (process.platform === 'darwin') {
    applyApplicationMenu(menuLocale, handleMenuAction);
  } else {
    Menu.setApplicationMenu(null);
  }
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
    syncDir: syncFolderFor(ctx),
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
    platform: process.platform as NodeJS.Platform,
    schemaVersion: SCHEMA_VERSION,
    // 隐私默认：只暴露数据根目录名，不泄露完整家目录路径
    layoutRoot: basename(ctx.layout.root),
  }));

  // T87-02（Win 自绘菜单带）：条目点击 → 复用原生菜单同一动作出口（单源，行为不漂移）。
  ipcMain.handle(CHANNEL_MENU_CLICK, (_event: unknown, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const action = (raw as Record<string, unknown>)['action'];
    if (typeof action === 'string' && (MENU_ACTIONS as readonly string[]).includes(action)) {
      handleMenuAction(action as MenuActionId);
    }
  });
  // T87-02：标准 role 转发（编辑六件套 + 缩放三件套）——renderer 沙箱无此能力，
  // 由发起窗口自己的 webContents 执行（焦点在编辑器/输入框，语义与旧原生菜单一致）。
  ipcMain.handle(CHANNEL_MENU_ROLE, (event: { sender: import('electron').WebContents }, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      return;
    }
    const role = (raw as Record<string, unknown>)['role'];
    const contents = event.sender;
    switch (role) {
      case 'undo':
      case 'redo':
      case 'cut':
      case 'copy':
      case 'paste':
      case 'selectAll':
        contents[role]();
        break;
      case 'zoomIn':
      case 'zoomOut': {
        const step = role === 'zoomIn' ? 0.5 : -0.5;
        contents.setZoomLevel(Math.max(0.5, Math.min(3, contents.getZoomLevel() + step)));
        break;
      }
      case 'resetZoom':
        contents.setZoomLevel(0);
        break;
      default:
        break;
    }
  });

  // T89-01：自绘标题带的窗口状态初值（双击最大化 = OS HTCAPTION 原生，无需命令通道）。
  ipcMain.handle(CHANNEL_WINDOW_GET_STATE, (event: { sender: import('electron').WebContents }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return { maximized: win?.isMaximized() ?? false };
  });
  // C 轮（老板 09-29 拍板全自绘窗口按钮）：min / 最大化-还原 / close。
  // close 走 win.close() → 触发主窗 close 事件 → T54-01 closeGuard 冲刷/托盘询问
  // 同链路（零旁路）；销毁只在 guard 放行后发生。
  ipcMain.handle(CHANNEL_WINDOW_MINIMIZE, (event: { sender: import('electron').WebContents }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null || win.isDestroyed()) {
      return false;
    }
    win.minimize();
    return true;
  });
  ipcMain.handle(CHANNEL_WINDOW_MAXIMIZE_TOGGLE, (event: { sender: import('electron').WebContents }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null || win.isDestroyed()) {
      return false;
    }
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return true;
  });
  ipcMain.handle(CHANNEL_WINDOW_CLOSE, (event: { sender: import('electron').WebContents }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null || win.isDestroyed()) {
      return false;
    }
    win.close();
    return true;
  });
  // T89-01/C 轮：renderer 实测 canvas/ink token → 刷窗口预绘底色（OS titleBarOverlay
  // 已整撤——OS 平面色块追不上渐变玻璃带=右上角补丁根因，按钮改 renderer 自绘）。
  // 非法值回落明暗态画布 token。
  // T90-01B：DWM acrylic 在本机实测不可达（任务栏材质正常、Electron 窗恒死灰；
  // acrylic/mica × 37/38 × transparent 真假全验过——企业版会话/虚拟显示的
  // DirectComposition 拿不到壁纸共享）。材质逻辑整段撤除，通透改走壁纸衬底层
  // （desktop:wallpaper 通道）；overlay 恢复实心 canvas 色。
  ipcMain.handle(CHANNEL_THEME_CHROME, (event: { sender: import('electron').WebContents }, raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) {
      return false;
    }
    const rec = raw as Record<string, unknown>;
    const canvas = typeof rec['canvas'] === 'string' ? rec['canvas'] : '';
    const ink = typeof rec['ink'] === 'string' ? rec['ink'] : '';
    const look = typeof rec['look'] === 'string' ? rec['look'] : 'pixel';
    // C 轮：OS overlay 已撤，本函数只剩窗口预绘底色（恒实心 canvas）。
    const overlay = resolveChromeOverlay({ canvas, ink, look }, currentChromeTheme);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null) {
      return false;
    }
    try {
      if (process.platform === 'win32') {
        // C 轮：OS titleBarOverlay 已整撤（右上角补丁根治）——theme:chrome 现在只
        // 刷窗口预绘底色（恒实心；壁纸衬底在 DOM 层，窗体绝不 alpha 底=黑窗教训）。
        win.setBackgroundColor(overlay.windowBackground);
      } else {
        win.setBackgroundColor(overlay.windowBackground);
      }
    } catch {
      /* 窗口正在销毁：跳过 */
      return false;
    }
    platformContext?.logger
      .forModule('main')
      .info(`chromeOverlay applied: bg=${overlay.windowBackground}`);
    return true;
  });

  // T90-01B：桌面壁纸衬底通道。renderer 拉一次即可（壁纸更换频率极低，切档时重拉）。
  // 只读注册表 WallpaperPath /壁纸策略键，读文件转 base64 data URL；失败返回 null
  // ——renderer 拿到 null 就保持实心（绝不裸开透明链）。
  ipcMain.handle(CHANNEL_DESKTOP_WALLPAPER, () => readDesktopWallpaperDataUrl());

  // 设置（M9）：get 回整份（data.note = 同步目录）；patch 严格校验后落盘并回整份
  ipcMain.handle(CHANNEL_SETTINGS_GET, () => readAppSettings(ctx.userDataDir, syncFolderFor(ctx)));
  ipcMain.handle(CHANNEL_SETTINGS_PATCH, (_event: unknown, raw: unknown) => {
    const settings = patchAppSettings(ctx.userDataDir, syncFolderFor(ctx), raw);
    // T51-01：语言（或任何设置）落盘后按新 locale 即时重建原生菜单
    installApplicationMenu(settings.locale);
    // T87-01：明暗主题落盘后即时应用到 OS 标题栏/原生菜单/窗口预绘底色
    applyChromeTheme(settings.theme);
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
  // 日历（T97-01）：calendar:list/create/update/remove
  registerCalendarIpc(services?.calendar ?? null, dbViewRegistrar());
  // 待办（T98-01）：todo:list/create/update/setDone/remove
  registerTodoIpc(services?.todo ?? null, dbViewRegistrar());
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
  // DB 面墓碑物理清除（T81-01）：dbgc:preview（只读条数）/ dbgc:run（确认执行）。
  // 缺失服务统一结构化拒绝（与其它通道同口径）；op_ledger 不动由服务层保证。
  ipcMain.handle(DBGC_CHANNELS.preview, async () => {
    const service = services?.dbgc ?? null;
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用');
    }
    return service.preview();
  });
  ipcMain.handle(DBGC_CHANNELS.run, async () => {
    const service = services?.dbgc ?? null;
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用');
    }
    return service.run();
  });
  // 附件目录孤儿回收对账（T83-02）：assetgc:preview（只读零写）/ assetgc:run（确认执行）。
  ipcMain.handle(ASSETGC_CHANNELS.preview, async () => {
    const service = services?.assetgc ?? null;
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用');
    }
    return service.preview();
  });
  ipcMain.handle(ASSETGC_CHANNELS.run, async () => {
    const service = services?.assetgc ?? null;
    if (service === null) {
      throw new Error('E_DB_UNAVAILABLE: 数据库服务不可用');
    }
    return service.run();
  });
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
    // T84-01 向导：目录选择器（同 pickArchive 范式；默认落在当前同步文件夹）
    pickFolder: async () => {
      const current = readSettings(ctx.userDataDir).sync.folder.trim();
      const options = {
        title: '选择同步文件夹',
        defaultPath: current.length > 0 ? current : ctx.layout.root,
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
    // T84-01 向导：重启生效（改 folder 后重建 SyncRuntime）。relaunch 在进程
    // 退出后拉起；quittingFlag 经 before-quit 正常置位，走冲刷放行链不弹询问框。
    requestRestart: async () => {
      if (!restartPending) {
        restartPending = true;
        logger.info('app:restart 收到（T84-01 同步文件夹变更），relaunch 排队');
        app.relaunch();
        app.quit();
      }
      return { ok: true as const };
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

/**
 * T81-01：启动时有界后台跑一次 DB 面墓碑物理清除。
 *
 * - 仅当 `settings.sync.gc` 开启才执行（关 = 启动路径不动库；干跑预览在设置页按需触发）；
 * - fire-and-forget（不 await）：单次上限由 DB_GC_BATCH_PAGES 决定，不阻塞首屏；
 * - 失败只记日志（下次启动重试），绝不阻断开窗——同 T44 双链索引重建纪律。
 */
function runStartupDbGc(ctx: PlatformContext, services: DatabaseServices | null): void {
  const service = services?.dbgc ?? null;
  if (service === null || !readSettings(ctx.userDataDir).sync.gc) {
    return;
  }
  const logger = ctx.logger.forModule('dbgc');
  void service
    .run()
    .then((result) => {
      if (result.deletedPages === 0 && result.deletedBlocks === 0) {
        return;
      }
      logger.info(
        `墓碑 GC 完成：页 ${String(result.deletedPages)} 块 ${String(result.deletedBlocks)} ` +
          `释放 ${String(result.bytesFreed)}B 批 ${String(result.batches)} 扣留 ${String(result.held)}`,
      );
    })
    .catch((error: unknown) => {
      logger.error(`墓碑 GC 失败（下次启动重试）：${describeError(error)}`);
    });
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

  // T87-01：启动即把已存主题应用到窗口原生区域（**须在 createWindow 之前**——
  // createWindow 读 currentChromeTheme 决定首窗预绘底色；跑晚=首窗白闪一帧）
  applyChromeTheme(readSettings(ctx.userDataDir).theme);
  createWindow();
  // T81-01：按设置开关（settings.sync.gc）跑一次 DB 面墓碑物理清除——有界后台
  // （分批事务、失败只记日志、不阻塞首屏；同 T44 双链索引重建的 fire-and-forget 纪律）。
  runStartupDbGc(ctx, services);
  // T54-01：托盘（左键 toggle、右键「显示主窗口 / 退出」）；无窗口时进程不假死
  createTray({
    locale: toMenuLocale(readSettings(ctx.userDataDir).locale),
    getWindow: () => mainWindow,
    actions: TRAY_MENU_ACTIONS,
    // T84-01：托盘菜单顶部同步状态行（runtime 不可用 = null「未开启」态）
    getSyncStatus: () => {
      const snapshot = syncRuntime?.getStatus() ?? null;
      return snapshot === null ? null : { enabled: snapshot.enabled, state: snapshot.state, pendingSegs: snapshot.pendingSegs, attachments: snapshot.attachments };
    },
    log: (message) => {
      logger.info(`[tray] ${message}`);
    },
  });
  // T51-01：启动即用当前 locale 装配原生应用菜单（替换 Electron 默认英文菜单）
  //（T87-01：applyChromeTheme 已前移至 createWindow 之前）
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
