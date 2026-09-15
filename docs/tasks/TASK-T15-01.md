# TASK-T15-01 · FTS 触发器 O(n²) 修复（性能红牌 #30）

> PM：Hermes ｜ 工程师：CodeBuddy ｜ 仓库：E:\Hermes Agent工作空间\Septcats
> 前置：T14 仪表盘实测两红。必读：docs/PERF-BASELINE.md §3（根因剖析+AB 对照）；apps/desktop/src/db/schema.v4.ts（六触发器与 ftsPageBodyExpr）；src/db/server.ts（rebuild 分支 L479+、FTS_RESYNC_SQL、executeStatement/batch 的 prepare 路径）；src/main/commit.ts（batch 尾部 fts.clearPage/syncBlock）；src/db/statements.ts（白名单与 v2 写守卫口径）。
> 纪律：用 Write/Edit；每写完立即 `pnpm -C apps/desktop test` 真跑；不碰 git；禁占位符。packages/sync/core/ui 零改动。

## 0. 根因（PM 已定位，不再调查）
v4 块触发器每行 INSERT 重算整页 FTS（O(n²)）。rebuild=34k 次整页重算（事务末 FTS_RESYNC 本会全量重算，触发器全白做）；commitOps 200 块同页写=200 次整页重算+尾部再 2 次。

## 1. PM 探针已定的事实（照此实施，别再走弯路）
- **TEMP 表在触发器内不可见**（探针 1 实锤：`no such table: main.fts_defer`——触发器是持久 schema，解析只看 main）。→ defer 标志必须是**常规表**。
- **常规表 + `WHEN (SELECT flag FROM fts_defer LIMIT 1)=0` 守卫语义成立**（探针 2：flag=1 触发器跳过、flag=0 恢复、单行读成本微秒级）。
- rebuild 剖析 F：事务内 DROP 触发器后全量 = 4.0s。

## 2. 修复设计
1. **v6 迁移**（`migration #6: v6-fts-defer`，断言一律 LATEST_SCHEMA_VERSION 参数化）：
   - `CREATE TABLE IF NOT EXISTS fts_defer (flag INTEGER NOT NULL CHECK (flag IN (0,1)))` + `INSERT OR IGNORE` 初始行 flag=0；
   - DROP v4 六个块/page FTS 触发器，以带 `WHEN (SELECT flag FROM fts_defer LIMIT 1)=0` 守卫的形态重建（page 标题触发器同加，语义统一；触发器体其余逻辑逐字保持）。幂等口径同 v2/v3（IF NOT EXISTS/存在性判断）。
2. **server.ts rebuild 分支**：事务头 `UPDATE fts_defer SET flag=1` → 灌数据（跳过全部触发器重算）→ `FTS_RESYNC_SQL`（唯一一次全量）→ 事务尾 `UPDATE fts_defer SET flag=0` → return。**中途 throw**：better-sqlite3 事务回滚会把 flag 一并回滚（同事务），且文件级还原兜底——新测试锁这两层。
3. **batch RPC 路径**（commitOps 走的 executor.batch）：`statements.ts` 新增白名单 `fts.deferOn`/`fts.deferOff`（UPDATE fts_defer 两条）+ `fts.syncPage {page_id}` 已有 clearPage+syncBlock 组合保持。commit.ts **不改逻辑**——runtime 的 batch 组装方（pages/dbview 等已有尾部 fts 维护）之外，**批量写块的路径**：commit.ts 里检测到同 batch 含 ≥2 条 block.upsert 时自动在 batch 头尾插 deferOn/deferOff（一处小改，注释写明动机；deletionMode 等语义零触碰）。
4. **prepare 缓存**（server.ts）：`Map<sqlId, Prepared>` 每连接缓存白名单语句的 prepare 结果（sqlId→sql 不可变）；rebuild 循环与 batch 循环改用缓存。

## 3. 预算（perf.test.ts 断言原值不改，必须跑绿）
- rebuild 10k 页 < 5000ms（预期 2–3s）
- commit_batch_200_blocks_p95 ≤ 16ms（预期 <5ms）
- 全量回归：search（FTS 命中/snippet 语义不破）、sync-runtime、dbview、pages、migrations（v6 用例：新库到 v6、v5→v6 增量、幂等、defer 表存在）、statements（预算 60 内+defer 守卫语句带 CHECK 值域）。
- 新测试 `test/fts-defer.test.ts`：a) defer 开→写 3 块→关→查询命中最新内容；b) rebuild 中途 throw → flag 回 0（事务回滚）；c) 正常单块写（无批量）触发器照常即时生效（守卫不误伤常规路径）；d) 两连接隔离观察：flag 是库级共享——**写明此语义并测**（rebuild 是独占子进程，安全）。

## 4. DoD
```
pnpm -r typecheck
pnpm -C apps/desktop test   # 全量含 perf 四项绿（perf 慢组，timeout 放宽）
pnpm -C apps/desktop selftest
node packages/ui/tokens/no-magic.mjs
pnpm -C apps/desktop build
```
报告 docs/tasks/TASK-T15-01-report.md：前后对照表（45.7s→X / 232ms→Y，perf-history.jsonl 新行）+ 探针事实引用 + DEVIATIONS。
