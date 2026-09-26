/**
 * main/sync/ipc.ts —— sync:* 七通道注册（TASK-T13-01 §1 + T17-01 D4）。
 *
 * - sync:status         → SyncStatusSnapshot（轮询面）；
 * - sync:setEnabled{on} → 运行时启停 + 设置持久化 → 回最新快照；
 * - sync:now            → 立即跑一轮（await 完成）→ 回最新快照；
 * - sync:state          → 状态机跃迁推送（低频），由 main/index.ts 广播到各窗口；
 * - sync:exportRecovery → 导出恢复码（一次性明文，不落盘）；
 * - sync:importRecovery{code} → 校验 → 写 keyring → 新钥接管 → 追平（await 完成）；
 * - sync:rotateKey      → 轮换钥匙（异步后台重加密，进度走 sync:state）。
 *
 * 纯 Node（不 import electron）：与 dbview/search 同款注册器注入范式，
 * runtime 缺失（DB 启动失败）时统一回 E_INVARIANT。
 */

import { PagesApiError } from '../pages';
import type { SyncStatusSnapshot } from '../../shared/sync';
import {
  CHANNEL_APP_RESTART,
  CHANNEL_SYNC_EXPORT_RECOVERY,
  CHANNEL_SYNC_IMPORT_RECOVERY,
  CHANNEL_SYNC_NOW,
  CHANNEL_SYNC_PICK_FOLDER,
  CHANNEL_SYNC_ROTATE_KEY,
  CHANNEL_SYNC_SET_ENABLED,
  CHANNEL_SYNC_STATUS,
} from '../../shared/ipc';
import { SyncKeyError } from './crypto';
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
  /**
   * T84-01 向导：弹原生目录选择器（main 注入 dialog 实现；取消回 null）。
   * 不在此落盘——渲染器确认后经 settings patch 写 sync.folder。
   */
  pickFolder: () => Promise<string | null>;
  /**
   * T84-01 向导：请求重启（main 注入 app.relaunch + quit；folder 改路径后
   * 重建 SyncRuntime 用）。幂等：重复调用由 main 侧 restartPending 去重。
   */
  requestRestart: () => Promise<{ ok: true }>;
}

function readOn(raw: unknown): boolean {
  const on = (raw as { on?: unknown } | null)?.on;
  if (typeof on !== 'boolean') {
    throw new PagesApiError('E_MALFORMED', 'on 必须是布尔值');
  }
  return on;
}

function readRecoveryCode(raw: unknown): string {
  const code = (raw as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new PagesApiError('E_MALFORMED', 'code 必须是非空字符串');
  }
  return code;
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

  options.registrar.handle(CHANNEL_SYNC_EXPORT_RECOVERY, async (): Promise<{ code: string }> => {
    return { code: await requireRuntime().exportRecovery() };
  });

  options.registrar.handle(
    CHANNEL_SYNC_IMPORT_RECOVERY,
    async (raw: unknown): Promise<{ ok: true; keyId: string }> => {
      const code = readRecoveryCode(raw);
      try {
        return await requireRuntime().importRecovery(code);
      } catch (error) {
        if (error instanceof SyncKeyError) {
          throw new PagesApiError('E_MALFORMED', error.message); // 非法码：长度/字母表（不落盘）
        }
        throw error;
      }
    },
  );

  options.registrar.handle(CHANNEL_SYNC_ROTATE_KEY, async (): Promise<{ startedAt: number }> => {
    try {
      return requireRuntime().rotateKey();
    } catch (error) {
      if (error instanceof SyncKeyError) {
        throw new PagesApiError('E_INVARIANT', error.message); // 无 DEK：先开启加密同步
      }
      throw error;
    }
  });

  // T84-01：目录选择器（不需要 runtime——设置面与运行时解耦）
  options.registrar.handle(CHANNEL_SYNC_PICK_FOLDER, async (): Promise<string | null> => {
    return options.pickFolder();
  });

  // T84-01：重启请求（folder 改路径后生效 SyncRuntime；main 侧 relaunch+quit）
  options.registrar.handle(CHANNEL_APP_RESTART, async (): Promise<{ ok: true }> => {
    return options.requestRestart();
  });
}
