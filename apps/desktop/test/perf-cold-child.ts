/**
 * perf-cold-child.ts —— 冷进程「打开真库 → 第一次搜索查询」打点（TASK-T14-01 §1）。
 *
 * 由 test/perf.test.ts 以 `node --import tsx perf-cold-child.ts <dbPath> <workspaceId>`
 * 拉起（范式同 scripts/run-selftest.mjs：cwd=apps/desktop，pretest 已保证 better-sqlite3
 * 为 Node ABI）。stdout 末行输出一个 JSON：{"open_ms","first_query_ms","hit_count"}，
 * 其余诊断走 stderr，供父进程解析后做预算断言与 perf-history.jsonl 追加。
 */
import { performance } from 'node:perf_hooks';
import { applyPragmaBaseline, loadSqliteConstructor } from '../src/db/migrations';
import { createDbServerCore } from '../src/db/server';
import { createSearchService } from '../src/main/search';
import type { StatementExecutor } from '../src/main/pages';
import type { AllData, DbResponse } from '../src/db/rpc';

const args = process.argv.slice(2);
const dbPath = args[0];
const workspaceId = args[1];
if (dbPath === undefined || dbPath.length === 0 || workspaceId === undefined || workspaceId.length === 0) {
  console.error('usage: perf-cold-child.ts <dbPath> <workspaceId>');
  process.exit(2);
}

let reqSeq = 0;

/** 与 test/helpers.ts 的 coreExecutor 同构，但只实现搜索服务实际用到的 all()。 */
function makeExecutor(core: ReturnType<typeof createDbServerCore>): StatementExecutor {
  return {
    run: async () => { throw new Error('perf-cold-child 只支持 all'); },
    get: async () => { throw new Error('perf-cold-child 只支持 all'); },
    all: async (sqlId, params) => {
      reqSeq += 1;
      const response: DbResponse = await core.handleRequest({
        id: `perf-cold-${String(reqSeq)}`,
        t: 'all',
        sqlId,
        params,
      });
      if (!response.ok) {
        throw new Error(`${sqlId} 失败：${response.error.message}`);
      }
      return response.data as AllData;
    },
    batch: async () => { throw new Error('perf-cold-child 只支持 all'); },
  };
}

async function main(childDbPath: string, childWorkspaceId: string): Promise<void> {
  const ctor = await loadSqliteConstructor();

  const t0 = performance.now();
  const db = new ctor(childDbPath);
  applyPragmaBaseline(db);
  const core = createDbServerCore(db);
  const migrated = await core.handleRequest({ id: 'perf-cold-migrate', t: 'migrate' });
  if (!migrated.ok) {
    console.error(`perf-cold-child migrate 失败：${migrated.error.code} ${migrated.error.message}`);
    process.exit(1);
  }
  const t1 = performance.now();

  const service = createSearchService({ executor: makeExecutor(core) });
  const { hits } = await service.query({ workspaceId: childWorkspaceId, query: '核反冲', limit: 40 });
  const t2 = performance.now();

  process.stdout.write(
    `${JSON.stringify({
      open_ms: Number((t1 - t0).toFixed(1)),
      first_query_ms: Number((t2 - t1).toFixed(1)),
      hit_count: hits.length,
    })}\n`,
  );
  core.dispose();
}

// tsx 以 CJS 转译 .ts（apps/desktop 无 "type": "module"），顶层 await 不可用 →
// 按 selftest.ts 同款范式包 main()（原文件逻辑不变，仅入口收拢）
void main(dbPath, workspaceId);
