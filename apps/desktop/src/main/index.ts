import { app, BrowserWindow, ipcMain } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SCHEMA_VERSION } from '@septcats/core';

/**
 * 主进程入口（M0+M2a 骨架）。
 *
 * 职责边界（严格按任务书 §2，不做多）：
 * - 单实例锁；二次启动聚焦已有窗口
 * - whenReady -> createWindow（sandbox / contextIsolation / 无 nodeIntegration）
 * - window-all-closed 在非 mac 上退出
 * - 极简日志器写 ~/.septcats/logs/main.log（不引 electron-log）
 * - 最小 IPC：app:ping、app:meta
 */

// --- 极简日志器（约 20 行，不引依赖） ---------------------------------------

function createMainLogger(logFile: string): {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
} {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
  } catch {
    // 日志目录创建失败不应阻断启动
  }
  const write = (level: string, message: string): void => {
    const line = `${new Date().toISOString()} ${level} (main) ${message}\n`;
    try {
      appendFileSync(logFile, line, 'utf8');
    } catch {
      // 日志写入失败不应阻断主流程
    }
  };
  return {
    info: (message) => write('INFO', message),
    warn: (message) => write('WARN', message),
    error: (message) => write('ERROR', message),
  };
}

function resolveLogFile(): string {
  let home = '';
  try {
    home = app.getPath('home');
  } catch {
    home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '.';
  }
  return join(home, '.septcats', 'logs', 'main.log');
}

const logger = createMainLogger(resolveLogFile());

// --- IPC 通道常量（与 preload 保持一致；M1 会抽到 shared/ipc.ts） ------------

const CHANNEL_PING = 'app:ping';
const CHANNEL_META = 'app:meta';

// --- 窗口 -------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

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
    logger.info('window ready-to-show');
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

function registerIpcHandlers(): void {
  ipcMain.handle(CHANNEL_PING, () => {
    const stamp = new Date().toISOString();
    logger.info(`ipc ${CHANNEL_PING} -> ${stamp}`);
    return stamp;
  });

  ipcMain.handle(CHANNEL_META, () => ({
    name: app.getName(),
    version: app.getVersion(),
    schemaVersion: SCHEMA_VERSION,
  }));
}

// --- 生命周期 ---------------------------------------------------------------

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  logger.warn('另一实例已持有单实例锁，本次启动退出');
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

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
    logger.info(`app ready, schemaVersion=${SCHEMA_VERSION}`);

    // macOS：点 Dock 图标且无窗口时重建
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error: unknown) => {
    const reason = error instanceof Error ? error.stack ?? error.message : String(error);
    logger.error(`app.whenReady 失败：${reason}`);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
