import { NotFoundError, SkipError } from './errors';
import type { SyncFs } from './fs';
import { parseSegmentFileName } from './naming';

/**
 * 同步后端抽象（任务书 §3）：把「远端段/快照/附件」与本地 SyncFs 解耦。
 * 本任务只冻结接口 + 一个 InProcessProvider 测试实现；真实 provider（Quark/Baidu =
 * 本地同步目录 + FSWatcher）归 T10。
 *
 * 约定：所有 `file` 均为相对 provider 根目录的裸文件名（不递归、不含前缀）。
 */

export interface SyncProvider {
  readonly name: string;
  init(rootDir: string): Promise<void>;
  /** 列出段文件（含网盘副本 `xxx (1).jsonl`）。 */
  listSegments(): Promise<Array<{ file: string; bytes: number }>>;
  /** 列出快照文件（`snapshot-N.json`）。 */
  listSnapshots(): Promise<Array<{ file: string; bytes: number }>>;
  /** 列出给定前缀的文件。 */
  listFiles(prefix: string): Promise<Array<{ file: string; bytes: number }>>;
  /** 读文件内容；不存在返回 null（不抛）。 */
  get(file: string): Promise<string | null>;
  /** 幂等写入：已存在 → 'existed'。 */
  put(file: string, content: string): Promise<'written' | 'existed'>;
  putBinary?(
    file: string,
    srcAbsPath: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<'written' | 'existed'>;
  /** 订阅变更；返回取消订阅函数（去抖由调用方管）。 */
  watch(onChange: () => void): () => void;
  /** 健康探测：为「文件夹 N 分钟无写入」告警提供数据源。 */
  probe(): Promise<{ ok: boolean; lastWriteSeenAt: number | null; reason?: string }>;
}

/** 拼 provider 根目录与裸文件名。 */
function joinPath(rootDir: string, name: string): string {
  const trimmed = rootDir.replace(/\/+$/, '');
  return trimmed === '' ? name : `${trimmed}/${name}`;
}

/** 段文件判定：能解析出 (cFrom, dev, n) 即视为段（含网盘副本）。 */
function isSegmentName(name: string): boolean {
  return parseSegmentFileName(name) !== null;
}

const SNAPSHOT_NAME_RE = /^snapshot-\d+\.json$/;

/**
 * 进程内测试 provider：包装一个 SyncFs（测试用 MemoryFs）。
 * watch/probe 在纯内存场景无真实事件源，返回空实现（真实事件源归 T10 的 fs provider）。
 */
export class InProcessProvider implements SyncProvider {
  readonly name = 'in-process';
  private rootDir: string;
  private readonly fs: SyncFs;

  constructor(fs: SyncFs, rootDir = '') {
    this.fs = fs;
    this.rootDir = rootDir;
  }

  async init(rootDir: string): Promise<void> {
    this.rootDir = rootDir;
  }

  async listSegments(): Promise<Array<{ file: string; bytes: number }>> {
    const names = await this.fs.list(this.rootDir);
    const out: Array<{ file: string; bytes: number }> = [];
    for (const name of names) {
      if (!isSegmentName(name)) {
        continue;
      }
      out.push({ file: name, bytes: await this.fs.size(joinPath(this.rootDir, name)) });
    }
    return out;
  }

  async listSnapshots(): Promise<Array<{ file: string; bytes: number }>> {
    const names = await this.fs.list(this.rootDir);
    const out: Array<{ file: string; bytes: number }> = [];
    for (const name of names) {
      if (!SNAPSHOT_NAME_RE.test(name)) {
        continue;
      }
      out.push({ file: name, bytes: await this.fs.size(joinPath(this.rootDir, name)) });
    }
    return out;
  }

  async listFiles(prefix: string): Promise<Array<{ file: string; bytes: number }>> {
    const names = await this.fs.list(this.rootDir);
    const out: Array<{ file: string; bytes: number }> = [];
    for (const name of names) {
      if (!name.startsWith(prefix)) {
        continue;
      }
      out.push({ file: name, bytes: await this.fs.size(joinPath(this.rootDir, name)) });
    }
    return out;
  }

  async get(file: string): Promise<string | null> {
    try {
      return await this.fs.read(joinPath(this.rootDir, file));
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async put(file: string, content: string): Promise<'written' | 'existed'> {
    try {
      await this.fs.write(joinPath(this.rootDir, file), content, { ifAbsent: true });
      return 'written';
    } catch (error) {
      if (error instanceof SkipError) {
        return 'existed';
      }
      throw error;
    }
  }

  watch(_onChange: () => void): () => void {
    return () => {};
  }

  async probe(): Promise<{ ok: boolean; lastWriteSeenAt: number | null }> {
    return { ok: true, lastWriteSeenAt: null };
  }
}
