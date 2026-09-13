/**
 * search.test.ts —— search:query 服务的真 SQLite 用例（TASK-T8-01 §4）。
 *
 * 覆盖：中文子串命中、多块同页 snippet 取最优、LIKE 兜底 code 命中、
 * limit/空串/特殊字符（引号/通配符）不崩、1 万页 P95 < 150ms 性能红线。
 * 夹具：test/helpers.ts 的 makeSearchFixtureDb（mulberry32 确定性中文文本）。
 */
import { expect, it } from 'vitest';
import { createSearchService } from '../src/main/search';
import type { SearchHit } from '../src/shared/search';
import { coreExecutor, makeSearchFixtureDb, makeTempDb, describeDb } from './helpers';
import type { SqliteConstructor } from '../src/db/migrations';

const WORKSPACE = 'ws-search';

async function makeSmallDb(ctor: SqliteConstructor) {
  const temp = makeTempDb('septcats-search');
  const core = await makeSearchFixtureDb(ctor, temp.path, 60, { workspaceId: WORKSPACE });
  return { core, temp };
}

function titles(hits: readonly SearchHit[]): string[] {
  return hits.map((hit) => hit.title);
}

describeDb('search:query（真 SQLite 夹具）', (ctor) => {
  it('中文子串命中（FTS，via=fts，含路径与摘要）', async () => {
    const { core, temp } = await makeSmallDb(ctor);
    try {
      const service = createSearchService({ executor: coreExecutor(core) });
      const { hits, tookMs } = await service.query({ workspaceId: WORKSPACE, query: '核反冲' });
      expect(hits.length).toBeGreaterThan(0);
      expect(tookMs).toBeGreaterThanOrEqual(0);
      const first = hits[0];
      expect(first?.kind).toBe('page');
      expect(first?.via).toBe('fts');
      expect(first?.pageId).not.toBeNull();
      expect(first?.snippet).toContain('核反冲');
      expect(Array.isArray(first?.path)).toBe(true);
      // 每 7 页一个标题探针：标题命中应排前（×0.6 加权）
      expect(titles(hits).some((title) => title.startsWith('核反冲'))).toBe(true);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('多块同页 snippet 取最优（定位到命中块，而非停在首个块）', async () => {
    const temp = makeTempDb('septcats-snippet');
    const core = await makeSearchFixtureDb(ctor, temp.path, 10, { workspaceId: WORKSPACE });
    try {
      const db = core.activeDatabase();
      // 构造：标题与 A 块都不命中、B 块命中——snippet 必须越过标题/A 定位到 B
      insPage(db, 'pg-snip', WORKSPACE, '量子现象研究页');
      insBlock(db, 'bk-snip-a', 'pg-snip', WORKSPACE, '本段完全无关，只作占位观察窗口行为。');
      insBlock(db, 'bk-snip-b', 'pg-snip', WORKSPACE, '本段讨论量子纠缠与简并区的对应关系。');
      const service = createSearchService({ executor: coreExecutor(core) });
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: '量子纠缠' });
      const pageHit = hits.find((hit) => hit.id === 'pg-snip');
      expect(pageHit).toBeDefined();
      // 最优窗口落在 B 块（唯一命中块），其独有词应出现在摘要里
      expect(pageHit?.snippet).toContain('简并');
      expect(pageHit?.snippet).toContain('[量子纠缠]');
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('LIKE 兜底命中 code 块正文（via=like，kind=block）', async () => {
    const { core, temp } = await makeSmallDb(ctor);
    try {
      const service = createSearchService({ executor: coreExecutor(core) });
      // code 块正文不进 FTS（trigram MATCH 不应命中），只能 LIKE 兜底
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: 'build:fast' });
      expect(hits.length).toBeGreaterThan(0);
      const blockHit = hits.find((hit) => hit.kind === 'block');
      expect(blockHit?.via).toBe('like');
      expect(blockHit?.pageId).not.toBeNull();
      expect(blockHit?.snippet).toContain('build:fast');
      // 排序：FTS（≤0）在前，LIKE（=1）在后
      const ftsScores = hits.filter((hit) => hit.via === 'fts').map((hit) => hit.score);
      expect(ftsScores.every((score) => score < 1)).toBe(true);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('collection / record LIKE 命中（数据库组）', async () => {
    const temp = makeTempDb('septcats-dblike');
    const core = await makeSearchFixtureDb(ctor, temp.path, 5, { workspaceId: WORKSPACE });
    try {
      const db = core.activeDatabase();
      db.prepare(
        `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
         VALUES ('pg-ledger', ?, '实验数据台账', NULL, NULL, NULL, 'A00000000', 1, 1, 0)`,
      ).run(WORKSPACE);
      db.prepare(
        `INSERT INTO collection (id, page_id, workspace_id, name, schema_json, views_json, alive, version, lamport_c, lamport_d, updated_at)
         VALUES ('cl-ledger', 'pg-ledger', ?, '核反冲候选台账', '{}', '[]', 1, 1, 1, 'aaaa0001', 0)`,
      ).run(WORKSPACE);
      db.prepare(
        `INSERT INTO record (id, collection_id, workspace_id, values_json, backlinks_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
         VALUES ('rc-ledger-1', 'cl-ledger', ?, '{}', '{}', 'A00000000', 1, 1, 1, 'aaaa0001', 0)`,
      ).run(WORKSPACE);
      db.prepare(
        `UPDATE record SET values_json = ? WHERE id = 'rc-ledger-1'`,
      ).run(JSON.stringify({ 备注: '核反冲等效能 4.2 keVnr，接受' }));

      const service = createSearchService({ executor: coreExecutor(core) });
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: '核反冲' });
      const collectionHit = hits.find((hit) => hit.kind === 'collection');
      expect(collectionHit?.id).toBe('cl-ledger');
      expect(collectionHit?.pageId).toBe('pg-ledger');
      const recordHit = hits.find((hit) => hit.kind === 'record');
      expect(recordHit?.snippet).toContain('核反冲');
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('limit / 空串 / 特殊字符（引号、通配符）不崩', async () => {
    const { core, temp } = await makeSmallDb(ctor);
    try {
      const service = createSearchService({ executor: coreExecutor(core) });

      const limited = await service.query({ workspaceId: WORKSPACE, query: '核反冲', limit: 3 });
      expect(limited.hits.length).toBeLessThanOrEqual(3);

      for (const empty of ['', '   ']) {
        const result = await service.query({ workspaceId: WORKSPACE, query: empty });
        expect(result.hits).toEqual([]);
      }

      for (const evil of ['"', 'a"b', '%', '_', '100%"_', '\\', "'"]) {
        const result = await service.query({ workspaceId: WORKSPACE, query: evil });
        expect(Array.isArray(result.hits)).toBe(true);
      }

      // types 过滤：仅页面 → 不含数据库组
      const pagesOnly = await service.query({
        workspaceId: WORKSPACE,
        query: '核反冲',
        types: ['page'],
      });
      expect(pagesOnly.hits.every((hit) => hit.kind === 'page')).toBe(true);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('1 万页 fixture：查询 P95 < 150ms（性能红线）', async () => {
    const temp = makeTempDb('septcats-perf');
    const core = await makeSearchFixtureDb(ctor, temp.path, 10_000, { workspaceId: WORKSPACE });
    try {
      const service = createSearchService({ executor: coreExecutor(core) });
      // 预热（JIT / 页缓存稳定后再计时）
      await service.query({ workspaceId: WORKSPACE, query: '核反冲' });
      await service.query({ workspaceId: WORKSPACE, query: '探测器' });

      // 探针词全部为夹具文本中的确定性连续子串（trigram 需 ≥3 字）
      const probes = ['核反冲', '探测器', '观测约束', '关键输入', '研究笔记', '效率曲线', '系统性偏差', 'build:fast'];
      const samples: number[] = [];
      for (let round = 0; round < 3; round += 1) {
        for (const probe of probes) {
          const started = performance.now();
          const { hits } = await service.query({ workspaceId: WORKSPACE, query: probe, limit: 40 });
          samples.push(performance.now() - started);
          expect(Array.isArray(hits)).toBe(true);
        }
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.min(samples.length - 1, Math.ceil(0.95 * samples.length) - 1)] ?? Number.POSITIVE_INFINITY;
      // eslint-disable-next-line no-console -- 性能数据直接进测试输出，供报告引用
      console.log(`  search P95 = ${p95.toFixed(1)} ms（${String(samples.length)} 次采样，1 万页）`);
      expect(p95).toBeLessThan(150);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// 小工具（独立小页，避免 fixture 噪声影响断言）
// ---------------------------------------------------------------------------

function insPage(
  db: import('better-sqlite3').Database,
  id: string,
  workspaceId: string,
  title: string,
): void {
  db.prepare(
    `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 'A00000000', 1, 1, 0)`,
  ).run(id, workspaceId, title);
}

function insBlock(
  db: import('better-sqlite3').Database,
  id: string,
  pageId: string,
  workspaceId: string,
  text: string,
): void {
  db.prepare(
    `INSERT INTO block (id, page_id, workspace_id, type, props_json, content_json, sort_key, alive, version, lamport_c, lamport_d, updated_at)
     VALUES (?, ?, ?, 'paragraph', '{}', ?, 'A00000000', 1, 1, 1, 'aaaa0001', 0)`,
  ).run(id, pageId, workspaceId, JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }));
}
