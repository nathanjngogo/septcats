import { contextBridge, ipcRenderer } from 'electron';
import type { SeptcatsApi, SeptcatsAppMeta } from '../types/window';
import {
  BLOCKS_CHANNELS,
  CHANNEL_META,
  CHANNEL_PALETTE_TOGGLE,
  CHANNEL_PING,
  CHANNEL_SEARCH_QUERY,
  DB_CHANNELS,
  FAVORITES_CHANNELS,
  PAGES_CHANNELS,
  RECENT_CHANNELS,
  WORKSPACES_CHANNELS,
} from '../shared/ipc';

/**
 * preload：通过 contextBridge 暴露最小、类型化的窗口 API。
 * 渲染器永远拿不到 ipcRenderer / require / process（sandbox + contextIsolation）。
 *
 * T6 变更：page / fav / recent / workspace 四域接线（`window.septcats.pages.*` 与 main
 * 侧 `createPagesService` 一一对应）；通道名一律取 `src/shared/ipc.ts`（单一来源）。
 * blocks 通道仍是 T5 定名的透传壳（main 侧 handler 归后续任务）。
 */

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: unknown): void => {
    listener(payload as T);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: SeptcatsApi = {
  ping: (): Promise<string> => ipcRenderer.invoke(CHANNEL_PING) as Promise<string>,
  appMeta: (): Promise<SeptcatsAppMeta> =>
    ipcRenderer.invoke(CHANNEL_META) as Promise<SeptcatsAppMeta>,
  blocks: {
    commit: (ops) => ipcRenderer.invoke(BLOCKS_CHANNELS.commit, ops) as Promise<number>,
    list: (pageId) => ipcRenderer.invoke(BLOCKS_CHANNELS.list, pageId) as Promise<unknown[]>,
    onChanged: (listener) => subscribe(BLOCKS_CHANNELS.changed, listener),
  },
  pages: {
    tree: (input) => ipcRenderer.invoke(PAGES_CHANNELS.tree, input) as ReturnType<SeptcatsApi['pages']['tree']>,
    create: (input) => ipcRenderer.invoke(PAGES_CHANNELS.create, input) as ReturnType<SeptcatsApi['pages']['create']>,
    rename: (input) => ipcRenderer.invoke(PAGES_CHANNELS.rename, input) as ReturnType<SeptcatsApi['pages']['rename']>,
    move: (input) => ipcRenderer.invoke(PAGES_CHANNELS.move, input) as ReturnType<SeptcatsApi['pages']['move']>,
    remove: (input) => ipcRenderer.invoke(PAGES_CHANNELS.delete, input) as ReturnType<SeptcatsApi['pages']['remove']>,
    restore: (input) => ipcRenderer.invoke(PAGES_CHANNELS.restore, input) as ReturnType<SeptcatsApi['pages']['restore']>,
    purge: (input) => ipcRenderer.invoke(PAGES_CHANNELS.purge, input) as ReturnType<SeptcatsApi['pages']['purge']>,
  },
  favorites: {
    set: (input) => ipcRenderer.invoke(FAVORITES_CHANNELS.set, input) as Promise<{ pageIds: string[] }>,
    list: () => ipcRenderer.invoke(FAVORITES_CHANNELS.list) as Promise<{ pageIds: string[] }>,
  },
  recent: {
    touch: (input) => ipcRenderer.invoke(RECENT_CHANNELS.touch, input) as Promise<{ pageIds: string[] }>,
    list: () => ipcRenderer.invoke(RECENT_CHANNELS.list) as Promise<{ pageIds: string[] }>,
  },
  workspaces: {
    list: () =>
      ipcRenderer.invoke(WORKSPACES_CHANNELS.list) as Promise<{
        items: Array<{ id: string; name: string }>;
        activeId: string | null;
      }>,
    create: (input) => ipcRenderer.invoke(WORKSPACES_CHANNELS.create, input) as Promise<{ id: string }>,
    rename: (input) => ipcRenderer.invoke(WORKSPACES_CHANNELS.rename, input) as Promise<{ id: string }>,
    switch: (input) => ipcRenderer.invoke(WORKSPACES_CHANNELS.switch, input) as Promise<{ activeId: string }>,
    onChanged: (listener) => subscribe(WORKSPACES_CHANNELS.changed, listener),
  },
  db: {
    create: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.create, input) as ReturnType<SeptcatsApi['db']['create']>,
    load: (input) => ipcRenderer.invoke(DB_CHANNELS.load, input) as ReturnType<SeptcatsApi['db']['load']>,
    rename: (input) => ipcRenderer.invoke(DB_CHANNELS.rename, input) as ReturnType<SeptcatsApi['db']['rename']>,
    recordCreate: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.recordCreate, input) as ReturnType<SeptcatsApi['db']['recordCreate']>,
    recordUpdate: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.recordUpdate, input) as ReturnType<SeptcatsApi['db']['recordUpdate']>,
    recordDelete: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.recordDelete, input) as ReturnType<SeptcatsApi['db']['recordDelete']>,
    propAdd: (input) => ipcRenderer.invoke(DB_CHANNELS.propAdd, input) as ReturnType<SeptcatsApi['db']['propAdd']>,
    propUpdate: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.propUpdate, input) as ReturnType<SeptcatsApi['db']['propUpdate']>,
    propRemove: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.propRemove, input) as ReturnType<SeptcatsApi['db']['propRemove']>,
    viewSave: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.viewSave, input) as ReturnType<SeptcatsApi['db']['viewSave']>,
    relationSearch: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.relationSearch, input) as ReturnType<SeptcatsApi['db']['relationSearch']>,
    exportCsv: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.exportCsv, input) as ReturnType<SeptcatsApi['db']['exportCsv']>,
  },
  search: {
    query: (input) =>
      ipcRenderer.invoke(CHANNEL_SEARCH_QUERY, input) as ReturnType<SeptcatsApi['search']['query']>,
    onTogglePalette: (listener) => subscribe(CHANNEL_PALETTE_TOGGLE, listener),
  },
};

contextBridge.exposeInMainWorld('septcats', api);
