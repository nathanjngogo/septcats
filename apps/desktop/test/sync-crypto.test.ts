/**
 * sync-crypto.test.ts —— 同步加密单测（TASK-T13-01 §4）。
 *
 * 覆盖：roundtrip 恒等、AAD（文件名）篡改拒绝、错 DEK → E_SYNC_KEY_MISMATCH（不 panic）、
 * EncryptingSyncFs 的 .enc 透明写读 / manifest 透传 / ifAbsent 幂等 / 无 DEK 读拒。
 */
import { describe, expect, it } from 'vitest';
import { MemoryFs, SkipError } from '@septcats/sync';
import {
  EncryptingSyncFs,
  SYNC_DEK_BYTES,
  decodeDek,
  decryptFromText,
  encodeDek,
  encryptToText,
  generateDek,
  isSyncPayloadName,
  SyncKeyError,
} from '../src/main/sync/crypto';

const DEK_A = generateDek();
const DEK_B = generateDek();
const NAME = 'seg-0000002a-aaaa0001-000042.jsonl';
const PLAIN = '{"h":{}}\n{"o":1}\n';

describe('sync/crypto 基元', () => {
  it('DEK 是 32 字节随机，base64 编解码恒等', () => {
    expect(DEK_A.length).toBe(SYNC_DEK_BYTES);
    expect(DEK_A.every((b) => b === 0)).toBe(false);
    expect([...decodeDek(encodeDek(DEK_A))]).toEqual([...DEK_A]);
  });

  it('roundtrip：明文 == 解密结果；不同 AAD/明文密文不同', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    // 密文不泄露明文（不能断言单字符：base64 字母表本身含小写 h/o，会概率性命中）
    expect(cipher).not.toContain(PLAIN);
    expect(decryptFromText(DEK_A, NAME, cipher)).toBe(PLAIN);
    expect(cipher).not.toBe(encryptToText(DEK_A, NAME, PLAIN)); // IV 随机
  });

  it('AAD 篡改（换文件名）→ 解密拒 E_SYNC_KEY_MISMATCH', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    expect(() => decryptFromText(DEK_A, 'seg-0000002a-aaaa0001-000043.jsonl', cipher)).toThrow(
      SyncKeyError,
    );
  });

  it('错 DEK → E_SYNC_KEY_MISMATCH（不 panic）；坏 base64 同码', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    expect(() => decryptFromText(DEK_B, NAME, cipher)).toThrow(SyncKeyError);
    try {
      decryptFromText(DEK_B, NAME, cipher);
      expect.unreachable();
    } catch (error) {
      expect((error as SyncKeyError).code).toBe('E_SYNC_KEY_MISMATCH');
    }
    expect(() => decryptFromText(DEK_A, NAME, 'not-base64!!!')).toThrow(SyncKeyError);
    expect(() => decryptFromText(DEK_A, NAME, Buffer.from([1, 2, 3]).toString('base64'))).toThrow(
      SyncKeyError,
    );
  });

  it('decodeDek 长度不符 → SyncKeyError', () => {
    expect(() => decodeDek(Buffer.alloc(16).toString('base64'))).toThrow(SyncKeyError);
  });

  it('isSyncPayloadName：段/快照明文名识别，.enc 与杂名不识别', () => {
    expect(isSyncPayloadName(NAME)).toBe(true);
    expect(isSyncPayloadName('snapshot-000018.json')).toBe(true);
    expect(isSyncPayloadName(`${NAME}.enc`)).toBe(false);
    expect(isSyncPayloadName('manifest.json')).toBe(false);
    expect(isSyncPayloadName('quarantine')).toBe(false);
  });
});

/** 构造挂在一个 MemoryFs 上的加密层（root = 'sync'）。 */
function makeLayer(dek: Uint8Array | null, enabled = true): { fs: MemoryFs; layer: EncryptingSyncFs } {
  const fs = new MemoryFs();
  const layer = new EncryptingSyncFs({ inner: fs, rootDir: 'sync', enabled: () => enabled, dek: () => dek });
  return { fs, layer };
}

describe('sync/crypto EncryptingSyncFs', () => {
  it('启用时段写盘为 <名>.enc（base64 密文），读回透明解密', async () => {
    const { fs, layer } = makeLayer(DEK_A);
    await layer.write(NAME, PLAIN, { ifAbsent: true });
    // 实际落盘的是 .enc 名，且内容不含明文
    const stored = await fs.read(`sync/${NAME}.enc`);
    expect(stored).not.toBe(PLAIN);
    expect(stored.includes('seg-')).toBe(false);
    await expect(fs.exists(`sync/${NAME}`)).resolves.toBe(false);
    // 读逻辑名 → 透明解密；读 .enc 名 → 也是解密结果
    await expect(layer.read(NAME)).resolves.toBe(PLAIN);
    await expect(layer.read(`${NAME}.enc`)).resolves.toBe(PLAIN);
  });

  it('ifAbsent 幂等作用于 .enc 实名：已存在抛 SkipError', async () => {
    const { layer } = makeLayer(DEK_A);
    await layer.write(NAME, PLAIN, { ifAbsent: true });
    await expect(layer.write(NAME, PLAIN, { ifAbsent: true })).rejects.toBeInstanceOf(SkipError);
  });

  it('manifest.json 透传（明文，不加密）', async () => {
    const { fs, layer } = makeLayer(DEK_A);
    const manifest = '{"schema_ver":1,"devices":{}}';
    await layer.write('manifest.json', manifest);
    await expect(fs.read('sync/manifest.json')).resolves.toBe(manifest);
    await expect(layer.read('manifest.json')).resolves.toBe(manifest);
  });

  it('关闭开关后写回明文原名（一期默认明文共存）', async () => {
    const { fs, layer } = makeLayer(DEK_A, false);
    await layer.write(NAME, PLAIN);
    await expect(fs.read(`sync/${NAME}`)).resolves.toBe(PLAIN);
    await expect(layer.read(NAME)).resolves.toBe(PLAIN);
  });

  it('无 DEK 读 .enc / 写段 → SyncKeyError（E_SYNC_KEY_MISMATCH，不把密文给合并器）', async () => {
    const { fs, layer } = makeLayer(null);
    await fs.write(`sync/${NAME}.enc`, encryptToText(DEK_A, NAME, PLAIN));
    await expect(layer.read(`${NAME}.enc`)).rejects.toBeInstanceOf(SyncKeyError);
    await expect(layer.write(NAME, PLAIN)).rejects.toBeInstanceOf(SyncKeyError);
    // 明文名不受影响（一期明文模式仍可用）
    await layer.write('manifest.json', '{}');
    await expect(layer.read('manifest.json')).resolves.toBe('{}');
  });

  it('exists/size/remove 对明文与 .enc 双形态成立', async () => {
    const { fs, layer } = makeLayer(DEK_A);
    await layer.write(NAME, PLAIN);
    await expect(layer.exists(NAME)).resolves.toBe(true);
    await expect(layer.size(NAME)).resolves.toBeGreaterThan(0);
    await layer.remove(NAME);
    await expect(layer.exists(NAME)).resolves.toBe(false);
    await expect(fs.exists(`sync/${NAME}.enc`)).resolves.toBe(false);
  });
});
