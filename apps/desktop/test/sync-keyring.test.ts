/**
 * sync-keyring.test.ts —— DEK 生命周期（TASK-T13-01 §4）。
 *
 * 内存假 CredentialStore 覆盖 生成/读回/轮换/缓存损坏 全路径；
 * 真后端（Windows DPAPI）往返用 skipIf 探测，与 packages/platform credentials 测试同范式。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCredentialStore, type CredentialStore } from '@septcats/platform';
import { encodeDek } from '../src/main/sync/crypto';
import { SYNC_DEK_ACCOUNT, SYNC_DEK_SERVICE, SyncKeyring } from '../src/main/sync/keyring';

const created: string[] = [];
afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 内存凭据存储：落盘形态模拟 DPAPI 包裹（不等于明文），get 模拟解包返回明文。 */
function makeFakeStore(): { store: CredentialStore; wrapped: Map<string, string>; plain: Map<string, string> } {
  const plain = new Map<string, string>();
  const wrapped = new Map<string, string>();
  return {
    wrapped,
    plain,
    store: {
      get: async (service, account) => plain.get(`${service}/${account}`) ?? null,
      set: async (service, account, secret) => {
        const key = `${service}/${account}`;
        plain.set(key, secret); // get 语义：解包回原值
        wrapped.set(key, `dpapi:${Buffer.from(secret).toString('hex')}`); // 落盘形态：非明文
      },
      delete: async (service, account) => plain.delete(`${service}/${account}`),
      isAvailable: async () => true,
    },
  };
}

describe('sync/keyring（内存后端）', () => {
  it('首次 ensureDek 生成 32B 并 DPAPI 保存；读回恒等', async () => {
    const { store, wrapped } = makeFakeStore();
    const keyring = new SyncKeyring(store);
    const dek = await keyring.ensureDek();
    expect(dek.length).toBe(32);

    // 落盘值与明文不同（包裹形态），不泄露 DEK base64
    const saved = wrapped.get(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`);
    expect(saved).toBeDefined();
    expect(saved).not.toBe(encodeDek(dek));

    await expect(keyring.loadDek()).resolves.toEqual(dek);
    // 第二次 ensure 不换钥
    await expect(keyring.ensureDek()).resolves.toEqual(dek);
  });

  it('未设置 → loadDek 回 null', async () => {
    const { store } = makeFakeStore();
    await expect(new SyncKeyring(store).loadDek()).resolves.toBeNull();
  });

  it('rotateDek 换新钥（覆盖旧值，新旧不同）', async () => {
    const { store } = makeFakeStore();
    const keyring = new SyncKeyring(store);
    const first = await keyring.ensureDek();
    const second = await keyring.rotateDek();
    expect([...second]).not.toEqual([...first]);
    await expect(keyring.loadDek()).resolves.toEqual(second);
  });

  it('缓存损坏（长度非法）→ loadDek 抛 SyncKeyError', async () => {
    const { store, plain } = makeFakeStore();
    plain.set(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`, Buffer.alloc(8).toString('base64'));
    await expect(new SyncKeyring(store).loadDek()).rejects.toMatchObject({
      code: 'E_SYNC_KEY_MISMATCH',
    });
  });
});

// 真后端探测（win=DPAPI / mac=keychain）；探测失败整组跳过（与 credentials 测试同范式）。
const realStore = createCredentialStore({ credDir: mkdtempSync(join(tmpdir(), 'septcats-keyring-probe-')) });
created.push(join(tmpdir(), 'septcats-keyring-probe-')); // no-op 兜底（真实目录在下方清理）
const backendAvailable = await realStore.isAvailable();
const realDirs: string[] = [];
afterAll(() => {
  for (const dir of realDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe.skipIf(!backendAvailable)('sync/keyring（真实 DPAPI 后端）', () => {
  it('ensureDek → DPAPI 往返恒等', async () => {
    const credDir = mkdtempSync(join(tmpdir(), 'septcats-keyring-real-'));
    realDirs.push(credDir);
    const keyring = new SyncKeyring(createCredentialStore({ credDir }));
    const dek = await keyring.ensureDek();
    expect(dek.length).toBe(32);
    const keyring2 = new SyncKeyring(createCredentialStore({ credDir }));
    await expect(keyring2.loadDek()).resolves.toEqual(dek);
  }, 20_000);
}, 20_000);
