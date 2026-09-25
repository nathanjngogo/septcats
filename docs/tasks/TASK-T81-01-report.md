# TASK-T81-01 报告 · 墓碑物理清除（db 面 GC）

> 任务书：`docs/tasks/TASK-T81-01.md` · 台账：`docs/MILESTONES.md` GC 欠账条 · PRD：`docs/PRD-R28-便携包.md` §4
> 落盘方式：只 Write/Edit，未碰 git。真实库 `C:/Users/Administrator/.septcats` 全程只读未触碰（测试全走临时目录）。
> 收尾标记：`CB-T81-01-EXIT=0`

---

## §0 开工侦察（四问必答）

### §0.1 引用面清单（逐表结论：随墓碑级联删 / 保留 / 参与判定）

先立事实：全库**无 FOREIGN KEY**（`schema.sql.ts` 各表建表语句均无 FK 子句），`PRAGMA foreign_keys` 形同空转；唯一曾在物理层联动的是 page 侧 FTS 触发器。

| 引用面 | 位置 | 结论 |
|---|---|---|
| `block.page_id`（含 `alive=0` 墓碑块） | `schema.sql.ts:55`；语句 `block.deleteByPage` `statements.ts:392` **只删 alive=1** | **级联删**（`dbgc.deleteBlocks` 不带 alive 过滤） |
| `collection.page_id` | `schema.sql.ts:71` | **级联删**（`dbgc.deleteCollections`） |
| `record.collection_id → collection.page_id`（无直接页列） | `schema.sql.ts:86` | **级联删**（`dbgc.deleteRecords`，先于 collection） |
| `favorite.page_id`（设备本地派生态） | `schema.v2.ts:28` | **级联删**（`dbgc.deleteFavorites`）；**不参与放行判定**（见 §5 D-1） |
| `recent.page_id`（设备本地派生态） | `schema.v2.ts:36` | **级联删**（`dbgc.deleteRecents`）；同上不参与判定 |
| `page_lock.page_id` / `block_cipher.page_id` | `schema.v10.ts:19/29` | **参与判定**（有则扣留 `locked`）；正常 purge/delete 路径都会清（`pages.ts` `purgePage`/`deletePage` 内联 `lock.delete`+`lock_cipher.delete`）→ 残留即异常态，保守不放行 |
| `page_link_index.source_page_id` **与** `target_page_id`（双链派生索引） | `schema.v9.ts:16`；既有 `link.clearPage` `statements.ts:872` **只清源侧** | **双侧级联删**（`dbgc.deleteLinks` 的 `OR target_page_id` 补上入链） |
| `import_source.page_id`（导入幂等账本） | `schema.v5.ts:17` | **级联删**（`dbgc.deleteImportSources`；`importSource.list` 已按 `p.alive=1 AND p.deleted_at IS NULL` 过滤死引用，删行与留行对重导幂等性等价） |
| `page.parent_id`（自引用） | `schema.sql.ts:47` | **参与判定**（子树完整性，`has-children`） |
| `page_block_fts.page_id`（FTS5） | `schema.sql.ts:146`；触发器 `trg_page_fts_ad` 有 `fts_defer` WHEN 守卫（flag=1 时不联动） | **显式级联删**（复用 `fts.clearPage` `statements.ts:839`，不赖触发器） |
| `op_ledger`（`target_table='page'` 的 delete 行） | `schema.sql.ts:100`；`commit.ts:518-539` 无条件写账 | **保留（真相层，零触碰）** |
| `mention`（死表：建表但全仓零代码引用） | `schema.v2.ts:44` | 不处理（无消费方，且未纳入判定/级联；登记 §6） |
| `workspace.root_page_id`（软引用，恒为 null） | `schema.sql.ts:35`；`createWorkspaceRow` 恒写 `null` | 不处理（登记 §6） |

### §0.2 安全窗口（能否复活；未同步设备是否还需要这段历史）

1. **物化墓碑行的删除不损真相**：`purgePage` 对每个墓碑页发 `kind:'delete'` op（`pages.ts:692`），payload 空、`commitOps(..., {deletionMode:'purge'})`（`commit.ts:43` `DeletionMode='soft'|'purge'`，`commit.ts:382` purge 分支把物化 `deleted_at` 写 0）。**op_ledger 无条件保留该 delete 行**（`commit.ts:566` 对每个 op 都 push `ledgerStatement`）→ 删物化行后，段重放仍能复现「该页已删」语义。**故「历史 op 在场」不是扣留理由，反而是放行的安全依据。**
2. **撤销链**：编辑器逆 op 在 `packages/editor/src/history.ts:152 invertOne`，`delete → upsert(alive=1)` 复活；且已有守卫「应用前已死 → 逆 op 返回 null」（`history.ts:161-173`）。purge 的 delete op 只出现在 main 的 `commitOps` 路径、不进编辑器撤销栈（`purgePage` 是服务层一次性提交，renderer 无 undo 入口）。
3. **恢复路径**：`restorePage`（`pages.ts:676`）→ `planRestore`（`packages/editor/src/tree.ts:427`）。物理删行后该 id 不再出现在 `loadNodes` → 本单改为抛 `E_NOT_FOUND`（§5 D-5），**「被删页不可恢复」有了明确错误码**。
4. **未同步设备**：段文件 GC 有设备水位双门（`planCleanup` `gc.ts:58`），DB 面没有水位概念（物化行是本机派生态）。未同步的远端设备握有自己的物化副本与同一份账本，本机删本机物化行**不影响**远端；远端若重建也由账本重放复现墓碑，再各自 GC。

### §0.3 批量与事务

- **一个 batch = 一个事务**：`db/server.ts:563-573` 的 `batch` 用 `current.transaction(...)` 包住全部语句，任一 throw 整体回滚（`commit.ts:541-543` 同纪律；`rebalanceLayer`/`sortSequence` 产出的 reorder 与 move op 同批原子，`pages.ts:637-657`）。
- **本单分批**：新增 `DB_GC_BATCH_PAGES = 100`（`main/dbgc.ts`）——每批 ≤100 页 × 9 条语句 = ≤900 条，单事务内完成，避免长事务阻塞编辑写。
- 无通用 `BATCH_SIZE` 常量可复用（`runtime.ts:130` 的 `RECONCILE_BATCH_OPS` 面向对账），故本单自定义并命名。

### §0.4 既有 dry-run 先例

`sync` 段 GC 的「干跑 → 真删」两段语义在 **`sync/runtime.ts` 的 `foldSnapshotAndGc()`**：
`planCleanup(...)` 产清单（`runtime.ts:1269`）→ `if (!this.gcEnabled()) { log('gc dry-run…'); return; }`（`runtime.ts:1273-1276`）→ 真 `encFs.remove`。
开关来源：`settings.sync.gc`（schema `packages/platform/src/settings.ts:77-84`，默认 `gc:false` = dry-run，`settings.ts:121`）经 `index.ts:457` 注入。
**本单复用同一开关与同一「先算清单」纪律**；代价是 `sync.gc` 语义扩为「段 GC + DB 面墓碑 GC 共用」（§5 D-4）。

---

## §1 交付一：planDbGc 纯逻辑

**落点**：`packages/sync/src/gc.ts`（与 `planCleanup` 同文件——任务书给的「core 或 sync」，侦察后选 sync：GC 纪律、retention 语义、`DAY_MS` 同源，desktop 已依赖 `@septcats/sync`，且 `export * from './gc'` 自动出口）。

```ts
export interface DbGcTombstone {
  id: string;
  deletedAt: number | null;   // 0=purge 标记；>0=回收站软删时刻；null=无标记（保守）
  tombstonedAt: number;       // 年龄锚（软删=deleted_at；purge=该行 updated_at）
  childIds: readonly string[];// page.parent_id 指向本行的子页 id（任意存活态）
  locked: boolean;            // 有 page_lock / block_cipher 行
}
export type DbGcHoldReason = 'unreachable' | 'retention' | 'locked' | 'has-children';
export function planDbGc(tombstones, now, { retentionDays }): { deletable, held }
```

放行判据（全部满足）：
1. 年龄可知（`deletedAt !== null`）且（purge 标记 或 软删满 `retentionDays`，`retentionDays<=0` = 不设限）；
2. 无锁行/密文；
3. **子树完整性**：`childIds` 里没有「不在放行集合内」的 id —— 对候选集**迭代到不动点**，故父子同为墓碑且都过 1)/2) 时可整棵一起放行；活子页或被扣留子页会连带扣留父行。

产出保持入参顺序（确定性）；**只出清单，绝不真删**（同 `planCleanup` 纪律）。原因码优先级 `unreachable > retention > locked > has-children`。

## §2 交付二：runDbGc 执行路径（main 侧）

**落点**：`apps/desktop/src/main/dbgc.ts`（新）；SQL 白名单 `apps/desktop/src/db/statements.ts` 新增 10 条（`dbgc.*`，行号 679-747）。

- **读侧 2 条**（维护面全局扫描，跨工作区一次清完）：
  - `dbgc.tombstones`：一行一墓碑 + `lock_count` / `block_count` / `bytes` 三个相关子查询；
  - `dbgc.pageParents`：全表 `(id → parent_id)` 边，JS 侧建 `childIds`（**刻意不用 `json_group_array`**：解析失败静默丢子页会误删父行，宁多一条语句）。
- **写侧 8 条**（逐页固定序，同一事务）：`deleteRecords`（先）→ `deleteCollections` → `deleteLinks` → `deleteFavorites` → `deleteRecents` → `deleteImportSources` → `deleteBlocks` → `fts.clearPage`（复用既有）→ `deletePage`（末）。
  - `dbgc.deletePage` 硬闸 `WHERE id = @id AND alive = 0`（**即便清单被误喂活页 id 也 0 行受影响**）；
  - 一律**不带 workspace_id 守卫**（表无该列或 id 即 ULID 全局唯一，同既有维护语句 `lock.delete`/`block.deleteByPage` 口径）；
  - **op_ledger 无对应语句 → 一行不动**。
- **只删清单内 id**：`statementsForPage(id)` 仅由 `planDbGc(...).deletable` 驱动。
- 返回 `{ deletedPages, deletedBlocks, bytesFreed, batches, held, heldByReason }`；页面/块数以声明式语句回执的**真实 `changes`** 累加（`deletePage` 有自守，可能少于计划数）。
- 装配用**裸 handle**（`index.ts` `dbgc: createDbGcService({ executor: handle })`）——维护面写不是 Op 路径，同 `links`/`lock`：**派生态不进攒段器、绝不伪造 op**。

## §3 交付三：触发面（设置页 + 启动有界后台）

- **契约**：`apps/desktop/src/shared/dbgc.ts`（新）；通道 `DBGC_CHANNELS = { preview:'dbgc:preview', run:'dbgc:run' }`（`shared/ipc.ts`）；`preload/index.ts` 暴露 `window.septcats.dbgc.{preview,run}`；`types/window.d.ts` 补 `SeptcatsDbGcApi`。
- **IPC**：`main/index.ts` 内联注册两通道，服务缺失统一回 `E_DB_UNAVAILABLE: 数据库服务不可用`。
- **设置页**：`renderer/src/pages/SettingsPage.tsx` 新增「同步」区块（`settings.sync.*`）：
  - 「自动清理」`Switch` → `settings.patch({ sync: { gc } })`；
  - 「清理已删除内容」→ dry-run **预览**（页面/块/预计释放 + 保留天数说明 + 扣留计数）→ 「确认清理」→ 结果行；取消 = 零写。入口形状照 R27/R28（preview 只读 → confirm 执行）。
- **启动有界后台**：`main/index.ts` `runStartupDbGc(ctx, services)`——`createWindow()` 之后 fire-and-forget（不 await），**仅当 `settings.sync.gc` 为真**才跑；失败只记日志（下次启动重试），不阻断首屏（纪律同 `index.ts:506` `rebuildLinksIndex`）。
- **i18n**：`settings.sync.*` 14 键，zh-CN / en-US 键集合同构（门禁①②⑥通过）。

## §4 测试与门禁

### 新增/改动测试

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `packages/sync/test/dbgc.test.ts`（新） | 14 | planDbGc 全覆盖：未满期 / 恰满 / purge 免 retention 门 / retentionDays=0 / `unreachable` / 有子页 / 父子整棵放行 / 子页被扣留连带扣父 / 有锁 / 优先级 / 历史 op 在场放行 / 收藏·最近不进判定面 / 确定性顺序 / 空输入 |
| `apps/desktop/test/dbgc.test.ts`（新） | 3 | **夹具 = 34 purge 墓碑 + 14 存活页**（脱敏复刻老板库形态）：preview 零写 → run 分批真删；存活页逐 id 完好、其派生行不动；**op_ledger 逐字节不变**；reference 面全清（block/collection/record/favorite/recent/双链双侧/import_source/FTS）；`restorePage` 抛 `E_NOT_FOUND`；分批上限（101 → 2 批）；`deleted_at=NULL` 扣留不删 |
| `apps/desktop/test/settings-react.test.tsx` | +1 | 同步区开关 `patch({sync:{gc}})` + 预览条数 + 确认执行结果行 |
| `apps/desktop/test/statements.test.ts` | 预算随动 | 白名单精确计数 79→89、预算 `<85`→`<100`（§5 D-2） |

### 原始输出（本机原生跑，node v22.23.2）

```
# packages/sync
Test Files  12 passed (12)
     Tests  123 passed (123)          # 109 → 123（+14）

# apps/desktop
Test Files  107 passed (107)
     Tests  1234 passed (1234)        # 1230 → 1234（+4，含 dbgc 3 + settings-react 1）

# 其余包
packages/core      51 passed (51)
packages/editor   275 passed (275)
packages/ui       168 passed (168)
packages/dbview   122 passed (122)
packages/importer  99 passed (99)
packages/platform  41 passed | 1 skipped (42)
packages/schema     5 passed (5)

# 全仓 typecheck（9/9）
Scope: 9 of 10 workspace projects
packages/core/platform/ui/dbview/editor/schema/sync/importer typecheck: Done
apps/desktop typecheck: Done

# 门禁
✓ no-magic：组件 CSS 无字面 hex、无非 1px 重复裸 px
✓ token 产物与 DESIGN.md 一致
```

**四包基线（PRD §3 DoD：desktop 1140 / editor 270 / importer 99 / ui 168）只增不减**：1234 / 275 / 99 / 168 ✓。
性能红线未回归：search P95 = 12.9ms（预算 150）、commitOps P95 = 15.7ms（预算 16）、rebuild = 1593.9ms（预算 5000）、冷启动首查 = 48.1ms（预算 800）。

---

## §5 DEVIATION

- **D-1「有收藏/有最近」由「扣留」改为「随页级联清除」。** 任务书把「有收藏」列在 planDbGc 的覆盖清单里，字面读像扣留理由。侦察后改口径：`favorite.list`/`recent.list` 均 `JOIN page … alive=1`（`statements.ts:580-611`），**墓碑的收藏/最近本就不可见且 UI 无取消入口**；若作扣留理由，「彻底删除」对这些页永不完成，且 `dbgc.deleteFavorites` 会沦为死语句。故 planDbGc 入参不含 favorite/recent（不在判定面），执行侧一律级联删。测试两处均覆盖（sync 侧「不进判定面」用例 + desktop 侧 `tomb-00` 收藏行清理后为 0）。
- **D-2 白名单预算上调。** 新增 `dbgc.*` 10 条 → `SQL_IDS.length` 79→89；`statements.test.ts` 的精确计数与「<85」预算随之改为 89 / `<100`（标题同步注明 T81-01 十条）。属必要随动（GC 必须走白名单，否则只能写裸 SQL = 触安全红线），非放宽审计。
- **D-3 新建「同步」设置区块。** 任务书说「设置 →『同步』区 gc 开关下新增」，但全仓**不存在**「同步」设置区块：`sync.gc` 此前只在 settings JSON 里、UI 无开关（`SyncStatus.tsx` 面板只有 enabled/encrypt）。故本单在 `SettingsPage` 新建「同步」fieldset，容纳 gc 开关 + 清理入口（未搬动既有 SyncStatus 面板）。
- **D-4 `sync.gc` 语义扩展 + 启动策略。** 该开关原仅驱动段 GC（`runtime.ts:1273`），本单扩为「段 GC + DB 面墓碑 GC 共用」。启动时**仅当 gc=true 才真跑**；gc=false 时启动路径完全不动库（干跑只记日志的旧行为改为「设置页按需预览」）。理由：避免每次启动都为 34 个墓碑记一条无行动价值的日志。
- **D-5 `restorePage` 对不存在 id 由 `{restored:0}` 改为抛 `E_NOT_FOUND`。** 兑现任务书「被删页不可恢复（restorePage 返回明确错误码）」。已 grep 全仓测试，无任何用例依赖「缺 id → restored:0」旧语义；`E_PARENT_GONE`/正常恢复语义不变。
- **D-6 `import_source` 随页级联删（而非保留）。** T82-02 的 `importSource.list` 已按页码存活过滤，删除死行与保留死行对重导幂等性**等价**（两者都不会把死引用当重复），删行可防孤儿行堆积。
- **D-7 保留「有锁 → 扣留」。** `purgePage`/`deletePage` 正常路径都会清 `page_lock`/`block_cipher`（`pages.ts:669-671,717-721`），故墓碑带锁属**异常态**；密文是内容唯一副本，形态异常时保守不放行（因此 GC 不含 `lock.delete`/`lock_cipher.delete` 步骤）。
- **D-8 retention 门对 purge 墓碑不设限。** `deleted_at=0`（用户已显式彻底删除）直接放行；回收站软删按 30 天（`DB_GC_DEFAULT_RETENTION_DAYS`，与 `runtime.ts:128 DEFAULT_RETENTION_DAYS` 同值；**未接** manifest.retention_days，硬编码常量 + 可注入覆盖——见 §6）。

## §6 遗留

1. **附件孤儿回收对账未做**：MILESTONES 欠账条与 PRD §4 提到「含附件孤儿回收对账」。本单只删 db 行，未扫 `attachments/`（内容寻址，跨页共享）的孤儿文件。
2. **真机 CDP 取证未做**：本环境只跑单测/门禁；设置页入口的真机点击链、启动后台 GC 的真机日志留 PM 验收。
3. **retention_days 未接 manifest**：硬编码 30（可注入），若 PM 期望跟随 `sync/manifest.json` 的 `retention_days` 需再接线。
4. **软删（回收站）超期自动清属新行为**：`deleted_at>0` 且满 30 天的回收站页会被 GC 一并清掉。任务书 §交付面写「墓碑满 retentionDays」，故实现之；但这是**回收站自动清空**的产品语义，建议 PM 裁决是否需在 UI 明示（当前只在预览里显示条数 + 保留天数说明）。
5. **`mention` 死表**（`schema.v2.ts:44`，全仓零代码引用）未纳入判定/级联。
6. **`workspace.root_page_id` 软引用**未加守卫（现恒为 null）。
7. **启动后台 GC 与编辑写的并发**未做压力验证（better-sqlite3 同步 API + 单事务分批，实测桌面全量 1234 无碍）。
8. **`dbgc.deletePage` 的 `alive=0` 自守未单独测**：正常路径由 planDbGc 保证只放行墓碑，自守属纵深防御，未构造「误喂活页 id」的注入夹具。
9. **`docs/perf-history.jsonl` 出现机器生成 diff**：跑 `pnpm -C apps/desktop test` 时 perf 用例按既有设计把本轮基线 append 进台账（非本单手写改动）；`git status` 里它与本单源码改动并列，PM 收口时可自行决定是否纳入提交。

---

## §7 PM 复跑（收口验收 · 原生环境最终口径）

**环境**：node **v22.23.2**（`C:/Users/Administrator/AppData/Local/hermes/node`，非 v26）+ 长 TMPDIR（`C:\Users\Administrator\AppData\Local\Temp`，非 8.3 短路径）+ `ensure-abi` 按目标切二进制（测试=node / 真机=electron）。

### 门禁（PM 独立重跑）

| 项 | 结果 |
| --- | --- |
| 全仓 typecheck | **9/9 Done(0)** |
| desktop | **1234 passed**（106 文件；T82-02 基线 1230，+4） |
| packages/sync | **123 passed**（基线 109，+14） |
| packages/core | 51 passed |
| packages/editor / importer / ui | 275 / 99 / 168 passed（与基线一致） |
| `no-magic` | ✓ 组件 CSS 无字面 hex、无非 1px 重复裸 px |
| `probe-discipline` | 扫描 **74** 个脚本，违规 **0** |
| `probe-ledger` | **835 断言 / 0 红**（LEDGER-GREEN；t81-01 已登记 16/0；1 项 THIN=t68 历史遗留） |

### 真机验收（PM 自写探针 `docs/mockups/cdp-e2e-t81-01.mjs`，非工程师自证）

**T81-01：16 PASS / 0 FAIL** — 全程双钉（`--user-data-dir` + 独立 `rootPath`），断言条数守卫 16 ≥ 12：

1. **P0 夹具**：三类页就位（存活 / 回收站软删 `deletedAt>0` / 彻底删死引用 `deletedAt=0`）。
2. **P1 预览**：设置页「清理已删除内容」按钮在场 → 出预览面板 → 放行 **1** 条、扣留 **1** 项（未到期）、保留天数 **30** 明示；**IPC 与 UI 对账** `{candidates:2, deletable:1, held:1, heldByReason:{retention:1}}`。
3. **P2 取消=零写**：三类页原样在场、面板收起（先算清单绝不先删，兑现任务书红线）。
4. **P3 确认真删**：放行的死引用页从树里消失；**存活页未误删**；回收站页按 retention **扣留**。
5. **P4 重启持久**：重启后真删仍生效（非内存态），存活页与扣留页均在。
6. **P5 隔离**：真实根 `C:\Users\Administrator\.septcats` **mtime 不变**（零触碰）。

### 回归探针（同轮全绿）

| 探针 | 结果 |
| --- | --- |
| cdp-e2e-t81-01 | 16 / 0 |
| cdp-e2e-t80-02 | 21 / 0 |
| cdp-e2e-t80-01 | 23 / 0 |
| cdp-e2e-t79-01 | 16 / 0 |
| cdp-e2e-t76-01 | 13 / 0 |
| cdp-e2e-t80-05 | 11 / 0 |
| cdp-e2e-t82-02 | 16 / 0 |

### 真实库 GC 只读 dry-run（**副本上算**，真实根零触碰）

三件（`septcats.db` / `-wal` / `-shm`）拷进 `_scratch/realgc-dryrun/` 后以 `PRAGMA query_only=ON` 复算 planDbGc 判据：

```
tombstones_total 39 · deletable 34 · held {retention: 5}
blocks_freed_if_run 95 · bytes_freed_if_run 6492
alive_pages_untouched 457 · 真孤儿块（无页归属） 0
```

**解读**：此前台账记的「孤儿块 95」实为**墓碑页自己的块**（正是 GC 要清的），非无归属孤儿；点一次「清理已删除内容」即可释放 34 墓碑 / 95 块，5 个未到期回收站页按 30 天保留。

### PM 裁决

- **§6.4（回收站超期自动清）**：判为**符合任务书**（交付面写「墓碑满 retentionDays」），但属产品语义新增 → 已在预览面板显式呈现「保留 30 天；已彻底删除的页面不受此限制」，**上线后向老板单列提示**。
- **D-1/2/3/4/5/6/7/8 八条 DEVIATION**：逐条比对实现与任务书后**全部追认**（D-2 白名单 79→89 属必要随动，SQL 全走白名单；D-5 `E_NOT_FOUND` 无测试依赖旧语义；D-8 与既存 `DEFAULT_RETENTION_DAYS=30` 同值）。
- **默认安全**：`settings.sync.gc` 默认 **false** → 升级后启动路径不动库，真实库写入**只由用户点按钮触发**。
- **§6.1 附件孤儿对账**：未做，转 R29 台账欠账条（不阻塞本单）。
