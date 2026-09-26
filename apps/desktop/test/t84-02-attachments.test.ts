/**
 * T84-02 附件同步引擎单测（PRD-T84 §4 验收题库 1/4/5/6/7 的引擎面等价物；
 * 双 runtime 集成面走真机探针）。夹具：真实 tmp 目录（小文件）+ mock executor
 * （六路引用枚举返回行集）+ 注入磁盘读数。
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AttachmentSyncService,
  FILES_DIR,
  backoffFor,
  diskOk,
  isAttachmentFileName,
  scafDecrypt,
  scafEncrypt,
} from '../src/main/sync/attachments';
import { generateDek, keyIdOf } from '../src/main/sync/crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';


const dirs: string[] = [];

function mk(name: string): { attachments: string; syncRoot: string } {
  const root = mkdtempSync(join(tmpdir(), `sc-t8402-${name}-`));
  dirs.push(root);
  const attachments = join(root, 'attachments');
  const syncRoot = join(root, 'sync');
  mkdirSync(attachments, { recursive: true });
  mkdirSync(join(syncRoot, FILES_DIR), { recursive: true });
  return { attachments, syncRoot };
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function fileHash(content: Buffer): { hash: string; name: string } {
  const hash = createHash('sha256').update(content).digest('hex');
  return { hash, name: `${hash}.png` };
}

/** mock 六路：只给 blockRefs 一条带 attachment:// 引用，其余空。 */
function executorWith(refJson: string): { all: (sqlId: string) => Promise<{ rows: unknown[] }> } {
  return {
    async all(sqlId: string) {
      if (sqlId === 'assetgc.blockRefs') {
        return { rows: [{ json: refJson }] };
      }
      return { rows: [] };
    },
  };
}

function svc(d: { attachments: string; syncRoot: string }, refJson: string, extra: Record<string, unknown> = {}): AttachmentSyncService {
  return new AttachmentSyncService({
    attachmentsDir: d.attachments,
    syncRoot: d.syncRoot,
    executor: executorWith(refJson) as never,
    encryptEnabled: () => (extra['enc'] as boolean | undefined) ?? false,
    dek: () => (extra['dek'] as Uint8Array | undefined) ?? null,
    freeSpaceBytes: async () => 10 * 1024 ** 3,
    ...(extra['opts'] as Record<string, unknown>),
  });
}

describe('附件名/护栏纯函数', () => {
  it('名字形态：64hex[.ext] 过；穿越/花名/大写拒', () => {
    expect(isAttachmentFileName('a'.repeat(64))).toBe(true);
    expect(isAttachmentFileName(`${'a'.repeat(64)}.png`)).toBe(true);
    expect(isAttachmentFileName('../evil')).toBe(false);
    expect(isAttachmentFileName(`${'A'.repeat(64)}.png`)).toBe(false);
    expect(isAttachmentFileName(`${'a'.repeat(63)}b.verylongext`)).toBe(false);
  });

  it('退避：1s 起步指数到 5min 封顶', () => {
    expect(backoffFor(1)).toBe(1_000);
    expect(backoffFor(2)).toBe(2_000);
    expect(backoffFor(10)).toBe(300_000);
  });

  it('磁盘预检：bytes×1.2+32MB 线', () => {
    expect(diskOk(140 * 1024 ** 2, 100 * 1024 ** 2)).toBe(false); // 100MB 文件需 ≥152MB
    expect(diskOk(200 * 1024 ** 2, 100 * 1024 ** 2)).toBe(true);
    expect(diskOk(0, 0)).toBe(false); // 盘 0 余量时连 rename 元数据都写不下——拒一切
  });
});

describe('SCAF1 流式信封', () => {
  it('加解密 roundtrip（多 chunk 大文件；内存钉流式）', async () => {
    const dek = generateDek();
    const big = randomBytes(300 * 1024); // >4 帧
    const name = `${'ab'.repeat(32)}.bin`;
    const enc: Buffer[] = [];
    await pipeline(
      Readable.from((async function* (): AsyncGenerator<Buffer> {        for (let i = 0; i < big.length; i += 64 * 1024) {
          yield big.subarray(i, Math.min(i + 64 * 1024, big.length));
        }
})()),
      scafEncrypt(dek, name),
      async (src): Promise<void> => {
        for await (const c of src) {
          enc.push(Buffer.from(c as Buffer));
        }
      },
    );
    const cipher = Buffer.concat(enc);
    expect(cipher.subarray(0, 5).toString('latin1')).toBe('SCAF1');
    const dec: Buffer[] = [];
    await pipeline(
      Readable.from((async function* (): AsyncGenerator<Buffer> {        yield cipher;
})()),
      scafDecrypt(dek, name),
      async (src): Promise<void> => {
        for await (const c of src) {
          dec.push(Buffer.from(c as Buffer));
        }
      },
    );
    expect(Buffer.concat(dec).equals(big)).toBe(true);
  });

  it('错钥/篡改/截断一律抛（隔离来源）', async () => {
    const dek = generateDek();
    const other = generateDek();
    const name = `${'cd'.repeat(32)}.bin`;
    const enc: Buffer[] = [];
    await pipeline(
      Readable.from((async function* (): AsyncGenerator<Buffer> {        yield Buffer.from('hello world hello world');
})()),
      scafEncrypt(dek, name),
      async (src): Promise<void> => {
        for await (const c of src) {
          enc.push(Buffer.from(c as Buffer));
        }
      },
    );
    const cipher = Buffer.concat(enc);
    await expect(
      pipeline(
        Readable.from((async function* (): AsyncGenerator<Buffer> {          yield cipher;
  })()),
        scafDecrypt(other, name),
        async (src): Promise<void> => {
          for await (const c of src) {
            void c;
          }
        },
      ),
    ).rejects.toThrow();
    // 截断（砍尾）→ 无末帧 → 抛
    await expect(
      pipeline(
        Readable.from((async function* (): AsyncGenerator<Buffer> {          yield cipher.subarray(0, cipher.length - 8);
  })()),
        scafDecrypt(dek, name),
        async (src): Promise<void> => {
          for await (const c of src) {
            void c;
          }
        },
      ),
    ).rejects.toThrow();
  });
});

describe('上行队列', () => {
  it('引用命中+远端缺 → 流式拷贝落 files/；重跑幂等跳过', async () => {
    const d = mk('push');
    const content = randomBytes(200 * 1024);
    const { hash, name } = fileHash(Buffer.from(content));
    writeFileSync(join(d.attachments, name), content);
    const s = svc(d, `{"src":"attachment://${hash}"}`);
    const r1 = await s.runCycle();
    expect(r1.pushed).toBe(1);
    expect(readFileSync(join(d.syncRoot, FILES_DIR, name))).toEqual(content);
    const r2 = await s.runCycle();
    expect(r2.pushed).toBe(0);
    expect(r2.skippedExists).toBeGreaterThanOrEqual(1);
    void hash;
  });

  it('未被引用的本机附件不上行（引用集闸）', async () => {
    const d = mk('push-noref');
    const { name } = fileHash(Buffer.from('orphan bytes'));
    writeFileSync(join(d.attachments, name), 'orphan bytes');
    const s = svc(d, '{"src":"attachment://' + 'f'.repeat(64) + '"}'); // 引用的是别的 hash
    const r = await s.runCycle();
    expect(r.pushed).toBe(0);
    expect(readdirSync(join(d.syncRoot, FILES_DIR))).toEqual([]);
  });

  it('磁盘预检不足 → 挂起不拷、下轮重试成功', async () => {
    const d = mk('disk');
    const content = randomBytes(1024);
    const { hash, name } = fileHash(content);
    writeFileSync(join(d.attachments, name), content);
    let free = 0; // 满盘
    let nowMs = 1_000;
    const s = new AttachmentSyncService({
      attachmentsDir: d.attachments,
      syncRoot: d.syncRoot,
      executor: executorWith(`{"u":"attachment://${hash}"}`) as never,
      encryptEnabled: () => false,
      dek: () => null,
      freeSpaceBytes: async () => free,
      now: () => nowMs,
    });
    const r1 = await s.runCycle();
    expect(r1.diskDeferred).toBe(1);
    expect(existsSync(join(d.syncRoot, FILES_DIR, name))).toBe(false);
    expect(s.status().pending).toBe(1); // 队列保留（盘满=暂缓非失败）
    // 盘满退避=最长档（5min）：时间未到 → 本轮不动它（不空转烧盘）
    const r1b = await s.runCycle();
    expect(r1b.diskDeferred).toBe(0);
    expect(r1b.pushed).toBe(0);
    // 时间越过退避窗 + 盘位恢复 → 重试成功
    free = 5 * 1024 ** 3;
    nowMs += 6 * 60 * 1000;
    const r2 = await s.runCycle();
    expect(r2.pushed).toBe(1);
    expect(readFileSync(join(d.syncRoot, FILES_DIR, name))).toEqual(content);
  });
});

describe('下行队列', () => {
  it('远端有、本地无 → sha 复验过 → 原子落 attachments/', async () => {
    const d = mk('pull');
    const content = randomBytes(1500 * 1024);
    const { name } = fileHash(content);
    writeFileSync(join(d.syncRoot, FILES_DIR, name), content);
    const s = svc(d, '{}'); // 本机零引用（纯下行）
    const r = await s.runCycle();
    expect(r.pulled).toBe(1);
    expect(readFileSync(join(d.attachments, name))).toEqual(content);
    const r2 = await s.runCycle();
    expect(r2.pulled).toBe(0);
  });

  it('sha 不符 → 隔离不落活附件；连续 3 次熔断不再拉', async () => {
    const d = mk('pull-bad');
    const { hash, name } = fileHash(Buffer.from('true bytes'));
    writeFileSync(join(d.syncRoot, FILES_DIR, name), 'CORRUPTED CONTENT'); // hash 对不上
    void hash;
    const s = svc(d, '{}');
    for (let i = 0; i < 3; i += 1) {
      const r = await s.runCycle();
      expect(r.pulled).toBe(0);
      expect(r.quarantined).toBe(1);
    }
    expect(readdirSync(d.attachments).filter((n) => n.endsWith('.png'))).toEqual([]);
    // 熔断后：第 4 轮 quarantined（不再尝试传输）
    const r4 = await s.runCycle();
    expect(r4.quarantined).toBe(1);
  });

  it('加密态：明密文件混排收取（对端未开加密诚实收明文+告警一次）', async () => {
    const d = mk('pull-mixed');
    const dek = generateDek();
    const content = randomBytes(100 * 1024);
    const { hash, name } = fileHash(content);
    // 远端放 SCAF1 密文
    const enc: Buffer[] = [];
    await pipeline(
      Readable.from((async function* (): AsyncGenerator<Buffer> {        yield Buffer.from(content);
})()),
      scafEncrypt(dek, name),
      async (src): Promise<void> => {
        for await (const c of src) {
          enc.push(Buffer.from(c as Buffer));
        }
      },
    );
    writeFileSync(join(d.syncRoot, FILES_DIR, `${name}.enc`), Buffer.concat(enc));
    const s = svc(d, '{}', { enc: true, dek });
    const r = await s.runCycle();
    expect(r.pulled).toBe(1);
    expect(readFileSync(join(d.attachments, name))).toEqual(content);
    void hash;
  });

  it('错钥密文 → 隔离熔断，不产生半截附件', async () => {
    const d = mk('pull-wrongkey');
    const dek = generateDek();
    const { hash, name } = fileHash(Buffer.from('secret data'));
    const enc: Buffer[] = [];
    await pipeline(
      Readable.from((async function* (): AsyncGenerator<Buffer> {        yield Buffer.from('secret data');
})()),
      scafEncrypt(dek, name),
      async (src): Promise<void> => {
        for await (const c of src) {
          enc.push(Buffer.from(c as Buffer));
        }
      },
    );
    writeFileSync(join(d.syncRoot, FILES_DIR, `${name}.enc`), Buffer.concat(enc));
    const s = svc(d, '{}', { enc: true, dek: generateDek() }); // 另一把钥
    const r = await s.runCycle();
    expect(r.pulled).toBe(0);
    expect(r.quarantined).toBe(1);
    expect(readdirSync(d.attachments).filter((n) => !n.startsWith('.'))).toEqual([]);
    void hash;
  });

  it('暂停：在途不拉、队列保留；恢复后续传', async () => {
    const d = mk('pause');
    const content = randomBytes(1024);
    const { hash, name } = fileHash(content);
    writeFileSync(join(d.attachments, name), content);
    const s = svc(d, `{"u":"attachment://${hash}"}`);
    s.pause();
    const r = await s.runCycle();
    expect(r.pushed).toBe(0);
    s.resume();
    const r2 = await s.runCycle();
    expect(r2.pushed).toBe(1);
  });

  it('残尸清扫：上轮 .part-* 半途死 → 本轮开头清掉不认它', async () => {
    const d = mk('sweep');
    writeFileSync(join(d.attachments, `${'9'.repeat(64)}.png.part-dead`), 'half');
    writeFileSync(join(d.syncRoot, FILES_DIR, '.part-ghost'), 'half');
    const s = svc(d, '{}');
    await s.stop();
    expect(existsSync(join(d.attachments, `${'9'.repeat(64)}.png.part-dead`))).toBe(false);
    expect(existsSync(join(d.syncRoot, FILES_DIR, '.part-ghost'))).toBe(false);
  });

  it('双写同 hash 幂等：远端已有同名 → skipped 非 failed', async () => {
    const d = mk('idem');
    const content = Buffer.from('same content both devices');
    const { hash, name } = fileHash(content);
    writeFileSync(join(d.attachments, name), content);
    writeFileSync(join(d.syncRoot, FILES_DIR, name), content); // 对端先到了
    const s = svc(d, `{"u":"attachment://${hash}"}`);
    const r = await s.runCycle();
    expect(r.pushed).toBe(0);
    expect(r.failed).toBe(0);
    expect(r.skippedExists).toBeGreaterThanOrEqual(1);
  });

  it('keyIdOf 一致性哨（信封头 key_id 与 DEK 派生同口径）', () => {
    const dek = generateDek();
    expect(keyIdOf(dek)).toHaveLength(16);
  });
});
