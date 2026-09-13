import { basename, join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { SCHEMA_VERSION } from '@septcats/core';
import { initPlatform, type PlatformContext } from './platform';

/**
 * 主进程入口。
 *
 * 职责边界：
 * - 单实例锁；二次启动聚焦已有窗口
 * - 先 await initPlatform()（数据根/日志/凭据），再建窗
 * - whenReady -> createWindow（sandbox / contextIsolation / 无 nodeIntegration）
 * - window-all-closed 在非 mac 上退出
 * - 最小 IPC：app:ping、app:meta
 *
 * 路径/日志收口（TASK-T3-01）：本文件不再计算数据根、不读家目录环境变量，
 * 日志走 layout.logs 下的分模块文件，crash dump 目录走 layout.crashDumps。
 */

// --- IPC 通道常量（与 preload 保持一致；M1 会抽到 shared/ipc.ts） ------------

const CHANNEL_PING = 'app:ping';
const CHANNEL_META = 'app:meta';

// --- 窗口 -------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let platformContext: PlatformContext | null = null;

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

function registerIpcHandlers(ctx: PlatformContext): void {
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
}

// --- 生命周期 ---------------------------------------------------------------

async function bootstrapApplication(): Promise<void> {
  const ctx = await initPlatform();
  platformContext = ctx;

  const logger = ctx.logger.forModule('main');
  app.setPath('crashDumps', ctx.layout.crashDumps);

  registerIpcHandlers(ctx);
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

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
