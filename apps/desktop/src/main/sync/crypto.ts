/**
 * main/sync/crypto.ts —— 同步段/快照的静态加密（TASK-T13-01 §1，S10 运行时面）。
 *
 * 形态：AES-256-GCM，密文布局 `IV(12B) | authTag(16B) | ciphertext`，整体 base64
 * 后以**文本**落盘（SyncFs 是文本面）。AAD = 逻辑文件名（不含 `.enc` 后缀），
 * 换名即解不开（绑定文件身份，防段被整体挪用到别的名字下）。
 *
 * EncryptingSyncFs：SyncFs 装饰器——
 * - 写：`seg-*.jsonl` / `snapshot-*.json`（payload 名）在启用时透明改写为
 *   `<原名>.enc`（naming.parseSegmentFileName 识别该后缀），ifAbsent 语义作用于
 *   实际落盘名（幂等不破）；
 * - 读：`.enc` 文件一律走解密（无 DEK → E_SYNC_KEY_MISMATCH，绝不把密文当明文
 *   交给合并器造成假隔离）；
 * - manifest.json 等非 payload 名原样透传（一期 manifest 明文）。
 *
 * 本文件不实现任何同步算法（攒段/合并/快照全在 @septcats/sync），只做字节层转换。
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NotFoundError } from '@septcats/sync';
import type { SyncFs } from '@septcats/sync';

/** DEK 字节数（AES-256）。 */
export const SYNC_DEK_BYTES = 32;

/** GCM 标准 IV 长度。 */
const IV_BYTES = 12;

/** GCM auth tag 长度。 */
const TAG_BYTES = 16;

/** DEK 丢失/换钥匙/密文被篡改 共用的稳定错误码（S10 红条依据，绝不静默）。 */
export const E_SYNC_KEY_MISMATCH = 'E_SYNC_KEY_MISMATCH';

/** 同步密钥错误：code 恒为 E_SYNC_KEY_MISMATCH（调用方按 code 分支，不读 message）。 */
export class SyncKeyError extends Error {
  readonly code = E_SYNC_KEY_MISMATCH;

  constructor(detail: string) {
    super(`E_SYNC_KEY_MISMATCH：${detail}`);
    this.name = 'SyncKeyError';
    Object.setPrototypeOf(this, SyncKeyError.prototype);
  }
}

/** 生成 32B 随机 DEK。 */
export function generateDek(): Uint8Array {
  return new Uint8Array(randomBytes(SYNC_DEK_BYTES));
}

/** DEK → base64（进凭据存储的文本形态）。 */
export function encodeDek(dek: Uint8Array): string {
  return Buffer.from(dek).toString('base64');
}

/** base64 → DEK；长度不符（被篡改/截断）抛 SyncKeyError。 */
export function decodeDek(text: string): Uint8Array {
  const raw = Buffer.from(text, 'base64');
  if (raw.length !== SYNC_DEK_BYTES) {
    throw new SyncKeyError(`DEK 长度非法：期望 ${String(SYNC_DEK_BYTES)} 字节，实际 ${String(raw.length)}`);
  }
  return new Uint8Array(raw);
}

/** 段/快照的明文逻辑名（加密时落盘为 `<名>.enc`）。 */
const PAYLOAD_NAME_RE = /^(seg-[0-9a-f]{8}-[a-z0-9]{8,32}-[0-9a-f]{6}\.jsonl|snapshot-\d{6}\.json)$/;

/** 是否为需要加密的 payload 文件名（不含 .enc 后缀）。 */
export function isSyncPayloadName(name: string): boolean {
  return PAYLOAD_NAME_RE.test(name);
}

/** 加密一段文本：IV 随机前置，AAD=logicalName，返回 base64 文本。 */
export function encryptToText(dek: Uint8Array, logicalName: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(logicalName, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** 解密一段密文文本；AAD 不符 / tag 校验失败 / 结构非法 一律抛 SyncKeyError。 */
export function decryptFromText(dek: Uint8Array, logicalName: string, text: string): string {
  let raw: Buffer;
  try {
    raw = Buffer.from(text, 'base64');
  } catch {
    throw new SyncKeyError(`'${logicalName}' 密文不是合法 base64`);
  }
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new SyncKeyError(`'${logicalName}' 密文过短（${String(raw.length)} 字节）`);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(logicalName, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // GCM auth 失败（错 DEK / 篡改 / AAD 不符）在此统一收口
    throw new SyncKeyError(`'${logicalName}' 解密失败（密钥不符或密文被篡改）`);
  }
}

/** DEK 与加密开关的动态来源（运行时每轮刷新，设置里改开关即时生效）。 */
export interface EncryptingFsOptions {
  /** 内层 SyncFs（真机 = NodeFs；已在本层之上，不再做路径 rooting）。 */
  inner: SyncFs;
  /** 所有路径以此为根（'' = 不加前缀）；统一用 '/' 分隔（NodeFs 接受正斜杠）。 */
  rootDir: string;
  /** 是否启用加密（动态读取）。 */
  enabled: () => boolean;
  /** 当前 DEK（null = 尚未取得）。 */
  dek: () => Uint8Array | null;
}

/**
 * 同步文件夹的加密装饰层（SyncFs）。
 * 路径契约：入参一律是**相对 sync 根的裸路径**（'/' 分隔），本层负责 rooting。
 */
export class EncryptingSyncFs implements SyncFs {
  private readonly inner: SyncFs;
  private readonly rootDir: string;
  private readonly enabledFn: () => boolean;
  private readonly dekFn: () => Uint8Array | null;

  constructor(options: EncryptingFsOptions) {
    this.inner = options.inner;
    this.rootDir = options.rootDir.replace(/\/+$/, '');
    this.enabledFn = options.enabled;
    this.dekFn = options.dek;
  }

  private full(path: string): string {
    const trimmed = path.replace(/^\/+/, '');
    return this.rootDir === '' ? trimmed : `${this.rootDir}/${trimmed}`;
  }

  private requireDek(logicalName: string): Uint8Array {
    const dek = this.dekFn();
    if (dek === null) {
      throw new SyncKeyError(`'${logicalName}' 需要解密但本地没有 DEK`);
    }
    return dek;
  }

  private encryptTarget(path: string): { logical: string; stored: string } | null {
    if (!this.enabledFn() || !isSyncPayloadName(path)) {
      return null;
    }
    return { logical: path, stored: `${path}.enc` };
  }

  async list(dir: string): Promise<string[]> {
    return this.inner.list(this.full(dir));
  }

  async read(path: string): Promise<string> {
    if (path.endsWith('.enc')) {
      const logical = path.slice(0, -'.enc'.length);
      const dek = this.requireDek(logical);
      return decryptFromText(dek, logical, await this.inner.read(this.full(path)));
    }
    try {
      return await this.inner.read(this.full(path));
    } catch (error) {
      // 明文名读不到但 .enc 存在（本端开加密后读旧逻辑名）→ 透明解密
      if (error instanceof NotFoundError && isSyncPayloadName(path)) {
        const stored = `${path}.enc`;
        if (await this.inner.exists(this.full(stored))) {
          const dek = this.requireDek(path);
          return decryptFromText(dek, path, await this.inner.read(this.full(stored)));
        }
      }
      throw error;
    }
  }

  async write(path: string, content: string, opts?: { ifAbsent?: boolean }): Promise<void> {
    const target = this.encryptTarget(path);
    if (target === null) {
      await this.inner.write(this.full(path), content, opts);
      return;
    }
    const dek = this.requireDek(target.logical);
    await this.inner.write(this.full(target.stored), encryptToText(dek, target.logical, content), opts);
  }

  async exists(path: string): Promise<boolean> {
    if (await this.inner.exists(this.full(path))) {
      return true;
    }
    return isSyncPayloadName(path) && (await this.inner.exists(this.full(`${path}.enc`)));
  }

  async size(path: string): Promise<number> {
    if (path.endsWith('.enc')) {
      return this.inner.size(this.full(path));
    }
    const stored = `${path}.enc`;
    if (isSyncPayloadName(path) && (await this.inner.exists(this.full(stored)))) {
      return this.inner.size(this.full(stored));
    }
    return this.inner.size(this.full(path));
  }

  async remove(path: string): Promise<void> {
    await this.inner.remove(this.full(path));
    if (isSyncPayloadName(path)) {
      await this.inner.remove(this.full(`${path}.enc`));
    }
  }
}

/** 把底层 IO 错误统一转述（日志用；不吞类型）。 */
export function describeFsError(error: unknown): string {
  if (error instanceof NotFoundError) {
    return `${error.code}：${error.path ?? ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}
