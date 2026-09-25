/**
 * dbgc.ts —— DB 面墓碑物理清除（T81-01）。
 *
 * 兑现 `main/pages.ts` 中 `purgePage` 注释的承诺：「彻底删除 = 从回收站即时移除
 * （deleted_at=0），**物理清除归 GC 任务**」。此前全仓无该 GC 实现 → page 墓碑行
 * 与其 block 行永久残留（页不可达、FTS 已清、UI 不可见，只是占字节）。
 *
 * 纪律（与 packages/sync 的 planCleanup 同源）：
 * - **删除永远先算清单**：判定纯逻辑在 `@septcats/sync` 的 `planDbGc`（零 IO），
 *   本模块只负责「查库装配描述子 → 调计划 → 执行计划内的 id」；
 * - **只删清单内 id**：逐页 `DELETE`（同事务分批），`dbgc.deletePage` 另以 `alive = 0`
 *   自守（即便清单被误喂活页 id 也 0 行受影响）；
 * - **op_ledger 一行不动**：账本是真相层；物化墓碑行是派生态，删了可由段重放复现；
 * - 段文件 GC 不在此模块（归 sync runtime 的 planCleanup）。
 *
 * 触发面：IPC `dbgc:preview` / `dbgc:run`（设置页入口）+ 启动时有界后台（仅当
 * `settings.sync.gc` 开启；fire-and-forget，不阻塞首屏——同 rebuildLinksIndex 纪律）。
 */
import { planDbGc, type DbGcHoldReason, type DbGcTombstone } from '@septcats/sync';
import type { StatementExecutor } from './pages';
import type { DbBatchStatement } from '../db/rpc';
import type { DbGcHeldCounts, DbGcPreview, DbGcRunResult } from '../shared/dbgc';

/**
 * 单事务处理的墓碑页上限：一批 = 一个 batch = 一个事务（commitOps 同纪律），
 * 分批避免长事务阻塞编辑路径的写。
 */
export const DB_GC_BATCH_PAGES = 100;

/** 回收站保留天数缺省（与 `main/sync/runtime.ts` 的 DEFAULT_RETENTION_DAYS 同值 30）。 */
export const DB_GC_DEFAULT_RETENTION_DAYS = 30;

export interface DbGcServiceOptions {
  readonly executor: StatementExecutor;
  /** 注入时钟（测试可钉；缺省 Date.now）。 */
  readonly now?: () => number;
  /** 回收站保留天数（缺省 30；purge 墓碑不受该门约束）。 */
  readonly retentionDays?: () => number;
}

export interface DbGcService {
  /** dry-run：只回条数/预估字节，**零写**。 */
  preview(): Promise<DbGcPreview>;
  /** 确认执行：真删计划内页面（同事务分批），op_ledger 不动。 */
  run(): Promise<DbGcRunResult>;
}

/** 墓碑描述子 + 报告用统计（统计列不进 planDbGc，仅用于预估/回执）。 */
interface TombstoneRow extends DbGcTombstone {
  readonly blockCount: number;
  readonly bytes: number;
}

function rowString(row: unknown, key: string): string | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value : null;
}

function rowNumber(row: unknown, key: string, fallback: number): number {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowNullableNumber(row: unknown, key: string): number | null {
  const value = (row as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function emptyHeldCounts(): DbGcHeldCounts {
  return { unreachable: 0, retention: 0, locked: 0, 'has-children': 0 };
}

function toHeldCounts(held: ReadonlyArray<{ reason: DbGcHoldReason }>): DbGcHeldCounts {
  const counts = emptyHeldCounts();
  for (const entry of held) {
    counts[entry.reason] += 1;
  }
  return counts;
}

/** 逐页级联 DELETE 语句（顺序敏感：record 先于 collection；page 最后）。 */
function statementsForPage(id: string): DbBatchStatement[] {
  return [
    { sqlId: 'dbgc.deleteRecords', params: { page_id: id } },
    { sqlId: 'dbgc.deleteCollections', params: { page_id: id } },
    { sqlId: 'dbgc.deleteLinks', params: { page_id: id } },
    { sqlId: 'dbgc.deleteFavorites', params: { page_id: id } },
    { sqlId: 'dbgc.deleteRecents', params: { page_id: id } },
    { sqlId: 'dbgc.deleteImportSources', params: { page_id: id } },
    { sqlId: 'dbgc.deleteBlocks', params: { page_id: id } },
    { sqlId: 'fts.clearPage', params: { page_id: id } },
    { sqlId: 'dbgc.deletePage', params: { id } },
  ];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createDbGcService(options: DbGcServiceOptions): DbGcService {
  const { executor } = options;
  const now = options.now ?? ((): number => Date.now());
  const retentionDays = options.retentionDays ?? ((): number => DB_GC_DEFAULT_RETENTION_DAYS);

  /** 查库装配墓碑描述子：两读一并发（墓碑 + 全表父子边），children 在 JS 侧建映射。 */
  async function loadTombstones(): Promise<TombstoneRow[]> {
    const [tombRows, parentRows] = await Promise.all([
      executor.all('dbgc.tombstones'),
      executor.all('dbgc.pageParents'),
    ]);

    const childrenOf = new Map<string, string[]>();
    for (const row of parentRows.rows) {
      const childId = rowString(row, 'id');
      const parentId = rowString(row, 'parent_id');
      if (childId === null || parentId === null) {
        continue;
      }
      const list = childrenOf.get(parentId);
      if (list === undefined) {
        childrenOf.set(parentId, [childId]);
      } else {
        list.push(childId);
      }
    }

    return tombRows.rows.map((row) => {
      const id = rowString(row, 'id');
      if (id === null) {
        // id 是 page 主键，缺 id 属数据损坏信号——绝不静默跳过（跳过=放行面失控）。
        throw new Error('E_DBGC_INVARIANT: 墓碑行缺少 id');
      }
      const deletedAt = rowNullableNumber(row, 'deleted_at');
      const updatedAt = rowNullableNumber(row, 'updated_at') ?? 0;
      return {
        id,
        deletedAt,
        // 软删以回收站时刻为锚；purge 标记（0）不留时刻，回落到该行 updated_at。
        tombstonedAt: deletedAt !== null && deletedAt > 0 ? deletedAt : updatedAt,
        childIds: childrenOf.get(id) ?? [],
        locked: rowNumber(row, 'lock_count', 0) > 0,
        blockCount: rowNumber(row, 'block_count', 0),
        bytes: rowNumber(row, 'bytes', 0),
      };
    });
  }

  async function planNow(): Promise<{
    tombstones: TombstoneRow[];
    deletable: TombstoneRow[];
    held: Array<{ tombstone: TombstoneRow; reason: DbGcHoldReason }>;
    retentionDays: number;
  }> {
    const tombstones = await loadTombstones();
    const days = retentionDays();
    const plan = planDbGc(tombstones, now(), { retentionDays: days });
    return { tombstones, deletable: [...plan.deletable], held: [...plan.held], retentionDays: days };
  }

  return {
    async preview() {
      const { tombstones, deletable, held, retentionDays: days } = await planNow();
      return {
        candidates: tombstones.length,
        deletable: deletable.length,
        held: held.length,
        heldByReason: toHeldCounts(held),
        estimatedBlocks: deletable.reduce((sum, tomb) => sum + tomb.blockCount, 0),
        estimatedBytes: deletable.reduce((sum, tomb) => sum + tomb.bytes, 0),
        retentionDays: days,
      };
    },

    async run() {
      const { deletable, held } = await planNow();
      let deletedPages = 0;
      let deletedBlocks = 0;
      let batches = 0;

      for (const group of chunk(deletable, DB_GC_BATCH_PAGES)) {
        const stmts: DbBatchStatement[] = [];
        for (const tomb of group) {
          stmts.push(...statementsForPage(tomb.id));
        }
        const result = await executor.batch(stmts);
        batches += 1;
        // 回执与 stmts 同序：累加真实 changes（deletePage 有 alive=0 自守，可能少于计划数）。
        for (const step of result.results) {
          const changes = rowNumber(step.data, 'changes', 0);
          if (step.sqlId === 'dbgc.deletePage') {
            deletedPages += changes;
          } else if (step.sqlId === 'dbgc.deleteBlocks') {
            deletedBlocks += changes;
          }
        }
      }

      return {
        deletedPages,
        deletedBlocks,
        bytesFreed: deletable.reduce((sum, tomb) => sum + tomb.bytes, 0),
        batches,
        held: held.length,
        heldByReason: toHeldCounts(held),
      };
    },
  };
}
