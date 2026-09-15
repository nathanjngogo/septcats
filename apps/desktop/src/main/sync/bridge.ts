/**
 * main/sync/bridge.ts —— commitOps ↔ SyncRuntime 钩子（TASK-T13-01 §1）。
 *
 * 在 registerSync 处装饰 BatchExecutor：batch 请求里抽 `opLedger.insert` 的
 * op_json，提交成功后把这一批 op 交给 SyncRuntime.onLocalCommit。
 * **不改动 commit.ts**——commitOps 的语句序列原样透传，钩子只读不写。
 */

import { decodeOp, type Op } from '@septcats/core';
import type { StatementExecutor } from '../pages';

/**
 * 装饰 StatementExecutor（pages/dbview/search/importer 共用的执行面）：
 * batch 成功（单事务已落库）后回调 onCommitted(ops)。
 * op_json 解码失败的行跳过（不影响提交本身；ledger 里另有校验兜底）。
 */
export function withSyncHook(
  executor: StatementExecutor,
  onCommitted: (ops: readonly Op[]) => void,
): StatementExecutor {
  return {
    run: (sqlId, params) => executor.run(sqlId, params),
    get: (sqlId, params) => executor.get(sqlId, params),
    all: (sqlId, params) => executor.all(sqlId, params),
    batch: async (stmts) => {
      const ops: Op[] = [];
      for (const stmt of stmts) {
        if (stmt.sqlId !== 'opLedger.insert') {
          continue;
        }
        const opJson = (stmt.params as { op_json?: unknown } | null)?.op_json;
        if (typeof opJson === 'string') {
          try {
            ops.push(decodeOp(opJson));
          } catch {
            // 解码失败不阻断提交；真相层仍以 op_json 落库
          }
        }
      }
      const data = await executor.batch(stmts);
      if (ops.length > 0) {
        onCommitted(ops);
      }
      return data;
    },
  };
}
