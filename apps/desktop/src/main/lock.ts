/**
 * main/lock.ts —— 页面密码锁加密核心（TASK-T67-01-B1-01 · 后端核心）。
 *
 * 设计要点（以 B1-01 v2 为唯一真相）：
 * - KDF：`scrypt(pass, kdf_salt, {N:2^15, r:8, p:1, keylen:32})`，MK/RK 同参同盐（DEVIATION D1）。
 * - 数据密钥 DK：随机 32B，仅存主进程内存（会话 Map）；绝不落盘、绝不进日志。
 * - 信封：`SCENC1.` + base64(IV(12)|authTag(16)|ct)，AES-256-GCM（仿 sync/crypto 形态）。
 * - `wrapped_key = seal(MK, DK)`；`recovery_verifier = seal(RK, DK)`（DK 各包一份）。
 * - `verifier = seal(MK, PROBE)`：解锁=解开比对 PROBE，绝不明文存口令。
 * - 限速：`page_lock.failures/locked_until` 持久（重启不重置）；错 5 次锁 60s。
 * - 正文：`setPass` 把该页 blocks 明文读出 → DK 加密写 `block_cipher` → 删明文块行；
 *   `remove` 校验通过后 DK 解密 → 写回块表（走 block.upsert；账本合法性见 DEVIATION D3）。
 * - 会话内解锁态：Map<pageId, DK>，仅主进程内存；setPass/recover/changePass/remove 后即时失效。
 *
 * 纪律：零 UI / 零 i18n / 不改 packages** 与 sync**；口令与恢复码绝不写入任何日志（见 grep 自查）。
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { StatementExecutor } from './pages';

// ---------------------------------------------------------------------------
// 参数钉值（跨版本可解：钉死常量，旧密文在新代码下仍可解密）
// ---------------------------------------------------------------------------

/** scrypt 代价参数：N=2^15（B1-01 v2 显式钉值；master §1.1 写 2^17，以 v2 为准，见报告 D1）。 */
export const LOCK_SCRYPT_N = 32768;
export const LOCK_SCRYPT_R = 8;
export const LOCK_SCRYPT_P = 1;
export const LOCK_KEYLEN = 32;

/** AES-256-GCM 信封常量。 */
export const LOCK_ENVELOPE_PREFIX = 'SCENC1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** verifier 探针明文（固定常量，加密存 verifier；绝不明文存口令）。 */
export const LOCK_VERIFIER_PROBE = Buffer.from('SEPTCATS-LOCK-VERIFIER-v1', 'utf8');

/** 限速参数。 */
export const LOCK_MAX_FAILURES = 5;
export const LOCK_LOCK_DURATION_MS = 60_000;

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type LockErrorCode = 'E_LOCK_NOT_SET' | 'E_LOCK_BADPASS' | 'E_LOCK_LOCKED' | 'E_LOCK_RECOVERY_USED';

export class LockApiError extends Error {
  readonly code: LockErrorCode;

  constructor(code: LockErrorCode, message: string) {
    super(message);
    this.name = 'LockApiError';
    this.code = code;
    Object.setPrototypeOf(this, LockApiError.prototype);
  }
}

// ---------------------------------------------------------------------------
// 恢复码（base32，RFC4648 去填充；20B → 32 字符 → 4 字符分组）
// ---------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 生成一次性恢复码（随机 20B → base32 → 4 字符分组，形如 XXXX-XXXX-…）。 */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out.match(/.{1,4}/g)?.join('-') ?? out;
}

/** 归一化恢复码：去连字符/空白、转大写（输入容忍用户手敲形态）。 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[-\s]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// 信封（AES-256-GCM）
// ---------------------------------------------------------------------------

function seal(dek: Uint8Array, plaintext: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${LOCK_ENVELOPE_PREFIX}.${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

/** 解密；密钥不符/篡改/结构非法一律抛 LockApiError（E_LOCK_BADPASS，复用为统一失败码）。 */
function open(dek: Uint8Array, sealed: string): Buffer {
  const sep = sealed.indexOf('.');
  if (sep < 0) {
    throw new LockApiError('E_LOCK_BADPASS', '密文格式非法');
  }
  const prefix = sealed.slice(0, sep);
  if (prefix !== LOCK_ENVELOPE_PREFIX) {
    throw new LockApiError('E_LOCK_BADPASS', '密文信封标记不匹配');
  }
  let raw: Buffer;
  try {
    raw = Buffer.from(sealed.slice(sep + 1), 'base64');
  } catch {
    throw new LockApiError('E_LOCK_BADPASS', '密文不是合法 base64');
  }
  if (raw.length < IV_BYTES + TAG_BYTES + 1) {
    throw new LockApiError('E_LOCK_BADPASS', '密文过短');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  try {
    // 返回 Buffer（其 toString('utf8') 才是真正的 UTF-8 解码；Uint8Array.toString 会忽略编码参数）
    return Buffer.from(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  } catch {
    throw new LockApiError('E_LOCK_BADPASS', '解密失败（密钥不符或密文被篡改）');
  }
}

/** 由口令/恢复码 + 盐派生密钥（MK/RK 同参同盐）。 */
function deriveKey(secret: string, salt: Uint8Array): Uint8Array {
  return new Uint8Array(
    scryptSync(secret, Buffer.from(salt), LOCK_KEYLEN, {
      N: LOCK_SCRYPT_N,
      r: LOCK_SCRYPT_R,
      p: LOCK_SCRYPT_P,
      // 提升默认内存上限（仅影响分配上限，不改变 KDF 输出）；N=2^15 约需 32MB。
      maxmem: 128 * 1024 * 1024,
    }),
  );
}

// ---------------------------------------------------------------------------
// 行类型 / helpers
// ---------------------------------------------------------------------------

interface LockRow {
  page_id: string;
  kdf_salt: Uint8Array;
  verifier: Uint8Array;
  recovery_verifier: Uint8Array;
  wrapped_key: Uint8Array;
  failures: number;
  locked_until: number | null;
  updated_at: number;
}

interface StoredBlock {
  id: string;
  page_id: string;
  workspace_id: string;
  type: string;
  props_json: string | null;
  content_json: string | null;
  sort_key: string;
  alive: number;
  version: number;
  lamport_c: number;
  lamport_d: string;
  updated_at: number | null;
}

function rowToLock(row: Record<string, unknown>): LockRow {
  return {
    page_id: String(row['page_id']),
    kdf_salt: row['kdf_salt'] as Uint8Array,
    verifier: row['verifier'] as Uint8Array,
    recovery_verifier: row['recovery_verifier'] as Uint8Array,
    wrapped_key: row['wrapped_key'] as Uint8Array,
    failures: Number(row['failures'] ?? 0),
    locked_until: row['locked_until'] === null || row['locked_until'] === undefined ? null : Number(row['locked_until']),
    updated_at: Number(row['updated_at']),
  };
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export interface LockServiceOptions {
  readonly executor: StatementExecutor;
  /** 可注入时钟（测试时间注入用）；默认 Date.now。 */
  readonly clock?: () => number;
  /** 会话解锁缓存（默认进程内新建 Map）；仅主进程内存，应用退出即灭。 */
  readonly session?: Map<string, Uint8Array>;
}

export interface LockStatus {
  /** 页面是否设有口令（页面属性）。 */
  readonly locked: boolean;
  /** 会话内已解锁（verify/recover 后持有本页 DK）；UI 门控用 locked && !unlockedInSession。 */
  readonly unlockedInSession?: boolean;
  readonly failures: number;
  readonly lockedUntil: number | null;
}

export interface ReadBlocksResult {
  readonly locked: boolean;
  readonly blocks: readonly StoredBlock[];
}

export interface SetPassResult {
  readonly recoveryCode: string;
}

export interface RecoverResult {
  readonly ok: true;
  readonly recoveryCode: string;
}

export interface OkResult {
  readonly ok: true;
}

export function createLockService(options: LockServiceOptions): LockService {
  const { executor } = options;
  const clock = options.clock ?? ((): number => Date.now());
  const session = options.session ?? new Map<string, Uint8Array>();

  async function loadRow(pageId: string): Promise<LockRow | null> {
    const data = await executor.get('lock.get', { page_id: pageId });
    if (data.row === null || data.row === undefined) {
      return null;
    }
    return rowToLock(data.row as Record<string, unknown>);
  }

  /** 用口令派生 MK 并解出 DK；任何失败（错口令/篡改）抛 E_LOCK_BADPASS。不管理限速计数。 */
  function authenticate(row: LockRow, pass: string): Uint8Array {
    const mk = deriveKey(pass, row.kdf_salt);
    // 存的是「密封字符串」的 UTF-8 字节，读回需 utf8 解码得到 SCENC1.<base64>
    const dk = open(mk, Buffer.from(row.wrapped_key).toString('utf8'));
    const probe = open(mk, Buffer.from(row.verifier).toString('utf8'));
    if (!timingSafeEqual(probe, LOCK_VERIFIER_PROBE)) {
      throw new LockApiError('E_LOCK_BADPASS', '口令校验失败');
    }
    return dk;
  }

  function isLockedOut(row: LockRow): boolean {
    return row.locked_until !== null && clock() < row.locked_until;
  }

  async function persistRow(row: LockRow): Promise<void> {
    await executor.run('lock.upsert', {
      page_id: row.page_id,
      kdf_salt: row.kdf_salt,
      verifier: row.verifier,
      recovery_verifier: row.recovery_verifier,
      wrapped_key: row.wrapped_key,
      failures: row.failures,
      locked_until: row.locked_until,
      updated_at: row.updated_at,
    });
  }

  /** 读一页当前明文块（未锁页）。 */
  async function readPlainBlocks(pageId: string): Promise<StoredBlock[]> {
    const data = await executor.all('block.listByPage', { page_id: pageId });
    return (data.rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row['id']),
      page_id: String(row['page_id']),
      workspace_id: String(row['workspace_id']),
      type: String(row['type']),
      props_json: (row['props_json'] as string | null) ?? null,
      content_json: (row['content_json'] as string | null) ?? null,
      sort_key: String(row['sort_key']),
      alive: Number(row['alive'] ?? 1),
      version: Number(row['version'] ?? 1),
      lamport_c: Number(row['lamport_c'] ?? 1),
      lamport_d: String(row['lamport_d'] ?? 'aaaa0001'),
      updated_at: row['updated_at'] === null || row['updated_at'] === undefined ? null : Number(row['updated_at']),
    }));
  }

  /** 把整页块 JSON 用 DK 加密写 block_cipher，并硬删明文块行（FTS 随之清除）。 */
  async function encryptAndStoreBlocks(pageId: string, dk: Uint8Array): Promise<void> {
    const blocks = await readPlainBlocks(pageId);
    const blob = seal(dk, Buffer.from(JSON.stringify(blocks), 'utf8'));
    await executor.run('lock_cipher.upsert', {
      page_id: pageId,
      blob: Buffer.from(blob, 'utf8'),
      format: 1,
      updated_at: clock(),
    });
    await executor.run('block.deleteByPage', { page_id: pageId });
  }

  /** 从 block_cipher 解密还原块数组。 */
  async function decryptStoredBlocks(pageId: string): Promise<StoredBlock[]> {
    const data = await executor.get('lock_cipher.get', { page_id: pageId });
    if (data.row === null || data.row === undefined) {
      return [];
    }
    const blob = (data.row as Record<string, unknown>)['blob'] as Uint8Array;
    const dk = session.get(pageId);
    if (dk === undefined) {
      throw new LockApiError('E_LOCK_LOCKED', '锁页未解锁，无法读取正文');
    }
    const json = open(dk, Buffer.from(blob).toString('utf8')).toString('utf8');
    return JSON.parse(json) as StoredBlock[];
  }

  async function restorePlainBlocks(blocks: readonly StoredBlock[]): Promise<void> {
    for (const block of blocks) {
      await executor.run('block.upsert', {
        id: block.id,
        page_id: block.page_id,
        workspace_id: block.workspace_id,
        type: block.type,
        props_json: block.props_json ?? '{}',
        content_json: block.content_json,
        sort_key: block.sort_key,
        alive: 1,
        version: block.version,
        lamport_c: block.lamport_c,
        lamport_d: block.lamport_d,
        updated_at: block.updated_at,
      });
    }
  }

  return {
    async getStatus(pageId: string): Promise<LockStatus> {
          const row = await loadRow(pageId);
          if (row === null) {
            return { locked: false, unlockedInSession: false, failures: 0, lockedUntil: null };
          }
          // locked=页面属性（有口令即 true，搜索徽标/侧栏 glyph 依赖此位不变）。
          // unlockedInSession=会话属性：verify/recover 后 session 持有 DK → 前端门控据此放行，
          // 否则 PageView 解锁后重探本方法会立刻弹回锁屏卡（解锁→重探→又锁，永远进不去内容）。
          return {
            locked: true,
            unlockedInSession: session.has(pageId),
            failures: row.failures,
            lockedUntil: row.locked_until,
          };
        },

    /** 设锁/重锁：生成盐+DK，双包络存表，正文密文化并删明文块。返回一次性恢复码。 */
    async setPass(pageId: string, pass: string): Promise<SetPassResult> {
      const salt = randomBytes(16);
      const dk = randomBytes(LOCK_KEYLEN);
      const mk = deriveKey(pass, salt);

      const wrappedKey = seal(mk, dk);
      const verifier = seal(mk, LOCK_VERIFIER_PROBE);
      const recoveryCode = generateRecoveryCode();
      const rk = deriveKey(normalizeRecoveryCode(recoveryCode), salt);
      const recoveryVerifier = seal(rk, dk);

      const row: LockRow = {
        page_id: pageId,
        kdf_salt: salt,
        verifier: Buffer.from(verifier, 'utf8'),
        recovery_verifier: Buffer.from(recoveryVerifier, 'utf8'),
        wrapped_key: Buffer.from(wrappedKey, 'utf8'),
        failures: 0,
        locked_until: null,
        updated_at: clock(),
      };
      await persistRow(row);
      await encryptAndStoreBlocks(pageId, dk);
      session.delete(pageId);
      return { recoveryCode };
    },

    /** 校验口令并解锁（缓存 DK 入会话）。错 5 次锁 60s。 */
    async verify(pageId: string, pass: string): Promise<OkResult> {
      const row = await loadRow(pageId);
      if (row === null) {
        throw new LockApiError('E_LOCK_NOT_SET', '该页未设置密码锁');
      }
      if (isLockedOut(row)) {
        throw new LockApiError('E_LOCK_LOCKED', '锁页处于限速锁定中，请稍后再试');
      }
      let dk: Uint8Array;
      try {
        dk = authenticate(row, pass);
      } catch (error) {
        if (!(error instanceof LockApiError)) {
          throw error;
        }
        const failures = row.failures + 1;
        const lockedUntil = failures >= LOCK_MAX_FAILURES ? clock() + LOCK_LOCK_DURATION_MS : row.locked_until;
        await persistRow({ ...row, failures, locked_until: lockedUntil });
        if (lockedUntil !== null && clock() < lockedUntil) {
          throw new LockApiError('E_LOCK_LOCKED', '连续错误次数过多，已临时锁定 60 秒');
        }
        throw new LockApiError('E_LOCK_BADPASS', '口令错误');
      }
      await persistRow({ ...row, failures: 0, locked_until: null });
      session.set(pageId, dk);
      return { ok: true };
    },

    /** 读路径钩子（B2 接入 blocks:list）：未验证会话遇锁页返回空且 locked:true。 */
    async readBlocks(pageId: string): Promise<ReadBlocksResult> {
      const row = await loadRow(pageId);
      if (row === null) {
        return { locked: false, blocks: await readPlainBlocks(pageId) };
      }
      if (session.has(pageId)) {
        return { locked: false, blocks: await decryptStoredBlocks(pageId) };
      }
      return { locked: true, blocks: [] };
    },

    /** 恢复码一次性解锁并强制换口令：成功后重包络（旧恢复码作废），返回新恢复码。 */
    async recover(pageId: string, code: string, newPass: string): Promise<RecoverResult> {
      const row = await loadRow(pageId);
      if (row === null) {
        throw new LockApiError('E_LOCK_NOT_SET', '该页未设置密码锁');
      }
      const rk = deriveKey(normalizeRecoveryCode(code), row.kdf_salt);
      let dk: Uint8Array;
      try {
        dk = open(rk, Buffer.from(row.recovery_verifier).toString('utf8'));
      } catch {
        throw new LockApiError('E_LOCK_RECOVERY_USED', '恢复码无效或已被使用');
      }

      const newMk = deriveKey(newPass, row.kdf_salt);
      const newWrappedKey = seal(newMk, dk);
      const newVerifier = seal(newMk, LOCK_VERIFIER_PROBE);
      const newRecoveryCode = generateRecoveryCode();
      const newRk = deriveKey(normalizeRecoveryCode(newRecoveryCode), row.kdf_salt);
      const newRecoveryVerifier = seal(newRk, dk);

      await persistRow({
        ...row,
        verifier: Buffer.from(newVerifier, 'utf8'),
        recovery_verifier: Buffer.from(newRecoveryVerifier, 'utf8'),
        wrapped_key: Buffer.from(newWrappedKey, 'utf8'),
        failures: 0,
        locked_until: null,
        updated_at: clock(),
      });
      // 恢复码验证成功 = 所有权已证明，且 DK 本身未轮换（只是重包络）→ 会话直接放行
      // （session.set）。若删除会话解锁态，锁屏卡「进入内容」后 PageView 重探 getStatus
      // 会立刻弹回锁屏（T67-B2 真机 U5-d 实锤的缺陷）。
      session.set(pageId, dk);
      return { ok: true, recoveryCode: newRecoveryCode };
    },

    /** 改口令：校验旧口令后重包络（DK 不变），刷新失败计数，清空会话。 */
    async changePass(pageId: string, oldPass: string, newPass: string): Promise<OkResult> {
      const row = await loadRow(pageId);
      if (row === null) {
        throw new LockApiError('E_LOCK_NOT_SET', '该页未设置密码锁');
      }
      const dk = authenticate(row, oldPass);
      const newMk = deriveKey(newPass, row.kdf_salt);
      const newWrappedKey = seal(newMk, dk);
      const newVerifier = seal(newMk, LOCK_VERIFIER_PROBE);
      await persistRow({
        ...row,
        verifier: Buffer.from(newVerifier, 'utf8'),
        wrapped_key: Buffer.from(newWrappedKey, 'utf8'),
        failures: 0,
        locked_until: null,
        updated_at: clock(),
      });
      session.delete(pageId);
      return { ok: true };
    },

    /** 移除锁：校验口令 → DK 解密正文还原明文块 → 删密文与锁行 → 清会话。 */
    async remove(pageId: string, pass: string): Promise<OkResult> {
      const row = await loadRow(pageId);
      if (row === null) {
        throw new LockApiError('E_LOCK_NOT_SET', '该页未设置密码锁');
      }
      const dk = authenticate(row, pass);
      session.set(pageId, dk);
      const blocks = await decryptStoredBlocks(pageId);
      await restorePlainBlocks(blocks);
      await executor.run('lock_cipher.delete', { page_id: pageId });
      await executor.run('lock.delete', { page_id: pageId });
      session.delete(pageId);
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// 级联清锁（pages.deletePage / purgePage 调用，防孤儿密文；最小改动）
// ---------------------------------------------------------------------------

/** 删除某页的锁行与密文行（幂等：无锁则无操作）。 */
export async function purgeLockForPage(executor: StatementExecutor, pageId: string): Promise<void> {
  await executor.run('lock.delete', { page_id: pageId });
  await executor.run('lock_cipher.delete', { page_id: pageId });
}

export interface LockService {
  getStatus(pageId: string): Promise<LockStatus>;
  setPass(pageId: string, pass: string): Promise<SetPassResult>;
  verify(pageId: string, pass: string): Promise<OkResult>;
  readBlocks(pageId: string): Promise<ReadBlocksResult>;
  recover(pageId: string, code: string, newPass: string): Promise<RecoverResult>;
  changePass(pageId: string, oldPass: string, newPass: string): Promise<OkResult>;
  remove(pageId: string, pass: string): Promise<OkResult>;
}
