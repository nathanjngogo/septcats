/**
 * main/sync/provider.ts —— SyncProvider 的本地文件系统实现（TASK-T13-01 §0.2）。
 *
 * 对应引擎 provider.ts 的 SyncProvider 契约，把「同步文件夹」当远端：
 * - listSegments / listSnapshots / listFiles / get / put：全部走注入的 SyncFs
 *   （真机 = EncryptingSyncFs → NodeFs；`.enc` 段的解密在 EncryptingSyncFs 内）；
 * - watch：fs.watch 目录监听，事件去抖 2s（网盘客户端批量搬运时只触发一轮）；
 * - probe：目录存在性 + 目录 mtime（「文件夹 N 分钟无写入」告警的数据源）。
 *
 * 约定与引擎一致：文件名一律是相对根的裸名；本类不做任何合并/去重（那是引擎的事）。
 */

import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { NotFoundError, SkipError, parseSegmentFileName } from '@septcats/sync';
import type { SyncProvider } from '@septcats/sync';
import type { SyncFs } from '@septcats/sync';

/** 快照文件名（含 `.enc` 变体）。 */
const SNAPSHOT_NAME_RE = /^snapshot-\d{6}\.json(\.enc)?$/;

export interface FsWatchProviderOptions {
  /** 已 rooting + 加密装饰的 SyncFs（裸文件名进出）。 */
  fs: SyncFs;
  /** 监听/探测用的绝对目录（fs.watch 与 stat 都要真路径）。 */
  watchDir: string;
  /** watch 去抖毫秒数（默认 2000，任务书 §0.2）。 */
  debounceMs?: number;
}

interface ListedFile {
  file: string;
  bytes: number;
}

export class FsWatchProvider implements SyncProvider {
  readonly name = 'fs-watch';

  private readonly fs: SyncFs;
  private readonly watchDir: string;
  private readonly debounceMs: number;

  constructor(options: FsWatchProviderOptions) {
    this.fs = options.fs;
    this.watchDir = options.watchDir;
    this.debounceMs = options.debounceMs ?? 2000;
  }

  async init(_rootDir: string): Promise<void> {
    // 构造时已注入目录；保持契约兼容
  }

  private async listBy(predicate: (name: string) => boolean): Promise<ListedFile[]> {
    const names = await this.fs.list('');
    const out: ListedFile[] = [];
    for (const name of names) {
      if (!predicate(name)) {
        continue;
      }
      try {
        out.push({ file: name, bytes: await this.fs.size(name) });
      } catch (error) {
        if (error instanceof NotFoundError) {
          continue; // list 与 size 之间文件消失
        }
        throw error;
      }
    }
    return out;
  }

  listSegments(): Promise<ListedFile[]> {
    return this.listBy((name) => parseSegmentFileName(name) !== null);
  }

  listSnapshots(): Promise<ListedFile[]> {
    return this.listBy((name) => SNAPSHOT_NAME_RE.test(name));
  }

  listFiles(prefix: string): Promise<ListedFile[]> {
    return this.listBy((name) => name.startsWith(prefix));
  }

  async get(file: string): Promise<string | null> {
    try {
      return await this.fs.read(file);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async put(file: string, content: string): Promise<'written' | 'existed'> {
    try {
      await this.fs.write(file, content, { ifAbsent: true });
      return 'written';
    } catch (error) {
      if (error instanceof SkipError) {
        return 'existed';
      }
      throw error;
    }
  }

  /** fs.watch + 去抖：事件只重置定时器，静默 debounceMs 后回调一次。 */
  watch(onChange: () => void): () => void {
    let timer: NodeJS.Timeout | null = null;
    let watcher: FSWatcher | null = null;
    let closed = false;

    const schedule = (): void => {
      if (closed) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        onChange();
      }, this.debounceMs);
    };

    try {
      watcher = watch(this.watchDir, { persistent: false }, schedule);
    } catch {
      // 目录暂时不可用（断链）：不炸，probe 会给出降级状态
      return () => {
        closed = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
      };
    }
    watcher.on('error', () => undefined); // 断链/目录被移走：交给 probe 汇报
    return () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      watcher?.close();
    };
  }

  async probe(): Promise<{ ok: boolean; lastWriteSeenAt: number | null; reason?: string }> {
    try {
      const info = await stat(this.watchDir);
      if (!info.isDirectory()) {
        return { ok: false, lastWriteSeenAt: null, reason: 'E_SYNC_DIR_NOT_DIR' };
      }
      return { ok: true, lastWriteSeenAt: info.mtimeMs };
    } catch {
      return { ok: false, lastWriteSeenAt: null, reason: 'E_SYNC_DIR_UNAVAILABLE' };
    }
  }
}
