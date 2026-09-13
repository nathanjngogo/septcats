import * as fsp from 'node:fs/promises';
import { NotFoundError, SkipError } from './errors';

/**
 * 同步引擎的唯一 IO 面（任务书 §2）。
 * 所有文件访问都经此接口注入：测试用 MemoryFs（可注入故障），真机由 runtime 注入 NodeFs。
 * 铁律：本包不得绕过 SyncFs 直接碰磁盘/网络（node:fs 仅允许出现在本文件）。
 */
export interface SyncFs {
  /** 仅返回直接子项的文件名（不递归）。 */
  list(dir: string): Promise<string[]>;
  /** 读 UTF-8 文本；不存在抛 NotFoundError。 */
  read(path: string): Promise<string>;
  /** 写 UTF-8 文本；ifAbsent=true 时目标已存在抛 SkipError（幂等关键）。 */
  write(path: string, content: string, opts?: { ifAbsent?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 字节数；不存在抛 NotFoundError。 */
  size(path: string): Promise<number>;
  /** 删除（幂等：不存在不抛）。 */
  remove(path: string): Promise<void>;
}

/** 写故障注入描述：测试用它模拟半截/网盘副本/自定义失败。 */
export interface FsWriteOp {
  path: string;
  content: string;
}

/** 故障注入：预设字符串或自定义函数（可改写 path/content，或 throw 模拟失败）。 */
export type FsFault = 'halfwrite' | 'duplicate' | ((op: FsWriteOp) => void);

/** 网盘冲突副本命名：`seg-x.jsonl` -> `seg-x (1).jsonl`。 */
function sidecarCopyPath(path: string): string {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return `${path} (1)`;
  }
  return `${dir}${name.slice(0, dot)} (1)${name.slice(dot)}`;
}

/** 内存假文件系统：测试专用，支持注入故障（任务书 §2）。 */
export class MemoryFs implements SyncFs {
  injectFailure: FsFault | null = null;

  private readonly files = new Map<string, string>();

  async list(dir: string): Promise<string[]> {
    const trimmed = dir.replace(/\/+$/, '');
    const prefix = trimmed === '' ? '' : `${trimmed}/`;
    const names: string[] = [];
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const rel = path.slice(prefix.length);
      if (rel.includes('/')) {
        continue; // 不递归
      }
      names.push(rel);
    }
    names.sort();
    return names;
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new NotFoundError(path);
    }
    return content;
  }

  async write(path: string, content: string, opts?: { ifAbsent?: boolean }): Promise<void> {
    if (opts?.ifAbsent === true && this.files.has(path)) {
      throw new SkipError(path);
    }
    const op: FsWriteOp = { path, content };
    this.applyFault(op);
    this.files.set(op.path, op.content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async size(path: string): Promise<number> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new NotFoundError(path);
    }
    return Buffer.byteLength(content, 'utf8');
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  private applyFault(op: FsWriteOp): void {
    const fault = this.injectFailure;
    if (fault === null) {
      return;
    }
    if (fault === 'halfwrite') {
      op.content = op.content.slice(0, Math.floor(op.content.length / 2));
      return;
    }
    if (fault === 'duplicate') {
      this.files.set(sidecarCopyPath(op.path), op.content);
      return;
    }
    fault(op);
  }
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/** 真实文件系统薄封装：仅供 runtime 使用，本任务不测（任务书 §2）。 */
export class NodeFs implements SyncFs {
  async list(dir: string): Promise<string[]> {
    return fsp.readdir(dir);
  }

  async read(path: string): Promise<string> {
    try {
      return await fsp.readFile(path, 'utf8');
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') {
        throw new NotFoundError(path);
      }
      throw err;
    }
  }

  async write(path: string, content: string, opts?: { ifAbsent?: boolean }): Promise<void> {
    if (opts?.ifAbsent === true) {
      try {
        await fsp.writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
        return;
      } catch (err) {
        if (isErrno(err) && err.code === 'EEXIST') {
          throw new SkipError(path);
        }
        throw err;
      }
    }
    await fsp.writeFile(path, content, 'utf8');
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    try {
      const stat = await fsp.stat(path);
      return stat.size;
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') {
        throw new NotFoundError(path);
      }
      throw err;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await fsp.unlink(path);
    } catch (err) {
      if (isErrno(err) && err.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}
