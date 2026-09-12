import { describe, expect, it } from 'vitest';
import * as core from '../src/index';

describe('core barrel', () => {
  it('导出关键符号', () => {
    expect(core.SCHEMA_VERSION).toBe(1);
    expect(core.SORTKEY_INITIAL).toBe('A00000000');
    expect(typeof core.replay).toBe('function');
    expect(typeof core.sortBetween).toBe('function');
    expect(typeof core.encodeOp).toBe('function');
    expect(typeof core.decodeOp).toBe('function');
    expect(typeof core.encodeSegment).toBe('function');
    expect(typeof core.decodeSegment).toBe('function');
    expect(typeof core.opsToSnapshot).toBe('function');
    expect(typeof core.snapshotToOps).toBe('function');
    expect(typeof core.ulid).toBe('function');
    expect(typeof core.compareLamport).toBe('function');
    expect(typeof core.LamportClock).toBe('function');
    expect(typeof core.Projection).toBe('function');
    expect(typeof core.OpValidationError).toBe('function');
    expect(typeof core.SegmentValidationError).toBe('function');
    expect(typeof core.SnapshotValidationError).toBe('function');
    expect(typeof core.InvalidSortRange).toBe('function');
  });
});
