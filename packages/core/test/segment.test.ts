import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SegmentValidationError,
  assertSegmentName,
  buildSegment,
  computeSegId,
  decodeSegment,
  encodeSegment,
  segmentName,
  validateSegment,
  type Op,
  type Segment,
} from '../src/index';
import { DEV_A, makeOp } from './helpers';

const CREATED_AT = 1_700_000_000_000;

function sampleOps(): Op[] {
  return [
    makeOp({
      id: 'op-1',
      c: 1,
      d: DEV_A,
      entityId: 'ent0000001',
      kind: 'upsert',
      payload: { title: 'a', alive: 1 },
    }),
    makeOp({
      id: 'op-2',
      c: 2,
      d: DEV_A,
      entityId: 'ent0000002',
      kind: 'upsert',
      payload: { title: 'b', alive: 1 },
    }),
    makeOp({
      id: 'op-3',
      c: 3,
      d: DEV_A,
      entityId: 'ent0000001',
      kind: 'patch',
      payload: { title: 'a2' },
      base: 1,
      mergePolicy: 'lww',
    }),
    makeOp({
      id: 'op-4',
      c: 4,
      d: DEV_A,
      entityId: 'ent0000002',
      kind: 'delete',
      payload: {},
    }),
  ];
}

function sampleSegment(): Segment {
  return buildSegment(DEV_A, sampleOps(), CREATED_AT);
}

describe('segment', () => {
  it('encode→decode roundtrip 恒等', () => {
    const seg = sampleSegment();
    const text = encodeSegment(seg);

    // 首行为段头，其后每个 op 一行，末尾有换行
    expect(text.endsWith('\n')).toBe(true);
    const lineCount = text.split('\n').length - 1;
    expect(lineCount).toBe(seg.ops.length + 1);
    expect(text.split('\n')[0]?.startsWith('{"h":')).toBe(true);

    const decoded = decodeSegment(text);
    expect(decoded).toEqual(seg);
    expect(decoded.schema_ver).toBe(SCHEMA_VERSION);
    expect(decoded.ops).toHaveLength(4);

    // 再编码一次应为同一字节（稳定序列化）
    expect(encodeSegment(decoded)).toBe(text);

    // 段 ID 与内容自洽
    expect(seg.seg_id).toBe(computeSegId(DEV_A, 1, 4));
    expect(seg.seg_id).toBe('seg-00000001-aaaa0001-000004');
    expect(validateSegment(seg)).toEqual([]);
  });

  it('乱序 ops 段被拒绝', () => {
    const text = encodeSegment(sampleSegment());
    const lines = text.split('\n');
    // lines: [header, op1, op2, op3, op4, '']
    const swapped = [lines[0], lines[2], lines[1], lines[3], lines[4], ''].join('\n');

    expect(() => decodeSegment(swapped)).toThrow(SegmentValidationError);
    try {
      decodeSegment(swapped);
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentValidationError);
      expect((error as SegmentValidationError).issues.join(' ')).toMatch(/升序/);
    }
  });

  it('schema_ver 不符被拒绝', () => {
    const text = encodeSegment(sampleSegment());
    const lines = text.split('\n');
    const header = JSON.parse(lines[0] ?? '{}') as { h: { schema_ver: number } };
    header.h.schema_ver = SCHEMA_VERSION + 1;
    const tampered = [JSON.stringify(header), ...lines.slice(1)].join('\n');

    expect(() => decodeSegment(tampered)).toThrow(SegmentValidationError);
    try {
      decodeSegment(tampered);
    } catch (error) {
      expect((error as SegmentValidationError).issues.join(' ')).toMatch(/schema_ver/);
    }
  });

  it('文件名与内容不符被拒绝', () => {
    const seg = sampleSegment();
    const goodName = `${segmentName(seg)}.jsonl`;

    expect(() => assertSegmentName(goodName, seg)).not.toThrow();
    expect(() => assertSegmentName(`${segmentName(seg)}.jsonl.enc`, seg)).not.toThrow();
    expect(() => assertSegmentName('seg-deadbeef-aaaa0001-000004.jsonl', seg)).toThrow(
      SegmentValidationError,
    );
    expect(() => assertSegmentName('seg-00000001-aaaa0001-000999.jsonl', seg)).toThrow(
      SegmentValidationError,
    );
  });

  it('空 ops 段被拒绝', () => {
    expect(() => buildSegment(DEV_A, [], CREATED_AT)).toThrow(SegmentValidationError);

    const seg = sampleSegment();
    const empty: Segment = { ...seg, ops: [], header: { ...seg.header, n: 0 } };
    expect(() => encodeSegment(empty)).toThrow(SegmentValidationError);

    try {
      encodeSegment(empty);
    } catch (error) {
      expect((error as SegmentValidationError).issues.join(' ')).toMatch(/至少包含一个 op/);
    }
  });

  it('op_id 重复与设备不一致被拒绝', () => {
    const seg = sampleSegment();
    const duplicated: Segment = {
      ...seg,
      ops: [seg.ops[0]!, { ...seg.ops[1]!, op_id: seg.ops[0]!.op_id }],
      header: { ...seg.header, n: 2, c_to: 2 },
    };
    expect(() => encodeSegment(duplicated)).toThrow(SegmentValidationError);

    const wrongDevice: Segment = {
      ...seg,
      ops: [{ ...seg.ops[0]!, lamport: { c: 1, d: 'zzzz9999' } }],
      header: { ...seg.header, dev: DEV_A, n: 1, c_from: 1, c_to: 1 },
    };
    expect(() => encodeSegment(wrongDevice)).toThrow(SegmentValidationError);
  });

  it('decodeSegment 拒绝非法 JSON 与坏 op 行', () => {
    expect(() => decodeSegment('')).toThrow(SegmentValidationError);
    expect(() => decodeSegment('not-json\n')).toThrow(SegmentValidationError);

    const text = encodeSegment(sampleSegment());
    const lines = text.split('\n');
    const broken = [lines[0], '{"garbage": true}', ...lines.slice(2)].join('\n');
    expect(() => decodeSegment(broken)).toThrow(SegmentValidationError);

    expect(() => decodeSegment('[1,2,3]\n')).toThrow(SegmentValidationError);
    expect(() => decodeSegment('{"noH":1}\n')).toThrow(SegmentValidationError);
  });

  it('段头字段缺失被拒绝', () => {
    const text = encodeSegment(sampleSegment());
    const lines = text.split('\n');
    const header = JSON.parse(lines[0] ?? '{}') as { h: Record<string, unknown> };
    delete header.h['dev'];
    const tampered = [JSON.stringify(header), ...lines.slice(1)].join('\n');
    expect(() => decodeSegment(tampered)).toThrow(SegmentValidationError);
  });

  it('seg_id 各字段超宽或非法时被拒绝', () => {
    expect(() => computeSegId(DEV_A, 0x1_0000_0000, 1)).toThrow(SegmentValidationError);
    expect(() => computeSegId(DEV_A, 1, 0x1_000_000)).toThrow(SegmentValidationError);
    expect(() => computeSegId(DEV_A, -1, 1)).toThrow(SegmentValidationError);
    expect(() => computeSegId(DEV_A, 1.5, 1)).toThrow(SegmentValidationError);

    const seg = sampleSegment();
    const overflow: Segment = {
      ...seg,
      header: { ...seg.header, c_from: 0x1_0000_0000 },
    };
    // validateSegment 不抛错，而是把问题收集为 issues
    expect(validateSegment(overflow).length).toBeGreaterThan(0);
    expect(validateSegment(overflow).join(' ')).toMatch(/无法由 header 计算|c_from/);
  });
});
