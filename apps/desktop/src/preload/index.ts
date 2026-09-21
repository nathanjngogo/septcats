import { contextBridge, ipcRenderer } from 'electron';
import type { SeptcatsApi, SeptcatsAppMeta } from '../types/window';
import {
  AI_CHANNELS,
  BLOCKS_CHANNELS,
  CHANNEL_META,
  CHANNEL_PALETTE_TOGGLE,
  CHANNEL_PAGE_CONVERT,
  CHANNEL_PAGE_SUMMARY_SET,
  CHANNEL_PING,
  CHANNEL_SEARCH_QUERY,
  CLOSE_CHANNELS,
  COLLAB_CHANNELS,
  DB_CHANNELS,
  DIAG_CHANNELS,
  FAVORITES_CHANNELS,
  IMPORT_CHANNELS,
  MENU_CHANNELS,
  PAGES_CHANNELS,
  RECENT_CHANNELS,
  SETTINGS_CHANNELS,
  SYNC_CHANNELS,
  TEMPLATES_CHANNELS,
  LINKS_CHANNELS,
  WORKSPACES_CHANNELS,
} from '../shared/ipc';
import { UPDATE_CHANNELS } from '../shared/ipc';

/**
 * preload：通过 contextBridge 暴露最小、类型化的窗口 API。
 * 渲染器永远拿不到 ipcRenderer / require / process（sandbox + contextIsolation）。
 *
 * T6 变更：page / fav / recent / workspace 四域接线（`window.septcats.pages.*` 与 main
 * 侧 `createPagesService` 一一对应）；通道名一律取 `src/shared/ipc.ts`（单一来源）。
 * T21-01：blocks 三通道接真实实现——commit 载荷 `{ ops }`、list 载荷 `{ pageId }`；
 * changed 仍是 main → renderer 推送订阅（main 本期不推送）。
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
    commit: (input) =>
      ipcRenderer.invoke(BLOCKS_CHANNELS.commit, input) as ReturnType<
        SeptcatsApi['blocks']['commit']
      >,
    list: (input) =>
      ipcRenderer.invoke(BLOCKS_CHANNELS.list, input) as ReturnType<SeptcatsApi['blocks']['list']>,
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
    // T42-01：页面承载类型两通道（实现住 main/dbview.ts，通道名单一来源本文件顶部）
    convert: (input) =>
      ipcRenderer.invoke(CHANNEL_PAGE_CONVERT, input) as ReturnType<SeptcatsApi['pages']['convert']>,
    setSummary: (input) =>
      ipcRenderer.invoke(CHANNEL_PAGE_SUMMARY_SET, input) as ReturnType<
        SeptcatsApi['pages']['setSummary']
      >,
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
    propMove: (input) =>
      ipcRenderer.invoke(DB_CHANNELS.propMove, input) as ReturnType<SeptcatsApi['db']['propMove']>,
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
  import: {
    plan: (input) => ipcRenderer.invoke(IMPORT_CHANNELS.plan, input) as ReturnType<SeptcatsApi['import']['plan']>,
    pick: () => ipcRenderer.invoke(IMPORT_CHANNELS.pick) as ReturnType<SeptcatsApi['import']['pick']>,
    execute: (input) => ipcRenderer.invoke(IMPORT_CHANNELS.execute, input) as ReturnType<SeptcatsApi['import']['execute']>,
    progress: (input) => ipcRenderer.invoke(IMPORT_CHANNELS.progress, input) as ReturnType<SeptcatsApi['import']['progress']>,
    cancel: (input) => ipcRenderer.invoke(IMPORT_CHANNELS.cancel, input) as ReturnType<SeptcatsApi['import']['cancel']>,
  },
  settings: {
    get: () =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.get) as ReturnType<SeptcatsApi['settings']['get']>,
    patch: (patch) =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.patch, patch) as ReturnType<SeptcatsApi['settings']['patch']>,
  },
  diag: {
    export: () =>
      ipcRenderer.invoke(DIAG_CHANNELS.export) as ReturnType<SeptcatsApi['diag']['export']>,
    confirm: () =>
      ipcRenderer.invoke(DIAG_CHANNELS.confirm) as ReturnType<SeptcatsApi['diag']['confirm']>,
  },
  update: {
    check: () => ipcRenderer.invoke(UPDATE_CHANNELS.check) as ReturnType<SeptcatsApi['update']['check']>,
    download: () =>
      ipcRenderer.invoke(UPDATE_CHANNELS.download) as ReturnType<SeptcatsApi['update']['download']>,
    install: (input) =>
      ipcRenderer.invoke(UPDATE_CHANNELS.install, input) as ReturnType<SeptcatsApi['update']['install']>,
    rollbackHint: () =>
      ipcRenderer.invoke(UPDATE_CHANNELS.rollbackHint) as ReturnType<SeptcatsApi['update']['rollbackHint']>,
    onState: (listener) => subscribe(UPDATE_CHANNELS.state, listener),
  },
  sync: {
    status: () => ipcRenderer.invoke(SYNC_CHANNELS.status) as ReturnType<SeptcatsApi['sync']['status']>,
    setEnabled: (input) =>
      ipcRenderer.invoke(SYNC_CHANNELS.setEnabled, input) as ReturnType<SeptcatsApi['sync']['setEnabled']>,
    now: () => ipcRenderer.invoke(SYNC_CHANNELS.now) as ReturnType<SeptcatsApi['sync']['now']>,
    exportRecovery: () =>
      ipcRenderer.invoke(SYNC_CHANNELS.exportRecovery) as ReturnType<SeptcatsApi['sync']['exportRecovery']>,
    importRecovery: (input) =>
      ipcRenderer.invoke(SYNC_CHANNELS.importRecovery, input) as ReturnType<SeptcatsApi['sync']['importRecovery']>,
    rotateKey: () =>
      ipcRenderer.invoke(SYNC_CHANNELS.rotateKey) as ReturnType<SeptcatsApi['sync']['rotateKey']>,
    onState: (listener) => subscribe(SYNC_CHANNELS.state, listener),
  },
  ai: {
    state: () => ipcRenderer.invoke(AI_CHANNELS.state) as ReturnType<SeptcatsApi['ai']['state']>,
    listModels: (input) =>
      ipcRenderer.invoke(AI_CHANNELS.listModels, input) as ReturnType<SeptcatsApi['ai']['listModels']>,
    chat: (input) => ipcRenderer.invoke(AI_CHANNELS.chat, input) as ReturnType<SeptcatsApi['ai']['chat']>,
    setKey: (input) => ipcRenderer.invoke(AI_CHANNELS.setKey, input) as ReturnType<SeptcatsApi['ai']['setKey']>,
    clearKey: (input) =>
      ipcRenderer.invoke(AI_CHANNELS.clearKey, input) as ReturnType<SeptcatsApi['ai']['clearKey']>,
    setChatConfig: (input) =>
      ipcRenderer.invoke(AI_CHANNELS.setChatConfig, input) as ReturnType<
        SeptcatsApi['ai']['setChatConfig']
      >,
  },
  collab: {
    attach: (input) =>
      ipcRenderer.invoke(COLLAB_CHANNELS.attach, input) as ReturnType<SeptcatsApi['collab']['attach']>,
    detach: (input) =>
      ipcRenderer.invoke(COLLAB_CHANNELS.detach, input) as ReturnType<SeptcatsApi['collab']['detach']>,
    apply: (input) =>
      ipcRenderer.invoke(COLLAB_CHANNELS.apply, input) as ReturnType<SeptcatsApi['collab']['apply']>,
    onUpdate: (listener) => subscribe(COLLAB_CHANNELS.update, listener),
  },
  templates: {
    list: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.list, input) as ReturnType<SeptcatsApi['templates']['list']>,
    get: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.get, input) as ReturnType<SeptcatsApi['templates']['get']>,
    saveFromPage: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.saveFromPage, input) as ReturnType<
        SeptcatsApi['templates']['saveFromPage']
      >,
    rename: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.rename, input) as ReturnType<SeptcatsApi['templates']['rename']>,
    remove: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.delete, input) as ReturnType<SeptcatsApi['templates']['remove']>,
    createPage: (input) =>
      ipcRenderer.invoke(TEMPLATES_CHANNELS.createPage, input) as ReturnType<
        SeptcatsApi['templates']['createPage']
      >,
  },
  links: {
    backlinks: (input) =>
      ipcRenderer.invoke(LINKS_CHANNELS.backlinks, input) as ReturnType<
        SeptcatsApi['links']['backlinks']
      >,
    rebuild: () =>
      ipcRenderer.invoke(LINKS_CHANNELS.rebuild) as ReturnType<SeptcatsApi['links']['rebuild']>,
  },
  // T51-01：原生菜单动作推送订阅（main → renderer 单向）
  menu: {
    onAction: (listener) => subscribe(MENU_CHANNELS.action, listener),
  },
  // T54-01：关窗协作（冲刷握手 + 自绘询问框）
  close: {
    onFlushRequest: (listener) => subscribe(CLOSE_CHANNELS.flush, listener),
    flushAck: (input) =>
      ipcRenderer.invoke(CLOSE_CHANNELS.flushAck, input) as ReturnType<
        SeptcatsApi['close']['flushAck']
      >,
    onAsk: (listener) => subscribe(CLOSE_CHANNELS.ask, listener),
    decide: (input) =>
      ipcRenderer.invoke(CLOSE_CHANNELS.decide, input) as ReturnType<SeptcatsApi['close']['decide']>,
  },
};

contextBridge.exposeInMainWorld('septcats', api);
