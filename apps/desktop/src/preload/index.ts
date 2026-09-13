import { contextBridge, ipcRenderer } from 'electron';
import type { SeptcatsApi, SeptcatsAppMeta } from '../types/window';
import { BLOCKS_CHANNELS, CHANNEL_META, CHANNEL_PING } from '../shared/ipc';

/**
 * preload：通过 contextBridge 暴露最小、类型化的窗口 API。
 * 渲染器永远拿不到 ipcRenderer / require / process（sandbox + contextIsolation）。
 *
 * T5 变更：通道名收口到 src/shared/ipc.ts（单一来源）；新增 blocks 通道常量与
 * `septcats.blocks` 透传壳——**main 侧暂未实现**，T6 接 db IPC 后即通（防漂移）。
 */

const api: SeptcatsApi = {
  ping: (): Promise<string> => ipcRenderer.invoke(CHANNEL_PING) as Promise<string>,
  appMeta: (): Promise<SeptcatsAppMeta> =>
    ipcRenderer.invoke(CHANNEL_META) as Promise<SeptcatsAppMeta>,
  blocks: {
    commit: (ops) => ipcRenderer.invoke(BLOCKS_CHANNELS.commit, ops) as Promise<number>,
    list: (pageId) => ipcRenderer.invoke(BLOCKS_CHANNELS.list, pageId) as Promise<unknown[]>,
    onChanged: (listener) => {
      const handler = (_event: unknown, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(BLOCKS_CHANNELS.changed, handler);
      return () => {
        ipcRenderer.removeListener(BLOCKS_CHANNELS.changed, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('septcats', api);
