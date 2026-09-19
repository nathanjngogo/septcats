/**
 * main/sync/crypto.ts —— 同步段/快照的静态加密（TASK-T13-01 §1，S10 运行时面）。
 *
 * 形态（TASK-T17-01 §0 D2，信封 v2 向后兼容 v1）：
 * - v1（旧）：`IV(12B) | authTag(16B) | ciphertext`，整体 base64 后以**文本**落盘；
 * - v2（现）：`0x01 | key_id(8B) | IV(12B) | authTag(16B) | ciphertext`，base64 落盘。
 *   key_id = sha256(DEK) 前 8 字节（text 形态 = 十六进制前 16 位），轮换钥匙后可
 *   按头判「密文属于哪把钥匙」，支撑 S10 换钥匙/重加密幂等。
 * 解密判型：解出首字节==0x01 且长度≥37 → v2（key_id 不匹配抛 E_KEY_ID_MISMATCH）；
 * 否则按 v1 旧格式用当前 DEK 解（老包无缝）。
 * AAD = 逻辑文件名（不含 `.enc` 后缀），
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

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { NotFoundError } from '@septcats/sync';
import type { SyncFs } from '@septcats/sync';

/** DEK 字节数（AES-256）。 */
export const SYNC_DEK_BYTES = 32;

/** GCM 标准 IV 长度。 */
const IV_BYTES = 12;

/** GCM auth tag 长度。 */
const TAG_BYTES = 16;

/** 信封 v2 标记字节（首字节判型）。 */
const ENVELOPE_V2 = 0x01;

/** v2 头长：0x01(1) + key_id(8) = 9 字节（iv/tag/ct 接在其后）。 */
const V2_HEADER_BYTES = 1 + 8;

/** v2 最短长度：头 9 + iv 12 + tag 16 = 37（空明文）。 */
export const V2_MIN_BYTES = V2_HEADER_BYTES + IV_BYTES + TAG_BYTES;

/** v1 最短长度：iv 12 + tag 16 = 28（空明文）。 */
const V1_MIN_BYTES = IV_BYTES + TAG_BYTES;

/** DEK 丢失/换钥匙/密文被篡改 共用的稳定错误码（S10 红条依据，绝不静默）。 */
export const E_SYNC_KEY_MISMATCH = 'E_SYNC_KEY_MISMATCH';

/** 密文 key_id 与当前 DEK 不符（D2：钥匙已轮换，提示「用恢复码导入或重设」）。 */
export const E_KEY_ID_MISMATCH = 'E_KEY_ID_MISMATCH';

/** 同步密钥错误：code 恒定（默认 E_SYNC_KEY_MISMATCH，v2 key_id 不符为 E_KEY_ID_MISMATCH）。 */
export class SyncKeyError extends Error {
  readonly code: string;

  constructor(detail: string, code: string = E_SYNC_KEY_MISMATCH) {
    super(`${code}：${detail}`);
    this.name = 'SyncKeyError';
    Object.setPrototypeOf(this, SyncKeyError.prototype);
    this.code = code;
  }
}

/** 生成 32B 随机 DEK。 */
export function generateDek(): Uint8Array {
  return new Uint8Array(randomBytes(SYNC_DEK_BYTES));
}

/** key_id（8B 原始字节）= sha256(DEK) 前 8 字节（D2）。 */
export function keyIdBytes(dek: Uint8Array): Buffer {
  return createHash('sha256').update(Buffer.from(dek)).digest().subarray(0, 8);
}

/** key_id 文本形态（16 位小写 hex，UI/日志/对账用）。 */
export function keyIdOf(dek: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(dek)).digest('hex').slice(0, 16);
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

/** 段/快照的明文逻辑名（加密时落盘为 `<名>.enc`）。T29-01：兼容新命名的内容摘要后缀。 */
const PAYLOAD_NAME_RE =
  /^(seg-[0-9a-f]{8}-[a-z0-9]{8,32}-[0-9a-f]{6}(?:-[0-9a-f]{8,64})?\.jsonl|snapshot-\d{6}\.json)$/;

/** 是否为需要加密的 payload 文件名（不含 .enc 后缀）。 */
export function isSyncPayloadName(name: string): boolean {
  return PAYLOAD_NAME_RE.test(name);
}

/** 加密一段文本（信封 v2）：AAD=logicalName，IV 随机，返回 base64 文本。 */
export function encryptToText(dek: Uint8Array, logicalName: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(logicalName, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([ENVELOPE_V2]), keyIdBytes(dek), iv, tag, ciphertext]).toString(
    'base64',
  );
}

/**
 * 解密一段密文文本；AAD 不符 / tag 校验失败 / 结构非法 一律抛 SyncKeyError。
 * 判型（D2）：首字节==0x01 且长度≥37 → v2（key_id 必须匹配，否则 E_KEY_ID_MISMATCH）；
 * 否则按 v1 旧格式（iv+tag+ct）用当前 DEK 解。
 */
export function decryptFromText(dek: Uint8Array, logicalName: string, text: string): string {
  let raw: Buffer;
  try {
    raw = Buffer.from(text, 'base64');
  } catch {
    throw new SyncKeyError(`'${logicalName}' 密文不是合法 base64`);
  }

  const isV2 = raw.length >= V2_MIN_BYTES && raw[0] === ENVELOPE_V2;
  if (isV2) {
    const keyId = raw.subarray(1, V2_HEADER_BYTES);
    if (!keyId.equals(keyIdBytes(dek))) {
      throw new SyncKeyError(
        `'${logicalName}' key_id 不匹配（密文属于另一把钥匙；用恢复码导入或重设同步）`,
        E_KEY_ID_MISMATCH,
      );
    }
    const iv = raw.subarray(V2_HEADER_BYTES, V2_HEADER_BYTES + IV_BYTES);
    const tag = raw.subarray(V2_HEADER_BYTES + IV_BYTES, V2_MIN_BYTES);
    const ciphertext = raw.subarray(V2_MIN_BYTES);
    return gcmDecrypt(dek, logicalName, iv, tag, ciphertext);
  }

  // v1 旧格式（老包无缝）
  if (raw.length < V1_MIN_BYTES) {
    throw new SyncKeyError(`'${logicalName}' 密文过短（${String(raw.length)} 字节）`);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, V1_MIN_BYTES);
  const ciphertext = raw.subarray(V1_MIN_BYTES);
  return gcmDecrypt(dek, logicalName, iv, tag, ciphertext);
}

function gcmDecrypt(
  dek: Uint8Array,
  logicalName: string,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
): string {
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
