import { describe, expect, it } from 'vitest';
import { planCleanup } from '../src/gc';
import { DEV_A, DEV_B, makeManifest } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function segs() {
  return [
    { file: 'seg-00000001-aaaa0001-000001.jsonl', cTo: 5, dev: DEV_A },
    { file: 'seg-00000006-aaaa0001-000001.jsonl', cTo: 10, dev: DEV_A },
  ];
}

describe('planCleanup 双重门（S9）', () => {
  it('retention 未过 → 不放行（即使设备水位全越过）', () => {
    // updated_at 距 now 仅 1 天，retention_days=30 → retention 未过
    const manifest = makeManifest({ updated_at: NOW - 1 * DAY, retention_days: 30 });
    const watermarks = new Map([[DEV_A, 100]]);
    expect(planCleanup(manifest, segs(), watermarks, NOW)).toEqual([]);
  });

  it('某设备水位未越过 → 该段不放行', () => {
    // retention 已过（静默 31 天），但 DEV_B 水位只有 3，未越过 cTo=5/10
    const manifest = makeManifest({
      updated_at: NOW - 31 * DAY,
      retention_days: 30,
      devices: {
        [DEV_A]: { last_lamport: 100, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
        [DEV_B]: { last_lamport: 3, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
      },
    });
    const watermarks = new Map([
      [DEV_A, 100],
      [DEV_B, 3],
    ]);
    expect(planCleanup(manifest, segs(), watermarks, NOW)).toEqual([]);
  });

  it('retention 已过 且 所有设备水位全越过 → 全放行', () => {
    const manifest = makeManifest({
      updated_at: NOW - 31 * DAY,
      retention_days: 30,
      devices: {
        [DEV_A]: { last_lamport: 100, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
        [DEV_B]: { last_lamport: 50, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
      },
    });
    const watermarks = new Map([
      [DEV_A, 100],
      [DEV_B, 50],
    ]);
    expect(planCleanup(manifest, segs(), watermarks, NOW)).toEqual(segs().map((s) => s.file));
  });

  it('水位恰好等于 cTo 视为越过（>= 语义）', () => {
    const manifest = makeManifest({
      updated_at: NOW - 31 * DAY,
      retention_days: 30,
      devices: { [DEV_A]: { last_lamport: 10, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' } },
    });
    // 第二段 cTo=10，DEV_A 水位正好 10 → 越过
    const single = [{ file: 'seg-00000006-aaaa0001-000001.jsonl', cTo: 10, dev: DEV_A }];
    expect(planCleanup(manifest, single, new Map([[DEV_A, 10]]), NOW)).toEqual([single[0]?.file]);
  });

  it('掉线设备在 7 天宽限期内 → 保守不放行', () => {
    // DEV_B 在 manifest 里（last_seen_at = 2 天前），但 watermarks 无其水位 → 宽限期内阻塞
    const manifest = makeManifest({
      updated_at: NOW - 31 * DAY,
      retention_days: 30,
      devices: {
        [DEV_A]: { last_lamport: 100, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
        [DEV_B]: { last_lamport: 50, last_seen_at: NOW - 2 * DAY, client_ver: '0.1.0' },
      },
    });
    const watermarks = new Map([[DEV_A, 100]]);
    expect(planCleanup(manifest, segs(), watermarks, NOW)).toEqual([]);
  });

  it('掉线设备静默超 7 天 → 不再阻塞清理', () => {
    // DEV_B last_seen_at = 8 天前，超宽限期 → 视为离场，DEV_A 水位已越过 → 放行
    const manifest = makeManifest({
      updated_at: NOW - 31 * DAY,
      retention_days: 30,
      devices: {
        [DEV_A]: { last_lamport: 100, last_seen_at: NOW - 31 * DAY, client_ver: '0.1.0' },
        [DEV_B]: { last_lamport: 50, last_seen_at: NOW - 8 * DAY, client_ver: '0.1.0' },
      },
    });
    const watermarks = new Map([[DEV_A, 100]]);
    expect(planCleanup(manifest, segs(), watermarks, NOW)).toEqual(segs().map((s) => s.file));
  });

  it('retention_days=0 → retention 视为恒已过（保留窗口不设限）', () => {
    const manifest = makeManifest({ updated_at: NOW, retention_days: 0 });
    const single = [{ file: 'seg-x.jsonl', cTo: 5, dev: DEV_A }];
    expect(planCleanup(manifest, single, new Map([[DEV_A, 100]]), NOW)).toEqual(['seg-x.jsonl']);
  });
});
