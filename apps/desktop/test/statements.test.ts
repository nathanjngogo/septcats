import { describe, expect, it } from 'vitest';
import { SQL_IDS, STATEMENTS, getStatement } from '../src/db/statements';

const VALID_KINDS = new Set(['run', 'get', 'all']);

describe('语句白名单', () => {
  it('非空且 id 无重复', () => {
    expect(SQL_IDS.length).toBeGreaterThan(0);
    expect(new Set(SQL_IDS).size).toBe(SQL_IDS.length);
  });

  it('覆盖编辑器与重建路径所需的语句', () => {
    const required = [
      'workspace.upsert',
      'workspace.get',
      'page.upsert',
      'page.get',
      'page.listByParent',
      'page.softDelete',
      'block.upsert',
      'block.get',
      'block.listByPage',
      'block.softDelete',
      'collection.upsert',
      'record.upsert',
      'record.listByCollection',
      'opLedger.insert',
      'opLedger.listAll',
      'opLedger.count',
      'meta.get',
      'meta.set',
      'syncState.upsert',
    ];
    for (const id of required) {
      expect(getStatement(id), `缺少语句 ${id}`).not.toBeNull();
    }
  });

  it('每条：kind 合法、sql 非空、单条语句、无破坏性 SQL', () => {
    for (const [id, definition] of Object.entries(STATEMENTS)) {
      expect(VALID_KINDS.has(definition.kind), `${id} kind 非法`).toBe(true);
      expect(definition.sql.trim().length, `${id} sql 为空`).toBeGreaterThan(0);
      // prepare() 只接受单条语句；出现分号说明有人写了多语句
      expect(definition.sql.includes(';'), `${id} 不应包含分号`).toBe(false);
      const upper = definition.sql.toUpperCase();
      for (const forbidden of ['DROP', 'ALTER', 'ATTACH', 'PRAGMA']) {
        expect(upper.includes(forbidden), `${id} 含危险 SQL 片段 ${forbidden}`).toBe(false);
      }
    }
  });

  it('未知 / 原型链 id 一律返回 null（安全红线）', () => {
    expect(getStatement('page.upsert')).not.toBeNull();
    expect(getStatement('nope')).toBeNull();
    expect(getStatement('')).toBeNull();
    expect(getStatement('__proto__')).toBeNull();
    expect(getStatement('constructor')).toBeNull();
    expect(getStatement('toString')).toBeNull();
  });
});

describe('参数 schema 校验', () => {
  it('page.upsert：最小合法参数通过，缺关键字段 / 类型错拒绝', () => {
    const page = getStatement('page.upsert');
    expect(page).not.toBeNull();
    const valid = { id: 'pg-1', workspace_id: 'ws-1', sort_key: 'A00000000', version: 1 };
    expect(page!.params.safeParse(valid).success).toBe(true);
    expect(page!.params.safeParse({ sort_key: 'A00000000', version: 1 }).success).toBe(false);
    expect(page!.params.safeParse({ ...valid, version: 'one' }).success).toBe(false);
    expect(page!.params.safeParse({ ...valid, alive: 2 }).success).toBe(false);
  });

  it('page.upsert：未知键被剥离（不进入绑定参数）', () => {
    const page = getStatement('page.upsert');
    const parsed = page!.params.safeParse({
      id: 'pg-1',
      workspace_id: 'ws-1',
      sort_key: 'A00000000',
      version: 1,
      evil: 'x',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(Object.keys(parsed.data as Record<string, unknown>)).not.toContain('evil');
    }
  });

  it('block.upsert：actorId 规则（8-32 位 [a-z0-9]）', () => {
    const block = getStatement('block.upsert');
    const base = {
      id: 'bk-1',
      page_id: 'pg-1',
      workspace_id: 'ws-1',
      type: 'paragraph',
      sort_key: 'A00000000',
      version: 1,
      lamport_c: 1,
    };
    expect(block!.params.safeParse({ ...base, lamport_d: 'aaaa0001' }).success).toBe(true);
    expect(block!.params.safeParse({ ...base, lamport_d: 'AAAA0001' }).success).toBe(false);
    expect(block!.params.safeParse({ ...base, lamport_d: 'short' }).success).toBe(false);
    expect(block!.params.safeParse({ ...base, lamport_d: 'a'.repeat(33) }).success).toBe(false);
    expect(block!.params.safeParse({ ...base, lamport_c: 0 }).success).toBe(false);
  });

  it('opLedger.insert：target_table 只接受 core 的枚举值', () => {
    const ledger = getStatement('opLedger.insert');
    const base = {
      op_id: 'op-1',
      lamport_c: 1,
      lamport_d: 'aaaa0001',
      target_table: 'block',
      target_id: 'bk-1',
      op_json: '{"op_id":"op-1"}',
      applied_at: 1_700_000_000_000,
    };
    expect(ledger!.params.safeParse(base).success).toBe(true);
    expect(ledger!.params.safeParse({ ...base, target_table: 'evil' }).success).toBe(false);
    expect(ledger!.params.safeParse({ ...base, target_table: 'DROP TABLE' }).success).toBe(false);
  });

  it('无参语句（list/count）接受空对象', () => {
    for (const id of ['workspace.list', 'opLedger.listAll', 'opLedger.count', 'opLedger.maxLamport']) {
      const definition = getStatement(id);
      expect(definition, `缺少语句 ${id}`).not.toBeNull();
      expect(definition!.params.safeParse({}).success).toBe(true);
    }
  });
});
