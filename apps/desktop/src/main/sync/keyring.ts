/**
 * main/sync/keyring.ts —— 同步 DEK 生命周期（TASK-T13-01 §1，S10）。
 *
 * DEK（32B 随机）由 DPAPI（@septcats/platform 的 CredentialStore，CurrentUser 域）
 * 包裹后落 `credentials/`：明文只在进程内存里出现，落盘的永远是密文。
 * 服务/账号名满足凭据层白名单 `[a-z0-9_-]{1,32}`。
 *
 * 生命周期：
 * - `ensureDek()`：读回；没有则生成并保存（首次开启加密）；
 * - `loadDek()`：只读（未设置回 null）；长度非法 → SyncKeyError（E_SYNC_KEY_MISMATCH）；
 * - `rotateDek()`：换新钥（旧密文从此解不开 → 上层红条提示；历史段重加密归 runtime）；
 * - 恢复码（TASK-T17-01 §0 D1）：恢复码 = DEK 的 base32 文本形态（RFC4648 alphabet
 *   无填充，256bit→52 字符，显示按 5 字符分组以横杠相连）。不做 KDF——保护对象就是
 *   DEK 本身，加派生只增复杂度不增安全。导出=一次性明文展示；导入=粘贴（容忍
 *   横杠/大小写/空白，校验长度+字母表）。
 *
 * 凭据后端不可用（无 DPAPI）时 CredentialStore 抛 CredentialUnavailableError，
 * 本层原样透传——调用方（runtime/IPC）按 code 分支给 UI。
 */

import type { CredentialStore } from '@septcats/platform';
import { SYNC_DEK_BYTES, SyncKeyError, decodeDek, encodeDek, generateDek } from './crypto';

/** 凭据 service 名（白名单 [a-z0-9_-]{1,32}）。 */
export const SYNC_DEK_SERVICE = 'septcats';

/** 凭据 account 名。 */
export const SYNC_DEK_ACCOUNT = 'sync-dek';

/** base32 RFC4648 alphabet（无填充；小工具按 stdlib 手写，不加依赖——D1）。 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 恢复码 base32 字符数：256 bit → ceil(256/5) = 52。 */
export const RECOVERY_CODE_CHARS = 52;

/**
 * base32 编码（RFC4648 无填充）：逐位吃进 8bit、吐出 5bit，末尾不足 5bit 左移补零。
 * 256B 输入恰得 52 字符（无 '=' 填充）。
 */
export function encodeBase32(bytes: Uint8Array): string {
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
  return out;
}

/**
 * base32 解码（无填充）：逐字符映射 5bit、凑满 8bit 输出；末尾余位（<8bit）丢弃。
 * 字母表外字符 → SyncKeyError（E_SYNC_KEY_MISMATCH）。
 */
export function decodeBase32(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new SyncKeyError(`恢复码含非法字符 '${ch}'（字母表应为 A-Z2-7）`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/**
 * DEK → 恢复码显示形态：52 个 base32 字符按 5 字符分组、横杠相连
 * （XXXXX-XXXXX-…-XX，末组 2 字符）。
 */
export function encodeRecoveryCode(dek: Uint8Array): string {
  const raw = encodeBase32(dek);
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 5) {
    groups.push(raw.slice(i, i + 5));
  }
  return groups.join('-');
}

/** 恢复码粘贴输入归一化：去横杠/空白、转大写（D1 容忍三态）。 */
function normalizeRecoveryCode(code: string): string {
  return code.replace(/[-\s]/g, '').toUpperCase();
}

/**
 * 恢复码 → DEK：归一化后校验长度（52）与字母表，解码出 32B。
 * 任何不符抛 SyncKeyError（E_SYNC_KEY_MISMATCH）。
 */
export function decodeRecoveryCode(code: string): Uint8Array {
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== RECOVERY_CODE_CHARS) {
    throw new SyncKeyError(
      `恢复码长度非法：期望 ${String(RECOVERY_CODE_CHARS)} 字符（去横杠后），实际 ${String(normalized.length)}`,
    );
  }
  const dek = decodeBase32(normalized);
  if (dek.length !== SYNC_DEK_BYTES) {
    throw new SyncKeyError(
      `恢复码解码长度非法：期望 ${String(SYNC_DEK_BYTES)} 字节，实际 ${String(dek.length)}`,
    );
  }
  return dek;
}

export class SyncKeyring {
  private readonly store: CredentialStore;

  constructor(store: CredentialStore) {
    this.store = store;
  }

  /** 读回 DEK；未设置 → null。缓存损坏（长度不符）抛 SyncKeyError。 */
  async loadDek(): Promise<Uint8Array | null> {
    const text = await this.store.get(SYNC_DEK_SERVICE, SYNC_DEK_ACCOUNT);
    if (text === null || text.length === 0) {
      return null;
    }
    return decodeDek(text);
  }

  /** 取得 DEK（没有则生成并 DPAPI 保存）。 */
  async ensureDek(): Promise<Uint8Array> {
    const existing = await this.loadDek();
    if (existing !== null) {
      return existing;
    }
    const dek = generateDek();
    await this.store.set(SYNC_DEK_SERVICE, SYNC_DEK_ACCOUNT, encodeDek(dek));
    return dek;
  }

  /** 轮换：生成新 DEK 覆盖旧值并返回。旧密文段此后解不开（E_SYNC_KEY_MISMATCH）。 */
  async rotateDek(): Promise<Uint8Array> {
    const dek = generateDek();
    await this.store.set(SYNC_DEK_SERVICE, SYNC_DEK_ACCOUNT, encodeDek(dek));
    return dek;
  }

  /**
   * 导出恢复码（D1/D4）：先 ensureDek（首次调用即生成并保存），再回 base32 文本形态。
   * 明文只在返回值里出现一次——调用方（UI）须按「一次性展示」处理。
   */
  async exportRecoveryCode(): Promise<string> {
    const dek = await this.ensureDek();
    return encodeRecoveryCode(dek);
  }

  /**
   * 导入恢复码（D1/D4）：校验 → 解出 DEK → 覆盖写入凭据存储 → 返回该 DEK
   * （调用方据其触发追平）。非法码（长度/字母表）抛 SyncKeyError，不落盘。
   */
  async importRecoveryCode(code: string): Promise<Uint8Array> {
    const dek = decodeRecoveryCode(code);
    await this.store.set(SYNC_DEK_SERVICE, SYNC_DEK_ACCOUNT, encodeDek(dek));
    return dek;
  }
}
