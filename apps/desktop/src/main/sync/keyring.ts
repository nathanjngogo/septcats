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
 * - `rotateDek()`：换新钥（旧密文从此解不开 → 上层红条提示；历史段的重加密归后续任务）。
 *
 * 凭据后端不可用（无 DPAPI）时 CredentialStore 抛 CredentialUnavailableError，
 * 本层原样透传——调用方（runtime/IPC）按 code 分支给 UI。
 */

import type { CredentialStore } from '@septcats/platform';
import { decodeDek, encodeDek, generateDek } from './crypto';

/** 凭据 service 名（白名单 [a-z0-9_-]{1,32}）。 */
export const SYNC_DEK_SERVICE = 'septcats';

/** 凭据 account 名。 */
export const SYNC_DEK_ACCOUNT = 'sync-dek';

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
}
