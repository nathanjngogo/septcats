/**
 * search-lock.test.ts —— 范围3 搜索锁态标记（TASK-T67-01-B2-01）。
 *
 * 端到端（真实 better-sqlite3）：search 服务注入同一 lock 服务实例后，
 * - 已锁页的命中 `locked: true`（标题可命中，正文永不出）；
 * - 未锁页的命中 `locked: false`；
 * - 未注入 lock 服务（legacy/测试兼容）→ 全部 `locked: false`。
 * better-sqlite3 不可用时整组跳过（见 test/helpers.ts）。
 */
import { expect, it } from 'vitest';
import { createSearchService } from '../src/main/search';
import { createLockService } from '../src/main/lock';
import type { SearchHit } from '../src/shared/search';
import { coreExecutor, makeSearchFixtureDb, makeTempDb, describeDb } from './helpers';

const WORKSPACE = 'ws-search-lock';

function insPage(db: import('better-sqlite3').Database, id: string, title: string): void {
  db.prepare(
    `INSERT INTO page (id, workspace_id, title, icon, cover, parent_id, sort_key, alive, version, updated_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 'A00000000', 1, 1, 0)`,
  ).run(id, WORKSPACE, title);
}

describeDb('search:query 锁页标记（范围3）', (ctor) => {
  it('已锁页命中 locked=true，未锁页命中 locked=false', async () => {
    const temp = makeTempDb('septcats-search-lock');
    const core = await makeSearchFixtureDb(ctor, temp.path, 5, { workspaceId: WORKSPACE });
    try {
      const executor = coreExecutor(core);
      const lock = createLockService({ executor });
      const db = core.activeDatabase();
      // 两页标题都含「保密」，仅甲页上锁
      insPage(db, 'pg-lk-a', '保密档案甲');
      insPage(db, 'pg-lk-b', '保密档案乙');
      await lock.setPass('pg-lk-a', 'pw12345');

      const service = createSearchService({ executor, lock });
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: '保密' });
      const find = (pageId: string): SearchHit | undefined =>
        hits.find((hit) => hit.kind === 'page' && hit.pageId === pageId);
      expect(find('pg-lk-a')?.locked).toBe(true);
      expect(find('pg-lk-b')?.locked).toBe(false);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('会话已解锁的页：命中仍按 getStatus 判为锁页（locked=true，搜索口径=有口令即锁页）', async () => {
    const temp = makeTempDb('septcats-search-lock-2');
    const core = await makeSearchFixtureDb(ctor, temp.path, 5, { workspaceId: WORKSPACE });
    try {
      const executor = coreExecutor(core);
      const lock = createLockService({ executor });
      const db = core.activeDatabase();
      insPage(db, 'pg-lk-c', '保密档案丙');
      await lock.setPass('pg-lk-c', 'pw12345');
      // 先 verify 解锁（会话缓存 DK）——readBlocks 据此出明文，但 getStatus 不 Consult
      // 会话，仍按「有口令即锁页」返回 locked:true，故搜索命中标记不变。
      await lock.verify('pg-lk-c', 'pw12345');

      const service = createSearchService({ executor, lock });
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: '保密' });
      const hit = hits.find((h) => h.kind === 'page' && h.pageId === 'pg-lk-c');
      expect(hit?.locked).toBe(true);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });

  it('未注入 lock 服务：命中 locked 一律 false（兼容 legacy）', async () => {
    const temp = makeTempDb('septcats-search-lock-3');
    const core = await makeSearchFixtureDb(ctor, temp.path, 5, { workspaceId: WORKSPACE });
    try {
      const executor = coreExecutor(core);
      const db = core.activeDatabase();
      insPage(db, 'pg-lk-d', '保密档案丁');

      const service = createSearchService({ executor });
      const { hits } = await service.query({ workspaceId: WORKSPACE, query: '保密' });
      const hit = hits.find((h) => h.kind === 'page' && h.pageId === 'pg-lk-d');
      expect(hit?.locked).toBe(false);
    } finally {
      core.dispose();
      temp.cleanup();
    }
  });
});
