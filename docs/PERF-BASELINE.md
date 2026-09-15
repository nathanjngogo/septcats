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

## 2. 真机两项 + 安装包（`node scripts/perf-pack.mjs`）

> TASK-T16-01 重写：内存红牌 #32 逐进程解剖后改为**三口径并报**（sum-WorkingSet / sum-Private / 安装包）。
> 实测 2026-09-16，rev 6eafbcd，打包 0.1.3（dist/win-unpacked，独立 --user-data-dir，空载）。

### 2.1 三口径总表

| 指标 | 实测（稳态中位 ×3） | 静置 60s | 预算 | 结果 |
|---|---|---|---|---|
| 打包冷启动（whenReady→首窗 did-finish-load） | **567.7 ms** | - | ≤1.5 s | ✅ 绿 |
| 内存 sum-of-WorkingSet（全部进程物理页之和） | **634.7 MB**（598/635/635） | 632.6 MB | ≤350 MB | ❌ 红（原口径 #32） |
| 内存 sum-of-PrivateWorkingSet（各进程私有页之和） | **331.5 MB**（318/332/332） | 328.4 MB | ≤350 MB（口径待 PM 裁决） | ✅ 绿（同上，待裁决） |
| 安装包体积（dist/*.exe 扫描） | **88.5 MB**（Setup 0.1.3.exe） | - | ≤90 MB | ✅ 绿 |

> 口径说明：sum-of-WS 把进程间共享的物理页（Electron 各进程共享的 Chromium 代码页等）重复计入，
> 是 Electron 应用常见的**高估**口径；sum-of-Private 只算各进程独占页，无重复计入，接近「任务管理器整组」的量级。
> 350MB 预算落在哪个口径上由 PM 裁决（TASK-T16-01-report §4），本表两口径如实并报，不改预算语义。

### 2.2 逐进程表（时点 1 稳态，2026-09-16 / rev 6eafbcd）

| 角色 | PID | WorkingSet | PrivateWS | 说明 |
|---|---|---|---|---|
| browser(main) | 19684 | 236.5 MB | 156.7 MB | 主进程（Electron main + 各 service） |
| utility:DbServer | 21220 | 152.3 MB | 107.9 MB | utilityProcess（node.mojom.NodeService，dbServer.js + better-sqlite3） |
| renderer | 26876 | 98.2 MB | 29.4 MB | 渲染进程（空载，无文档打开） |
| gpu | 25812 | 97.2 MB | 28.5 MB | GPU 进程 |
| utility:NetworkService | 30332 | 50.9 MB | 9.3 MB | Electron 网络服务 utility |
| **合计（5 进程）** | | **635.2 MB** | **331.7 MB** | 静置 60s 后 632.8 / 325.4 MB，稳定 |

要点：DbServer utilityProcess 是第二大占用（WS 152 MB / Private 108 MB）——Node 运行时基线为主，
SQLite 侧实测 cache_size=16 MB（better-sqlite3 编译默认 SQLITE_DEFAULT_CACHE_SIZE=-16000，
非 PRAGMA_BASELINE 所设）、mmap_size=0、journal_mode=wal。PRAGMA 只读实测与候选旋钮见
TASK-T16-01-report §3（**候选，待 PM 批，本任务未改任何 PRAGMA**）。

### 2.3 待真机说明
1. 打包冷启动测量的是本机 dev 机 SSD 口径；PM 真机（目标硬件）复测后把数值回填本表。
2. 脚本已内建清场（启动前 taskkill 全部 Septcats.exe）与独立 `--user-data-dir`（PM 采样三事实 #2/#3 已固化进脚本）。
3. `--baseline <exe路径>` 可同法测另一 Electron 应用做口径对照（可选，未给则跳过，不联网下载）。

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


## PM 口径裁决（2026-09-16，TASK-T16-01 报告后）
- **内存预算 350MB 绑 `memory_private_sum`**（sum-of-PrivateWorkingSet，实测 331.5MB ✅ 预算内）。理由：§9.2 的"内存常驻"本意是应用实际占用的物理 RAM；Chromium 多进程共享代码页在 sum-of-WorkingSet 里被重复计入（本机分叉 ~303MB/×1.9），不代表真实内存压力。
- `memory_workingset_sum` 降级为**观察值**（继续入账不设红牌），跨版本趋势监控用。
- SQLite 旋钮实验与 DbServer 合并**均不批**（前者收益 ~15MB 且威胁 T15 成果需回归成本；后者违背 T2 架构决策——主进程卡顿冻结 UI 不可接受）。
- 目标硬件复测归 G3/G5 验收流程（`node apps/desktop/scripts/perf-pack.mjs`）。
