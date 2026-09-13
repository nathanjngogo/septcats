import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, buildSegment, encodeSegment } from '@septcats/core';
import { buildFileIndex } from '../src/dedupe';
import { planQuarantine } from '../src/quarantine';
import { SyncErrorCodes } from '../src/errors';
import { DEV_A, makeOp } from './helpers';

describe('buildFileIndex 内容寻址去重（S3 口径）', () => {
  it('按 sha 归组，byHash 含单文件组', () => {
    const { byHash } = buildFileIndex([
      { file: 'a.bin', sha: 'h1' },
      { file: 'b.bin', sha: 'h2' },
    ]);
    expect(byHash.size).toBe(2);
    expect(byHash.get('h1')).toEqual(['a.bin']);
    expect(byHash.get('h2')).toEqual(['b.bin']);
  });

  it('同 sha 多副本 → 字典序首个为规范副本，其余为 duplicates', () => {
    const { byHash, duplicates } = buildFileIndex([
      { file: 'seg-x (1).jsonl', sha: 'h1' },
      { file: 'seg-x.jsonl', sha: 'h1' },
      { file: 'seg-x (2).jsonl', sha: 'h1' },
    ]);
    expect(byHash.get('h1')).toEqual(['seg-x (1).jsonl', 'seg-x (2).jsonl', 'seg-x.jsonl']);
    // 字典序：'seg-x (1)' < 'seg-x (2)' < 'seg-x'，规范副本 = seg-x (1)，其余为副本
    expect(duplicates).toEqual(['seg-x (2).jsonl', 'seg-x.jsonl']);
  });

  it('无 sha 的文件不参与内容去重', () => {
    const { byHash, duplicates } = buildFileIndex([
      { file: 'nohash.bin' },
      { file: 'a.bin', sha: 'h1' },
    ]);
    expect(byHash.size).toBe(1);
    expect(byHash.has('h1')).toBe(true);
    expect(duplicates).toEqual([]);
  });

  it('空输入 → 空索引', () => {
    const { byHash, duplicates } = buildFileIndex([]);
    expect(byHash.size).toBe(0);
    expect(duplicates).toEqual([]);
  });
});

describe('planQuarantine 坏段隔离清单', () => {
  it('合法段 → 不隔离', () => {
    const seg = buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A })]);
    const text = encodeSegment(seg);
    expect(planQuarantine([{ file: 'ok.jsonl', text }])).toEqual([]);
  });

  it('半截段（缺结尾换行）→ SEGMENT_TRUNCATED', () => {
    const seg = buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A })]);
    const full = encodeSegment(seg);
    const half = full.slice(0, Math.floor(full.length / 2));
    const truncated = half.endsWith('\n') ? half.slice(0, -1) : half;
    expect(planQuarantine([{ file: 'bad.jsonl', text: truncated }])).toEqual([
      { file: 'bad.jsonl', reason: SyncErrorCodes.SEGMENT_TRUNCATED },
    ]);
  });

  it('未来 schema_ver → SCHEMA_TOO_NEW', () => {
    const seg = buildSegment(DEV_A, [makeOp({ c: 1, d: DEV_A })]);
    const text = encodeSegment(seg);
    const firstLine = text.slice(0, text.indexOf('\n'));
    const parsed = JSON.parse(firstLine) as { h: Record<string, unknown> };
    parsed.h['schema_ver'] = SCHEMA_VERSION + 1;
    const future = `${JSON.stringify(parsed)}\n${text.slice(text.indexOf('\n') + 1)}`;
    expect(planQuarantine([{ file: 'future.jsonl', text: future }])).toEqual([
      { file: 'future.jsonl', reason: SyncErrorCodes.SCHEMA_TOO_NEW },
    ]);
  });

  it('首行非 JSON → SEGMENT_INVALID', () => {
    expect(planQuarantine([{ file: 'junk.jsonl', text: 'not-json\n' }])).toEqual([
      { file: 'junk.jsonl', reason: SyncErrorCodes.SEGMENT_INVALID },
    ]);
  });

  it('空内容 → 视为空段，不隔离', () => {
    expect(planQuarantine([{ file: 'empty.jsonl', text: '' }])).toEqual([]);
    expect(planQuarantine([{ file: 'blank.jsonl', text: '  \n' }])).toEqual([]);
  });
});
