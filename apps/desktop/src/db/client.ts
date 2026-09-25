/**
 * DbServer 的主进程侧客户端（TASK-T2-01 §6）。
 *
 * 只有主进程用它；渲染器不可见（渲染器走 preload 的 IPC 通道，M1 后再接）。
 * 它负责：spawn utilityProcess、请求 id 关联、10s 超时、进程死亡时统一 reject。
 * **主进程只做进程管理与消息转发，不碰 better-sqlite3**。
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import {
  DB_DISPOSE_GRACE_MS,
  DB_RPC_TIMEOUT_MS,
  isDbResponse,
  type AllData,
  type BackupData,
  type BatchData,
  type CheckpointData,
  type ConnectionData,
  type DbBatchStatement,
  type DbErrorCode,
  type DbRequest,
  type DbResponse,
  type DbResponseData,
  type ExportSnapshotData,
  type FtsSearchData,
  type GetData,
  type IntegrityCheckData,
  type MigrateData,
  type RebuildData,
  type RebuildMode,
  type RunData,
} from './rpc';

export interface DbExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

/** client 侧错误：带稳定错误码（E_TIMEOUT / E_DBPROCESS_EXIT / server 透传的错误码）。 */
export class DbClientError extends Error {
  readonly code: DbErrorCode;

  constructor(code: DbErrorCode, message: string) {
    super(message);
    this.name = 'DbClientError';
    this.code = code;
    Object.setPrototypeOf(this, DbClientError.prototype);
  }
}

/** 主进程持有的 DbServer 句柄。方法与 DbRequest 一一对应。 */
export interface DbHandle {
  readonly pid: number | undefined;
  readonly alive: boolean;

  migrate(): Promise<MigrateData>;
  run(sqlId: string, params?: unknown): Promise<RunData>;
  get(sqlId: string, params?: unknown): Promise<GetData>;
  all(sqlId: string, params?: unknown): Promise<AllData>;
  batch(stmts: readonly DbBatchStatement[]): Promise<BatchData>;
  ftsSearch(workspaceId: string, query: string, limit?: number): Promise<FtsSearchData>;
  exportSnapshot(): Promise<ExportSnapshotData>;
  /**
   * T82-01（H-04 P0）：`mode` 缺省 `merge`（并集，段未覆盖的本机 op 保留）。
   * `'replace'`（清表后仅重放段）只允许在覆盖度守卫通过后使用。
   */
  rebuildFromSegments(segmentsJson: string, mode?: RebuildMode): Promise<RebuildData>;
  integrityCheck(): Promise<IntegrityCheckData>;
  /** R28（T80-01）：导出/备份前 checkpoint（wal 落回主库）。 */
  checkpoint(): Promise<CheckpointData>;
  backupTo(destPath: string): Promise<BackupData>;
  /**
   * T80-04（H-09）：释放 DbServer 侧主库文件句柄（**不杀进程**，本句柄仍可用）。
   * 文件级还原（便携包 revert / execute 回滚）前必须先调它，否则 Windows 下
   * 删除/覆写主库撞 EBUSY；还原完成后再 `reopenConnection()` 恢复。
   */
  closeConnection(): Promise<ConnectionData>;
  /** T80-04（H-09）：释放后按原库路径重建连接（幂等；未释放时直接成功）。 */
  reopenConnection(): Promise<ConnectionData>;
  dispose(): Promise<void>;

  on(event: 'dead', listener: (info: DbExitInfo) => void): this;
  once(event: 'dead', listener: (info: DbExitInfo) => void): this;
  off(event: 'dead', listener: (info: DbExitInfo) => void): this;
}

interface PendingRequest {
  resolve: (response: DbResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

class DbClient extends EventEmitter implements DbHandle {
  private readonly child: UtilityProcess;
  private readonly timeoutMs: number;
  private readonly pending = new Map<string, PendingRequest>();
  private dead = false;
  private disposed = false;

  constructor(child: UtilityProcess, timeoutMs: number) {
    super();
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.child.on('message', (message: unknown) => {
      this.handleMessage(message);
    });
    this.child.on('exit', (code: number) => {
      this.handleExit(code);
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get alive(): boolean {
    return !this.dead;
  }

  /** 等待子进程 spawn 完成；启动即退出则 reject。 */
  whenReady(): Promise<DbHandle> {
    if (this.dead) {
      return Promise.reject(new DbClientError('E_DBPROCESS_EXIT', 'DbServer 启动即退出'));
    }
    return new Promise<DbHandle>((resolve, reject) => {
      const onSpawn = (): void => {
        this.child.off('exit', onExit);
        resolve(this);
      };
      const onExit = (code: number): void => {
        this.child.off('spawn', onSpawn);
        reject(new DbClientError('E_DBPROCESS_EXIT', `DbServer 启动即退出（code=${code}）`));
      };
      this.child.once('spawn', onSpawn);
      this.child.once('exit', onExit);
    });
  }

  migrate(): Promise<MigrateData> {
    return this.request<MigrateData>((id) => ({ id, t: 'migrate' }));
  }

  run(sqlId: string, params?: unknown): Promise<RunData> {
    return this.request<RunData>((id) => ({ id, t: 'run', sqlId, params: params === undefined ? {} : params }));
  }

  get(sqlId: string, params?: unknown): Promise<GetData> {
    return this.request<GetData>((id) => ({ id, t: 'get', sqlId, params: params === undefined ? {} : params }));
  }

  all(sqlId: string, params?: unknown): Promise<AllData> {
    return this.request<AllData>((id) => ({ id, t: 'all', sqlId, params: params === undefined ? {} : params }));
  }

  batch(stmts: readonly DbBatchStatement[]): Promise<BatchData> {
    return this.request<BatchData>((id) => ({ id, t: 'batch', stmts: [...stmts] }));
  }

  ftsSearch(workspaceId: string, query: string, limit = 20): Promise<FtsSearchData> {
    return this.request<FtsSearchData>((id) => ({ id, t: 'ftsSearch', workspaceId, query, limit }));
  }

  exportSnapshot(): Promise<ExportSnapshotData> {
    return this.request<ExportSnapshotData>((id) => ({ id, t: 'exportSnapshot' }));
  }

  rebuildFromSegments(segmentsJson: string, mode: RebuildMode = 'merge'): Promise<RebuildData> {
    return this.request<RebuildData>((id) => ({ id, t: 'rebuildFromSegments', segmentsJson, mode }));
  }

  integrityCheck(): Promise<IntegrityCheckData> {
    return this.request<IntegrityCheckData>((id) => ({ id, t: 'integrityCheck' }));
  }

  checkpoint(): Promise<CheckpointData> {
    return this.request<CheckpointData>((id) => ({ id, t: 'checkpoint' }));
  }

  backupTo(destPath: string): Promise<BackupData> {
    return this.request<BackupData>((id) => ({ id, t: 'backupTo', destPath }));
  }

  closeConnection(): Promise<ConnectionData> {
    return this.request<ConnectionData>((id) => ({ id, t: 'closeConnection' }));
  }

  reopenConnection(): Promise<ConnectionData> {
    return this.request<ConnectionData>((id) => ({ id, t: 'reopenConnection' }));
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.dead = true;
    this.rejectAll(new DbClientError('E_DBPROCESS_EXIT', 'DbServer 已被关闭'));
    this.removeAllListeners();

    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, DB_DISPOSE_GRACE_MS);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      this.child.kill();
    } catch {
      // 已退出
    }
    await exited;
  }

  // -------------------------------------------------------------------------

  private request<T extends DbResponseData>(build: (id: string) => DbRequest): Promise<T> {
    if (this.dead) {
      return Promise.reject(new DbClientError('E_DBPROCESS_EXIT', 'DbServer 进程已退出'));
    }
    const id = randomUUID();
    const request = build(id);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DbClientError('E_TIMEOUT', `DbServer 请求超时（${this.timeoutMs}ms）：${request.t}`));
      }, this.timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this.pending.set(id, {
        resolve: (response) => {
          if (response.ok) {
            resolve(response.data as T);
          } else {
            reject(new DbClientError(response.error.code, response.error.message));
          }
        },
        reject,
        timer,
      });

      try {
        this.child.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private handleMessage(message: unknown): void {
    if (!isDbResponse(message)) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  private handleExit(code: number): void {
    if (this.dead) {
      return;
    }
    this.dead = true;
    this.rejectAll(new DbClientError('E_DBPROCESS_EXIT', `DbServer 进程退出（code=${code}）`));
    this.emit('dead', { code, signal: null } satisfies DbExitInfo);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export interface StartDbServerOptions {
  /** SQLite 数据库文件路径（由主进程的平台适配层解析后传入）。 */
  readonly dbPath: string;
  /** 同步分段目录（M8 用；server 侧暂存档，不读它）。 */
  readonly segmentsDir?: string;
  /** 覆盖 DbServer 入口路径（测试用）；默认 `app.getAppPath()/out/main/dbServer.js`。 */
  readonly entryPath?: string;
  /** 请求超时毫秒，默认 10000。 */
  readonly timeoutMs?: number;
}

/**
 * 启动 DbServer。entry 由 build 决定：electron-vite 的第二个 main 入口产出
 * `out/main/dbServer.js`（见 electron.vite.config.ts）。
 */
export function startDbServer(options: StartDbServerOptions): Promise<DbHandle> {
  const entryPath = options.entryPath ?? join(app.getAppPath(), 'out', 'main', 'dbServer.js');
  const args: string[] = [options.dbPath];
  if (options.segmentsDir !== undefined) {
    args.push('--segments-dir', options.segmentsDir);
  }
  const child = utilityProcess.fork(entryPath, args, { serviceName: 'septcats-dbserver' });
  return new DbClient(child, options.timeoutMs ?? DB_RPC_TIMEOUT_MS).whenReady();
}
