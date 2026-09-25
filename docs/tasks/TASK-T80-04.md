# TASK-T80-04 · 便携包导入真机缺陷两件（revert EBUSY / plan 未 flush 盲区）

> 来源：T80-02 PM 真机探针（docs/mockups/cdp-e2e-t80-02.mjs，run-B 19 PASS/2 FAIL）
> 优先级：P1（撤销=产品承诺的兜底通道，真机必失败即承诺失效）。
> 只 Write/Edit 落盘，不碰 git；收尾跑受影响测试文件并贴原始输出，打印 DSH-T80-04-EXIT=0。

## 缺陷 1（H-09）：revert 在进程存活时必 EBUSY → 撤销承诺失效
- **实证**：探针 P5-1——`importRevert({backupPath, confirm:true})` 在 app 正常运行中调用，`restorePairs` 第一步 `io.remove(pair.to)`（清理主库）撞 `EBUSY: resource busy or lock`（Windows 下 better-sqlite3 打开的 .db 不允许删除/rename）。**结构化拒绝没错，但结果是「撤销导入」按钮在真实使用场景（老板导错了想撤）里永远点不活**。
- 根因口径：`revert` 走文件级还原（D-1 追认过），但**没有先关连接**。既有 close/reopen 通道（报告 §0-② 持有者清单）里 db 连接归 DbServer 子进程持有——还原前必须走该通道的「停库 → 还原 → 重建服务」，而不是假设文件空闲。
- **修法（最小）**：revert（以及 execute 的失败回滚路径——同一隐患，失败时连接也在）先经 IPC 让 db 侧 `close()` 释放句柄 → `restorePairs` → `reopen`。若 close 通道语义不满足（如 renderer 还在发查询），方案改为：**Windows 下用 `MoveFileEx` 允许 busy-rename 的等价物不可行时，退化为「还原到暂存 + 请求应用重启生效」**——两种路线选一，报告里写明选型依据与真机证据。
- 必加测试：在**连接存活**夹具上调 revert 断言成功（现有单测用临时文件、连接已关 → 假绿面恰在这里；测试必须先持有连接再还原）。

## 缺陷 2（H-08）：plan/execute 的覆盖度预检对「未 flush 的 op」盲区
- **实证**：探针 run-A P4-6——本机新建一页（op 在攒段缓冲、未落 `op_ledger`）后立即 plan → `uncovered=0, willReplace=true` 放行；run-B 同步骤 `uncovered=1`——**同一操作序列两次可见性不一致**（flush 时序窗口）。execute 若在此窗口放行，重放会**抹掉未 flush 缓冲里的用户编辑**——正是 H-04「计数窗口→数据灭失」的同类形态。
- **修法（二选一，报告写选型）**：
  - a) `execute` 入口第一步强制 `flushSegments()`（既有攒段通道）+ `checkpoint` 后再跑覆盖度预检——把盲区压到零；或
  - b) 预检改为「ledger ops ∪ 运行时未 flush 缓冲」并集判覆盖（SyncRuntime 暴露只读 getter）。
  - PM 倾向 a（复用既有 flush，不新增跨模块 getter）。
- 必加测试：造「缓冲有 op、ledger 无」的态 → plan 必须 blocked（或 execute 强制 flush 后 blocked）——覆盖 run-A/run-B 两种时序都钉死。

## DoD（PM 复跑口径）
1. `pnpm --filter @septcats/desktop test` 全绿且**包含上述两条新测试**；`pnpm typecheck` 9/9 Done。
2. PM 复跑 `node docs/mockups/cdp-e2e-t80-02.mjs` ≥2 轮：P5-1 全绿 + P4-6a/P4-6 时序稳定（两轮 `rBusyLive.pass.target.uncovered` 值一致）。
3. 报告填 `docs/tasks/TASK-T80-04-report.md`（骨架已建）：§1 改动清单、§2 选型依据（close/reopen vs 重启生效；flush vs 并集）、§3 门禁原始输出、§4 DEVIATION。
4. 不动 T80-02 已收口的安全闸/错误码面；`restorePairs` 的备份三件套语义（D-5）保持。

## 红线
启动零外联；packages 不 import electron；禁静默覆盖现库；UI token/禁词纪律同前。
