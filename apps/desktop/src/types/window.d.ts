/**
 * preload 通过 contextBridge 暴露到渲染器的类型化 API。
 * 渲染器只能通过 window.septcats 访问主进程能力（contextIsolation:true）。
 */

export interface SeptcatsAppMeta {
  name: string;
  version: string;
  schemaVersion: number;
}

export interface SeptcatsApi {
  /** IPC 自检：主进程返回当前时间戳字符串。 */
  ping(): Promise<string>;
  /** 应用元信息（名称/版本/schema 版本）。 */
  appMeta(): Promise<SeptcatsAppMeta>;
}

declare global {
  interface Window {
    septcats: SeptcatsApi;
  }
}
