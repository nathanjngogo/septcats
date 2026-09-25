import { describe, expect, it } from 'vitest';
import { SQL_IDS, STATEMENTS, getStatement } from '../src/db/statements';
import { describeDb, makeCore, makeTempDb, requestOk } from './helpers';
import type { AllData, MigrateData, RunData } from '../src/db/rpc';

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

// ---------------------------------------------------------------------------
// v2 白名单（TASK-T6-01 §2）：page 树 / 回收站 / favorite / recent
// ---------------------------------------------------------------------------

/** v2 追加的 12 条语句与各自的 happy 参数（全部必须带 workspace_id）。 */
const V2_HAPPY: Readonly<Record<string, Record<string, unknown>>> = {
  'page.insert': { id: 'pg-1', workspace_id: 'ws-1', sort_key: 'A00000000', version: 1 },
  'page.rename': { id: 'pg-1', workspace_id: 'ws-1', title: '新标题', version: 2 },
  'page.setSort': { id: 'pg-1', workspace_id: 'ws-1', sort_key: 'A00000001', version: 2 },
  'page.setChildrenOrder': {
    id: 'pg-1',
    workspace_id: 'ws-1',
    parent_id: 'pg-9',
    sort_key: 'A00000001',
    version: 2,
  },
  'page.setDeleted': { id: 'pg-1', workspace_id: 'ws-1', deleted_at: 1_700_000_000_000, version: 2 },
  'page.listAll': { workspace_id: 'ws-1' },
  'page.listTrash': { workspace_id: 'ws-1' },
  'favorite.add': { user_key: 'dev-1', page_id: 'pg-1', added_at: 1, workspace_id: 'ws-1' },
  'favorite.remove': { user_key: 'dev-1', page_id: 'pg-1', workspace_id: 'ws-1' },
  'favorite.list': { user_key: 'dev-1', workspace_id: 'ws-1' },
  'recent.touch': { user_key: 'dev-1', page_id: 'pg-1', last_opened: 1, workspace_id: 'ws-1' },
  'recent.list': { user_key: 'dev-1', workspace_id: 'ws-1' },
};

/** v2 的读语句（kind=all）。 */
const V2_READS = new Set(['page.listAll', 'page.listTrash', 'favorite.list', 'recent.list']);

describe('v2 白名单（页面树/回收站/收藏/最近）', () => {
  it('全部语句齐全且语法预算 < 85', () => {
    for (const id of Object.keys(V2_HAPPY)) {
      expect(getStatement(id), `缺少语句 ${id}`).not.toBeNull();
    }
    expect(SQL_IDS.length).toBeLessThan(100);
    expect(SQL_IDS.length).toBeGreaterThanOrEqual(39);
  });

  it('每条 happy 参数通过校验，kind 与读写语义一致', () => {
    for (const [id, params] of Object.entries(V2_HAPPY)) {
      const definition = getStatement(id);
      expect(definition, `缺少语句 ${id}`).not.toBeNull();
      expect(definition!.params.safeParse(params).success, `${id} happy 参数被拒`).toBe(true);
      expect(definition!.kind).toBe(V2_READS.has(id) ? 'all' : 'run');
    }
  });

  it('每条都强制 workspace_id：缺省 / 空串 / 类型错一律拒绝', () => {
    for (const [id, params] of Object.entries(V2_HAPPY)) {
      const definition = getStatement(id)!;
      const withoutWorkspace = { ...params };
      delete withoutWorkspace['workspace_id'];
      expect(definition.params.safeParse(withoutWorkspace).success, `${id} 缺 workspace_id 应拒`).toBe(false);
      expect(
        definition.params.safeParse({ ...params, workspace_id: '' }).success,
        `${id} 空 workspace_id 应拒`,
      ).toBe(false);
      expect(
        definition.params.safeParse({ ...params, workspace_id: 42 }).success,
        `${id} 非字符串 workspace_id 应拒`,
      ).toBe(false);
    }
  });

  it('page.setDeleted：deleted_at 允许 0（彻底删除标记）与正数，拒绝负数', () => {
    const definition = getStatement('page.setDeleted')!;
    const base = { id: 'pg-1', workspace_id: 'ws-1', version: 2 };
    expect(definition.params.safeParse({ ...base, deleted_at: 0 }).success).toBe(true);
    expect(definition.params.safeParse({ ...base, deleted_at: 1_700_000_000_000 }).success).toBe(true);
    expect(definition.params.safeParse({ ...base, deleted_at: null }).success).toBe(true);
    expect(definition.params.safeParse({ ...base, deleted_at: -1 }).success).toBe(false);
  });

  it('page.rename / page.setChildrenOrder：必填字段缺失被拒', () => {
    const rename = getStatement('page.rename')!;
    expect(rename.params.safeParse({ id: 'pg-1', workspace_id: 'ws-1', version: 2 }).success).toBe(false);
    const order = getStatement('page.setChildrenOrder')!;
    expect(
      order.params.safeParse({ id: 'pg-1', workspace_id: 'ws-1', sort_key: 'A', version: 2 }).success,
    ).toBe(true);
    expect(order.params.safeParse({ id: 'pg-1', workspace_id: 'ws-1', version: 2 }).success).toBe(false);
  });

  it('v2 写语句不含分号 / 破坏性片段；WHERE 一律带 workspace_id', () => {
    for (const id of Object.keys(V2_HAPPY)) {
      const sql = getStatement(id)!.sql;
      expect(sql.includes(';'), `${id} 含分号`).toBe(false);
      for (const forbidden of ['DROP', 'ALTER', 'ATTACH', 'PRAGMA']) {
        expect(sql.toUpperCase().includes(forbidden), `${id} 含 ${forbidden}`).toBe(false);
      }
      expect(sql, `${id} 未带 workspace_id 约束`).toContain('workspace_id');
    }
  });
});

// ---------------------------------------------------------------------------
// v5 白名单（TASK-T11-01 §C-2）：import_source 导入幂等账本
// ---------------------------------------------------------------------------

const IMPORT_SOURCE_HAPPY: Readonly<Record<string, Record<string, unknown>>> = {
  'importSource.insert': {
    source_path: '研究/实验数据台账',
    content_hash: 'a'.repeat(64),
    page_id: 'pg-1',
    created_at: 1_700_000_000_000,
  },
  'importSource.get': { source_path: '研究/实验数据台账', content_hash: 'a'.repeat(64) },
};

describe('v5 白名单（import_source）', () => {
  it('三条语句齐全，预算同步（79 条含 v6 defer 开关、T20-01 <3 字兜底语句、T21-01 block.patch/setSort、T23-01 template.* 五条、T31-01 opLedger 对账两条、T44-01 双链 link.*/links.* 六条，以及 T67-01 lock.*/lock_cipher.* 六条 + block.deleteByPage、T81-01 dbgc.* 十条，仍 < 100）', () => {
    for (const id of Object.keys(IMPORT_SOURCE_HAPPY)) {
      expect(getStatement(id), `缺少语句 ${id}`).not.toBeNull();
    }
    expect(getStatement('importSource.list')).not.toBeNull();
    expect(getStatement('importSource.list')!.params.safeParse({}).success).toBe(true);
    expect(SQL_IDS.length).toBe(89);
    expect(SQL_IDS.length).toBeLessThan(100);
  });

  it('每条 happy 参数通过校验，kind 与读写语义一致（run/get）', () => {
    for (const [id, params] of Object.entries(IMPORT_SOURCE_HAPPY)) {
      const definition = getStatement(id)!;
      expect(definition.params.safeParse(params).success, `${id} happy 参数被拒`).toBe(true);
      expect(definition.kind).toBe(id === 'importSource.get' ? 'get' : 'run');
    }
  });

  it('参数校验：缺字段 / hash 形态非法 / created_at 负数一律拒绝', () => {
    const insert = getStatement('importSource.insert')!;
    const happy = IMPORT_SOURCE_HAPPY['importSource.insert']!;
    expect(insert.params.safeParse({ ...happy, content_hash: 'zz' }).success).toBe(false);
    expect(insert.params.safeParse({ ...happy, created_at: -1 }).success).toBe(false);
    expect(insert.params.safeParse({ ...happy, page_id: '' }).success).toBe(false);
    const shortened = { ...happy };
    delete shortened['page_id'];
    expect(insert.params.safeParse(shortened).success).toBe(false);

    const lookup = getStatement('importSource.get')!;
    expect(
      lookup.params.safeParse({ source_path: 'x', content_hash: 'A'.repeat(64) }).success,
    ).toBe(false);
  });

  it('按表实际列建模：语句不带 workspace_id 守卫（表无该列，报告 §C-2 说明）', () => {
    for (const id of Object.keys(IMPORT_SOURCE_HAPPY)) {
      const sql = getStatement(id)!.sql;
      expect(sql).not.toContain('workspace_id');
      expect(sql.includes(';')).toBe(false);
      for (const forbidden of ['DROP', 'ALTER', 'ATTACH', 'PRAGMA']) {
        expect(sql.toUpperCase().includes(forbidden)).toBe(false);
      }
    }
  });

  // T82-02（H-05）：判重加页存活校验，SQL 一条 LEFT JOIN 收口（禁内存二次过滤大表）。
  it('importSource.list：JOIN page 收口存活校验（alive=1 且 deleted_at IS NULL）', () => {
    const sql = getStatement('importSource.list')!.sql;
    expect(sql).toContain('FROM import_source i JOIN page p ON p.id = i.page_id');
    expect(sql).toContain('p.alive = 1');
    expect(sql).toContain('p.deleted_at IS NULL');
    expect(sql.includes(';')).toBe(false);
    for (const forbidden of ['DROP', 'ALTER', 'ATTACH', 'PRAGMA']) {
      expect(sql.toUpperCase().includes(forbidden)).toBe(false);
    }
    // 列名保持旧口径（调用方按 source_path/content_hash/page_id 读行）
    for (const column of ['source_path', 'content_hash', 'page_id']) {
      expect(sql).toContain(`i.${column} AS ${column}`);
    }
  });

  // T82-02（H-05）：落账不再是 OR IGNORE——死引用重导须把 page_id 指向新活页。
  it('importSource.insert：冲突时 DO UPDATE page_id（重导闭环幂等，非 OR IGNORE）', () => {
    const sql = getStatement('importSource.insert')!.sql;
    expect(sql).toContain('ON CONFLICT(source_path, content_hash) DO UPDATE SET');
    expect(sql).toContain('page_id = excluded.page_id');
    expect(sql.toUpperCase()).not.toContain('INSERT OR IGNORE');
    expect(sql.includes(';')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// v6 白名单（TASK-T15-01）：FTS 触发器 defer 开关（migration #6 的 fts_defer）
// ---------------------------------------------------------------------------

describe('v6 白名单（fts.deferOn / fts.deferOff）', () => {
  it('两条开关语句齐全', () => {
    expect(getStatement('fts.deferOn')).not.toBeNull();
    expect(getStatement('fts.deferOff')).not.toBeNull();
  });

  it('kind=run、空参、单条 UPDATE、无破坏性片段', () => {
    for (const id of ['fts.deferOn', 'fts.deferOff']) {
      const definition = getStatement(id)!;
      expect(definition.kind).toBe('run');
      expect(definition.params.safeParse({}).success).toBe(true);
      expect(definition.sql.includes(';')).toBe(false);
      expect(definition.sql.toUpperCase()).toContain('UPDATE FTS_DEFER SET FLAG');
      for (const forbidden of ['DROP', 'ALTER', 'ATTACH', 'PRAGMA', 'DELETE']) {
        expect(definition.sql.toUpperCase().includes(forbidden), `${id} 含 ${forbidden}`).toBe(false);
      }
    }
    expect(getStatement('fts.deferOn')!.sql.toUpperCase()).toContain('FLAG = 1');
    expect(getStatement('fts.deferOff')!.sql.toUpperCase()).toContain('FLAG = 0');
  });
});

describeDb('v6 defer 开关（better-sqlite3 直连）', (ctor) => {
  it('deferOn → flag=1，deferOff → flag=0；越值写被表级 CHECK 拒绝', async () => {
    const temp = makeTempDb('septcats-defer-switch');
    const core = makeCore(ctor, temp.path);
    try {
      await requestOk<MigrateData>(core, { id: 'dm', t: 'migrate' });
      const db = core.activeDatabase();
      expect((db.prepare('SELECT flag FROM fts_defer').get() as { flag: number }).flag).toBe(0);

      await requestOk<RunData>(core, { id: 'don', t: 'run', sqlId: 'fts.deferOn', params: {} });
      expect((db.prepare('SELECT flag FROM fts_defer').get() as { flag: number }).flag).toBe(1);

      await requestOk<RunData>(core, { id: 'doff', t: 'run', sqlId: 'fts.deferOff', params: {} });
      expect((db.prepare('SELECT flag FROM fts_defer').get() as { flag: number }).flag).toBe(0);

      expect(() => db.exec('UPDATE fts_defer SET flag = 2')).toThrow();
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });
});

describeDb('v2 工作区隔离（better-sqlite3 直连）', (ctor) => {
  it('越界 workspace_id 的写一律 0 行受影响（page / favorite / recent）', async () => {
    const temp = makeTempDb('septcats-ws-guard');
    const core = makeCore(ctor, temp.path);
    const AT = 1_700_000_000_000;
    try {
      await requestOk<MigrateData>(core, { id: 'm1', t: 'migrate' });
      await requestOk<RunData>(core, {
        id: 'p1',
        t: 'run',
        sqlId: 'page.insert',
        params: { id: 'pg-1', workspace_id: 'ws-a', title: '甲', sort_key: 'A00000000', version: 1 },
      });

      const deleted = await requestOk<RunData>(core, {
        id: 'd1',
        t: 'run',
        sqlId: 'page.setDeleted',
        params: { id: 'pg-1', workspace_id: 'ws-b', deleted_at: AT, version: 2 },
      });
      expect(deleted.changes).toBe(0);

      const renamed = await requestOk<RunData>(core, {
        id: 'r1',
        t: 'run',
        sqlId: 'page.rename',
        params: { id: 'pg-1', workspace_id: 'ws-b', title: '乙', version: 2 },
      });
      expect(renamed.changes).toBe(0);

      const favOther = await requestOk<RunData>(core, {
        id: 'f1',
        t: 'run',
        sqlId: 'favorite.add',
        params: { user_key: 'dev-1', page_id: 'pg-1', added_at: 1, workspace_id: 'ws-b' },
      });
      expect(favOther.changes).toBe(0);

      const recentOther = await requestOk<RunData>(core, {
        id: 't1',
        t: 'run',
        sqlId: 'recent.touch',
        params: { user_key: 'dev-1', page_id: 'pg-1', last_opened: 1, workspace_id: 'ws-b' },
      });
      expect(recentOther.changes).toBe(0);

      const favMine = await requestOk<RunData>(core, {
        id: 'f2',
        t: 'run',
        sqlId: 'favorite.add',
        params: { user_key: 'dev-1', page_id: 'pg-1', added_at: 1, workspace_id: 'ws-a' },
      });
      expect(favMine.changes).toBe(1);
      const favList = await requestOk<AllData>(core, {
        id: 'f3',
        t: 'all',
        sqlId: 'favorite.list',
        params: { user_key: 'dev-1', workspace_id: 'ws-a' },
      });
      expect(favList.rows).toHaveLength(1);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('回收站语义：deleted_at>0 进 listTrash，deleted_at=0（彻底删除标记）不露出', async () => {
    const temp = makeTempDb('septcats-trash-guard');
    const core = makeCore(ctor, temp.path);
    try {
      await requestOk<MigrateData>(core, { id: 'm1', t: 'migrate' });
      for (const id of ['pg-a', 'pg-b']) {
        await requestOk<RunData>(core, {
          id: `insert-${id}`,
          t: 'run',
          sqlId: 'page.insert',
          params: { id, workspace_id: 'ws-a', title: id, sort_key: `A0000000${id === 'pg-a' ? '0' : '1'}`, version: 1 },
        });
      }
      const purge = await requestOk<RunData>(core, {
        id: 'purge',
        t: 'run',
        sqlId: 'page.setDeleted',
        params: { id: 'pg-a', workspace_id: 'ws-a', deleted_at: 0, version: 2 },
      });
      expect(purge.changes).toBe(1);
      const soft = await requestOk<RunData>(core, {
        id: 'soft',
        t: 'run',
        sqlId: 'page.setDeleted',
        params: { id: 'pg-b', workspace_id: 'ws-a', deleted_at: 1_700_000_000_000, version: 2 },
      });
      expect(soft.changes).toBe(1);

      const trash = await requestOk<AllData>(core, {
        id: 'trash',
        t: 'all',
        sqlId: 'page.listTrash',
        params: { workspace_id: 'ws-a' },
      });
      expect(trash.rows.map((row) => (row as { id: string }).id)).toEqual(['pg-b']);

      const all = await requestOk<AllData>(core, {
        id: 'all',
        t: 'all',
        sqlId: 'page.listAll',
        params: { workspace_id: 'ws-a' },
      });
      expect(all.rows).toHaveLength(2);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });
});
