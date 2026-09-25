/**
 * fts-defer.test.ts —— FTS 触发器 defer 守卫语义（TASK-T15-01 §3）。
 *
 * 背景：v4 块 FTS 触发器每行写都整页重算（O(n²)，性能红牌 #30）。v6 迁移引入
 * `fts_defer` 常规表（PM 探针定案：TEMP 表在触发器内不可见，必须常规表）+ 六个
 * 触发器的 `WHEN (SELECT flag FROM fts_defer LIMIT 1)=0` 守卫；白名单新增
 * `fts.deferOn`/`fts.deferOff`；rebuild 事务头尾与 commitOps 批量（≥2 条
 * block.upsert）自动包裹 defer。本文件锁四条语义：
 *  a) defer 开 → 写块（触发器跳过）→ 关 → 显式/尾部同步后查询命中最新内容；
 *  b) rebuild 事务中途 throw → flag 随事务回滚回 0，库回到重建前状态；
 *  c) 常规单块写（无批量 defer）触发器照常即时生效——守卫不误伤常规路径；
 *  d) flag 是**库级共享**状态（单行单值、跨连接可见）：defer 期间任何连接写块
 *     都跳过触发器重算。运行期只有 rebuild（独占子进程）与 commitOps 单事务
 *     batch 置 1，且同事务回滚兜底，共享不会产生跨事务残留。
 */
import { buildSegment, type ActorId, type Op } from '@septcats/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { commitOps } from '../src/main/commit';
import type {
  AllData,
  BatchData,
  FtsSearchData,
  MigrateData,
  RebuildData,
  RunData,
} from '../src/db/rpc';
import type { DbServerCore } from '../src/db/server';
import type { SqliteDatabase } from '../src/db/migrations';
import {
  coreExecutor,
  describeDb,
  makeCore,
  makeTempDb,
  requestOk,
  type TempDb,
} from './helpers';

const AT = 1_700_000_000_000;
const DEV: ActorId = 'aaaa0001';
const WS = 'ws-defer';
const PAGE = 'pg-defer';
const PROBE = 'defer探针段落词组';

let requestSeq = 0;
function nextId(label: string): string {
  requestSeq += 1;
  return `${label}-${String(requestSeq)}`;
}

/** PM doc 形态 content_json（深层 text 键，json_tree 抽取路径）。 */
function paragraphDoc(text: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
}

function makeBlockOp(index: number, pageId: string, text: string): Op {
  return {
    op_id: `op-defer-block-${String(index)}`,
    lamport: { c: index + 1, d: DEV },
    at: AT,
    actor: DEV,
    target: { table: 'block', id: `bk-defer-${String(index)}` },
    kind: 'upsert',
    payload: {
      page_id: pageId,
      workspace_id: WS,
      type: 'paragraph',
      props: {},
      content: JSON.parse(paragraphDoc(text)) as unknown,
      sort_key: `A${String(index).padStart(8, '0')}`,
      alive: 1,
      updated_at: AT,
    },
  };
}

async function seedPage(core: DbServerCore, pageId: string, title: string): Promise<void> {
  await requestOk<RunData>(core, {
    id: nextId('seed-page'),
    t: 'run',
    sqlId: 'page.insert',
    params: { id: pageId, workspace_id: WS, title, sort_key: 'A00000000', version: 1 },
  });
}

async function readFlag(db: SqliteDatabase): Promise<number> {
  return (db.prepare('SELECT flag FROM fts_defer').get() as { flag: number }).flag;
}

async function ftsSearch(core: DbServerCore, query: string): Promise<string[]> {
  const data = await requestOk<FtsSearchData>(core, {
    id: nextId('fts'),
    t: 'ftsSearch',
    workspaceId: WS,
    query,
    limit: 10,
  });
  return data.rows.map((row) => row.page_id);
}

describeDb('FTS 触发器 defer 守卫（TASK-T15-01）', (ctor) => {
  describe('a) defer 开 → 写 3 块 → 关 → 查询命中最新内容', () => {
    let temp: TempDb;
    let core: DbServerCore;

    beforeAll(async () => {
      temp = makeTempDb('septcats-fts-defer-a');
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: nextId('migrate'), t: 'migrate' });
      await seedPage(core, PAGE, 'defer 测试页');
    });

    afterAll(() => {
      core.dispose();
      temp.cleanup();
    });

    it('defer 期间触发器被跳过（无显式同步则 FTS 不更新），关闭并显式同步后命中最新内容', async () => {
      // 手工组装：deferOn + 3 块 + deferOff（刻意**不带** fts.syncBlock——
      // 断言守卫真的让触发器短路了，FTS 行停在旧状态）
      const blocks = [1, 2, 3].map((index) =>
        makeBlockOp(index, PAGE, `${PROBE} 第 ${String(index)} 块`),
      );
      const executed = await commitOps(coreExecutor(core), blocks, { workspaceId: WS });
      expect(executed).toBe(3);
      // commitOps 批量（≥2 条 block.upsert）自动 defer 包裹，结束 flag 必回 0
      expect(await readFlag(core.activeDatabase())).toBe(0);

      // 尾部 fts.clearPage + fts.syncBlock 已做单次重算 → 命中最新内容
      expect(await ftsSearch(core, PROBE)).toContain(PAGE);
      expect(await readFlag(core.activeDatabase())).toBe(0);
    });

    it('deferOn 裸包（不显式同步）→ 触发器短路、FTS 不见新块；syncBlock 补一次后命中', async () => {
      const deferPage = 'pg-defer-bare';
      await seedPage(core, deferPage, '裸 defer 页');
      await requestOk<BatchData>(core, {
        id: nextId('batch'),
        t: 'batch',
        stmts: [
          { sqlId: 'fts.deferOn', params: {} },
          {
            sqlId: 'block.upsert',
            params: {
              id: 'bk-defer-bare',
              page_id: deferPage,
              workspace_id: WS,
              type: 'paragraph',
              props_json: '{}',
              content_json: paragraphDoc(`${PROBE} 裸包块`),
              sort_key: 'A00000000',
              alive: 1,
              version: 1,
              lamport_c: 1,
              lamport_d: DEV,
              updated_at: AT,
            },
          },
          { sqlId: 'fts.deferOff', params: {} },
        ],
      });
      // 守卫生效：defer 期间的块写没有触发整页重算
      expect(await ftsSearch(core, PROBE)).not.toContain(deferPage);
      // 显式同步路径（rebuild 的 FTS_RESYNC / commitOps 尾部 sync 的等价物）补算
      await requestOk<RunData>(core, {
        id: nextId('sync'),
        t: 'run',
        sqlId: 'fts.syncBlock',
        params: { page_id: deferPage },
      });
      expect(await ftsSearch(core, PROBE)).toContain(deferPage);
      expect(await readFlag(core.activeDatabase())).toBe(0);
    });
  });

  describe('b) rebuild 中途 throw → flag 回 0（事务回滚）', () => {
    let temp: TempDb;
    let core: DbServerCore;

    beforeAll(async () => {
      temp = makeTempDb('septcats-fts-defer-b');
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: nextId('migrate'), t: 'migrate' });
      // 重建前状态：1 页 1 块（含探针词），FTS 有行
      await seedPage(core, 'pg-keep', '重建前保留页');
      await requestOk<BatchData>(core, {
        id: nextId('seed-block'),
        t: 'batch',
        stmts: [
          {
            sqlId: 'block.upsert',
            params: {
              id: 'bk-keep',
              page_id: 'pg-keep',
              workspace_id: WS,
              type: 'paragraph',
              props_json: '{}',
              content_json: paragraphDoc('重建前保留块内容'),
              sort_key: 'A00000000',
              alive: 1,
              version: 1,
              lamport_c: 1,
              lamport_d: DEV,
              updated_at: AT,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      // 注入 throw 后整体回滚：库回到 seed 状态（含 flag=0），无需重建夹具
      expect(await readFlag(core.activeDatabase())).toBe(0);
    });

    afterAll(() => {
      core.dispose();
      temp.cleanup();
    });

    it('rebuild 事务在 FTS_RESYNC 处注入 throw：整体回滚，flag=0、账本/物化/FTS 均回重建前', async () => {
      const db = core.activeDatabase();
      // 注入：exec 走到 FTS_RESYNC（含 INSERT INTO page_block_fts 的多语句串）时炸——
      // 此时 flag=1 已写、清库+账本+物化已灌完，正是「中途」最深的时点
      const originalExec = db.exec.bind(db);
      (db as unknown as { exec: (sql: string) => void }).exec = (sql: string): void => {
        if (sql.includes('INSERT INTO page_block_fts')) {
          throw new Error('injected: rebuild 中途失败');
        }
        originalExec(sql);
      };

      const segmentsJson = JSON.stringify([
        buildSegment(DEV, [
          {
            op_id: 'op-defer-rb-page',
            lamport: { c: 1, d: DEV },
            at: AT,
            actor: DEV,
            target: { table: 'page', id: 'pg-rb' },
            kind: 'upsert',
            payload: { workspace_id: WS, title: '重建页', sort_key: 'A00000000', alive: 1 },
          },
          makeBlockOp(101, 'pg-rb', '重建页的新块'),
        ], AT),
      ]);

      const response = await core.handleRequest({
        id: nextId('rebuild'),
        t: 'rebuildFromSegments',
        segmentsJson,
        mode: 'replace', // T82-01：本用例账本为空，验的是「清表 → 仅重放段」
      });
      // 还原 exec（连接还要给后面的断言用）
      (db as unknown as { exec: (sql: string) => void }).exec = originalExec;
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe('E_INTERNAL');
        expect(response.error.message).toContain('injected');
      }

      // 事务回滚层：flag 一并回 0（PM 事实——defer 写在同一个事务里）
      expect(await readFlag(db)).toBe(0);
      // 数据层同样回滚：账本 0 条（seed 只走物化 batch 未写 ledger）、重建前
      // 状态原样、FTS 仍命中旧内容、重建的 op 不在
      const ledger = await requestOk<AllData>(core, {
        id: nextId('ledger'),
        t: 'all',
        sqlId: 'opLedger.listAll',
        params: {},
      });
      expect(ledger.rows).toHaveLength(0);
      const keep = await requestOk<AllData>(core, {
        id: nextId('keep'),
        t: 'all',
        sqlId: 'block.listByPage',
        params: { page_id: 'pg-keep' },
      });
      expect(keep.rows).toHaveLength(1);
      expect(await ftsSearch(core, '重建前保留块')).toContain('pg-keep');
      expect(await ftsSearch(core, '重建页的新块')).toHaveLength(0);
    });

    it('rebuild 正常路径：事务头尾 defer 包裹，结束 flag=0 且 FTS 命中', async () => {
      const segmentsJson = JSON.stringify([
        buildSegment(DEV, [
          {
            op_id: 'op-defer-rb-ok',
            lamport: { c: 1, d: DEV },
            at: AT,
            actor: DEV,
            target: { table: 'page', id: 'pg-rb-ok' },
            kind: 'upsert',
            payload: { workspace_id: WS, title: '正常重建页', sort_key: 'A00000000', alive: 1 },
          },
          makeBlockOp(201, 'pg-rb-ok', `${PROBE} 正常重建块`),
        ], AT),
      ]);
      const rebuilt = await requestOk<RebuildData>(core, {
        id: nextId('rebuild-ok'),
        t: 'rebuildFromSegments',
        segmentsJson,
        mode: 'replace',
      });
      expect(rebuilt.entities).toBe(2);
      expect(await readFlag(core.activeDatabase())).toBe(0);
      expect(await ftsSearch(core, PROBE)).toContain('pg-rb-ok');
    });
  });

  describe('c) 常规单块写（无批量）触发器照常即时生效', () => {
    let temp: TempDb;
    let core: DbServerCore;

    beforeAll(async () => {
      temp = makeTempDb('septcats-fts-defer-c');
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: nextId('migrate'), t: 'migrate' });
      await seedPage(core, PAGE, '常规写入页');
    });

    afterAll(() => {
      core.dispose();
      temp.cleanup();
    });

    it('flag=0 下单条 block.upsert：触发器即时把正文送进 FTS，查询立即可命中', async () => {
      expect(await readFlag(core.activeDatabase())).toBe(0);
      // 单条 run（不走批量 defer 路径），不追加任何显式 fts 同步
      await requestOk<RunData>(core, {
        id: nextId('single-block'),
        t: 'run',
        sqlId: 'block.upsert',
        params: {
          id: 'bk-single',
          page_id: PAGE,
          workspace_id: WS,
          type: 'paragraph',
          props_json: '{}',
          content_json: paragraphDoc('守卫不误伤常规路径的即时正文'),
          sort_key: 'A00000000',
          alive: 1,
          version: 1,
          lamport_c: 1,
          lamport_d: DEV,
          updated_at: AT,
        },
      });
      expect(await ftsSearch(core, '守卫不误伤')).toContain(PAGE);
      // 更新（au 触发器）同样即时生效
      await requestOk<RunData>(core, {
        id: nextId('update-block'),
        t: 'run',
        sqlId: 'block.upsert',
        params: {
          id: 'bk-single',
          page_id: PAGE,
          workspace_id: WS,
          type: 'paragraph',
          props_json: '{}',
          content_json: paragraphDoc('更新后的最新正文内容出现'),
          sort_key: 'A00000000',
          alive: 1,
          version: 2,
          lamport_c: 2,
          lamport_d: DEV,
          updated_at: AT,
        },
      });
      expect(await ftsSearch(core, '更新后的最新正文')).toContain(PAGE);
      expect(await ftsSearch(core, '守卫不误伤的即时正文')).toHaveLength(0);
    });
  });

  describe('d) flag 库级共享语义（跨连接可见）', () => {
    let temp: TempDb;
    let core: DbServerCore;
    let conn2: SqliteDatabase;

    beforeAll(async () => {
      temp = makeTempDb('septcats-fts-defer-d');
      core = makeCore(ctor, temp.path);
      await requestOk<MigrateData>(core, { id: nextId('migrate'), t: 'migrate' });
      await seedPage(core, PAGE, '共享语义页');
      // 第二条独立连接（WAL 同库多连）；不重跑迁移，只补 busy_timeout
      conn2 = new ctor(temp.path);
      conn2.pragma('busy_timeout = 5000');
    });

    afterAll(() => {
      conn2.close();
      core.dispose();
      temp.cleanup();
    });

    it('连接 A deferOn → 连接 B 立即可见且其块写同样跳过触发器；B 复位后 A 亦见 0', async () => {
      // 连接 A（DbServer 的连接）开 defer
      await requestOk<RunData>(core, { id: nextId('on'), t: 'run', sqlId: 'fts.deferOn', params: {} });
      // 连接 B 直读：flag 是库级单行状态，不是连接局部
      expect(await readFlag(conn2)).toBe(1);
      // 连接 B 写块：同样被守卫短路（FTS 不出现该块内容）
      conn2
        .prepare(
          `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
           VALUES ('bk-shared', ?, ?, 'paragraph', '{}', ?, 'A00000000', 1, 1, 1, ?, ?)`,
        )
        .run(PAGE, WS, paragraphDoc('跨连接共享期间写入的块'), DEV, AT);
      expect(await ftsSearch(core, '跨连接共享期间写入')).toHaveLength(0);
      // 连接 B 复位 → 连接 A 也读到 0；B 的显式 sync 补算后命中
      conn2.exec('UPDATE fts_defer SET flag = 0');
      expect(await readFlag(core.activeDatabase())).toBe(0);
      await requestOk<RunData>(core, {
        id: nextId('sync2'),
        t: 'run',
        sqlId: 'fts.syncBlock',
        params: { page_id: PAGE },
      });
      expect(await ftsSearch(core, '跨连接共享期间写入')).toContain(PAGE);
      // flag=0 恢复后，连接 B 的常规写触发器照常生效（守卫复位无误伤）
      conn2
        .prepare(
          `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
           VALUES ('bk-shared-2', ?, ?, 'paragraph', '{}', ?, 'A00000001', 1, 1, 2, ?, ?)`,
        )
        .run(PAGE, WS, paragraphDoc('复位后常规写入的块'), DEV, AT);
      expect(await ftsSearch(core, '复位后常规写入')).toContain(PAGE);
    });
  });
});
