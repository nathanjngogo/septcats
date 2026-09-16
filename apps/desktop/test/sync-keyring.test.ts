/**
 * sync-keyring.test.ts —— DEK 生命周期（TASK-T13-01 §4 / TASK-T17-01 §1 扩）。
 *
 * 内存假 CredentialStore 覆盖 生成/读回/轮换/缓存损坏 全路径；
 * T17 扩：恢复码（base32 52 字符）导出→清 keyring→导入→密文可读闭环、
 * 归一化容忍（横杠/大小写/空白）、非法码拒绝；
 * 真后端（Windows DPAPI）往返用 skipIf 探测，与 packages/platform credentials 测试同范式。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createCredentialStore, type CredentialStore } from '@septcats/platform';
import { decodeDek, decryptFromText, encodeDek, encryptToText, SyncKeyError } from '../src/main/sync/crypto';
import {
  RECOVERY_CODE_CHARS,
  SYNC_DEK_ACCOUNT,
  SYNC_DEK_SERVICE,
  SyncKeyring,
  decodeRecoveryCode,
  encodeRecoveryCode,
  encodeBase32,
  decodeBase32,
} from '../src/main/sync/keyring';

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

describe('sync/keyring 恢复码（T17-01 D1）', () => {
  it('导出→清 keyring→导入→密文可读闭环；导入后 loadDek 恒等', async () => {
    // 第一只 keyring：确保 DEK 并导出恢复码；用该 DEK 加密一段密文
    const first = new SyncKeyring(makeFakeStore().store);
    const dek = await first.ensureDek();
    const code = await first.exportRecoveryCode();
    const cipher = encryptToText(dek, 'seg-0000002a-aaaa0001-000042.jsonl', '{"h":{}}');

    // 「清 keyring」：全新空 store（模拟重装系统后凭据全失）
    const wiped = makeFakeStore();
    expect(await new SyncKeyring(wiped.store).loadDek()).toBeNull();

    // 导入恢复码 → DEK 回到凭据存储 → 密文可读、loadDek 恒等
    const restored = new SyncKeyring(wiped.store);
    const imported = await restored.importRecoveryCode(code);
    expect([...imported]).toEqual([...dek]);
    await expect(restored.loadDek()).resolves.toEqual(dek);
    expect(decryptFromText(imported, 'seg-0000002a-aaaa0001-000042.jsonl', cipher)).toBe('{"h":{}}');
  });

  it('展示形态：52 字符、按 5 分组横杠、仅 A-Z2-7', () => {
    const code = encodeRecoveryCode(decodeDek(encodeDek(new Uint8Array(32).fill(7))));
    const groups = code.split('-');
    expect(code.replace(/-/g, '')).toHaveLength(RECOVERY_CODE_CHARS);
    expect(groups.slice(0, -1).every((g) => g.length === 5)).toBe(true);
    expect(groups[groups.length - 1]?.length).toBe(2); // 52 = 10×5 + 2
    expect(/^[A-Z2-7]+(-[A-Z2-7]+)*$/.test(code)).toBe(true);
  });

  it('导入归一化：小写/横杠/空白/混合形态均收敛到同一 DEK', () => {
    const raw = encodeBase32(new Uint8Array(32).fill(3));
    const canonical = decodeRecoveryCode(encodeRecoveryCode(new Uint8Array(32).fill(3)));
    expect([...decodeRecoveryCode(raw.toLowerCase())]).toEqual([...canonical]);
    expect([...decodeRecoveryCode(encodeRecoveryCode(new Uint8Array(32).fill(3)))]).toEqual([
      ...canonical,
    ]);
    expect([
      ...decodeRecoveryCode(` ${raw.match(/.{1,5}/g)!.join('-')}\n\t`),
    ]).toEqual([...canonical]);
  });

  it('非法码拒绝：长度不符、字母表外字符、空串（不落盘）', async () => {
    const { store, plain } = makeFakeStore();
    const keyring = new SyncKeyring(store);
    const before = plain.get(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`);

    expect(() => decodeRecoveryCode('AAAA-BBBB')).toThrow(SyncKeyError); // 长度
    expect(() => decodeRecoveryCode('0'.repeat(52))).toThrow(SyncKeyError); // 0/1/8/9 不在 alphabet
    expect(() => decodeRecoveryCode('')).toThrow(SyncKeyError);
    await expect(keyring.importRecoveryCode('A'.repeat(51))).rejects.toMatchObject({
      code: 'E_SYNC_KEY_MISMATCH',
    });
    expect(plain.get(`${SYNC_DEK_SERVICE}/${SYNC_DEK_ACCOUNT}`)).toBe(before); // 未落盘
  });

  it('base32 小工具：空输入恒等、256bit→52 字符、解码丢弃余位', () => {
    expect(encodeBase32(new Uint8Array(0))).toBe('');
    expect([...decodeBase32('')]).toEqual([]);
    const bytes = new Uint8Array(32).fill(9);
    expect(encodeBase32(bytes)).toHaveLength(52);
    expect([...decodeBase32(encodeBase32(bytes))]).toEqual([...bytes]);
    // 非 5 字节整倍：末位余位补零编码，解码丢余位后仍恒等
    const odd = new Uint8Array([1, 2, 3]);
    expect([...decodeBase32(encodeBase32(odd))]).toEqual([...odd]);
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
