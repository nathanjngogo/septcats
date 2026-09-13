import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@septcats/core';
import { decodeManifest, encodeManifest, mergeManifest, type Manifest } from '../src/manifest';
import { DEV_A, DEV_B } from './helpers';

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  const base: Manifest = {
    schema_ver: SCHEMA_VERSION,
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_100_000,
    devices: {
      [DEV_A]: { last_lamport: 41, last_seen_at: 1_700_000_100_000, client_ver: '0.1.0' },
    },
    snapshot: { seq: 0, lamport: 0, covers_through: 0 },
    retention_days: 30,
    segment_watermark: 41,
  };
  return { ...base, ...overrides };
}

describe('manifest encode/decode', () => {
  it('encode → decode 往返逐字段相等', () => {
    const manifest = makeManifest({
      devices: {
        [DEV_A]: { last_lamport: 41, last_seen_at: 1_700_000_100_000, client_ver: '0.1.0' },
        [DEV_B]: { last_lamport: 7, last_seen_at: 1_700_000_050_000, client_ver: '0.1.0' },
      },
      snapshot: { seq: 18, lamport: 50, covers_through: 50 },
    });
    expect(decodeManifest(encodeManifest(manifest))).toEqual(manifest);
  });

  it('encode 输出键序稳定（同内容同字节）', () => {
    const a = makeManifest();
    const b = makeManifest();
    expect(encodeManifest(a)).toBe(encodeManifest(b));
    // 设备键插入顺序不同也不影响稳定键序
    const c = makeManifest({
      devices: {
        [DEV_B]: { last_lamport: 7, last_seen_at: 5, client_ver: 'x' },
        [DEV_A]: { last_lamport: 41, last_seen_at: 9, client_ver: 'y' },
      },
    });
    expect(encodeManifest(c)).toBe(
      encodeManifest(
        makeManifest({
          devices: {
            [DEV_A]: { last_lamport: 41, last_seen_at: 9, client_ver: 'y' },
            [DEV_B]: { last_lamport: 7, last_seen_at: 5, client_ver: 'x' },
          },
        }),
      ),
    );
  });

  it('decodeManifest 非法 JSON / 截断 → null（不抛）', () => {
    expect(decodeManifest('not-json')).toBeNull();
    expect(decodeManifest('{')).toBeNull();
    expect(decodeManifest('')).toBeNull();
    const full = encodeManifest(makeManifest());
    expect(decodeManifest(full.slice(0, Math.floor(full.length / 2)))).toBeNull();
  });

  it('decodeManifest 未来 schema_ver → null', () => {
    const future = makeManifest({ schema_ver: SCHEMA_VERSION + 1 });
    expect(decodeManifest(encodeManifest(future))).toBeNull();
  });

  it('decodeManifest 缺字段 / 类型错 / 非法设备键 → null', () => {
    const good = makeManifest();
    const asObj = JSON.parse(encodeManifest(good)) as Record<string, unknown>;

    const missing = { ...asObj };
    delete missing['segment_watermark'];
    expect(decodeManifest(JSON.stringify(missing))).toBeNull();

    const badType = { ...asObj, retention_days: 'thirty' };
    expect(decodeManifest(JSON.stringify(badType))).toBeNull();

    const badDevKey = { ...asObj, devices: { 'UPPER!': { last_lamport: 1, last_seen_at: 1, client_ver: 'x' } } };
    expect(decodeManifest(JSON.stringify(badDevKey))).toBeNull();

    const badDevEntry = { ...asObj, devices: { [DEV_A]: { last_lamport: 'x', last_seen_at: 1, client_ver: 'x' } } };
    expect(decodeManifest(JSON.stringify(badDevEntry))).toBeNull();

    const badSnapshot = { ...asObj, snapshot: { seq: 1, lamport: 2 } };
    expect(decodeManifest(JSON.stringify(badSnapshot))).toBeNull();

    expect(decodeManifest(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  it('decodeManifest 空设备表合法', () => {
    const manifest = makeManifest({ devices: {} });
    const decoded = decodeManifest(encodeManifest(manifest));
    expect(decoded).not.toBeNull();
    expect(decoded?.devices).toEqual({});
  });
});

describe('mergeManifest', () => {
  it('设备表并集 + 水位取 max', () => {
    const local = makeManifest({
      devices: { [DEV_A]: { last_lamport: 41, last_seen_at: 10, client_ver: '0.1.0' } },
      segment_watermark: 41,
    });
    const remote = makeManifest({
      devices: { [DEV_B]: { last_lamport: 99, last_seen_at: 20, client_ver: '0.1.1' } },
      segment_watermark: 99,
    });
    const merged = mergeManifest(local, remote);
    expect(Object.keys(merged.devices).sort()).toEqual([DEV_A, DEV_B].sort());
    expect(merged.segment_watermark).toBe(99);
  });

  it('重叠设备 last_lamport / last_seen_at 取 max，client_ver 取最近活跃侧', () => {
    const local = makeManifest({
      devices: { [DEV_A]: { last_lamport: 10, last_seen_at: 100, client_ver: 'old' } },
    });
    const remote = makeManifest({
      devices: { [DEV_A]: { last_lamport: 50, last_seen_at: 200, client_ver: 'new' } },
    });
    const merged = mergeManifest(local, remote);
    expect(merged.devices[DEV_A]).toEqual({ last_lamport: 50, last_seen_at: 200, client_ver: 'new' });
  });

  it('schema_ver 取 min（保守）', () => {
    const local = makeManifest({ schema_ver: 1 });
    const remote = makeManifest({ schema_ver: 2 });
    expect(mergeManifest(local, remote).schema_ver).toBe(1);
    expect(mergeManifest(remote, local).schema_ver).toBe(1);
  });

  it('冲突不丢设备：两侧设备键全部保留', () => {
    const shared = 'cccc0003';
    const local = makeManifest({
      devices: {
        [DEV_A]: { last_lamport: 5, last_seen_at: 1, client_ver: 'a' },
        [shared]: { last_lamport: 3, last_seen_at: 2, client_ver: 's' },
      },
    });
    const remote = makeManifest({
      devices: {
        [DEV_B]: { last_lamport: 7, last_seen_at: 3, client_ver: 'b' },
        [shared]: { last_lamport: 9, last_seen_at: 4, client_ver: 's2' },
      },
    });
    const merged = mergeManifest(local, remote);
    expect(Object.keys(merged.devices).sort()).toEqual([DEV_A, DEV_B, shared].sort());
    expect(merged.devices[shared]).toEqual({ last_lamport: 9, last_seen_at: 4, client_ver: 's2' });
  });

  it('快照水位与 retention 取 max，created_at 取 min，updated_at 取 max', () => {
    const local = makeManifest({
      created_at: 100,
      updated_at: 200,
      snapshot: { seq: 1, lamport: 10, covers_through: 10 },
      retention_days: 30,
    });
    const remote = makeManifest({
      created_at: 50,
      updated_at: 300,
      snapshot: { seq: 2, lamport: 20, covers_through: 20 },
      retention_days: 60,
    });
    const merged = mergeManifest(local, remote);
    expect(merged.created_at).toBe(50);
    expect(merged.updated_at).toBe(300);
    expect(merged.snapshot).toEqual({ seq: 2, lamport: 20, covers_through: 20 });
    expect(merged.retention_days).toBe(60);
  });
});
