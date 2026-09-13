/**
 * preload 通过 contextBridge 暴露到渲染器的类型化 API。
 * 渲染器只能通过 window.septcats 访问主进程能力（contextIsolation:true）。
 */
import type { Op } from '@septcats/core';

export interface SeptcatsAppMeta {
  name: string;
  version: string;
  schemaVersion: number;
  /**
   * 数据根目录名（basename），用于状态栏/关于页展示。
   * 隐私默认：只给目录名，不下发完整家目录路径。
   */
  layoutRoot: string;
}

/**
 * blocks IPC（T5 定名、T6 实现 main 侧）。
 * 一次编辑轮次 = 一批 Op（op_ledger + 物化 + FTS 同事务，计划书 §8.1）。
 */
export interface SeptcatsBlocksApi {
  /** 提交一批 Op，返回写入条数（同事务语义由 main 侧保证）。 */
  commit(ops: Op[]): Promise<number>;
  /** 读一页的块实体（未过滤 tombstone 由查询层决定）。 */
  list(pageId: string): Promise<unknown[]>;
  /** 订阅块变更推送，返回退订函数。 */
  onChanged(listener: (payload: unknown) => void): () => void;
}

export interface SeptcatsApi {
  /** IPC 自检：主进程返回当前时间戳字符串。 */
  ping(): Promise<string>;
  /** 应用元信息（名称/版本/schema 版本）。 */
  appMeta(): Promise<SeptcatsAppMeta>;
  /** 块数据通道（T6 接线前调用会 reject；渲染器当前走内存 session）。 */
  blocks: SeptcatsBlocksApi;
}

declare global {
  interface Window {
    septcats: SeptcatsApi;
  }
}
