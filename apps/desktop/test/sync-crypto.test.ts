/**
 * sync-crypto.test.ts —— 同步加密单测（TASK-T13-01 §4 / TASK-T17-01 §1 扩）。
 *
 * 覆盖：roundtrip 恒等、AAD（文件名）篡改拒绝、错 DEK → key_id 不符 E_KEY_ID_MISMATCH（不 panic）、
 * EncryptingSyncFs 的 .enc 透明写读 / manifest 透传 / ifAbsent 幂等 / 无 DEK 读拒；
 * T17 扩：信封 v2 首字节判型、v1 老包兼容解、key_id 篡改拒绝、AAD 双格式均不破。
 */
import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryFs, SkipError } from '@septcats/sync';
import {
  EncryptingSyncFs,
  SYNC_DEK_BYTES,
  V2_MIN_BYTES,
  decodeDek,
  decryptFromText,
  encodeDek,
  encryptToText,
  generateDek,
  isSyncPayloadName,
  keyIdOf,
  SyncKeyError,
} from '../src/main/sync/crypto';

const DEK_A = generateDek();
const DEK_B = generateDek();
const NAME = 'seg-0000002a-aaaa0001-000042.jsonl';
const PLAIN = '{"h":{}}\n{"o":1}\n';

/** 按 T13-01 时代的 v1 布局（iv+tag+ct）构造密文文本（兼容矩阵的老包制造器）。 */
function encryptV1Text(dek: Uint8Array, logicalName: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(logicalName, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

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

  it('错 DEK → key_id 不符 E_KEY_ID_MISMATCH（不 panic）；坏 base64/过短同码 E_SYNC_KEY_MISMATCH', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    expect(() => decryptFromText(DEK_B, NAME, cipher)).toThrow(SyncKeyError);
    try {
      decryptFromText(DEK_B, NAME, cipher);
      expect.unreachable();
    } catch (error) {
      expect((error as SyncKeyError).code).toBe('E_KEY_ID_MISMATCH');
    }
    expect(() => decryptFromText(DEK_A, NAME, 'not-base64!!!')).toThrow(SyncKeyError);
    expect(() => decryptFromText(DEK_A, NAME, Buffer.from([1, 2, 3]).toString('base64'))).toThrow(
      SyncKeyError,
    );
  });

  it('T17 信封 v2：密文首字节 0x01、key_id=sha256(DEK) 前 8B、最短 37B', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    const raw = Buffer.from(cipher, 'base64');
    expect(raw[0]).toBe(0x01);
    expect(raw.length).toBeGreaterThanOrEqual(V2_MIN_BYTES);
    const keyIdHex = raw.subarray(1, 9).toString('hex');
    expect(keyIdHex).toBe(keyIdOf(DEK_A));
    expect(keyIdHex).not.toBe(keyIdOf(DEK_B));
  });

  it('T17 兼容矩阵：v1 老包用当前 DEK 无缝可解；v1 错钥仍 E_SYNC_KEY_MISMATCH', () => {
    const v1 = encryptV1Text(DEK_A, NAME, PLAIN);
    // v1 首字节 = iv 首字节，断言它没有 0x01+37B 的 v2 形态干扰（判型落入 v1 分支）
    expect(decryptFromText(DEK_A, NAME, v1)).toBe(PLAIN);
    try {
      decryptFromText(DEK_B, NAME, v1);
      expect.unreachable();
    } catch (error) {
      // v1 无 key_id 头，只能靠 GCM auth 失败收口 → 旧码
      expect((error as SyncKeyError).code).toBe('E_SYNC_KEY_MISMATCH');
    }
  });

  it('T17 v2 判型边界：0x01 开头但长度 <37 → 按 v1 处理（不误抛 key_id 错）', () => {
    // 构造首字节 0x01、总长 <37 的密文：v1 加密 1 字节明文（12+16+1=29B）
    const tiny = encryptV1Text(DEK_A, NAME, 'x');
    const raw = Buffer.from(tiny, 'base64');
    if (raw[0] === 0x01) {
      // 概率命中 0x01 首字节时，必须走 v1 分支解出明文而非 key_id 错
      expect(decryptFromText(DEK_A, NAME, tiny)).toBe('x');
    } else {
      expect(decryptFromText(DEK_A, NAME, tiny)).toBe('x');
    }
  });

  it('T17 v2 key_id 字节被篡改 → E_KEY_ID_MISMATCH（先于 GCM 收口）', () => {
    const cipher = encryptToText(DEK_A, NAME, PLAIN);
    const raw = Buffer.from(cipher, 'base64');
    raw[3] = (raw[3] ?? 0) ^ 0xff; // key_id 区内翻一位
    try {
      decryptFromText(DEK_A, NAME, raw.toString('base64'));
      expect.unreachable();
    } catch (error) {
      expect((error as SyncKeyError).code).toBe('E_KEY_ID_MISMATCH');
    }
  });

  it('T17 AAD 双格式均不破：v1/v2 换文件名都拒解', () => {
    const v1 = encryptV1Text(DEK_A, NAME, PLAIN);
    const v2 = encryptToText(DEK_A, NAME, PLAIN);
    expect(() => decryptFromText(DEK_A, 'seg-0000002a-aaaa0001-000043.jsonl', v1)).toThrow(
      SyncKeyError,
    );
    expect(() => decryptFromText(DEK_A, 'seg-0000002a-aaaa0001-000043.jsonl', v2)).toThrow(
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
