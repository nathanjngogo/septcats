/**
 * main/sync/ipc.ts —— sync:* 四通道注册（TASK-T13-01 §1）。
 *
 * - sync:status         → SyncStatusSnapshot（轮询面）；
 * - sync:setEnabled{on} → 运行时启停 + 设置持久化 → 回最新快照；
 * - sync:now            → 立即跑一轮（await 完成）→ 回最新快照；
 * - sync:state          → 状态机跃迁推送（低频），由 main/index.ts 广播到各窗口。
 *
 * 纯 Node（不 import electron）：与 dbview/search 同款注册器注入范式，
 * runtime 缺失（DB 启动失败）时统一回 E_INVARIANT。
 */

import { PagesApiError } from '../pages';
import type { SyncStatusSnapshot } from '../../shared/sync';
import {
  CHANNEL_SYNC_NOW,
  CHANNEL_SYNC_SET_ENABLED,
  CHANNEL_SYNC_STATUS,
} from '../../shared/ipc';
import type { SyncRuntime } from './runtime';

/** ipcMain.handle 的最小注册面（dbViewRegistrar 同款）。 */
export interface SyncIpcRegistrar {
  handle(channel: string, listener: (raw: unknown) => Promise<unknown>): void;
}

export interface SyncIpcOptions {
  /** 注册器（main/index.ts 的 dbViewRegistrar()）。 */
  registrar: SyncIpcRegistrar;
  /** 运行时访问口（DB 启动失败时回 null）。 */
  getRuntime: () => SyncRuntime | null;
  /** setEnabled 的设置持久化（main 侧写 settings.json 的 sync.enabled）。 */
  persistEnabled: (on: boolean) => void;
}

function readOn(raw: unknown): boolean {
  const on = (raw as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') {
    throw new PagesApiError('E_MALFORMED', 'on 必须是布尔值');
  }
  return on;
}

export function registerSyncIpc(options: SyncIpcOptions): void {
  const requireRuntime = (): SyncRuntime => {
    const runtime = options.getRuntime();
    if (runtime === null) {
      throw new PagesApiError('E_INVARIANT', '同步运行时不可用（数据库服务启动失败，见日志）');
    }
    return runtime;
  };

  options.registrar.handle(CHANNEL_SYNC_STATUS, async (): Promise<SyncStatusSnapshot> => {
    return requireRuntime().getStatus();
  });

  options.registrar.handle(CHANNEL_SYNC_SET_ENABLED, async (raw: unknown): Promise<SyncStatusSnapshot> => {
    const on = readOn(raw);
    const runtime = requireRuntime();
    options.persistEnabled(on);
    await runtime.setEnabled(on);
    return runtime.getStatus();
  });

  options.registrar.handle(CHANNEL_SYNC_NOW, async (): Promise<SyncStatusSnapshot> => {
    const runtime = requireRuntime();
    await runtime.runCycle();
    return runtime.getStatus();
  });
}
