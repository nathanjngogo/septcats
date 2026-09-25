# TASK-T80-04 交付报告（工程师填写 · PM 门禁核验）

> 任务书：`docs/tasks/TASK-T80-04.md` · 来源：T80-02 真机探针 run-B/run-C（H-08/H-09）

## §0 开工侦察结论（必答）
① db 连接的真实持有者与既有 close/reopen 通道（报告 T80-02 §0-② 清单的哪一条、能否只关主库连接不杀进程）：
（待填）
② 攒段缓冲的暴露面（SyncRuntime 有无既有 flush 入口、execute 内调用它的最低成本路径）：
（待填）

## §1 改动清单（文件 × 要点）
（待填）

## §2 选型依据
- H-09：close/reopen vs 还原+重启生效 —— 选 ___ ，真机证据：___
- H-08：execute 前强制 flush vs 预检并集 —— 选 ___ ，时序证据：___

## §3 门禁原始输出（贴命令原文）
（待填：pnpm --filter @septcats/desktop test / pnpm typecheck）

## §4 DEVIATION
（待填）

## §5 PM 复跑（PM 补）
（待填：cdp-e2e-t80-02.mjs ≥2 轮结果 + 新增测试计数）
