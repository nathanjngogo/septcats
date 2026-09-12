import { describe, expect, it } from 'vitest';
import {
  OpValidationError,
  SCHEMA_VERSION,
  compareOpLamport,
  decodeOp,
  encodeOp,
  stableStringify,
  validateOpSemantics,
} from '../src/index';
import { DEV_A, makeOp } from './helpers';

describe('op', () => {
  it('encode→decode roundtrip 恒等且键序稳定', () => {
    const op = makeOp({
      id: 'op-x',
      c: 3,
      d: DEV_A,
      entityId: 'ent0001',
      kind: 'patch',
      payload: { b: 1, a: 2 },
      base: 2,
      mergePolicy: 'lww',
    });

    const line = encodeOp(op);
    expect(line.includes('\n')).toBe(false);
    // 键按字典序：actor 排在最前
    expect(line.startsWith('{"actor"')).toBe(true);
    expect(decodeOp(line)).toEqual(op);
    expect(encodeOp(decodeOp(line))).toBe(line);
  });

  it('稳定序列化与输入键序无关，undefined 键被丢弃', () => {
    const a = { b: 1, a: [{ y: 1, x: 2 }] };
    const b = { a: [{ x: 2, y: 1 }], b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableStringify([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('非法输入被拒绝', () => {
    expect(() => decodeOp('not-json')).toThrow(OpValidationError);
    expect(() => decodeOp('{"kind":"upsert"}')).toThrow(OpValidationError);

    const good = makeOp({ id: 'op-good', c: 1, d: DEV_A });
    expect(() =>
      decodeOp(JSON.stringify({ ...good, lamport: { c: 0, d: DEV_A } })),
    ).toThrow(OpValidationError);
    expect(() => decodeOp(JSON.stringify({ ...good, actor: 'BAD ID' }))).toThrow(
      OpValidationError,
    );
    expect(() => decodeOp(JSON.stringify({ ...good, kind: 'explode' }))).toThrow(
      OpValidationError,
    );
    expect(() => encodeOp({ ...good, at: -1 })).toThrow(OpValidationError);
    // 目标表不在白名单内（构造非法输入需绕过静态类型）
    const badTarget = { ...good, target: { table: 'nope', id: 'x' } } as unknown as typeof good;
    expect(() => encodeOp(badTarget)).toThrow(OpValidationError);
  });

  it('upsert/delete 不允许携带 base，patch 允许', () => {
    const upsert = makeOp({ id: 'u', c: 1, d: DEV_A, base: 1 });
    expect(validateOpSemantics(upsert)).toHaveLength(1);
    expect(() => encodeOp(upsert)).toThrow(OpValidationError);

    const del = makeOp({ id: 'd', c: 1, d: DEV_A, kind: 'delete', base: 1 });
    expect(() => encodeOp(del)).toThrow(OpValidationError);

    const patch = makeOp({ id: 'p', c: 1, d: DEV_A, kind: 'patch', base: 1 });
    expect(validateOpSemantics(patch)).toEqual([]);
    expect(decodeOp(encodeOp(patch))).toEqual(patch);

    expect(SCHEMA_VERSION).toBe(1);
  });

  it('compareOpLamport 在 lamport 相同时按 op_id 决胜', () => {
    const base = makeOp({ id: 'op-b', c: 1, d: DEV_A });
    const other = { ...base, op_id: 'op-a' };

    expect(compareOpLamport(other, base)).toBeLessThan(0);
    expect(compareOpLamport(base, other)).toBeGreaterThan(0);
    expect(compareOpLamport(base, { ...base })).toBe(0);
    expect(compareOpLamport(base, { ...base, lamport: { c: 2, d: DEV_A } })).toBeLessThan(0);
  });
});
