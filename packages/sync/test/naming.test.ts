import { describe, expect, it } from 'vitest';
import { buildSegment, encodeSegment, type Op, type Segment } from '@septcats/core';
import {
  contentFingerprint,
  isSidecarCopy,
  parseSegmentFileName,
  segmentFileName,
} from '../src/naming';
import { DEV_A, makeOp } from './helpers';

function sampleSegment(): Segment {
  const ops: Op[] = [
    makeOp({ c: 1, d: DEV_A, entityId: 'ent1', payload: { title: 'a', alive: 1 } }),
    makeOp({ c: 2, d: DEV_A, entityId: 'ent2', payload: { title: 'b', alive: 1 } }),
  ];
  return buildSegment(DEV_A, ops, 1_700_000_000_000);
}

describe('naming', () => {
  it('segmentFileName 生成规范名（含内容摘要，T29-01）', () => {
    const seg = sampleSegment();
    const text = encodeSegment(seg);
    const d8 = contentFingerprint(text).slice(0, 8);
    expect(seg.seg_id).toBe('seg-00000001-aaaa0001-000002');
    expect(segmentFileName(seg)).toBe(`seg-00000001-aaaa0001-000002-${d8}.jsonl`);
    // 同内容同名、不同内容不同名（段名去碰撞的核心，T29-01）
    expect(segmentFileName(seg, text)).toBe(segmentFileName(seg));
    const other = buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A, entityId: 'ent1' })], 1_700_000_000_000);
    expect(segmentFileName(other)).not.toBe(segmentFileName(seg));
  });

  it('parseSegmentFileName 与 segmentFileName 往返（新命名含摘要）', () => {
    const seg = sampleSegment();
    const name = segmentFileName(seg);
    const d8 = contentFingerprint(encodeSegment(seg)).slice(0, 8);
    expect(parseSegmentFileName(name)).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      digest: d8,
      copySuffix: 0,
      encrypted: false,
    });
  });

  it('parse 兼容旧命名（无内容摘要，digest 缺省）——T29-01 只增不破', () => {
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002.jsonl')).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      copySuffix: 0,
      encrypted: false,
    });
  });

  it('parse 识别网盘副本（扩展名前后两种位置）', () => {
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002 (1).jsonl')).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      copySuffix: 1,
      encrypted: false,
    });
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002.jsonl (2)')).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      copySuffix: 2,
      encrypted: false,
    });
  });

  it('parse 识别加密段', () => {
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002.jsonl.enc')).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      copySuffix: 0,
      encrypted: true,
    });
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002 (1).jsonl.enc')).toEqual({
      cFrom: 1,
      dev: 'aaaa0001',
      n: 2,
      copySuffix: 1,
      encrypted: true,
    });
  });

  it('parse 对非法名返回 null', () => {
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002')).toBeNull(); // 无扩展名
    expect(parseSegmentFileName('seg-00000001-aaaa0001-000002.txt')).toBeNull();
    expect(parseSegmentFileName('snapshot-000018.json')).toBeNull();
    expect(parseSegmentFileName('seg-0000000-aaaa0001-000002.jsonl')).toBeNull(); // 宽度不足
    expect(parseSegmentFileName('seg-00000001-AAAA0001-000002.jsonl')).toBeNull(); // 大写 dev
    expect(parseSegmentFileName('foo.jsonl')).toBeNull();
  });

  it('isSidecarCopy 识别副本', () => {
    expect(isSidecarCopy('x.jsonl (1)')).toBe(true);
    expect(isSidecarCopy('x (2).jsonl')).toBe(true);
    expect(isSidecarCopy('x.jsonl')).toBe(false);
    expect(isSidecarCopy('x.jsonl.enc')).toBe(false);
  });

  it('contentFingerprint 返回稳定 sha256 hex', () => {
    const h = contentFingerprint('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentFingerprint('hello')).toBe(h);
    expect(contentFingerprint('hello!')).not.toBe(h);
  });
});
