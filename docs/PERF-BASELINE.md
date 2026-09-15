# PERF-BASELINE.md · G4 性能基线仪表盘（§9.2 硬指标实测）

> TASK-T14-01 产出。每轮跑完由测试/脚本**自动追加** `docs/perf-history.jsonl`（`{date, git_rev, metric, value_ms, budget_ms, pass}`，内存/体积类为 `{value, unit, budget}`）；本文件是当前基线的**人读视图**，重大变化时手工更新。
> 环境：本机 Windows（开发机，非 PM 真机验收口径）；git_rev=a95c065，2026-09-16。

## 1. 可 vitest 化四项（`pnpm -C apps/desktop exec vitest run test/perf.test.ts`）

| 指标 | 实测（2026-09-16，a95c065） | 预算 | 结果 |
|---|---|---|---|
| 冷进程打开 1 万页真库 → 第一次搜索 | **49.8 ms**（open+migrate 6.1 + 首查，hits=40） | ≤150 ms | ✅ 绿 |
| 1 万字页（200 块）commitOps batch 落库 P95 | **232.2 ms** | ≤16 ms | ❌ 红（瓶颈分析见 §3） |
| 1 万页账本 rebuildFromSegments 全量 | **45 718 ms**（14 段 / 34 244 op / 13.8 MB segmentsJson） | <5 000 ms | ❌ 红（瓶颈分析见 §3） |
| 1 万页库冷打开 + migrate + 首查 | **52.9 ms**（6.4 + 46.5） | <800 ms | ✅ 绿 |

夹具：`test/helpers.ts` 的 `makeSearchFixtureDb`（mulberry32 种子 20260913，1 万页 × 2–4 块）；冷进程两项经 `node --import tsx test/perf-cold-child.ts` 真·新进程测量。

## 2. 真机两项 + 安装包（`node scripts/perf-pack.mjs`，PM 执行）

| 指标 | 实测 | 预算 | 结果 |
|---|---|---|---|
| 打包冷启动（`electron . --perf-trace`，whenReady→首窗 did-finish-load） | **待真机** | ≤1.5 s | ⏳ |
| 内存常驻（WorkingSet64 之和 ×3 取中位） | **待真机** | ≤350 MB | ⏳ |
| 安装包体积（dist/*.exe 扫描，`--scan-only` 已跑） | **88.5 MB**（Setup 0.1.2.exe） | ≤90 MB | ✅ 绿 |

待真机说明：
1. **打点已接线但待重打包**：`src/main/index.ts` 的 `--perf-trace` 门（默认关、零开销）随本次源码交付，`dist/win-unpacked` 里是旧构建——PM 先 `pnpm -C apps/desktop dist` 重打包再 `node scripts/perf-pack.mjs`。
2. **单实例锁**：测量前退出正在运行的 Septcats，否则待测 exe 会立即退出（脚本红牌提示）。
3. 打包冷启动测量的是本机 dev 机 SSD 口径；PM 真机（目标硬件）复测后把数值回填本表。

## 3. 超预算瓶颈分析（两项红，共用同一根因）

### 3.1 commitOps 200 块 batch P95 = 232 ms（预算 16 ms，超 14.5×）

单 batch = 200 ledger + 200 `block.upsert` + `fts.clearPage`/`fts.syncBlock` ×1（402 条语句单事务）。耗时大头不是插入本身，而是 **v4 块 FTS 触发器（`trg_block_fts_ai`）的整页重算语义**：

- 每 INSERT 一块触发一次 `refreshPageFtsV4(page_id)` = DELETE 整页 FTS 行 + INSERT 重算整页 body；
- body 重算 = 扫该页**全部**块 × 每块 `json_tree` 抽取深层 text（`ftsPageBodyExpr`，src/db/schema.v4.ts:29）；
- 200 块的 batch 内 → 200 次触发 × 平均 100 块扫描 = O(n²)，约 2 万次 json_tree；
- commitOps 尾部的 `fts.clearPage`+`fts.syncBlock` 又把同一页再重算 2 次（第三次全量）。

**修复方向**（后续任务，不在 T14 范围）：触发器降为「事务末尾单次重算受影响页」（如 batch 内挂延迟标记 / `fts.syncBlock` 已有显式维护路径，触发器可在批量写场景短路）；或 commitOps 对同页多块写时先 DROP 事件级重算、只在 batch 提交前同步一次。

### 3.2 rebuildFromSegments 1 万页 = 45.7 s（预算 5 s，超 9.1×）

剖析（`_scratch/cb-T14-profile.mjs`，34 244 op）：

| 阶段 | 耗时 | 占比 |
|---|---|---|
| A parseSegments（JSON.parse + validateSegment + opSchema.safeParse + encodeOp ×N） | 0.6 s | 1% |
| B replay + entities | 0.4 s | 1% |
| D 全量（真路径，`handleRequest('rebuildFromSegments')`） | 46.1–46.8 s | 100% |
| F 同库 DROP 块 FTS 触发器后全量 | **4.0 s** | 9% |

→ **块 FTS 触发器占 ~42 s（≈91%）**：34 244 次块插入逐行触发整页 DELETE+重算，而事务末尾的 `FTS_RESYNC`（server.ts:83）本来就会全量重算一次——触发器白做 3.4 万遍。剩余 ~4 s：ledger 34k + 实体 34k 条语句逐条 `db.prepare`（executeStatement 每语句重新 prepare，微基准 34k 次 ≈ 4.4 s 开销）。

**修复方向**：rebuild 事务内临时禁用块 FTS 触发器（或 server 侧 rebuild 分支改走「无触发器 + 末尾 FTS_RESYNC」），预计全量降到 ~4 s，**可达 5 s 预算内**；中期把 executeStatement 的 prepare 收敛为按 sqlId 缓存。

## 4. 使用方法

```bash
# vitest 四项（含预算断言 + perf-history.jsonl 追加）
pnpm -C apps/desktop exec vitest run test/perf.test.ts
# 真机两项 + 安装包（PM）
pnpm -C apps/desktop dist && node scripts/perf-pack.mjs          # 全量
node scripts/perf-pack.mjs --scan-only                           # 只扫安装包
# 台账
cat docs/perf-history.jsonl   # append-only，按 date/git_rev 对比防回退
```

纪律：预算断言不得为凑绿放宽；超预算如实红 + 更新 §3 分析。
