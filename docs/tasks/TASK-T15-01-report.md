# TASK-T15-01 交付报告 · FTS 触发器 O(n²) 修复（性能红牌 #30）

> 工程师：CodeBuddy ｜ 2026-09-16 ｜ 工作树未提交（perf-history 的 git_rev=493b8fe 为当时 HEAD）

## 1. 前后对照（两枚红牌全部转绿）

| 指标 | 修复前（T14 基线，a95c065） | 修复后（本轮实测） | 预算 | 结果 |
|---|---|---|---|---|
| 1 万页账本 rebuildFromSegments 全量 | **45 718 ms** | **1 542.4 ms**（29.6×） | <5 000 ms | ✅ 绿 |
| 1 万字页（200 块）commitOps batch P95 | **232.2 ms** | **12.6 ms**（18.4×） | ≤16 ms | ✅ 绿 |
| 冷进程打开 1 万页 → 首查 | 49.8 ms | 32.4 ms | ≤150 ms | ✅ 绿（不受损） |
| 冷打开 + migrate + 首查 | 52.9 ms | 52.8 ms | <800 ms | ✅ 绿（不受损） |

`docs/perf-history.jsonl` 已由 perf.test.ts 自动追加 4 行（date=2026-09-16，git_rev=493b8fe，全 pass）。

## 2. 修复内容（对照任务书 §1/§2）

1. **v6 迁移**（`schema.v6.ts` + `migrations.ts` #6 `v6-fts-defer`）：
   - `fts_defer` **常规表**（PM 探针 1：TEMP 表在触发器内不可见，`no such table: main.fts_defer` 实锤），`flag INTEGER NOT NULL CHECK (flag IN (0,1))` STRICT + 初始行 flag=0（`NOT EXISTS` 守卫防重复行）+ 兜底复位 `UPDATE … SET flag=0`（防历史残留 flag=1 永久禁用触发器）；
   - DROP v4 六个 FTS 触发器，带 `WHEN (SELECT flag FROM fts_defer LIMIT 1)=0` 守卫重建（page 标题触发器同加；触发器体经 `refreshPageFtsV4`/`ftsPageBodyExpr` 与 v4 **单源逐字一致**，仅外层加守卫）；幂等口径同 v2/v3/v4（IF NOT EXISTS / NOT EXISTS / DROP IF EXISTS+CREATE）。
2. **statements.ts 白名单**：`fts.deferOn`/`fts.deferOff`（无参 UPDATE，值域由表级 CHECK 收口）。SQL_IDS 54→56（预算 <60 不变）。
3. **server.ts rebuild 分支**：事务头 `fts.deferOn` 等价语句 → 清库/账本/物化（触发器全部短路）→ `FTS_RESYNC_SQL` 唯一一次全量 → 事务尾复位。**中途 throw → better-sqlite3 事务回滚把 flag 一并回 0**（`test/fts-defer.test.ts` b 组在 FTS_RESYNC 处注入 throw 锁定：flag=0、账本 0 条、物化/FTS 回重建前）。
4. **commit.ts batch 路径**：同 batch ≥2 条 `block.upsert` 自动头尾插 `fts.deferOn`/`fts.deferOff`（单处小改，注释写明 O(n²) 动机；deletionMode/extraStatements/单条写语义零触碰）。deferOff 排在尾部 `fts.clearPage`+`fts.syncBlock` 之后——显式 sync 不受触发器守卫影响，FTS 只重算这一次。
5. **prepare 缓存**（server.ts）：`WeakMap<连接, Map<cacheKey, PreparedStatement>>`，rebuild 的 34k 条 ledger 插入与 batch 循环都吃缓存（PERF-BASELINE §3.2 剖析的 ≈4.4s prepare 开销收敛）。按连接挂 WeakMap：迁移文件级还原换连接时旧缓存整体失效，无跨连接复用。

## 3. 测试（test/fts-defer.test.ts 四断言全绿，共 6 用例）

- a) defer 开→写 3 块→关：commitOps 批量自动包裹、查询命中最新内容；另有「裸包不显式同步」用例证明触发器确实被守卫短路；
- b) rebuild 中途 throw（FTS_RESYNC 处注入）→ flag 回 0、事务回滚（账本/物化/FTS 回重建前）+ 正常 rebuild 尾部复位且命中；
- c) 常规单块写（无批量）触发器照常即时生效（insert/au 更新即时可查，守卫不误伤）；
- d) 两连接隔离观察：**flag 是库级共享状态**（单行单值、跨连接可见）——连接 A deferOn、连接 B 立即可见且其块写同样跳过重算；B 复位后 A 亦见 0、B 的常规写恢复触发器。语义：运行期只有 rebuild（独占子进程）与 commitOps 单事务 batch 置 1，且同事务回滚兜底，共享不产生跨事务残留。

回归：search（FTS 命中/snippet）、sync-runtime、dbview、pages、migrations（v6 新库/v5→v6 增量/幂等/CHECK 值域）、statements 全绿。

## 4. DoD 五条（原文命令，全部实跑）

```
pnpm -r typecheck                      # ✅ Done（含 apps/desktop node+web 两个 tsconfig）
pnpm -C apps/desktop test              # ✅ 22 files / 213 tests 全绿，含 perf 四项
pnpm -C apps/desktop selftest          # ✅ SELFTEST OK（FTS_RESYNC 2000 页 26.5ms）
node packages/ui/tokens/no-magic.mjs   # ✅ 无字面 hex、无非 1px 重复裸 px
pnpm -C apps/desktop build             # ✅ 4807 modules，built in 3.31s
```

红线自检：`test/perf.test.ts` 的预算断言（16ms/5000ms）**零改动**，实测跑绿；packages/sync/core/ui 零改动（git status 仅 apps/desktop 源码+测试+本报告+perf-history 追加行）。

## 5. DEVIATIONS

1. **migrations.test.ts 既有断言按任务书要求更新**：`LATEST_SCHEMA_VERSION` 由硬编码 `toBe(5)` 改为参数化（迁移表末项 + `v6-fts-defer` 名称锁语义）；statements.test.ts 白名单计数 `toBe(54)`→`toBe(56)`（预算 `<60` 断言原样保留）。两处均为任务书 §1/§3 明示口径，非放宽。
2. **`fts_defer` 无主键/索引**：单行单值语义（初始行 NOT EXISTS + 复位 UPDATE 保证），`LIMIT 1` 即全局 flag；未加 UNIQUE 以保持任务书原文的建表语句形态。
3. **v6 复位语句（`UPDATE fts_defer SET flag=0`）超出任务书字面两条**：防「历史残留 flag=1 的库升级后触发器被永久禁用」，属幂等/安全兜底，不改变行为语义。
4. **prepare 缓存挂在模块级 WeakMap 而非 core 实例字段**：`executeStatement` 保持模块级函数签名（applyEntity/readLedgerOps 复用），按连接隔离的语义等价（连接替换即缓存失效）。
5. **测试 b 组的「rebuild 中途 throw」用 exec 打补丁注入**（在 FTS_RESYNC 处抛出）：rebuildFromSegments 真实路径不可注入失败（输入在事务外已全部校验），补丁发生在事务最深时点（flag=1 已写、清库+账本+物化已灌完），事务回滚层语义被真实锁定；文件级还原兜底层由 migrations.test.ts 既有「迁移失败还原」用例覆盖（同一机制）。

## 6. 遗产续作与独立复核（第二轮会话追加，2026-09-16）

本报告正文系上一会话死掉前落盘的遗产；续作会话按「不重写已有文件」纪律未改动 §1–§5，仅做**独立复核**，结果如下：

- **TS2556 根因复核**：`ReturnType<SqliteDatabase['prepare']>` 对 better-sqlite3 泛型条件返回类型（`BindParameters extends unknown[] ? … : …`）的索引访问推导退化到元组分支，`run(...args)` 展开 `unknown[]` 即报 TS2556——最小复现实证；现行的结构化 interface（仅 run/get/all 最小面）可正确解析，typecheck 绿。修复思路与 §5.4 一致。
- **DoD 五条独立实跑全绿**：`pnpm -r typecheck` ✓；`pnpm -C apps/desktop test` ✓ 22 文件/213 用例（perf 实测 rebuild **1674.2ms**、commit P95 **12.9ms**，即 perf-history 493b8fe 第二行采样，断言零改动）；`selftest` ✓（FTS_RESYNC 2000 页本轮 18.6ms）；`no-magic` ✓；`build` ✓（3.56s）。
- 两次独立全量验证（§1 表格第一轮 + 本轮）互为背书，红牌转绿结论稳定可复现。
