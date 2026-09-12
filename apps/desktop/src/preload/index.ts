import { contextBridge, ipcRenderer } from 'electron';
import type { SeptcatsApi, SeptcatsAppMeta } from '../types/window';

/**
 * preload：通过 contextBridge 暴露最小、类型化的窗口 API。
 * 渲染器永远拿不到 ipcRenderer / require / process（sandbox + contextIsolation）。
 */

// 与主进程约定的通道名（M1 会抽到 shared/ipc.ts 单一来源）
const CHANNEL_PING = 'app:ping';
const CHANNEL_META = 'app:meta';

const api: SeptcatsApi = {
  ping: (): Promise<string> => ipcRenderer.invoke(CHANNEL_PING) as Promise<string>,
  appMeta: (): Promise<SeptcatsAppMeta> =>
    ipcRenderer.invoke(CHANNEL_META) as Promise<SeptcatsAppMeta>,
};

contextBridge.exposeInMainWorld('septcats', api);
